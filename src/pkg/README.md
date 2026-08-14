# `@y-core/forge/pkg`

**Project tooling — the two verbs a repository's `package.json` scripts are built from.**

- **Verification** — the `forge-verify` bin over a step table you declare in `config/steps.ts`, plus
  a pre-built step per check forge ships and two presets composing the tables this fleet shares.
- **Release** — the `forge-release` bin, which resolves the next version from git history, promotes
  `CHANGELOG.md`, updates `package.json`, commits and tags.

Both are **bins, not scripts you write**: a consuming repository declares its configuration and
invokes the bin, and owns no binding file for either verb. `createGateCommand` and
`createReleaseCommand` remain published for the cases a bin cannot serve.

> **Node.js / Bun only.** This namespace shells out to `git` and to your build tools via
> `node:child_process`, and reads/writes files via `node:fs`. It is intended for release scripts
> and local tooling. **Do not import it into Cloudflare Workers or any client bundle** — it depends
> on Node built-ins that do not exist there.

```ts
import { cloudflareWorkerSteps, createGateCommand, createReleaseCommand } from "@y-core/forge/pkg";
```

---

## Layout

```
src/pkg/
  mod.ts        ← the only barrel; every public symbol, named
  types.ts      ← shared error and config types
  app-root.ts   ← where the application being tooled lives
  gate/         steps.ts  builders.ts  report.ts  command.ts  presets.ts  finding.ts
                bin.ts ← the `forge-verify` entry point
  gate/checks/  browser  changelog  css-sources  design  docs  exports  jsx
                namespace-graph — each with its pure `*-parse.ts`
  release/      changelog.ts  release.ts  semver.ts  version.ts
                bin.ts ← the `forge-release` entry point
  internal/     git.ts  pkg-json.ts  config-module.ts
```

There is exactly **one barrel**. The subdirectories are plain directories of concrete files, not
sub-namespaces: `NAMESPACE_DESIGN.md` §1a forbids a barrel importing another barrel, and §2 forbids
sibling-barrel imports, so `mod.ts` reaches each file directly.

**External vs internal is one question:** would a consuming app plausibly call this itself? If not,
it exists to serve the two command factories and stays out of the barrel. That is why `internal/`
holds the git and `package.json` helpers, and why `gate/report.ts`'s nine formatters are
unpublished — publishing them would freeze the exact wording of every gate line across every
repository that consumes forge.

---

## Features

### Verification

- **A `verify` bin** (`forge-verify`) — fail-fast execution over the table `config/steps.ts`
  default-exports, a per-step result line, the failing step named in the summary, the failure's tail
  plus a path to the untruncated log, and `--only` / `--list` / `--fix` / `--config` / `--root`.
  A missing table is an error, never an empty green.
- **A zero-selection refusal** — a run that resolves to no steps is refused rather than reported
  green, and a narrowed run brands every summary line `⚠ scoped run — not the gate`.
- **Prerequisite probes** (`StepRequirement`) — a step can declare a machine prerequisite and the
  predicate that answers whether it is present. It fires only when that step is selected.
- **Pure selection** (`selectSteps`) — no disk, no spawning, no clock, so you can unit-test your
  own table at zero step cost.
- **Two presets** — `cloudflareWorkerSteps` for this fleet's Worker apps, `forgeChecks` for a
  library published under an `exports` map.
- **A pre-built step per check** (`jsxStep`, …) — a check is named and configured in the table
  itself, never given a file of its own to be spawnable. The runner calls it in-process, so its
  findings are printed whole rather than tailed from captured text.
- **Reusable checks** (`checkJsx`, …) — the same validators as plain functions, for composing into
  something other than a gate.

### Release

- **Automatic version resolution** (`resolveVersion`) — derives the next version from the latest
  git tag plus commit history. Every commit subject in `<latest-tag>..HEAD` is scanned and the
  highest bump wins: `major:` → major, `minor:` → minor, otherwise patch.
- **Drop-in `release` command** (`createReleaseCommand`) — checks the working tree, resolves the
  next version, promotes the changelog, updates `package.json`, commits, and creates the git tag.
  Supports `--dry`/`-n`, `--allow-dirty`, and `--allow-empty-changelog`.
