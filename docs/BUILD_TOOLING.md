---
title: Build Tooling
description: "The dependency-free CLI framework, the published verification gate and its check contract, and the automated release workflow."
audience: internal
---

# Build Tooling

> Owns forge's developer-facing command surface: the CLI framework (`tooling/cli`), the verification
> gate (`tooling/gate`) and the release workflow (`tooling/release`). Everything under
> `src/tooling/` runs on a developer's machine, never in a Worker; membership in that container _is_
> the exemption from the Web-APIs-only rule ([`NAMESPACES.md`](./NAMESPACES.md) §4a).
>
> Defers to: [`ASSET_PIPELINE.md`](./ASSET_PIPELINE.md) for the asset build these commands drive and
> the generated module it writes;
> [`LIBRARY_ARCHITECTURE.md`](../warden/canon/libs/LIBRARY_ARCHITECTURE.md) §1d for that exemption;
> [`TESTING.md`](../warden/canon/libs/TESTING.md) §6 for the gate's tiers and flags.

---

## 0. Quick Reference

- §1 tooling/cli Namespace: the dependency-free command framework
- §1a Commands Are Values: a tree built from data, not registered by side effect
- §1b Flags Are a Typed Record: two types, inference instead of casts
- §1c Errors Carry a Kind, Not an Exit Code: why failure is always exit 1
- §1d CommandBase and Command Are Not Mergeable: the variance that forces two interfaces
- §2 tooling/gate and tooling/release — Project Tooling: the blessed release path and the published gate
- §2a createReleaseCommand — Automated Release Workflow: the ordered steps and the refusals
- §2b The Export Surface a Release Compares: the symbol set behind the shrink guard, and what it ignores
- §2c Git and Manifest Internals: the unpublished helpers the two factories are built from
- §2d Changelog Promotion — the Unreleased Contract: what release does to `CHANGELOG.md`
- §2e Changelog Gate Invariants: what is checked before a release, and what deliberately is not
- §2f createGateCommand — the Published Verification Gate: one runner, one table per project
- §2g cloudflareWorkerSteps — the Fleet Preset: a step-table factory, not new machinery
- §2h Roots Are Stated or Derived, Never Discovered: no function walks the disk to find the project
- §2i Checks Are Functions, Not Scripts: the published validators, the verb vocabulary, and what a drift check compares
- §2j Trunk-Only Development and the Amend Floor: why there are no branches, and what may still be rewritten

---

## 1. tooling/cli Namespace

Signatures, worked examples, and the full flag-parsing table live in `src/tooling/cli/README.md`. This
section carries only the decisions behind them.

### 1a. Commands Are Values

**`createCommand` takes a config object and returns a command; nothing is registered by side
effect.** `addCommand(parent, child)` links two of those values into a tree, and `execute(root)`
walks it. The handler key is `run`.

The consequence is testability: a command tree is data a caller holds, so it can be built,
inspected, and driven to completion without a process. `execute` accepts an explicit `argv` and an
injectable `CliIO`, which is why forge's own CLIs are covered by ordinary unit tests rather than by
spawning themselves.

**A gate or build verb is therefore a factory, not a script.** `createReleaseCommand` (§2a) and
`createGateCommand` (§2f) both return a command from a config whose first field is `cwd`; the
`bin.ts` a package script points at resolves `cwd` and calls `execute`. Both ship from
`@y-core/forge/tooling/gate` — a factory reachable only from a repository's own binding is a script
wearing a factory's clothes.

### 1b. Flags Are a Typed Record

**Flags are a record keyed by long name, not an array of definitions.** The key _is_ the `--long`
form and `short` is a field on the definition, so a flag cannot be declared with a name that
disagrees with the one that reads it.

**There are two flag types — `"boolean"` and `"string"`.** `ResolvedFlags<F>` derives the handler's
flag argument from the declaration: a `string` flag with a `default` or `required: true` resolves
to `string`, every other `string` flag to `string | undefined`, and a boolean to `boolean`. No
handler casts, and a renamed flag fails to typecheck at its reader.

**Number parsing is deliberately absent.** A numeric flag is a string plus the caller's own
validation, which keeps the parser total — it has no way to fail on input it was handed.

