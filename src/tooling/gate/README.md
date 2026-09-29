---
title: The Verification Gate
description: "The verify command over a declared step table, a pre-built step per check forge ships, and the changelog and semver parsers it reads version state with."
audience: internal
---

# `@y-core/forge/tooling/gate`

A project's verification gate is **one command over one table**. You declare the table in `config/steps.ts`; `forge verify` finds it, resolves which
rows the requested tier wants, and runs them fail-fast. Nothing else is yours to write: no binding script, and no spawnable file per check.

Reach for this namespace when you are wiring a repository's gate, adding a check to one, or reading a repository's version state.

```ts
import { cloudflareWorkerSteps, createGateCommand, forgeChecks, type Step } from "@y-core/forge/tooling/gate";
```

> **Node.js / Bun only.** This namespace shells out to your build tools via `node:child_process` and reads and writes files via `node:fs`. **Do not
> import it into a Cloudflare Worker or a client bundle.**

> The barrel rule, what stays unpublished and why, the check layering, and where a project root comes from are owned by [`BUILD_TOOLING.md`][bt-2]
> §2 — as are the bin-versus-factory split and the modes (§2f), the fleet preset (§2g), and the general law behind the modes,
> [`TESTING.md`][testing-6a] §6a. `tooling/release` builds on this namespace, never the reverse.

---

## Getting started

**One file.** `config/steps.ts` holds your table and default-exports it. A pre-built step is a value, so the table stays the one place to read;
anything forge ships no step for is an ordinary `cmd` row, as `check:bindings` is below.

```ts
// config/steps.ts
import { resolveAppRoot } from "@y-core/forge/tooling/cli";
import { browserStep, cloudflareWorkerSteps, jsxStep, type Step } from "@y-core/forge/tooling/gate";

const ROOT = resolveAppRoot();

export const STEPS: readonly Step[] = [
  ...cloudflareWorkerSteps({ assetConfig: "assets.config.ts" }),
  jsxStep({ root: ROOT }),
  { label: "check:bindings", tail: 30, cmd: ["bun", "run", "tools/check-bindings.ts"] },
  browserStep(),
];

export default STEPS;
```

A hand-written row states its `label` (the `--only` token and the name reported on failure), its `cmd`, and the `tail` of captured output to show
when it fails. Add `fix` for what `--fix` should spawn instead, `tier` for the lowest mode it runs in, `requires` for a tool the machine
may not have, and `watches` for the paths `--affected` should run it on.

Then wire the scripts:

```json
{
  "scripts": {
    "verify": "forge verify",
    "verify:quality": "forge verify --mode quality",
    "verify:full": "forge verify --full",
    "lint": "forge verify --only lint",
    "fix": "forge verify --fix"
  }
}
```

`config/steps.ts` is the default path, published as `DEFAULT_STEPS_CONFIG`. **An absent default path is an error, not a silent empty gate** — and so
is a `--config` naming a file that does not exist, so a typo can never read as a green run.

---

## Choosing which checks your gate runs

Every validator forge runs on itself is a pre-built step you can drop into a table, and a published function you can call on its own. Pick the rows
that match rules your repository actually holds; the label in each row is its `--only` token.

