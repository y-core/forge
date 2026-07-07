# `@y-core/forge/assets`

Asset pipeline for `@y-core/forge` consumer projects — the namespace family that turns a typed `assets.config.ts` into hashed, cache-busted, production-ready static output plus a generated, fully-typed asset module.

The pipeline bundles JavaScript with esbuild, compiles Tailwind CSS, assembles SVG sprite sheets, downloads fonts, rasterises favicons/PWA icons, and copies static files — then emits a `.forge/assets.ts` module that maps every logical asset name to its content-hashed path. Consumer apps drive it through the `forge-assets` CLI binary; library code consumes the runtime helpers (`createManifest`, `createSpriteRegistry`) at request time.

The namespace splits into three import paths plus one CLI binary:

| Import path | Source | Role |
|---|---|---|
| `@y-core/forge/assets` | `src/assets/mod.ts` | Config authoring + types for consumer apps (`defineAssetsConfig`, `env`, `flag`, `loadConfig`) |
| `@y-core/forge/assets/build` | `src/assets/build/mod.ts` | Build pipeline functions (`buildAll`, `buildJS`, `buildCSS`, `buildSprites`, …) |
| `@y-core/forge/assets/manifest` | `src/assets/manifest/mod.ts` | Runtime manifest + sprite lookups (`createManifest`, `createSpriteRegistry`) |
| `forge-assets` (bin) | `src/assets/cli/bin.ts` | CLI wrapper around the build pipeline |

See [`.decisions/ASSET_AND_BUILD_TOOLING.md`](../../.decisions/ASSET_AND_BUILD_TOOLING.md) for the authoritative architecture.

---

## Features

- **Typed, validated config** — `defineAssetsConfig` provides editor types; `loadConfig` parses and validates `assets.config.ts` against `AssetsConfigSchema` (valibot), filling in defaults and resolving `env`/`flag` references.
- **JS bundling** — `buildJS` drives esbuild per entry, with `splitting`, `format` (`esm`/`cjs`/`iife`), `minify`, and `define` constant injection. JSX compiles automatically against `@y-core/forge/jsx`.
- **Tailwind CSS** — `buildCSS` shells out to the `tailwindcss` CLI for each `css` build.
- **SVG sprite sheets** — `buildSprites` normalises and sanitises source SVGs into `<symbol>` entries inside a single hidden `<svg>`, propagating root presentation attributes and emitting per-symbol `viewBox` metadata.
- **Favicon / PWA icons** — `buildIcons` rasterises a master SVG (via `sharp`) into SVG, PNG, ICO, and a web-app `manifest.json`.
- **Font downloads** — `buildFonts` fetches remote fonts into the public directory with on-disk caching.
- **Content hashing** — with `minify: true`, every emitted file gets an 8-char SHA-256 stem (`styles.abc12345.css`) and an immutable `_headers` cache rule is written.
- **Generated typed module** — `buildAll` writes `.forge/assets.ts` exporting an `assets` manifest plus per-sprite-group typed `*Icon` components.
- **Path-containment safety** — `safeJoin` guards every config-supplied output path against escaping the asset root.
- **Incremental state** — `loadState`/`hasChanged`/`markBuilt`/`saveState` track per-file hashes for watch-mode skip logic.

---

## Usage

### 1. Author the config

Create `assets.config.ts` at the project root and export the result of `defineAssetsConfig` as default:

```ts
import { defineAssetsConfig, env, flag } from "@y-core/forge/assets";
import { forgeUiSpriteSources } from "@y-core/forge/ui/assets";

export default defineAssetsConfig({
  paths: {
    sourceDir: "src/static",
    publicDir: "public/assets",
    publicPrefix: "/assets",
  },
  css: [{ tool: "tailwindcss", input: "src/assets/tailwind.css", output: "styles.css" }],
  js: {
    bundles: [
      {
        entry: "src/client/main.ts",
        outdir: "js",
        format: "esm",
        splitting: true,
        define: {
          "import.meta.env.DEBUG": flag("DEBUG"),
          "import.meta.env.API_URL": env("API_URL"),
        },
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
  fonts: {
    downloads: [{ url: "https://fonts.example/inter.woff2", to: "fonts/inter.woff2" }],
  },
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

`defineAssetsConfig` is an identity-typed pass-through — it provides authoring types but does **not** run validation. Validation happens in `loadConfig`, which the CLI invokes.

### 2. Build from the CLI

```bash
# Build everything and write .forge/assets.ts
forge-assets build all

