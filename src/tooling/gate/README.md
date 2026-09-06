# `@y-core/forge/tooling/gate`

**The verification gate** — the `forge verify` command over a step table you declare in
`config/steps.ts`, a pre-built step per check forge ships, two presets composing the tables this
fleet shares, and the pure changelog and semver parsers the gate reads a repository's version state
with.

`forge verify` is a **command, not a script you write**: a consuming repository declares its step
table and invokes the binary, and owns no binding file. `createGateCommand` stays published for the
cases the binary cannot serve.

```ts
import { cloudflareWorkerSteps, createGateCommand, forgeChecks, type Step } from "@y-core/forge/tooling/gate";
```

> **Node.js / Bun only.** This namespace shells out to your build tools via `node:child_process` and
> reads and writes files via `node:fs`. **Do not import it into a Cloudflare Worker or a client
> bundle.**

> **`tooling/release` depends on this namespace, never the reverse.** The gate owns the changelog
> parser, the semver primitives, and the barrel parser;
> [`@y-core/forge/tooling/release`](../release/README.md) builds its workflow on top of them.

> The barrel rule, what stays unpublished and why, the check layering, and where a project root
> comes from are owned by
> [`ASSET_AND_BUILD_TOOLING.md`](../../../.decisions/implementation/ASSET_AND_BUILD_TOOLING.md) §5.

---

## Features

- **A `verify` command** — fail-fast execution over the table `config/steps.ts` default-exports, a
  per-step result line, the failing step named in the summary, the failure's tail plus a path to the
  untruncated log, and `--full` / `--only` / `--list` / `--fix` / `--config` / `--root`. A missing
  table is an error, never an empty green.
- **A zero-selection refusal** — a run resolving to no steps is refused rather than reported green,
  and a narrowed run brands its summary as scoped.
- **Dependency probes** (`StepRequirement`) — a step declares a dependency and the predicate that
  answers whether it is present. The probe fires only when that step is selected, and its absence is
  answered by the mode: a fast run skips the step, `--full` fails it.
- **Pure selection** (`selectSteps`) — no disk, no spawning, no clock, no probe, so you can
  unit-test your own table at zero step cost.
- **Two presets** — `cloudflareWorkerSteps` for this fleet's Worker apps, `forgeChecks` for a
  library published under an `exports` map.
- **A pre-built step per check** (`jsxStep`, …) — a check is named and configured in the table
  itself, never given a file of its own to be spawnable. The runner calls it in-process, so its
  findings are printed whole rather than tailed from captured text.
- **Reusable checks** (`checkJsx`, …) — the same validators as plain functions, for composing into
  something other than a gate.
- **Changelog and semver primitives** — a zero-dependency Keep a Changelog parser and promoter, and
  parse/format/compare/bump over strict `major.minor.patch` versions.

---

## Usage

### Wire up `verify`

**One file.** `config/steps.ts` holds your table and default-exports it; `forge verify` finds it
there. There is no binding script to write:

```ts
// config/steps.ts
import { browserStep, cloudflareWorkerSteps, jsxStep, type Step } from "@y-core/forge/tooling/gate";
import { resolveAppRoot } from "@y-core/forge/tooling/cli";

const ROOT = resolveAppRoot();

export const STEPS: readonly Step[] = [
  ...cloudflareWorkerSteps({ assetConfig: "assets.config.ts" }),
  jsxStep({ root: ROOT }),
  { label: "check:bindings", tail: 30, cmd: ["bun", "run", "tools/check-bindings.ts"] },
  browserStep(),
];

export default STEPS;
```

A pre-built step is a value, so the table stays the one place to read. Anything forge ships no step
for is still an ordinary `cmd` entry, as `check:bindings` is above.

```json
{ "scripts": { "verify": "forge verify", "verify:full": "forge verify --full", "lint": "forge verify --only lint", "fix": "forge verify --fix" } }
```

`config/steps.ts` is the default; `--config` names another path, and `--root` names the directory
every step runs in when it is not the working directory. **An absent default path is an error, not a
silent empty gate** — and so is a `--config` naming a file that does not exist, so a typo can never
read as a green run.

