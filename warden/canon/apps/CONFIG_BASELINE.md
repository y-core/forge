---
title: Application Configuration Baseline
description: "The tsconfig flags, oxlint base and overrides, gate wiring, script set, tool pins and config-module shape every Worker application in this fleet shares, and the rule for what may vary."
---

# Application Configuration Baseline

> Owns the toolchain configuration an application repository is held to: the compiler flags, the linter's base and its overrides, the gate wiring,
> the `package.json` scripts, version pins, and the shape of a config module. Repositories reached different answers with no principle behind the
> divergence; this is the one answer.
>
> **Extend the base; local entries are additions only.** Forge exports one base per tool config, and `validate-config-files` holds each repository's
> `tsconfig.json`, `.oxlintrc.json` and `.oxfmtrc.json` to it (§6); review holds the rest.
>
> Defers to: [`TESTING.md`][testing-6] §6 for what the gate tiers mean and what a step's tier is; [`FORGE_CONSUMPTION.md`][fc] for the
> application-to-library relationship, which is a different subject from the toolchain.

---

## 0. Quick Reference

- §1 The tsconfig Base: extend the base by its `node_modules` path, add `paths` and `include`, no `exclude` key
- §2 The oxlint Base and Its Overrides: one base every repository extends, variation only as additions
- §2a The Base: extended by path, and the ignore list each repository states itself
- §2b Overrides Are Scoped and Reasoned: the shared overrides, and what a legitimate local one looks like
- §2c The Formatter Copy: `.oxfmtrc.json` copies the base and adds its own ignores
- §3 Gate Wiring: the preset is the table, merged with only the repository's own rows
- §4 The Script Set: the scripts every repository has, and the sets conditional on what it holds
- §5 Version Pins: one fleet version, forge's pin is the fleet's pin
- §6 Config Modules: one `define*` default export, no top-level work, and the row that holds them and the tool configs

---

## 1. The tsconfig Base

**`tsconfig.json` extends `@y-core/forge/tooling/tsconfig.app.json` by its path under `node_modules`**; `TSCONFIG_BASE`, from
`@y-core/forge/tooling/gate`, is that path, and its TSDoc owns why it is one. The base holds the module settings, the JSX source and every
strictness flag beyond `strict` as one set, not a menu: each removes a class of defect the type checker would otherwise hand to review. A local
`compilerOptions` entry only adds an option the base does not set, such as `resolveJsonModule`.

**`paths` declares the generated asset module, locally**, so markup names `@assets` rather than a path into a build artifact; it cannot live in the
base, because `paths` resolves against the file that declares it.

```json
{ "paths": { "@assets": ["./.forge/assets.ts"] } }
```

**`include` covers all of `src/` and `tests/`, and there is no `exclude` key at all**, because the two drift apart. `config/` and `scripts/` stay
out deliberately: they run with globals that `"types": []` does not declare, and including them would force a second program or a weakened one.

**`allowImportingTsExtensions` is forge-specific and not baseline**: forge needs it only because oxlint loads its lint plugin through Node's ESM
resolver.

---

## 2. The oxlint Base and Its Overrides

### 2a. The Base

**`.oxlintrc.json` extends `@y-core/forge/tooling/oxlint.base.json` by its path under `node_modules`**; `OXLINT_BASE`'s TSDoc owns that path and why
it is one.

The base holds the plugins, the `forge/*` plugin bundle, the categories, every rule and the shared overrides, and a repository restates none of
them: a local `plugins`, `jsPlugins` or `categories` replaces the base's value, and a local rule naming a base rule is a fleet change made in forge.
The only local rule is one the base does not carry.

**`ignorePatterns` is the one list each repository states**, because oxlint does not inherit it through `extends`; it names at least the generated
trees, `.forge/**` and `.types/**`, plus any vendored tree of its own.

**The base's type-aware rules run only under `oxlint --type-aware`**, a gate row (§3), and their `off` entries are as load-bearing as the `error`
ones: without them the run is noise, and a noisy row is a row someone turns off.

### 2b. Overrides Are Scoped and Reasoned

**Every local override is an addition, appended after the base's, with a comment above it stating why it exists**: an unexplained override is
indistinguishable from a rule someone could not make pass.

**The base carries the overrides every repository shares.** The spec override, over `*.test.ts`, `*.test.tsx`, `*.browser.ts` and `*.workerd.ts`,
turns the design and accessibility rules off, since a test feeds the adversarial markup a rule exists to catch, and turns
`forge/exact-markup-assertion` on. The build-time override, over `config/**`, `scripts/**` and `playwright.config.ts`, restates the valibot ban and
drops the tooling one, since those trees sit outside `include` precisely so they may import a build-time subpath.

**A repository-specific override is legitimate when it is narrow and the narrowing is the argument**, such as a block scoped to the one view
directory that owns a page's live region; a block scoped to `src/**` is a disagreement with the base, and belongs in the base or nowhere.

### 2c. The Formatter Copy

**`bun fmt` ignores `extends`, so `.oxfmtrc.json` is the one tool config a repository copies**: every key of `@y-core/forge/tooling/oxfmt.base.json`
with the base's value, and an `ignorePatterns` holding every base entry plus its own, such as `**/*.md` under the `markdown` opt-in (§3). A changed
option is a fleet change made in the base.

---

## 3. Gate Wiring

**`cloudflareWorkerSteps()` is the table.** A repository's `config/steps.config.ts` default-exports `defineSteps({ tiers })` with the preset's
tiers, and rows genuinely its own are merged in with `mergeTiers`, each into the tier [`TESTING.md`][testing-6a] §6a puts it in.

**The setup a table needs comes from the library too**: `appContrast()` builds the `contrast` option and `wardenAppSteps()` addresses the installed
canon, and their option types own what each takes. Resolving forge's stylesheet directory or the canon's path by hand restates what the library
knows.

