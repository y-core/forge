---
title: The Asset Build Pipeline
description: "Turns a typed asset config into hashed, cache-busted static output plus a generated, fully-typed asset module."
audience: internal
---

# `@y-core/forge/tooling/assets`

The asset pipeline for `@y-core/forge` consumer projects — the namespace that turns a typed
`assets.config.ts` into hashed, cache-busted, production-ready static output plus a generated,
fully-typed asset module.

The pipeline bundles JavaScript with esbuild, compiles Tailwind CSS, assembles SVG sprite sheets,
downloads fonts, rasterises favicons and PWA icons, renders `robots.txt` and `sitemap.xml`, and
copies static files — then emits a `.forge/assets.ts` module mapping every logical asset name to its
content-hashed path. Consumer apps drive it through the `forge assets` command tree.

```ts
import { buildAll, defineAssetsConfig, loadConfig } from "@y-core/forge/tooling/assets";
```

> **Node.js / Bun only.** Everything here reads and writes the filesystem, spawns build tools, and
> fetches over the network. **Do not import it into a Cloudflare Worker or a client bundle.** The
> two request-time lookups the generated module calls live in
> [`@y-core/forge/assets`](../../assets/README.md), which imports no Node built-in at all.

See [`ASSET_PIPELINE.md`](../../../docs/ASSET_PIPELINE.md) §1
and §2 for the authoritative architecture.

---

## Features

- **Typed, validated config** — `defineAssetsConfig` supplies editor types; `loadConfig` imports
  `assets.config.ts`, validates it against `AssetsConfigSchema` (valibot), fills in path defaults,
  and resolves `env`/`flag` references.
- **JS bundling** — `buildJS` drives esbuild per entry, with `splitting`, `format`
  (`esm`/`cjs`/`iife`), `minify`, and `define` constant injection. JSX compiles against
  `@y-core/forge/jsx`.
- **Tailwind CSS** — `buildCSS` shells out to the `tailwindcss` CLI for each `css` build.
- **SVG sprite sheets** — `buildSprites` normalises and sanitises source SVGs into `<symbol>`
  entries inside a single hidden `<svg>`, preserving root presentation attributes on a wrapping
  `<g>` and emitting per-symbol `viewBox` metadata.
- **Favicon / PWA icons** — `buildIcons` rasterises a master SVG (via `sharp`) into SVG, PNG, ICO,
  and a web-app `manifest.json`.
- **Font downloads** — `buildFonts` fetches remote fonts into the public directory, cached on disk.
- **Robots and sitemap** — `buildSite` renders `robots.txt` and `sitemap.xml` into the asset-tree
  root from a [`@y-core/forge/site`](../../site/README.md) config, so a crawler costs the Worker no
  invocation.
- **Content hashing** — with `minify: true`, every emitted file gets an 8-char SHA-256 stem
  (`styles.abc12345.css`), and the `_headers` cache rule switches from `no-cache` to immutable.
- **Generated typed module** — `buildAll` writes `.forge/assets.ts` exporting an `assets` manifest
  plus a typed `*Icon` component per sprite group. `generateAssetsTypes` emits the same module from
  config alone, so a clean checkout can typecheck and test without running a build.
- **Path-containment safety** — `safeJoin` guards every config-supplied output path against escaping
  the asset root.
- **Incremental state** — `loadState`/`hasChanged`/`markBuilt`/`saveState` track per-file hashes for
  watch-mode skip logic.
- **A command tree, not a script you write** — `createAssetsCommands` builds the `forge assets`
  subtree the `forge` binary attaches; a consuming repository owns no binding file.

---

## Usage

### 1. Author the config

Create `assets.config.ts` at the project root and default-export the result of
`defineAssetsConfig`:

