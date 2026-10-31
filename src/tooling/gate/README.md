---
title: The Verification Gate
description: "The verify command over a declared step table, a pre-built step per check forge ships, and the changelog and semver parsers it reads version state with."
audience: internal
---

# `@y-core/forge/tooling/gate`

A project's verification gate is **one command over one table**. You declare the table in `config/steps.config.ts`; `forge verify` finds it,
resolves which rows the requested tier wants, and runs them fail-fast. Nothing else is yours to write: no binding script, and no spawnable file per
check.

Reach for this namespace when you are wiring a repository's gate, adding a check to one, or reading a repository's version state.

```ts
import { cloudflareWorkerSteps, defineSteps, mergeTiers, tier, type StepTiers } from "@y-core/forge/tooling/gate";
```

> **Node.js / Bun only.** This namespace shells out to your build tools via `node:child_process` and reads and writes files via `node:fs`. **Do not
> import it into a Cloudflare Worker or a client bundle.**

> The rulings behind this surface are [`BUILD_TOOLING.md`][bt-2] §2's, and the general law behind the tiers is [`TESTING.md`][testing-6a] §6a.

---

## Getting started

**One file.** `config/steps.config.ts` default-exports `defineSteps({ tiers })`, and nothing else. It is a config module, so the preset's
`validate-config-files` row fails a named export or a top-level statement that runs ([`CONFIG_BASELINE.md`][cb-6] §6). Each tier is a key
listing its rows in the order they run. A preset is a whole table, so the usual file is the preset plus your own rows. Anything forge ships no
step for is an ordinary `cmd` row, as `check:bindings` is below.

```ts
// config/steps.config.ts
import { cloudflareWorkerSteps, defineSteps, mergeTiers } from "@y-core/forge/tooling/gate";

export default defineSteps({
  tiers: mergeTiers(cloudflareWorkerSteps({ assetConfig: "config/assets.config.ts", browser: true }), {
    static: [{ label: "check:bindings", tail: 30, cmd: ["bun", "run", "tools/check-bindings.ts"] }],
  }),
});
```

A hand-written row states its `label` (the `--only` token and the name reported on failure), its `cmd`, and the `tail` of captured output to show
when it fails. Add `fix` for what `--fix` should spawn instead, `requires` for a tool the machine may not have, and `watches` for the paths
`--affected` should run it on. Its tier is the key you list it under.

Then wire the scripts:

```json
{
  "scripts": {
    "verify": "forge verify",
    "verify:static": "forge verify --tier static",
    "verify:unit": "forge verify --tier unit",
    "verify:scheduled": "forge verify --tier scheduled",
    "lint": "forge verify --only lint",
    "fix": "forge verify --fix"
  }
}
```

`config/steps.config.ts` is the default path, published as `DEFAULT_STEPS_CONFIG`. **An absent default path is an error, not a silent empty
gate.** So is a `--config` naming a file that does not exist, and so is a module whose default is not a `defineSteps` table, so a typo can never
read as a green run.

---

## Picking the tier for the moment

Each script is a tier, and in a table built from a preset each tier runs everything the one above it in this table runs:

| When you are | Run | What it adds |
| --- | --- | --- |
| Writing, and closing a task | `bun run verify:static`, then `bun test` on each test file you touched | Every row that judges the source rather than running it |
| On a machine with no runtime installed | `bun run verify:unit` | Every row that runs the code and needs nothing installed beyond your dependencies |
| Committing | `bun run verify` | The runtime rows — the database rows — over your pending changes. No Playwright spec |
| Tagging a release, and the daily cron run | `bun run verify:scheduled` | Every runtime row whole, the browser set on Chromium (and on Firefox and WebKit where you added `crossEngineStep()`), the workerd set, and the rows that judge a finished change: the deployed bundle |