| Step | Proves |
| --- | --- |
| `exportsStep` → `validate-exports` | Every declared subpath resolves, every `@public` symbol is in its barrel, and every barrel, `files[]` entry and asset is reachable |
| `namespaceGraphStep` → `validate-namespace-graph` | Every cross-namespace import is declared, with the right kind, and no mutual value pair; the named document carries no namespace catalogue, composes table or classification column |
| `packagingStep` → `validate-packaging` | No module the tarball carries is one only a test reaches, computed from the `exports` map and `bin`; `required` fails each named file the `files` array leaves out or the disk lacks; every published namespace resolves to a README the tarball carries |
| `coLocationStep` → `validate-co-location` | Every source module has a test beside it, so deleting one is loud |
| `commentBudgetStep` → `validate-comment-budget` | Every comment in the files and directories your `sources` names is one [`CODE_RULES.md`][cr-5a] §5a permits, less a `!` entry's subtree — `!**/.wrangler` drops every `.wrangler` at any depth; `licences` waives the cap for one leading attribution header |
| `jsxStep` → `validate-jsx` | Every shipped `.tsx` carries its runtime pragmas |
| `menuNamingStep` → `validate-menu-naming` | Every **shipped** `triggered` `Menu.Popup` has the trigger it takes its accessible name from; a file naming a popup or a trigger through a value goes unjudged |
| `ssrBoundaryStep` → `validate-ssr-boundary` | No Worker-executed module reaches the browser-only tier |
| `importBoundaryStep` → `validate-import-boundary` | No module outside a guarded directory imports one at value, save the files named as `crossings`; a crossing naming no scanned file fails; given `features`, each feature's directory is guarded too, and imports only the features it requires |
| `devBoundaryStep` → `validate-dev-boundary` | The Worker's `main` is not a `*.dev.ts` entry, nothing imports one, and only such an entry imports a dev-only module at value |
| `stubGlobalsStep` → `validate-stub-globals` | No shipped module names a global only your private `.d.ts` stubs declare, which a consumer's real types cannot resolve; `shared` lists the globals the real types declare too, and an entry no stub declares fails |
| `exposureStep` → `validate-exposure` | Every deployment the Worker config describes states `workers_dev`, `preview_urls` and its routing key; `require: "unroutable"` demands the values that keep it off the public internet |
| `assetRootStep` → `validate-asset-root` | What the assets pipeline writes to the asset root matches the Worker's `run_worker_first` exclusions |
| `assetManifestStep` → `validate-asset-manifest` | Every path the emitted assets manifest maps to exists under the served asset directory |
| `markdownStep` → `validate-markdown` | Markdown holds the house conventions — compact tables, one bullet marker, tagged fences, no stray whitespace |
| `modernCssStep` → `validate-modern-css` | Stylesheets and class literals use the platform feature that replaced each hand-written pattern |
| `cssSourcesStep` → `validate-css-sources` | Every utility class the library emits is visible to a consumer's Tailwind scan |
| `cssTokensStep` → `validate-css-tokens` | No `@theme` token is declared in a namespace the utility vocabulary overloads |
| `classOrderStep` → `validate-class-order` | Every class literal is a fixed point of `cn`, so sorting one cannot change what it renders |
| `classTokensStep` → `validate-class-tokens` | Every class token in the source resolves to CSS the design system compiles, and none ends in a variant that an interpolation completes |
| `classGroupsStep` → `validate-class-groups` | `cn`'s conflict table matches the one regenerated from the design system |
| `designScaleStep` → `validate-design-scale` | The design-scale data the lint plugin reads matches the one regenerated from the design system |
| `contrastStep` → `validate-contrast` | Every audited foreground/background pair meets its contrast criterion |
| `lintPluginStep` → `validate-lint-plugin` | The committed oxlint-plugin bundle a consumer loads matches a fresh build of its TypeScript source |
| `chromiumBundleStep` → `validate-chromium-bundle` | The committed chromium-resolution bundle a `playwright.config.ts` imports matches a fresh build of its source |

The tool rows carry no check and simply spawn: `typecheckStep` (`typecheck`), `lintStep` (`lint`), `formatStep` (`format`), `typeAwareLintStep`
(`lint:types`) and `testStep` (`test`, or a `label` of your own for one set of a split suite). Others spawn something a machine may not have —
`browserStep` (`test:browser`), `workerdStep` (`test:workerd`) and `dbSchemaStep`, which returns the **pair** `db:schema:digests` and `db:schema`.

**The documentation, changelog, design and knowledge-index rows are warden's, not this namespace's.** `docsStep` (`validate-docs`), `changelogStep`
(`validate-changelog`), `designStep` (`validate-design`), `wardenStep` (`warden:index`), `wardenQueriesStep` (`warden:queries`) and `duplicatesStep`
(`warden:duplicates`) come from `@y-core/forge/warden/steps`, and an application appends the ones it needs through `wardenAppSteps`. No preset here
can emit them: this namespace lives under `src/`, and nothing there may import warden. A table wanting both concatenates the two lists.