```ts
import { defineAssetsConfig, env, flag } from "@y-core/forge/tooling/assets";
import { forgeUiSpriteSources } from "@y-core/forge/ui/assets/build";

export default defineAssetsConfig({
  paths: { sourceDir: "src/static", publicDir: "public/assets", publicPrefix: "/assets" },
  css: [{ tool: "tailwindcss", input: "src/assets/tailwind.css", output: "styles.css" }],
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
  sprites: {
    ui: {
      target: "sprites/ui.svg",
      sources: [
        // forge's own UI glyphs (spinner, chevron-down, theme icons, …) — self-described,
        // so a forge upgrade adding icons never requires touching this list.
        ...forgeUiSpriteSources(),
        { path: "src/assets/svg/", files: ["arrow-right.svg", "close.svg"] },
      ],
    },
  },
  fonts: { downloads: [{ url: "https://fonts.example/inter.woff2", to: "fonts/inter.woff2" }] },
  icons: {
    src: "src/assets/favicon.svg",
    outDir: "public/assets/icons",
    lightColor: "#111827",
    darkColor: "#f9fafb",
    app: { name: "My App", shortName: "App", backgroundColor: "#ffffff" },
    outputs: [
      { kind: "svg", file: "favicon.svg" },
      { kind: "png", file: "icon-192.png", size: 192, manifest: true },
      { kind: "ico", file: "favicon.ico", sizes: [16, 32, 48] },
      { kind: "manifest", file: "manifest.json" },
    ],
  },
});
```

`defineAssetsConfig` is an identity-typed pass-through — it supplies authoring types but runs **no**
validation. Validation happens in `loadConfig`, which every command invokes.

### 2. Build from the CLI

```bash
forge assets build            # everything, and write .forge/assets.ts
forge assets build all        # the same run, named explicitly
forge assets build --minify   # production: minified + content-hashed filenames + _headers
```

### 3. Consume the generated module at runtime

`buildAll` writes `.forge/assets.ts`, aliased as `@assets` in consumer projects. Import the `assets`
manifest and resolve logical names to hashed public paths:

```ts
import { assets } from "@assets";

const cssHref = assets.path("styles.css"); // "/assets/styles.abc12345.css"
```

When the config declares sprite groups, the generated module also exports a typed icon component per
group (a `ui` group → `UiIcon`), bound to the sprite path and its `viewBox` metadata, plus the
glyph-name union that component accepts:

```ts
export type UiIconName = "spinner" | "chevron-down";
export const UiIcon = createIcon(assets.path("sprites/ui.svg"), UI_META, "icon-");
```

Pass the union wherever a component is generic over its glyph names — `Toolbar<MyActions,
UiIconName>`, `ToolbarDefinition<A, UiIconName>`.

---

## Core Components & APIs

### Config authoring

| Export | Signature | Purpose |
| --- | --- | --- |
| `defineAssetsConfig` | `(config: AssetsConfig) => AssetsConfig` | Identity pass-through that supplies authoring types |
| `env` | `(name: string) => EnvRef` | Marks a `define` value to resolve from the build env at `loadConfig` time |
| `flag` | `(name: string) => FlagRef` | Marks a `define` value as a boolean flag (`"true"`/`"1"` → `true`) |
| `loadConfig` | `(options: LoadConfigOptions) => Promise<ResolvedConfig>` | Imports, validates, and normalises the config file into a `ResolvedConfig` |
| `AssetsConfigSchema` | valibot schema | The schema `loadConfig` validates against |
| `SITE_OUTPUTS` | `readonly string[]` | The files a configured `site` block writes — `robots.txt`, `sitemap.xml` |

`LoadConfigOptions`:

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `root` | `string` | — | Directory a relative `configPath` resolves against. Required. |
| `configPath` | `string?` | `assets.config.ts` | The config module to import. |
| `env` | `Record<string, string \| undefined>?` | `{}` | Source for `env()` and `flag()` references in bundle `define`s. |

`loadConfig` fills the path defaults `sourceDir: "src/static"`, `publicDir: "public/assets"`,
`publicPrefix: "/assets"`, and returns a `ResolvedConfig` — `AssetsConfig` is the input shape,
`ResolvedConfig` the normalised output, with `icons`, `cursors` and `site` present as `null` when
unconfigured.

#### Config type reference

`AssetsConfig` (every top-level field optional):