# Production build: minified + content-hashed filenames + _headers
forge-assets build all --minify
```

### 3. Consume the generated module at runtime

`buildAll` writes `.forge/assets.ts` (aliased as `@assets` in consumer projects). Import the `assets` manifest and resolve logical names to hashed public paths:

```ts
import { assets } from "@assets";

const cssHref = assets.path("styles.css"); // "/assets/styles.abc12345.css"
```

When the config has sprite groups, the generated module also exports a typed icon component per group (e.g. a `ui` group → `UiIcon`), bound to the sprite path and its `viewBox` metadata.

---

## Core Components & APIs

### `@y-core/forge/assets` — config authoring

| Export | Signature | Purpose |
|---|---|---|
| `defineAssetsConfig` | `(config: AssetsConfig) => AssetsConfig` | Identity pass-through that supplies authoring types |
| `env` | `(name: string) => EnvRef` | Marks a `define` value to resolve from the build env at `loadConfig` time |
| `flag` | `(name: string) => FlagRef` | Marks a `define` value as a boolean flag (`"true"`/`"1"` → `true`) |
| `loadConfig` | `(configPath?: string, env?: Record<string, string \| undefined>) => Promise<ResolvedConfig>` | Imports, validates, and normalises the config file into a `ResolvedConfig` |
| `AssetsConfigSchema` | valibot schema | The schema `loadConfig` validates against |

`loadConfig` defaults `configPath` to `assets.config.ts` (resolved from `process.cwd()`) and fills path defaults: `sourceDir: "src/static"`, `publicDir: "public/assets"`, `publicPrefix: "/assets"`. It resolves `env()`/`flag()` references in each bundle's `define` map against the supplied `env` argument and returns a `ResolvedConfig` (note: `AssetsConfig` is the input shape; `ResolvedConfig` is the normalised output shape).

#### Config type reference

`AssetsConfig` (all top-level fields optional):

| Field | Type | Notes |
|---|---|---|
| `paths` | `PathsConfig` | `sourceDir`, `publicDir`, `publicPrefix` (all optional) |
| `js.bundles` | `JsBundle[]` | esbuild bundles |
| `css` | `CssBuild[]` | Tailwind builds |
| `copy` | `CopyEntry[]` | `{ from, to }` static copies |
| `sprites` | `Sprites` (`Record<string, SpriteGroup>`) | Keyed sprite groups |
| `fonts.downloads` | `FontDownload[]` | `{ url, to }` remote fonts |
| `icons` | `IconsConfig` | Favicon / PWA icon outputs |

`JsBundle`:

| Field | Type | Notes |
|---|---|---|
| `entry` | `string` | esbuild entry point (required) |
| `outdir` | `string` | Output subdirectory under `publicDir` (required) |
| `splitting` | `boolean?` | Enable code splitting |
| `format` | `"esm" \| "cjs" \| "iife"` (optional) | Output format; defaults to `esm` |
| `minify` | `boolean?` | Per-bundle minify (CLI `--minify` also applies globally) |
| `define` | `Record<string, DefineValue>?` | Compile-time constants; values may be literals, `env(...)`, or `flag(...)` |

`CssBuild`: `{ tool: "tailwindcss"; input: string; output: string }`.
`CopyEntry`: `{ from: string; to: string }`.
`SpriteGroup`: `{ target: string; sources: SpriteSource[] }`, where `SpriteSource` is `{ path: string; files: string[] }`. A `path` starting with `http://` / `https://` is fetched and cached; otherwise it is read from disk.

> **Standard pattern:** spread `...forgeUiSpriteSources()` (from `@y-core/forge/ui/assets`) as the first source of the group your components use. It returns absolute paths to all forge UI glyphs, so consumers never hand-list `node_modules/@y-core/forge/...` paths — see the config example above and [src/ui/README.md](../ui/README.md).
`FontDownload`: `{ url: string; to: string }`.
`IconOutput` is a discriminated union on `kind`: `"svg"`, `"png"` (`size`, optional `manifest`), `"ico"` (`sizes`), `"manifest"`.

`CursorsConfig`:

| Field | Type | Notes |
|---|---|---|
| `target` | `string` | Output CSS file path (relative to `publicDir`) |
| `template` | `{ path: string; file: string }` | Global SVG template (used when a source has no per-source override) |
| `haloToken` | `string?` | CSS custom property for the outer halo colour; default `--background` |
| `css` | `string?` | Path to the compiled CSS file whose custom-property declarations are used for token resolution |
| `themes` | `Record<string, string>` | Map of theme key → CSS selector, e.g. `{ light: ":root", dark: ".dark" }` |
| `sources` | `CursorSource[]` | Cursor source directories (see below) |
| `vars` | `Record<string, string \| Record<string, string>>?` | Build-time color variables; a flat string applies to all themes, a nested record maps theme keys to values |

