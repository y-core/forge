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

> The rulings behind this surface are [`BUILD_TOOLING.md`][bt-2] §2's, and the general law behind the tiers is [`TESTING.md`][testing-6a] §6a.

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
when it fails. Add `fix` for what `--fix` should spawn instead, `tier` for the lowest tier it runs in, `requires` for a tool the machine
may not have, and `watches` for the paths `--affected` should run it on.

Then wire the scripts:

```json
{
  "scripts": {
    "verify": "forge verify",
    "verify:static": "forge verify --tier static",
    "verify:unit": "forge verify --tier unit",
    "verify:deploy": "forge verify --tier deploy",
    "verify:release": "forge verify --tier release",
    "lint": "forge verify --only lint",
    "fix": "forge verify --fix"
  }
}
```

`config/steps.ts` is the default path, published as `DEFAULT_STEPS_CONFIG`. **An absent default path is an error, not a silent empty gate** — and so
is a `--config` naming a file that does not exist, so a typo can never read as a green run.

---

## Picking the tier for the moment

Each script is a tier, and each tier runs everything the one above it in this table runs:

| When you are | Run | What it adds |
| --- | --- | --- |
| Writing, between edits | `bun run verify:static` | Every row that judges the source rather than running it |
| On a machine with no runtime installed | `bun run verify:unit` | Every row that runs the code and needs nothing installed beyond your dependencies |
| Closing a task | `bun run verify` | The runtime rows — browser, workerd, database — on their primary engine, over your pending changes |
| Running CI on a tag | `bun run verify:deploy` | Every runtime row whole, plus the rows that judge a finished change: changelog, deployed bundle, features |
| Signing off a release | `bun run verify:release` | The browser set again on every other engine |

Which tier a row belongs to is decided by [`TESTING.md`][testing-6c] §6c's lines, never by how long it takes. `forge verify --list` prints the
rows a tier resolves to.

**At `runtime`, a runtime row runs only as much as your pending changes need**, and the next section is how a row decides. From `deploy` up
every row runs whole.

---

## Deciding which runtime rows a change reaches

**An application declares nothing for this by default.** At `runtime` the browser and workerd rows ask Playwright which specs your pending changes
reach, and the database rows run on every change. The pending changes are the working tree against `HEAD`, read as `--affected` reads them (below).
**The narrowed run is still the gate**, not a scoped run, and it records a receipt.

**Under `cloudflareWorkerSteps`, a change to your app's source runs the browser and workerd rows whole.** A spec reaches your app through the
server it starts, never through an import, so the preset widens both rows by everything the `main` of your wrangler config imports. Only an edit
confined to specs and their helpers narrows. A wrangler config that names no `main` runs the rows whole on every change.

**Set `assetConfig` and a change to anything your asset build reads runs the browser rows whole too.** The browser loads what `build:assets`
writes, not what the Worker imports, so the preset adds `assetInputs` from `@y-core/forge/tooling/assets` to their reach. That covers each JS
bundle's inputs, every stylesheet your CSS entries load and every file their `@source` lines cover, the paths the config names, and the config's
own imports. The workerd row takes the same set only when your wrangler config has an `assets` block, because only then does the Worker serve
those files. Before you rely on it:

- **A stylesheet that leaves Tailwind's automatic detection on covers every file in the tree**, so every change runs the browser rows whole.
  Import Tailwind with `source(none)` and name your directories with `@source` ([`src/ui/README.md`][ui-scan]) to get narrowing back.
- **An asset input that does not resolve runs the rows whole on every change** — a config path missing from disk, or a stylesheet import that
  resolves to nothing. Fix the config and narrowing returns.

Before a Playwright row runs, the gate appends `--list` to its narrowed command, which loads the specs without starting a browser or global setup.
When that lists nothing, the row runs nothing and says what it asked:

```text
○ test:workerd — untouched by 3 changes: `playwright test --project=workerd --only-changed --list` selects nothing
```

When it lists a spec, the row runs its command plus `--only-changed`; when the listing fails, the row runs whole. `forge verify --list` asks the
same question, so it shows each row as narrowed, untouched or whole before anything runs. A Playwright row lists on every change it does not
already run whole for, which is the price of deriving its reach rather than declaring it.

**Declare `wide` for a file a spec reads without importing it.** `--only-changed` follows imports, so a stylesheet a page loads or a fixture a spec
reads from disk reaches no spec when it changes. A change under a `wide` glob runs the row whole, and `playwright.config.ts` is always wide:

```ts
...browserSteps({ engines: ["chromium"], narrow: { wide: ["src/styles/**", "tests/fixtures/**"] } }),
```

**Pass `widen` for code a spec reaches without importing it** — a Worker it serves, or a module a fixture bundles from a string — which no glob can
name ahead of time. `widen` takes the gate's working directory and returns paths relative to it; a pending change to one of them runs the row
whole, and so does a `widen` that rejects. The gate asks it of a row that would otherwise run narrowed or stay untouched. Build it from
`importClosure` or `workerMainClosure`, which resolve imports as esbuild bundles them and reject on anything they cannot resolve:

```ts
import { importClosure } from "@y-core/forge/tooling/assets";
import { browserSteps, workerdStep, workerMainClosure } from "@y-core/forge/tooling/gate";

...browserSteps({ engines: ["chromium"], widen: (cwd) => workerMainClosure(cwd, "workers/admin/wrangler.jsonc") }),
workerdStep({ widen: (cwd) => importClosure(cwd, ["./tests/fixtures/queue-consumer.ts"]) }),
```

`browserStep` and `workerdStep` take the same `widen`. **Leave `watches` off a Playwright row**: the listing already decides it, and a hand-kept
list can only skip a row the listing would have run.

**Every `watches` and `wide` glob must match a file in the work tree**, tracked or untracked. A glob that matches nothing — usually a directory you
renamed — fails the gate before any row runs, naming the row, the field and the glob. A glob with no `/` is exempt, because it may name a
root-level config you have not created yet, and so is one starting `../`, which lies outside the tree. `src/x` and `src/x/**` answer for each
other.

**The database rows run on every change unless you pass `exercises` and `graph`**, because `config/db.ts` can name a schema outside `root`. A
repository that checks a namespace graph with `namespaceGraphStep` passes the same graph and the namespaces the database tooling runs; the rows then
watch each of those, every namespace they reach through the graph's edges, the graph's primitives, and `root`. An absolute `root` still runs them
on every change:

```ts
...dbSteps({ root: "tests/fixtures/db-schema", exercises: ["tooling/db"], graph: GRAPH }),
```

A namespace the graph does not declare, or `exercises` without `graph`, throws when the table loads. When `forge` names a source file rather than
the installed binary — `["bun", "run", "src/cli.ts"]` — a change to anything that file imports runs the database rows whole.

---

## Choosing which checks your gate runs

Every validator forge runs on itself is a pre-built step you can drop into a table, and a published function you can call on its own. Pick the rows
that match rules your repository actually holds. Each builder is named for its check — `exportsStep`, `markdownStep`, `contrastStep` — and its TSDoc
line in `src/tooling/gate/builders.ts` says what it proves; `forge verify --list` prints the label each row answers `--only` to. `bundleStep` takes
its label from you, for a committed bundle that a node process loads.

Tool rows such as `typecheckStep` and `testStep` carry no check and simply spawn; `testStep` takes a `label` of your own for one set of a split
suite. `browserStep`, `workerdStep` and `dbSteps` spawn something a machine may not have. `dbSteps` lints against the local database's history to
pick the pending files, and no row gates on its status: a fresh checkout has none, so every file is pending there, and the replay is what proves the
migrations apply.

**`leavesNoTemp: true` fails a spawned step that exits with anything in the `TMPDIR` the gate gives it**, naming each entry. `testStep` and
`workerdStep` take it. A step's `tempCaches` globs name the entries it keeps by design, and the check skips only those: `workerdStep` declares
`playwright-transform-cache-*`, which the Playwright runner writes before any test starts, so a `miniflare-*` scratch directory is still reported.

**The documentation, changelog, design and knowledge-index rows are warden's, not this namespace's.** They come from `@y-core/forge/warden/steps`,
and an application appends the ones it needs through `wardenAppSteps`. No preset here can emit them: this namespace lives under `src/`, and nothing
there may import warden. A table wanting both concatenates the two lists.

---

## Starting from a preset

Presets compose the tables this fleet shares, so a repository names its policy rather than its rows.

**`cloudflareWorkerSteps(options?)` — a Worker application.** Generation leads judgement in the order it declares, so a stale generated type
surfaces as a type error rather than a mystery; `verify --list` prints the rows a given tier resolved to.

Most rows are opt-in, and each option is a question about your repository rather than a switch:

| You have | State | What it adds |
| --- | --- | --- |
| A `wrangler.jsonc` this gate should read | `workerConfig` | `--config` on the bindings invocation, plus `validate-exposure` — tuned by `exposure` |
| An assets pipeline | `assetConfig` (and `assetOut`) | `types:assets` and `validate-asset-manifest`; with `workerConfig` too, `validate-asset-root` |
| Hand-written binding types | `wranglerTypes: false` | Drops both `wrangler types` rows |
| A suite split by the question each set answers | `testSets` | One labelled `bun test` row per set, replacing the single `test` row that `tests` feeds |
| `ui/*` components and a Tailwind stylesheet | `design` | The platform-CSS and class rows; `design.cssDir` adds `validate-css-tokens` |
| Contrast pairs this repository actually draws | `contrast` | `validate-contrast` — the audit fails a run that measured no pairs |
| A browser-only directory tier of your own | `ssrBoundary` | `validate-ssr-boundary`; `ssrBoundary.serverDirs` adds `validate-client-boundary`, which fails a module under `clientDirs` importing one of those directories at value |
| A directory or source file the rest of `src/` may not import, save named files | `importBoundary` | `validate-import-boundary`; beside `features`, it also reads the feature manifest |
| A third-party tree copied into your source | `vendorDir` | `validate-vendor-boundary` — a module inside it may import the tree itself and packages, never a directory or source file beside it under its parent |
| Markdown oxfmt has been told to ignore | `markdown` | `validate-markdown` |
| A library's `.tsx` compiled under a consumer's tsconfig | `jsx` | `validate-jsx`; an application states `jsxImportSource` once instead |
| Cloned `.claude/` trees | `warden: true` | The `warden sync --check` row |
| D1 schemas, Playwright specs, workerd specs | `db`, `browser`, `workerd` | The prerequisite-bearing rows, last in the table |
| A demonstrator with a `config/features.ts` manifest | `features: {}` | `validate-features` — curates into a temp tree once per distinct resolved profile (default: each feature alone, then all) and runs its `unit` gate there, last in the table |

**`validate-dev-boundary` is the one row an app cannot opt out of.** It reads the forbidden specifiers from forge's installed manifest, so an app
that configures nothing still fails on a deployed module importing `@y-core/forge/testing`, whose fakes lose every write. Dev-only code of the
app's own needs no option: name it `*.dev.ts`, and the row fails a production module importing it, a type import included, while a `*.dev.ts` may
import another. Code the shared path does call goes behind the app's own `imports` alias instead ([`src/tooling/cf/README.md`][cf-own]); the row
fails an `imports` entry whose deploy target is a `*.dev.ts`, reported on `package.json`, and every module that imports through it. The bundle row
below still proves the built Worker.

**`validate-dev-bundle` follows it, on the `deploy` tier.** It bundles the Worker config's `main` with esbuild — from the project, or from
wrangler's own dependency — and fails when a `*.dev.ts` module, the app's or a dependency's, or a module from a directory a `forge.devOnly` subpath
is published from, contributes to the output. A module tree-shaking removed does not count. It also fails when the shell's
`WRANGLER_BUILD_CONDITIONS` names `forge-dev`, since a deploy from that shell would bundle every development module; `forge cf dev` sets it in
wrangler's child process only ([`NAMESPACES.md`][namespaces-5i] §5i). It refuses a Worker config that sets `alias`, `build`, `define` or `rules`, or
whose `compatibility_flags` carries `nodejs_compat` or `nodejs_compat_v2`, at the top level or in an `env.*` block, since it models none of them.

**Only `test` and `validate-dev-bundle` default above the `static` tier** — `test` to `unit`, the bundle to `deploy`: every other row judges
the source rather than running it. `design.sources` does
not fall back to the table's top-level `sources`, and `design.deferred` defaults to `[]` rather than forge's own list — no application should
inherit deferrals keyed to `src/ui/…` paths.

**`forgeChecks({ root, pkg })` — a library published under an `exports` map.** `pkg` is `{ name, version, exports, files }` verbatim from
`package.json`, and `exports`, `jsx` and `classOrder` each merge over the config derived from it. Only checks whose config is derivable from `root`
and the manifest live here; anything carrying project-specific policy is named alongside.

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
  sealedInternal: ["src/crypto/primitives/mod.ts"],
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