**A repeatable flag is opt-in per definition, and repeating an unmarked one is refused.**
`multiple: true` resolves that flag to `string[]`; without it a second occurrence is an error rather
than a last-wins overwrite, because silently discarding an argument the caller typed is the failure
mode a parser exists to prevent. `ResolvedFlags` tests `multiple` **before** `default` and
`required`, so a repeatable flag is `string[]` whether or not it carries either. **A comma-joined
string is still the default shape for a list** — the gate runner takes `--only lint,typecheck` and
splits it — and `multiple` is for the case where a value may itself contain a comma.

### 1c. Errors Carry a Kind, Not an Exit Code

**`new CliError(kind, message)`** — the discriminant is a `CliErrorKind`, and no error carries an
exit code. `execute` catches every error, prints it to stderr via `formatError`, and exits **1**.

**Exit status is a two-valued contract: 0 is success, 1 is failure.** Anything a numeric code might
have encoded belongs in the `kind` or the message, where a reader and a test can both see it. A
command needing a different code — or needing to exit _without_ the `Error:` prefix — calls
`process.exit` itself; the gate does that so its summary line is the last thing printed.

### 1d. CommandBase and Command Are Not Mergeable

**`CommandBase` and `Command<F>` are near-identical on purpose and must stay separate.** `run` takes
its flags as a parameter, so `F` is contravariant and `Command<F>` is invariant in it — a tree of
differently-flagged commands has no common `Command<…>` to be typed as. Tree links are therefore
`CommandBase`, which declares no `run`, and `execute` recovers the handler through the
`CallableCommand` cast, the one place that invariance is discharged.

---

## 2. tooling/gate and tooling/release — Project Tooling

**The two project verbs are two namespaces, and `tooling/release` sits on top of `tooling/gate`.**
The gate is the lower layer: besides its own command factory, steps and checks, it owns the
changelog parser, the semver arithmetic and the barrel parser, because the release workflow and the
gate's own changelog and export-surface checks both read them. Declaring the dependency the other
way made the two namespaces name each other at value, which `validateNoMutualValuePairs` rejects.

**What the barrel publishes is decided by one question: would a consuming app plausibly call this
itself?** A symbol that exists only to serve the two command factories stays out of `mod.ts` —
the git and `package.json` helpers in `internal/` (§2c), the gate's formatters (§2f). The test is
the _caller_, not difficulty or stability: a helper is unpublished because nobody outside would
reach for it.

### 2a. createReleaseCommand — Automated Release Workflow

**`createReleaseCommand(config, deps?)` takes a config object, not a program.** `cwd` is
required; `tagPrefix` defaults to `"v"` and `stageFiles` to what the release wrote (see below).
The second parameter is the injected dependency set, present so the command is testable —
production callers pass one argument.

It builds a `release` subcommand that, in order: refuses a dirty working tree, resolves the next
version, reaches a verdict on the changelog and promotes it in memory (§2d), prints the previous
and next versions with the tag and what the promotion would write, refuses to re-tag, updates
`package.json`, writes the promoted changelog, commits, and creates the tag. **It is the only
blessed way to cut a forge release**, and **all three places a version lives are computed here** —
the git tag, the `package.json` field, the changelog's version heading. A hand-typed version
anywhere is a defect, and §2e is the gate that says so.

**It never pushes.** The last thing it prints is the push command for a human to run, so the
irreversible step — publishing a tag to a remote — stays a deliberate act.

**The commit is atomic, and the default is what makes it so.** `stageFiles` defaults to exactly
what this command wrote — `package.json`, plus `changelogFile` when a changelog was promoted — so
the bump, the promoted section and the tag are one commit rather than a bump commit chasing a
prose commit. A project with no changelog stages `package.json` alone, because `commit` runs
`git add` and naming a path that does not exist would fail the release outright.

**`stageFiles` is an override, not an addition.** Naming it replaces the derived list. It exists
for what a release touches _beyond_ its own writes — a lockfile, a monorepo's sibling manifests,
a version constant in source — and those callers state the full list deliberately.

Five refusals are guards, not conveniences:

| Refusal | Why, and when it is reached | Override |
| --- | --- | --- |
| Dirty working tree | Checked before anything is resolved, so a half-finished change cannot ship | `--allow-dirty`, which defeats the guard's only purpose |
| Tag already exists | Checked after the version is resolved, so a botched release cannot be re-cut over its own tag | none |
| Nothing to release | No commits since the latest tag; reports "already at" and stops. `package.json` disagreeing with the tag there is an error, not a bump | none |
| Empty `[Unreleased]`, with commits since the tag | Shipping a release nobody wrote a line for is the drift the changelog prevents | `--allow-empty-changelog` (§2d); a _malformed_ changelog is a separate refusal no flag reaches |
| Public export surface shrank under an auto-patch | The bump is derived from subject prefixes alone; a removed symbol shipped as a patch breaks every consumer pinned to a `^` range (§2b) | `--allow-semver` |

**A refusal `throw`s a `ReleaseError`; it does not call `exit`.** `execute` renders any `Error`
as `Error: <message>` and exits 1 (§1c), so the operator sees the same output while the guard
stays reachable from a test that mocks no process. **The changelog verdict is reached after the
version is resolved** — it has to know whether commits exist — **and before `package.json` is
written**, so no mutation can precede a refusal.

**`--dry` prints the resolved version and what would be promoted, then stops before any write.**
It skips the clean-tree check too, so it is safe to run at any time — but it resolves from
`<latest-tag>..HEAD`, so running it _before_ committing reports "nothing to release" rather than
the version a release would produce. Commit first, then dry-run. **It skips only the clean-tree
check** — every other refusal, the shrinking-surface guard included, fires under `--dry`, because
a preview that hides the refusal it is previewing is worse than no preview.

**An automatic bump prints the evidence for itself**, as a `because:` row beside `next:`: the
short sha and subject of the commit whose prefix won, or — for a patch, which no commit asks for —
`no major:/minor: subject in <n> commits since <tag>`. The row is printed in a real release too,
not only under `--dry`. Only an `auto-*` reason carries evidence; an explicit version, a first
release and an in-sync run print no row, because no commit derived their version.

**The bump is the highest one any commit in `<latest-tag>..HEAD` asks for**: a `major:` subject
prefix bumps major, a `minor:` prefix bumps minor, a range with neither is a patch. Scanning the
whole range rather than the tip is the point — a cycle holding a `major:` commit followed by
`fix typo` must not ship as a patch. An explicit version as the command's single positional
argument overrides the scan, and is rejected unless it is greater than the current tag.

### 2b. The Export Surface a Release Compares

**The surface is a set of `<specifier>#<exportName>` pairs**, harvested from every `mod.ts` the
`exports` map names as a target — the same barrel parse `checkExports` uses, not a second parser.
`removedSurfaceSince` builds it twice: at the latest tag, from `git show <tag>:<path>` (§2c), and
from the working tree, so a `--dry` run reflects uncommitted work. An entry the tag published and
the tree omits is the finding.

**The bar the guard holds to is `auto-minor`, never `auto-major`.** A shrinking surface refuses an
`auto-patch` and nothing else; `auto-minor`, `auto-major`, an explicit version and a first release
all pass. A major-version decision is too consequential to be driven by a heuristic over barrel
names, so this check never demands one — its whole job is catching an accidental patch across the
patch→minor line, which is where a `^` range silently breaks.

Three things are deliberately not compared: **subpath patterns** (a `*` specifier names no barrel,
and forge's two publish files, not symbols), **non-barrel targets** (an entry pointing at anything
but `.../mod.ts`), and **type-level narrowing** — a symbol surviving with a tighter signature needs
a type checker, not a name set, and that gap is why the guard has an override rather than a veto.

**A whole subpath deleted from the map reports every one of its symbols as removed**, not one
"subpath removed" line: the honest reading of a symbol-keyed set, and it needs no extra machinery.
**A `package.json` this command cannot parse yields an empty set**, making the guard a no-op rather
than a new way for a differently-shaped repository to fail its release.

### 2c. Git and Manifest Internals