**`createGateCommand` stays published** for the case the binary cannot serve: a table assembled at
run time, or a gate embedded in a larger CLI of your own.

```ts
import { execute } from "@y-core/forge/tooling/cli";

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
lint` runs the check and writes nothing; `--fix` writes and checks nothing. Scripting them as `lint`
and `fix` keeps that distinction at the call site — a `lint` that quietly rewrote your files would
be the one that surprises.

Output is one line per step, then one verdict line:

```
✓ typecheck (0.9s)
✗ lint (0.8s)
    src/app/routes.ts:14:3 lint/style/useConst ...
    full log at /tmp/forge-gate-a1b2c3/lint.log
✗ verify — failed at `lint` (step 2 of 5, 1.7s)
```

**The verdict is the summary line**, not the raw tool output beneath it. A failing step exits 1, so
`prepublishOnly: "bun run verify:full"` blocks a red gate.

### Run a check

Every validator forge runs on itself is a published function taking a config, so an app can run the
same rules on its own tree. Each is also a pre-built step, whose label is its `--only` token:

| Step                    | Label                          | Check                    | Asserts                                                                                                                        |
| ----------------------- | ------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `exportsStep`           | `validate-exports`             | `checkExports`           | Every declared subpath resolves; every `@public` symbol is in its barrel; every barrel, `files[]` entry and asset is reachable |
| `namespaceGraphStep`    | `validate-namespace-graph`     | `checkNamespaceGraph`    | Every cross-namespace import is declared, with the right kind, and no mutual value pair                                        |
| `assetRootStep`         | `validate-asset-root`          | `checkAssetRoot`         | What the assets pipeline writes to the asset root matches the Worker's `run_worker_first` exclusions                           |
| `coLocationStep`        | `validate-co-location`         | `checkCoLocation`        | Every source module has a test beside it, so deleting one is loud                                                              |
| `buildTimeBoundaryStep` | `validate-build-time-boundary` | `checkBuildTimeBoundary` | No module outside a build-time directory imports one at value                                                                  |
| `ssrBoundaryStep`       | `validate-ssr-boundary`        | `checkSsrBoundary`       | No Worker-executed module reaches the browser-only tier                                                                        |
| `jsxStep`               | `validate-jsx`                 | `checkJsx`               | Every shipped `.tsx` carries its pragmas                                                                                       |
| `docsStep`              | `validate-docs`                | `checkDocs`              | Documented subpaths resolve; section numbering, cross-references, frontmatter, size, freshness                                 |
| `readmeExportsStep`     | `validate-readme-exports`      | `checkReadmeExports`     | A README's per-subpath export tables name exactly what the barrel exports                                                      |
| `changelogStep`         | `validate-changelog`           | `checkChangelog`         | Keep a Changelog grammar, ordering, and the topmost heading equalling `package.json`                                           |
| `designStep`            | `validate-design`              | `checkDesign`            | The design corpus teaches only what ships, and both rule registers agree with the lint plugin                                  |
| `modernCssStep`         | `validate-modern-css`          | `checkModernCss`         | Stylesheets and class literals use the platform feature that replaced each hand-written pattern                                |
| `cssSourcesStep`        | `validate-css-sources`         | `checkCssSources`        | Every utility class the library emits is visible to a consumer's Tailwind scan                                                 |
| `cssTokensStep`         | `validate-css-tokens`          | `checkCssTokens`         | No `@theme` token is declared in a namespace the utility vocabulary overloads                                                  |
| `classGroupsStep`       | `validate-class-groups`        | `checkClassGroups`       | `cn`'s conflict table matches the one regenerated from the design system                                                       |
| `classOrderStep`        | `validate-class-order`         | `checkClassOrder`        | Every class literal is a fixed point of `cn`, so sorting one cannot change what it renders                                     |
| `classTokensStep`       | `validate-class-tokens`        | `checkClassTokens`       | Every class token in the source resolves to CSS the design system compiles                                                     |
| `designScaleStep`       | `validate-design-scale`        | `checkDesignScale`       | The design-scale data the lint plugin reads matches the one regenerated from the design system                                 |
| `lintPluginStep`        | `validate-lint-plugin`         | `checkLintPlugin`        | The committed oxlint-plugin bundle a consumer loads matches a fresh build of its TypeScript source                             |
| `contrastStep`          | `validate-contrast`            | `checkContrast`          | Every audited foreground/background pair meets its contrast criterion                                                          |
| `browserStep`           | `test:browser`                 | `hasChromium`            | A launchable browser exists — declared as the step's `requires.probe`                                                          |

