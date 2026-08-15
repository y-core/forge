---
title: Source of Truth Register
description: "Which file owns each fact in forge, so every other document cites it and restates none of it."
---

# Source of Truth Register

> The register [`AGENT_GUIDE.md`](../governance/AGENT_GUIDE.md) §8 requires: every fact that would
> otherwise drift, and the one file that owns it. A source file named here is **authoritative over
> any prose about it**, anywhere in `.decisions/` or `CLAUDE.md`.
>
> The rule lives in governance; the rows are forge's own and live here.
>
> Defers to: [`AGENT_GUIDE.md`](../governance/AGENT_GUIDE.md) §8 for the single-home rule this
> table serves, and [`AGENT_GUIDE.md`](../governance/AGENT_GUIDE.md) §5d for why a governance
> document names this file in prose rather than linking it.

---

## 0. Quick Reference

- §1 How to Use the Register: what "authoritative" means in practice
- §1a Reading a Row: source file beats prose, always
- §1b Adding a Row: when a fact earns one
- §2 The Register: every owned fact and its file
- §2a Package and Configuration Facts: the export map, the gate, the type system
- §2b Enforced Rules: the checks that own their own rule sets
- §2c UI Contracts and Data Tables: the files prose may not re-enumerate
- §2d The One Prose Row: what a source comment may contain
- §3 Rows That Name More Than One File: policy split from matchers
- §3a The Barrel Row: exports and barrel-parse
- §3b The Namespace-Graph Rows: data, policy, and parser
- §3c The Conflict-Group Row: data authoritative over prose
- §4 Documented Subpaths Are Checked: every citation resolves or fails

---

## 1. How to Use the Register

### 1a. Reading a Row

**When a row names a file, that file wins.** A governing document that contradicts it is wrong by
default, and the fix is to delete the prose rather than to reconcile the two.

The practical instruction: before writing a signature, a constant, a step count, or a file
inventory into any document, check whether a row already owns it. If one does, **cite the file and
stop**.

### 1b. Adding a Row

A fact earns a row when it satisfies both tests:

- **It is enumerable** — a list, a table, a graph, a set of values — so a prose copy of it is a
  second copy that can disagree.
- **It changes independently of the prose that would describe it**, which is what makes the
  disagreement inevitable rather than hypothetical.

A fact that is stable and short — a naming convention, a posture, a boundary — does **not** earn a
row. Those live in governance, where they belong.

---

## 2. The Register

### 2a. Package and Configuration Facts

| Owns | File |
|---|---|
| Export subpath names | `package.json` `exports` |
| Side-effectful modules | `package.json` `sideEffects` |
| Verification gate steps, and every check's configuration | `config/steps.ts` |
| `lib` and `types` configuration | `tsconfig.json` |
| Per-namespace export lists | `src/{ns}/mod.ts` |
| The generated assets module's exports — the manifest, the per-group `viewBox` consts, the bound icon components, and the glyph-name unions | `src/assets/build/pipeline.ts` |
| Declared cross-namespace dependency graph | `config/namespaces.ts` |
| CSRF and honeypot field names | `src/form/constants.ts` |
| Form parsing limits and defaults, including `FORM_MAX_BYTES_DEFAULT` | `src/form/config.ts` |
| Bash allowlist patterns, including the exit-check literal | `.claude/settings.local.json` `permissions.allow` |

### 2b. Enforced Rules

Each of these checks **owns the rule set it enforces**. Read the check, not a prose summary of it.

