---
title: Build Tooling
description: "The dependency-free CLI framework, the published verification gate and its check contract, and the automated release workflow."
audience: internal
---

# Build Tooling

> Owns forge's developer-facing command surface: the CLI framework (`tooling/cli`), the verification gate (`tooling/gate`), and the release workflow
> (`tooling/release`). Everything under `src/tooling/` runs on a developer's machine, never in a Worker; membership in that container _is_ the
> exemption from the Web-APIs-only rule ([`NAMESPACES.md`][namespaces-4a] §4a).
>
> Defers to: [`ASSET_PIPELINE.md`][ap] for the asset build these commands drive and the generated module it writes;
> [`LIBRARY_ARCHITECTURE.md`][la-1d] §1d for that exemption; [`TESTING.md`][canon-testing-6] §6 for the gate's tiers and flags.

---

## 0. Quick Reference

- §1 tooling/cli Namespace: the dependency-free command framework
- §1a Commands Are Values: a tree built from data, not registered by side effect
- §1b Flags Are a Typed Record: two types, inference instead of casts
- §1c Errors Carry a Kind, Not an Exit Code: why failure is always exit 1
- §1d CommandBase and Command Are Not Mergeable: the variance that forces two interfaces
- §2 tooling/gate and tooling/release — Project Tooling: the blessed release path and the published gate
- §2a createReleaseCommand — Automated Release Workflow: the ordered steps, the refusals, the resume states, and where the commit and tag are cut
- §2b The Export Surface a Release Compares: the symbol set behind the shrink guard, and what it ignores
- §2c Git and Manifest Internals: the unpublished helpers the two factories are built from
- §2d Changelog Promotion — the Unreleased Contract: what release does to `CHANGELOG.md`
- §2e Changelog Gate Invariants: what is checked before a release, and what deliberately is not
- §2f createGateCommand — the Published Verification Gate: one runner, one table per project
- §2g cloudflareWorkerSteps — the Fleet Preset: a step-table factory, not new machinery
- §2h Roots Are Stated or Derived, Never Discovered: no function walks the disk to find the project
- §2i Checks Are Functions, Not Scripts: the published validators, the verb vocabulary, and what a drift check compares
- §2j Task Branches and the Amend Floor: a branch per task in the clone, one squashed commit per push on `main`, and what may still be rewritten
- §2k `dev:forge` Is Asked For, Never Automatic: why replacing a consumer's installed forge is a command and not a hook
- §2l A Forge Release Never Waits on a Consumer: why the release gate is `verify:scheduled` alone, and where component coverage is checked
- §2m The Bun Floor Is the Bun the Gate Runs On: why `engines.bun` equals `packageManager`, and what raising it takes
- §2n A Node-Reached Export Is Declared Under `forge.node`: the one list every bundle, drift row and check is derived from
- §3 The Compatibility-Flag Posture Every Forge App States: the flags, and why a compatibility date is not a posture
- §3a What the Check Reads, and the Trap It Exists For: why every `env.*` block is judged on its own

---

## 1. tooling/cli Namespace

Signatures, worked examples and the flag-parsing table live in `src/tooling/cli/README.md`. This section carries only the decisions behind them.

### 1a. Commands Are Values

**`createCommand` takes a config object and returns a command; nothing is registered by side effect.** A tree is data a caller holds, so it can be
built, inspected and driven to completion without a process, which is why forge's own CLIs are covered by ordinary unit tests rather than by
spawning themselves.

**A gate or build verb is therefore a factory, not a script.** `createReleaseCommand` (§2a) and `createGateCommand` (§2f) each return a command from
a config whose first field is `cwd`; the `bin.ts` a package script points at resolves `cwd` and calls `execute`. Both ship from
`@y-core/forge/tooling/gate` — a factory reachable only from a repository's own binding is a script wearing a factory's clothes.

### 1b. Flags Are a Typed Record

**Flags are a record keyed by long name, not an array of definitions.** The key _is_ the `--long` form and `short` is a field on the definition, so
a flag cannot be declared under a name that disagrees with the one that reads it.

**The flag types are `"boolean"` and `"string"`, and `ResolvedFlags<F>` types the handler's argument from the declaration**, so no handler casts and
a renamed flag fails to typecheck at its reader. **Number parsing is deliberately absent**: a numeric flag is a string the caller validates, which
keeps the parser total.

**A repeatable flag is opt-in per definition, and repeating an unmarked one is refused** rather than overwritten last-wins, because silently
discarding an argument the caller typed is the failure a parser exists to prevent. `multiple: true` opts in, and its type is `ResolvedFlags`'. **A
comma-joined string stays the default shape for a list** — the gate takes `--only lint,typecheck` and splits it — and `multiple` is for a value that
may itself contain a comma.

### 1c. Errors Carry a Kind, Not an Exit Code

**`new CliError(kind, message)`** — the discriminant is a `CliErrorKind`, and no error carries an exit code. `execute` catches every error, prints
it to stderr via `formatError`, and exits **1**.

**Exit status is a two-valued contract: 0 is success, 1 is failure.** Anything a numeric code might have encoded belongs in the `kind` or the
message, where a reader and a test can both see it. A command needing a different code — or needing to exit _without_ the `Error:` prefix — calls
`process.exit` itself; the gate does that so its summary line is the last thing printed.

### 1d. CommandBase and Command Are Not Mergeable

**`CommandBase` and `Command<F>` are near-identical on purpose and must stay separate**: `run` takes its flags as a parameter, so `Command<F>` is
invariant in `F` and a tree of differently-flagged commands has no common type. Tree links are `CommandBase`, and the `CallableCommand` cast in
`execute` is the one place that invariance is discharged.