---

## Starting from a preset

Presets compose the tables this fleet shares, so a repository names its policy rather than its rows.

**`cloudflareWorkerSteps(options?)` — a Worker application.** Generation leads judgement in the order it declares, so a stale generated type
surfaces as a type error rather than a mystery; `verify --list` prints the rows a given mode resolved to.

Most rows are opt-in, and each option is a question about your repository rather than a switch:

| You have | State | What it adds |
| --- | --- | --- |
| A `wrangler.jsonc` this gate should read | `workerConfig` | `--config` on the bindings invocation, plus `validate-exposure` — tuned by `exposure` |
| An assets pipeline | `assetConfig` (and `assetOut`) | `types:assets` and `validate-asset-manifest`; with `workerConfig` too, `validate-asset-root` |
| Hand-written binding types | `wranglerTypes: false` | Drops both `wrangler types` rows |
| A suite split by the question each set answers | `testSets` | One labelled `bun test` row per set, replacing the single `test` row that `tests` feeds |
| `ui/*` components and a Tailwind stylesheet | `design` | The platform-CSS and class rows; `design.cssDir` adds `validate-css-tokens` |
| Contrast pairs this repository actually draws | `contrast` | `validate-contrast` — the audit fails a run that measured no pairs |
| A browser-only directory tier of your own | `ssrBoundary` | `validate-ssr-boundary` |
| A tree the rest of `src/` may not import, save named files | `importBoundary` | `validate-import-boundary`; beside `features`, it also reads the feature manifest |
| Markdown oxfmt has been told to ignore | `markdown` | `validate-markdown` |
| A library's `.tsx` compiled under a consumer's tsconfig | `jsx` | `validate-jsx`; an application states `jsxImportSource` once instead |
| Cloned `.claude/` trees | `warden: true` | The `warden sync --check` row |
| D1 schemas, Playwright specs, workerd specs | `db`, `browser`, `workerd` | The prerequisite-bearing rows, last in the table |
| A demonstrator with a `config/features.ts` manifest | `features: {}` | `validate-features` — curates into a temp tree once per distinct resolved profile (default: each feature alone, then all) and runs its `standard` gate there, last in the table |

**`validate-dev-boundary` is the one row an app cannot opt out of.** It reads the forbidden specifiers from forge's installed manifest, so an app
that configures nothing still fails on a deployed module importing `@y-core/forge/testing` — whose fakes lose every write — or
`@y-core/forge/dev`, whose token is what opens each dev-only relaxation ([`NAMESPACES.md`][namespaces-5i] §5i).

**Only `test` defaults above the `quality` tier**, to `standard`: every other row judges the source rather than running it. `design.sources` does
not fall back to the table's top-level `sources`, and `design.deferred` defaults to `[]` rather than forge's own list — no application should
inherit deferrals keyed to `src/ui/…` paths.

**`forgeChecks({ root, pkg })` — a library published under an `exports` map.** In execution order: `typecheck` → `lint` → `format` → `test` →
`validate-exports` → `validate-jsx` → `validate-class-order`. `pkg` is `{ name, version, exports, files }` verbatim from `package.json`, and
`exports`, `jsx` and `classOrder` each merge over the config derived from it. Only checks whose config is derivable from `root` and the manifest
live here; anything carrying project-specific policy is named alongside.

---

## Configuring a check

Configuration goes to the builder, in the step table itself — a check's allowlists live there rather than in a config file of their own.

```ts
// config/steps.ts
exportsStep({
  root: ROOT,
  packageName: pkg.name,
  exports: pkg.exports,
  files: pkg.files,
  browserOnly: [],
  sealedInternal: ["src/crypto/mod.ts"],
}),
```

