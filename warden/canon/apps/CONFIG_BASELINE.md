---
title: Application Configuration Baseline
description: "The tsconfig flags, oxlint base and overrides, gate wiring, script set, tool pins and config-module shape every Worker application in this fleet shares, and the rule for what may vary."
---

# Application Configuration Baseline

> Owns the toolchain configuration an application repository is held to: the compiler flags, the linter's base and where it may be overridden, what
> the gate table is wired from, which `package.json` scripts exist, who owns a version pin, and the shape of a config module. Repositories reached
> different answers, with no principle behind the divergence; this is the one answer.
>
> **Extend the base; local entries are additions only.** Forge exports one base per tool config, and `validate-config-files` holds each
> repository's `tsconfig.json`, `.oxlintrc.json` and `.oxfmtrc.json` to it (§6). The rest of this document is held by review.
>
> Defers to: [`TESTING.md`][testing-6] §6 for what the gate tiers mean and what a step's tier is; [`FORGE_CONSUMPTION.md`][fc] for the
> application-to-library relationship, which is a different subject from the toolchain.

---

## 0. Quick Reference

- §1 The tsconfig Base: extend the base by its `node_modules` path, add `paths` and `include`, and no `exclude` key
- §2 The oxlint Base and Its Overrides: one base every repository extends, variation only as additions
- §2a The Base: extended by path, and the ignore list each repository states itself
- §2b Overrides Are Scoped and Reasoned: the overrides the base carries, and what a legitimate local one looks like
- §2c The Formatter Copy: `bun fmt` cannot extend, so `.oxfmtrc.json` carries the base unchanged plus its own ignores
- §3 Gate Wiring: the preset is the table, merged with only the repository's own rows
- §4 The Script Set: the scripts every repository has, and the sets conditional on what it holds
- §5 Version Pins: one fleet version, forge's pin is the fleet's pin
- §6 Config Modules: one default export through a `define*` helper, no top-level work, and the row that holds it and the tool configs

---

## 1. The tsconfig Base

**`tsconfig.json` extends `@y-core/forge/tooling/tsconfig.app.json` by its path under `node_modules`**, because Bun's runtime transpiler ignores a
package `extends` and `bun test` would lose the JSX source; `TSCONFIG_BASE`, from `@y-core/forge/tooling/gate`, is that path. The base holds the
module settings, the JSX source and every strictness flag beyond `strict`: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `allowUnreachableCode: false` and `erasableSyntaxOnly`. They are one set,
not a menu. Each removes a class of defect the type checker would otherwise hand to review, and a repository that drops one has the review burden of
a repository carrying none for the class it dropped. A local `compilerOptions` entry adds an option the base does not set, such as
`resolveJsonModule`; it never restates one.

**`paths` declares the generated asset module, locally**, so markup names `@assets` rather than a relative path into a build artifact. It cannot
live in the base: `paths` resolves against the file that declares it, which for the base is inside `node_modules`.

```json
{ "paths": { "@assets": ["./.forge/assets.ts"] } }
```

**`include` covers all of `src/` and `tests/`, and there is no `exclude` key at all.** An `exclude` beside an `include` is two statements of the
same thing that drift apart; the `include` is the whole answer. `config/` and `scripts/` stay out of the program deliberately — they run under node
or bun with globals that `"types": []` does not declare, and putting them in would force either a second program or a weakened one.

**`allowImportingTsExtensions` is forge-specific and not baseline.** It exists because oxlint loads forge's lint plugin through Node's ESM resolver;
an application has no equivalent need.

---

## 2. The oxlint Base and Its Overrides

### 2a. The Base

**`.oxlintrc.json` extends `@y-core/forge/tooling/oxlint.base.json` by its path under `node_modules`**, because oxlint reads `extends` as a file
and never consults `exports`. `OXLINT_BASE`, from `@y-core/forge/tooling/gate`, is that path spelled as the check demands it.

The base holds the plugins, the `forge/*` plugin as the committed bundle beside it, the categories, every rule and the shared overrides. A
repository does not restate any of them: a local `plugins`, `jsPlugins` or `categories` replaces the base's value rather than adding to it, and a
local rule that names a base rule is a disagreement with the base, which is a fleet change made in forge. A rule the base does not carry is an
addition, and that is the only kind of local rule there is.

**`ignorePatterns` is the one list each repository states**, because oxlint does not inherit it through `extends`. It names at least the generated
trees, `.forge/**` and `.types/**`, which no tool but their emitter owns, and adds any vendored tree of the repository's own.

**The type-aware rules in the base only run under `oxlint --type-aware`**, which §3 makes a gate row. Their `off` entries are as load-bearing as
the `error` ones: without them the type-aware run is noise, and a noisy row is a row someone turns off.

