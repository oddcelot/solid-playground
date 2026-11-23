// Builds the site into dist/: downloads the runbun playground release pinned in playground.json, checks its SHA-256,
// unpacks it, points it at this host with the archive's own configure.ts and hosting.json, and adds the site's fonts
// (Geist, from node_modules) under dist/fonts/. Nothing is compiled.
//   node scripts/build.ts                         for solid.runbun.dev (hosting.json)
//   node scripts/build.ts --origin <url>          the same, served at another origin (scripts/check.ts: localhost)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const { version, sha256 } = JSON.parse(readFileSync(join(root, "playground.json"), "utf8"));
const name = `runbun-playground-${version}`;
const url = `https://github.com/oddcelot/bun-webcontainer/releases/download/v${version}/${name}.tar.gz`;
const cache = join(root, ".playground");
const archive = join(cache, `${name}.tar.gz`);

mkdirSync(cache, { recursive: true });
if (!existsSync(archive)) {
  console.log(`build: downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`build: ${url} answered ${res.status}`);
  writeFileSync(archive, new Uint8Array(await res.arrayBuffer()));
}
const got = createHash("sha256").update(readFileSync(archive)).digest("hex");
if (got !== sha256) {
  rmSync(archive, { force: true });
  throw new Error(`build: ${name}.tar.gz has SHA-256 ${got}, playground.json pins ${sha256}`);
}

rmSync(join(cache, name), { recursive: true, force: true });
execFileSync("tar", ["-xzf", archive, "-C", cache]);

const hosting = JSON.parse(readFileSync(join(root, "hosting.json"), "utf8"));
const at = process.argv.indexOf("--origin");
if (at > 0) hosting.editorOrigins = [new URL(process.argv[at + 1]).origin];
// The copy configure reads is in the cache folder: the brand's logos and share card are paths relative to hosting.json here.
for (const key of ["logo", "logoDark", "card"]) if (hosting.brand?.[key]) hosting.brand[key] = join(root, hosting.brand[key]);
const file = join(cache, "hosting.json");
writeFileSync(file, JSON.stringify(hosting, null, 2));
execFileSync(process.execPath, ["configure.ts", "dist", file], { cwd: join(cache, name), stdio: "inherit" });

const dist = join(root, "dist");
rmSync(dist, { recursive: true, force: true });
cpSync(join(cache, name, "dist"), dist, { recursive: true });

// The site's own fonts (hosting.json's theme.fonts name these stylesheets): Geist and Geist Mono, as the SolidJS sites
// have them, served from here. Each package's variable-weight stylesheet and the files it names.
for (const font of ["geist", "geist-mono"]) {
  const from = join(root, "node_modules/@fontsource-variable", font);
  const to = join(dist, "fonts", font);
  const css = readFileSync(join(from, "wght.css"), "utf8");
  mkdirSync(join(to, "files"), { recursive: true });
  writeFileSync(join(to, "wght.css"), css);
  for (const [, file] of css.matchAll(/url\(\.\/files\/([\w.-]+)\)/g)) cpSync(join(from, "files", file), join(to, "files", file));
}
for (const href of hosting.theme?.fonts ?? [])
  if (href.startsWith("/") && !existsSync(join(dist, href))) throw new Error(`build: hosting.json's theme.fonts names ${href}, which dist/ doesn't have`);
console.log(`build: dist/ is runbun ${version} as "${hosting.name}" for ${hosting.editorOrigins[0]}`);
