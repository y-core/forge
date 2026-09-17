---
title: Application Configuration Baseline
description: "The tsconfig flags, oxlint base and overrides, gate wiring, script set and tool pins every Worker application in this fleet shares, and the rule for what may vary."
---

# Application Configuration Baseline

> Owns the toolchain configuration an application repository is held to: the compiler flags, the linter's base and where it may be overridden, what
> the gate table is wired from, which `package.json` scripts exist, and who owns a version pin. Repositories reached different answers, with no
> principle behind the divergence; this is the one answer.
>
> **Diffed by hand.** No gate check enforces this document — each section is written concrete enough to hold a repository against without tooling.
>
> Defers to: [`TESTING.md`][testing-6] §6 for what the gate modes mean and what a step's tier is; [`FORGE_CONSUMPTION.md`][fc] for the
> application-to-library relationship, which is a different subject from the toolchain.

---

## 0. Quick Reference

- §1 The tsconfig Flag Set: the strictness flags beyond `strict`, the `@assets` path, and no `exclude` key
- §2 The oxlint Base and Its Overrides: one base every repository shares, variation only in `overrides`
- §2a The Base: plugins, categories, ignore patterns, rules, and the type-aware block
- §2b Overrides Are Scoped and Reasoned: the spec override, and what a legitimate second one looks like
- §3 Gate Wiring: the preset is the table, and a hand-appended row is a defect
- §4 The Script Set: the scripts every repository has, and the sets conditional on what it holds
- §5 Version Pins: one fleet version, forge's pin is the fleet's pin

---

## 1. The tsconfig Flag Set

**Beyond `strict`, every repository carries all of these:**

```json
{
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true,
  "noImplicitOverride": true,
  "noImplicitReturns": true,
  "noFallthroughCasesInSwitch": true,
  "allowUnreachableCode": false,
  "erasableSyntaxOnly": true
}
```

They are one set, not a menu. Each removes a class of defect the type checker would otherwise hand to review, and a repository that drops one has
the review burden of a repository carrying none for the class it dropped.

**`paths` declares the generated asset module**, so markup names `@assets` rather than a relative path into a build artifact:

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

Everything above `overrides` is shared. A repository does not curate this list — it copies it, and a change to it is a fleet change.

| Key | Value |
| --- | --- |
| `plugins` | `["eslint", "typescript", "unicorn", "oxc", "import", "promise", "jsx-a11y"]` |
| `jsPlugins` | `["@y-core/forge/tooling/lint/plugin"]` — the published bundle, never a relative path |
| `categories` | `{ "correctness": "error" }` |
| `ignorePatterns` | `[".forge/**", ".types/**"]` — the generated trees, which no tool but their emitter owns |

`rules` carries the `forge/*` design and accessibility rules the library's own corpus defines, the `typescript/*` shape rules, the
`eslint/no-restricted-imports` patterns that hold the facade and keep a build-time subpath out of `src/`, and the handful of upstream rules this
fleet turns off.

**These entries in it are got wrong by copying the shape and not the options**, so they are written out here:

```json
{
  "typescript/no-empty-object-type": ["error", { "allowInterfaces": "with-single-extends" }],
  "eslint/no-irregular-whitespace": ["error", { "skipComments": true }],
  "eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_", "ignoreRestSiblings": true }]
}
```

A bare `"error"` in place of any of them is not a stricter setting; it is a rule that fires on code the fleet writes on purpose, which is how a
rule comes to be turned off.

**Both restricted-import bans are `patterns` groups, and the build-time group names three spellings** — the library's `tooling` prefix bare, then
its `/*` children, then its `/**` descendants. A group matching only the children leaves the bare prefix open the day the library publishes it as a
barrel, and the ban is the only thing standing between a Worker bundle and a module that needs node's globals.

**The type-aware block is part of the base, not an option.** These rules only run under `oxlint --type-aware`, which §3 makes a gate row:

```json
{
  "typescript/no-floating-promises": "error",
  "typescript/no-misused-promises": "error",
  "typescript/await-thenable": "error",
  "typescript/no-base-to-string": "off",
  "typescript/unbound-method": "off",
  "typescript/restrict-template-expressions": "off",
  "typescript/no-misused-spread": "off",
  "typescript/require-array-sort-compare": "off",
  "typescript/no-duplicate-type-constituents": "off",
  "typescript/no-redundant-type-constituents": "off"
}
```

The `off` entries are as load-bearing as the `error` ones: without them the type-aware run is noise, and a noisy row is a row someone
turns off.

### 2b. Overrides Are Scoped and Reasoned