- **Changelog promotion** (`parseChangelog`, `promoteUnreleased`, `formatReleaseDate`) — a
  zero-dependency Keep a Changelog parser and transform. `[Unreleased]` becomes a dated version
  section, a fresh empty `[Unreleased]` takes its place, and a compare-link definition is appended.
- **SemVer primitives** — parse, format, compare, and bump strict `major.minor.patch` versions
  (leading zeros and `v` prefixes handled).
- **Structured errors** (`ReleaseError`) — every failure carries a discriminated `kind` so callers
  can react programmatically.

---

## Usage

### Wire up `verify`

**One file.** `config/steps.ts` holds your table and default-exports it; the `forge-verify` bin
finds it there. There is no binding script to write:

```ts
// config/steps.ts
import { browserStep, cloudflareWorkerSteps, jsxStep, type Step } from "@y-core/forge/pkg";

const ROOT = resolveAppRoot();

export const STEPS: readonly Step[] = [
  ...cloudflareWorkerSteps({ assetConfig: "assets.config.ts" }),
  jsxStep({ root: ROOT }),
  { label: "check:bindings", tail: 30, cmd: ["bun", "run", "tools/check-bindings.ts"] },
  browserStep(),
];

export default STEPS;
```

A pre-built step is a value, so the table stays the one place to read. Anything forge does not
ship a step for is still an ordinary `cmd` entry, as `check:bindings` is above.

```json
{
  "scripts": {
    "verify": "forge-verify",
    "verify:full": "forge-verify --full",
    "lint": "forge-verify --only lint",
    "fix": "forge-verify --fix"
  }
}
```

`config/steps.ts` is the default; `--config` names another path, and `--root` names the directory
every step runs in when it is not the working directory. **An absent default path is an error, not
a silent empty gate** — and so is a `--config` naming a file that does not exist, so a typo can
never read as a green run.

**`createGateCommand` stays published** for the case the bin cannot serve: a table assembled at run
time, or a gate embedded in a larger CLI of your own.

```ts
await execute(createGateCommand({ cwd: resolveAppRoot(), steps: STEPS }));
```

Running it:

```bash
bun run verify                     # every fast step, fail-fast
bun run verify --list              # print the resolved selection, run nothing
bun run verify --only lint,test    # narrow the run (branded as scoped)
bun run verify --fix               # run each selected step's fixer instead
bun run verify:full                # adds the steps that may need a machine prerequisite
```

**`--only` and `--fix` are the two halves of a dev loop, and they are not the same verb.** `--only
lint` runs the check and writes nothing; `--fix` writes and checks nothing. Scripting them as
`lint` and `fix` keeps that distinction at the call site — a `lint` that quietly rewrote your
files would be the one that surprises.

Output is one line per step, then one verdict line:

```
✓ typecheck (0.9s)
✗ lint (0.8s)
    src/app/routes.ts:14:3 lint/style/useConst ...
    full log at /tmp/forge-gate-a1b2c3/lint.log
✗ verify — failed at `lint` (2 of 5 steps run, 1.7s)
```

**The verdict is the summary line**, not the raw tool output beneath it. A failing step exits 1, so
`prepublishOnly: "bun run verify:full"` blocks a red gate.

### Run a check

Every validator forge runs on itself is a published function taking a config, so an app can run the
same rules on its own tree. Each is also a pre-built step, whose label is its `--only` token:

| Step | Check | Asserts |
|---|---|---|
| `exportsStep` | `checkExports` | Every declared subpath resolves; every `@public` symbol is in its barrel; every barrel, `files[]` entry and asset is reachable |
| `namespaceGraphStep` | `checkNamespaceGraph` | Every cross-namespace import is declared, with the right kind, and no mutual value pair |
| `docsStep` | `checkDocs` | Documented subpaths resolve; section numbering, cross-references, frontmatter, size, freshness |
| `designStep` | `checkDesign` | The design corpus teaches only what ships, and the source obeys the rules it states |
| `cssSourcesStep` | `checkCssSources` | Every utility class the library emits is visible to a consumer's Tailwind scan |
| `changelogStep` | `checkChangelog` | Keep a Changelog grammar, ordering, and the topmost heading equalling `package.json` |
| `jsxStep` | `checkJsx` | Every shipped `.tsx` carries its pragmas and writes no clobberable `data-slot` |
| `browserStep` | `hasChromium` | A launchable browser exists — declared as the step's `requires.probe` |