---

## 2. tooling/gate and tooling/release — Project Tooling

**The two project verbs are two namespaces, and `tooling/release` sits on top of `tooling/gate`.** The gate is the lower layer: besides its own
command factory, steps and checks, it owns the changelog parser, the semver arithmetic and the barrel parser, because the release workflow and the
gate's changelog and export-surface checks both read them. The dependency the other way round made the two namespaces name each other at value,
which `validateNoValueCycles` rejects.

**What the barrel publishes is decided by one question: would a consuming app plausibly call this itself?** A symbol that exists only to serve the
command factories stays out of `mod.ts` — the git and `package.json` helpers (§2c), the gate's formatters (§2f). The test is the _caller_, not
difficulty or stability.

**A prebuilt-JavaScript subpath is a generated copy of its source, so nothing is ever added to it by hand** — its drift check fails on the
difference ([`NAMESPACES.md`][namespaces-3c] §3c).

### 2a. createReleaseCommand — Automated Release Workflow

**`createReleaseCommand` takes a config object, not a program**, with its dependencies injected so the command is testable. Its `release` subcommand
runs in `src/tooling/release/release.ts`'s order, held to one rule: every guard, and for a fresh release the gate, comes before the first write.
**It is the only blessed way to cut a forge release**, and **every place a version lives is computed here** — the git tag, the `package.json` field,
the changelog's version heading. A hand-typed version anywhere is a defect, and §2e is the gate that says so. **It pushes nothing but a release tag,
and only under `tagOn: "pushed"`**: once the checks below pass it pushes `refs/tags/<tag>` to `origin` and no branch, and it prints the host's
`git push && git push --tags`, so publishing to the public remote stays a deliberate act.

**`stageFiles` defaults to exactly what the command writes** — `package.json`, plus `changelogFile` when a changelog is promoted — so the bump and
the promoted section land in one release commit. A project with no changelog stages `package.json` alone, because `commit` runs `git add` and a path
that does not exist would fail the release. **`sectionsFile` is staged on every run that promotes a changelog, whatever `stageFiles` names**: the
section manifest is forge's own write, and `checkChangelog` refuses a version with no recorded digest. A run that promotes nothing neither writes
nor stages it. A tagged release may be missing a section only from the bottom, below the oldest heading.

**Every refusal is a guard, not a convenience.** [`src/tooling/release/README.md`][release-refusals] lists each with the flag that overrides it,
where one does; an override defeats exactly one guard, and a malformed changelog has none (§2d). **A refusal `throw`s a `ReleaseError` and never
calls `exit`** (§1c), so a test reaches the guard without mocking a process. **The changelog verdict comes after the version is resolved and before
`package.json` is written**, so no mutation precedes a refusal.

**The gate is `gateCommand`, defaulting to `bun run verify`**, and a consumer whose script is named otherwise states it in the optional config
module of `forge release` rather than passing `--allow-unverified` on every release, which is the guard permanently off. **The gate runs here, not
only in CI**: `.github/workflows/release.yml` fires `on: push: tags`, so a `verify:unit` failure there leaves a public tag with no asset,
recoverable only by deleting a published tag or burning the version. The branch check runs after the re-tag check and before the first write.

**The bump is the highest one any commit in `<latest-tag>..HEAD` asks for**: a `major:` subject prefix bumps major, `minor:` bumps minor, and a
range with neither is a patch. The whole range is scanned, not the tip, so a `major:` commit followed by `fix typo` does not ship as a patch. An
explicit version as the single positional argument overrides the scan, and is rejected unless it is greater than the current tag.

**A release is open until its tag exists, and every run re-derives it from git and the working tree.** Once V is resolved and the ancestry and push
checks pass, the run places the repository in one of five states. The release files are the ones forge writes: `package.json`, `changelogFile` and
`sectionsFile`.

| State | Recognised by | The run |
| --- | --- | --- |
| fresh | Nothing of V is written: `package.json` is not at V, and the changelog has no `[V]` heading | Guards, gate, write, then commit and tag |
| open | V is written, in the working tree or a commit, and is untagged, and HEAD is not a committed release with nothing changed since | Write what differs, gate, then commit what differs from HEAD and tag |
| committed | HEAD is forge's release commit for V — its subject, `package.json` at V, only staged paths and every release file — no release file differs from HEAD, and V's tag is absent | Gate unless the record covers it, then tag; with `tagOn: "pushed"`, print the push it waits on until the publishing branch carries it |
| pushed | With `tagOn: "pushed"`, nothing to commit, and after a fetch the publishing branch's tip carries HEAD's tree and the release subject | Gate unless the record covers it, tag that tip, push only the tag |
| tagged | V's tag exists | Reports V as already released and stops; when a reachable remote lacks the tag, prints `git push --tags` instead of refusing |

**An open release is rebuilt, not replayed.** `reopenRelease` folds `[V]`'s body back into `[Unreleased]`, merging by `###` subsection without
dropping a line, and `promoteUnreleased` cuts exactly one `[V]` from the result, so an entry added to either after the write lands in `[V]`.
`package.json` is the working file with `version` set to V, and the sections file is built from the rebuilt changelog. Only a file whose rebuilt
content differs is written, before the gate, so the gate runs over the bytes the commit carries. **The date changes only when the content does**: a
rebuild that reproduces the working changelog under `[V]`'s own date, with `[V]`'s body still matching its recorded digest, keeps the date; one that
folds in a new entry or finds `[V]`'s body edited takes today's.

