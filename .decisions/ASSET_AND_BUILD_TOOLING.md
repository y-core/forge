---
title: Asset and Build Tooling
description: "assets namespace, defineAssetsConfig, AssetsConfig, assets/build pipeline, buildCSS, buildJS, buildSprites, copyAssets, assets/manifest, createManifest, createSpriteRegistry, cli namespace, createCommand, pkg namespace, release, semver, bumpSemVer"
weight: 32
---

# Asset and Build Tooling

> Authoritative source for forge's asset pipeline (`assets/build`), manifest system
> (`assets/manifest`), CLI framework (`cli`), and release tooling (`pkg`).
>
> Complements [LIBRARY_ARCHITECTURE.md](./LIBRARY_ARCHITECTURE.md) §3 (runtime-only constraint).

---

## 0. Quick Reference

- §1 assets namespace: `defineAssetsConfig`, `AssetsConfig`, `loadConfig`
- §2 assets/build pipeline: `buildAll`, `buildCSS`, `buildJS`, `buildSprites`, `copyAssets`
- §3 assets/manifest: `createManifest`, `createSpriteRegistry`
- §4 cli namespace: `createCommand`, `addCommand`, `execute`
- §5 pkg namespace: release tooling, `parseSemVer`, `bumpSemVer`, `createReleaseCommand`

---

## 1. Assets Namespace

### 1a. defineAssetsConfig — Schema and Validation

`defineAssetsConfig` is the canonical entry point for configuring the asset pipeline.
It validates the config shape at definition time and returns a fully-typed `AssetsConfig`.
Call it in an `assets.config.ts` at the project root and export the result as default.

    import { defineAssetsConfig } from "@y-core/forge/assets"

    export default defineAssetsConfig({
      paths: {
        src: "./src/assets",
        dist: "./public/assets",
        js: "./public/assets/js",
      },
      css: { entry: "./src/assets/tailwind.css", output: "styles.css" },
      js: [{ entry: "./src/client/main.ts", output: "main.js" }],
      sprites: [{ src: "./src/assets/svg/*.svg", output: "sprites.svg" }],
    })

The `paths.dist` directory is the single output root. `paths.js` is a subdirectory
within `dist` for bundled JavaScript. All other outputs land directly under `dist`.

### 1b. AssetsConfig Type Shape

`AssetsConfig` is the TypeScript type returned by `defineAssetsConfig`. Key fields:

| Field | Type | Purpose |
|---|---|---|
| `paths.src` | `string` | Source asset root |
| `paths.dist` | `string` | Distribution output root |
| `paths.js` | `string` | JS output subdirectory |
| `css` | `{ entry, output }` | Tailwind CSS entry and output filename |
| `js` | `Array<{ entry, output }>` | esbuild JS bundles |
| `sprites` | `Array<{ src, output }>` | SVG sprite groups (glob → sheet) |
| `copy` | `Array<{ src, dest }>` | Static file copy rules |

Do not construct `AssetsConfig` directly — always go through `defineAssetsConfig` so
validation runs at startup.

### 1c. loadConfig — Config Discovery

    import { loadConfig } from "@y-core/forge/assets"
    const config = await loadConfig()  // discovers assets.config.ts from cwd

`loadConfig` walks up from `process.cwd()` looking for `assets.config.ts`. CLI
commands call this automatically; call it explicitly only in programmatic build scripts.

---

## 2. assets/build Pipeline

### 2a. Build Functions — Orchestration

    import { buildAll, buildCSS, buildJS, buildSprites, copyAssets } from "@y-core/forge/assets/build"

| Function | Runs |
|---|---|
| `buildAll(config)` | Full pipeline: CSS + JS + sprites + copy in dependency order |
| `buildCSS(config)` | Tailwind CLI build, writes `config.css.output` to `config.paths.dist` |
| `buildJS(config)` | esbuild bundle for each entry in `config.js`, writes to `config.paths.js` |
| `buildSprites(config)` | Combines SVGs matching each `sprites[].src` glob into a sprite sheet |
| `copyAssets(config)` | Copies each `copy[]` rule from src to dest |

`buildAll` is the standard entry for CI and `package.json` scripts. Individual
functions exist for watch-mode incremental rebuilds where only one artifact has changed.

### 2b. Hash and Change Detection

    import {
      hashFile,
      hashString,
      hasChanged,
      loadState,
      saveState,
      markBuilt,
    } from "@y-core/forge/assets/build"

Build tools use content hashing (SHA-256 truncated to 8 hex chars) for cache-busting
and incremental change detection. The state file (`.forge-build-state.json` in `dist`)
tracks per-file hashes from the previous build.

`hasChanged(filePath, state)` returns `true` if the file hash differs from the
stored state. `markBuilt(filePath, state)` updates the in-memory state. `saveState`
persists to disk at the end of a build pass.