| Owns | File |
|---|---|
| Barrel rules as *enforced* | `src/pkg/gate/checks/exports.ts` + `src/pkg/gate/checks/barrel-parse.ts` |
| The namespace graph as *enforced* | `src/pkg/gate/checks/namespace-graph.ts` + `src/pkg/gate/checks/namespace-graph-parse.ts` |
| Governing-doc format as *enforced* | `src/pkg/gate/checks/docs.ts` |
| `@source` coverage as *enforced* | `src/pkg/gate/checks/css-sources.ts` |
| The modern-CSS rule catalog as *enforced* — every id, tier, severity and replacement | `src/pkg/gate/checks/modern-css-rules.ts` |
| Token contrast mappings and their measured ratios, as *enforced* | `src/pkg/gate/checks/contrast.ts` + `src/pkg/gate/checks/contrast-parse.ts` |
| The design corpus's rule ids, citations and source rules as *enforced* | `src/pkg/gate/checks/design.ts` + `src/pkg/gate/checks/design-parse.ts` |
| JSX pragma lines and the slot-clobber rule as *enforced* | `src/pkg/gate/checks/jsx.ts` + `src/pkg/gate/checks/jsx-parse.ts` |
| Test co-location, and the modules exempt from it, as *enforced* | `src/pkg/gate/checks/co-location.ts` |
| The SSR/browser import boundary as *enforced* | `src/pkg/gate/checks/ssr-boundary.ts` |
| Changelog and package-version agreement as *enforced* | `src/pkg/gate/checks/changelog.ts` |
| Which modern-CSS findings fail, warn, or are deferred, as *enforced* | `src/pkg/gate/checks/modern-css.ts` + `src/pkg/gate/checks/modern-css-deferred.ts` |

### 2c. UI Contracts and Data Tables

| Owns | File |
|---|---|
| Tailwind conflict-group table | `src/ui/core/utils/class-groups.ts` |
| Forge's own UI glyph names, and the sprite sources that supply them | `src/ui/assets/sprites.ts` |
| Audited contrast pairs and the criterion binding each | `src/ui/contracts/theme/contrast-pairs.ts` |
| Accepted contrast exemptions, their pinned values and reasons | `src/ui/contracts/theme/contrast-accepted.ts` |
| Theme dial fields, parameters, ranges, units and fallbacks | `src/ui/contracts/theme/theme-contract.ts` |
| The showcase's demo coverage manifest, and the gaps it excuses | `src/ui/show/coverage.ts` + `src/ui/show/coverage-missing.ts` |

### 2d. The One Prose Row

Every row above names a *source* file. This one names a governing document, because the fact it
owns is a rule rather than data — and a source file must not restate it:

| Owns | File |
|---|---|
| What a source comment may contain, and where displaced rationale goes | [`PRODUCTION_TS_RULES.md`](../governance/PRODUCTION_TS_RULES.md) §5 |

---

## 3. Rows That Name More Than One File

Some rows name more than one file. In each case the concern genuinely spans them, and naming one
would send half of its readers to the wrong place.

### 3a. The Barrel Row

`exports.ts` remains the entry point and retains every policy decision — what fails, in what
order, with what message — while `barrel-parse.ts` holds the matchers it decides on, the star-ban
regex among them.

**Stating the split is more honest than naming the entry point alone.** A reader chasing "why is
this a barrel violation at all" wants the matcher; one chasing "why did the gate fail" wants the
entry point.

### 3b. The Namespace-Graph Rows

These split three ways, and the first is the unusual one: **`config/namespaces.ts` is *data*, and
it is authoritative over the prose.** [`NAMESPACES.md`](./NAMESPACES.md) §4 cites it and enumerates
nothing, because a second copy of a graph is indistinguishable from an amendment the moment the two
disagree.

The enforcement then splits as the barrel row does — `namespace-graph.ts` owns the policy (what
fails, the namespace set it derives from `exports`, the guard that the enumeration has not
returned), while `namespace-graph-parse.ts` owns the matchers and the diff (which files are walked,
how an import resolves to a namespace, how edge kind is decided).

### 3c. The Conflict-Group Row

The conflict-group row names the data file alone, and the split is the one §3a and §3b describe:
`class-groups.ts` is *data* and is authoritative over any prose describing forge's covered utility
surface, while `cn.ts` retains every policy decision — which class is dropped, in what order, and
the fail-open rule for anything the table does not claim.

---

## 4. Documented Subpaths Are Checked

**Every `@y-core/forge/<subpath>` written anywhere in the documentation set is checked against
`package.json` `exports`; an unresolvable subpath fails the gate.**

For a subpath matched by a pattern rather than a literal key, the check additionally requires the
file to exist — otherwise a citation of a stylesheet that was never written would satisfy the shape
and send a reader to a resolution error.
