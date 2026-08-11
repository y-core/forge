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
- §4a Commands Are Values: a tree built from data, not registered by side effect
- §4b Flags Are a Typed Record: two types, inference instead of casts
- §4c Errors Carry a Kind, Not an Exit Code: why failure is always exit 1
- §5 pkg Namespace — Release Tooling: the blessed release path
- §5a createReleaseCommand — Automated Release Workflow: the ordered steps and the refusals
- §5b SemVer Utilities: parse, bump, format, compare
- §5c Git Release Utilities: tag and working-tree helpers
- §5d Changelog Promotion — the Unreleased Contract: what release does to `CHANGELOG.md`
- §5e Changelog Gate Invariants: what is checked before a release, and what deliberately is not

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

Signatures, worked examples, and the full flag-parsing table live in `src/cli/README.md`. This
section carries only the decisions behind them.

### 4a. Commands Are Values

**`createCommand` takes a config object and returns a command; nothing is registered by side
effect.** `addCommand(parent, child)` links two of those values into a tree, and `execute(root)`
walks it. The handler key is `run`.

The consequence is testability: a command tree is data a caller holds, so it can be built,
inspected, and driven to completion without a process. `execute` accepts an explicit `argv` and an
injectable `CliIO`, which is why forge's own CLIs are covered by ordinary unit tests rather than by
spawning themselves.

**A gate or build verb is therefore a factory, not a script.** `createReleaseCommand` (§5a) and the
verification gate's `createGateCommand` both return a command from a config whose first field is
`cwd`; the file under `scripts/` is a two-line binding that resolves `cwd` and calls `execute`.

### 4b. Flags Are a Typed Record

**Flags are a record keyed by long name, not an array of definitions.** The key *is* the `--long`
form and `short` is a field on the definition, so a flag cannot be declared with a name that
disagrees with the one used to read it.

**There are two flag types — `"boolean"` and `"string"`.** `ResolvedFlags<F>` derives the handler's
flag argument from the declaration: a `string` flag with a `default` or `required: true` resolves
to `string`, every other `string` flag to `string | undefined`, and a boolean to `boolean`. No
handler casts, and a renamed flag fails to typecheck at its reader.

**Number parsing is deliberately absent.** A numeric flag is a string plus the caller's own
validation, which keeps the parser total — it has no way to fail on input it was handed. Repeated
flags and array values are likewise absent: a list is a comma-joined string the command splits,
which is why the gate runner takes `--only lint,typecheck` rather than a repeated flag.

### 4c. Errors Carry a Kind, Not an Exit Code

**`new CliError(kind, message)`** — the discriminant is a `CliErrorKind`, and no error carries an
exit code. `execute` catches every error, prints it to stderr via `formatError`, and exits **1**.

**Exit status is a two-valued contract: 0 is success, 1 is failure.** Anything a numeric code might
have encoded belongs in the `kind` or the message, where a reader and a test can both see it. A
command needing a different code — or needing to exit *without* the `Error:` prefix `execute`
would print — calls `process.exit` itself; the verification gate does exactly that so its summary
line is the last thing printed.

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
next version, reaches a verdict on the changelog and promotes it in memory (§5d), prints the
previous version, the next one, the tag and what the promotion would write, refuses to re-tag,
updates `package.json`, writes the promoted changelog, commits, and creates the tag. **It is
the only blessed way to cut a forge release.**

**All three places a version lives are computed by this command** — the git tag, the
`package.json` field, and the changelog's version heading. A hand-typed version anywhere is a
defect, and §5e is the gate that says so.

**It never pushes.** The last thing it prints is the push command for a human to run — so
the irreversible step, publishing a tag to a remote, stays a deliberate act. Bringing the
changelog inside the governed path does not change that.

**The commit is atomic.** `stageFiles` decides what the release commit carries; forge's own
binding under `scripts/` adds the changelog to the default, so the bump, the promoted section
and the tag are one commit rather than a bump commit chasing a prose commit. The library
default stays `["package.json"]` — a changelog is this repository's policy, not every
consumer's, and a consumer without one releases unchanged (`changelogFile` is skipped when the
file is absent).

Four refusals matter, and each is a guard rather than a convenience:

- **A dirty tree aborts** — `isWorkingTreeClean` is checked before anything is resolved, so a
  half-finished change cannot ship. `--allow-dirty` overrides it; using that flag for a real
  release defeats the guard's only purpose.
- **An existing tag aborts** — `tagExists` is checked after the version is resolved, so a
  botched release cannot be quietly re-cut over its own tag.
- **Nothing to release aborts** — when no commits exist since the latest tag, the command
  reports "already at" that version and stops. `package.json` disagreeing with the tag at that
  point is an error, not a bump.
- **An empty `[Unreleased]` aborts** when commits exist since the tag — shipping a release
  nobody wrote a line for is the drift the changelog is meant to prevent.
  `--allow-empty-changelog` is the narrow escape, and §5d states what it does and does not
  license. A *malformed* changelog is a separate refusal that no flag reaches.

**A refusal `throw`s a `ReleaseError`; it does not call `exit`.** `execute` renders any `Error`
as `Error: <message>` and exits 1 (§4c), so the operator sees the same output while the guard
stays reachable from a test that mocks no process. **The changelog verdict is reached after the
version is resolved** — it has to know whether commits exist — **and before `package.json` is
written**, so no mutation can precede a refusal.

**`--dry` prints the resolved version and what would be promoted, then stops before any
write.** It skips the clean-tree check as well, so it is safe to run at any time — but note
that it resolves from `<latest-tag>..HEAD`, so running it *before* committing reports "nothing
to release" rather than the version that release would produce. Commit first, then dry-run.