Which tier a row belongs to is decided by [`TESTING.md`][testing-apps-6a] §6a's lines. **A heavy row runs at `scheduled`** — every Playwright row is
one: the browser set on each engine, and the workerd set — by the rule in the library canon's [`TESTING.md`][testing-6c] §6c. A broken page or a
request workerd mishandles is therefore caught by the cron run's `verify:scheduled`, or by the one before a tag, rather than at commit. `forge
verify --list` prints the rows a tier resolves to.

**At `runtime`, a runtime row runs only as much as your pending changes need**, and the next section is how a row decides. At `scheduled` every
row runs whole.

---

## Deciding which runtime rows a change reaches

**An application declares nothing for this by default.** At `runtime` the database rows run on every change, and no Playwright row is at
`runtime`, so nothing narrows one. The pending changes are the working tree against `HEAD`, read as `--affected` reads them (below). **The
narrowed run is still the gate**, not a scoped run, and it records a receipt.

**Leave `watches` off a Playwright row**: a spec reaches your app through the server it starts, never through an import, so a hand-kept list can
only drop a row that `--affected` should have run.

**Every `watches` and `wide` glob must match a file in the work tree**, tracked or untracked. A glob that matches nothing — usually a directory you
renamed — fails the gate before any row runs, naming the row, the field and the glob. A glob with no `/` is exempt, because it may name a
root-level config you have not created yet, and so is one starting `../`, which lies outside the tree. `src/x` and `src/x/**` answer for each
other.

**The database rows run on every change unless you pass `exercises` and `graph`**, because `config/db.config.ts` can name a schema outside `root`. A
repository that checks a namespace graph with `namespaceGraphStep` passes the same graph and the namespaces the database tooling runs; the rows then
watch each of those, every namespace they reach through the graph's edges, the graph's primitives, and `root`. An absolute `root` still runs them
on every change. `dbSteps` returns its rows by tier, so merge it onto your table rather than taking `db: true`:

```ts
mergeTiers(cloudflareWorkerSteps(), dbSteps({ root: "tests/fixtures/db-schema", exercises: ["tooling/db"], graph: GRAPH }))
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
suite. `typecheckStep` spawns `bun check` and `formatStep` spawns `bun fmt`, so a table holding either, as `cloudflareWorkerSteps` and
`forgeChecks` both do, needs the Bun that forge's `engines.bun` names, and no `typescript` or `oxfmt` install.

`browserStep`, `workerdStep` and `dbSteps` spawn something a machine may not have. `dbSteps` lints against the local database's history to
pick the pending files, and no row gates on its status: a fresh checkout has none, so every file is pending there, and the replay is what proves the
migrations apply.

**`leavesNoTemp: true` fails a spawned step that exits with anything in the `TMPDIR` the gate gives it**, naming each entry. `testStep` and
`workerdStep` take it. A step's `tempCaches` globs name the entries it keeps by design, and the check skips only those: `workerdStep` declares
`playwright-transform-cache-*`, which the Playwright runner writes before any test starts, so a `miniflare-*` scratch directory is still reported.

**The documentation, changelog, design and knowledge-index rows are warden's, not this namespace's.** They come from `@y-core/forge/warden/steps`,
and an application merges the ones it needs onto its table with `mergeTiers(…, wardenAppSteps(…))`. No preset here can emit them: this namespace
lives under `src/`, and nothing there may import warden.

---

## Starting from a preset

Presets compose the tables this fleet shares, so a repository names its policy rather than its rows. **Each returns a complete table by tier**:
all four tiers, each above `static` leading with `tier()` naming the one below. A preset alone is a whole gate, `tiers: cloudflareWorkerSteps()`.
`mergeTiers(preset, yours)` adds your rows after the preset's in each tier you name, and keeps every tier either table declares.

**A merged row runs after the preset's rows of its tier, and before every row of the tiers above.** To put a row earlier in a tier, write that
tier's list yourself. A tier's key is optional, so a preset's list is spread through `?? []`:

```ts
const preset = cloudflareWorkerSteps();

export default defineSteps({ tiers: { ...preset, static: [myStep, ...(preset.static ?? [])] } });
```

**Merge one complete preset, never two.** Each includes its own lower tiers, so two of them hold those rows twice, and the gate refuses the table
as a duplicate label. `wardenAppSteps` is built to merge: it declares rows and no reference.

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
| A directory or source file the rest of `src/` may not import, save named files | `importBoundary` | `validate-import-boundary`; `importBoundary.features: true` also reads the feature manifest |
| A third-party tree copied into your source | `vendorDir` | `validate-vendor-boundary` — a module inside it may import the tree itself and packages, never a directory or source file beside it under its parent |
| Markdown `bun fmt` has been told to ignore | `markdown` | `validate-markdown` |
| A library's `.tsx` compiled under a consumer's tsconfig | `jsx` | `validate-jsx`; an application states `jsxImportSource` once instead |
| Cloned `.claude/` trees | `warden: true` | The `warden sync --check` row |
| D1 schemas, Playwright specs, workerd specs | `db`, `browser`, `workerd` | The prerequisite-bearing rows: the database rows close `static` and follow `tier("unit")` in `runtime`, and `test:browser` and `test:workerd` close `scheduled` |

**`validate-dev-boundary` is the one row an app cannot opt out of.** It reads the forbidden specifiers from forge's installed manifest, so an app
that configures nothing still fails on a deployed module importing `@y-core/forge/testing`, whose fakes lose every write. Dev-only code of the
app's own needs no option: name it `*.dev.ts`, and the row fails a production module importing it, a type import included, while a `*.dev.ts` may
import another. Code the shared path does call goes behind the app's `#app/relax` alias instead ([`src/relax/README.md`][relax-readme]); the row
fails an `imports` entry whose deploy target is a `*.dev.ts`, reported on `package.json`, and every module that imports through it. It also fails
any `imports` entry other than `#app/relax` that carries `forge-dev`, reported on `package.json`. The bundle row below still proves the built
Worker.

**`validate-dev-bundle` follows it, on the `scheduled` tier.** It bundles the Worker config's `main` with esbuild — from the project, or from
wrangler's own dependency — and fails when a `*.dev.ts` module, the app's or a dependency's, or a module from a directory a `forge.devOnly` subpath
is published from, contributes to the output. A module tree-shaking removed does not count. It also fails when the shell's
`WRANGLER_BUILD_CONDITIONS` names `forge-dev`, since a deploy from that shell would bundle every development module; `forge cf dev` sets it in
wrangler's child process only ([`NAMESPACES.md`][namespaces-5i] §5i). It refuses a Worker config that sets `alias`, `build`, `define` or `rules`, or
whose `compatibility_flags` carries `nodejs_compat` or `nodejs_compat_v2`, at the top level or in an `env.*` block, since it models none of them.

**Each row sits in the tier [`TESTING.md`][testing-apps-6a] §6a's lines put it in.** The `test` rows are in `unit`, the database rows that need
workerd in `runtime`, and the browser set, the workerd set and `validate-dev-bundle` in `scheduled`. Everything else is in `static`, including
`validate-config-files`, which holds your `config/*.config.ts` modules ([`CONFIG_BASELINE.md`][cb-6] §6). It fails a `config/` holding none, so
a repository that keeps its step table elsewhere passes `configFiles: false` to either preset.

`design.sources` does not fall back to the table's top-level `sources`, and `design.deferred` defaults to `[]` rather than forge's own list — no
application should inherit deferrals keyed to `src/ui/…` paths.

**`forgeChecks({ root, pkg })` — a library published under an `exports` map.** `pkg` is `{ name, version, exports, files }` verbatim from
`package.json`, and `exports`, `jsx` and `classOrder` each merge over the config derived from it. Only checks whose config is derivable from `root`
and the manifest live here; anything carrying project-specific policy is named alongside. It returns all four tiers too, so it is a whole table
on its own.

---

## Configuring a check

Configuration goes to the builder, in the step table itself — a check's allowlists live there rather than in a config file of their own.

```ts
// config/steps.config.ts
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

Every builder takes `{ requires, watches }` as its last argument: its dependency replaced, or dropped with `requires: null`, and the paths
`--affected` reads it by replaced, or dropped with `watches: null`. A check's tier is the key you list it under, so moving it is moving its entry.

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
bun run verify                     # the `runtime` tier, fail-fast — what a commit closes on
bun run verify --tier unit         # any other tier; the scripts above spell each one
bun run verify --list              # print the resolved selection, run nothing
bun run verify --only lint,test    # narrow the run (branded as scoped)
bun run verify --fix               # run each selected step's fixer instead
bun run verify --reuse             # answer at once if this exact tree already passed
bun run verify --affected          # run only the steps this change touches (branded as scoped)
bun run verify:scheduled --report tmp/gate/ # write tmp/gate/report.json and every step's whole log, whatever the verdict
```

**`--report <dir>` is for a run nobody is watching**, such as a cron one. `report.json` names the tier, the `HEAD` commit, the tree, the start
time, the duration and the verdict, then each step's status — `passed`, `failed`, `setup`, `skipped`, `untouched` or `unreached` — with its
duration and the log file beside it. A browser row also lists its failing tests by engine, spec, title and first error line, read from Playwright's
JSON reporter, which the gate adds to the row only under `--report`. A browser row that never reached a test — `webServer` or `globalSetup`
failed, or the Playwright server was absent — is `setup`, not `failed`, because it says nothing about the code. `--report` takes no `--list`,
`--fix`, `--reuse` or `--affected`.

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

**The verdict is the summary line**, not the raw tool output beneath it. A failing step exits 1, so `prepublishOnly: "bun run verify:scheduled"`
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

import steps from "./config/steps.config";

await execute(createGateCommand({ cwd: resolveAppRoot(), tiers: steps.tiers }));
```

---

## Skipping a run this tree already passed

`--reuse` is for the second run of a tree nobody has touched since the first — a reviewer's baseline after the developer's closing run. **If the
gate has a passing run of these exact bytes on record, it prints one line and exits 0**:

```text
✓ verify — reused the passing scheduled run of tree 9d1e5c2a07b4f36e8a51c0d9b2f7e4a6c3185d20; no step ran
```

Otherwise it says why and runs the gate as if the flag were absent:

```text
○ no passing run of tree 5a27f0c8e3d19b64a7c2e8f1d05b3a96e4c7d812 on record at runtime or above; running the gate
```

**Only a green run of the whole gate records a receipt.** The run must be unscoped — no `--only` and no `--affected` — pass at least one step, fail
none and skip none. `--fix` and `--list` never record one, and `--reuse` refuses to be combined with any of them, because it stands in for a whole
gate run. A red or skipped unscoped run deletes the receipt it finds, so the newest verdict on a tree is the one that stands. A scoped run leaves
the receipt alone. A run of a table other than `config/steps.config.ts`, named with `--config`, neither records nor deletes one.

**The receipt names a hash of the working tree.** Tracked and untracked files are both hashed and ignored files are not, so an edit,
a new untracked file or a deletion each means the next `--reuse` runs the gate, and reverting the change makes the old receipt answer again. If
something writes into the tree while the gate runs, the run records nothing and prints `○ the tree changed during the run — no receipt written`.

**A receipt answers its own tier and every tier below it.** A `scheduled` pass answers `verify --reuse` and `verify --tier static --reuse`; a
`static` pass never answers `verify --reuse`. A later lower-tier pass on the same tree keeps the higher-tier receipt rather than replacing it. The
receipt also lists the steps it ran, so a table that now selects a step the receipt does not name runs the gate again.

**A `runtime` receipt also names the `HEAD` it read your changes against, and answers only on that commit.** What its runtime rows ran depended on
those changes, so the same tree on another commit runs the gate again. A `scheduled` receipt ran every row whole and carries no such limit.

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

**A change to a gate-wide input runs every step.** `DEFAULT_GATE_INPUTS` names the paths every step reads, the manifest and lockfile among them,
and anything above the gate's root. `forge verify` adds the step-table module itself. To add paths of your own, list them as the table's `inputs`.
They are appended to the default and can never remove from it:

```ts
// config/steps.config.ts
export default defineSteps({ inputs: ["tools/gate/**"], tiers: cloudflareWorkerSteps() });
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

## Running Firefox and WebKit

Firefox and WebKit are one row, `test:browser:cross-engine`, which you merge into your `scheduled` tier. The tag's run and the daily cron run take
it, and no tier below does:

```ts
mergeTiers(cloudflareWorkerSteps({ browser: true }), { scheduled: [crossEngineStep()] })
```

`crossEngineStep()` spawns `playwright test --project=firefox --project=webkit`. Under `--report` it lists each failing spec with its engine, as
`test:browser` does.

**The row requires the compat Playwright server, and at `scheduled` an absent requirement fails the run.** Once you add it, every
`verify:scheduled`, the one before a tag included, needs `playwright-compat` up: `devctl infra up playwright-compat`, with
`PLAYWRIGHT_COMPAT_WS_ENDPOINT` set to its URL (`ws://playwright-compat:3000/` in the devctl environment).

The compat server is started only on request. Playwright reads only `PW_TEST_CONNECT_WS_ENDPOINT`, and a project's `connectOptions` replaces that
connection whole, so your config carries `exposeNetwork` and `headers` itself and declares the two projects only when the variable is set:

```ts
// playwright.config.ts
const endpoint = process.env.PLAYWRIGHT_COMPAT_WS_ENDPOINT;
const exposeNetwork = process.env.PW_TEST_CONNECT_EXPOSE_NETWORK;
const headers = process.env.PW_TEST_CONNECT_HEADERS;
const compat = endpoint
  ? {
      wsEndpoint: endpoint,
      ...(exposeNetwork ? { exposeNetwork } : {}),
      ...(headers ? { headers: JSON.parse(headers) } : {}),
    }
  : undefined;

export default defineConfig({
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    ...(compat
      ? [
          { name: "firefox", use: { ...devices["Desktop Firefox"], connectOptions: compat } },
          { name: "webkit", use: { ...devices["Desktop Safari"], connectOptions: compat } },
        ]
      : []),
  ],
});
```

Every spec runs on them: an application's cross-engine run is the whole browser set on each engine, never a subset ([`TESTING.md`][testing-apps-6e]
§6e).

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

`resolveTiers` and `selectSteps` are pure: no disk, no spawning, no clock, and no probe. So the whole selection surface is assertable at zero step
cost.

```ts
import { type GateTier, resolveTiers, selectSteps } from "@y-core/forge/tooling/gate";
import steps from "./steps.config";

const resolved = resolveTiers(steps.tiers);
if (!resolved.ok) throw new Error(resolved.error);

const labels = (tier: GateTier) => {
  const selection = selectSteps(resolved.data, { tier });
  return selection.ok ? selection.steps.map((s) => s.label) : [];
};
expect(labels("static").slice(0, 3)).toEqual(["types:cf-runtime", "types:cf-bindings", "typecheck"]);

// A tier that leads with tier("static") runs every static row first, in the static tier's order.
expect(labels("unit").slice(0, labels("static").length)).toEqual(labels("static"));

// `changed` is what `--affected` passes: assert which rows a given edit reaches.
const touched = selectSteps(resolved.data, { tier: "unit", changed: ["src/ui/x.tsx"] });
if (touched.ok) expect(touched.steps.map((s) => s.label)).not.toContain("validate-exposure");
```

Both answer `{ ok: false, error }` rather than throwing. `resolveTiers` refuses the whole table, whichever tier you go on to ask for: a `tier()`
naming a tier the table does not declare or one not below the tier holding it, and a label one resolved tier holds twice. `selectSteps` refuses a
tier the table does not declare, `watches: []` or a `!` entry in `watches`, a `watches` or `wide` glob matching none of the `files` you pass, an
unknown `--only` label, and a selection of zero steps. **A zero-step selection is not refused when `changed` is given**: it comes back `ok` with
no steps, and an empty `changed` selects nothing at all, not even a step with no `watches`. **The `watches` rules are a property of the table**, so
they are checked over every tier before the run's tier is applied and before `--only` narrows.

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

**Tools that both claim markdown undo each other.** `bun fmt` pads every table cell to the widest column and has no option to stop, so a project
running `validate-markdown` must put `**/*.md` in `.oxfmtrc.json`'s `ignorePatterns` — otherwise each tool reverses the other on every
`bun run fix`.

**A types-only assets artifact passes a `static` run alone.** `gen types` maps every logical name to itself and those files deliberately do not
exist, which is what lets `bun check` run on a clean checkout — so `validate-asset-manifest` lets it through on `static` and fails it on every tier
above, where passing on an artifact nobody built is exactly the 404 the check exists to prevent.

**A `playwright.config.ts` reaches forge only through a `forge.node` subpath, never a barrel.** Node refuses to strip types from a file under
`node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so a module node loads must be a prebuilt `.mjs` at a `forge.node` subpath. Your
own package's Node-reached subpaths follow the same rule, and `nodeExportsStep` holds them to it ([`BUILD_TOOLING.md`][bt-2n] §2n).