**Every difference between two repositories' linter configuration lives in `overrides`, and every override states why it exists in a comment above
it.** An unexplained override is indistinguishable from a rule someone could not make pass.

**The spec override is shared, and "shared" means the same list.** Under `["**/*.test.ts", "**/*.test.tsx", "**/*.browser.ts"]` every
`forge/a11y-*`, `forge/platform-*` and design rule is off — a test's job is to feed the adversarial markup a rule exists to catch, so holding a
fixture to the rule inverts it — and `forge/exact-markup-assertion` is on, which is the only file class it applies to.
`typescript/no-non-null-assertion` is off there
too, with the `jsx-a11y` rules a fixture's deliberately malformed markup trips: `aria-proptypes`, `control-has-associated-label` and
`tabindex-no-positive`.

A repository that turns off some of them and leaves the rest on has not written a narrower override; it has an untested half of the block, and the
first spec that needs one of the other rules off gets a per-site suppression instead.

**The second shared override is the build-time one**, scoped to `["config/**", "scripts/**", "playwright.config.ts"]` — the trees that sit outside
`tsconfig.json`'s `include` precisely so they may import a build-time subpath. It restates the valibot ban and drops the tooling one, so the facade
still holds where the boundary does not apply.

**A repository-specific override is legitimate when it is narrow and the narrowing is the argument.** A block scoped to the one view directory that
owns a page's live region, or to the one generated module a vendor ships, is the shape to aim for. A block scoped to `src/**` is not an override; it
is a disagreement with the base, and it belongs in the base or nowhere.

---

## 3. Gate Wiring

**`cloudflareWorkerSteps()` is the table.** A repository's `config/steps.ts` spreads the preset and appends only rows that are genuinely its own —
a check over its own data, a build its own pipeline needs.

**`wardenAppSteps()` is the second half of the table, and appending it is not an exception.** The rows it emits — `validate-docs`, `warden:index`,
`warden:queries`, `warden:duplicates` — cannot come from the first preset, which lives under the library's `src/` where nothing may import warden.
It is spread, not hand-assembled: a repository writing those builder calls out again has one place per row for the `dependency` flag and the tier to
drift.

**The preset emits `lint:types` at the `standard` tier**, immediately after `format`. An application never hand-appends `typeAwareLintStep`: the
selector refuses a duplicate label, so a local row is not an addition but a failure. A repository that was appending one deletes it when it takes
the preset that emits it.

**`oxlint-tsgolint` is therefore a required devDependency**, pinned exactly like `oxlint` itself. Without it the type-aware rules in §2a are a
config nothing executes.

**Ordering is never a reason to decline an opt-in.** The gate sorts by tier after filtering, so the cheaper tier always runs first and an appended
`standard` row always runs ahead of a preset's `full` one ([`TESTING.md`][testing-6a] §6a). A repository that declines `browser: true` so it can
append `browserStep` itself, later in the table, is working around a problem the selector does not have.

**The opt-ins an application takes are a statement about the application, not about its gate's shape:** `db` when it has a D1 binding, `browser`
when it has a browser set, `workerd` when it has one, `design` when it uses `ui/*`, `warden` when it clones the governing corpus, and `markdown`
when it wants its prose normalized — which also requires ignoring markdown in `.oxfmtrc.json`, since otherwise the formatter and the check own the
same bytes.

---

## 4. The Script Set

**These scripts exist in every application repository**, so a command learned in one works in the next:

| Script | Runs |
| --- | --- |
| `verify` | `forge verify` — the gate a task closes on |
| `verify:quality` | `forge verify --mode quality` — every row that judges the source rather than running it |
| `verify:full` | `forge verify --full` |
| `fix` | `forge verify --fix` |
| `lint` | `forge verify --only lint` — checks, never writes |
| `test` | `bun test` |
| `test:browser` | `playwright test` |
| `dev` | The asset build, then `wrangler dev` |
| `dev:forge` | The local library sync |
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

**The linters are pinned exactly, with no range.** `oxlint` and `oxfmt` both reformat and re-classify between patch releases, so a caret would make
a green gate a property of when `bun install` last ran. `oxlint-tsgolint` is pinned exactly alongside `oxlint`, at whatever version that `oxlint`
peer-requires.

**Everything else takes a caret**, because the range is the point: `typescript`, `wrangler`, `@playwright/test`, `tailwindcss`, `esbuild`.

**A pin nothing uses is deleted rather than carried.** A devDependency present in a repository and reached by nothing in it is one more thing to
update and nothing to gain.

[fc]: ./FORGE_CONSUMPTION.md
[testing-6]: ./TESTING.md#6-the-verification-gate
[testing-6a]: ./TESTING.md#6a-one-command-three-modes
