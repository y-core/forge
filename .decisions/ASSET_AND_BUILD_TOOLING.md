---
title: Asset and Build Tooling
description: "The asset pipeline, the content-hash manifest system, the CLI framework, and the release tooling."
---

# Asset and Build Tooling

> Owns forge's build-time surface: the asset pipeline (`assets/build`), the manifest system
> (`assets/manifest`), the CLI framework (`cli`), and release tooling (`pkg`). These run on a
> developer's machine, never in a Worker, so they are exempt from the Web-APIs-only rule.
>
> Defers to: [`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md) §1d for that exemption, and
> [`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md) §3c for the optional build peer
> dependencies.

---

## 0. Quick Reference

- §1 Assets Namespace: declaring and discovering the pipeline config
- §1a defineAssetsConfig — Schema and Validation: the canonical entry point
- §1b AssetsConfig Type Shape: the config fields
- §1c loadConfig — Config Discovery: walking up for `assets.config.ts`
- §2 assets/build Pipeline: the build functions and change detection
- §2a Build Functions — Orchestration: `buildAll` and the individual steps
- §2b Hash and Change Detection: content hashing and the state file
- §2c Watch Mode Integration: single-step rebuilds
- §3 assets/manifest: resolving logical names to hashed paths
- §3a createManifest — Content-Hashed Paths: the logical-to-hashed map
- §3b createSpriteRegistry — SVG Symbol Lookup: symbol id to viewBox and content
- §4 cli Namespace: the dependency-free command framework
- §4a createCommand and addCommand: registering subcommands
- §4b CLI Flags — Typed Options: the three flag types
- §4c Error Handling in CLI: `CliError` and exit codes
- §5 pkg Namespace — Release Tooling: the blessed release path
- §5a createReleaseCommand — Automated Release Workflow: what the command does
- §5b SemVer Utilities: parse, bump, format, compare
- §5c Git Release Utilities: tag and working-tree helpers

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

    const releaseCmd = createReleaseCommand({ cwd })

**`createReleaseCommand(config, deps?)` takes a config object, not a program.** `cwd` is
required; `tagPrefix` defaults to `"v"` and `stageFiles` to `["package.json"]`. The second
parameter is the injected dependency set, present so the command is testable — production
callers pass one argument.

It builds a `release` subcommand that, in order: refuses a dirty working tree, resolves the
next version, prints the previous version, the next one and the tag, refuses to re-tag,
updates `package.json`, commits, and creates the tag. **It is the only blessed way to cut a
forge release.**

**It never pushes.** The last thing it prints is the push command for a human to run — so
the irreversible step, publishing a tag to a remote, stays a deliberate act.

Three refusals matter, and each is a guard rather than a convenience:

- **A dirty tree aborts** — `isWorkingTreeClean` is checked before anything is resolved, so a
  half-finished change cannot ship. `--allow-dirty` overrides it; using that flag for a real
  release defeats the guard's only purpose. The abort prints to stderr and exits non-zero.
- **An existing tag aborts** — `tagExists` is checked after the version is resolved, so a
  botched release cannot be quietly re-cut over its own tag.
- **Nothing to release aborts** — when no commits exist since the latest tag, the command
  reports "already at" that version and stops. `package.json` disagreeing with the tag at that
  point is an error, not a bump.

**`--dry` prints the resolved version and stops before any write.** It skips the clean-tree
check as well, so it is safe to run at any time — but note that it resolves from
`<latest-tag>..HEAD`, so running it *before* committing reports "nothing to release" rather
than the version that release would produce. Commit first, then dry-run.

**The bump is inferred from the last commit's subject line**: a `major:` prefix bumps major, a
`minor:` prefix bumps minor, anything else is a patch. Passing an explicit version as the
command's single positional argument overrides the inference, and is rejected if it is not
greater than the current tag.

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
      tagExists,
      isWorkingTreeClean,
    } from "@y-core/forge/pkg"

**Every one of them takes `cwd` first.** These shell out to `git`, and a git command with no
working directory is a command against whatever directory the process happens to be in — so
the caller states it rather than inheriting it.

| Function | Returns |
|---|---|
| `getLatestTag(cwd, prefix)` | Highest tag matching `prefix*` by version sort, or `null` when there are none |
| `getCommitsSinceTag(cwd, tag)` | `string[]` — one `git log --oneline` line per commit, **not** parsed objects |
| `getLastCommitMessage(cwd)` | The last commit's subject line, which is what the bump is inferred from (§5a) |
| `createTag(cwd, tag)` | Creates a **lightweight** tag — `git tag <tag>`, no annotation, no message |
| `tagExists(cwd, tag)` | `true` when that tag is already present |
| `isWorkingTreeClean(cwd)` | `true` when there are no uncommitted changes |

`createReleaseCommand` calls `isWorkingTreeClean(cwd)` before anything else and exits non-zero
if the tree is dirty (§5a). **Never tag a dirty tree.**