**A value your table imports from outside `config/` is an input no builder can see.** `--affected` reads a builder's `watches` from its config
paths, so an allowlist or rule table imported from `src/…` is invisible to it, and an edit there skips the step. State `watches` on that row
yourself, or add the module's path to the table's `inputs`.

**`--affected` drops a row whose `watches` miss the change before its `widen` is asked.** A database row can therefore skip a change to its
`forge` entry's imports. The run is scoped and never the gate, so the gate a commit closes on still runs it.

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
[cb-6]: ../../../warden/canon/apps/CONFIG_BASELINE.md#6-config-modules
[cli-readme]: ../cli/README.md
[lint-readme]: ../lint/README.md
[namespaces-5i]: ../../../docs/NAMESPACES.md#5i-dev-only-relaxations--a-relax-module-never-a-boolean-on-a-production-option
[relax-readme]: ../../relax/README.md
[release-readme]: ../release/README.md
[testing-6]: ../../../docs/TEST_RUNNERS.md#6-the-verification-gate
[testing-6a]: ../../../warden/canon/libs/TESTING.md#6a-one-command-nested-tiers
[testing-6c]: ../../../warden/canon/libs/TESTING.md#6c-the-lines-between-the-tiers
[testing-apps-6a]: ../../../warden/canon/apps/TESTING.md#6a-one-command-nested-tiers
[testing-apps-6e]: ../../../warden/canon/apps/TESTING.md#6e-one-tier-per-moment