**The release commit carries only the release files that differ from HEAD**, and when none differ HEAD is tagged with no commit. A staged path
outside the release files, such as a lockfile named in `stageFiles`, is committed only when the working tree changes it; any other changed path is
refused as `working-tree-dirty`, and `--allow-dirty` keeps its meaning. An open release still refuses:

- **An edit to what shipped**, as `release-partial`: `package.json` changed beyond `version`, or any released section other than `[V]`. Its recovery
  restores the file with `git show HEAD:./<file>`, which writes nothing to `.git` and overwrites nothing.
- **A second release before the first is finished**, as `version-mismatch`, naming the version to finish: an untagged version other than the
  resolved one is written in the working `package.json` or changelog, or committed at HEAD.
- **A second promotion**, at the lower layer (§2d): `promoteUnreleased` over an existing `[V]`, `reopenRelease` of a `[V]` that is not newest.

**A green gate is recorded, and a later run reruns it unless the record matches.** `.forge/release/<tag>.json`, under the ignored `.forge/`, binds
the version to the base tree, a hash of each staged file as committed, and the gate command. The base is HEAD's tree, or for _committed_ `HEAD^`'s
tree with HEAD's blobs. A squash keeps every tree and no sha ([`AGENT_WORKFLOW.md`][aw-5b] §5b), so the record survives the push. Forge only reads
the record, never executes it, and a record it cannot write is reported, not refused.

**When `.git` is read-only, the run stops before the commit and prints the host's steps** — printed, never written as a script, because a script the
workspace writes and the host runs is workspace code the host executes. Each set re-checks HEAD and the blob ids it commits before it writes, so it
is harmless to repeat; the output and the run sequence are [`src/tooling/release/README.md`][release-reopen]'s.

**Where the clone's push flow may replace the release commit's sha, `tagOn: "pushed"` tags the commit it pushed.** The mode is stated in the release
config. The run that commits cuts no tag, since the push may still replace the sha, and prints what it waits on: the commit reaches `main` as a task
under no epic, its own push unit (§2j), and the push's squash keeps forge's release subject verbatim. Only a run with nothing to commit fetches
`origin`, and it tags the tip of the branch the remote publishes from, never HEAD, once that tip carries HEAD's tree and the release subject, or the
tree alone where the release files were committed under another subject. With no override, it refuses as `publishing-mismatch` the release subject
over another tree, the gated tree under another subject, and a branch moved past the release commit, and as `wrong-branch` a missing publishing
branch. A refused tag push is `tag-push-failed`, and deletes the local tag again. The server accepts a create-only `v*` tag on a commit on `main`,
so the tag lands in the host checkout, `tag-unpushed` finds it there, and the host publishes with `git push && git push --tags`.

### 2b. The Export Surface a Release Compares

**The surface is a set of `<specifier>#<exportName>` pairs**, harvested from every `mod.ts` the `exports` map names as a target — the barrel parse
`checkExports` uses, not a second parser. `removedSurfaceSince` builds it at the latest tag, from `git show <tag>:<path>` (§2c), and from the
working tree, so a `--dry` run reflects uncommitted work. An entry the tag published and the tree omits is the finding.

**The bar is `auto-minor`, never `auto-major`.** A shrinking surface refuses an `auto-patch` and nothing else; `auto-minor`, `auto-major`, an
explicit version and a first release all pass. A major-version decision is too consequential for a heuristic over barrel names, so the check only
catches an accidental patch across the patch→minor line, which is where a `^` range silently breaks.