| Field | Type | Notes |
| --- | --- | --- |
| `paths` | `PathsConfig` | `sourceDir`, `publicDir`, `publicPrefix` (all optional) |
| `js.bundles` | `JsBundle[]` | esbuild bundles |
| `css` | `CssBuild[]` | Tailwind builds |
| `copy` | `CopyEntry[]` | `{ from, to }` static copies |
| `rasters` | `RasterEntry[]` | `{ from, to, width?, height? }` SVG→PNG rasterizations |
| `sprites` | `Sprites` (`Record<string, SpriteGroup>`) | Keyed sprite groups |
| `fonts.downloads` | `FontDownload[]` | `{ url, to }` remote fonts |
| `icons` | `IconsConfig` | Favicon / PWA icon outputs |
| `cursors` | `CursorsConfig` | Baked CSS cursor values (see [Advanced](#advanced)) |
| `site` | `SiteBuildConfig` | `robots.txt` and `sitemap.xml` |

`JsBundle`:

| Field | Type | Notes |
| --- | --- | --- |
| `entry` | `string` | esbuild entry point (required) |
| `outdir` | `string` | Output subdirectory under `publicDir` (required) |
| `splitting` | `boolean?` | Enable code splitting |
| `format` | `"esm" \| "cjs" \| "iife"` (optional) | Output format; defaults to `esm` |
| `minify` | `boolean?` | Per-bundle minify (the `--minify` flag also applies globally) |
| `define` | `Record<string, DefineValue>?` | Compile-time constants; values may be literals, `env(...)`, or `flag(...)` |

`ResolvedJsBundle` is `JsBundle` with `define` already resolved to JavaScript source literals.

`CssBuild`: `{ tool: "tailwindcss"; input: string; output: string }`.
`CopyEntry`: `{ from: string; to: string }`.
`FontDownload`: `{ url: string; to: string }`.
`RasterEntry`: `{ from: string; to: string; width?: number; height?: number }` — see
[Rasters](#rasters).
`IconOutput` is a discriminated union on `kind`: `"svg"`, `"png"` (`size`, optional `manifest`),
`"ico"` (`sizes`), `"manifest"`.
`SiteBuildConfig`: `{ outDir: string; config: SiteConfig }` — `outDir` is the **asset-tree root**,
not `publicDir`, because `robots.txt` and `sitemap.xml` are only meaningful at the origin root.

`SpriteGroup`: `{ target: string; sources: SpriteSource[]; prefix?: string }`, where `SpriteSource`
is `{ path: string; files: (string | { key: string; file: string })[] }`. A bare filename takes its
basename as the symbol key; an explicit pair names the key itself. `prefix` defaults to `icon-`. A
`path` starting with `http://` or `https://` is fetched and cached; otherwise it is read from disk.

> **Standard pattern:** spread `...forgeUiSpriteSources()` (from `@y-core/forge/ui/assets/build`) as
> the first source of the group your components use. It returns absolute paths to every forge UI
> glyph, so consumers never hand-list `node_modules/@y-core/forge/...` paths — see the config
> example above and [src/ui/README.md](../../ui/README.md).

`CursorsConfig`:

| Field | Type | Notes |
| --- | --- | --- |
| `target` | `string` | Output CSS file path (relative to `publicDir`) |
| `css` | `string?` | The compiled CSS file whose custom-property declarations resolve tokens; defaults to the first `css` output |
| `themes` | `Record<string, string>` | Theme key → CSS selector, e.g. `{ light: ":root", dark: ".dark" }` |
| `sources` | `CursorSource[]` | Cursor source directories (see below) |
| `vars` | `Record<string, string \| Record<string, string>>?` | Build-time colour variables; a flat string applies to all themes, a nested record maps theme keys to values |

`CursorSource`:

| Field | Type | Notes |
| --- | --- | --- |
| `path` | `string` | Directory containing cursor SVG files |
| `files` | `(string \| { key: string; file: string })[]` | File list — bare strings use the stem as the cursor key |
| `template` | `{ path: string; file: string }` | SVG template wrapper applied to every cursor in this source |

### Pipeline functions

| Export | Signature | Purpose |
| --- | --- | --- |
| `buildAll` | `(config: ResolvedConfig, opts?: BuildOptions) => Promise<void>` | Runs the full pipeline and writes `.forge/assets.ts` |
| `generateAssetsTypes` | `(config: ResolvedConfig, opts?: { assetsPath?: string }) => Promise<void>` | Writes `.forge/assets.ts` from config alone — no build, no toolchain |
| `buildJS` | `(bundles: ResolvedJsBundle[], opts: { outDir; minify?; hash? }) => Promise<Record<string, string>>` | esbuild bundling; returns the logical→output mapping |
| `buildCSS` | `(cssBuild: CssBuild, opts: { outDir; minify?; hash? }) => Record<string, string>` | Tailwind build for one entry |
| `buildSprites` | `(sprites: Sprites, publicDir: string, opts?: { hash? }) => Promise<SpriteBuildResult>` | Assembles all sprite groups |
| `buildIcons` | `(config: IconsConfig) => Promise<void>` | Rasterises favicon/PWA icon outputs |
| `buildFonts` | `(fonts: { downloads: FontDownload[] }, publicDir: string) => Promise<void>` | Downloads remote fonts |
| `buildRasters` | `(rasters: RasterEntry[], publicDir: string) => Promise<void>` | Rasterises configured SVGs to PNG under `publicDir` |
| `buildSite` | `(config: SiteBuildConfig) => void` | Writes `robots.txt` and `sitemap.xml` into `config.outDir` |
| `copyAssets` | `(copies: CopyEntry[], publicDir: string) => void` | Copies static files |
| `fetchURL` | `(url: string, dest: string, opts?: { force? }) => Promise<void>` | Fetches a URL to disk; skips if `dest` exists unless `force` |
| `hashFile` | `(filePath: string) => string` | 8-char SHA-256 of a file's bytes |
| `hashString` | `(content: string) => string` | 8-char SHA-256 of a string |
| `safeJoin` | `(base: string, ...segments: string[]) => string` | Path join that throws if the result escapes `base` |
| `createAssetsCommands` | `() => CommandBase` | Builds the `forge assets` command tree |

`BuildOptions`: `{ minify?: boolean; assetsPath?: string }`. `assetsPath` defaults to
`.forge/assets.ts`. `minify` toggles both esbuild/Tailwind minification **and** content hashing
across the pipeline.

`buildAll` runs in dependency order: CSS → copy → rasters → sprites → fonts → icons → site →
cursors → write `.forge/assets.ts` → JS → rewrite `.forge/assets.ts` → `_headers`. **The module is
written twice on purpose**: esbuild resolves `@assets` while bundling, so the file has to exist
before `buildJS`, and the JS bundle's own hashed names only enter the manifest afterwards. A
regenerated pass whose content is byte-identical does not touch the file.

> **`_headers` is written wholesale.** It is emitted as a sibling of `publicDir`, carrying one
> `Cache-Control` rule for `paths.publicPrefix` (`/assets/*` by default), and the file is truncated
> on every build. `minify` decides only whether the value is `no-cache` or immutable. A header rule
> for any other path — including the generated `robots.txt` and `sitemap.xml` — cannot be added by a
> second writer.

> **Output-directory ownership.** `buildJS`, `buildCSS`, and `buildSprites` clean their target
> directory on every run — `buildJS` removes all non-hidden files plus `chunks/` in each `outdir`,
> `buildCSS` removes the non-hidden `.css` files matching its own entry's output stem, and sprite
> builds do the same for the group's `.svg` stem. Never place hand-authored files alongside
> generated output; they will be deleted.

### Sprite results and incremental state

`SpriteBuildResult`: `{ mapping: Record<string, string>; groups: Record<string, SpriteGroupResult> }`.
`SpriteGroupResult`: `{ spriteKey: string; meta: Record<string, string>; prefix: string }` —
`spriteKey` is the logical (unhashed) target, `meta` maps each symbol ID to its `viewBox`, and
`prefix` is the group's symbol-ID prefix.

Incremental state helpers operate over `BuildState` (`Record<string, string>` of key → hash):

| Export | Signature |
| --- | --- |
| `loadState` | `(statePath: string) => BuildState` |
| `saveState` | `(statePath: string, state: BuildState) => void` |
| `hasChanged` | `(state: BuildState, key: string, currentHash: string) => boolean` |
| `markBuilt` | `(state: BuildState, key: string, hash: string) => void` |

`loadState` returns `{}` for a missing or malformed file. `hasChanged` is `true` when the stored hash
differs from `currentHash`. A typical watch step: read the source, `hashFile` it, and if `hasChanged`
run the single relevant build function, then `markBuilt` + `saveState`.

---

## Integration Guide

### CLI commands

The `forge` binary attaches the `assets` subtree `createAssetsCommands` builds. Every command calls
`loadConfig` first, against the root it resolved.

| Command | Builds |
| --- | --- |
| `forge assets build` | Full pipeline + generated module (same as `all`) |
| `forge assets build all` | Full pipeline + generated module |
| `forge assets build css` | Tailwind CSS only |
| `forge assets build js` | esbuild bundles only |
| `forge assets build fonts` | Font downloads only |
| `forge assets build icons` | Favicon/PWA icons only |
| `forge assets build rasters` | Configured SVG→PNG rasters only |
| `forge assets sprites` | SVG sprite sheets only |
| `forge assets gen types` | Nothing — derives the generated module from config |

**The bare `build` is the union, not a narrower default.** Unlike a scope default, it runs
everything, so it can never silently do less than asked.

| Flag | Type | Applies to | Effect |
| --- | --- | --- | --- |
| `--minify` | boolean | `build`, `build all`, `build css/js`, `sprites` | Minify output; on `build`/`build all` and `sprites` it also enables content-hashed filenames |
| `--config` | string | every command | Path to `assets.config.ts` (default: `assets.config.ts` under the resolved root) |
| `--root` | string | every command | Application root; also read from `FORGE_APP_ROOT`, else derived from forge's install path |
| `--out` | string | `build`, `build all`, `gen types` | Output path for the generated assets module (default `.forge/assets.ts`) |

Pass `--help` (or `-h`) at any level for generated help, e.g. `forge assets build --help`.

### The generated module in typecheck and tests

`.forge/assets.ts` is a **build artifact**. It is not committed — its content hashes churn on every
change, and a committed copy would claim to be generated while going stale. Consumers alias it as
`@assets` in `tsconfig.json` and import it from server and client code alike.

That leaves a clean-checkout hole: on a fresh clone or a cold CI runner nothing has written the file
yet, so `@assets` does not resolve and **typecheck fails before any test runs**. Running the full
build first closes the hole, but pays with the entire toolchain — `tailwindcss`, `esbuild`,
optionally `sharp`, and the network for font and remote-sprite fetches — none of which affects
whether TypeScript compiles.

`forge assets gen types` is the cheap half. It derives the module from `assets.config.ts` alone:

```bash
forge assets gen types    # milliseconds; no tailwind, no esbuild, no sharp, no network
```

Everything carrying **type** information is config-derived and reproduced exactly:

| Reproduced from config | Needs a real build |
| --- | --- |
| every manifest key — `css[].output`, `<outdir>/<entry>.js`, `sprites.<group>.target` | every manifest value (the content hash) |
| every icon name — `basename(file, ".svg")` or the explicit `key`, plus the group `prefix` | each symbol's `viewBox`, scraped from the assembled sprite |
| sprite group → `*Icon` and `*IconName` export names, `publicPrefix`, cursor and theme keys | the baked cursor data-URIs |

So the emitted module is shape-identical to a real build — same exports, same `createIcon` calls,
and critically the same `*_META` literal keys, which are what give `createIcon` its icon-name union
and make passing an icon-less sprite to a component a compile error. Only the _values_ are
placeholders: paths are the unhashed logical names, and every `viewBox` is empty. That last choice
is deliberate — an empty `viewBox` renders visibly broken, so a types-only artifact that reaches a
browser fails loudly instead of quietly shipping mis-scaled icons.

Wire it as a precondition to the steps that only need the module to resolve, and keep the full build
for dev and deploy:

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

Both commands write the same path, but a build always wins over a types artifact: `gen types` keeps
an existing build artifact when it still fits the config, so running the gate after a build no longer
degrades the manifest to unhashed paths. It rewrites only when the shape no longer matches — a bundle
or a glyph added, a sprite target or prefix renamed — because that module no longer describes the
config. The command says which it did:

```text
✓ assets: wrote .forge/assets.ts (types only)
✓ assets: kept .forge/assets.ts — an existing build artifact already fits the config
```

Because the emitted paths are unhashed and the `viewBox` values are empty, **tests must never assert
an asset digest or a rendered `viewBox`**: those assertions pass under a full build and fail under
`gen types`, which couples a test to which command happened to run rather than to behaviour. Assert
the logical name instead.

### Programmatic builds

To run the pipeline outside the CLI, pair `loadConfig` with `buildAll`:

```ts
import { buildAll, loadConfig } from "@y-core/forge/tooling/assets";

const config = await loadConfig({ root: process.cwd(), configPath: "assets.config.ts", env: process.env });
await buildAll(config, { minify: true, assetsPath: "src/generated/assets.ts" });
```

### Optional dependencies

`buildIcons` and `buildRasters` dynamically import `sharp`, and `buildJS` dynamically imports
`esbuild` — each only when the relevant config section is present. Consumers without icons, rasters
or JS bundles never need those packages installed.

---

## Advanced

### Cursor authoring

A `cursors` block is baked by `buildCursors`, which lives in
[`@y-core/forge/ui/assets/build`](../../ui/README.md) — the pipeline calls it, and this namespace
owns only the config shape. It reads one or more source directories of cursor SVG files, bakes each
cursor for every configured theme, and returns a `CURSOR_BAKES` object the generated module
re-exports:

```text
Record<cursorKey, Record<themeKey, cssValue>>
```

Each `cssValue` is a complete CSS `cursor` property value:

```text
url("data:image/svg+xml,<encoded-svg>") <hx> <hy>, auto
```

**Template SVGs** act as the outer wrapper. They receive three structural placeholders injected at
bake time:

| Placeholder | Replaced with |
| --- | --- |
| `{{viewBox}}` | The cursor SVG's `viewBox` attribute value |
| `{{markup}}` | The cursor SVG's sanitized inner geometry |
| `{{signal}}` | Resolved hex for the cursor's `data-cursor-token` in the current theme |

`{{signal}}` is the only colour placeholder — it exists because the token _name_ varies per cursor
(each cursor SVG carries its own `data-cursor-token`). Every fixed colour in a template resolves
through `cssvar(--name)` instead, including theme tokens straight from the compiled CSS (a halo
layer writes `fill="cssvar(--background)"`).

Each source declares its own `template`, so a collection of filled arrow cursors and a collection of
thin snap-indicator cursors can use different wrappers.

**XML comments are stripped from bakes.** Comment freely in templates and cursor SVGs — comments
never reach the emitted data URI. Stripping happens before `cssvar()` resolution, so a commented-out
`cssvar(--x)` reference neither resolves nor throws. This also removes a footgun: a `--` inside a
comment — say, a token name — is ill-formed XML, and browsers silently drop the whole cursor image.

**`cssvar(--name)` resolver** — anywhere in a template, or in cursor markup injected via
`{{markup}}`, write `cssvar(--my-token)` to resolve a CSS custom property to its baked hex at build
time:

```svg
<rect fill="cssvar(--cursor-shadow)" />
```

`cssvar()` runs after `{{markup}}` substitution, so it resolves tokens authored inside cursor SVGs
too. The token must be resolvable from the theme's token map (CSS declarations plus the `vars`
overlay), otherwise the build **throws**. An unparseable-but-present colour value falls back to
`#000000`.

**Alpha** flows through the bake: when a resolved colour carries alpha — `rgb(0 0 0 / 0.28)`,
`rgba(…, 0.28)`, `oklch(L C H / a)`, or `#rrggbbaa` — `cssvar()` and `{{signal}}` bake an 8-digit
`#rrggbbaa` hex, so a single token carries both colour and opacity with no separate `fill-opacity`.
Opaque colours bake the shortest canonical form, 6-digit `#rrggbb`, since a trailing `ff` alpha byte
is redundant and only pads the data URI.

**`vars`** defines build-time colour variables in config rather than CSS. A flat string applies to
all themes; a nested record maps theme keys:

```ts
cursors: {
  vars: {
    "--cursor-outline": "#ffffff",                          // same in every theme
    "--cursor-shadow": { light: "rgb(0 0 0 / 0.28)", dark: "rgb(0 0 0 / 0.45)" }, // per-theme colour + alpha
  },
}
```

`vars` entries may reference existing CSS tokens via `var(--x)` — the resolver follows `var()` chains
just as CSS does. Config values win over CSS-declared values of the same name.

**`data-cursor-*` conventions** on the cursor SVG root `<svg>`:

| Attribute | Role |
| --- | --- |
| `data-cursor-token` | CSS custom property name for the signal colour (the `{{signal}}` slot) |
| `data-cursor-hotspot` | `"<x> <y>"` hotspot coordinates in the CSS `cursor` value |

Both are optional; omitting `data-cursor-token` leaves `{{signal}}` as `#000000`, and omitting
`data-cursor-hotspot` defaults to `0 0`. A token that _is_ declared but resolves to something the
colour parser cannot read throws, as a missing token does — a silent black cursor is not a usable
diagnostic.

### Sprite normalisation

`buildSprites` transforms every source SVG before it becomes a `<symbol>`:

1. **viewBox normalisation** — a non-zero-origin `viewBox` (e.g. `viewBox="4 4 16 16"`) is rewritten
   to `0 0 w h` and the inner content wrapped in a `<g>` carrying `transform="translate(-minX
-minY)"`, so `<use>` at `(0,0)` always lands inside the symbol's viewport.
2. **Root attribute preservation** — presentation attributes on the root `<svg>` (`fill`, `stroke`,
   `stroke-width`, `stroke-linecap`, `stroke-linejoin`) are emitted **once** on a wrapping `<g>`, in
   that order, so SVG's own inheritance resolves them: a child or a nested `<g>` setting its own
   `fill` still wins. When the viewBox also needs a translate, both live on the same wrapper; with
   neither a translate nor a root attribute, no wrapper is emitted. An attribute is read only at an
   attribute boundary, so `data-stroke="…"` on the root contributes no `stroke`.
3. **Symbol ID** — emitted as `<prefix><key>`, default `icon-arrow-right` for `arrow-right.svg`.

A source from which no inner content can be extracted is skipped.

### SVG sanitisation scope

Sprite sanitisation is **best-effort, defence-in-depth** for _trusted_ sources — the icon libraries
you reference in config. It strips `<script>`, `<foreignObject>`, `<style>`, SMIL `<animate>`/`<set>`
href retargeting, `javascript:` and `data:text/html` href schemes, and `on*` event-handler
attributes, whitespace around the `=` and any casing included. Root-`<svg>` event handlers are
already neutralised because the root tag is discarded. For **untrusted or user-supplied** SVGs, use a
full DOM-based sanitizer such as DOMPurify — this is not sufficient there. The production CSP
(`self`, nonce) remains the primary runtime control.

### Rasters

`rasters` turns configured SVGs into PNGs under `publicDir` — for the surfaces that cannot render a
vector, such as an email signature:

```ts
rasters: [{ from: "src/svg/logo-lockup.svg", to: "email/logo@2x.png", width: 630 }],
```

Give `width`, `height`, or both; an entry with neither is rejected by the schema. When only one is
set, the other is derived from the source's intrinsic ratio, so a non-square lockup is scaled rather
than squashed. Outputs are **not** content-hashed and never enter the manifest — same as `copy`,
because a URL pasted into a mail client has to stay stable. `buildRasters` does not substitute
`currentColor`, so give the source an explicit fill.

### Content hashing and cache busting

With hashing enabled, `buildCSS`/`buildJS`/`buildSprites` rename outputs to `<stem>.<8hex>.<ext>`
using `hashFile` — a truncated SHA-256 of the _emitted_ file, so the hash changes only when output
content does. The build manifest maps the logical name to the hashed relative path, and
`createManifest` resolves it at runtime. `buildAll` then writes `_headers` with
`Cache-Control: public, max-age=31536000, immutable` for `paths.publicPrefix`, normalised exactly as
`createManifest` normalises it, so the rule and the served URL cannot disagree.

### Path containment

`safeJoin` resolves `base` plus `segments` and throws if the result escapes `base`. It guards every
config-supplied **output** path — copy `to`, raster `to`, sprite `target`, font `to`, JS `outdir`.
Source **reads** (`from`, font `url`, remote sprite `source.path`) are intentionally unrestricted.

---

## See also

- [`@y-core/forge/assets`](../../assets/README.md) — the two request-time lookups the generated
  module calls, and the only asset code a Worker may import.
- [`@y-core/forge/tooling/cli`](../cli/README.md) — the command framework `createAssetsCommands`
  builds on, and `resolveAppRoot`.
- [`ASSET_PIPELINE.md`](../../../docs/ASSET_PIPELINE.md) §1, §2 and §4 — the config contract, the
  pipeline and its change detection, and the generated module with its ordered stages.