**Where the tree already states a fact, the check derives it and the config field is the override, not the declaration.** `browserOnly` is empty
above because a subpath under a `client` segment is browser-only by its own name; an entry is for one that is browser-only under another name. The
escapes — `browserOnly`, `sideEffectOnly`, `sealedInternal` — are each held to the tree they name: an entry the convention already derives, or
one naming a subpath the map does not have, fails rather than sitting inert.

Every builder takes `{ tier, requires, watches }` as its last argument, so a check can be raised to any tier whatever its default, its dependency
replaced or dropped with `requires: null`, and the paths `--affected` reads it by replaced or dropped with `watches: null`.

### Opting out of a markdown rule

`markdownStep` walks every `.md` under `sources` (default `["src"]`), honouring both a `!`-prefixed source and the `exclude` list — the latter is
where a generated tree goes, whose bytes another tool owns.

```ts
markdownStep({ root: ROOT, sources: ["src", "docs", "README.md"], exclude: ["CHANGELOG.md", ".claude"], rules }),
```

Every rule is optional and every one accepts `"off"`, so a project opts out without forking the check. `rules.lineLength` is off by default and
takes a `scope` of path prefixes, for the common case of a tree where part already holds a wrap column and part does not.

**The fixer applies only the mechanical rules** — table padding, list markers and nested indent, emphasis delimiters, fence style and language
aliases, hard tabs, trailing whitespace, thematic breaks, and the blank line around a block. **Some rules are report-only**: a bare fence, a bare
URL, a second `# ` heading, and an over-long line.

### Deferring a CSS finding you cannot fix yet

`modernCssStep` scans `.css`, `.scss`, `.sass`, `.ts` and `.tsx` under each entry of `sources`; a `!`-prefixed entry **excludes** a subtree, which
is how a design corpus or a fixture directory quoting the very patterns the check forbids stays out of the scan. Findings whose rule is `fail`
block the gate; the rest are warnings that survive a passing step.

```ts
modernCssStep({
  root: ROOT,
  sources: ["src", "!src/fixtures"],
  deferred: [{ path: "src/legacy", ruleId: "forge-ui-platform-logical-spacing", owner: "ABCD-412" }],
}),
```

`deferred` is a **shrink-only** list: one entry per path and rule, each naming the task that closes it. An entry with an empty `owner`, and an entry
whose path does not violate its rule, both fail. Naming it replaces forge's own list rather than adding to it.

Every rule id, its tier, its severity and the feature that replaces it are owned by `MODERN_CSS_RULES` in
[`@y-core/forge/tooling/lint`][lint-readme]; the rule each finding cites is explained for readers in forge's design corpus at
`src/ui/design/reference/16-platform.md`.

---

## Running and narrowing a run

```bash
bun run verify                     # the `standard` tier, fail-fast — what a task closes on
bun run verify:quality             # the writing loop (`--mode quality`)
bun run verify:full                # everything, prerequisites included (`--full`)
bun run verify --list              # print the resolved selection, run nothing
bun run verify --only lint,test    # narrow the run (branded as scoped)
bun run verify --fix               # run each selected step's fixer instead
bun run verify --reuse             # answer at once if this exact tree already passed
bun run verify --affected          # run only the steps this change touches (branded as scoped)
```

| Flag | Effect |
| --- | --- |
| `--mode <m>` | Which tier to run: `quality`, `standard` or `full`. Default `standard`; an unrecognised value is refused. |
| `--full` | Sugar for `--mode full`. Passing both is refused rather than given a precedence. |
| `--only <a,b>` | Run only those steps, in the run's own order. Repeatable and comma-separated; an unknown label is refused with the known ones listed. |
| `--list` | Print the resolved selection and exit, running nothing. |
| `--fix` | Run each selected step's fixer instead of the step. Steps without one are counted as having no fixer. |
| `--reuse` | Exit green at once when a passing run of this exact tree is on record at this mode or above; otherwise run the gate. Takes no `--only`, `--fix`, `--list` or `--affected`. |
| `--affected` | Run only the steps whose `watches` the working tree's changes touch. Always a scoped run; refused outside a git work tree. |
| `--config <path>` | Step-table module, relative to `--root` or absolute. Default `config/steps.ts`. |
| `--root <path>` | Directory every step runs in, and the base a relative `--config` resolves against. Default the working directory. |