**The git and `package.json` helpers in `src/tooling/release/` are unpublished.** They exist to
serve the two command factories and nothing else. A consumer that needs `git tag` has `git`; what
forge publishes is the _policy_ over it — the ordered, refusing release command — not a thin
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

**`readFileAtRef` returns `null` rather than throwing when the path is absent at the ref.** It is
the one helper that reads a file out of history — `git show <ref>:<path>` — and its caller (§2b)
compares two points in time, where a barrel absent at the old tag is data, not a failure: it
published nothing then, so it can have lost nothing since. Every other git failure collapses into
the same `null`, which is the cost of that reading — acceptable because the guard is overridable,
so a surface it under-reports blocks nothing.

### 2d. Changelog Promotion — the Unreleased Contract

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
commits since the tag is the refusal in §2a.

`--allow-empty-changelog` is for a genuinely entry-free tooling release, and two properties keep
it from becoming routine. **It does not license a malformed document** — an unparseable changelog
is a separate refusal with no escape, because promotion has nothing to act on. **It still
promotes**, so the section ships as a permanent `_Nothing yet._` entry in the released record;
skipping promotion would leave the topmost released heading behind `package.json` and fail §2e on
the next `verify --full`.

**The link reference definition is best-effort.** Its base URL comes from `package.json`'s
`repository` field, normalised by stripping a `git+` prefix and a `.git` suffix. Absent or
unusable, the definition is omitted and the promotion still succeeds — a consumer with no known
remote must still be able to release. A first release omits it too: a compare link to nothing is
worse than none. Reading the URL from `git remote get-url` was rejected — it breaks in a clone
with a renamed remote, and it puts a subprocess on a path that is otherwise pure metadata.

**`src/tooling/gate/changelog.ts` returns its failures instead of throwing, diverging from the
`ReleaseError` style of the rest of the namespace.** The divergence is the gate's doing: §2e must
report every malformed heading in one run, and an exception stops at the first. The module is
also import-free — no clock, no filesystem, no git — so `release.ts` converts a returned failure
into a `ReleaseError` at its own boundary and the file I/O lives with the other readers in
`src/tooling/release/pkg-json.ts`.

### 2e. Changelog Gate Invariants

**`CHANGELOG.md` is checked by a `full`-tier gate step** — `config/steps.ts` owns the step table
(see [`TESTING.md`](./TESTING.md) §6). Requiring a written `[Unreleased]` entry on every fast or
standard run would fail every work-in-progress commit; a full run runs exactly where the invariant bites,
before `prepublishOnly` and before a tag exists.

**It imports the parser from `src/tooling/gate/mod.ts` rather than adding a second changelog parser.**
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

A heading with _no_ link definition is a warning only — promotion writes the definition, and some
entries legitimately lack one.

Three things are deliberately not checked, each because the file disproves them: **`---`
separators between sections** (not a per-section invariant — consecutive released versions carry
none), **version contiguity** (a resolved version that never shipped leaves a hole the next
compare link simply spans), and **a trailing newline** (the file has none, and promotion
round-trips that exactly, §2d).

### 2f. createGateCommand — the Published Verification Gate

**One runner, one table per project.** The runner is published; the table is not. That split is the
whole design: five repositories share the selection logic, the fail-fast ordering, the `requires`
probe and the full-log file, while each keeps its own steps as its own source of truth — forge's in
`config/steps.ts` (see [`TESTING.md`](../warden/canon/libs/TESTING.md) §6a).

**The bin is the entry point; the factory is the escape hatch.** `forge verify` resolves
`config/steps.ts` (or `--config`) and delegates to `createGateCommand`, so a project needs no
binding file of its own. The factory stays published for the case the bin cannot serve — a table
assembled at run time, or a gate embedded in a larger CLI.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `cwd` | `string` | — | Repository root. Every step is spawned here, so a step's relative paths resolve. |
| `steps` | `readonly Step[]` | — | The table to resolve against. |
| `binDir` | `string` | `${cwd}/node_modules/.bin` | Prepended to `PATH` so bare tool names resolve. |