Deliberately not compared: **subpath patterns** (a `*` specifier names no barrel, and forge's patterns name publish files, not symbols),
**non-barrel targets** (anything but `.../mod.ts`), and **type-level narrowing** — a symbol surviving with a tighter signature needs a type checker,
not a name set, which is why the guard has an override rather than a veto.

**A subpath deleted from the map reports every one of its symbols as removed**, the honest reading of a symbol-keyed set, needing no extra
machinery. **A `package.json` the command cannot parse yields an empty set**, so the guard is a no-op rather than a new way for a differently-shaped
repository to fail its release.

### 2c. Git and Manifest Internals

**The git and `package.json` helpers in `src/tooling/release/` are unpublished**; they serve the two command factories and nothing else. A consumer
that needs `git tag` has `git`: what forge publishes is the _policy_ — the ordered, refusing release command — not a thin wrapper it would have to
reimplement the policy around. `checkExports` enforces the line: an `@public` tag on any of them fails the gate until it is exported or retagged.

**Every one of them takes `cwd` first**, because a git command with no working directory runs against whatever directory the process happens to be
in.

**`getCommitsSinceTag` stays on `--oneline` rather than a bare subject format**, and the bump scan strips the abbreviated sha itself. The helper
answers both what the subjects are and whether the range holds anything; a subject-only format emits an empty line for an empty subject, which the
emptiness filter drops, so a range of such commits would read as "nothing to release" — the worse failure.

**`readFileAtRef` returns `null` rather than throwing when the path is absent at the ref.** It reads a file out of history with `git show
<ref>:<path>`, and its caller (§2b) compares two points in time, where a barrel absent at the old tag published nothing then and so has lost nothing
since. Every other git failure collapses into the same `null`, which is acceptable because the guard is overridable: a surface it under-reports
blocks nothing.

### 2d. Changelog Promotion — the Unreleased Contract

**`[Unreleased]` is the staging area, and the only section a human edits.** Release promotes it: the heading is retitled in place, a fresh empty
`[Unreleased]` is inserted above it, and a link reference definition is appended. Everything below the insertion point is byte-for-byte unchanged,
which is why a document ending without a newline round-trips exactly, and why `writeChangelog` normalises nothing.

**The version heading grammar is exact, and the separator is an em dash (U+2014).** An en dash or a hyphen is a parse error, not a near miss,
because the two are indistinguishable in review and only one of them a machine can promote against:

    ## [0.0.83] — 2026-08-11

**The date is the releaser's local calendar day.** `toISOString()` reads UTC and would stamp tomorrow for an evening release in a positive-offset
zone; a changelog reader means the day the release happened where it happened.

**An `[Unreleased]` section is empty when it holds nothing but whitespace, `---` separators, or the literal `_Nothing yet._` placeholder** that
promotion writes. Empty plus commits since the tag is a refusal (§2a).

`--allow-empty-changelog` is for a genuinely entry-free tooling release. **It does not license a malformed document** — an unparseable changelog is
a separate refusal with no escape, because promotion has nothing to act on. **It still promotes**, so the release ships a permanent `_Nothing yet._`
entry; skipping promotion would leave the topmost released heading behind `package.json` and fail §2e on the next `bun run verify:scheduled`.

**The link reference definition is best-effort.** Its base URL is `package.json`'s `repository` field, stripped of a `git+` prefix and a `.git`
suffix. Absent or unusable, the definition is omitted and promotion still succeeds, so a consumer with no known remote can release; a first release
omits it too, since a compare link to nothing is worse than none.

<!-- rule:forge-release-no-remote-url --> A remote's URL breaks in a clone with a renamed remote, and reading it would put a subprocess on a path
that is otherwise pure metadata.

**`src/tooling/gate/changelog.ts` returns its failures instead of throwing**, unlike the rest of the namespace, because §2e must report every
malformed heading in one run and an exception stops at the first. The module is import-free — no clock, no filesystem, no git — so `release.ts`
converts a returned failure into a `ReleaseError` at its own boundary, and the file I/O lives with the other readers in
`src/tooling/release/pkg-json.ts`.

### 2e. Changelog Gate Invariants

**`CHANGELOG.md` is checked by a `static`-tier gate step** in the table `config/steps.config.ts` owns ([`TEST_RUNNERS.md`][testing-6] §6). It asks
nothing of `[Unreleased]` beyond its place, so an empty one passes and a work-in-progress commit is never held for an entry, while a drifted heading
or an edited released section is caught on the run that introduced it. **It imports the parser from `src/tooling/gate/mod.ts`**, the one release
promotes with: two parsers for one document is the drift the gate exists to catch.

Failing invariants:

- The grammar parses — one `[Unreleased]`, first, and every other entry heading well-formed.
- No version appears twice, and versions run strictly descending.
- Dates are non-increasing downward; equal dates are allowed and do occur.
- **The topmost released heading equals `package.json`'s version** — the drift detector, catching a heading hand-written for a version no tag was
  cut for.
- Every link reference definition names a heading that exists.
- **Every released section matches the digest the release recorded for it** in `config/changelog-sections.json`, and no digest outlives its section.
  `[Unreleased]` is the only section to write in.
- Every version whose tag exists, from the oldest heading up, still has a section. Only the oldest releases may be trimmed.

A heading with _no_ link definition is a warning only — promotion writes the definition, and some entries legitimately lack one.

Deliberately not checked, each because the file disproves it: **`---` separators between sections** (consecutive released versions carry none),
**version contiguity** (a resolved version that never shipped leaves a hole the next compare link spans), and **a trailing newline** (the file has
none, and promotion round-trips that exactly, §2d).

### 2f. createGateCommand — the Published Verification Gate

**One runner, one table per project.** The runner is published; the table is not. The fleet shares the selection logic, the fail-fast ordering, the
`requires` probe and the full-log file, while each repository keeps its own steps as its own source of truth — forge's in `config/steps.config.ts`
([`TESTING.md`][testing-6e] §6e).

**The bin is the entry point; the factory is the escape hatch.** `forge verify` resolves `config/steps.config.ts` (or `--config`) and delegates to
`createGateCommand`, refusing a module whose default is not a `defineSteps` table, so a project needs no binding file of its own. The factory stays
published for what the bin cannot serve — a table assembled at run time, or a gate embedded in a larger CLI.

**The tiers are [`TESTING.md`][testing-6a] §6a's, as one command**; separate verbs would cost a duplicated binding file per repo and a `gate` config
field. **A dependency's absence is answered by the tier, not the table** ([`TESTING.md`][testing-6e] §6e), which is what lets the design-system
steps run on every machine that has `tailwindcss`, an optional peer, while a run from `runtime` up never skips them. `--list` words a step's
dependency per tier: conditional, or required.

**A table declares each tier as a key, and `tier()` includes a lower tier's resolved rows in place**, so what a tier runs is read off the table, not
computed from a default each builder carries. `GateTier` is derived from the ordered `GATE_TIERS` tuple, and an entry of tier `K` may reference only
a tier below `K`, so a tier including itself or one above it is a type error. `resolveTiers` refuses the same through a cast or plain JavaScript,
along with a reference to an undeclared tier and a label one resolved tier holds twice, and resolves every declared tier before any runs, so the
refusal is the table's whatever `--tier` asked for. Nothing sorts a tier, which is why each preset tier above `static` leads with its reference
([`TESTING.md`][testing-6c] §6c). **At `runtime`, a row narrows only in the tier that declares it**: the resolver records each row's home tier, and
a row reached through `tier("unit")` runs whole.

**`binDir` is a de-hardcoding, not a feature.** It defaults to `${cwd}/node_modules/.bin`, but apps that invoke tools as `bun x oxlint` need a
different prefix, and one config field is cheaper than a fork of the runner per app. The temp-directory prefix behind the full-log file stays
hardcoded — configuring it would be surface for nothing.

**The formatters in `src/tooling/gate/report.ts` stay unpublished**: publishing them would freeze every gate line's glyphs and wording across the
fleet and hand the next repository the parts for an alternate runner. **`selectSteps` _is_ published**,
because it is pure — an app unit-tests its own table against it at zero step cost, as forge's `steps.test.ts` does.

**Step sets, an `--inspect`/streaming mode, and a preconditions phase are deliberately absent**; the flags are [`TESTING.md`][testing-6e] §6e's
table. Narrowing a run means enumerating labels or letting `--affected` read the change; a streamed run is `--list` and then the step's own command.

**The `--reuse` receipt lives in the git directory, not the working tree.** A working-tree path would need every consumer's `.gitignore` to name it,
and until one did the receipt would sit inside the tree hash it records, so writing it would invalidate it. `git rev-parse --git-path` keeps it out
of both, and gives a linked worktree a receipt of its own.

### 2g. cloudflareWorkerSteps — the Fleet Preset

**A preset is a factory returning an ordinary `StepTiers` table, not a second kind of table.** It is the app's table, or is merged with the app's
own rows by `mergeTiers`; an app that outgrows it writes the tiers out by hand and loses nothing, and nothing in the runner knows a preset exists.
**A complete preset declares all four tiers, each above `static` leading with `tier()` naming the one below**, so a table built from it alone
resolves every `--tier`. `wardenAppSteps` declares rows only, because it is merged onto a complete one; merging one complete preset onto another
includes the lower tiers twice, which the resolver refuses as a duplicate label.

**Generation leads judgement**: the `wrangler types` step and the asset-types emitter both write files `typecheck` reads, so they precede it, and a
stale generated type surfaces as a type error rather than a green run over yesterday's output. **`validate-service-worker` follows
`validate-asset-manifest`** and fails a built `sw.js` that is behind the files its last build read, so the test row never reads a stale worker; the
record it reads is [`ASSET_PIPELINE.md`][ap-4d] §4d's.

**The preset generates runtime types only** (`--no-include-env`): the `Env` interface is the one `forge cf gen env` commits in `env.schema.ts`, so
no second generator describes a binding. `--config` goes on that invocation when `workerConfig` is set, because runtime types follow the config's
compatibility date and flags. `validate-generated-types` follows it and fails any other wrangler-generated file under `.types/`, which nothing
regenerates and so would let `typecheck` pass against types older than the config; a stub written by hand there is not wrangler's and passes.

**`validate-env-schema` holds that committed `Env` to the config, in-process.** It renders the module through the renderer the command writes with,
formatted under the app's own `bun fmt` config, and compares bytes, so `forge verify --only validate-env-schema` is the standalone check and no
`--check` flag keeps a second entry point in step. Its `fix` writes the render; the row never regenerates ahead of `typecheck`, which would let CI
pass over a stale committed file. It fails a config that declares no `secrets`, because names read from the gitignored `.dev.vars` would make the
render differ between machines. It declares no `watches`, since its inputs include optional, possibly untracked paths, which the dead-glob rule
refuses.

**The options are the fleet's actual disagreements, and nothing else.** `assetOut` exists because the emitter writes nothing useful without `--out`;
`wranglerTypes: false` for an app that supplies its runtime types itself; `envSchema.out` for an app whose schema lives elsewhere. Omitting
`assetConfig` drops the asset rows — a shorter table, not a step that succeeds vacuously. The `.types/` path is baked in, since nobody varies it
(§2f).

**`presets.test.ts` pins every emitted command verbatim**, because the contract is "these are the commands the fleet runs", and only a literal
assertion catches a table that type-checks but names a command no app can run. **A row's tier follows [`TESTING.md`][testing-6c] §6c's lines, and
`forge verify --list` prints it.** The default table declares no `requires`, so every row runs on any machine with the dependencies installed;
`presets.test.ts` asserts that absence, since one added there would bind every app at once.

<!-- rule:forge-gate-markdown-off-formatter --> `bun fmt` pads table cells unconfigurably, so beside `validate-markdown` each
`bun run fix` reverses the other.

### 2h. Roots Are Stated or Derived, Never Discovered

**No function in `tooling/gate` or `tooling/release` walks the disk to find out where the project is** — not upward, not by probing for a marker
file, not at all. A root arrives one of exactly two ways:

- **Stated.** The caller passes it; forge's own bindings do this from `import.meta.url` (`ROOT` in `config/paths.ts`).
- **Derived.** `installedAppRoot()` takes this module's own path and returns everything before its first `node_modules` segment — pure string
  arithmetic, reading no directory. When forge is installed under `<app>/node_modules/…`, that text _is_ `<app>`.

`resolveAppRoot(explicit?)` is the one entry point: stated wins, derived is the fallback, and when neither is available **it throws**.

**Why the refusal rather than a `process.cwd()` default.** A cwd default makes the answer depend on where the command was typed, and the failure is
not a crash: it is a check that walks a tree containing nothing it recognises and reports the same green as one that walked the right tree and found
nothing wrong. Every guard in this gate exists to separate those two outcomes.

**Why not a walk-up.** An upward search for `package.json` finds _a_ project — a monorepo package, a `node_modules` entry or a parent checkout all
answer — and it succeeds, so nothing signals the wrong tree. Deriving from the install path cannot pick a different project, because the path is the
install.

**The first `node_modules` segment, not the last.** A nested install and a pnpm store path both place the consuming application before the first
occurrence; every later one names a dependency's root. The derivation is `findAppRoot(modulePath)`, a separate pure function because
`import.meta.url` cannot be varied from a test.

**A linked install is the case the derivation cannot answer, and `--root` is how the caller states it.** A `file:` dependency installs as symlinks
into the forge checkout and every runtime resolves `import.meta.url` to the realpath, so this module reports itself under `src/tooling/` with no
`node_modules` segment, and the derivation correctly returns `undefined`. Every `forge assets` command therefore carries `--root`, falling back to
`FORGE_APP_ROOT`, with an empty value treated as absent so an exported-but-unset variable cannot resolve every path against `/`. This is the
_stated_ branch, not a third one: reading through the symlink is the walk this section rules out, and would answer for a `file:` dependency of a
dependency as confidently as for the app.

### 2i. Checks Are Functions, Not Scripts

**Every validator the gate runs is a published `checkX(config)` returning findings.** A validator in a repository-local script directory is
unreachable through the `exports` map, leaving a consuming app a step table with nothing to put in it.

A check is built in layers, and the **prefix states which one a function is**:

| Prefix | Purity | Shape |
| --- | --- | --- |
| `parse*` / `find*` | pure | text → data. No disk, no root, no path. |
| `validate*` | pure | data → `Finding[]`. Every policy decision lives here. |
| `resolve*` | impure | config → files or contents. Walks disk, judges nothing. |
| `check*` | impure | config → `CheckResult`. Orchestrates the three above. |
| `format*` | pure | findings → strings. |

`check*` is the only entry point a consumer needs; the rest are the seams that make one assertable without a filesystem or a subprocess.
`src/tooling/gate/mod.ts` is authoritative over which checks are published, and this document enumerates none of them.

**A check may ship a fixer, and it is a different verb from the check.** `checkX` reports and writes nothing; the `fixX` beside it writes and
reports nothing, and `--fix` calls it in-process. Only rules a fixer can apply without guessing belong in it — a rule that would have to invent a
code fence's language or rewrap an author's prose stays report-only in `checkX`.

<!-- rule:forge-check-ok-derived --> `checkResult(findings, summary)` computes `ok`, so a check that reports a failure and forgets to flip a flag is
not expressible.

**`summary` always carries a count, and a check whose scan set is empty fails**, through `scannedNothing`: a visible `0 .tsx files carry every
pragma` beats a silent green, but it is still a green nobody reads. **The guard reads the raw walk, and returns before any finding accumulates.** A
post-exclusion count lets an all-exempt tree report zero green beside a wall of stale-exemption failures, and guarding after the work discards what
the check found, so where the count is only knowable at the end the refusal also requires no findings. **Not every check has a scan set, and a few
reach zero legitimately** — a single-artifact diff, a Worker with no static assets, an opt-in anchor, a project before its first release — and each
records that at the branch, where a reader tempted to add a guard is standing.

**A level is not a scale.** `fail` fails the check; `warn` is reported and does not. A third level invites "does `major` fail the gate?", the
question a level should answer.

**A drift check over a generated module compares content, not layout.** Every `gen:*` script pipes its module through `bun fmt`, so both sides are
canonicalised before comparison — whitespace removed, and the trailing comma the formatter adds when it expands a literal dropped — and the gate
never fails on formatting the generator is not responsible for.

**Every check takes an explicit `root` (§2h) and every forge-specific allowlist as config**, which keeps it from being forge's script wearing a
config parameter. **That configuration lives in the consuming repository's `config/steps.config.ts`**, beside the step table that already answers
"what does this repository's gate do?", so a step is one entry: the builder for the check and the config it runs with. An allowlist too long to read
inline goes in a plain-`.ts` data module beside the table, such as `config/exemptions.ts`; it is data, not a config module, so it keeps no
`.config.ts` suffix ([`CONFIG_BASELINE.md`][cb-6] §6).

**Where the tree already states a fact, the check derives it and the config field is the override.** A hand-kept path list rots silently on a rename
and puts an entry's reason far from the file it excuses, so a check reads the convention the codebase keeps — a filename, a path segment, an opt-in
marker — and still accepts every allowlist as config for a consuming app whose tree says otherwise. A derived default is not a forge-specific rule
smuggled into a published check; a default a consumer cannot displace would be. **An entry that only restates what the check derives fails**, like a
stale one: an escape nobody can see the need for is one nobody notices going wrong.

### 2j. Task Branches and the Amend Floor

**Forge works each task on a `task/<id>` branch in the session's own clone and pushes one squashed commit per push unit to `main`**; the flow from
task branch to push is [`AGENT_WORKFLOW.md`][aw-4b] §4b and [`AGENT_WORKFLOW.md`][aw-5b] §5b's. There are no pull requests: no workflow runs on a
branch or a pull request — the release workflow fires only on a pushed `v*` tag — so review is the reviewer session's verdict on a sha, and the gate
is the tier the push runs on the rebased tip. The clone being the session's own is what makes branches safe: on a host-mounted `.git`, `git stash`,
fresh branches and worktree removal break.

**The amend floor is `origin/main`.** **Above it, history is private** — amend, reword, reorder and rebase freely, provided a reviewed commit keeps
its patch until the push squashes it ([`AGENT_WORKFLOW.md`][aw-5b] §5b). **At or below it, history is published**: other sessions, the host checkout
and the next push build on it, and the server takes fast-forward pushes only. Below that again, the latest `git describe --tags --abbrev=0` marks
what a consumer has installed ([`FORGE_CONSUMPTION.md`][fc-4c] §4c), and rewriting those commits would change what the tag names without changing
the version they asked for.

**`forge release` enforces the tag floor rather than trusting it**, in a preflight before anything is written: it refuses when the previous tag is
not an ancestor of HEAD (`history-rewritten`, no override), and when a reachable remote does not carry that tag (`tag-unpushed`), because an
unpushed tag does not exist for a consumer and `getLatestTag` would cut the next release on it regardless. Neither is a gate step: both are
properties of the commit that publishes a release, the release command is where they can still be answered, and a network-dependent step would break
an offline `verify:scheduled` for a reason unrelated to the code. An unreachable remote is reported and non-fatal. When the unpushed tag is the
version being released, the run is _tagged_ (§2a) and prints `git push --tags`, or under `tagOn: "pushed"` the `git tag -d` that lets the next run
check the tip and push it. A tag the release pushes names a commit already on `main`, so it never names history above the amend floor.

These habits carry the rest:

1. **One commit per push unit on `main`**, a review finding's fix included, so the log of `main` is the bisect surface, one push unit per step; the
   squash and its subject are [`AGENT_WORKFLOW.md`][aw-4b] §4b's.
2. **Never `git stash`.** Commit the work in progress and `--amend` it later: `git reflog` recovers a bad amend, a lost stash entry has no handle,
   and the stash is shared with the review worktree.
3. **Write the `[Unreleased]` changelog entry in the commit that earns it.** `forge release` refuses an empty `[Unreleased]` once commits exist
   (§2d), which catches the omission far from the change that caused it.

**A commit that alters or removes a published export carries the `minor:` subject prefix** (`major:` once forge is 1.0). `resolveVersion` reads only
those two prefixes and defaults everything else to patch, so the prefix is the sole machine-readable "this will break you" — and pre-1.0 forge ships
breaking changes with no shim while consumers pin by tag, which makes it the only warning they get. The surface guard (§2b) names the prefix as the
remedy for its refusal: `--allow-semver` silences the guard rather than answering it, and is for a shrink where a patch bump is genuinely correct.

### 2k. `dev:forge` Is Asked For, Never Automatic

**`syncForge` replaces the forge under a consumer's `node_modules` with this checkout, packed as it would be published** (`bun pm pack`,
`--ignore-scripts`); a consumer runs it as its `dev:forge` script, never a `forge` subcommand, to exercise an unreleased change without a tag.