Output is one line per step, then one verdict line:

```text
✓ typecheck (0.9s)
✗ lint (0.8s)
    src/app/routes.ts:14:3 lint/style/useConst ...
    full log at /tmp/forge-gate-a1b2c3/lint.log
✗ verify — failed at `lint` (step 2 of 5, 1.7s)
```

**The verdict is the summary line**, not the raw tool output beneath it. A failing step exits 1, so `prepublishOnly: "bun run verify:full"` blocks a
red gate. A failing step's untruncated output is written to a temp file and its path printed under the excerpt, so a signal outside the `tail`
window is still recoverable. A narrowed run brands its summary as scoped, so a scoped green never reads as a green gate.

**`--only` and `--fix` are the two halves of a dev loop, and they are not the same verb.** `--only lint` runs the check and writes nothing; `--fix`
writes and checks nothing, and closes by naming the run that confirms it. Script them as `lint` and `fix` so the distinction shows at the call site.

**`createGateCommand` stays published** for the case the binary cannot serve. It takes the same flags minus `--config` and `--root`, because the bin
command delegates to it as soon as the table is loaded:

```ts
import { execute, resolveAppRoot } from "@y-core/forge/tooling/cli";
import { createGateCommand } from "@y-core/forge/tooling/gate";

await execute(createGateCommand({ cwd: resolveAppRoot(), steps: STEPS }));
```

---

## Skipping a run this tree already passed

`--reuse` is for the second run of a tree nobody has touched since the first — a reviewer's baseline after the developer's closing run. **If the
gate has a passing run of these exact bytes on record, it prints one line and exits 0**:

```text
✓ verify — reused the passing full run of tree 9d1e5c2a07b4f36e8a51c0d9b2f7e4a6c3185d20; no step ran
```

Otherwise it says why and runs the gate as if the flag were absent:

```text
○ no passing run of tree 5a27f0c8e3d19b64a7c2e8f1d05b3a96e4c7d812 on record at standard or above; running the gate
```

**Only a green run of the whole gate records a receipt.** The run must be unscoped — no `--only` and no `--affected` — pass at least one step, fail
none and skip none. `--fix` and `--list` never record one, and `--reuse` refuses to be combined with any of them, because it stands in for a whole
gate run. A red or skipped unscoped run deletes the receipt it finds, so the newest verdict on a tree is the one that stands. A scoped run leaves
the receipt alone.

**The receipt names a hash of the working tree, not a commit.** Tracked and untracked files are both hashed and ignored files are not, so an edit,
a new untracked file or a deletion each means the next `--reuse` runs the gate, and reverting the change makes the old receipt answer again. If
something writes into the tree while the gate runs, the run records nothing and prints `○ the tree changed during the run — no receipt written`.

**A receipt answers its own mode and every mode below it.** A `full` pass answers `verify --reuse` and `verify --mode quality --reuse`; a
`quality` pass never answers `verify --reuse`. A later lower-mode pass on the same tree keeps the higher-mode receipt rather than replacing it. The
receipt also lists the steps it ran, so a table that now selects a step the receipt does not name runs the gate again.

**The receipt lives in the git directory**, at `git rev-parse --git-path forge-verify-receipt.json` — `.git/forge-verify-receipt.json`, and a
linked worktree gets its own. Nothing in your `.gitignore` needs to change. Why it lives there is [`BUILD_TOOLING.md`][bt-2f] §2f's.

**Outside a git work tree there is no hash, so there is no receipt.** A passing run records nothing, and `--reuse` prints
`○ not a git work tree — no receipt to reuse; running the gate` and runs.

**A nested git repository inside the tree is hashed as a gitlink**, which records only the commit its `HEAD` points at. An uncommitted edit inside
it therefore changes no hash, and a receipt recorded before the edit still answers. Run the gate without `--reuse` after working in one.

