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
- §1c loadConfig — Config Resolution: resolving `assets.config.ts` against cwd, and why you should pass it
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
- §4d CommandBase and Command Are Not Mergeable: the variance that forces two interfaces
- §5 pkg Namespace — Project Tooling: the blessed release path and the published gate
- §5a createReleaseCommand — Automated Release Workflow: the ordered steps and the refusals
- §5b SemVer Utilities: parse, bump, format, compare
- §5c Git and Manifest Internals: the unpublished helpers the two factories are built from
- §5d Changelog Promotion — the Unreleased Contract: what release does to `CHANGELOG.md`
- §5e Changelog Gate Invariants: what is checked before a release, and what deliberately is not
- §5f createGateCommand — the Published Verification Gate: one runner, one table per project
- §5g cloudflareWorkerSteps — the Fleet Preset: a step-table factory, not new machinery
- §5h Roots Are Stated or Derived, Never Discovered: no function walks the disk to find the project
- §5i Checks Are Functions, Not Scripts: the published validators and the verb vocabulary

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

### 1c. loadConfig — Config Resolution

    import { loadConfig } from "@y-core/forge/assets"
    const config = await loadConfig("src/assets/config.ts")

**`loadConfig` resolves its argument against `process.cwd()`; it does not search.** An omitted
argument means `assets.config.ts` in the current directory and nothing more — there is no walk up
the tree, and a run from a subdirectory does not find the root's config.

> This section previously described a walk-up that the code has never performed. The correction is
> recorded rather than quietly applied, because a documented search is the kind of thing a reader
> builds a directory layout around.

Every app in the fleet passes `--config` explicitly, so the fallback is effectively unused. **Prefer
passing the path**: it is the difference between a build whose inputs are stated and one whose
inputs depend on where the command was typed. §5h states the rule this is an instance of.

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

**A gate or build verb is therefore a factory, not a script.** `createReleaseCommand` (§5a) and
`createGateCommand` (§5f) both return a command from a config whose first field is `cwd`; the file
under `scripts/` is a short binding that resolves `cwd` and calls `execute`. Both ship from
`@y-core/forge/pkg`, which is what makes the shape reusable rather than a forge-local habit — a
factory reachable only from `scripts/` is a script wearing a factory's clothes.

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

### 4d. CommandBase and Command Are Not Mergeable

**`CommandBase` and `Command<F>` are near-identical on purpose and must stay separate.** `run` takes
its flags as a parameter, so `F` is contravariant and `Command<F>` is invariant in it — a tree of
differently-flagged commands has no common `Command<…>` to be typed as. Tree links are therefore
`CommandBase`, which declares no `run`, and `execute` recovers the handler through the
`CallableCommand` cast, the one place that invariance is discharged.

---

## 5. pkg Namespace — Project Tooling

**`pkg` owns both project verbs — release *and* verification.** The charter widened when the gate
folded in: the namespace is what a project's `scripts/` directory is built from, not release
automation alone. Its layout follows the split — `release/` and `gate/` hold the two factories,
`internal/` holds what only serves them, and `mod.ts` is the one barrel over all three
(`NAMESPACE_DESIGN.md` §1a forbids a barrel importing a barrel, so the subdirectories are plain
directories of concrete files).

### 5a. createReleaseCommand — Automated Release Workflow

    import { createReleaseCommand } from "@y-core/forge/pkg"

    const releaseCmd = createReleaseCommand({ cwd })

**`createReleaseCommand(config, deps?)` takes a config object, not a program.** `cwd` is
required; `tagPrefix` defaults to `"v"` and `stageFiles` to what the release wrote (see below).
The second parameter is the injected dependency set, present so the command is testable —
production callers pass one argument.

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

**The commit is atomic, and the default is what makes it so.** `stageFiles` defaults to exactly
what this command wrote — `package.json`, plus `changelogFile` when a changelog was promoted — so
the bump, the promoted section and the tag are one commit rather than a bump commit chasing a
prose commit. A project with no changelog stages `package.json` alone, because `commit` runs
`git add` and naming a path that does not exist would fail the release outright.

> This default was previously `["package.json"]`, on the reasoning that a changelog is one
> repository's policy rather than every consumer's. That reasoning was wrong about which file it
> described: `changelogFile` is not an opt-in the consumer declares, it is a file **this command
> writes**. Writing it and not staging it left the release commit missing the promotion and the
> working tree dirty afterwards — a defect every consumer inherited unless they knew to override
> the field. Deriving the list from what was written removes the choice rather than re-defaulting
> it.