Configuration goes to the builder, in the step table itself — that file already answers "what does
this repository's gate do?", so a check's allowlists belong with it:

```ts
// config/steps.ts
exportsStep({
  root: ROOT,
  packageName: pkg.name,
  exports: pkg.exports,
  files: pkg.files,
  sealedInternal: ["src/crypto/mod.ts"],
}),
```

Every builder takes `{ fullOnly }` as its last argument, so a check can be held back to `--full`
whatever its default. `changelogStep` is the one that defaults to `--full`: requiring a written
`[Unreleased]` entry on every inner loop would fail every WIP commit.

A check returns findings rather than printing and exiting, so you can also compose one:

```ts
const result = checkJsx({ root, sources: ["src", "app"] });
if (!result.ok) {
  for (const finding of result.findings) console.error(finding.file, finding.message);
}
```

| Type | Shape |
|---|---|
| `Finding` | `{ level: "fail" \| "warn"; message; file?; line?; detail? }` |
| `CheckResult` | `{ ok; findings; summary }` — `ok` is **derived** from the findings, never passed |

Each check is built from four layers, and the prefix states which one a function is — so the seams
are assertable without a filesystem or a subprocess:

| Prefix | Purity | Shape |
|---|---|---|
| `parse*` / `find*` | pure | text → data. No disk, no root, no path |
| `validate*` | pure | data → `Finding[]`. Every policy decision lives here |
| `resolve*` | impure | config → files or contents. Walks disk, judges nothing |
| `check*` | impure | config → `CheckResult`. Orchestrates the three above |
| `format*` | pure | findings → strings |

`summary` always carries a count (`58 .tsx files carry every JSX pragma…`), because a silent green
is indistinguishable from a check that walked nothing.

### Where the project root comes from

**No function here walks the disk to find it.** A root is stated by the caller or derived from
forge's own install path — never discovered by searching upward, and never defaulted to
`process.cwd()`.

```ts
// from @y-core/forge/cli
resolveAppRoot()          // <app>, derived from <app>/node_modules/@y-core/forge/…
resolveAppRoot(myRoot)    // stated; always wins
```

`resolveAppRoot` **throws** when it can do neither. A `process.cwd()` default would make the answer
depend on which directory the command was typed in, and a check that walked the wrong tree reports
the same green as one that walked the right tree and found nothing.

| Function | Returns |
|---|---|
| `resolveAppRoot(explicit?)` | The stated root, else the derived one, else throws. |
| `installedAppRoot()` | The app root, or `undefined` when forge is not installed under a `node_modules`. |
| `findAppRoot(modulePath)` | Pure: everything before the **first** `node_modules` segment of a path. |

The first segment, not the last: a nested install and a pnpm store path both put the consuming
application before it, while every later occurrence names a dependency's own root.

### Test your own step table

`selectSteps` is pure, so the whole selection surface is assertable without spawning anything:

```ts
import { selectSteps } from "@y-core/forge/pkg";
import { STEPS } from "./steps";

const result = selectSteps(STEPS, { mode: "fast" });
if (result.ok) expect(result.steps.map((s) => s.label)).toEqual(["cf:types:runtime", "cf:types:bindings", "typecheck", "lint", "test"]);

// The §6c property: no fast-run step may carry a machine prerequisite.
expect(STEPS.filter((s) => s.fullOnly !== true && s.requires)).toEqual([]);
```

### Wire up a `release` command

**No file at all.** `forge-release` stages exactly what it wrote — `package.json`, plus the
changelog when one was promoted — so the common project needs no configuration whatsoever:

```json
{ "scripts": { "release": "forge-release" } }
```

A `config/release.ts` is for the cases that reach beyond what the release itself writes — a
lockfile, a monorepo's sibling manifests, a version constant in source:

```ts
// config/release.ts — optional; forge itself ships none
import type { ReleaseCommandConfig } from "@y-core/forge/pkg";

export default { stageFiles: ["package.json", "CHANGELOG.md", "bun.lock"] } satisfies Omit<ReleaseCommandConfig, "cwd">;
```

`stageFiles` is an **override, not an addition** — naming it replaces the derived list, so include
the changelog yourself if you still want it staged.

`cwd` is the one field the config may not set — it comes from `--root`, or from the working
directory. That keeps a config module portable: it describes the release, not where it happens.

Running the command:

```bash
# Auto-resolve the next version from git history, then commit + tag
bun run release

# Preview without writing anything
bun run release --dry

# Force an explicit version (must be greater than the latest tag)
bun run release 2.1.0

# Bypass the clean-working-tree check
bun run release --allow-dirty

# Release even though [Unreleased] carries no entry
bun run release --allow-empty-changelog
```

**`createReleaseCommand` stays published** for a release registered inside a CLI of your own, and it
is the only path that takes `deps` for testing:

```ts
const release = createReleaseCommand({ cwd: process.cwd() });
```

The command derives the bump from the commit subjects since the latest tag, taking the highest one
it finds:

```bash
git commit -m "minor: add export panel"   # → next minor release
git commit -m "major: rewrite kernel ABI" # → next major release
git commit -m "fix snapping tolerance"    # → next patch release (default)
```

A range holding both `major:` and `fix …` releases as a **major** — the scan reads every subject in
the range, not just the tip.

### Promote the changelog on release

Given a `CHANGELOG.md` whose `[Unreleased]` section carries entries, the command retitles that
heading with the resolved version and today's local date, inserts a fresh empty `[Unreleased]`
above it, and appends a compare-link definition built from `package.json`'s `repository` URL. **Both
files land in one commit by default** — the promoted changelog is staged because the release wrote
it, so the bump, the promotion and the tag can never come apart.

`changelogFile` defaults to `"CHANGELOG.md"`; a project without one releases unchanged — the
promotion step is skipped, not failed.

The command refuses to release when `[Unreleased]` is empty (whitespace only, `---` separators
only, or just the `_Nothing yet._` placeholder) while commits exist since the tag.
`--allow-empty-changelog` overrides that, and still promotes — the released section ships carrying
`_Nothing yet._`. It does **not** override a changelog that fails to parse; that refusal has no
escape.

### Transform a changelog directly

```ts
import { formatReleaseDate, parseChangelog, promoteUnreleased } from "@y-core/forge/pkg";

const parsed = parseChangelog(source);
if (parsed.ok) {
  console.log(parsed.unreleased.empty);        // false
  console.log(parsed.versions[0]?.version);    // "0.0.83"
}

const result = promoteUnreleased(source, {
  version: "0.0.84",
  date: formatReleaseDate(new Date()),
  tagPrefix: "v",
  compareUrlBase: "https://github.com/y-core/forge",
});
if (result.ok) console.log(result.source);
```

### Resolve a version programmatically

```ts
import { resolveVersion } from "@y-core/forge/pkg";

const result = resolveVersion({ cwd: process.cwd(), tagPrefix: "v" });
console.log(result.version);  // e.g. "1.3.0"
console.log(result.reason);   // "auto-minor"
console.log(result.previous); // "v1.2.4" | null
```

### Work with versions directly

```ts
import { bumpSemVer, formatSemVer, parseSemVer } from "@y-core/forge/pkg";

const v = parseSemVer("v1.2.3");      // { major: 1, minor: 2, patch: 3 }
const next = bumpSemVer(v!, "minor"); // { major: 1, minor: 3, patch: 0 }
formatSemVer(next);                   // "1.3.0"
```

### Handle failures by `kind`

```ts
import { ReleaseError } from "@y-core/forge/pkg";

try {
  resolveVersion({ cwd, tagPrefix: "v", explicit: "0.9.0" });
} catch (err) {
  if (err instanceof ReleaseError && err.kind === "version-not-greater") {
    console.error("Pick a version higher than the latest tag.");
  } else {
    throw err;
  }
}
```

---

## Core Components & APIs

### Gate command

#### `forge-verify` — the bin