---

## Running only what a change touches

`--affected` runs the steps a working-tree change can affect and skips the rest. It is for the inner loop: **the run is always branded scoped**,
even when every step ran, and it never records a receipt, so a task still closes on the unscoped gate ([`TESTING.md`][testing-6] §6).

The change is the working tree against `HEAD`: staged and unstaged edits, deletions, untracked files, and both halves of a rename, with ignored
files left out. The whole repository is read, so a change above `--root` is seen too. Outside a git work tree the flag is refused.

**A step runs when a changed path matches one of its `watches` globs**, which are relative to the directory the gate runs in. `*` stays inside one
path segment, `**` crosses segments, and dot-directories match. `dir/**` matches everything beneath `dir` but not `dir` itself. **A step with no
`watches` runs on every change**, which is the safe reading of a step whose inputs nobody declared.

**Builders derive `watches` from their own config**, so most rows need nothing: `jsxStep({ root: ROOT, sources: ["src"] })` watches `src` and
everything under it. A builder whose inputs no path list bounds — the type program, a test suite, a bundle built from an import graph — derives
none and runs on every change. The `watches` option overrides the derived value:

```ts
contrastStep(config, { watches: ["src/ui/assets/css/**", "src/ui/contracts/theme/**"] }), // replaces the derived list
lintStep({ sources: ["src/"], watches: null }), // drops it, so the step runs on every change
{ label: "check:bindings", tail: 30, cmd: ["bun", "run", "tools/check-bindings.ts"], watches: ["tools/**", "wrangler.jsonc"] },
```

A table that declares `watches: []` or an entry starting with `!` is refused: a declaration may only widen what a step runs on, and either form
would silently skip the step.

**A change to a gate-wide input runs every step.** `DEFAULT_GATE_INPUTS` names the paths every step reads — the manifest and lockfile among them,
and anything above the gate's root. `forge verify` adds the step-table module itself. To add paths of your own, export `GATE_INPUTS` from the
table module; it is appended to the default and can never remove from it:

```ts
// config/steps.ts
export const GATE_INPUTS: readonly string[] = ["tools/gate/**"];
```

Embedding the gate through `createGateCommand` instead, pass the same list as `gateInputs`.

**When no step is touched, nothing runs and the exit is 0.** A clean tree prints
`○ verify --affected — no change against HEAD; nothing ran ⚠ scoped run (0 of N steps) — not the gate`, and a change that matches no step says
how many paths it saw instead. Neither line is a green gate.

The flag composes with the rest. `--mode` picks the tier first, `--only` then narrows to the labels it names, and `--affected` narrows what is left.
`--fix --affected` runs the fixers of the affected steps, and `--list --affected` prints the affected selection without running it. Only `--reuse`
refuses it.

---

## Requiring a tool the machine may not have

A step declares `requires` — the tool's name, the predicate that answers whether it is present, and the remedy to print. **The mode answers its
absence**: below the `full` tier the step is skipped, and a full run fails it.

```text
✗ test:browser — chromium not found; run `bunx playwright install chromium`
```

`hint` is **printed verbatim**, so it carries its own verb and backticks: `browserStep({ hint: "run \`pnpm exec playwright install\`" })`. Probe for
the **thing**, not the CLI that uses it — `hasChromium` resolves `CHROME_PATH` first and Playwright's own download second, and `hasWorkerd` answers
for the runtime rather than for `bun`. Probing the CLI instead would pass vacuously and let every spec fail at launch.

**`browserStep` spawns `playwright test` — the installed binary off `binDir`, whose shebang is node.** Not `bunx`, which installs from the registry
when it resolves nothing locally, and not under bun, where a `webServer` playwright spawns binds somewhere a sandboxed browser cannot reach. Match
your own `test:browser` script to the same command so the two cannot diverge.

---

## Writing your own check

A check takes a config and returns findings rather than printing and exiting, so the same function serves a gate row, a script, and a test.