**It is deliberately not a `postinstall` hook**, because the result disagrees with the lockfile on purpose, and made automatic every `bun i` would
silently swap a published dependency for a working copy. A plain `bun i` restores the pinned tag, since the sync deletes the `.bun-tag` file bun
reads.

### 2l. A Forge Release Never Waits on a Consumer

**The gate `config/release.config.ts` hands `forge release` is `verify:scheduled`, and it reads nothing outside this checkout.** A consumer depends
on forge, never the reverse, so a consumer's suite in forge's release gate would let that consumer block a forge release.

**A check that every published component is demonstrated belongs to the demonstrator.** Its own gate runs the coverage spec against the forge it
installs, so a release publishing a new component turns the demonstrator red on upgrade, and the demo or its excuse lands there. To check ahead of a
release, the demonstrator runs that spec after `dev:forge` (§2k).

**`verify:scheduled` holds the cross-engine row, so a release needs both Playwright servers up.** At `scheduled` an absent requirement fails, and
`forge release` refuses to tag a tree its gate has not passed, so a machine without `playwright-compat` cannot cut a release
([`TEST_RUNNERS.md`][testing-6] §1g).

### 2m. The Bun Floor Is the Bun the Gate Runs On

**`engines.bun`'s floor is `packageManager`'s version**, and `.github/workflows/release.yml` installs that version through `bun-version-file:
package.json`, so the release gate (§2a) runs on exactly the floor. A lower floor would promise support for a Bun no run has tested. Raising one
means raising the other in the same change, and `validate-packaging` fails while they differ.

