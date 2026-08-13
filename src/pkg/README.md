# `@y-core/forge/pkg`

**Project tooling — the two verbs a repository's `scripts/` directory is built from.**

- **Verification** — `createGateCommand`, a `check`/`verify` runner over a step table you own,
  plus `cloudflareWorkerSteps` for the table this fleet's Worker apps share.
- **Release** — `createReleaseCommand`, which resolves the next version from git history, promotes
  `CHANGELOG.md`, updates `package.json`, commits and tags.

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
  mod.ts       ← the only barrel; every public symbol, named
  types.ts     ← shared error and config types
  gate/        steps.ts  report.ts  command.ts  presets.ts
  release/     changelog.ts  release.ts  semver.ts  version.ts
  internal/    git.ts  pkg-json.ts
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

- **Drop-in `check` / `verify` commands** (`createGateCommand`) — fail-fast execution over your
  step table, a per-step result line, the failing step named in the summary, the failure's tail
  plus a path to the untruncated log, and `--only` / `--list` / `--fix`.
- **A zero-selection refusal** — a run that resolves to no steps is refused rather than reported
  green, and a narrowed run brands every summary line `⚠ scoped run — not the gate`.
- **Prerequisite probes** (`StepRequirement`) — a step can declare a machine prerequisite and the
  command that answers whether it is present. It fires only when that step is selected.
- **Pure selection** (`selectSteps`) — no disk, no spawning, no clock, so you can unit-test your
  own table at zero step cost.
- **A Cloudflare Worker preset** (`cloudflareWorkerSteps`) — the five-step table this fleet shares.

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

### Wire up `check` and `verify`

Two files. `scripts/lib/steps.ts` holds your table — it is the single source of truth for what your
gate runs, and `package.json` holds only the verbs that invoke it:

```ts
// scripts/lib/steps.ts
import { cloudflareWorkerSteps, type Step } from "@y-core/forge/pkg";

export const STEPS: readonly Step[] = [
  ...cloudflareWorkerSteps({ assetConfig: "assets.config.ts" }),
  { label: "check:bindings", gates: ["check", "verify"], tail: 30, cmd: ["bun", "run", "scripts/check-bindings.ts"] },
  {
    label: "test:browser",
    gates: ["verify"],
    tail: 120,
    cmd: ["playwright", "test"],
    requires: { tool: "chromium", probe: ["test", "-x", "/usr/local/bin/chromium"], hint: "bun run test:install" },
  },
];
```

```ts
// scripts/check.ts  —  scripts/verify.ts is the same with gate: "verify"
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execute } from "@y-core/forge/cli";
import { createGateCommand } from "@y-core/forge/pkg";
import { STEPS } from "./lib/steps";

const cwd = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await execute(createGateCommand({ cwd, gate: "check", steps: STEPS }));
```

```json
{
  "scripts": {
    "check": "bun run scripts/check.ts",
    "verify": "bun run scripts/verify.ts",
    "fix": "bun run scripts/check.ts --fix"
  }
}
```

Running it:

```bash
bun run check                      # every check step, fail-fast
bun run check --list               # print the resolved selection, run nothing
bun run check --only lint,test     # narrow the run (branded as scoped)
bun run check --fix                # run each selected step's fixer instead
bun run verify                     # the release gate — check plus its extra steps
```

Output is one line per step, then one verdict line:

```
✓ typecheck (0.9s)
✗ lint (0.8s)
    src/app/routes.ts:14:3 lint/style/useConst ...
    full log at /tmp/forge-gate-a1b2c3/lint.log
✗ check — failed at `lint` (2 of 5 steps run, 1.7s)
```

**The verdict is the summary line**, not the raw tool output beneath it. A failing step exits 1, so
`prepublishOnly: "bun run verify"` blocks a red gate.

### Test your own step table

`selectSteps` is pure, so the whole selection surface is assertable without spawning anything:

```ts
import { selectSteps } from "@y-core/forge/pkg";
import { STEPS } from "./steps";

const result = selectSteps(STEPS, { gate: "check" });
if (result.ok) expect(result.steps.map((s) => s.label)).toEqual(["cf:typecheck", "typecheck", "lint", "test"]);

// The §6c property: no check step may carry a machine prerequisite.
expect(STEPS.filter((s) => s.gates.includes("check") && s.requires)).toEqual([]);
```

### Wire up a `release` command