**`stageFiles` is an override, not an addition.** Naming it replaces the derived list. It exists
for what a release touches *beyond* its own writes — a lockfile, a monorepo's sibling manifests,
a version constant in source — and those callers state the full list deliberately.

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

### 5c. Git and Manifest Internals

    // src/pkg/internal/git.ts, src/pkg/internal/pkg-json.ts — NOT exported from the barrel

**These are unpublished.** `getLatestTag`, `getCommitsSinceTag`, `getLastCommitMessage`,
`createTag`, `tagExists`, `isWorkingTreeClean`, `gitExec`, `readPackageVersion`,
`updatePackageVersion`, `readRepositoryUrl`, `readChangelog` and `writeChangelog` exist to serve
the two command factories and nothing else. A consumer that needs `git tag` has `git`; what forge
publishes is the *policy* over it — the ordered, refusing release command — not a thin `execFileSync`
wrapper it would have to reimplement the policy around. `validate-exports` enforces the line: an
`@public` tag on any of them fails the gate until it is either exported or retagged.

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
  the topmost released heading behind `package.json` and fail §5e on the next `verify --full`.

**The link reference definition is best-effort.** Its base URL comes from `package.json`'s
`repository` field, normalised by stripping a `git+` prefix and a `.git` suffix. Absent or
unusable, the definition is omitted and the promotion still succeeds — a consumer with no known
remote must still be able to release. A first release omits it too: there is no previous version
to compare against, and a compare link to nothing is worse than none. Reading the URL from
`git remote get-url` was rejected — it breaks in a clone with a renamed remote, and it would put
a subprocess on a path that is otherwise pure metadata.

**`src/pkg/release/changelog.ts` returns its failures instead of throwing, diverging from the
`ReleaseError` style of the rest of the namespace.** The divergence is the gate's doing: §5e must
report every malformed heading in one run, and an exception stops at the first. The module is
also import-free — no clock, no filesystem, no git — so `release.ts` converts a returned failure
into a `ReleaseError` at its own boundary and the file I/O lives with the other readers in
`internal/pkg-json.ts`.

### 5e. Changelog Gate Invariants

**`CHANGELOG.md` is checked by a `fullOnly` gate step.** Requiring a written
`[Unreleased]` entry on every fast run would fail every work-in-progress commit; `verify --full` runs
exactly where the invariant bites — before `prepublishOnly`, and before a tag exists.
`config/steps.ts` owns the step table (see [`TESTING.md`](./TESTING.md) §6).

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

### 5f. createGateCommand — the Published Verification Gate

    forge-verify --full                       # the bin, loading config/steps.ts

    await execute(createGateCommand({ cwd, steps: STEPS }))   # the runner, handed a table

**One runner, one table per project.** The runner is published; the table is not. That split is the
whole design: five repositories share the selection logic, the fail-fast ordering, the `requires`
probe and the full-log file, while each keeps its own steps as its own source of truth — forge's in
`config/steps.ts` (see [`TESTING.md`](./TESTING.md) §6a).

**The bin is the entry point; the factory is the escape hatch.** `forge-verify` resolves
`config/steps.ts` (or `--config`) and delegates to `createGateCommand`, so a project needs no
binding file of its own. `createGateCommand` stays published for the case the bin cannot serve —
a table assembled at run time, or a gate embedded in a larger CLI.

| Field | Type | Default | Description |
|---|---|---|---|
| `cwd` | `string` | — | Repository root. Every step is spawned here, so a step's relative paths resolve. |
| `steps` | `readonly Step[]` | — | The table to resolve against. |
| `binDir` | `string` | `${cwd}/node_modules/.bin` | Prepended to `PATH` so bare tool names resolve. |

**One command, two modes — not two commands.** `check` and `verify` were two verbs sharing every
flag and every line of behaviour, differing only in a membership filter. That is a mode by
definition, and modelling it as two verbs cost a duplicated binding file per repo, a `gate` config
field, and a superset invariant that had to be *tested* rather than being true by construction.
`verify` runs the fast set; `verify --full` adds the `fullOnly` steps.

**`GateMode` is a closed `"fast" | "full"` union, and `Step.fullOnly` is a boolean.** Together they
carry the prerequisite invariant [`TESTING.md`](./TESTING.md) §6c exists to settle: a third mode
would have no defined answer to "may this step require a browser?", and a *list* of modes would let
a table express a step that a fast run has and a full run does not. Neither is a restriction the
runner enforces at runtime — both are shapes that make the wrong thing unsayable.

