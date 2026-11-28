---
title: Source of Truth Register
description: "Which file owns each fact in forge, so every other document cites it and restates none of it."
audience: internal
---

# Source of Truth Register

> The register [`AGENT_GUIDE.md`][ag-8] §8 requires: every fact that would otherwise drift, and the one file that owns it. A source file named here
> is **authoritative over any prose about it**, anywhere in `docs/` or `CLAUDE.md`.
>
> The rule lives in governance; the rows are forge's own and live here.
>
> Defers to: [`AGENT_GUIDE.md`][ag-8] §8 for the single-home rule this table serves, and [`AGENT_GUIDE.md`][ag-5d] §5d for why a governance document
> names this file in prose rather than linking it.

---

## 0. Quick Reference

- §1 How to Use the Register: what "authoritative" means in practice
- §1a Reading a Row: source file beats prose, always
- §1b Adding a Row: when a fact earns one
- §2 The Register: every owned fact and its file
- §2a Package and Configuration Facts: the export map, the gate, the type system
- §2b Enforced Rules: the checks that own their own rule sets
- §2c Cloudflare Reconciliation: the files that decide what `forge cf sync` creates and writes
- §2d UI Contracts and Data Tables: the files prose may not re-enumerate
- §2e On-Disk Database Formats: the format versions and the shapes they number
- §2f The Prose Rows: the rulings whose home is a document, and the READMEs that own their own
- §3 Rows That Name More Than One File: policy split from matchers
- §3a The Barrel Row: exports and barrel-parse
- §3b The Namespace-Graph Rows: data, policy, and parser
- §3c The Conflict-Group Row: data authoritative over prose
- §4 Documented Subpaths Are Checked: every citation resolves or fails
- §5 The Rule Register: the one home of a rule's sentence and its detectors
- §5a What an Entry Holds and What It Derives: the entry, the marker, and the id convention
- §5b The Round Trip Is Checked: what `validate-rules` holds between the register and the prose
- §5c The Ratchet: the review-only share and each document's words may fall but not rise

---

## 1. How to Use the Register

### 1a. Reading a Row

**When a row names a file, that file wins.** A governing document that contradicts it is wrong by default, and the fix is to delete the prose rather
than to reconcile the two.

Before writing a signature, a constant, a step count, or a file inventory into any document, check whether a row already owns it. If one does,
**cite the file and stop**.

### 1b. Adding a Row

A fact earns a row when it satisfies both tests:

- **It is enumerable** — a list, a table, a graph, a set of values — so a prose copy of it is a second copy that can disagree.
- **It changes independently of the prose that would describe it**, which is what makes the disagreement inevitable rather than hypothetical.

A fact that is stable and short — a naming convention, a posture, a boundary — does **not** earn a row. Those live in governance, where they belong.

---

## 2. The Register

### 2a. Package and Configuration Facts

| Owns | File |
| --- | --- |
| Export subpath names | `package.json` `exports` |
| Side-effectful modules | `package.json` `sideEffects` |
| Verification gate steps, the tiers that list each, and every check's configuration | `config/steps.config.ts` |
| `lib` and `types` configuration | `tsconfig.json` |
| Per-namespace export lists | `src/{ns}/mod.ts` |
| What a namespace is and how to use it | The namespace's README, or the nearest containing one below `src/` ([`NAMESPACES.md`][namespaces-3a] §3a) |
| The generated assets module's exports | `src/tooling/assets/pipeline.ts` |
| Declared cross-namespace dependency graph | `config/namespaces.ts` |
| CSRF and Turnstile field names | `src/form/constants.ts` |
| Form parsing limits and defaults, including `FORM_MAX_BYTES_DEFAULT` | `src/form/config.ts` |
| The database host config's fields and their defaults | `DbHostConfig` in `src/tooling/db/types.ts` |
| The feature manifest's shape | `FeatureManifestSchema` in `src/tooling/curate/types.ts` |
| The fleet's harness policy and its deny list | `warden/claude/settings.json`, synced to `.claude/settings.json` |
| Paths every repository's `.gitignore` must ignore | `MUST_IGNORE` in `warden/src/sync/check.ts` |
| Rule-share and word budgets | `config/rules-baseline.json` |

### 2b. Enforced Rules

Each of these checks **owns the rule set it enforces**. Read the check, not a prose summary of it.