The tool steps carry no check: `typecheckStep` (`typecheck`), `lintStep` (`lint`), `formatStep`
(`format`), `typeAwareLintStep` (`lint:types`) and `testStep` (`test`) spawn `tsc`, `oxlint`,
`oxfmt` and `bun test`.

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

### Check for hand-written CSS the platform replaced

`modernCssStep` scans `.css`, `.scss`, `.sass`, `.ts` and `.tsx` under each entry of `sources`. A
`!`-prefixed entry **excludes** a subtree — the usual case is a design corpus or a fixture directory
whose samples quote the very patterns the check forbids:

```ts
// config/steps.ts
modernCssStep({ root: ROOT, sources: ["src/ui", "!src/ui/design"] }),
```

`sources` matching nothing is a failure rather than a green run, for the same reason a zero-step
selection is refused.

Findings whose rule is `fail` block the gate; the rest are warnings that survive a passing step.
`deferred` is the escape for a tree that does not satisfy a `fail` rule yet — a shrink-only list, one
entry per path and rule, each naming the task that closes it:

```ts
modernCssStep({
  root: ROOT,
  sources: ["src", "!src/fixtures"],
  deferred: [{ path: "src/legacy", ruleId: "forge-ui-platform-logical-spacing", owner: "ABCD-412" }],
}),
```

**Naming `deferred` replaces forge's own list rather than adding to it**, so an app carries its
deferrals and inherits none of forge's. An entry with an empty `owner`, and an entry whose path no
longer violates its rule, both fail — the list can only shrink.

Every rule id, its tier, its severity and the feature that replaces it are owned by
`MODERN_CSS_RULES` in [`@y-core/forge/tooling/lint`](../lint/README.md); the rule each finding cites
is stated for readers in forge's design corpus at `src/ui/design/reference/16-platform.md`.

Every builder takes `{ fullOnly, requires }` as its last argument, so a check can be held back to
`--full` whatever its default, and its dependency replaced or dropped with `requires: null`. Three
builders default to `--full`: `changelogStep` (requiring a written `[Unreleased]` entry on every
inner loop would fail every WIP commit), `typeAwareLintStep` and `browserStep`. The design-system
builders instead default to a `tailwindcss` dependency, so a fast run skips them where it is absent.

A check returns findings rather than printing and exiting, so you can also compose one:

```ts
const result = checkJsx({ root, sources: ["src", "app"] });
if (!result.ok) {
  for (const finding of result.findings) console.error(finding.file, finding.message);
}
```

| Type          | Shape                                                                             |
| ------------- | --------------------------------------------------------------------------------- |
| `Finding`     | `{ level: "fail" \| "warn"; message; file?; line?; detail? }`                     |
| `CheckResult` | `{ ok; findings; summary }` — `ok` is **derived** from the findings, never passed |

The `parse*` / `validate*` / `resolve*` / `check*` / `format*` prefixes name the layer a function
belongs to; the vocabulary and its purity rules are
[`ASSET_AND_BUILD_TOOLING.md`](../../../.decisions/implementation/ASSET_AND_BUILD_TOOLING.md) §5i's.

### Test your own step table

`selectSteps` is pure, so the whole selection surface is assertable without spawning anything:

```ts
import { selectSteps } from "@y-core/forge/tooling/gate";
import { STEPS } from "./steps";

const result = selectSteps(STEPS, { mode: "fast" });
if (result.ok) expect(result.steps.map((s) => s.label)).toEqual(["types:cf-runtime", "types:cf-bindings", "typecheck", "lint", "test"]);

// Selection calls no probe, so what a table selects never depends on the machine it runs on.
expect(selectSteps(STEPS, { mode: "full" }).ok).toBe(true);
```

### Read or promote a changelog

Pure string transforms — no filesystem, no clock, no git. Failures are **returned, not thrown**, so a
caller can report every malformed heading in one pass.

```ts
import { formatReleaseDate, parseChangelog, promoteUnreleased } from "@y-core/forge/tooling/gate";

const parsed = parseChangelog(source);
if (parsed.ok) {
  console.log(parsed.data.unreleased.empty); // false
  console.log(parsed.data.versions[0]?.version); // "0.0.83"
}

const result = promoteUnreleased(source, {
  version: "0.0.84",
  date: formatReleaseDate(new Date()),
  tagPrefix: "v",
  compareUrlBase: "https://github.com/y-core/forge",
});
if (result.ok) console.log(result.data);
```

### Work with versions directly

```ts
import { bumpSemVer, formatSemVer, parseSemVer } from "@y-core/forge/tooling/gate";

const v = parseSemVer("v1.2.3"); // { major: 1, minor: 2, patch: 3 }
const next = bumpSemVer(v!, "minor"); // { major: 1, minor: 3, patch: 0 }
formatSemVer(next); // "1.3.0"
```

---

## Core Components & APIs

### Gate command

#### `forge verify`

Resolves a step table and runs the gate over it. `createGateBinCommand()` builds it, and the `forge`
binary attaches it.

| Flag              | Default               | Effect                                                                             |
| ----------------- | --------------------- | ---------------------------------------------------------------------------------- |
| `--config <path>` | `config/steps.ts`     | Module default-exporting `readonly Step[]`, relative to `--root` or absolute.      |
| `--root <path>`   | the working directory | Directory every step runs in, and the base a relative `--config` resolves against. |

Plus every flag `createGateCommand` takes — `--full`, `--only`, `--list`, `--fix` — because the
command delegates to it once the table is loaded rather than reimplementing the run.
`DEFAULT_STEPS_CONFIG` is the exported default path.

**Two refusals, both exit 1.** A `--config` naming a file that does not exist is an error rather than
a fallback to the default, so a typo can never quietly gate a different table. An absent
`config/steps.ts` is an error rather than an empty run, for the same reason `selectSteps` refuses a
zero-step selection: a green that ran nothing is worse than a red.

#### `createGateCommand(config)`

Builds the `verify` CLI `Command`. The returned command takes no positional argument and supports
`--full`, `--only`, `--list` and `--fix`.

`GateCommandConfig`:

| Field    | Type              | Default                    | Description                                                                                |
| -------- | ----------------- | -------------------------- | ------------------------------------------------------------------------------------------ |
| `cwd`    | `string`          | —                          | Repository root. Every step is spawned here, so a step's relative paths resolve. Required. |
| `steps`  | `readonly Step[]` | —                          | The table to resolve against — the project's own steps. Required.                          |
| `binDir` | `string`          | `${cwd}/node_modules/.bin` | Prepended to `PATH` so bare tool names resolve.                                            |

Flags:

| Flag           | Effect                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| `--full`       | Also run the `fullOnly` steps, and fail rather than skip a step whose dependency is absent.               |
| `--only <a,b>` | Run only those steps, in table order. Repeatable. An unknown label is refused with the known ones listed. |
| `--list`       | Print the resolved selection and exit, running nothing.                                                   |
| `--fix`        | Run each selected step's fixer instead of the step. Steps without one are counted as having no fixer.     |

Behaviour worth relying on:

- **Fail-fast.** The run stops at the first failing step; the summary names its position, `step N of M`.
- **The full log outlives the run.** A failing step's untruncated output is written to a temp file
  and its path printed under the excerpt, so a signal outside the `tail` window is recoverable. A
  filesystem refusal is swallowed — the verdict must always be reported.