Resolves a step table and runs the gate over it. `createGateBinCommand()` builds it; `bin.ts` is the
four-line entry point `package.json` points at.

| Flag | Default | Effect |
|---|---|---|
| `--config <path>` | `config/steps.ts` | Module default-exporting `readonly Step[]`, relative to `--root` or absolute. |
| `--root <path>` | the working directory | Directory every step runs in, and the base a relative `--config` resolves against. |

Plus every flag `createGateCommand` takes — `--full`, `--only`, `--list`, `--fix` — because the bin
delegates to it once the table is loaded rather than reimplementing the run.

**Two refusals, both exit 1.** A `--config` naming a file that does not exist is an error rather than
a fallback to the default, so a typo can never quietly gate a different table. An absent
`config/steps.ts` is an error rather than an empty run, for the same reason `selectSteps` refuses a
zero-step selection: a green that ran nothing is worse than a red.

#### `createGateCommand(config)`

Builds the `verify` CLI `Command`. The returned command takes no positional argument and supports
`--full`, `--only`, `--list` and `--fix`.

`GateCommandConfig`:

| Field | Type | Default | Description |
|---|---|---|---|
| `cwd` | `string` | — | Repository root. Every step is spawned here, so a step's relative paths resolve. Required. |
| `steps` | `readonly Step[]` | — | The table to resolve against — the project's own steps. Required. |
| `binDir` | `string` | `${cwd}/node_modules/.bin` | Prepended to `PATH` so bare tool names resolve. |

Flags:

| Flag | Effect |
|---|---|
| `--full` | Also run the `fullOnly` steps — the ones that may require a machine prerequisite. |
| `--only <a,b>` | Run only those steps, in table order. An unknown label is refused with the known ones listed. |
| `--list` | Print the resolved selection and exit, running nothing. |
| `--fix` | Run each selected step's fixer instead of the step. Steps without one are counted as skipped. |

Behaviour worth relying on:

- **Fail-fast.** The run stops at the first failing step; the summary reports `N of M steps run`.
- **The full log outlives the run.** A failing step's untruncated output is written to a temp file
  and its path printed under the excerpt, so a signal outside the `tail` window is recoverable.
  A filesystem refusal is swallowed — the verdict must always be reported.
- **A prerequisite is probed only when its step is selected**, so a static-only run never fails on
  a machine that lacks a browser.
- **A zero-step selection is refused**, and a narrowed run brands every summary line as scoped.
- **A check that throws fails its step**, rather than unwinding the run — a defect in a check still
  owes the gate a verdict line.
- **Exit is direct, not thrown**, so the summary line is the last thing printed and
  `prepublishOnly` still blocks on a red gate.

### Step table

| Type | Shape |
|---|---|
| `GateMode` | `"fast" \| "full"` — closed. A fast run carries no machine prerequisite; `--full` may. |
| `Step` | `CommandStep \| CheckStep` — a step is spawned, or called; never both |
| `StepBase` | `{ label; fullOnly?; requires? }` — what both variants carry |
| `CommandStep` | `StepBase & { cmd; tail; fix? }` |
| `CheckStep` | `StepBase & { run }` |
| `StepRequirement` | `{ tool; probe?; hint }` — `probe` defaults to whether `<tool> --version` exits 0 |
| `Selection` | `{ ok: true; steps; total; scoped } \| { ok: false; error }` |

| Field | Type | Description |
|---|---|---|
| `label` | `string` | Stable identifier — the `--only` token, and the name reported on failure. |
| `fullOnly` | `boolean?` | Restrict to `--full` runs. A boolean rather than a mode list, so a full run is a superset of a fast one by construction. |
| `requires` | `StepRequirement?` | Machine prerequisite checked before the step runs. Legal only on a `fullOnly` step. |
| `cmd` | `readonly [string, ...string[]]` | Executable followed by its arguments. |
| `tail` | `number` | Lines of captured output shown when the step fails. |
| `fix` | `readonly [string, ...string[]]?` | Auto-fixing counterpart invoked by `--fix`. |
| `run` | `() => CheckResult \| Promise<CheckResult>` | Called in-process. Its findings are printed whole, so there is no `tail` and no fixer. |