`CursorSource`:

| Field | Type | Notes |
|---|---|---|
| `path` | `string` | Directory containing cursor SVG files |
| `files` | `(string \| { key: string; file: string })[]` | File list — bare strings use the stem as the cursor key |
| `template` | `{ path: string; file: string }?` | Per-source template override; falls back to `CursorsConfig.template` when absent |

### `@y-core/forge/assets/build` — pipeline functions

| Export | Signature | Purpose |
|---|---|---|
| `buildAll` | `(config: ResolvedConfig, opts?: BuildOptions) => Promise<void>` | Runs the full pipeline and writes `.forge/assets.ts` |
| `buildJS` | `(bundles: ResolvedJsBundle[], opts: { outDir; minify?; hash? }) => Promise<Record<string, string>>` | esbuild bundling; returns logical→output mapping |
| `buildCSS` | `(cssBuild: CssBuild, opts: { outDir; minify?; hash? }) => Record<string, string>` | Tailwind build for one entry |
| `buildSprites` | `(sprites: Sprites, publicDir: string, opts?: { hash? }) => Promise<SpriteBuildResult>` | Assembles all sprite groups |
| `buildCursors` | `(config: CursorsConfig, cssText: string) => Record<string, Record<string, string>>` | Bakes cursor data-URIs per cursor × theme |
| `buildIcons` | `(config: IconsConfig) => Promise<void>` | Rasterises favicon/PWA icon outputs |
| `buildFonts` | `(fonts: { downloads: FontDownload[] }, publicDir: string) => Promise<void>` | Downloads remote fonts |
| `copyAssets` | `(copies: CopyEntry[], publicDir: string) => void` | Copies static files |
| `fetchURL` | `(url: string, dest: string, opts?: { force? }) => Promise<void>` | Fetches a URL to disk; skips if `dest` exists unless `force` |
| `hashFile` | `(filePath: string) => string` | 8-char SHA-256 of a file's bytes |
| `hashString` | `(content: string) => string` | 8-char SHA-256 of a string |
| `safeJoin` | `(base: string, ...segments: string[]) => string` | Path join that throws if the result escapes `base` |
| `svgToSymbol` | `(svgContent: string, filename: string) => string \| null` | Converts one SVG into a `<symbol>` entry |
| `extractViewBoxes` | `(spriteContent: string) => Record<string, string>` | Maps symbol IDs to `viewBox` strings |
| `sanitizeSVG` | `(content: string) => string` | Strips scripts/handlers/dangerous URIs from SVG inner content |

`BuildOptions`: `{ minify?: boolean; assetsPath?: string }`. `assetsPath` defaults to `.forge/assets.ts`. `minify` toggles both esbuild/Tailwind minification **and** content hashing across the pipeline.

`buildAll` runs in dependency order: CSS → JS → copy → sprites → fonts → icons → generate `.forge/assets.ts`. When `minify` is set it additionally writes a `_headers` file (sibling of `publicDir`) with an immutable `Cache-Control` rule for `/assets/*`.

> **Output-directory ownership.** `buildJS`, `buildCSS`, and `buildSprites` clean their target directory on every run — `buildJS` removes all non-hidden files plus `chunks/` in each `outdir`, `buildCSS` removes all `.css` files in the output directory, and sprite builds remove all non-hidden `.svg` files. Never place hand-authored files alongside generated output; they will be deleted.

### `@y-core/forge/assets/build` — sprite results & incremental state

`SpriteBuildResult`: `{ mapping: Record<string, string>; groups: Record<string, SpriteGroupResult> }`.
`SpriteGroupResult`: `{ spriteKey: string; meta: Record<string, string> }` — `spriteKey` is the logical (unhashed) target; `meta` maps each symbol ID to its `viewBox`.

Incremental state helpers operate over `BuildState` (`Record<string, string>` of key → hash):

| Export | Signature |
|---|---|
| `loadState` | `(statePath: string) => BuildState` |
| `saveState` | `(statePath: string, state: BuildState) => void` |
| `hasChanged` | `(state: BuildState, key: string, currentHash: string) => boolean` |
| `markBuilt` | `(state: BuildState, key: string, hash: string) => void` |

`loadState` returns `{}` for a missing or malformed file. `hasChanged` is `true` when the stored hash differs from `currentHash`. A typical watch step: read the source, `hashFile` it, and if `hasChanged` run the single relevant build function, then `markBuilt` + `saveState`.

