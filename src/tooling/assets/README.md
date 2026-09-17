---
title: The Asset Build Pipeline
description: "Turns a typed asset config into hashed, cache-busted static output plus a generated, fully-typed asset module."
audience: internal
---

# `@y-core/forge/tooling/assets`

One config file names every asset your app ships. `forge assets build` turns it into hashed, cache-busted static output plus `.forge/assets.ts` —
a generated module that maps each logical name to the path it was actually written to, and gives each sprite group a typed icon component.

**Node.js / Bun only.** Everything here reads and writes the filesystem, spawns build tools and fetches over the network. Do not import it into a
Cloudflare Worker or a client bundle — the two request-time lookups the generated module calls live in [`@y-core/forge/assets`][assets-readme],
which imports no Node built-in at all.

```bash
forge assets build              # every stage, and write .forge/assets.ts
forge assets build --minify     # production: minified, content-hashed, immutable _headers
forge assets build css          # one stage alone
forge assets gen types          # the generated module from config alone — no toolchain, no network
```

The architecture, the stage order and the artifact contract are [`ASSET_PIPELINE.md`][ap-1]'s; this file teaches the use.

---

## Getting started

Write `assets.config.ts` at the project root, default-exporting `defineAssetsConfig`:

```ts
import { defineAssetsConfig } from "@y-core/forge/tooling/assets";

export default defineAssetsConfig({
  paths: { sourceDir: "src/static", publicDir: "public/assets", publicPrefix: "/assets" },
  css: [{ tool: "tailwindcss", input: "src/assets/tailwind.css", output: "styles.css" }],
  js: { bundles: [{ entry: "src/client/main.ts", outdir: "js" }] },
});
```

Build it, then read paths out of the generated module:

```bash
forge assets build --minify
```

```ts
import { assets } from "@assets";

const cssHref = assets.path("styles.css"); // "/assets/styles.abc12345.css"
```