### 2b. Overrides Are Scoped and Reasoned

**Every difference between two repositories' linter configuration is a local addition, and every local override states why it exists in a comment
above it.** An unexplained override is indistinguishable from a rule someone could not make pass. Local overrides are appended after the base's.

**The base carries the overrides every repository shares.** The spec override, over every `*.test.ts`, `*.test.tsx`, `*.browser.ts` and
`*.workerd.ts`, turns the design and accessibility rules off — a test's job is to feed the adversarial markup a rule exists to catch, so holding a
fixture to the rule inverts it — and turns `forge/exact-markup-assertion` on, which is the only file class it applies to. The build-time override,
over `config/**`, `scripts/**` and `playwright.config.ts`, restates the valibot ban and drops the tooling one, since those trees sit outside
`tsconfig.json`'s `include` precisely so they may import a build-time subpath.

**A repository-specific override is legitimate when it is narrow and the narrowing is the argument.** A block scoped to the one view directory that
owns a page's live region, or to the one generated module a vendor ships, is the shape to aim for. A block scoped to `src/**` is not an override; it
is a disagreement with the base, and it belongs in the base or nowhere.

### 2c. The Formatter Copy

**`bun fmt` reads `.oxfmtrc.json` and ignores `extends`**, so the formatter is the one tool config a repository copies. It carries every key of
`@y-core/forge/tooling/oxfmt.base.json` with the base's value, and its `ignorePatterns` holds every base entry plus any of its own — `**/*.md` when
it takes the `markdown` opt-in (§3). A changed option is a fleet change made in the base and propagated by the next bump.

---

## 3. Gate Wiring

**`cloudflareWorkerSteps()` is the table.** A repository's `config/steps.config.ts` default-exports `defineSteps({ tiers })` whose tiers are the
preset's. Rows that are genuinely its own, such as a check over its own data or a build its own pipeline needs, are merged in with `mergeTiers`,
each into the tier [`TESTING.md`][testing-6a] §6a puts it in.

**The setup a table needs comes from the library too.** `appContrast()` builds the `contrast` option from forge's token layer, pairs and floors
plus the repository's own token files, pairs and accepted rows, and `wardenAppSteps()` addresses the installed canon itself unless `citableDirs`
names otherwise. A repository resolving forge's stylesheet directory or the canon's path by hand restates what the library already knows.

**`wardenAppSteps()` is the second half of the table, and merging it is not an exception.** The rows it declares are `validate-docs` in `static`
and `warden:index`, `warden:queries` and `warden:duplicates` in `unit`. They cannot come from the first preset, which lives under the library's
`src/`, where nothing may import warden. It declares rows only and no `tier()` reference, so it is merged onto a complete preset rather than
standing alone. It is merged, not hand-assembled: a repository writing those builder calls out again has one place per row for the `dependency`
flag and the tier to drift.

**The preset emits `lint:types` in its `static` tier**, immediately after `format`. An application never adds `typeAwareLintStep` itself: the
gate refuses a label one tier holds twice, so a local row is not an addition but a failure. A repository that was adding one deletes it when it
takes the preset that emits it.

**`oxlint-tsgolint` is therefore a required devDependency**, pinned exactly like `oxlint` itself. Without it the type-aware rules in §2a are a
config nothing executes.

**Ordering is never a reason to decline an opt-in.** A tier runs in the order it declares, and each preset tier above `static` leads with `tier()`
naming the tier below, which expands in place. So a merged `unit` row runs after the preset's `unit` rows and ahead of every `runtime` one
([`TESTING.md`][testing-6a] §6a). A repository that declines `browser: true` so it can place `browserStep` itself is working around a problem the
table does not have.

**The opt-ins an application takes are a statement about the application, not about its gate's shape:** `db` when it has a D1 binding, `browser`
when it has a browser set, `workerd` when it has one, `design` when it uses `ui/*`, `warden` when it clones the governing corpus, and `markdown`
when it wants its prose normalized — which also requires ignoring markdown in `.oxfmtrc.json`, since otherwise the formatter and the check own the
same bytes. Firefox and WebKit are not a preset option. An application that runs them merges `crossEngineStep()` into its `scheduled` tier
([`TESTING.md`][testing-6e] §6e).

---

## 4. The Script Set

**These scripts exist in every application repository**, so a command learned in one works in the next:

| Script | Runs |
| --- | --- |
| `verify` | `forge verify` — the `runtime` tier, the gate an epic closes on |
| `verify:static` | `forge verify --tier static` — every row that judges the source rather than running it; the interim check |
| `verify:unit` | `forge verify --tier unit` — every row that needs no runtime installed; the task check |
| `verify:scheduled` | `forge verify --tier scheduled`, what a tag and the daily cron run: every runtime suite whole, every heavy row (the browser set on each engine the table declares among them), and the rows that judge a finished change ([`TESTING.md`][testing-6a] §6a) |
| `fix` | `forge verify --fix` |
| `lint` | `forge verify --only lint` — checks, never writes |
| `test` | `bun test` |
| `test:browser` | `playwright test --project=chromium` |
| `dev` | The asset build, then `forge cf dev` |
| `dev:forge` | The local library sync, `bun run <library checkout>/src/tooling/dev/sync.ts`; `bun i` undoes it, restoring the pinned release |
| `build:assets` | `forge assets build all` |
| `types:assets` | `forge verify --only types:assets` |

**`lint` and `fix` are two verbs, not two spellings of one.** `lint` reports and writes nothing; `fix` writes and reports nothing. Scripting them
apart is what keeps a `lint` from being the command that quietly rewrote your tree.

**These sets are conditional on a fact about the repository:**

- **`db:*`** — present when the application has a D1 binding: `db:backup`, `db:compose`, `db:lint`, `db:migrate`, `db:reset`, `db:restore`,
  `db:schema:check`, `db:status`.
- **`cf:*`** — present when the application is deployed to a remote account, **and absent where it is not**. **`cf:status` is the dry run and
  `cf:sync` is the `--commit`.** A repository whose dry-run script is named `sync` has named the safe command after the dangerous one. Where every
  resource id in the worker config is a local placeholder, a provisioning verb creates real resources against a config that names none and then
  writes the new ids back over the placeholders — so the absence is a control, not an omission, and a repository that records it in its own `docs/`
  is stating a rule this section defers to.
- **`release`** — present only where the repository publishes.

---

## 5. Version Pins

**One fleet version per tool, and forge's pin is the fleet's pin.** A bump lands in forge first — where the gate, the lint plugin and the design
corpus that the tools read all live — and then propagates to every application in one sweep. An application never leads a bump.

**The toolchain is pinned exactly, with no range.** Bun is the type checker (`bun check`) and the formatter (`bun fmt`) as well as the runtime,
so `packageManager` names one exact Bun and `engines.bun` names that same version as its floor. `oxlint` re-classifies between patch releases, so
a caret would make a green gate a property of when `bun install` last ran. `oxlint-tsgolint` is pinned exactly alongside `oxlint`, at whatever
version that `oxlint` peer-requires.

**Everything else takes a caret**, because the range is the point: `wrangler`, `@playwright/test`, `tailwindcss`, `esbuild`.

**A pin nothing uses is deleted rather than carried.** A devDependency present in a repository and reached by nothing in it is one more thing to
update and nothing to gain.

---

## 6. Config Modules

**Every module a tool loads by convention is `config/<concern>.config.ts`, and its one export is `export default define<Concern>({...})`.** The
`define*` helper is the library's, imported from the subpath that owns the concern. It types the value and returns it unchanged, so a mistyped key
fails the type check rather than the tool. A named export beside the default is a second thing the module offers that no loader reads. Which
concerns a tool loads, and the default path of each, is that tool's own README.

**A config module declares, and does nothing else at the top level**: imports, `const` declarations and the default export. A statement that runs,
such as a call, an `if` or an `import.meta.main` block, runs whenever any tool loads the module, the gate on every run included. Work done there
happens where nobody looks for it.

**A module that only holds data the config modules import keeps a plain `.ts` name**: a shared path, an allowlist too long to read inline. No tool
loads it by convention, and the `.config.ts` suffix is what tells a reader which files are entry points.

**A third-party tool's config keeps the name and place its tool reads**: `playwright.config.ts`, `wrangler.jsonc`, `.oxlintrc.json`. The
convention covers what the library's tools load.

**`validate-config-files` holds the convention**, and `cloudflareWorkerSteps()` emits it in `static`. It reads every `*.config.ts` directly under
`config/` and fails a named export, a top-level statement other than an import or a `const`, `import.meta.main`, and a default that is not a call
to an imported `define*` helper. A `config/` holding no `*.config.ts` fails too, because a check that read nothing has nothing to report green
about.

**The same row holds the tool configs to §1 and §2.** It fails a `tsconfig.json` or `.oxlintrc.json` that does not extend its base, a local
compiler option or rule that names a base key, a local `plugins`, `jsPlugins` or `categories`, an oxlint ignore list missing a generated tree, an
`.oxfmtrc.json` key that differs from the base or an ignore list missing a base entry, an `exclude` key, and any of the three spelled `.jsonc`.

[fc]: ./FORGE_CONSUMPTION.md
[testing-6]: ./TESTING.md#6-the-verification-gate
[testing-6a]: ./TESTING.md#6a-one-command-nested-tiers
[testing-6e]: ./TESTING.md#6e-one-tier-per-moment