### 2n. A Node-Reached Export Is Declared Under `forge.node`

**A subpath a Node process imports is listed under `forge.node` in `package.json`, and its export points `import` at a generated `<stem>.node.mjs`**
beside a `types` naming the `.ts` entry. `bun run gen:bundles` writes the `.node.mjs`; nothing else is edited. Node refuses to strip types under
`node_modules`, and forge's extensionless imports do not resolve under Node ESM, so a `.ts` target there breaks the consumer rather than forge
([`NAMESPACES.md`][namespaces-3c] §3c).

**Everything else is derived from that list.** `nodeBundles` turns each entry into a bundle row — the `validate-<subpath>-bundle` drift check,
watching the entry's relative-import closure — and `gen:bundles` writes the same rows. `validate-node-exports` fails a listed subpath whose export
is missing or does not point `import` at a `.mjs`, and an `.mjs` export the list leaves out. `tests/workerd/harness-consumer.workerd.ts` loads every
listed subpath under node from the packed tarball, its consumer root linking forge's `dependencies` and every package a listed bundle imports,
derived from the bundles themselves.

<!-- rule:forge-bundle-no-extensionless-shadow --> Inside `node_modules`, Bun resolves `../validation/mod` to a `mod.mjs`, `mod.js` or `mod.cjs`
ahead of `mod.ts`, so forge's own modules would load the bundle while their siblings load the source, splitting module state such as `safeCheck`'s
registry in two. `bundle-shadow.test.ts` installs forge as `dev:forge` does and checks a `safeCheck` message survives `createConfig` under bun.

