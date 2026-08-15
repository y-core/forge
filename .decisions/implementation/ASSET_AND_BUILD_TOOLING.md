---
title: Asset and Build Tooling
description: "The asset pipeline and its generated module, the content-hash manifest, the CLI framework, and the pkg release and verification-gate command factories."
---

# Asset and Build Tooling

> Owns forge's build-time surface: the asset pipeline (`assets/build`), the manifest system
> (`assets/manifest`), the CLI framework (`cli`), and release tooling (`pkg`). These run on a
> developer's machine, never in a Worker, so they are exempt from the Web-APIs-only rule.
>
> Defers to: [`LIBRARY_ARCHITECTURE.md`](../governance/LIBRARY_ARCHITECTURE.md) §1d for that exemption, and
> [`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md) §3c for the optional build peer
> dependencies.

---

## 0. Quick Reference

- §1 Assets Namespace: declaring and discovering the pipeline config
- §1a defineAssetsConfig — Schema and Validation: the canonical entry point
- §1b AssetsConfig Type Shape: who owns the field list, and the one field readers mis-guess
- §1c loadConfig — Config Resolution: resolving `assets.config.ts` against cwd, and why you should pass it
- §2 assets/build Pipeline: the build functions and change detection
- §2a Build Functions — Orchestration: `buildAll`, the per-stage functions, and the absence of globs
- §2b Hash and Change Detection: opt-in content hashing, and why the state helpers go unused
- §3 assets/manifest: resolving logical names to hashed paths
- §3a createManifest — Content-Hashed Paths: a record and a prefix, not a directory scan
- §3b createSpriteRegistry — Sprite Sheet URL Lookup: group name to sheet URL, and what it is not
- §4 cli Namespace: the dependency-free command framework
- §4a Commands Are Values: a tree built from data, not registered by side effect
- §4b Flags Are a Typed Record: two types, inference instead of casts
- §4c Errors Carry a Kind, Not an Exit Code: why failure is always exit 1
- §4d CommandBase and Command Are Not Mergeable: the variance that forces two interfaces
- §5 pkg Namespace — Project Tooling: the blessed release path and the published gate
- §5a createReleaseCommand — Automated Release Workflow: the ordered steps and the refusals
- §5c Git and Manifest Internals: the unpublished helpers the two factories are built from
- §5d Changelog Promotion — the Unreleased Contract: what release does to `CHANGELOG.md`
- §5e Changelog Gate Invariants: what is checked before a release, and what deliberately is not
- §5f createGateCommand — the Published Verification Gate: one runner, one table per project
- §5g cloudflareWorkerSteps — the Fleet Preset: a step-table factory, not new machinery
- §5h Roots Are Stated or Derived, Never Discovered: no function walks the disk to find the project
- §5i Checks Are Functions, Not Scripts: the published validators and the verb vocabulary
- §6 Generated Assets Module: the git-ignored artifact the build exists to write
- §6a The Ordered Stages and the Two Codegen Passes: why codegen straddles `buildJS`
- §6b Build and Types Artifacts Are Shape-Identical: the header split and the idempotent write
- §6c The Emitted Glyph Union — the ForgeIcon Seam: the name a consumer spells in type position

---

## 1. Assets Namespace

### 1a. defineAssetsConfig — Schema and Validation

`defineAssetsConfig` is the canonical entry point: call it in an `assets.config.ts` at the
project root and export the result as default. `src/assets/README.md` carries the example.

**It types, it does not validate.** It is the identity function over `AssetsConfig`; the schema
runs in `loadConfig`, which `v.parse`s the imported module into a `ResolvedConfig` with every
optional field defaulted. A mistyped config therefore fails at *load* time, in the CLI — the
only point at which a config file can be checked at all, since nothing imports it before then.

`paths.publicDir` is the single output root; every artifact lands under it, including JS
bundles, whose subdirectory is per-bundle (`js.bundles[].outdir`) rather than global.
`paths.publicPrefix` is the URL prefix the manifest resolves against (§3a).

### 1b. AssetsConfig Type Shape

**The config shape is owned by `src/assets/types.ts`** — the valibot schemas there *are* the
type, via `InferInput`, and `src/assets/README.md` carries the field-by-field reference. This
document enumerates none of it: a second copy of a field list is indistinguishable from an
amendment the moment the two disagree.

One field is named here because readers reliably guess it wrong: **`sprites` is a record of
named groups, and a group lists its files explicitly** — `sources[].path` plus `sources[].files`
— with **no glob anywhere in the pipeline** (§2a).

### 1c. loadConfig — Config Resolution

**`loadConfig` resolves its argument against `process.cwd()`; it does not search.** An omitted
argument means `assets.config.ts` in the current directory and nothing more — no walk up the tree,
and a run from a subdirectory does not find the root's config. Every app in the fleet passes
`--config` explicitly, so the fallback is effectively unused. **Prefer passing the path**: it is
the difference between a build whose inputs are stated and one whose inputs depend on where the
command was typed. §5h states the rule this is an instance of.

---

## 2. assets/build Pipeline

### 2a. Build Functions — Orchestration

| Function | Runs |
|---|---|
| `buildAll` | Every configured stage, in the order §6 fixes, then the generated module and `_headers` |
| `buildCSS` | One Tailwind CLI build per `css[]` entry |
| `buildJS` | One esbuild bundle per `js.bundles[]` entry, into that bundle's own `outdir` |
| `buildSprites` | One sheet per named sprite group, from its explicit `sources[].files` list |
| `copyAssets` | Each `copy[]` rule, `from` → `to` |
| `buildFonts`, `buildIcons`, `buildCursors` | The font downloads, the rasterised icon outputs, the baked cursor values |

Signatures live in `src/assets/README.md`; none of these takes the whole config — each takes its
own slice plus an output directory.

**There is no glob.** A sprite group names every file it contains: a `sources[].path` (a
directory or an `http(s)` base) and a `files` list of bare names or `{ key, file }` pairs. A
missing local file is a warning and a skipped symbol, not a failure, and a group producing no
symbols writes nothing. The consequence is the point — the symbol set is stated in the config,
so the glyph-name union generated from it (§6) changes only when a human edits that list, where
a glob would let a file appearing on disk silently widen a published type.

`buildAll` is the standard entry for CI and `package.json` scripts. The per-stage functions exist
because the CLI exposes each as its own subcommand, so a developer can rerun one stage alone.

### 2b. Hash and Change Detection

Content hashing is one SHA-256 digest truncated to its first 8 hex characters, and it is
**opt-in with `--minify`**: an unhashed build emits logical filenames and the manifest maps each
key to itself. Hashes are taken from the *emitted* file, not its sources, so an output that
compiles to identical bytes keeps its URL — and the `_headers` file `buildAll` writes claims
`immutable` only when hashing was on.

**The incremental-state helpers in `src/assets/build/state.ts` are published but unused by the
pipeline.** No forge build path calls them, and `buildAll` re-runs every configured stage
unconditionally. Their contract is a state file the *consumer* names — forge bakes in no path
and writes no build state of its own. What makes a repeat build cheap for the one artifact that
matters is the skip-if-identical write in §6, not stored hashes.

---

## 3. assets/manifest

### 3a. createManifest — Content-Hashed Paths

**`createManifest(data, prefix)` reads nothing.** It takes the logical-to-emitted mapping as a
plain record plus a URL prefix, and returns a `Manifest` whose single method is
`path(key) => string`. No filesystem, no directory listing — which is what makes it legal in a
Worker at all: the mapping is baked into the generated module at build time (§6) and the runtime
only looks up. That module exports one `assets` instance, so views import it rather than
constructing a manifest of their own.

An unmapped key resolves to itself under the prefix rather than throwing. An unhashed dev build
has no mapping to speak of, and a missing entry must degrade to the logical URL — a 404 a
developer can read — rather than a 500 on a page that merely referenced a new file.

### 3b. createSpriteRegistry — Sprite Sheet URL Lookup

**`createSpriteRegistry(sprites, manifest)` resolves a sprite *group name* to that sheet's
public URL** — `get(name) => string`, delegating to `manifest.path`. It parses no SVG and knows
nothing about symbols; an unknown group name **throws**, because a sprite URL that silently
resolves to nothing renders every glyph on the page as an empty `<use>`.

Symbol-level data has two other homes: the per-symbol `viewBox` is generated into the `*_META`
const at build time (§6), and a glyph's inner markup at runtime is
`@y-core/forge/ui/assets/glyphs` (`src/ui/README.md`).

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
`createGateCommand` (§5f) both return a command from a config whose first field is `cwd`; the
`bin.ts` a package script points at resolves `cwd` and calls `execute`. Both ship from
`@y-core/forge/pkg` — a factory reachable only from a repository's own binding is a script
wearing a factory's clothes.

### 4b. Flags Are a Typed Record

**Flags are a record keyed by long name, not an array of definitions.** The key *is* the `--long`
form and `short` is a field on the definition, so a flag cannot be declared with a name that
disagrees with the one that reads it.

**There are two flag types — `"boolean"` and `"string"`.** `ResolvedFlags<F>` derives the handler's
flag argument from the declaration: a `string` flag with a `default` or `required: true` resolves
to `string`, every other `string` flag to `string | undefined`, and a boolean to `boolean`. No
handler casts, and a renamed flag fails to typecheck at its reader.

**Number parsing, repeated flags, and array values are deliberately absent.** A numeric flag is a
string plus the caller's own validation, which keeps the parser total — it has no way to fail on
input it was handed; a list is a comma-joined string the command splits, which is why the gate
runner takes `--only lint,typecheck` rather than a repeated flag.

### 4c. Errors Carry a Kind, Not an Exit Code

**`new CliError(kind, message)`** — the discriminant is a `CliErrorKind`, and no error carries an
exit code. `execute` catches every error, prints it to stderr via `formatError`, and exits **1**.

**Exit status is a two-valued contract: 0 is success, 1 is failure.** Anything a numeric code might
have encoded belongs in the `kind` or the message, where a reader and a test can both see it. A
command needing a different code — or needing to exit *without* the `Error:` prefix — calls
`process.exit` itself; the gate does that so its summary line is the last thing printed.

### 4d. CommandBase and Command Are Not Mergeable

**`CommandBase` and `Command<F>` are near-identical on purpose and must stay separate.** `run` takes
its flags as a parameter, so `F` is contravariant and `Command<F>` is invariant in it — a tree of
differently-flagged commands has no common `Command<…>` to be typed as. Tree links are therefore
`CommandBase`, which declares no `run`, and `execute` recovers the handler through the
`CallableCommand` cast, the one place that invariance is discharged.

---

## 5. pkg Namespace — Project Tooling

**`pkg` owns both project verbs — release *and* verification.** The namespace is what a project's
tooling commands are built from, not release automation alone. Its layout follows the split:
`release/` and `gate/` hold the two factories, `internal/` holds what only serves them, and
`mod.ts` is the one barrel over all three — the subdirectories are plain directories of concrete
files, since [`NAMESPACE_DESIGN.md`](../governance/NAMESPACE_DESIGN.md) §1a forbids a barrel
importing a barrel.

**What the barrel publishes is decided by one question: would a consuming app plausibly call this
itself?** A symbol that exists only to serve the two command factories stays out of `mod.ts` —
the git and `package.json` helpers in `internal/` (§5c), the gate's formatters (§5f). The test is
the *caller*, not difficulty or stability: a helper is unpublished because nobody outside would
reach for it.

### 5a. createReleaseCommand — Automated Release Workflow

**`createReleaseCommand(config, deps?)` takes a config object, not a program.** `cwd` is
required; `tagPrefix` defaults to `"v"` and `stageFiles` to what the release wrote (see below).
The second parameter is the injected dependency set, present so the command is testable —
production callers pass one argument.

It builds a `release` subcommand that, in order: refuses a dirty working tree, resolves the next
version, reaches a verdict on the changelog and promotes it in memory (§5d), prints the previous
and next versions with the tag and what the promotion would write, refuses to re-tag, updates
`package.json`, writes the promoted changelog, commits, and creates the tag. **It is the only
blessed way to cut a forge release**, and **all three places a version lives are computed here** —
the git tag, the `package.json` field, the changelog's version heading. A hand-typed version
anywhere is a defect, and §5e is the gate that says so.

**It never pushes.** The last thing it prints is the push command for a human to run, so the
irreversible step — publishing a tag to a remote — stays a deliberate act.

**The commit is atomic, and the default is what makes it so.** `stageFiles` defaults to exactly
what this command wrote — `package.json`, plus `changelogFile` when a changelog was promoted — so
the bump, the promoted section and the tag are one commit rather than a bump commit chasing a
prose commit. A project with no changelog stages `package.json` alone, because `commit` runs
`git add` and naming a path that does not exist would fail the release outright.

**`stageFiles` is an override, not an addition.** Naming it replaces the derived list. It exists
for what a release touches *beyond* its own writes — a lockfile, a monorepo's sibling manifests,
a version constant in source — and those callers state the full list deliberately.

Four refusals are guards, not conveniences:

| Refusal | Why, and when it is reached | Override |
|---|---|---|
| Dirty working tree | Checked before anything is resolved, so a half-finished change cannot ship | `--allow-dirty`, which defeats the guard's only purpose |
| Tag already exists | Checked after the version is resolved, so a botched release cannot be re-cut over its own tag | none |
| Nothing to release | No commits since the latest tag; reports "already at" and stops. `package.json` disagreeing with the tag there is an error, not a bump | none |
| Empty `[Unreleased]`, with commits since the tag | Shipping a release nobody wrote a line for is the drift the changelog prevents | `--allow-empty-changelog` (§5d); a *malformed* changelog is a separate refusal no flag reaches |

**A refusal `throw`s a `ReleaseError`; it does not call `exit`.** `execute` renders any `Error`
as `Error: <message>` and exits 1 (§4c), so the operator sees the same output while the guard
stays reachable from a test that mocks no process. **The changelog verdict is reached after the
version is resolved** — it has to know whether commits exist — **and before `package.json` is
written**, so no mutation can precede a refusal.

**`--dry` prints the resolved version and what would be promoted, then stops before any write.**
It skips the clean-tree check too, so it is safe to run at any time — but it resolves from
`<latest-tag>..HEAD`, so running it *before* committing reports "nothing to release" rather than
the version a release would produce. Commit first, then dry-run.

**The bump is the highest one any commit in `<latest-tag>..HEAD` asks for**: a `major:` subject
prefix bumps major, a `minor:` prefix bumps minor, a range with neither is a patch. Scanning the
whole range rather than the tip is the point — a cycle holding a `major:` commit followed by
`fix typo` must not ship as a patch. An explicit version as the command's single positional
argument overrides the scan, and is rejected unless it is greater than the current tag.

### 5c. Git and Manifest Internals

**The git and `package.json` helpers in `src/pkg/internal/` are unpublished.** They exist to
serve the two command factories and nothing else. A consumer that needs `git tag` has `git`; what
forge publishes is the *policy* over it — the ordered, refusing release command — not a thin
`execFileSync` wrapper it would have to reimplement the policy around. `checkExports` enforces
the line: an `@public` tag on any of them fails the gate until it is either exported or retagged.

**Every one of them takes `cwd` first.** These shell out to `git`, and a git command with no
working directory is a command against whatever directory the process happens to be in — so
the caller states it rather than inheriting it.

**`getCommitsSinceTag` stays on `--oneline` rather than a bare subject format**, and the bump
scan strips the abbreviated sha itself. The helper answers two questions at once — what the
subjects are, and whether the range holds anything at all — and a subject-only format would emit
an empty line for a commit with an empty subject, which the emptiness filter drops. A range of
such commits would then read as "nothing to release", the worse failure of the two.

### 5d. Changelog Promotion — the Unreleased Contract

**`[Unreleased]` is the staging area, and the only section a human edits.** Release promotes it:
the heading is retitled in place, a fresh empty `[Unreleased]` is inserted above it, and a link
reference definition is appended. Everything below the insertion point is byte-for-byte
unchanged, which is why a document ending without a newline round-trips exactly, and why
`writeChangelog` normalises nothing.

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

`--allow-empty-changelog` is for a genuinely entry-free tooling release, and two properties keep
it from becoming routine. **It does not license a malformed document** — an unparseable changelog
is a separate refusal with no escape, because promotion has nothing to act on. **It still
promotes**, so the section ships as a permanent `_Nothing yet._` entry in the released record;
skipping promotion would leave the topmost released heading behind `package.json` and fail §5e on
the next `verify --full`.

**The link reference definition is best-effort.** Its base URL comes from `package.json`'s
`repository` field, normalised by stripping a `git+` prefix and a `.git` suffix. Absent or
unusable, the definition is omitted and the promotion still succeeds — a consumer with no known
remote must still be able to release. A first release omits it too: a compare link to nothing is
worse than none. Reading the URL from `git remote get-url` was rejected — it breaks in a clone
with a renamed remote, and it puts a subprocess on a path that is otherwise pure metadata.

**`src/pkg/release/changelog.ts` returns its failures instead of throwing, diverging from the
`ReleaseError` style of the rest of the namespace.** The divergence is the gate's doing: §5e must
report every malformed heading in one run, and an exception stops at the first. The module is
also import-free — no clock, no filesystem, no git — so `release.ts` converts a returned failure
into a `ReleaseError` at its own boundary and the file I/O lives with the other readers in
`src/pkg/internal/pkg-json.ts`.

### 5e. Changelog Gate Invariants

**`CHANGELOG.md` is checked by a `fullOnly` gate step** — `config/steps.ts` owns the step table
(see [`TESTING.md`](./TESTING.md) §6). Requiring a written `[Unreleased]` entry on every fast run
would fail every work-in-progress commit; `verify --full` runs exactly where the invariant bites,
before `prepublishOnly` and before a tag exists.

**It imports the parser from `src/pkg/mod.ts` rather than adding a second changelog parser.**
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

A heading with *no* link definition is a warning only — promotion writes the definition, and some
entries legitimately lack one.

Three things are deliberately not checked, each because the file disproves them: **`---`
separators between sections** (not a per-section invariant — consecutive released versions carry
none), **version contiguity** (a resolved version that never shipped leaves a hole the next
compare link simply spans), and **a trailing newline** (the file has none, and promotion
round-trips that exactly, §5d).

### 5f. createGateCommand — the Published Verification Gate

**One runner, one table per project.** The runner is published; the table is not. That split is the
whole design: five repositories share the selection logic, the fail-fast ordering, the `requires`
probe and the full-log file, while each keeps its own steps as its own source of truth — forge's in
`config/steps.ts` (see [`TESTING.md`](../governance/TESTING.md) §6a).

**The bin is the entry point; the factory is the escape hatch.** `forge-verify` resolves
`config/steps.ts` (or `--config`) and delegates to `createGateCommand`, so a project needs no
binding file of its own. The factory stays published for the case the bin cannot serve — a table
assembled at run time, or a gate embedded in a larger CLI.

| Field | Type | Default | Description |
|---|---|---|---|
| `cwd` | `string` | — | Repository root. Every step is spawned here, so a step's relative paths resolve. |
| `steps` | `readonly Step[]` | — | The table to resolve against. |
| `binDir` | `string` | `${cwd}/node_modules/.bin` | Prepended to `PATH` so bare tool names resolve. |

**One command, two modes — not two commands.** `verify` runs the fast set; `verify --full` adds
the `fullOnly` steps. Two verbs sharing every flag and differing only in a membership filter is a
mode by definition, and modelling it as two verbs costs a duplicated binding file per repo, a
`gate` config field, and a superset invariant that must be *tested* rather than being true by
construction.

**`GateMode` is a closed `"fast" | "full"` union, and `Step.fullOnly` is a boolean.** Together they
carry the prerequisite invariant [`TESTING.md`](../governance/TESTING.md) §6c exists to settle: a third mode
would have no defined answer to "may this step require a browser?", and a *list* of modes would let
a table express a step that a fast run has and a full run does not. Neither is a restriction the
runner enforces at runtime — both are shapes that make the wrong thing unsayable.

**`binDir` is a de-hardcoding, not a feature.** Its default is `${cwd}/node_modules/.bin`, but apps
that invoke tools as `bun x biome` need a different prefix, and one config field is cheaper than
five forks of the runner. The temp-directory prefix behind the full-log file stays hardcoded —
configuring it would be surface for nothing.

**The formatters in `src/pkg/gate/report.ts` stay unpublished.** Publishing them would freeze the
exact glyphs and wording of every gate line across five repositories, and would hand the next
repository the parts to build an alternate runner from — the fork this consolidation removed.

**`selectSteps` *is* published**, because it is pure — an app unit-tests its own table against it
at zero step cost, the same argument that makes forge's `steps.test.ts` worth having.

**Step sets, an `--inspect`/streaming mode, and a preconditions phase are deliberately absent.**
The published surface is exactly `--only`, `--list`, `--fix`, fail-fast, the `requires` probe and
the full-log file. Narrowing a run means enumerating labels; a streamed run is `--list` and then
the step's own command.

### 5g. cloudflareWorkerSteps — the Fleet Preset

**A preset is a factory returning ordinary `Step` rows, not a second kind of table.** It is spread
into the app's own array and appended to; an app that outgrows it writes the rows out by hand and
loses nothing. Nothing in the runner knows a preset exists.

**Generation leads judgement**: the two `wrangler types` steps and the asset-types emitter all
write files `typecheck` then reads, so they precede it — a stale binding type surfaces as a type
error rather than as a green run over yesterday's bindings.

**The two `wrangler types` invocations are two steps, not one** — `--no-include-env` for the
runtime half, `--no-include-runtime` for the bindings half — because `Step.cmd` is one executable,
not a shell line, and splitting them is what a chained `&&` costs back: a failure names which
invocation broke. `--config` goes on the bindings invocation only, since runtime types do not
depend on the wrangler config.

**The options are the fleet's actual disagreements, and nothing else.** `assetOut` exists because
the emitter writes nothing useful without `--out`; `wranglerTypes: false` exists because one app
declares its binding types by hand. The two `.types/` paths are baked in — an option nobody varies
is surface for nothing, the same argument that keeps the runner's temp-dir prefix hardcoded (§5f).

**`presets.test.ts` pins every emitted command verbatim.** The preset's contract is "these are the
commands the fleet runs", which is only assertable literally — a table that type-checks but names a
command no app can run is a preset nobody can adopt, and no structural assertion catches it.

**Every preset step is prerequisite-free**, so the whole preset is legal in a fast run
([`TESTING.md`](../governance/TESTING.md) §6c). A `requires` added to any of them would break that
for every app at once, which is why `presets.test.ts` asserts the absence as a property.

`assetConfig` is optional and omitting it drops the `types:assets` step entirely — an app with no
asset pipeline gets a four-step table, not a step that succeeds vacuously.

### 5h. Roots Are Stated or Derived, Never Discovered

**No function in `pkg` walks the disk to find out where the project is.** Not upward, not by
probing for a marker file, not at all. A root arrives one of exactly two ways:

- **Stated.** The caller passes it; forge's own bindings do this from `import.meta.url` (`ROOT` in
  `config/steps.ts`).
- **Derived.** `installedAppRoot()` takes this module's own path and returns everything before its
  first `node_modules` segment — pure string arithmetic, reading no directory. When forge is
  installed under `<app>/node_modules/…`, that text *is* `<app>`.

`resolveAppRoot(explicit?)` is the one entry point: stated wins, derived is the fallback, and when
neither is available **it throws**.

**Why the refusal rather than a `process.cwd()` default.** A cwd default makes the answer depend on
which directory the command was typed in, and the failure that produces is not a crash: it is a
check that walks a tree containing nothing it recognises and reports the same green as a check
that walked the right tree and found no problems. Every guard in this gate exists to separate
those two outcomes; a discovered root quietly re-merges them.

**Why not a walk-up.** An upward search for `package.json` finds *a* project, not necessarily
*this* one — a monorepo package, a `node_modules` entry, or a parent checkout all answer, and it
succeeds, so nothing signals that the wrong tree was chosen. Deriving from the install path cannot
pick a different project, because the path is the install.

**The first `node_modules` segment, not the last.** A nested install and a pnpm store path both
place the consuming application before the first occurrence; every later one names a dependency's
own root, so splitting on the last would report the dependency as the app. The derivation is
`findAppRoot(modulePath)`, a separate pure function precisely because `import.meta.url` cannot be
varied from a test — folded into `installedAppRoot` it would be unassertable.

**A linked install is the case the derivation cannot answer, and `--root` is how the caller
states it.** A `file:` dependency installs as symlinks into the forge checkout and every runtime
resolves `import.meta.url` to the realpath, so this module reports itself under `src/cli/` with no
`node_modules` segment left to split on. The derivation returns `undefined`, correctly: the path
has stopped naming the consumer. Every `forge-assets` command therefore carries `--root`, falling
back to `FORGE_APP_ROOT`, with an empty value treated as absent so an exported-but-unset variable
cannot resolve every path against `/`. This is the *stated* branch, not a third one — reading
through the symlink is the walk this section rules out, and it would answer for a `file:`
dependency of a dependency exactly as confidently as for the app.

### 5i. Checks Are Functions, Not Scripts

**Every validator the gate runs is a published `checkX(config)` returning findings.** A validator
kept in a repository-local script directory is unreachable through the `exports` map, so a consuming
app would get a step table with nothing to put in it — publishing the runner while withholding the
steps is a half-measure this namespace refuses.

A check is built in layers, and the **prefix states which one a function is**:

| Prefix | Purity | Shape |
|---|---|---|
| `parse*` / `find*` | pure | text → data. No disk, no root, no path. |
| `validate*` | pure | data → `Finding[]`. Every policy decision lives here. |
| `resolve*` | impure | config → files or contents. Walks disk, judges nothing. |
| `check*` | impure | config → `CheckResult`. Orchestrates the three above. |
| `format*` | pure | findings → strings. |

`check*` is the only entry point a consumer needs; the rest are the seams that make one assertable
without a filesystem or a subprocess. `src/pkg/mod.ts` is authoritative over which checks are
published, and this document enumerates none of them.

**`ok` is derived from the findings, never passed.** `checkResult(findings, summary)` computes it,
so "a check that reports a failure and forgets to flip a flag" is not expressible. **`summary`
always carries a count** — `0 .tsx files carry every pragma` is a *visible* nothing-happened, and a
silent green is indistinguishable from a check that walked nothing.

**Two levels, not a scale.** `fail` fails the check; `warn` is reported and does not. A third level
invites "does `major` fail the gate?", which is the question a level should answer.

**Every check takes an explicit `root` (§5h) and every forge-specific allowlist as config**, which
is what keeps it from being forge's script wearing a config parameter. **That configuration lives
in the consuming repository's `config/steps.ts`**, beside the step table: that file already answers
"what does this repository's gate do?", so a step is one entry in it — the builder for the check,
and the config it runs with.

---

## 6. Generated Assets Module

**The build's real product is a TypeScript file.** `buildAll` and `forge-assets types` both end by
writing one module — carrying the manifest mapping, one `viewBox` const per sprite group, one
bound icon component per group, and the glyph-name union those components are typed on.
Everything the runtime knows about the build, it knows by importing that module; nothing reads the
output directory. `src/assets/README.md` owns how to author against it.

**The path is `.forge/assets.ts` unless `--out` overrides it, and the directory is git-ignored.**
Every content hash in it churns on each production build, so committing it would put a file no
human edits into every diff and would let a stale copy typecheck green against assets absent from
the current build. A consuming app aliases it as `@assets` and regenerates it with
`forge-assets types`.

### 6a. The Ordered Stages and the Two Codegen Passes

**`src/assets/build/pipeline.ts` owns the stage sequence** and is authoritative over it. Two
properties of the order are decisions rather than incidents:

- **Codegen runs twice, before and after `buildJS`.** esbuild resolves the `@assets` alias while
  bundling, so a bundle importing the manifest needs the module to *already exist* — the first
  pass exists solely to make the second pass's inputs bundleable. The second pass then rewrites it
  with the JS bundle keys the first pass could not know.
- **Cursors run after CSS.** Baking a cursor value means reading the emitted stylesheet for the
  custom properties it resolved, so the CSS stage must have produced a file the manifest can name.

The first pass is why a *clean* checkout still typechecks: `forge-assets types` (§6b) writes the
same module from the config alone, so `tsc`/`tsgo` never depends on a toolchain having run.

### 6b. Build and Types Artifacts Are Shape-Identical

`generateAssetsModule` is one template with a swappable header, and both entry points go through
it: `buildAll` passes `BUILD_HEADER`, `generateAssetsTypes` passes `TYPES_HEADER` and a manifest
synthesised from the config with every value a placeholder — each logical name mapped to itself
and every `viewBox` the empty string.

**The invariant is that the two artifacts differ only in values, never in shape** — same exports,
same group consts, same `createIcon` calls, same union members. It has to hold, because a
typecheck run against the types-only artifact is asserting about the build artifact, and a shape
difference would let a green typecheck ship against a module the build emits differently. The
headers keep a human from mistaking one for the other: the types-only header says in plain words
that every path is unhashed and every `viewBox` empty.

**The write is skipped when the content is byte-identical.** Codegen compares against the file on
disk and returns without writing, so an unchanged build does not touch the mtime — which is what
keeps the twice-per-build codegen from retriggering every watcher, typechecker, and dev server
downstream of it.

### 6c. The Emitted Glyph Union — the ForgeIcon Seam

Per sprite group, codegen emits a **glyph-name union** — `${Pascal}IconName`, whose members are
the group's symbol keys with the group's prefix stripped — alongside the `*_META` const and the
`${Pascal}Icon` component bound to it. The union is derived from the same `meta` keys
`createIcon` narrows its `name` prop against, so the two cannot disagree.

**It exists to be usable in type position.** `createIcon` already infers the narrow component
type at the *value* site, but a consumer writing a props interface — `icon: ForgeIcon<G>` — needs
the union as a name it can spell. Without one it hand-maintains a literal union beside the sprite
config, a second copy of the glyph list that drifts the first time a glyph is added. `ForgeIcon`
declares no default for its parameter, so the widening a missing union invites does not compile
([`CODE_REVIEW.md`](./CODE_REVIEW.md) §3b).

Forge's own glyph list is a separate fact with its own owner: `src/ui/assets/sprites.ts`
enumerates it as `ForgeUiIconName`, because forge's components must name the glyphs they require
without depending on any consumer's generated module.