A check whose rule set is _derived_ rather than declared has no row here, and that is decided rather than missing: a check that enforces one
invariant against a table computed from the compiled stylesheet leaves no enumeration a prose copy could disagree with (§1b). Where such a check
commits its derived table, the committed module is the row — `class-groups.ts` and `design-scale.ts` in §2d.

| Owns | File |
| --- | --- |
| Barrel rules as _enforced_ | `src/tooling/gate/checks/exports.ts` + `src/tooling/gate/checks/barrel-parse.ts` |
| The build-time boundary as _enforced_ | `src/tooling/gate/checks/import-boundary.ts` |
| The namespace graph as _enforced_ | `src/tooling/gate/checks/namespace-graph.ts` + `src/tooling/gate/checks/namespace-graph-parse.ts` |
| Governing-doc format as _enforced_ | `warden/src/checks/docs.ts` |
| `@source` coverage as _enforced_ | `src/tooling/gate/checks/css-sources.ts` |
| The modern-CSS rule catalog as _enforced_ — every id, tier, severity and replacement | `src/tooling/lint/modern-css-rules.ts` |
| Token contrast mappings and their measured ratios, as _enforced_ | `src/tooling/gate/checks/contrast.ts` + `src/tooling/gate/checks/contrast-parse.ts` |
| An `opacity-*` on a class string, held to the audited pairs | `src/tooling/gate/checks/faded-text.ts` |
| Every rule id and how each is detected | `config/rules.config.ts` + `warden/src/rules/canon/` |
| The rule register's round trip, as _enforced_ | `warden/src/checks/rules.ts` |
| The design corpus's citations as _enforced_ | `warden/src/checks/design.ts` + `src/tooling/gate/checks/design-parse.ts` |
| Every corpus rule about source, markup or class string, as _enforced_ | `src/tooling/lint/plugin.ts` and the rules under `src/tooling/lint/rules/` |
| JSX pragma lines as _enforced_ | `src/tooling/gate/checks/jsx.ts` |
| The slot-clobber ordering rule as _enforced_ | `src/tooling/lint/rules/data-slot-before-spread.ts` |
| Test co-location, and the modules exempt from it, as _enforced_ | `src/tooling/gate/checks/co-location.ts` |
| Which config modules are held to the config-module shape, and what each must hold, as _enforced_ | `src/tooling/gate/checks/config-files.ts` |
| Which substring assertions on markup fail, and what suppresses one, as _enforced_ | `src/tooling/lint/rules/exact-markup-assertion.ts` |
| Which reads put a browser spec block in the cross-engine subset, and where its tag is spelled, as _enforced_ | `src/tooling/gate/checks/cross-engine-tags.ts` |
| The SSR/browser import boundary as _enforced_ | `src/tooling/gate/checks/ssr-boundary.ts` |
| Changelog and package-version agreement as _enforced_ | `warden/src/checks/changelog.ts` |
| Which documents warden indexes, and the retrieval weight each carries | `warden/src/corpus/source.ts` |
| The `warden` command surface — every command, its flags, and what each writes | `warden/src/cli/commands.ts` + `warden/src/cli/knowledge.ts` |
| Which modern-CSS findings fail, warn, or are deferred, as _enforced_ | `src/tooling/gate/checks/modern-css.ts` + `src/tooling/gate/checks/modern-css-deferred.ts` |
| Every SQL migration lint rule — its id, level, matcher and what it excepts, as _enforced_ | `src/tooling/db/migrate/lint.ts` |

### 2c. Cloudflare Reconciliation

The `sync` half of the CLI decides what exists, what is created, and what is written back. Each row names the file that decides it; no prose here
restates a naming rule or a handler's plan.