**The fixer applies only the mechanical rules**, the ones whose correct form is unambiguous — padding, markers, whitespace. A rule that needs a
judgement, such as a bare fence or an over-long line, is report-only.

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
bun run verify                     # the `runtime` tier, fail-fast — what a task closes on
bun run verify --tier unit         # any other tier; the scripts above spell each one
bun run verify --list              # print the resolved selection, run nothing
bun run verify --only lint,test    # narrow the run (branded as scoped)
bun run verify --fix               # run each selected step's fixer instead
bun run verify --reuse             # answer at once if this exact tree already passed
bun run verify --affected          # run only the steps this change touches (branded as scoped)
```

`forge verify --help` lists every flag. An unknown `--tier` is refused, and an unknown `--only` label is refused with the known ones listed.
`--root` is the directory every step runs in, and the base a relative `--config` resolves against.

Output is one line per step, then one verdict line:

```text
✓ typecheck (0.9s)
✗ lint (0.8s)
    src/app/routes.ts:14:3 lint/style/useConst ...
    full log at /tmp/forge-gate-logs/3f9a1c0b2e4d/lint.log
✗ verify — failed at `lint` (step 2 of 5, 1.7s)
```

**The verdict is the summary line**, not the raw tool output beneath it. A failing step exits 1, so `prepublishOnly: "bun run verify:release"`
blocks a red gate. A failing step's untruncated output is written to one log per repository and step, overwritten by its next failure, and its path
is printed under the excerpt, so a signal outside the `tail` window is still recoverable. A run filtered by `--only` or `--affected` brands its
summary as scoped, so a scoped green never reads as a green gate.

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
✓ verify — reused the passing release run of tree 9d1e5c2a07b4f36e8a51c0d9b2f7e4a6c3185d20; no step ran
```

Otherwise it says why and runs the gate as if the flag were absent:

```text
○ no passing run of tree 5a27f0c8e3d19b64a7c2e8f1d05b3a96e4c7d812 on record at runtime or above; running the gate
```

**Only a green run of the whole gate records a receipt.** The run must be unscoped — no `--only` and no `--affected` — pass at least one step, fail
none and skip none. `--fix` and `--list` never record one, and `--reuse` refuses to be combined with any of them, because it stands in for a whole
gate run. A red or skipped unscoped run deletes the receipt it finds, so the newest verdict on a tree is the one that stands. A scoped run leaves
the receipt alone.

**The receipt names a hash of the working tree.** Tracked and untracked files are both hashed and ignored files are not, so an edit,
a new untracked file or a deletion each means the next `--reuse` runs the gate, and reverting the change makes the old receipt answer again. If
something writes into the tree while the gate runs, the run records nothing and prints `○ the tree changed during the run — no receipt written`.

**A receipt answers its own tier and every tier below it.** A `release` pass answers `verify --reuse` and `verify --tier static --reuse`; a
`static` pass never answers `verify --reuse`. A later lower-tier pass on the same tree keeps the higher-tier receipt rather than replacing it. The
receipt also lists the steps it ran, so a table that now selects a step the receipt does not name runs the gate again.

**A `runtime` receipt also names the `HEAD` it read your changes against, and answers only on that commit.** What its runtime rows ran depended on
those changes, so the same tree on another commit runs the gate again. A `deploy` or `release` receipt ran every row whole and carries no such
limit.

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

The flag composes with the rest. `--tier` picks the tier first, `--only` then narrows to the labels it names, and `--affected` narrows what is left.
`--fix --affected` runs the fixers of the affected steps, and `--list --affected` prints the affected selection without running it. Only `--reuse`
refuses it.

---

## Requiring a tool the machine may not have

A step declares `requires` — the tool's name, the predicate that answers whether it is present, and the remedy to print. **The tier answers its
absence**: below `runtime` the step is skipped, and from `runtime` up the run fails it. The predicate may return a promise, for a dependency only
a request can find.

```text
✗ validate-tooling-lint-plugin-bundle — esbuild not found; run `bun add -d esbuild`
```

`hint` is **printed verbatim**, so it carries its own verb and backticks: `requires: { tool: "esbuild", hint: "run \`bun add -d esbuild\`" }`.
Probe for the **thing**, not the CLI that uses it — `hasWorkerd` answers for the runtime rather than for `bun`. Probing the CLI instead would pass
vacuously and let every spec fail at launch.

**`browserStep` requires the Playwright server `PW_TEST_CONNECT_WS_ENDPOINT` names, and never a local browser.** With the variable unset the step
fails rather than letting Playwright launch one. Otherwise it asks the server whether the installed `@playwright/test` may connect, and a failure
prints a hint naming its cause:

```text
✗ test:browser — Playwright server not found; `PW_TEST_CONNECT_WS_ENDPOINT` is unset; set it to the Playwright container's ws:// URL
✗ test:browser — Playwright server at ws://playwright:3000/ not found; nothing answered at ws://playwright:3000/ (connect ECONNREFUSED 172.18.0.12:3000); check the Playwright sidecar is running and that NO_PROXY includes `playwright`
✗ test:browser — Playwright server at ws://playwright:3000/ not found; the server runs Playwright 1.64 and `@playwright/test` is 1.60.0; pin `@playwright/test` to 1.64
✗ test:browser — Playwright server at ws://playwright:3000/ not found; `@playwright/test` cannot be resolved (Cannot find package '@playwright/test'); add it as a devDependency at the server's Playwright version
```

**`browserStep` spawns `playwright test --project=chromium` and `workerdStep` spawns `playwright test --project=workerd` — the installed binary
off `binDir`, whose shebang is node.** Not `bunx`, which installs from the registry when it resolves nothing locally, and not under bun, where a
`webServer` playwright spawns binds somewhere a sandboxed browser cannot reach and `createTestHarness` answers no request. Your
`playwright.config.ts` declares both projects, and your `test:browser` and `test:workerd` scripts match the same commands so the two cannot diverge.

---

## Running the browser set on more than one engine

`browserSteps` gives each engine its own row. The primary engine's row is `test:browser` and runs from `runtime`, so a task closes on one engine;
every other engine's row is `test:browser:<engine>` and runs only at `release`. The primary engine is Chromium when you list it and the first
engine otherwise; `primary` names another. Your `playwright.config.ts` declares a project per engine.

```ts
// config/steps.ts
...browserSteps({ engines: ["chromium", "firefox", "webkit"] }),
```

`browserSteps` takes the `narrow` described above, and only the primary engine's row uses it: the other rows run at `release`, where every row
runs whole.

`cloudflareWorkerSteps({ browser: { engines } })` calls `browserSteps` for you; `browser: true` is Chromium alone.

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
options)` wraps the function as a table row, and `run` is handed the run's tier, so one row can vary its strictness by tier.

A check runs in-process: the runner prints its findings directly, so nothing is truncated to `tail` lines and warnings survive a passing step. A
check that throws fails its own step rather than unwinding the run. Its fixer runs in-process too, and nothing is probed before it.

A published function's prefix names the layer it belongs to; the vocabulary and its purity rules are [`BUILD_TOOLING.md`][bt-2i] §2i's.

---

## Testing your own step table

`selectSteps` is pure — no disk, no spawning, no clock, and no probe — so the whole selection surface is assertable at zero step cost.

```ts
import { type GateTier, selectSteps } from "@y-core/forge/tooling/gate";
import { STEPS } from "./steps";

const result = selectSteps(STEPS, { tier: "static" });
if (result.ok) expect(result.steps.map((s) => s.label)).toEqual(["types:cf-runtime", "types:cf-bindings", "typecheck", "lint"]);

// Each tier is a superset of the one below it, by construction — selection is a rank comparison.
const labels = (tier: GateTier) => {
  const selection = selectSteps(STEPS, { tier });
  return selection.ok ? selection.steps.map((s) => s.label) : [];
};
expect(labels("static").every((label) => labels("unit").includes(label))).toBe(true);

// Selection calls no probe, so what a table selects never depends on the machine it runs on.
expect(selectSteps(STEPS, { tier: "release" }).ok).toBe(true);

// `changed` is what `--affected` passes: assert which rows a given edit reaches.
const touched = selectSteps(STEPS, { tier: "unit", changed: ["src/ui/x.tsx"] });
if (touched.ok) expect(touched.steps.map((s) => s.label)).not.toContain("validate-exposure");
```

Refusals come back as `{ ok: false, error }` rather than a throw: a duplicate label, `watches: []` or a `!` entry in `watches`, a `watches` or
`wide` glob matching none of the `files` you pass, an unknown `--only` label, and a selection of zero steps. **A zero-step selection is not
refused when `changed` is given** — it comes back `ok` with no steps, and an empty `changed` selects nothing at all, not even a step with no
`watches`.
**The duplicate check is a property of the table**, so it runs before the tier is applied and before `--only` narrows — a malformed table is refused
whichever run was asked for.

**A program compiled under `"types": []` — a Worker app's tests — takes a check's config and result types from
`@y-core/forge/tooling/gate/types`.** The barrel pulls in Node-only modules, so importing a type from it fails that program's typecheck.

```ts
import type { CheckResult, ImportBoundaryCheckConfig } from "@y-core/forge/tooling/gate/types";