- **A dependency is probed only when its step is selected**, and its absence skips the step in a fast
  run while failing it under `--full` — the release gate never skips.
- **A zero-step selection is refused**, and a narrowed run brands its summary as scoped.
- **A run whose every step was skipped is refused too**, for the same reason: the summary goes red
  and exit is 1.
- **A check that throws fails its step**, rather than unwinding the run — a defect in a check still
  owes the gate a verdict line.
- **Exit is direct, not thrown**, so the summary line is the last thing printed and `prepublishOnly`
  still blocks on a red gate.
- **The mode is in the verdict.** `✓ verify` and `✓ verify --full` are different assurances, so the
  banner says which ran.

### Step table

| Type              | Shape                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------- |
| `GateMode`        | `"fast" \| "full"` — closed. It decides what an absent dependency means: skip, or fail. |
| `Step`            | `CommandStep \| CheckStep` — a step is spawned, or called; never both                   |
| `StepBase`        | `{ label; fullOnly?; requires? }` — what both variants carry                            |
| `CommandStep`     | `StepBase & { cmd; tail; fix? }`                                                        |
| `CheckStep`       | `StepBase & { run }`                                                                    |
| `StepRequirement` | `{ tool; probe?; hint }` — absent, a fast run skips the step and `--full` fails it      |
| `Selection`       | `{ ok: true; steps; total; scoped } \| { ok: false; error }`                            |

| Field      | Type                                        | Description                                                                                                              |
| ---------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `label`    | `string`                                    | Stable identifier — the `--only` token, and the name reported on failure.                                                |
| `fullOnly` | `boolean?`                                  | Restrict to `--full` runs. A boolean rather than a mode list, so a full run is a superset of a fast one by construction. |
| `requires` | `StepRequirement?`                          | Dependency probed before the step runs: absent, a fast run skips this step and `--full` fails it.                        |
| `cmd`      | `readonly [string, ...string[]]`            | Executable followed by its arguments.                                                                                    |
| `tail`     | `number`                                    | Lines of captured output shown when the step fails.                                                                      |
| `fix`      | `readonly [string, ...string[]]?`           | Auto-fixing counterpart invoked by `--fix`.                                                                              |
| `run`      | `() => CheckResult \| Promise<CheckResult>` | Called in-process. Its findings are printed whole, so there is no `tail` and no fixer.                                   |

The two variants are exclusive by construction — `cmd?: never` on one and `run?: never` on the other
— so a step declaring both is a type error rather than a runtime precedence rule. Narrow with
`isCheckStep(step)` before reaching for a field only one variant has.

**Why a check runs in-process.** A check already returns `Finding[]` with file, line and detail. A
subprocess would flatten that to stdout text and then truncate it to `tail` lines, so the runner
prints the findings directly instead: nothing to truncate, warnings survive a passing step, and no
project needs a spawnable file per check.

#### `selectSteps(steps, { mode, only? })`

Resolves which steps to run. **Pure** — no disk, no spawning, no clock, and no probe. Refusals are
returned rather than thrown:

| Refusal                   | Why                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| duplicate step label      | A label is the `--only` token and the name on a failure line; it must name exactly one step. |
| unknown `--only` label    | The error lists the labels the requested mode does hold.                                     |
| a selection of zero steps | Checked on the _outcome_, so it still holds when the selection logic itself is wrong.        |

The first is a property of the **table**, so it is checked before the mode is applied and before
`--only` narrows: a malformed table is refused whichever run was asked for, and `--only` cannot route
around a bad step. This is what makes a step table self-validating — a project needs no test of its
own to assert the rule.

An **empty `only` array is the flag's absence**, not a request for nothing: that is what a repeatable
flag resolves to when it was never given, and reading it as "select no steps" would refuse every
unscoped run.

#### `cloudflareWorkerSteps(options?)`

The step table every Cloudflare Worker app in this fleet shares, in execution order:
`types:cf-runtime` → `types:cf-bindings` → `types:assets` → `typecheck` → `lint` → `format` →
(`governance`) → `test` → (`validate-asset-root`). Generation leads judgement, so a stale generated
type surfaces as a type error. No step declares a dependency, so the preset runs unconditionally in a
fast run.