**`wardenAppSteps()` is the table's second half, merged onto the preset rather than hand-assembled.** Its rows cannot come from the preset, whose
source may not import warden, and writing them out again gives each row's tier and `dependency` flag a place to drift; its TSDoc and source own the
rows.

**The preset emits `lint:types` in its `static` tier.**

<!-- rule:config-baseline-no-local-type-aware-lint --> The gate refuses a label one tier holds twice, so a local row is a failure rather than an
addition, and is deleted when the repository takes the preset.

**`oxlint-tsgolint` is therefore a required devDependency**, pinned exactly like `oxlint`; without it the type-aware rules in §2a are a config
nothing executes.

**Ordering is never a reason to decline an opt-in**, because each preset tier above `static` leads with `tier()` naming the tier below, so a merged
`unit` row runs after the preset's `unit` rows and ahead of every `runtime` one ([`TESTING.md`][testing-6a] §6a).

**An opt-in is a statement about the application, not about its gate's shape:** `db` for a D1 binding, `browser` for a browser set, `workerd` for a
workerd set, `design` for `ui/*`, `warden` for a cloned governing corpus, and `markdown` for normalized prose, which also requires ignoring markdown
in `.oxfmtrc.json` so the formatter and the check do not own the same bytes. Firefox and WebKit are not a preset option; an application that runs
them merges `crossEngineStep()` into its `scheduled` tier ([`TESTING.md`][testing-6e] §6e).

---

## 4. The Script Set

**These scripts exist in every application repository**, so a command learned in one works in the next:

| Script | Runs |
| --- | --- |
| `verify` | `forge verify` — the `runtime` tier, the gate an epic closes on |
| `verify:static` | `forge verify --tier static` — the interim check |
| `verify:unit` | `forge verify --tier unit` — the task check |
| `verify:scheduled` | `forge verify --tier scheduled` — what a tag and the daily cron run ([`TESTING.md`][testing-6a] §6a) |
| `fix` | `forge verify --fix` |
| `lint` | `forge verify --only lint` — checks, never writes |
| `test` | `bun test` |
| `test:browser` | `playwright test --project=chromium` |
| `dev` | The asset build, then `forge cf dev` |
| `dev:forge` | The local library sync, `bun run <library checkout>/src/tooling/dev/sync.ts`; `bun i` restores the pinned release |
| `build:assets` | `forge assets build all` |
| `types:assets` | `forge verify --only types:assets` |

**`lint` and `fix` are two verbs, not two spellings of one**: `lint` reports and writes nothing, `fix` writes and reports nothing, so a `lint` never
quietly rewrites your tree.

**These sets are conditional on a fact about the repository:**

- **`db:*`** — present when the application has a D1 binding: `db:backup`, `db:compose`, `db:lint`, `db:migrate`, `db:reset`, `db:restore`,
  `db:schema:check`, `db:status`.
- **`cf:*`** — present when the application is deployed to a remote account, **and absent where it is not**. **`cf:status` is the dry run and
  `cf:sync` is the `--commit`**, so the safe command is never named after the dangerous one. Where every resource id in the worker config is a local
  placeholder, a provisioning verb would create real resources and write their ids over the placeholders, so the absence is a control, not an
  omission.
- **`release`** — present only where the repository publishes.

---

## 5. Version Pins

**One fleet version per tool, and forge's pin is the fleet's pin**: a bump lands first in forge, where the gate, the lint plugin and the design
corpus live, and then reaches every application in one sweep; an application never leads a bump.

**The toolchain is pinned exactly, with no range.** Bun is the type checker and the formatter as well as the runtime, so `packageManager` names one
exact Bun and `engines.bun` names that version as its floor; `oxlint` re-classifies between patch releases, so a caret would make a green gate a
property of when `bun install` last ran; and `oxlint-tsgolint` is pinned at whatever version that `oxlint` peer-requires.

**Everything else takes a caret**, because the range is the point: `wrangler`, `@playwright/test`, `tailwindcss`, `esbuild`.

**A pin nothing uses is deleted.**

---

## 6. Config Modules

**Every module a tool loads by convention is `config/<concern>.config.ts`, and its one export is `export default define<Concern>({...})`**, the
helper imported from the subpath owning the concern, whose TSDoc owns what it types. A named export beside the default is a second thing no loader
reads; what a tool loads, and from where, is its README.

**A config module declares, and does nothing else at the top level**: imports, `const` declarations and the default export, because a call, an `if`
or an `import.meta.main` block runs whenever any tool loads the module.

**A module holding only data the config modules import keeps a plain `.ts` name**, since the `.config.ts` suffix marks the entry points.

<!-- rule:config-baseline-config-dir-scope --> `config/` is where a developer tweaks the tools: a config's test only restates it, and a script
belongs beside what it serves.

**A third-party tool's config keeps the name and place its tool reads**: `playwright.config.ts`, `wrangler.jsonc`, `.oxlintrc.json`.

**`validate-config-files` holds the convention**, and `cloudflareWorkerSteps()` emits it in `static`. It fails a named export, a top-level statement
but an import or a `const`, a default not calling an imported `define*` helper, any other `config/` entry but an imported module or declared state,
by default the directory `DB_LAYOUT` names, and a `config/` with no `*.config.ts`, leaving nothing read.

**The same row holds the tool configs to §1 and §2**: it fails each departure those sections name, an `exclude` key, and any of the three spelled
`.jsonc`.

[fc]: ./FORGE_CONSUMPTION.md
[testing-6]: ./TESTING.md#6-the-verification-gate
[testing-6a]: ./TESTING.md#6a-one-command-nested-tiers
[testing-6e]: ./TESTING.md#6e-one-tier-per-moment