**A bundle is request-free, by a build condition rather than by convention.** `bundleSource` passes esbuild the `forge-node-bundle` condition, which
nothing else resolves. Under it, `#request-scope` in `package.json` `imports` picks `src/context/request-scope.node.ts`, which throws
`RequestFreeBundleError` on any read or write of a request's context; everywhere else, `default` picks `src/context/request-scope.ts`. Creating a
context key at module load still succeeds, so a bundle loads and its request-free exports answer, and a bundle's own request keys cannot split from
the source's. The one split left is `validation`'s `safeCheck` registry, which fails closed ([`TEST_RUNNERS.md`][testing-7f] §7f).

**An export nobody lists still passes.** Nothing infers which exports Node reaches, so the declaration is the claim and the checks hold the export
map to it.

---

## 3. The Compatibility-Flag Posture Every Forge App States

**Every forge app states `no_nodejs_compat`, `no_nodejs_compat_v2` and `new_module_registry`, at whatever compatibility date it already carries.**
The first two are the posture: forge targets the pure Workers/V8 surface, so a Node built-in is available only where Cloudflare offers it natively,
and a dependency reaching for one is refused rather than shimmed. If your build refuses `node:path`, this is the rule that refused it — drop the
dependency or find its Workers-native equivalent, rather than adding `nodejs_compat`.