| Owns | File |
| --- | --- |
| The Cloudflare resource types `forge cf sync` reconciles | `RESOURCE_TYPES` in `src/tooling/cf/types.ts` |
| Which handler serves a given resource type | `buildHandlers` and `defaultHandlers` in `src/tooling/cf/account/handlers/registry.ts` |
| Which wrangler configs `forge cf sync` refuses before any request | `refusePagesConfig` in `src/tooling/cf/target.ts` |
| The naming strategy for a created remote resource | the per-type handler in `src/tooling/cf/account/handlers/` |
| What a reconciliation run decides to create, write, or leave | `syncBindings` in `src/tooling/cf/account/engine.ts` |
| The JSONC round-trip contract — what survives a write | `src/tooling/cf/config/write.ts` + `src/tooling/cli/jsonc-edit.ts` |
| The shape every reader of a worker config is given, and the one error a malformed one raises | `validateWranglerConfig` in `src/tooling/cf/config/parse.ts` |
| How an `env.<name>` block inherits each deployment key forge reads | `ENVIRONMENT_INHERITANCE` in `src/tooling/cf/config/environment.ts`, held against the installed wrangler by `environment.test.ts` |
| The `.dev.vars` marker comments and what each licenses | `GENERATE_MARKER` and `PUSH_MARKER` in `src/tooling/cf/account/handlers/devvars.ts` |
| The `forge cf sync` command surface and its flags | `createSyncAccountCommand` in `src/tooling/cf/account/commands.ts` |
| The `forge` command tree — which first-party commands attach, and where an app's own are loaded from | `src/tooling/root/root.ts` |

### 2d. UI Contracts and Data Tables

| Owns | File |
| --- | --- |
| Tailwind conflict-group table | `src/ui/core/utils/class-groups.ts` |
| The spacing scale, spacing and colour roots, and colour tokens | `src/tooling/lint/data/design-scale.ts` |
| Forge's own UI glyph names, and the sprite sources that supply them | `src/ui/assets/glyphs.ts` + `src/ui/assets/build/glyph-sources.ts` |
| Audited contrast pairs and the criterion binding each | `src/ui/contracts/theme/contrast-pairs.ts` |
| Accepted contrast exemptions, their pinned values and reasons | `src/ui/contracts/theme/contrast-accepted.ts` |
| Theme dial fields, parameters, ranges, units and fallbacks | `src/ui/contracts/theme/theme-contract.ts` |
| The dialled shape properties and the values they take | `SHAPE_PROPERTIES` and `shapeVars` in `src/ui/contracts/theme/theme-contract.ts` |
| The glyph names the auth views draw, which a consumer's sprite must cover | `AuthIconName` in `src/auth/web/types.ts` |
| Every English accessible name forge falls back to, and the word read for each step state | `src/ui/contracts/labels.ts` |

### 2e. On-Disk Database Formats

A format version and the shape it numbers change together and are read by a tool, so prose about either is a copy that outlives it by exactly one
release. Cite the version constant and the shape; enumerate neither.

| Owns | File |
| --- | --- |
| What a D1 backup's `.json` sidecar carries | `D1BackupSidecar` in `src/storage/backup/types.ts` + `SIDECAR` in `src/storage/backup/sidecar.ts` |
| `SCHEMA_MODEL_VERSION` and the snapshot's shape | `src/tooling/db/schema/types.ts` |
| The companion tables forge creates and reads | `COMPANION_TABLES` in `src/tooling/db/migrate/companions.ts` |
| The table-name prefixes forge treats as managed | `MANAGED_TABLE_PREFIXES` in `src/storage/db/schema.ts` |

### 2f. The Prose Rows

Every row above names a _source_ file. These name prose, because what they own is a **ruling** rather than data — §1b's enumerability test is what
separates the two, and a ruling has a single home for the same reason a table does.