type CheckImportBoundary = (config: ImportBoundaryCheckConfig) => CheckResult;
```

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

The heading grammar a parse holds a changelog to — the separator is an **em dash** (U+2014) — what makes `unreleased.empty` true, and the round-trip
guarantee are [`BUILD_TOOLING.md`][bt-2d] §2d's. The compare link is omitted when `compareUrlBase` is absent or there is no earlier released
version.

For versions on their own, `parseSemVer` returns `null` rather than throwing on leading zeros, negatives or malformed input, and the other semver
functions work over what it returns. A bump zeroes every lower component.

```ts
formatSemVer(bumpSemVer(parseSemVer("v1.2.3")!, "minor")); // "1.3.0"
```

---

## Gotchas

**Tools that both claim markdown undo each other.** `oxfmt` pads every table cell to the widest column and has no option to stop, so a project
running `validate-markdown` must put `**/*.md` in `.oxfmtrc.json`'s `ignorePatterns` — otherwise each tool reverses the other on every
`bun run fix`.

**A types-only assets artifact passes a `static` run alone.** `gen types` maps every logical name to itself and those files deliberately do not
exist, which is what lets `tsc` run on a clean checkout — so `validate-asset-manifest` lets it through on `static` and fails it on every tier
above, where passing on an artifact nobody built is exactly the 404 the check exists to prevent.

**A `playwright.config.ts` reaches forge only through a `forge.node` subpath, never a barrel.** Node refuses to strip types from a file under
`node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so a module node loads must be a prebuilt `.mjs` at a `forge.node` subpath. Your
own package's Node-reached subpaths follow the same rule, and `nodeExportsStep` holds them to it ([`BUILD_TOOLING.md`][bt-2n] §2n).

**A value your table imports from outside `config/` is an input no builder can see.** `--affected` reads a builder's `watches` from its config
paths, so an allowlist or rule table imported from `src/…` is invisible to it, and an edit there skips the step. State `watches` on that row
yourself, or add the module's path to `GATE_INPUTS`.

**`--affected` drops a row whose `watches` miss the change before its `widen` is asked.** A database row can therefore skip a change to its
`forge` entry's imports. The run is scoped and never the gate, so the gate a task closes on still runs it.

**An empty `--only` array is the flag's absence, not a request for nothing.** That is what a repeatable flag resolves to when it was never given,
and reading it as "select no steps" would refuse every unscoped run.

---

## See also

- [`@y-core/forge/tooling/release`][release-readme] — the release workflow built on this namespace's changelog and semver primitives.
- [`@y-core/forge/tooling/lint`][lint-readme] — the oxlint plugin and the rule catalogs `validate-design` and `validate-modern-css` read.
- [`@y-core/forge/tooling/cli`][cli-readme] — the command framework and `resolveAppRoot`.
- [`BUILD_TOOLING.md`][bt-2] §2 — the rulings behind the published gate, its presets and its checks.
- [`TEST_RUNNERS.md`][testing-6] §6 — the gate's tiers and its flags as forge itself runs them.
- [`TESTING.md`][testing-6a] §6a — the general law the tiers and the dependency skip implement.

[bt-2]: ../../../docs/BUILD_TOOLING.md#2-toolinggate-and-toolingrelease--project-tooling
[bt-2d]: ../../../docs/BUILD_TOOLING.md#2d-changelog-promotion--the-unreleased-contract
[bt-2f]: ../../../docs/BUILD_TOOLING.md#2f-creategatecommand--the-published-verification-gate
[bt-2i]: ../../../docs/BUILD_TOOLING.md#2i-checks-are-functions-not-scripts
[bt-2n]: ../../../docs/BUILD_TOOLING.md#2n-a-node-reached-export-is-declared-under-forgenode
[cf-own]: ../cf/README.md#keeping-your-own-dev-only-code-out-of-the-deploy
[cli-readme]: ../cli/README.md
[lint-readme]: ../lint/README.md
[namespaces-5i]: ../../../docs/NAMESPACES.md#5i-dev-only-relaxations--a-relax-module-never-a-boolean-on-a-production-option
[release-readme]: ../release/README.md
[testing-6]: ../../../docs/TEST_RUNNERS.md#6-the-verification-gate
[testing-6a]: ../../../warden/canon/libs/TESTING.md#6a-one-command-nested-tiers
[testing-6c]: ../../../warden/canon/libs/TESTING.md#6c-the-lines-between-the-tiers
[ui-scan]: ../../ui/README.md#tell-tailwind-which-directories-to-scan