`@assets` is a `tsconfig.json` path alias for `.forge/assets.ts`. That file is a build artifact — git-ignore it, and see
[Keeping typecheck and tests off the full build](#keeping-typecheck-and-tests-off-the-full-build) for the cheap way to make it resolve on a clean
checkout.

---

## Declaring what to build

Every top-level block is optional, and each one you add is a stage the build runs. `defineAssetsConfig` only supplies authoring types — it validates
nothing. `loadConfig` is what validates, and every command calls it, so a malformed config fails at the command rather than at the stage that
reads it.

| Block | Add it when you want |
| --- | --- |
| `css` | A Tailwind CLI build per entry |
| `js.bundles` | esbuild bundles, compiled with `@y-core/forge/jsx` as the JSX source |
| `sprites` | SVG sheets, plus a typed icon component per group |
| `icons` | Favicon, PWA icons and a web-app manifest rasterised from one master SVG |
| `fonts.downloads` | Remote fonts fetched into the public directory and cached on disk |
| `copy` | Static files copied verbatim |
| `rasters` | SVG-to-PNG output for a surface that cannot render a vector |
| `cursors` | CSS `cursor` values baked per theme |
| `site` | `robots.txt` and `sitemap.xml`, rendered from a [`@y-core/forge/site`][site-readme] config |

Choices worth making deliberately:

**`paths` decides the URL, not just the directory.** `publicDir` is where files land, `publicPrefix` is what the manifest prepends at runtime, and
the `_headers` cache rule is written for that same prefix. Leave them unset and you get `public/assets`, `/assets` and `src/static`.

**`site.outDir` is the asset-tree root, not `publicDir`.** `robots.txt` and `sitemap.xml` are only meaningful at the origin root, so that block
names its own directory. `icons.outDir` works the same way.

**A `define` value may be deferred to the build environment.** Write a literal for a constant that never varies, `env("NAME")` for a string read at
`loadConfig` time, and `flag("NAME")` for a boolean — `"true"` or `"1"` is `true`, anything else is `false`:

```ts
import { defineAssetsConfig, env, flag } from "@y-core/forge/tooling/assets";

export default defineAssetsConfig({
  js: {
    bundles: [
      {
        entry: "src/client/main.ts",
        outdir: "js",
        format: "esm",
        splitting: true,
        define: { "import.meta.env.DEBUG": flag("DEBUG"), "import.meta.env.API_URL": env("API_URL") },
      },
    ],
  },
});
```

An unset `env()` variable substitutes `undefined` rather than failing, so a bundle can branch on its absence.

---

## Running the build

```bash
forge assets build            # everything, and write .forge/assets.ts
forge assets build --minify   # production: minified, content-hashed, immutable _headers
```

| Command | Builds |
| --- | --- |
| `forge assets build` | The full pipeline and the generated module — identical to `build all` |
| `forge assets build all` | The same run, named explicitly |
| `forge assets build css` | Tailwind CSS only |
| `forge assets build js` | esbuild bundles only |
| `forge assets build fonts` | Font downloads only |
| `forge assets build icons` | Favicon and PWA icons only |
| `forge assets build rasters` | Configured SVG-to-PNG rasters only |
| `forge assets sprites` | SVG sprite sheets only |
| `forge assets gen types` | Nothing — derives the generated module from config alone |

**The bare `build` is the union, not a narrower default.** Unlike a scope default it runs everything, so it can never silently do less than asked.

| Flag | Type | Accepted by | Effect |
| --- | --- | --- | --- |
| `--minify` | boolean | `build`, `build all`, `build css`, `build js`, `sprites` | Minify output; on `build`, `build all` and `sprites` it also turns on content-hashed filenames |
| `--config` | string | every command | Path to the config module, relative to the resolved root (default `assets.config.ts`) |
| `--root` | string | every command | Application root; also read from `FORGE_APP_ROOT`, else derived from forge's install path |
| `--out` | string | `build`, `build all`, `gen types` | Where to write the generated module (default `.forge/assets.ts`) |

`--help` works at every level, e.g. `forge assets build --help`.

**Hashing is what `--minify` really switches.** Without it every emitted file keeps its logical name, the manifest maps each key to itself, and the
`_headers` rule is `no-cache`. With it each file gets an 8-character stem — `styles.abc12345.css` — and the rule becomes immutable. Use it for
production and leave it off in dev, where a stable filename is easier to reason about.

---

## Using the generated module

`.forge/assets.ts` exports an `assets` manifest, and one typed icon component plus a glyph-name union per sprite group. A group named `ui` yields
`UiIcon` and `UiIconName`:

```ts
import { assets, UiIcon, type UiIconName } from "@assets";

assets.path("sprites/ui.svg"); // the hashed public path
```

Pass the union wherever a component is generic over the glyph names it accepts — `Toolbar<MyActions, UiIconName>`. The union is what makes handing a
component a glyph its sprite does not carry a compile error, so prefer it over a bare `string`.

A configured `icons` block also exports `ICON_LINKS`, the head `<link>` set derived from `icons.outputs`. Rendering that array is how the files, the
markup and the Worker's bypass rules stay derived from one list.

---

## Keeping typecheck and tests off the full build

On a fresh clone nothing has written `.forge/assets.ts`, so `@assets` does not resolve and typecheck fails before a single test runs. A full build
closes the hole but pays with the whole toolchain — `tailwindcss`, `esbuild`, optionally `sharp`, and the network for font and remote-sprite
fetches — none of which decides whether TypeScript compiles.

`forge assets gen types` is the cheap half. Make it a precondition of the steps that only need the module to resolve, and keep the full build for
dev and deploy:

```json
{
  "scripts": {
    "build:assets": "forge assets build --minify",
    "dev:assets": "forge assets build",
    "typecheck": "forge assets gen types && tsc --noEmit",
    "test": "forge assets gen types && bun test"
  }
}
```

The emitted module is shape-identical to a real build — the same exports, the same `createIcon` calls, the same `*_META` keys and therefore the same
glyph unions. Only the values are placeholders: paths are unhashed logical names and every `viewBox` is empty
([`ASSET_PIPELINE.md`][ap-4b] §4b owns the contract).

Consequences to plan around:

- **A build always wins.** `gen types` keeps an existing build artifact that still fits the config, and rewrites only when the shape stops
  matching — a bundle or a glyph added, a sprite target or prefix renamed. The command prints which it did.
- **Never assert an asset digest or a rendered `viewBox` in a test.** Those assertions pass under a full build and fail under `gen types`, which
  ties the test to whichever command happened to run last. Assert the logical name instead.

---

## Building sprite sheets

A group names its target sheet and lists every file that goes into it. There is no glob — the symbol set is stated, so the generated glyph union
changes only when a human edits the list:

```ts
import { defineAssetsConfig } from "@y-core/forge/tooling/assets";
import { forgeUiSpriteSources } from "@y-core/forge/ui/assets/build";

export default defineAssetsConfig({
  sprites: {
    ui: {
      target: "sprites/ui.svg",
      sources: [...forgeUiSpriteSources(), { path: "src/assets/svg/", files: ["arrow-right.svg", { key: "x", file: "close.svg" }] }],
    },
  },
});
```

**Spread `forgeUiSpriteSources()` first in any group your forge components draw from.** It returns absolute paths to every forge UI glyph, so a
forge upgrade that adds icons never requires editing a hand-written `node_modules/` path — see [src/ui/README.md][ui-readme].

A bare filename takes its basename as the symbol key; a `{ key, file }` pair names the key itself. The symbol id is `<prefix><key>`, where `prefix`
defaults to `icon-`. A local `path` is read from disk, and a file the config names but disk does not have fails the build — the generated name union
comes from the config, so a skipped symbol would typecheck and render blank.

**A remote `path` is a supply-chain edge, so every file under one must pin its bytes**: `{ key, file, sha256 }`, with a full 64-character SHA-256. A
bare filename is refused under a remote source, the URL must be `https://`, and a digest that does not match what the host served fails the build
rather than being cached. The fetched bytes land in `node_modules/.cache/forge-assets/sprites`, named by digest — **never under `publicDir`**, which
a build deploys whole and `_headers` serves `immutable` for a year. Pass `cacheDir` to `buildSprites` to put them somewhere else.

```ts
sources: [{ path: "https://cdn.example.com/icons/", files: [{ key: "arrow", file: "arrow.svg", sha256: "9f64…806a" }] }];
```

A font download pins its bytes the same way, under the same rules:

```ts
fonts: { downloads: [{ url: "https://fonts.example.com/inter.woff2", to: "fonts/inter.woff2", sha256: "06df…c9b3" }] }
```

Each source SVG is normalised on the way in, which is why an icon set authored at mixed origins still lines up: a non-zero `viewBox` origin is
rewritten to `0 0 w h` with a compensating `translate`, and root presentation attributes (`fill`, `stroke`, `stroke-width`, `stroke-linecap`,
`stroke-linejoin`) move to a single wrapping `<g>` so ordinary SVG inheritance lets a child override them. An attribute is read only at an attribute
boundary, so `data-stroke="…"` on the root contributes no `stroke`.

### Choosing which SVGs to trust

Sanitisation here **tokenizes the markup and re-serializes what an allowlist admits**, rather than deleting matches from a string — so a construct
the tokenizer does not recognise is dropped rather than carried through. It drops `<script>`, `<style>` and `<foreignObject>` with everything inside
them, terminated or not; every `on*` handler attribute in any casing and with whitespace around the `=`; every URL-valued attribute whose scheme
resolves to `javascript:` or `data:text/html` once character references and control characters are undone; and every SMIL `<animate>`/`<set>` whose
`attributeName` is outside a fixed presentation-and-geometry list. `/` counts as an attribute separator, exactly as the HTML tokenizer counts it, so
`<circle r="5"/onload="…">` carries two attributes and loses the second. Root-`<svg>` handlers are gone anyway, because the root tag is discarded.

**For untrusted or user-supplied SVGs this is still not sufficient.** Run a full DOM-based sanitizer such as DOMPurify before the file reaches the
config. The production CSP remains the primary runtime control.

---

## Placing favicons and PWA icons

One master SVG produces every icon output. The choice that matters is where they land:

```ts
icons: {
  src: "src/assets/favicon.svg",
  outDir: "public",
  publicPrefix: "/static",
  lightColor: "#111827",
  darkColor: "#f9fafb",
  app: { name: "My App", shortName: "App", backgroundColor: "#ffffff" },
  outputs: [
    { kind: "svg", file: "favicon.svg" },
    { kind: "png", file: "apple-touch-icon.png", size: 180, rel: "apple-touch-icon" },
    { kind: "png", file: "icon-192.png", size: 192, manifest: true },
    { kind: "ico", file: "favicon.ico", sizes: [16, 32, 48], root: true },
    { kind: "manifest", file: "manifest.json" },
  ],
}
```

**`publicPrefix` buys you one Worker rule instead of one per filename**, which is why it is worth setting even for three icons:

```jsonc
"run_worker_first": ["/*", "!/static/*", "!/favicon.ico"]
```

**`root: true` pins one output to the asset root, and `favicon.ico` is the one that needs it.** A browser probes `/favicon.ico` whenever there is no
HTML head to read — a PDF, an image, a JSON response, a download tab, a platform-generated error page — as do unfurlers and feed readers that never
parse HTML. Safari probes `/apple-touch-icon.png` on the same condition. Everything else is reached only through a tag you emit, so its path is
yours to choose.

A `png` earns a head `<link>` only when it declares a `rel`; one marked `manifest: true` is already declared by the web-app manifest. `sharp` is
loaded only when a `png` or `ico` output is configured, so an icon set of `svg` and `manifest` alone needs no optional peer at all.

---

## Baking themed cursors

A `cursors` block turns a directory of cursor SVGs into a `CURSOR_BAKES` export on the generated module —
`Record<cursorKey, Record<themeKey, cssValue>>`, where each value is a complete CSS `cursor` property:

```text
url("data:image/svg+xml,<encoded-svg>") <hx> <hy>, auto
```

Each source declares its own template SVG, so filled arrow cursors and thin snap-indicator cursors can use different wrappers. A template is the
outer wrapper and receives three placeholders:

| Placeholder | Replaced with |
| --- | --- |
| `{{viewBox}}` | The cursor SVG's `viewBox` value |
| `{{markup}}` | The cursor SVG's sanitized inner geometry |
| `{{signal}}` | The resolved hex for that cursor's `data-cursor-token` in the theme being baked |

`{{signal}}` is the only colour placeholder, because the token _name_ varies per cursor. Every fixed colour in a template is written as
`cssvar(--name)` instead, which resolves against the theme's tokens — the compiled stylesheet's custom properties plus the `vars` overlay — and is
baked to a hex literal. A token that is missing, or present but unparseable as a colour, **throws**; a silent black cursor is not a usable
diagnostic.

`data-cursor-token` and `data-cursor-hotspot` on the cursor SVG's root `<svg>` drive the bake: the token names the custom property `{{signal}}`
resolves, and the hotspot carries `"<x> <y>"`. Both are optional — without a token `{{signal}}` bakes `#000000`, and without a hotspot the cursor
anchors at `0 0`.

**Declare a colour in `vars` when it is a cursor-only value**, and in CSS when the theme already owns it. A flat string applies to every theme, a
nested record maps theme keys, a `var(--x)` reference is followed as CSS would follow it, and a config value wins over a CSS-declared one of the
same name:

```ts
cursors: {
  vars: {
    "--cursor-outline": "#ffffff",
    "--cursor-shadow": { light: "rgb(0 0 0 / 0.28)", dark: "rgb(0 0 0 / 0.45)" },
  },
}
```

Alpha survives the bake: a resolved colour carrying alpha — `rgb(0 0 0 / 0.28)`, `rgba(…, 0.28)`, `oklch(L C H / a)` or `#rrggbbaa` — becomes an
8-digit hex, so one token carries colour and opacity with no separate `fill-opacity`. An opaque colour bakes to 6 digits.

Comment freely in templates and cursor SVGs: XML comments are stripped before `cssvar()` resolution, so they never reach the data URI and a
commented-out `cssvar(--x)` neither resolves nor throws. That also disarms a footgun — a `--` inside a comment is ill-formed XML, and browsers drop
the whole cursor image without a word.

---

## Rasterising an SVG for a surface that cannot render one

`rasters` is for the places a vector will not do, such as an email signature:

```ts
rasters: [{ from: "src/svg/logo-lockup.svg", to: "email/logo@2x.png", width: 630 }],
```

Give `width`, `height`, or both; an entry with neither is rejected by the schema. Set one and the other follows the source's intrinsic ratio, so a
non-square lockup scales rather than squashes. Raster outputs are **not** content-hashed and never enter the manifest — like `copy`, because a URL
pasted into a mail client has to keep working. `currentColor` is not substituted, so give the source an explicit fill.

---

## Driving the pipeline from your own code

Pair `loadConfig` with `buildAll` to run the pipeline outside the CLI:

```ts
import { buildAll, loadConfig } from "@y-core/forge/tooling/assets";

const config = await loadConfig({ root: process.cwd(), configPath: "assets.config.ts", env: process.env });
await buildAll(config, { minify: true, assetsPath: "src/generated/assets.ts" });
```

`root` is required and `configPath` resolves against it; `env` is the source `env()` and `flag()` read, and defaults to nothing at all rather than
to `process.env`, so a caller states what the build may see.

**Every path the config reads from comes back absolute, and every path it writes to comes back relative.** A CSS `input`, a bundle `entry`, a copy
or raster `from`, and a local sprite or cursor source are resolved against `root`, so a build run from a subdirectory reads the tree `--root` names
rather than its own working directory; an already-absolute path — what `forgeUiSpriteSources()` returns — and a remote sprite source are left alone.
A `to`, an `output`, an `outdir` and a sprite `target` stay relative because each is a manifest key that `safeJoin` contains under the asset root at
build time.

Each stage is also exported on its own — `buildCSS`, `buildJS`, `buildSprites`, `buildIcons`, `buildFonts`, `buildRasters`, `buildSite`,
`copyAssets` — and each takes its own slice of the config plus an output directory rather than the whole config
([`ASSET_PIPELINE.md`][ap-2a] §2a). `createAssetsCommands` returns the `forge assets` subtree, for registering inside a CLI of your own.

For a watch loop, `hashFile` plus `loadState`/`hasChanged`/`markBuilt`/`saveState` track per-file hashes against a state file **you** name. Nothing
in the pipeline calls them and forge writes no build state of its own ([`ASSET_PIPELINE.md`][ap-2b] §2b).

---

## Gotchas

**Generated directories are cleaned on every run.** `buildJS` removes every non-hidden file plus `chunks/` in each `outdir`; `buildCSS` and
`buildSprites` remove the non-hidden files matching their own output stem. Never keep a hand-authored file alongside generated output — it will be
deleted.

**`_headers` is written wholesale.** It is emitted as a sibling of `publicDir` with one rule for `paths.publicPrefix` and one per icon output, and
the file is truncated on every build. A second writer cannot add a rule to it, including for the generated `robots.txt` and `sitemap.xml`. Icons are
revalidated rather than pinned, because their filenames are not content-hashed; the web-app manifest is `must-revalidate`, because it is how an
installed app learns its name, colours or icon set changed.

**The generated module is written twice per build, on purpose.** esbuild resolves `@assets` while bundling, so the file must exist before `buildJS`
runs, and the JS bundle's own hashed names only enter the manifest afterwards. A pass whose content is byte-identical does not touch the file.

**A missing optional peer fails with a sentence, not a resolution stack trace.** `sharp` and `esbuild` are imported only when the config asks for
what they do, and the error names the config key that demanded the package, the package, and the command that installs it:

```text
[forge-assets] icons.outputs asks for a rasterized PNG, which needs the optional peer "sharp". Install it: bun add -d sharp
```

**Output paths are contained; local source paths are not.** `safeJoin` throws if a config-supplied output path — a copy or raster `to`, a sprite
`target`, a font `to`, a JS `outdir` — resolves outside the asset root. A local read is deliberately unrestricted: `from`, or a sprite source on
disk. **A remote read is not**: a font `url` and a remote sprite source must be `https://`, must pin a full SHA-256, and are re-verified on every
build rather than trusted because a file of that name is already cached.

---

## See also

- [`@y-core/forge/assets`][assets-readme] — the two request-time lookups the generated module calls, and the only asset code a Worker may import
- [`@y-core/forge/tooling/cli`][cli-readme] — the command framework `createAssetsCommands` builds on
- [`src/ui/README.md`][ui-readme] — `forgeUiSpriteSources`, `buildCursors` and the rest of the compute half this namespace orchestrates
- [`ASSET_PIPELINE.md`][ap-1] §1, §2 and §4 — the config contract, the pipeline and its change detection, and the generated module's ordered stages

[ap-1]: ../../../docs/ASSET_PIPELINE.md#1-assets-config
[ap-2a]: ../../../docs/ASSET_PIPELINE.md#2a-build-functions--orchestration
[ap-2b]: ../../../docs/ASSET_PIPELINE.md#2b-hash-and-change-detection
[ap-4b]: ../../../docs/ASSET_PIPELINE.md#4b-build-and-types-artifacts-are-shape-identical
[assets-readme]: ../../assets/README.md
[cli-readme]: ../cli/README.md
[site-readme]: ../../site/README.md
[ui-readme]: ../../ui/README.md