Hashes written into manifest filenames are derived from the output file, not the
source, so they change only when the emitted content changes.

### 2c. Watch Mode Integration

CLI `watch` command calls `loadState`, registers file watchers, and on change calls
the appropriate single-step function (`buildCSS`, `buildJS`, etc.) followed by
`saveState`. `buildAll` is not called in watch mode — only the changed pipeline step.

---

## 3. assets/manifest

### 3a. createManifest — Content-Hashed Paths

    import { createManifest } from "@y-core/forge/assets/manifest"

    const manifest = createManifest(distDir)
    const cssPath = manifest.get("styles.css")  // "/assets/styles.abc12345.css"

`createManifest` reads the dist directory, scans for hashed filenames (pattern:
`name.{8hexchars}.ext`), and builds a `Map<string, string>` from logical name to
hashed path. The Worker serves assets at the hashed path; templates reference the
logical name via `manifest.get(...)`.

Resolve the manifest once per request (or at module load for an immutable dist) and
thread it through to views — e.g. via a `contextVar` accessor or the resolved app
`Config` — so all views can resolve asset paths without knowing the hash.

### 3b. createSpriteRegistry — SVG Symbol Lookup

    import { createSpriteRegistry } from "@y-core/forge/assets/manifest"

    const sprites = createSpriteRegistry(spritePath)
    const icon = sprites.get("arrow-right")  // { id, viewBox, content }

`createSpriteRegistry` parses the compiled sprite sheet and returns a registry that
maps symbol IDs to their `viewBox` and inner SVG content. Use this in forge JSX
components to render inline `<svg><use href="#id"/>` references with correct dimensions.

---

## 4. cli Namespace

### 4a. createCommand and addCommand

    import { createCommand, addCommand, execute } from "@y-core/forge/cli"

    const program = createCommand("forge-assets")
    addCommand(program, {
      name: "build",
      description: "Build all assets",
      action: async () => { await buildAll(config) },
    })
    execute(program, process.argv.slice(2))

`createCommand` wraps a minimal command-line parser (no external CLI framework
dependency). `addCommand` registers a subcommand with a name, description, optional
flags, and an async `action`. `execute` dispatches to the matched subcommand or
prints help.

### 4b. CLI Flags — Typed Options

    addCommand(program, {
      name: "build",
      flags: [
        { name: "watch", short: "w", type: "boolean", default: false },
        { name: "config", short: "c", type: "string" },
      ],
      action: async ({ watch, config }) => { /* ... */ },
    })

Flag types are `"boolean"` | `"string"` | `"number"`. Boolean flags default to
`false`. Unknown flags cause `execute` to print an error and exit with code 1.

### 4c. Error Handling in CLI

    import { CliError, formatError } from "@y-core/forge/cli"

    throw new CliError("Asset config not found", { exitCode: 1 })

`CliError` carries an `exitCode` (default `1`). `execute` catches `CliError`,
calls `formatError`, prints to stderr, and exits with the code. All other errors
surface as uncaught exceptions (exit code 2).

---

## 5. pkg Namespace — Release Tooling

### 5a. createReleaseCommand — Automated Release Workflow

    import { createReleaseCommand } from "@y-core/forge/pkg"

    const releaseCmd = createReleaseCommand(program)

`createReleaseCommand` registers a `release` subcommand that: validates the working
tree is clean, determines the next version via `bumpSemVer`, updates `package.json`,
commits the version bump, creates a git tag, and optionally pushes. It is the only
blessed way to cut a forge release.

### 5b. SemVer Utilities

    import { parseSemVer, bumpSemVer, formatSemVer, compareSemVer } from "@y-core/forge/pkg"

    const v    = parseSemVer("0.0.18")          // { major: 0, minor: 0, patch: 18 }
    const next = bumpSemVer(v, "patch")          // { major: 0, minor: 0, patch: 19 }
    const s    = formatSemVer(next)              // "0.0.19"
    const cmp  = compareSemVer(next, v)          // 1 (next > v)

`parseSemVer` throws if the string is not a valid semver. `bumpSemVer` accepts
`"major"` | `"minor"` | `"patch"` and resets lower components to zero per semver spec.

### 5c. Git Release Utilities

    import {
      getLatestTag,
      getCommitsSinceTag,
      createTag,
      isWorkingTreeClean,
    } from "@y-core/forge/pkg"

| Function | Returns |
|---|---|
| `getLatestTag()` | Latest semver tag string, or `null` if no tags |
| `getCommitsSinceTag(tag)` | Array of `{ hash, message }` since the tag |
| `createTag(version, message)` | Creates an annotated git tag |
| `isWorkingTreeClean()` | `true` if no uncommitted changes |

`createReleaseCommand` calls `isWorkingTreeClean()` before proceeding and aborts
with `CliError` if the tree is dirty. Never tag a dirty tree.