**The bump is the highest one any commit in `<latest-tag>..HEAD` asks for**: a `major:` subject
prefix bumps major, a `minor:` prefix bumps minor, and a range with neither is a patch. Scanning
the whole range rather than the tip is the point — a cycle holding a `major:` commit followed by
`fix typo` must not ship as a patch. Passing an explicit version as the command's single
positional argument overrides the scan, and is rejected if it is not greater than the current
tag.

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
| `getLastCommitMessage(cwd)` | The last commit's subject line — a standalone helper, not part of version resolution (§5a scans the whole range) |
| `createTag(cwd, tag)` | Creates a **lightweight** tag — `git tag <tag>`, no annotation, no message |
| `tagExists(cwd, tag)` | `true` when that tag is already present |
| `isWorkingTreeClean(cwd)` | `true` when there are no uncommitted changes |

`createReleaseCommand` calls `isWorkingTreeClean(cwd)` before anything else and exits non-zero
if the tree is dirty (§5a). **Never tag a dirty tree.**

**`getCommitsSinceTag` stays on `--oneline` rather than a bare subject format**, and the bump
scan strips the abbreviated sha itself. The helper answers two questions at once — what the
subjects are, and whether the range holds anything at all — and a subject-only format would emit
an empty line for a commit with an empty subject, which the emptiness filter drops. A range of
such commits would then read as "nothing to release", which is the worse failure of the two.

### 5d. Changelog Promotion — the Unreleased Contract

**`[Unreleased]` is the staging area, and the only section a human edits.** Release promotes it:
the heading is retitled in place, a fresh empty `[Unreleased]` is inserted above it, and a link
reference definition is appended. Everything below the insertion point is byte-for-byte
unchanged, which is why a document that has never ended in a newline round-trips exactly — and
why `writeChangelog` normalises nothing.

**The version heading grammar is exact, and the separator is an em dash (U+2014).** An en dash
or a hyphen is a parse error, not a near miss, because the two are indistinguishable in review
and only one of them a machine can promote against:

    ## [0.0.83] — 2026-08-11

**The date is the releaser's local calendar day.** `toISOString()` reads UTC and would stamp
tomorrow for an evening release in a positive-offset zone; a changelog reader means the day the
release happened where it happened.

**An `[Unreleased]` section is empty when it holds nothing but whitespace, `---` separators, or
the literal `_Nothing yet._` placeholder** — the placeholder promotion itself writes. Empty plus
commits since the tag is the refusal in §5a.

`--allow-empty-changelog` is for a genuinely entry-free tooling release, not for getting past a
prompt, and two properties keep it from becoming routine:

- **It does not license a malformed document.** An unparseable changelog is a separate refusal
  with no escape, because promotion has nothing to act on.
- **It still promotes.** The section ships as a permanent `_Nothing yet._` entry in the released
  record, which is the deterrent. Skipping promotion would be worse than useless: it would leave
  the topmost released heading behind `package.json` and fail §5e on the next `verify`.

**The link reference definition is best-effort.** Its base URL comes from `package.json`'s
`repository` field, normalised by stripping a `git+` prefix and a `.git` suffix. Absent or
unusable, the definition is omitted and the promotion still succeeds — a consumer with no known
remote must still be able to release. A first release omits it too: there is no previous version
to compare against, and a compare link to nothing is worse than none. Reading the URL from
`git remote get-url` was rejected — it breaks in a clone with a renamed remote, and it would put
a subprocess on a path that is otherwise pure metadata.

**`src/pkg/changelog.ts` returns its failures instead of throwing, diverging from the
`ReleaseError` style of the rest of the namespace.** The divergence is the gate's doing: §5e must
report every malformed heading in one run, and an exception stops at the first. The module is
also import-free — no clock, no filesystem, no git — so `release.ts` converts a returned failure
into a `ReleaseError` at its own boundary and the file I/O lives with the other readers in
`pkg.ts`.

### 5e. Changelog Gate Invariants

**`CHANGELOG.md` is checked by a gate step of `bun run verify` only.** Requiring a written
`[Unreleased]` entry on every `check` would fail every work-in-progress commit; `verify` runs
exactly where the invariant bites — before `prepublishOnly`, and before a tag exists.
`scripts/lib/steps.ts` owns the step table (see [`TESTING.md`](./TESTING.md) §6).

**It imports the parser from `src/pkg/mod` rather than adding a fourth `scripts/*-parse.ts`.**
Release needs the same grammar to promote with, and two parsers for one document is precisely
the drift the gate exists to catch. One parser, two callers.

Failing invariants:

- The grammar parses — one `[Unreleased]`, first, and every other entry heading well-formed.
- No version appears twice, and versions run strictly descending.
- Dates are non-increasing downward; equal dates are allowed and do occur.
- **The topmost released heading equals `package.json`'s version.** This is the drift detector,
  and the reason the gate exists: it catches a heading hand-written for a version no tag was ever
  cut for.
- Every link reference definition names a heading that exists.

A heading with *no* link definition is a warning only — promotion writes the definition, and
entries predating it legitimately lack one.

Three things are deliberately not checked, each because the file disproves them:

- **`---` separators between sections** — not a per-section invariant; consecutive released
  versions in the real file carry none.
- **Version contiguity** — gaps are legitimate, since a resolved version that never shipped
  leaves a hole the next compare link simply spans.
- **A trailing newline** — the file has none, and promotion round-trips that exactly (§5d).
