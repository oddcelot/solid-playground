// Checks the site as visitors get it: builds it for http://localhost:5199 (scripts/build.ts), serves dist/ with the
// headers the playground needs (what dist/_headers tells Cloudflare), and opens it in headless Chrome on a fresh
// profile. `/` must open straight into the playground under its name, with the default project running and the
// gallery listing exactly hosting.json's projects; then each of those must install and run.
//   node scripts/check.ts                   Chrome: CHROME=<binary>, else the usual install on macOS or Linux
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import puppeteer, { type Page } from "puppeteer-core";

const root = join(import.meta.dirname, "..");
const PORT = 5199;
const origin = `http://localhost:${PORT}`;
const hosting = JSON.parse(readFileSync(join(root, "hosting.json"), "utf8"));
const chrome =
  process.env.CHROME ??
  ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => existsSync(p));
if (!chrome) throw new Error("check: no Chrome found: set CHROME to its binary");

execFileSync(process.execPath, [join(root, "scripts/build.ts"), "--origin", origin], { stdio: "inherit" });
const dist = join(root, "dist");
const examples: string[] = JSON.parse(readFileSync(join(dist, "examples.json"), "utf8"));

// A static server like Cloudflare's: clean URLs (/embed is embed.html), and cross-origin isolation on every response.
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? "/", origin).pathname));
  const file = [path, `${path}.html`, join(path, "index.html")].map((p) => join(dist, p)).find((f) => f.startsWith(dist) && existsSync(f) && statSync(f).isFile());
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
  res.setHeader("Origin-Agent-Cluster", "?1");
  if (!file) return void res.writeHead(404).end("not found");
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
});
await new Promise<void>((ok) => server.listen(PORT, "127.0.0.1", ok));

const problems: string[] = [];
const profile = mkdtempSync(join(tmpdir(), "solid-playground-check-"));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, userDataDir: profile });
try {
  for (const name of [...hosting.gallery, hosting.defaultProject]) if (!examples.includes(name)) problems.push(`hosting.json names "${name}", which runbun doesn't bundle`);

  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e instanceof Error ? e.message : String(e)));
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
  if ((await page.evaluate(() => document.documentElement.dataset.view)) !== "app") problems.push("/ shows a landing page");
  const status = await settled(page);
  if (!status.startsWith("Running")) problems.push(`the default project (${hosting.defaultProject}) didn't start: "${status}"`);
  const title = await page.title();
  if (!title.endsWith(`· ${hosting.name}`)) problems.push(`the tab title is "${title}"`);

  await page.click("#example");
  await page.waitForSelector(".gallery-card");
  const cards = new Set<string>();
  const tabs = await page.$$(".gallery [role=tab]");
  for (const tab of tabs.length ? tabs : [null]) {
    await tab?.click();
    for (const n of await page.$$eval(".gallery-card .name", (els) => els.map((e) => e.firstChild?.textContent?.trim() ?? ""))) cards.add(n);
  }
  if (cards.size !== hosting.gallery.length) problems.push(`the gallery lists ${cards.size} projects (${[...cards].join(", ")}), hosting.json ${hosting.gallery.length}`);
  if (errors.length) problems.push(`errors on /: ${errors.join("; ")}`);
  await page.close();
  console.log(`check: / is "${title}", ${status}; the gallery lists ${[...cards].join(", ")}`);

  for (const name of hosting.gallery) {
    const p = await browser.newPage();
    const started = Date.now();
    await p.goto(`${origin}/?example=${name}`, { waitUntil: "domcontentloaded" });
    const s = await settled(p);
    const text = await p.evaluate(() => document.querySelector(".xterm-rows")?.textContent ?? "");
    const failed = !/^(Running|Exited)/.test(s) || /worker start timed out|worker error:/.test(text);
    if (failed) problems.push(`${name}: "${s}" …${text.slice(-300)}`);
    console.log(`${failed ? "✗" : "✓"} ${name}: ${s} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
    await p.close();
  }
} finally {
  await browser.close();
  server.close();
  rmSync(profile, { recursive: true, force: true });
}

if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}
console.log(`check: "${hosting.name}" works from runbun's release archive`);

/** The status bar once it has held still for 2 s and isn't busy (an install runs, then the program). */
async function settled(page: Page): Promise<string> {
  let last = "";
  let since = Date.now();
  for (const end = Date.now() + 120_000; Date.now() < end; await new Promise((r) => setTimeout(r, 250))) {
    const s = await page
      .evaluate(() => {
        const el = document.querySelector<HTMLElement>("#status");
        return el ? `${el.dataset.state}|${el.textContent?.trim()}` : "";
      })
      .catch(() => "");
    if (s !== last) [last, since] = [s, Date.now()];
    else if (s && !s.startsWith("busy|") && Date.now() - since >= 2000) return s.split("|")[1];
  }
  return last.split("|")[1] ?? "didn't settle";
}