The two variants are exclusive by construction — `cmd?: never` on one and `run?: never` on the
other — so a step declaring both is a type error rather than a runtime precedence rule. Narrow with
`isCheckStep(step)` before reaching for a field only one variant has.

**Why a check runs in-process.** A check already returns `Finding[]` with file, line and detail. A
subprocess would flatten that to stdout text and then truncate it to `tail` lines, so the runner
prints the findings directly instead: nothing to truncate, warnings survive a passing step, and no
project needs a spawnable file per check.

#### `selectSteps(steps, { gate, only? })`

Resolves which steps to run. **Pure** — no disk, no spawning, no clock. Five refusals, all returned
rather than thrown:

| Refusal | Why |
|---|---|
| duplicate step label | A label is the `--only` token and the name on a failure line; it must name exactly one step. |
| `requires` on a step that is not `fullOnly` | A fast run must work on any machine with the repo's dependencies installed. |
| unknown `--only` label | |
| a label outside the requested mode | |
| a selection of zero steps | Checked on the *outcome*, so it still holds when the selection logic itself is wrong. |

The first two are properties of the **table**, so they are checked before the mode is applied and
before `--only` narrows: a malformed table is refused whichever run was asked for, and `--only`
cannot route around a bad step. This is what makes a step table self-validating — a project needs
no test of its own to assert either rule.

#### `cloudflareWorkerSteps(options?)`

The step table every Cloudflare Worker app in this fleet shares, in execution order:
`cf:types:runtime` → `cf:types:bindings` → `types:assets` → `typecheck` → `lint` → `test`.
Generation leads judgement, so a stale generated type surfaces as a type error. Every step is
prerequisite-free, so the whole preset is legal in a fast run.

The two `wrangler types` invocations are two steps rather than one `&&` chain, so a failure names
which one broke. `--config` goes on the bindings invocation only — runtime types do not depend on
the wrangler config.

`CloudflareWorkerStepOptions`:

| Field | Type | Default | Description |
|---|---|---|---|
| `sources` | `readonly string[]` | `["src/", "tests/"]` | Directories linted and type-checked. |
| `tests` | `readonly string[]` | `["tests/"]` | Test paths passed to `bun test`. |
| `assetConfig` | `string?` | — | Asset config path. Omit to skip the `types:assets` step entirely. |
| `assetOut` | `string` | `.forge/assets.ts` | Where the asset-types emitter writes. |
| `wranglerTypes` | `boolean` | `true` | Emit the two `wrangler types` steps. `false` for an app that declares its binding types by hand. |
| `workerConfig` | `string?` | — | `--config` for the bindings invocation. |

The two generated-type paths (`./.types/cloudflare.d.ts` and `./.types/worker-configuration.d.ts`)
are baked in rather than exposed — every app in the fleet uses them, and an option nobody varies is
surface for nothing.

#### `forgeChecks(options)`

The baseline table for a library published under an `exports` map, in execution order: `typecheck`
→ `lint` → `test` → `validate-exports` → `validate-jsx` → `validate-docs` → `validate-changelog`.
Only the checks whose config is derivable from `root` and `package.json` are here; a design,
contrast, namespace-graph or CSS-sources step carries project-specific policy, so it is named
explicitly alongside.

`LibraryStepOptions`:

| Field | Type | Default | Description |
|---|---|---|---|
| `root` | `string` | — | Repository root. Every check resolves and reports its paths against it. Required. |
| `pkg` | `GatePackage` | — | `{ name; version; exports; files }`, verbatim from `package.json`. Required. |
| `sources` | `readonly string[]` | `["src/"]` | Directories linted. |
| `tests` | `readonly string[]` | whole project | Test paths passed to `bun test`. |
| `exports` / `docs` / `jsx` / `changelog` | `Partial<…CheckConfig>?` | — | Merged over the config derived from `pkg`, for that check's allowlists. |

### Release command

#### `forge-release` — the bin

Resolves an optional config module and runs the release. `createReleaseBinCommand()` builds it.