**`binDir` is a de-hardcoding, not a feature.** The runner previously hardcoded
`${cwd}/node_modules/.bin`; the apps that invoke tools as `bun x biome` need a different prefix, and
one config field is cheaper than five forks. The temp-directory prefix behind the full-log file
stays hardcoded — configuring it would be surface for nothing.

**The formatters stay unpublished.** `src/pkg/gate/report.ts` is nine pure functions and none of
them is exported from the barrel. Publishing them would freeze the exact glyphs and wording of
every gate line across five repositories, and would hand the next repository the parts to build an
alternate runner from — which is the fork this consolidation removed.

**`selectSteps` *is* published**, because it is pure. An app unit-tests its own table against it at
zero step cost — the same argument that makes forge's `steps.test.ts` worth having.

**What is deliberately absent:** step sets, an `--inspect`/streaming mode, and a preconditions
phase. The published surface is exactly `--only`, `--list`, `--fix`, fail-fast, the `requires`
probe and the full-log file. Narrowing a run means enumerating labels; the workaround for a
streamed run is `--list` and then the step's own command.

### 5g. cloudflareWorkerSteps — the Fleet Preset

    import { cloudflareWorkerSteps } from "@y-core/forge/pkg"

    export const STEPS = [...cloudflareWorkerSteps({ assetConfig: "assets.config.ts" }), ...appSteps]

**A preset is a factory returning ordinary `Step` rows, not a second kind of table.** It is spread
into the app's own array and appended to; an app that outgrows it writes the rows out by hand and
loses nothing. Nothing in the runner knows a preset exists.

The order is `cf:types:runtime` → `cf:types:bindings` → `types:assets` → `typecheck` → `lint` →
`test`. **Generation leads judgement**: `wrangler types` and the asset-types emitter both write
files `typecheck` then reads, so a stale binding type surfaces as a type error rather than as a
green run over yesterday's bindings.

**The two `wrangler types` invocations are two steps, not one.** Three of the four apps chain them
with `&&` in a `cf:typecheck` script — `--no-include-env` for the runtime half, then
`--no-include-runtime` for the bindings half — and `Step.cmd` is one executable, not a shell line.
Splitting them is what the `&&` cost you back: a failure names which invocation broke. `--config`
goes on the bindings invocation only, because runtime types do not depend on the wrangler config.

**The options are the fleet's actual disagreements, and nothing else.** `assetOut` exists because
the emitter writes nothing useful without `--out`; `wranglerTypes: false` exists because cad-forge
declares its binding types by hand. The two `.types/` paths are baked in — every app uses them, and
an option nobody varies is surface for nothing, the same argument that keeps the runner's temp-dir
prefix hardcoded (§5f).

> This section is the record of a defect, not just a description. The preset shipped in v0.0.84
> with a single-invocation `cf:typecheck` and a `types:assets` that omitted `--out` — a table **no
> app in the fleet could actually use**. It was caught by dry-running the first migration rather
> than by any test, which is why `presets.test.ts` now pins each command verbatim: the preset's
> contract is "these are the commands the fleet runs", and that is only assertable literally.

**Every preset step is prerequisite-free**, so the whole preset is legal in a fast run
([`TESTING.md`](./TESTING.md) §6c). A
`requires` added to any of them would break that for every app at once, which is why
`presets.test.ts` asserts the absence as a property rather than trusting the reading.

`assetConfig` is optional and omitting it drops the `types:assets` step entirely — an app with no
asset pipeline gets a four-step table, not a step that succeeds vacuously.

### 5h. Roots Are Stated or Derived, Never Discovered

**No function in `pkg` walks the disk to find out where the project is.** Not upward, not by
probing for a marker file, not at all. A root arrives one of exactly two ways:

- **Stated.** The caller passes it. forge's own bindings do this, from `import.meta.url` — see
  `ROOT` in `config/steps.ts`.
- **Derived.** `installedAppRoot()` takes this module's own path and returns everything before its
  first `node_modules` segment. Pure string arithmetic; it reads no directory. When forge is
  installed at `<app>/node_modules/@y-core/forge/…`, that text *is* `<app>`.

`resolveAppRoot(explicit?)` is the one entry point: stated wins, derived is the fallback, and when
neither is available **it throws**.