```ts
import { checkResult, fail, type CheckResult, reportCheck, scannedNothing, warn } from "@y-core/forge/tooling/gate";

export function checkBindings(config: { root: string; sources: readonly string[] }): CheckResult {
  const files = collect(config);
  if (files.length === 0) return scannedNothing("bindings", config.sources);
  const findings = files.flatMap((file) => (isStale(file) ? [fail(`stale binding`, { file })] : [warn(`unverified`, { file })]));
  return checkResult(findings, `checked ${files.length} files`);
}

process.exit(reportCheck(checkBindings({ root, sources: ["src"] })));
```

`ok` is **derived** from the findings and never passed: a `fail` finding fails the check, a `warn` is reported and does not. `checkStep(label, run,
options)` wraps the function as a table row, and `run` is handed the run's mode, so one row can vary its strictness by tier.

A check runs in-process: the runner prints its findings directly, so nothing is truncated to `tail` lines and warnings survive a passing step. A
check that throws fails its own step rather than unwinding the run. Its fixer runs in-process too, and nothing is probed before it.

The `parse*` / `validate*` / `resolve*` / `check*` / `format*` prefixes name the layer a function belongs to; the vocabulary and its purity rules
are [`BUILD_TOOLING.md`][bt-2i] §2i's. The barrel parsers (`parseBarrelExports`, `findPublicSymbols` and their siblings) are published because
`tooling/release`'s surface guard reads the same shapes.

---

## Testing your own step table

`selectSteps` is pure — no disk, no spawning, no clock, and no probe — so the whole selection surface is assertable at zero step cost.

```ts
import { type GateMode, selectSteps } from "@y-core/forge/tooling/gate";
import { STEPS } from "./steps";

const result = selectSteps(STEPS, { mode: "quality" });
if (result.ok) expect(result.steps.map((s) => s.label)).toEqual(["types:cf-runtime", "types:cf-bindings", "typecheck", "lint"]);

// Each mode is a superset of the one below it, by construction — selection is a rank comparison.
const labels = (mode: GateMode) => {
  const selection = selectSteps(STEPS, { mode });
  return selection.ok ? selection.steps.map((s) => s.label) : [];
};
expect(labels("quality").every((label) => labels("standard").includes(label))).toBe(true);

// Selection calls no probe, so what a table selects never depends on the machine it runs on.
expect(selectSteps(STEPS, { mode: "full" }).ok).toBe(true);

// `changed` is what `--affected` passes: assert which rows a given edit reaches.
const touched = selectSteps(STEPS, { mode: "standard", changed: ["src/ui/x.tsx"] });
if (touched.ok) expect(touched.steps.map((s) => s.label)).not.toContain("validate-exposure");
```

Refusals come back as `{ ok: false, error }` rather than a throw: a duplicate label, `watches: []` or a `!` entry in `watches`, an unknown
`--only` label, and a selection of zero steps. **A zero-step selection is not refused when `changed` is given** — it comes back `ok` with no steps,
and an empty `changed` selects nothing at all, not even a step with no `watches`.
**The duplicate check is a property of the table**, so it runs before the mode is applied and before `--only` narrows — a malformed table is refused
whichever run was asked for.

---

## Reading and promoting a changelog

Pure string transforms — no filesystem, no clock, no git. Failures are **returned, not thrown**, so a caller can report every malformed heading in
one pass.

```ts
import { formatReleaseDate, parseChangelog, promoteUnreleased } from "@y-core/forge/tooling/gate";

const parsed = parseChangelog(source);
if (parsed.ok) console.log(parsed.data.unreleased.empty, parsed.data.versions[0]?.version);

const result = promoteUnreleased(source, {
  version: "0.0.84", // bare semver, no leading `v`
  date: formatReleaseDate(new Date()), // YYYY-MM-DD in the local calendar, not UTC
  tagPrefix: "v",
  compareUrlBase: "https://github.com/y-core/forge", // omit to skip the link definition entirely
});
if (result.ok) console.log(result.data);
```