| Flag | Default | Effect |
|---|---|---|
| `--config <path>` | `config/release.ts` | Module default-exporting `Omit<ReleaseCommandConfig, "cwd">`. **Optional** — an absent default path releases with the built-in defaults. |
| `--root <path>` | the working directory | The repository the release happens in, supplied as `cwd`. |

Plus `--dry`/`-n`, `--allow-dirty` and `--allow-empty-changelog`, and the optional positional
version, all delegated to `createReleaseCommand`.

**The config module may not set `cwd`.** It comes from `--root` or the working directory, so the
module describes *the release* and stays portable across checkouts. A `--config` naming a missing
file is still an error — only the unnamed default is allowed to be absent, because that absence is
the zero-config case rather than a mistake.

#### `createReleaseCommand(config, deps?)`

Builds the `release` CLI `Command`. The returned command supports a single optional positional
argument (an explicit version) plus the `--dry`/`-n`, `--allow-dirty` and
`--allow-empty-changelog` flags.

| Parameter | Type | Description |
|---|---|---|
| `config` | `ReleaseCommandConfig` | Project configuration (see below). |
| `deps` | `ReleaseDeps` | Optional dependency overrides for testing; defaults to the real git/pkg/version functions. |

`ReleaseCommandConfig`:

| Field | Type | Default | Description |
|---|---|---|---|
| `cwd` | `string` | — | Repository working directory. Required. |
| `tagPrefix` | `string` | `"v"` | Prefix for git tags (e.g. `v1.2.3`). |
| `stageFiles` | `string[]` | what the release wrote | `["package.json"]`, plus `changelogFile` when a changelog was promoted. Naming it **replaces** the derived list rather than adding to it. |
| `changelogFile` | `string` | `"CHANGELOG.md"` | Changelog to promote, relative to `cwd`. A missing file skips promotion. |

Flags:

| Flag | Short | Effect |
|---|---|---|
| `--dry` | `-n` | Report the resolved version and the promotion that would happen; write nothing, and skip the clean-tree check. |
| `--allow-dirty` | — | Skip the clean-working-tree refusal. |
| `--allow-empty-changelog` | — | Release despite an empty `[Unreleased]`. Promotion still runs; a malformed changelog is still refused. |

### Version resolution

#### `resolveVersion(options, deps?)`

Computes the next version from git state and returns a `VersionResult`. Throws `ReleaseError` on
invalid or non-monotonic versions.

| Parameter | Type | Description |
|---|---|---|
| `options.explicit` | `string?` | Forces a specific version; must be greater than the latest tag. |
| `options.cwd` | `string` | Repository working directory. |
| `options.tagPrefix` | `string` | Tag prefix used to strip/match tags. |
| `deps` | `VersionDeps?` | Optional git/pkg overrides for testing. |

`VersionResult`:

| Field | Type | Description |
|---|---|---|
| `version` | `string` | Resolved version string (no prefix), e.g. `"1.3.0"`. |
| `reason` | `"explicit" \| "auto-patch" \| "auto-minor" \| "auto-major" \| "first-release" \| "in-sync"` | How the version was derived. |
| `previous` | `string \| null` | The latest tag, or `null` for a first release. |

Resolution rules:

- **No tags** → `0.0.1` (`first-release`).
- **Explicit version** → used as-is after a greater-than check (`explicit`).
- **No commits since the latest tag** → returns the current version; throws `version-mismatch` if
  `package.json` and the tag disagree (`in-sync`).
- **Commits since the latest tag** → bumps from the tag by the highest bump any subject in the
  range asks for (`auto-major` / `auto-minor` / `auto-patch`).

### SemVer

| Function | Signature | Description |
|---|---|---|
| `parseSemVer` | `(str: string) => SemVer \| null` | Parses `major.minor.patch` (optional `v` prefix). Rejects leading zeros, negatives, and malformed input by returning `null`. |
| `formatSemVer` | `(v: SemVer) => string` | Formats a `SemVer` back to `"major.minor.patch"`. |
| `compareSemVer` | `(a: SemVer, b: SemVer) => -1 \| 0 \| 1` | Orders two versions. |
| `isGreaterThan` | `(next: SemVer, prev: SemVer) => boolean` | `true` when `next` is strictly greater than `prev`. |
| `bumpSemVer` | `(v: SemVer, kind: BumpKind) => SemVer` | Returns a new version bumped by `kind`, zeroing lower components. |