**Why the refusal rather than a `process.cwd()` default.** A cwd default makes the answer depend on
which directory the command was typed in. The failure that produces is not a crash — it is a check
that walks a tree containing nothing it recognises and reports the same green as a check that
walked the right tree and found no problems. Every guard in this gate exists to separate those two
outcomes; a discovered root quietly re-merges them.

**Why not a walk-up.** An upward search for `package.json` or a config file finds *a* project, not
necessarily *this* one — a monorepo package, a `node_modules` entry, or a parent checkout all
answer. Worse, it succeeds, so nothing signals that the wrong tree was chosen. Deriving from the
install path cannot pick a different project, because the path is the install.

**The first `node_modules` segment, not the last.** A nested install
(`<app>/node_modules/x/node_modules/@y-core/forge`) and a pnpm store path
(`<app>/node_modules/.pnpm/…/node_modules/@y-core/forge`) both place the consuming application
before the first occurrence; every later one names a dependency's own root. Splitting on the last
would report the dependency as the app.

The derivation is `findAppRoot(modulePath)` — a separate pure function precisely because
`import.meta.url` cannot be varied from a test, so a derivation folded into `installedAppRoot`
would be unassertable.

**A linked install is the case the derivation cannot answer, and `--root` is how the caller
states it.** `"@y-core/forge": "file:../forge"` installs as a tree of symlinks into the forge
checkout, and every runtime resolves `import.meta.url` to the realpath — so this module reports
itself at `<forge>/src/cli/app-root.ts` and there is no `node_modules` segment left to split on.
The derivation returns `undefined`, correctly: the path has stopped naming the consumer. Every
`forge-assets` command therefore carries `--root`, falling back to `FORGE_APP_ROOT`, and an empty
value is treated as absent so an exported-but-unset variable cannot resolve every path against `/`.

This is the *stated* branch, not a third one. The alternative — noticing the symlink and reading
through it — is the walk this section rules out, and it would answer for a `file:` dependency of a
dependency exactly as confidently as for the app.

### 5i. Checks Are Functions, Not Scripts

**Every validator the gate runs is a published `checkX(config)` returning findings.** They lived in
`scripts/`, which the `exports` map cannot reach — so a consuming app got a step table and nothing
to put in it. Publishing the runner while withholding the steps was the half-measure this corrects.

A check is built from four layers, and the **prefix states which one a function is**:

| Prefix | Purity | Shape |
|---|---|---|
| `parse*` / `find*` | pure | text → data. No disk, no root, no path. |
| `validate*` | pure | data → `Finding[]`. Every policy decision lives here. |
| `resolve*` | impure | config → files or contents. Walks disk, judges nothing. |
| `check*` | impure | config → `CheckResult`. Orchestrates the three above. |
| `format*` | pure | findings → strings. |

`check*` is the only entry point a consumer needs; the rest are the seams that make one assertable
without a filesystem or a subprocess.

**`ok` is derived from the findings, never passed.** `checkResult(findings, summary)` computes it,
so "a check that reports a failure and forgets to flip a flag" is not expressible. **`summary`
always carries a count** — `0 .tsx files carry every pragma` is a *visible* nothing-happened, and a
silent green is indistinguishable from a check that walked nothing.

**Two levels, not a scale.** `fail` fails the check; `warn` is reported and does not. A third level
invites "does `major` fail the gate?", which is the question a level should answer.

The published set: `checkExports`, `checkNamespaceGraph`, `checkDocs`, `checkDesign`,
`checkCssSources`, `checkChangelog`, `checkJsx`, and `hasChromium` for the browser probe. Each
takes an explicit `root` (§5h) and every forge-specific allowlist as config, which is what keeps a
check from being forge's script wearing a config parameter.

**Configuration lives in the consuming repository's `config/steps.ts`**, beside the step table.
That file already answers "what does this repository's gate do?", so the allowlists belong with it
rather than in a second config concept; each `scripts/validate-*.ts` binding is then four lines —
import the check, import its config, exit on the verdict.

> The refactor paid for itself twice in testability. `validate-docs.test.ts` and
> `validate-namespace-graph.test.ts` both **spawned subprocesses**, each with a comment explaining
> that their `ROOT` came from `import.meta.url` and "can never be pointed at a fixture tree". With
> `root` as config both became ordinary in-process tests. `barrel-parse`'s five `parse*` functions
> likewise took a *file path* and read it themselves — a lie in the name, and the reason every case
> in its suite wrote a real file to a temp directory. They take source strings now.