| Owns | File |
| --- | --- |
| What a source comment may contain, and where displaced rationale goes | [`CODE_RULES.md`][cr-5] §5 |
| What a README is for, and what it is not for | [`AGENT_GUIDE.md`][ag-6c] §6c |
| The `config` namespace's rulings — the store, resolution order, and what a consumer may read | `src/config/README.md` |
| The `session` namespace's rulings — cookie construction, signing, and the middleware's contract | `src/session/README.md` |
| The `site` namespace's rulings — what a site descriptor carries and what reads it | `src/site/README.md` |
| The `tooling/cf` rulings — the `cf·verb·object` grammar, id-is-identity, vars-never-written, the `.dev.vars` markers | `src/tooling/cf/README.md` |
| The `tooling/term` rulings — the terminal-output surface and what may call it | `src/tooling/term/README.md` |
| The `tooling/curate` rulings — markers matched on a comment, the closure directions, refusal before any write, the gate row's tier | `src/tooling/curate/README.md` |
| The `render/pdf` rulings — the page ceiling, the document default face, what the engine refuses and what it is not | `src/render/pdf/README.md` |
| The `crypto/keyring` namespace's rulings — the at-rest frame and its missing version byte, rotation by prepend, retirement, one ring per root secret | `src/crypto/keyring/README.md` |
| The AES-GCM seal budget — the random-nonce bound per `(kid, purpose)` subkey, what crossing it costs, the rotation cadence it sets | [`AUTH_MOUNTING.md`][am-7] §7 |
| Which forge files the comment budget holds, and a stylesheet comment's form | [`FORGE_STRUCTURE.md`][fs-10] §10 |
| The app's one CSRF policy — supplied by the chain, verified exactly once, no inline verifier | [`ROUTING_AND_MIDDLEWARE.md`][ram-3f] §3f |
| How a slice contributes — plain data the app root passes each factory as a list, a duplicate key throws, the result is frozen | [`ROUTING_AND_MIDDLEWARE.md`][ram-3g] §3g |
| The session as a chain slot — the asserted `SessionMiddleware`, `subject: "session"`, the root-owned CSRF policy, one auth store, the lifetime check, sign-out destroys, cookie primitives in `http` | [`ROUTING_AND_MIDDLEWARE.md`][ram-3h] §3h |
| How a rate limit is declared — the binding by name checked at registration, the window from the generated `RATELIMITS`, the one `RateLimit` type, trust on the chain alone, group versus route placement, the entry points | [`SECURITY_HARDENING.md`][sh-4e] §4e |
| How a guard refuses — one `onRefuse(c, refusal)` hook declared on the chain and overridable per group, plain-text defaults, the media helpers, `Retry-After`, the `security.<guard>.refused` log line, the fixed statuses | [`FORGE_ERRORS.md`][eh-3e] §3e |

**The README rows above own their namespace's rulings outright, because no `docs/` document covers them**, and a governing document per namespace
would only be a second copy of what the README says. For those namespaces the README **is** the governing prose: cite it as the owner and restate
none of its rulings in `docs/`. Every other namespace's README teaches use only ([`AGENT_GUIDE.md`][ag-6c] §6c).

**A row moves the day a `docs/` document is written for one of these namespaces**, and the README is reduced to reference in the same change. Adding
the document without moving the row is how a second copy starts. **The move runs both ways**: retiring such a document returns the row here.

---

## 3. Rows That Name More Than One File

In each case the concern genuinely spans the files named, and naming one alone would send half of its readers to the wrong place.

### 3a. The Barrel Row

`exports.ts` remains the entry point and retains every policy decision — what fails, in what order, with what message — while `barrel-parse.ts`
holds the matchers it decides on, the star-ban regex among them.

**Stating the split is more honest than naming the entry point alone.** A reader chasing "why is this a barrel violation at all" wants the matcher;
one chasing "why did the gate fail" wants the entry point.

### 3b. The Namespace-Graph Rows

These split further, and the first split is the unusual one: **`config/namespaces.ts` is _data_, and it is authoritative over the prose.**
[`NAMESPACES.md`][namespaces-4] §4 cites it and enumerates nothing, because a second copy of a graph is indistinguishable from an amendment the
moment the two disagree.

The enforcement then splits as the barrel row does — `namespace-graph.ts` owns the policy (what fails, the namespace set it derives from `exports`,
the guard that the enumeration has not returned), while `namespace-graph-parse.ts` owns the matchers and the diff (which files are walked, how an
import resolves to a namespace, how edge kind is decided).

### 3c. The Conflict-Group Row

The conflict-group row names the data file alone, and the split is the one §3a and §3b describe: `class-groups.ts` is _data_ and is authoritative
over any prose describing forge's covered utility surface, while `cn.ts` retains every policy decision — which class is dropped, in what order, and
the fail-open rule for anything the table does not claim.

---

## 4. Documented Subpaths Are Checked

**Every `@y-core/forge/<subpath>` written anywhere in the documentation set is checked against `package.json` `exports`; an unresolvable subpath
fails the gate.**

For a subpath matched by a pattern rather than a literal key, the check additionally requires the file to exist — otherwise a citation of a
stylesheet that was never written would satisfy the shape and send a reader to a resolution error.

---

## 5. The Rule Register