`createReleaseCommand` returns a forge `Command` you can register with your CLI. It only needs the
project's working directory.

```ts
import { runCli } from "@y-core/forge/cli";
import { createReleaseCommand } from "@y-core/forge/pkg";

const release = createReleaseCommand({ cwd: process.cwd() });

runCli({ commands: { release } }, process.argv.slice(2));
```

Running the command:

```bash
# Auto-resolve the next version from git history, then commit + tag
bun run ./scripts/release.ts release

# Preview without writing anything
bun run ./scripts/release.ts release --dry

# Force an explicit version (must be greater than the latest tag)
bun run ./scripts/release.ts release 2.1.0

# Bypass the clean-working-tree check
bun run ./scripts/release.ts release --allow-dirty

# Release even though [Unreleased] carries no entry
bun run ./scripts/release.ts release --allow-empty-changelog
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
above it, and appends a compare-link definition built from `package.json`'s `repository` URL. Both
files land in one commit when the changelog is staged:

```ts
createReleaseCommand({ cwd, stageFiles: ["package.json", "CHANGELOG.md"] });
```

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

#### `createGateCommand(config)`

Builds a `check` or `verify` CLI `Command`. The returned command takes no positional argument and
supports `--only`, `--list` and `--fix`.

`GateCommandConfig`:

| Field | Type | Default | Description |
|---|---|---|---|
| `cwd` | `string` | — | Repository root. Every step is spawned here, so a step's relative paths resolve. Required. |
| `gate` | `Gate` | — | Which gate's membership to run. Required. |
| `steps` | `readonly Step[]` | — | The table to resolve against — the project's own steps. Required. |
| `binDir` | `string` | `${cwd}/node_modules/.bin` | Prepended to `PATH` so bare tool names resolve. |

Flags:

| Flag | Effect |
|---|---|
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
- **Exit is direct, not thrown**, so the summary line is the last thing printed and
  `prepublishOnly` still blocks on a red gate.

### Step table

| Type | Shape |
|---|---|
| `Gate` | `"check" \| "verify"` — closed. `check` carries no machine prerequisite; `verify` may. |
| `Step` | `{ label; gates; tail; cmd; fix?; requires? }` |
| `StepRequirement` | `{ tool; probe?; hint }` — `probe` defaults to `[tool, "--version"]` |
| `Selection` | `{ ok: true; steps; total; scoped } \| { ok: false; error }` |

| Field | Type | Description |
|---|---|---|
| `label` | `string` | Stable identifier — the `--only` token, and the name reported on failure. |
| `gates` | `readonly Gate[]` | Gates this step belongs to. A step in no gate is unreachable. |
| `tail` | `number` | Lines of captured output shown when the step fails. |
| `cmd` | `readonly [string, ...string[]]` | Executable followed by its arguments. |
| `fix` | `readonly [string, ...string[]]?` | Auto-fixing counterpart invoked by `--fix`. |
| `requires` | `StepRequirement?` | Machine prerequisite checked before the step runs. |

#### `selectSteps(steps, { gate, only? })`

Resolves which steps to run. **Pure** — no disk, no spawning, no clock. Three refusals, all
returned rather than thrown: an unknown `--only` label, a label outside the requested gate, and a
selection of zero steps. The last is checked on the *outcome*, so it still holds when the selection
logic itself is wrong.

#### `cloudflareWorkerSteps(options?)`

The step table every Cloudflare Worker app in this fleet shares, in execution order:
`cf:typecheck` → `types:assets` → `typecheck` → `lint` → `test`. Generation leads judgement, so a
stale generated type surfaces as a type error. Every step is prerequisite-free, so the whole preset
is legal in `check`.

`CloudflareWorkerStepOptions`:

| Field | Type | Default | Description |
|---|---|---|---|
| `sources` | `readonly string[]` | `["src/", "tests/"]` | Directories linted and type-checked. |
| `tests` | `readonly string[]` | `["tests/"]` | Test paths passed to `bun test`. |
| `assetConfig` | `string?` | — | Asset config path. Omit to skip the `types:assets` step entirely. |
| `workerConfig` | `string?` | — | Extra `--config` for `wrangler types`, for a second wrangler config. |

### Release command

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
| `stageFiles` | `string[]` | `["package.json"]` | Files staged into the release commit. Add the changelog to keep the bump, the promotion and the tag in one commit. |
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