**One command, three modes — not three commands.** `verify` runs the `standard` tier, the run a
task closes on; `verify --mode fast` is the inner loop and `verify --full` (sugar for
`--mode full`) adds everything, including the steps needing a machine prerequisite. Verbs sharing
every flag and differing only in a membership filter are a mode by definition, and modelling them
as separate verbs costs a duplicated binding file per repo, a `gate` config field, and a superset
invariant that must be _tested_ rather than being true by construction. **A bare `verify` means
`standard`** because `verify` is "the gate": the cheap run is the one that has to be asked for.

**A dependency's absence is answered by the mode, not the table.** A step carries one `requires` —
tool, probe, install hint — and the runner asks the probe once: a `fast` or `standard` run reports
the step skipped, a full run fails it with the hint. That is what lets the four design-system steps
run on every machine that has `tailwindcss`, an optional peer, instead of only in a full run, while
a full run never skips, because it is the release gate `prepublishOnly` blocks on — a verdict
hardcoded in the table could state only one of the two. `--list` words a step's dependency per
mode: conditional, or required.

**`GateMode` is a closed union derived from the ordered `GATE_MODES` tuple, and `Step.tier` names
the lowest mode a step runs in.** Together they carry the invariant
[`TESTING.md`](../warden/canon/libs/TESTING.md) §6c exists to settle. The tier is ordered rather than a
_set_ of modes, so selection is a rank comparison and a table cannot express a step a lower mode
has and a higher one does not — `fast ⊆ standard ⊆ full` by construction. The prerequisite question
stays binary regardless of how many tiers there are: only a full run fails on an absent one.
Neither is a restriction the runner enforces at runtime — both are shapes that make the wrong thing
unsayable.

**`binDir` is a de-hardcoding, not a feature.** Its default is `${cwd}/node_modules/.bin`, but apps
that invoke tools as `bun x oxlint` need a different prefix, and one config field is cheaper than
five forks of the runner. The temp-directory prefix behind the full-log file stays hardcoded —
configuring it would be surface for nothing.

**The formatters in `src/tooling/gate/report.ts` stay unpublished.** Publishing them would freeze the
exact glyphs and wording of every gate line across five repositories, and would hand the next
repository the parts to build an alternate runner from — the fork this consolidation removed.

**`selectSteps` _is_ published**, because it is pure — an app unit-tests its own table against it
at zero step cost, the same argument that makes forge's `steps.test.ts` worth having.

**Step sets, an `--inspect`/streaming mode, and a preconditions phase are deliberately absent.**
The published surface is exactly `--only`, `--list`, `--fix`, fail-fast, the `requires` probe with
its mode-decided verdict — skip below the `full` tier, failure in a full run, and a red summary when every
selected step was skipped — and the full-log file. Narrowing a run means enumerating labels; a
streamed run is `--list` and then the step's own command.

### 2g. cloudflareWorkerSteps — the Fleet Preset

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
is surface for nothing, the same argument that keeps the runner's temp-dir prefix hardcoded (§2f).

**`presets.test.ts` pins every emitted command verbatim.** The preset's contract is "these are the
commands the fleet runs", which is only assertable literally — a table that type-checks but names a
command no app can run is a preset nobody can adopt, and no structural assertion catches it.

**Every preset step is prerequisite-free and on the `fast` tier**, so the whole preset is legal in a fast run
([`TESTING.md`](../warden/canon/libs/TESTING.md) §6c). A `requires` added to any of them would break that
for every app at once, which is why `presets.test.ts` asserts the absence as a property.

`assetConfig` is optional and omitting it drops the `types:assets` step entirely — an app with no
asset pipeline gets a four-step table, not a step that succeeds vacuously.

### 2h. Roots Are Stated or Derived, Never Discovered

**No function in `tooling/gate` or `tooling/release` walks the disk to find out where the project is.** Not upward, not by
probing for a marker file, not at all. A root arrives one of exactly two ways:

- **Stated.** The caller passes it; forge's own bindings do this from `import.meta.url` (`ROOT` in
  `config/steps.ts`).
- **Derived.** `installedAppRoot()` takes this module's own path and returns everything before its
  first `node_modules` segment — pure string arithmetic, reading no directory. When forge is
  installed under `<app>/node_modules/…`, that text _is_ `<app>`.