The two `wrangler types` invocations are two steps rather than one `&&` chain, so a failure names
which one broke. `--config` goes on the bindings invocation only — runtime types do not depend on the
wrangler config.

`CloudflareWorkerStepOptions`:

| Field           | Type                | Default              | Description                                                                                      |
| --------------- | ------------------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| `sources`       | `readonly string[]` | `["src/", "tests/"]` | Directories linted, formatted and type-checked.                                                  |
| `tests`         | `readonly string[]` | `["tests/"]`         | Test paths passed to `bun test`.                                                                 |
| `assetConfig`   | `string?`           | —                    | Asset config path. Omit to skip the `types:assets` step entirely.                                |
| `assetOut`      | `string`            | `.forge/assets.ts`   | Where the asset-types emitter writes.                                                            |
| `wranglerTypes` | `boolean`           | `true`               | Emit the two `wrangler types` steps. `false` for an app that declares its binding types by hand. |
| `workerConfig`  | `string?`           | —                    | `--config` for the bindings invocation.                                                          |
| `governance`    | `boolean`           | `false`              | Add the `gov sync --check` step. Opt-in: it needs a cloned corpus.                               |
| `root`          | `string`            | `process.cwd()`      | Application root, needed by the asset-root check.                                                |

The asset-root step is added only when **both** `assetConfig` and `workerConfig` are given: the
assets config names what is written to the asset root, the wrangler config names what the Worker is
kept out of, and comparing them needs both halves.

The two generated-type paths (`./.types/cloudflare.d.ts` and `./.types/worker-configuration.d.ts`)
are baked in rather than exposed — every app in the fleet uses them, and an option nobody varies is
surface for nothing.

#### `forgeChecks(options)`

The baseline table for a library published under an `exports` map, in execution order: `typecheck` →
`lint` → `format` → `test` → `validate-exports` → `validate-jsx` → `validate-docs` →
`validate-changelog` → `validate-class-order`. Only the checks whose config is derivable from `root`
and `package.json` are here; a design, contrast, namespace-graph or CSS-sources step carries
project-specific policy, so it is named explicitly alongside.

`LibraryStepOptions`:

| Field                                                   | Type                     | Default       | Description                                                                       |
| ------------------------------------------------------- | ------------------------ | ------------- | --------------------------------------------------------------------------------- |
| `root`                                                  | `string`                 | —             | Repository root. Every check resolves and reports its paths against it. Required. |
| `pkg`                                                   | `GatePackage`            | —             | `{ name; version; exports; files }`, verbatim from `package.json`. Required.      |
| `sources`                                               | `readonly string[]`      | `["src/"]`    | Directories linted and formatted.                                                 |
| `tests`                                                 | `readonly string[]`      | whole project | Test paths passed to `bun test`.                                                  |
| `exports` / `docs` / `jsx` / `changelog` / `classOrder` | `Partial<…CheckConfig>?` | —             | Merged over the config derived from `pkg`, for that check's allowlists.           |

### Findings

| Export              | Purpose                                                                           |
| ------------------- | --------------------------------------------------------------------------------- |
| `fail` / `warn`     | Build one `Finding` at each level.                                                |
| `checkResult`       | Derive a `CheckResult` from findings plus a summary line.                         |
| `scannedNothing`    | The refusal a check returns when its configured sources matched nothing.          |
| `formatFinding`     | One finding as a printable line.                                                  |
| `formatCheckResult` | A whole result as printable text.                                                 |
| `reportCheck`       | Print a result and return the process exit code — for a check run outside a gate. |

### Changelog

| Function            | Signature                                                            | Description                                                                                           |
| ------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `parseChangelog`    | `(source: string) => ChangelogParse`                                 | Reads the structure without changing it.                                                              |
| `promoteUnreleased` | `(source: string, opts: PromoteOptions) => ValidationResult<string>` | Retitles `[Unreleased]`, inserts a fresh empty one above it, and appends the compare-link definition. |
| `formatReleaseDate` | `(date: Date) => string`                                             | `YYYY-MM-DD` in the **local** calendar — not UTC.                                                     |