`SemVer` is `{ major: number; minor: number; patch: number }`.
`BumpKind` is `"major" | "minor" | "patch"`.

### Changelog

Pure string transforms — no filesystem, no clock, no git. Failures are **returned, not thrown**, so
a caller can report every malformed heading in one pass.

| Function | Signature | Description |
|---|---|---|
| `parseChangelog` | `(source: string) => ChangelogParse` | Reads the structure without changing it. |
| `promoteUnreleased` | `(source, opts: PromoteOptions) => { ok: true; source: string } \| { ok: false; errors: readonly string[] }` | Retitles `[Unreleased]`, inserts a fresh empty one above it, and appends the compare-link definition. |
| `formatReleaseDate` | `(date: Date) => string` | `YYYY-MM-DD` in the **local** calendar — not UTC. |

`PromoteOptions`:

| Field | Type | Default | Description |
|---|---|---|---|
| `version` | `string` | — | Version being promoted to — bare semver, no leading `v`. |
| `date` | `string` | — | Already-formatted release date. |
| `tagPrefix` | `string` | `"v"` | Prefix used in the compare URL's tag names. |
| `compareUrlBase` | `string?` | — | Repository base URL. Omit to skip the link definition entirely. |

`ChangelogParse` is `{ ok: true; unreleased: UnreleasedSection; versions: readonly VersionHeading[]; linkRefs: readonly string[] }`
or `{ ok: false; errors: readonly string[] }`.

| Type | Shape |
|---|---|
| `VersionHeading` | `{ version: string; date: string; line: number }` — bare semver, ISO date, zero-indexed line. |
| `UnreleasedSection` | `{ line: number; body: readonly string[]; empty: boolean }` — verbatim body up to the next `## ` heading. |

A parse fails on: no `[Unreleased]` section, more than one, an entry heading above it, an entry
heading not matching `[X.Y.Z]` followed by an **em dash** (U+2014) and an ISO date, or a date whose
shape is right but whose calendar day does not exist. `empty` is `true` when the body holds only
blank lines, `---` separators, or the `_Nothing yet._` placeholder.

`promoteUnreleased` leaves every byte below the insertion point untouched, so a document with no
trailing newline round-trips exactly. The compare link is omitted when `compareUrlBase` is absent
or there is no earlier released version.

### Errors

#### `ReleaseError`

Extends `Error` with a discriminated `kind` field for programmatic handling.

| `kind` | Raised when |
|---|---|
| `invalid-version` | A version string cannot be parsed, or `package.json` has no `version`. |
| `version-not-greater` | An explicit version is not greater than the latest tag. |
| `version-mismatch` | `package.json` and the latest tag disagree with no new commits. |
| `git-error` | A `git` command exits non-zero. |
| `pkg-update` | Reading or writing `package.json` or the changelog fails. |
| `working-tree-dirty` | The working tree has uncommitted changes and `--allow-dirty` was not passed. |
| `changelog-empty` | `[Unreleased]` carries no entry while commits exist since the tag, and `--allow-empty-changelog` was not passed. |
| `changelog-malformed` | The changelog does not parse. No flag overrides this. |

---

## Not Published

Deliberately absent from the barrel, and from this namespace's contract:

| What | Why |
|---|---|
| The gate's formatters (`gate/report.ts`) | Publishing nine formatters freezes the exact glyphs and wording of every gate line across every consuming repository — and hands the next one the parts to build an alternate runner from. |
| Git helpers (`internal/git.ts`) | A consumer that needs `git tag` has `git`. What forge publishes is the *policy* over it — the ordered, refusing release command. |
| `package.json` and changelog IO (`internal/pkg-json.ts`) | Same reason: `readFileSync` is not a contract worth freezing. |
| Step sets, an `--inspect` mode, a preconditions phase | The published surface is exactly `--only`, `--list`, `--fix`, fail-fast, the `requires` probe and the full-log file. Narrowing a run means enumerating labels; a streamed run means `--list` then the step's own command. |