**A rule with an id is stated in the register and argued in the prose**, the split [`AGENT_GUIDE.md`][ag-8] §8 sets. The register is not a second
list of what the prose already says: the sentence moves into it and is deleted from the prose, and the gate checks the join between the two.

### 5a. What an Entry Holds and What It Derives

<!-- rule:forge-rule-entry-fields --> The statement is one sentence, a must or a never. A Default-tier design rule keeps its `Default: … unless …`
form ([`UI_DESIGN_GUIDANCE.md`][udg-2b] §2b). Severity belongs to each detector, not to the entry.

**Everything else is derived from where the marker sits.** The marker's section is the rule's rationale. Whether the rule is canon or forge's own,
and which of `libs` and `apps` it applies to, follow from the tree holding that section. Nothing in the entry declares them, so nothing can disagree
with the prose.

**An id is prefixed by where its rule lives.** A forge rule's id starts `forge-`. A canon rule's starts with its document's filename in lower case,
underscores as hyphens — `code-rules-` for `CODE_RULES.md`. A document both canon trees carry adds the tree in front, so `TESTING.md` in each is
`libs-testing-` and `apps-testing-`.

**A document read from disk shows the marker without the sentence.** Warden writes the statement in at the marker when it serves a section, and the
file on disk has none to show. That is the cost of keeping one copy, and it is paid only by a reader who bypasses warden.

### 5b. The Round Trip Is Checked

**`validate-rules` fails when the register and the prose disagree.** It holds:

- every marker to an entry, and every entry to a marker, each id well formed and declared once;
- each marker to a numbered section in the tree its rule file governs, and each id to the prefix §5a sets;
- each statement to its form;
- each detector to something real — a lint key the plugin registers and some oxlint config enables, at the top level or in any `overrides`
  entry; a declared step; a test source that exists;
- every lint plugin rule to an id, and that id's entry to a lint detector naming the plugin rule;
- every finding source, and every id a check reports under, to a declared id rather than a `§` citation.

**A marker that does not open its paragraph, list item or table cell fails**, because the prose before it restates a rule the register holds.

### 5c. The Ratchet

**`warden:ratchet` fails when the review-only share of the register rises, or when a document holds more words than its budget.** A review-only
rule is one no detector enforces. Both limits live in `config/rules-baseline.json`, which also lists every document the repository owns. A document
the baseline does not list fails, and so does a listed document that does not exist. Forge is the canon's home, so the canon's documents are
budgeted here too, keyed by their paths in this repository.

**The fixer only tightens.** It lowers each budget to the document's current count, adds a new document at its current count, and drops a deleted
one. It refuses to run when the review-only share has risen.

**Raising a budget is a hand edit to the JSON**, made in the commit that needs the words, where review sees it next to the prose that grew.

[ag-5d]: ../warden/canon/shared/AGENT_GUIDE.md#5d-crossing-the-governance-boundary
[ag-6c]: ../warden/canon/shared/AGENT_GUIDE.md#6c-decisions-versus-usage--the-readme-boundary
[ag-8]: ../warden/canon/shared/AGENT_GUIDE.md#8-single-home-rule-and-the-source-of-truth-register
[am-7]: ./AUTH_MOUNTING.md#7-rotating-the-key-ring
[cr-5]: ../warden/canon/shared/CODE_RULES.md#5-comment-budget-rule
[eh-3e]: ./FORGE_ERRORS.md#3e-one-refusal-contract-for-every-guard
[fs-10]: ./FORGE_STRUCTURE.md#10-stylesheets-take-the-source-comment-forms
[namespaces-3a]: ./NAMESPACES.md#3a-a-namespace-is-described-by-its-own-readme
[namespaces-4]: ./NAMESPACES.md#4-namespace-classification
[ram-3f]: ./ROUTING_AND_MIDDLEWARE.md#3f-one-csrf-policy-per-app-verified-once
[ram-3g]: ./ROUTING_AND_MIDDLEWARE.md#3g-a-slice-exports-its-contribution-as-data
[ram-3h]: ./ROUTING_AND_MIDDLEWARE.md#3h-the-session-is-a-typed-chain-slot
[sh-4e]: ./SECURITY_HARDENING.md#4e-one-declaration-per-rate-limit
[udg-2b]: ./UI_DESIGN_GUIDANCE.md#2b-defaults--rebuttable-aesthetic-guidance