`PromoteOptions`:

| Field            | Type      | Default | Description                                                     |
| ---------------- | --------- | ------- | --------------------------------------------------------------- |
| `version`        | `string`  | —       | Version being promoted to — bare semver, no leading `v`.        |
| `date`           | `string`  | —       | Already-formatted release date.                                 |
| `tagPrefix`      | `string`  | `"v"`   | Prefix used in the compare URL's tag names.                     |
| `compareUrlBase` | `string?` | —       | Repository base URL. Omit to skip the link definition entirely. |

`ChangelogParse` is a [`ValidationResult`](../../result/README.md)`<ChangelogDocument>` —
`{ ok: true; data }` or `{ ok: false; error: readonly string[] }`. `ChangelogDocument` is
`{ unreleased: UnreleasedSection; versions: readonly VersionHeading[]; linkRefs: readonly string[] }`.

| Type                | Shape                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `VersionHeading`    | `{ version: string; date: string; line: number }` — bare semver, ISO date, zero-indexed line.             |
| `UnreleasedSection` | `{ line: number; body: readonly string[]; empty: boolean }` — verbatim body up to the next `## ` heading. |

A parse fails on: no `[Unreleased]` section, more than one, an entry heading above it, an entry
heading not matching `[X.Y.Z]` followed by an **em dash** (U+2014) and an ISO date, or a date whose
shape is right but whose calendar day does not exist. `empty` is `true` when the body holds only
blank lines, `---` separators, or the `_Nothing yet._` placeholder.

`promoteUnreleased` leaves every byte below the insertion point untouched, so a document with no
trailing newline round-trips exactly. The compare link is omitted when `compareUrlBase` is absent or
there is no earlier released version.

### SemVer

| Function        | Signature                                 | Description                                                                                                                  |
| --------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `parseSemVer`   | `(str: string) => SemVer \| null`         | Parses `major.minor.patch` (optional `v` prefix). Rejects leading zeros, negatives, and malformed input by returning `null`. |
| `formatSemVer`  | `(v: SemVer) => string`                   | Formats a `SemVer` back to `"major.minor.patch"`.                                                                            |
| `compareSemVer` | `(a: SemVer, b: SemVer) => -1 \| 0 \| 1`  | Orders two versions.                                                                                                         |
| `isGreaterThan` | `(next: SemVer, prev: SemVer) => boolean` | `true` when `next` is strictly greater than `prev`.                                                                          |
| `bumpSemVer`    | `(v: SemVer, kind: BumpKind) => SemVer`   | Returns a new version bumped by `kind`, zeroing lower components.                                                            |

`SemVer` is `{ major: number; minor: number; patch: number }`. `BumpKind` is
`"major" | "minor" | "patch"`.

### Barrel parsing

The parsers the export and README checks read a `mod.ts` with, published because
`tooling/release`'s surface guard reads the same shapes: `parseBarrelExports`,
`parseBarrelExportNames`, `parseConsumerExportNames`, `parseTypeExportNames`, `exportNamesFromLine`,
and `findPublicSymbols`.

---

## See also

- [`@y-core/forge/tooling/release`](../release/README.md) — the release workflow built on this
  namespace's changelog and semver primitives.
- [`@y-core/forge/tooling/lint`](../lint/README.md) — the oxlint plugin and the rule catalogs
  `validate-design` and `validate-modern-css` read.
- [`@y-core/forge/tooling/cli`](../cli/README.md) — the command framework and `resolveAppRoot`.
- [`ASSET_AND_BUILD_TOOLING.md`](../../../.decisions/implementation/ASSET_AND_BUILD_TOOLING.md) §5f,
  §5g, §5h and §5i — the published gate, the fleet preset, root resolution, and the check layering.
- [`TESTING.md`](../../../.decisions/implementation/TESTING.md) §6 — the gate's two modes and its
  flags as forge itself runs them.