### `@y-core/forge/assets/manifest` — runtime lookups

| Export | Signature | Purpose |
|---|---|---|
| `createManifest` | `(data: Record<string, string>, prefix: string) => Manifest` | Builds a logical-name → public-path resolver |
| `createSpriteRegistry` | `(sprites: Record<string, string>, manifest: Manifest) => SpriteRegistry` | Resolves sprite group names to public sprite paths |

`Manifest` exposes `path(key: string): string`. It strips a leading `/` from the key, looks it up in `data`, falls back to the key itself when unmapped, and prefixes with `prefix` (trailing slash normalised). The generated `.forge/assets.ts` calls `createManifest` with the build-emitted mapping and `config.paths.publicPrefix`:

```ts
import { createManifest } from "@y-core/forge/assets/manifest";

const assets = createManifest({ "styles.css": "styles.abc12345.css" }, "/assets");
assets.path("styles.css");  // "/assets/styles.abc12345.css"
assets.path("unknown.png"); // "/assets/unknown.png" (pass-through fallback)
```

`SpriteRegistry` exposes `get(name: string): string` and **throws** `Unknown sprite group: "<name>"` for an unregistered name. It resolves through the supplied `Manifest`, so the returned path is fully prefixed and hash-aware.

---

## Integration Guide

### CLI commands

The `forge-assets` binary (`src/assets/cli/bin.ts`) exposes a nested command tree built on `@y-core/forge/cli`. Every command calls `loadConfig(flags.config, process.env)` first.

| Command | Builds | Flags |
|---|---|---|
| `forge-assets build all` | Full pipeline + generated module | `--minify`, `--config <path>`, `--out <path>` |
| `forge-assets build css` | Tailwind CSS only | `--minify`, `--config <path>` |
| `forge-assets build js` | esbuild bundles only | `--minify`, `--config <path>` |
| `forge-assets build fonts` | Font downloads only | `--config <path>` |
| `forge-assets build icons` | Favicon/PWA icons only | `--config <path>` |
| `forge-assets sprites` | SVG sprite sheets only | `--minify`, `--config <path>` |

Flag notes:

| Flag | Type | Effect |
|---|---|---|
| `--minify` | boolean | Minify output; on `build all` and `sprites` it also enables content-hashed filenames |
| `--config` | string | Path to `assets.config.ts` (default: resolved from cwd) |
| `--out` | string | Output path for the generated assets module (`build all` only; default `.forge/assets.ts`) |

Pass `--help` (or `-h`) at any level for generated help, e.g. `forge-assets build --help`.

### `package.json` wiring

```json
{
  "scripts": {
    "build:assets": "forge-assets build all --minify",
    "dev:assets": "forge-assets build all"
  }
}
```

### Serving the manifest in a Worker

Resolve the generated `assets` manifest once and thread it to views so templates reference logical names while the Worker serves hashed paths:

```ts
import { assets } from "@assets";

// In an SSR view:
<link rel="stylesheet" href={assets.path("styles.css")} />
```

---

## Advanced

### Cursor authoring

`buildCursors` reads one or more source directories of cursor SVG files, bakes each cursor for every configured theme, and returns a `CURSOR_BAKES` object:

```
Record<cursorKey, Record<themeKey, cssValue>>
```

Each `cssValue` is a complete CSS `cursor` property value:

```
url("data:image/svg+xml,<encoded-svg>") <hx> <hy>, auto
```

**Template SVGs** act as the outer wrapper. They receive four structural placeholders injected at bake time:

| Placeholder | Replaced with |
|---|---|
| `{{viewBox}}` | The cursor SVG's `viewBox` attribute value |
| `{{markup}}` | The cursor SVG's sanitized inner geometry |
| `{{halo}}` | Resolved hex for `haloToken` in the current theme |
| `{{signal}}` | Resolved hex for the cursor's `data-cursor-token` in the current theme |

A single global `template` is required. Individual `sources` may specify their own `template` to override it — useful when filled arrow cursors and thin snap-indicator cursors want different wrappers.

**`cssvar(--name)` resolver** — anywhere in a template (or in cursor markup that gets injected via `{{markup}}`), write `cssvar(--my-token)` to resolve a CSS custom property to its baked hex at build time:

```svg
<rect fill="cssvar(--cursor-shadow)" />
```

`cssvar()` runs after `{{markup}}` substitution, so it resolves tokens authored inside cursor SVGs too. The token must be resolvable from the theme's token map (CSS declarations + `vars` overlay), otherwise the build **throws**. An unparseable-but-present colour value falls back to `#000000`.