`resolveAppRoot(explicit?)` is the one entry point: stated wins, derived is the fallback, and when
neither is available **it throws**.

**Why the refusal rather than a `process.cwd()` default.** A cwd default makes the answer depend on
which directory the command was typed in, and the failure that produces is not a crash: it is a
check that walks a tree containing nothing it recognises and reports the same green as a check
that walked the right tree and found no problems. Every guard in this gate exists to separate
those two outcomes; a discovered root quietly re-merges them.

**Why not a walk-up.** An upward search for `package.json` finds _a_ project, not necessarily
_this_ one — a monorepo package, a `node_modules` entry, or a parent checkout all answer, and it
succeeds, so nothing signals that the wrong tree was chosen. Deriving from the install path cannot
pick a different project, because the path is the install.

**The first `node_modules` segment, not the last.** A nested install and a pnpm store path both
place the consuming application before the first occurrence; every later one names a dependency's
own root, so splitting on the last would report the dependency as the app. The derivation is
`findAppRoot(modulePath)`, a separate pure function precisely because `import.meta.url` cannot be
varied from a test — folded into `installedAppRoot` it would be unassertable.

**A linked install is the case the derivation cannot answer, and `--root` is how the caller
states it.** A `file:` dependency installs as symlinks into the forge checkout and every runtime
resolves `import.meta.url` to the realpath, so this module reports itself under `src/tooling/` with no
`node_modules` segment left to split on. The derivation returns `undefined`, correctly: the path
has stopped naming the consumer. Every `forge assets` command therefore carries `--root`, falling
back to `FORGE_APP_ROOT`, with an empty value treated as absent so an exported-but-unset variable
cannot resolve every path against `/`. This is the _stated_ branch, not a third one — reading
through the symlink is the walk this section rules out, and it would answer for a `file:`
dependency of a dependency exactly as confidently as for the app.

### 2i. Checks Are Functions, Not Scripts

**Every validator the gate runs is a published `checkX(config)` returning findings.** A validator
kept in a repository-local script directory is unreachable through the `exports` map, so a consuming
app would get a step table with nothing to put in it — publishing the runner while withholding the
steps is a half-measure this namespace refuses.

A check is built in layers, and the **prefix states which one a function is**:

| Prefix | Purity | Shape |
| --- | --- | --- |
| `parse*` / `find*` | pure | text → data. No disk, no root, no path. |
| `validate*` | pure | data → `Finding[]`. Every policy decision lives here. |
| `resolve*` | impure | config → files or contents. Walks disk, judges nothing. |
| `check*` | impure | config → `CheckResult`. Orchestrates the three above. |
| `format*` | pure | findings → strings. |

`check*` is the only entry point a consumer needs; the rest are the seams that make one assertable
without a filesystem or a subprocess. `src/tooling/gate/mod.ts` is authoritative over which checks are
published, and this document enumerates none of them.

**A check may ship a fixer, and it is a different verb from the check.** `checkX` reports and writes
nothing; the `fixX` beside it writes and reports nothing, and `--fix` calls it in-process. Only the
rules a fixer can apply without guessing belong in it — a rule that would have to invent a code
fence's language or rewrap an author's prose stays report-only, and `checkX` is where it is raised.

**`ok` is derived from the findings, never passed.** `checkResult(findings, summary)` computes it,
so "a check that reports a failure and forgets to flip a flag" is not expressible.

**`summary` always carries a count, and that is necessary but not sufficient.** A visible
`0 .tsx files carry every pragma` beats a silent green, but it is still a green and nobody reads a
passing summary. **A check whose scan set is empty therefore fails**, through `scannedNothing`.

**The guard reads the raw walk, and returns before any finding accumulates.** A post-exclusion count
lets an all-exempt tree report zero green beside a wall of stale-exemption failures; guarding after
the work makes the refusal discard what the check already found, so where the count is only knowable
at the end the refusal also requires no findings — a check already red has no green to refuse.

**Not every check has a scan set, and a few reach zero legitimately** — a single-artifact diff, a
Worker with no static assets, an opt-in anchor, a project before its first release. Each records that
at the branch, which is where a reader tempted to add a guard is standing.