```jsonc
{
  "compatibility_date": "<the date this app already carries>",
  "compatibility_flags": ["no_nodejs_compat", "no_nodejs_compat_v2", "new_module_registry"],
}
```

**A compatibility date is not a posture, which is why the flags are stated rather than inferred.** Past wrangler's `NODEJS_COMPAT_DEFAULT_ON_DATE`,
`nodejs_compat` and `nodejs_compat_v2` are on by default, so an app that refuses Node only because its date predates that acquires the whole Node
surface the moment somebody bumps it. The two `no_*` flags are accepted and inert before that threshold, so they land at an app's existing date and
make the later bump safe by construction rather than by memory.

**`new_module_registry` is adopted for its module semantics, and no claim is made about speed.** It is an independent opt-in with no default-on date
of its own. It changes the class a module error is raised as, so a test asserting the old message text is the one thing expected to break when it
goes on.

### 3a. What the Check Reads, and the Trap It Exists For

`checkCompatibility` (`src/tooling/gate/checks/compatibility.ts`) judges **every deployment as wrangler builds it**. An environment that states a
flag set of its own **replaces** the top level's wholesale rather than merging into it, so a `wrangler.jsonc` correct at the top and wrong in
`env.dev` deploys a Worker with the Node surface to that environment, and the block is judged on its own. An environment that states no set inherits
the top level's and shares its verdict: the top level's findings stand for both, and the summary counts both deployments.

An unstated set, a value that is not a list of names, an omitted flag and a stated contradiction — `nodejs_compat` beside `no_nodejs_compat` — are
each reported on their own, and each finding carries the literal line that fixes it. `config.require` overrides the set for a project with a
different posture; forge itself ships the step rather than running it, having no `wrangler.jsonc` of its own.

**Every Worker config an app holds is judged, in the one row.** A local Worker beside the deployed one — a sandbox served by miniflare and never
deployed, say — still runs code under its own flags, so `config.workerConfigs` lists every file, and `cloudflareWorkerSteps()` adds
`compatibility.extraWorkerConfigs` to `workerConfig`. Each finding names its file and the summary sums across them. The row's label stays
`validate-compatibility`, so a second file adds no row to collide with. An isolate loaded through a `worker_loaders` binding takes its date and
flags from source, not from any config, and this check cannot see it.

---

[ap]: ./ASSET_PIPELINE.md
[ap-4d]: ./ASSET_PIPELINE.md#4d-the-service-workers-input-record
[aw-4b]: ../warden/canon/shared/AGENT_WORKFLOW.md#4b-commits-and-the-push
[aw-5b]: ../warden/canon/shared/AGENT_WORKFLOW.md#5b-a-tasks-path-to-main
[canon-testing-6]: ../warden/canon/libs/TESTING.md#6-the-verification-gate
[cb-6]: ../warden/canon/apps/CONFIG_BASELINE.md#6-config-modules
[fc-4c]: ../warden/canon/apps/FORGE_CONSUMPTION.md#4c-upgrading-the-library
[la-1d]: ../warden/canon/libs/LIBRARY_ARCHITECTURE.md#1d-web-apis-only-constraint
[namespaces-3c]: ./NAMESPACES.md#3c-a-surface-node-loads-is-published-prebuilt
[namespaces-4a]: ./NAMESPACES.md#4a-leaf-namespace-rules
[release-refusals]: ../src/tooling/release/README.md#getting-past-a-refusal
[release-reopen]: ../src/tooling/release/README.md#finishing-a-release-over-several-runs
[testing-6]: ./TEST_RUNNERS.md#6-the-verification-gate
[testing-6a]: ../warden/canon/libs/TESTING.md#6a-one-command-nested-tiers
[testing-6c]: ../warden/canon/libs/TESTING.md#6c-the-lines-between-the-tiers
[testing-6e]: ../warden/canon/libs/TESTING.md#6e-what-the-runner-promises
[testing-7f]: ./TEST_RUNNERS.md#7f-subpaths-that-are-not-on-the-barrel