A parse fails on: no `[Unreleased]` section, more than one, an entry heading above it, an entry heading not matching `[X.Y.Z]` followed by an **em
dash** (U+2014) and an ISO date, or a date whose shape is right but whose calendar day does not exist. `unreleased.empty` is `true` when the body
holds only blank lines, `---` separators, or the `_Nothing yet._` placeholder.

`promoteUnreleased` leaves every byte below the insertion point untouched, so a document with no trailing newline round-trips exactly. The compare
link is omitted when `compareUrlBase` is absent or there is no earlier released version.

For versions on their own, `parseSemVer` returns `null` rather than throwing on leading zeros, negatives or malformed input; `formatSemVer`,
`compareSemVer`, `isGreaterThan` and `bumpSemVer` work over the parsed `{ major, minor, patch }`, and a bump zeroes every lower component.

```ts
formatSemVer(bumpSemVer(parseSemVer("v1.2.3")!, "minor")); // "1.3.0"
```

---

## Gotchas

**Tools that both claim markdown undo each other.** `oxfmt` pads every table cell to the widest column and has no option to stop, so a project
running `validate-markdown` must put `**/*.md` in `.oxfmtrc.json`'s `ignorePatterns` — otherwise each tool reverses the other on every
`bun run fix`.

**A types-only assets artifact passes a quality run alone.** `gen types` maps every logical name to itself and those files deliberately do not
exist, which is what lets `tsc` run on a clean checkout — so `validate-asset-manifest` lets it through on `quality` and fails it on `standard` and
`full`, where passing on an artifact nobody built is exactly the 404 the check exists to prevent.

**Import `resolveChromiumPath` from `@y-core/forge/tooling/gate/chromium`, not from the barrel.** Node refuses to strip types from a file under
`node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so a `playwright.config.ts` must load the prebuilt `.mjs` at that subpath.

**A value your table imports from outside `config/` is an input no builder can see.** `--affected` reads a builder's `watches` from its config
paths, so an allowlist or rule table imported from `src/…` is invisible to it, and an edit there skips the step. State `watches` on that row
yourself, or add the module's path to `GATE_INPUTS`.

**An empty `--only` array is the flag's absence, not a request for nothing.** That is what a repeatable flag resolves to when it was never given,
and reading it as "select no steps" would refuse every unscoped run.

---

## See also

- [`@y-core/forge/tooling/release`][release-readme] — the release workflow built on this namespace's changelog and semver primitives.
- [`@y-core/forge/tooling/lint`][lint-readme] — the oxlint plugin and the rule catalogs `validate-design` and `validate-modern-css` read.
- [`@y-core/forge/tooling/cli`][cli-readme] — the command framework and `resolveAppRoot`.
- [`BUILD_TOOLING.md`][bt-2f] §2f, §2g, §2h and §2i — the published gate, the fleet preset, root resolution, and why checks are functions rather
  than scripts.
- [`TEST_RUNNERS.md`][testing-6] §6 — the gate's three modes and its flags as forge itself runs them.
- [`TESTING.md`][testing-6a] §6a — the general law the modes and the dependency skip implement.

[bt-2]: ../../../docs/BUILD_TOOLING.md#2-toolinggate-and-toolingrelease--project-tooling
[bt-2f]: ../../../docs/BUILD_TOOLING.md#2f-creategatecommand--the-published-verification-gate
[bt-2i]: ../../../docs/BUILD_TOOLING.md#2i-checks-are-functions-not-scripts
[cli-readme]: ../cli/README.md
[cr-5a]: ../../../warden/canon/shared/CODE_RULES.md#5a-the-entire-permitted-budget
[lint-readme]: ../lint/README.md
[namespaces-5i]: ../../../docs/NAMESPACES.md#5i-dev--a-dev-only-allowance-never-a-boolean-on-a-production-option
[release-readme]: ../release/README.md
[testing-6]: ../../../docs/TEST_RUNNERS.md#6-the-verification-gate
[testing-6a]: ../../../warden/canon/libs/TESTING.md#6a-one-command-three-modes