**Alpha** flows through the bake: when a resolved colour carries alpha — `rgb(0 0 0 / 0.28)`, `rgba(…, 0.28)`, `oklch(L C H / a)`, or `#rrggbbaa` — `cssvar()`, `{{halo}}`, and `{{signal}}` all bake an 8-digit `#rrggbbaa` hex, so a single token can carry both colour and opacity (no separate `fill-opacity` needed). `toHex` emits the shortest canonical form: opaque colours bake 6-digit `#rrggbb`, since a trailing `ff` alpha byte is redundant and only pads the data URI.

**`vars`** lets you define build-time colour variables in config rather than CSS. A flat string applies to all themes; a nested record maps theme keys:

```ts
cursors: {
  vars: {
    "--cursor-outline": "#ffffff",                          // same in every theme
    "--cursor-shadow": { light: "rgb(0 0 0 / 0.28)", dark: "rgb(0 0 0 / 0.45)" }, // per-theme colour + alpha
  },
}
```

`vars` entries can reference existing CSS tokens via `var(--x)` — the resolver follows `var()` chains just like CSS. Config values win over CSS-declared values of the same name.

**`data-cursor-*` conventions** on the cursor SVG root `<svg>`:

| Attribute | Role |
|---|---|
| `data-cursor-token` | CSS custom property name for the signal colour (the `{{signal}}` slot) |
| `data-cursor-hotspot` | `"<x> <y>"` hotspot coordinates in the CSS `cursor` value |

Both are optional; omitting `data-cursor-token` leaves `{{signal}}` as `#000000`, and omitting `data-cursor-hotspot` defaults to `0 0`.

### Sprite normalisation pipeline

`svgToSymbol` performs several transforms per source SVG before it becomes a `<symbol>`:

1. **viewBox normalisation** — a non-zero-origin `viewBox` (e.g. `viewBox="4 4 16 16"`) is rewritten to `0 0 w h` and the inner content wrapped in `<g transform="translate(-minX -minY)">`, so `<use>` at `(0,0)` always lands inside the symbol's viewport.
2. **Root attribute propagation** — presentation attributes on the root `<svg>` (`fill`, `stroke`, `stroke-width`, `stroke-linecap`, `stroke-linejoin`) are pushed down onto shape elements (`path`, `rect`, `circle`, `line`, `ellipse`, `polygon`, `polyline`) that don't already set them.
3. **Symbol ID** — emitted as `icon-<basename>` (e.g. `arrow-right.svg` → `id="icon-arrow-right"`).

`svgToSymbol` returns `null` when no inner content can be extracted; that source is skipped.

### SVG sanitisation scope

`sanitizeSVG` is **best-effort, defense-in-depth** for *trusted* sources (icon libraries you reference in config). It strips `<script>`, `<foreignObject>`, `<style>`, SMIL `<animate>`/`<set>` href retargeting, `javascript:`/`data:text/html` href schemes, and `on*` event-handler attributes. Root-`<svg>` event handlers are already neutralised because `svgToSymbol` discards the root tag. For **untrusted / user-supplied** SVGs, use a full DOM-based sanitizer (e.g. DOMPurify) instead — `sanitizeSVG` is not sufficient there. The production CSP (`self`, nonce) remains the primary runtime control.

### Content hashing & cache busting

With hashing enabled (`--minify`), `buildCSS`/`buildJS`/`buildSprites` rename outputs to `<stem>.<8hex>.<ext>` using `hashFile` (truncated SHA-256 of the *emitted* file, so the hash changes only when output content changes). The build manifest maps the logical name to the hashed relative path; `createManifest` resolves it at runtime. `buildAll` then writes `_headers` with `Cache-Control: public, max-age=31536000, immutable` for `/assets/*`.

### Path containment

`safeJoin` resolves `base` + `segments` and throws if the result escapes `base`. It guards every config-supplied **output** path (copy `to`, sprite `target`, font `to`, JS `outdir`). Source **reads** (`from`, font `url`, remote sprite `source.path`) are intentionally unrestricted.

### Programmatic builds

To run the pipeline outside the CLI, pair `loadConfig` with `buildAll`:

```ts
import { loadConfig } from "@y-core/forge/assets";
import { buildAll } from "@y-core/forge/assets/build";

const config = await loadConfig("assets.config.ts", process.env);
await buildAll(config, { minify: true, assetsPath: "src/generated/assets.ts" });
```

### Optional dependencies

`buildIcons` dynamically imports `sharp`, and `buildJS` dynamically imports `esbuild` — both only when the relevant config section is present. Consumers without icons or JS bundles never need those packages installed.
