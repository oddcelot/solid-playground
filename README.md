# Solid Playground

https://solid.runbun.dev: a SolidJS playground in the browser. Pick one of the Solid projects, edit it, and it
installs and runs right there, with Bun's runtime and toolchain compiled to WebAssembly.

It is [runbun](https://runbun.dev)'s playground, self-hosted: this repository holds no playground code. It pins one of
runbun's release archives and says how this copy differs from runbun.dev:

- [`playground.json`](playground.json): the runbun release (`version`) and the archive's SHA-256.
- [`hosting.json`](hosting.json): the site's name, which of runbun's bundled examples the gallery lists and which one
  opens first, no landing page, and the origin it is served from.

`pnpm build` downloads the archive, checks its hash, and points it at this host with the archive's own `configure.ts`
(`node configure.ts dist hosting.json`); `dist/` is the site. Nothing is compiled.

```sh
pnpm install
pnpm check       # builds for http://localhost:5199, serves it, runs each project in headless Chrome
pnpm run deploy  # builds for solid.runbun.dev and deploys dist/ with wrangler (wrangler.jsonc)
```

Node 24 or later runs the scripts. Serving `dist/` needs cross-origin isolation headers on every response
(`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: credentialless`); the archive's
`dist/_headers` sets them on Cloudflare and Netlify, and `scripts/check.ts` sends them itself.

Running code needs WebAssembly Memory64: Chrome and Edge 133+, Firefox 134+. Short links, Feedback, signing in with
GitHub and git's proxy are runbun.dev's own; this copy leaves them out.

## Updating

Set `version` and `sha256` in `playground.json` to a newer release
([releases](https://github.com/oddcelot/bun-webcontainer/releases), `shasum -a 256` of its
`runbun-playground-<version>.tar.gz`), then `pnpm check`. The gallery's projects come from
[runbun-examples](https://github.com/oddcelot/runbun-examples); `dist/examples.json` lists the ones a release has.