**Two levels, not a scale.** `fail` fails the check; `warn` is reported and does not. A third level
invites "does `major` fail the gate?", which is the question a level should answer.

**A drift check over a generated module compares content, not layout.** Layout is the formatter's
business — every `gen:*` script pipes its written module through `oxfmt` — so both sides are
canonicalised before comparison: whitespace removed, and the trailing comma the formatter adds when
it expands a literal dropped. Comparing raw text would fail the gate on formatting the generator is
not responsible for.

**Every check takes an explicit `root` (§2h) and every forge-specific allowlist as config**, which
is what keeps it from being forge's script wearing a config parameter. **That configuration lives
in the consuming repository's `config/steps.ts`**, beside the step table: that file already answers
"what does this repository's gate do?", so a step is one entry in it — the builder for the check,
and the config it runs with.

**Where the tree already states a fact, the check derives it and the config field is the override.**
A hand-kept path list is itself a drift surface: it rots silently on a rename, and the reason an
entry exists ends up far from the file it excuses. So a check reads the convention the codebase
already keeps — a filename, a path segment, an opt-in marker — and every allowlist stays accepted as
config on top of it, which is what a consuming app whose tree says otherwise supplies. A derived
default is not a forge-specific rule smuggled into a published check; a default a consumer cannot
displace would be. **An entry that only restates what the check derives fails**, on the same terms
as a stale one: an escape nobody can see the need for is an escape nobody notices going wrong.

### 2j. Trunk-Only Development and the Amend Floor

**Forge develops on the trunk: no branches, no pull requests, no worktrees.** There is no CI, so a
pull request has nothing to run and nobody to review it — the gate is `bun run verify`, run locally
before the commit that claims it. And branch-shaped git is the unreliable part of this container:
`git stash`, fresh branches and worktree removal have each broken here, where commit, amend and tag
have not. Trunk-only is therefore a fit to the machinery that works, not a preference about
workflow.

**The invariant that replaces the discipline a branch would have provided is the amend floor.**
`git describe --tags --abbrev=0` marks it. **Above the floor, history is private** — amend, reword
and reorder freely. **At or below it, history is published**: consumers pin codeload tarballs at a
tag, so a consumer has already fetched those commits, and rewriting them changes what they got
without changing the version they asked for.

**`forge release` enforces the floor rather than trusting it**, in a preflight that runs before
anything is written: it refuses when the previous tag is not an ancestor of HEAD
(`history-rewritten`, no override), and when a reachable remote does not carry that tag
(`tag-unpushed`) — an unpushed tag does not exist for a consumer, and `getLatestTag` would cut the
next release on top of it regardless. Neither is a gate step: both are properties of the commit that
publishes a release, the release command is where they can still be answered, and a network-
dependent step would break an offline `verify:full` for a reason unrelated to the code. A remote
that cannot be reached is reported and non-fatal.

Three habits carry the rest:

1. **Commit per verified unit** — one coherent change, at the point `bun run verify` is green for
   it. A later fix to that same unit is `--amend`; a different concern is a new commit. Below the
   tag the log is the only bisect surface there is.
2. **Never `git stash`.** Commit the work in progress and `--amend` it into shape later;
   `git reflog` recovers a bad amend, where a lost stash entry has no such handle.
3. **Write the `[Unreleased]` changelog entry in the commit that earns it.** `validate-changelog`
   refuses an empty `[Unreleased]` at release time, which catches the omission far from the change
   that caused it.

**A commit that alters or removes a published export carries the `minor:` subject prefix**
(`major:` once forge is 1.0). `resolveVersion` reads only the `major:` and `minor:` prefixes and
defaults everything else to patch, so the prefix is the sole machine-readable "this will break
you" — and pre-1.0 forge ships breaking changes with no shim while consumers pin by tag, which
makes that signal the only warning they get. The surface guard (`removedSurfaceSince` in
`surface.ts`) refuses a shrinking export surface under an auto-patch release, and its refusal names
the prefix as the remedy: `--allow-semver` silences the guard rather than answering it, and is
described there as the deliberate override it is — for a shrink where a patch bump is genuinely
correct.

---
