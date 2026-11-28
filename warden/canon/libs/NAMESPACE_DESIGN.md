---
title: Namespace Design
description: "Barrel discipline and the export-star ban, the no-sibling-barrel rule, leaf-versus-integration classification, naming conventions, and when to add a namespace."
---

# Namespace Design

> Owns barrel discipline, the import guard that prevents cycles, the leaf/integration classification, the exported-symbol naming convention, and the
> criteria for adding a namespace. Each namespace's README, beside its barrel, says what it does, and no document restates it.
>
> Defers to: [`LIBRARY_ARCHITECTURE.md`][la] for the facade and runtime-only principles these rules serve; [`CODE_RULES.md`][cr] for the coding
> rules inside a namespace; `package.json` `exports` for the subpath names themselves.

---

## 0. Quick Reference

- §1 Barrel Rules and Export Discipline: one barrel per namespace, named exports only
- §1a Barrel Convention: the rules a barrel obeys
- §1b Export Star Ban: why all three spellings are rejected
- §1c What the Export Gate Proves: read the check, not a prose copy
- §2 No-Sibling-Barrel Import Rule: the guard against circular dependencies
- §2a The Import Guard: a lint rule, with named exemptions
- §2b Why Sibling Barrels Are Forbidden: the cycle it prevents
- §2c Granting an Exemption: what a barrel must be to earn one
- §3 Namespace Classification: the leaf/integration split
- §3a Leaf Namespace Rules: zero cross-namespace imports
- §3b Integration Namespace Rules: every edge declared, and what the graph gate proves
- §3c Foundational Primitives: the closed set below the split
- §3d A Directory Is a Namespace Only With a Subpath: classify by published surface
- §3e Duplication Across a Leaf Boundary: an accepted cost, not an oversight
- §4 Exported Symbol Naming Convention: verbs and type suffixes
- §4a Factory and Accessor Verbs: the value-constructor exception to the verb rule
- §4b Option and Shape Type Suffixes: `*Config`, `*Options`, `*Definition`, `*Descriptor`
- §5 When to Add a New Namespace: criteria and checklist
- §5a Criteria for a New Namespace: the tests a new namespace passes
- §5b Checklist Before Merge: what must be true
- §5c Extraction Triggers: when an existing namespace has outgrown its concern

---

## 1. Barrel Rules and Export Discipline

### 1a. Barrel Convention

Every namespace has exactly one barrel — a single `mod.ts` at the namespace root — and it is the only file listed in `package.json` `exports` for
that subpath. All public API flows through it.

- <!-- rule:namespace-design-named-exports --> A star re-export hides what the barrel publishes (§1b).
- **Every new public symbol in the namespace is added to the barrel.**
- **A barrel imports from concrete files, never from another barrel** (§2).

The barrel is the namespace's published surface, not a convenience index for shorter import paths — that is what a barrel means inside an
_application_, and the inversion is the most common mistake carried in from app work.

### 1b. Export Star Ban

**`export * from "./foo"` is banned**: it leaks internal symbols, risks circular dependencies, and makes the public API ungreppable.

**Every spelling is banned**, not just the bare one:

| Form | Banned | Why |
| --- | --- | --- |
| `export * from "./foo"` | yes | all the harms |
| `export * as ns from "./foo"` | yes | the same leak behind one extra token |
| `export type * from "./foo"` | yes | leaks every internal type, and is equally ungreppable |

The type-only form cannot create a runtime cycle, but the other harms still apply: name the types.

### 1c. What the Export Gate Proves

`checkExports`, the `validate-exports` step, owns §1a–§1b's enforcement and its passes; read the check, not a prose copy that will disagree with it.

<!-- rule:namespace-design-sealed-barrel --> A sealed-internal barrel is legitimate: a barrel is valid if it is exported _or_ explicitly sealed, and
never merely by existing.

---

## 2. No-Sibling-Barrel Import Rule

### 2a. The Import Guard

**Importing another namespace's barrel from inside the source tree is banned by a lint rule**, with a small set of named exemptions (§2c). Import
the concrete file instead.

### 2b. Why Sibling Barrels Are Forbidden

When one namespace imports another's barrel, any later import in _that_ barrel which reaches back creates a cycle neither file names. **Importing
the concrete file makes the dependency explicit and bounded**: it names one module, and a reviewer sees exactly what was taken.

Inside a library the barrel is the _published surface_, so consuming it from within makes a namespace depend on its own export map — the inverse of
an application's rule.

### 2c. Granting an Exemption

An exemption is warranted only where the barrel _is_ the abstraction — a facade whose whole point is that every consumer takes the same single
symbol from it, or a sealed-internal utility module several namespaces need.

**Every exemption is a §3c foundational primitive**, because the closure property that makes a namespace a primitive is what makes its barrel safe
to import everywhere. The repository's `docs/` docs name the current exemptions.

---

## 3. Namespace Classification

### 3a. Leaf Namespace Rules

A namespace is **leaf** when it imports only from its own directory, external packages, Web APIs, and the foundational primitives of §3c — **zero
other cross-namespace imports.**

**Which namespaces are leaf is declared in a config file, not in prose**, because a second copy of a graph is indistinguishable from an amendment
once the two disagree; prose keeps only _why_ a classification holds.

### 3b. Integration Namespace Rules

A namespace is **integration** when it composes across namespaces. **Every edge is declared as source, target, and kind**; an undeclared
cross-namespace import is a defect, and so is a declared edge no source file makes. Imports of §3c primitives are not edges and are not declared.

A gate step diffs the observed import graph against the declaration, so an undeclared import, a stale declaration and a leaf that gained an edge
each fail. These properties of that walk are load-bearing:

- **Test files are excluded.** Counting them would reclassify most leaves as integration and invent edges into test-fixture namespaces; a fixture
  import is not a layering claim.
- **The §3c exemption is target-only.** An edge _into_ a primitive is exempt; an edge _out of_ one is a violation — §3c's closure, enforced.
- **An edge's kind is the AND across its import sites.** One value import anywhere makes the whole edge a value edge.

<!-- rule:namespace-design-type-edge --> It cannot create a runtime cycle (§2), but a rename breaks it, and a namespace whose every edge is
type-only is integration all the same.

**A type-only edge is what lets two namespaces name each other**: the pair is legal exactly while one direction stays type-only, since a value
import closes a real cycle.

### 3c. Foundational Primitives

A small, **closed** set of namespaces sits below the leaf/integration split: any namespace may import them without that import counting as a
layering violation.

**The test for membership is arithmetic, not taste: how many namespaces reach for it independently.** Declaring a dozen edges instead would imply a
choice each consumer made, and none of them did.

<!-- rule:namespace-design-closed-primitives --> That is the property to re-check before admitting a member: a primitive that imported a leaf would
put every consumer of the primitive behind that leaf.

### 3d. A Directory Is a Namespace Only With a Subpath

<!-- rule:namespace-design-subpath-namespace --> A subdirectory with no export entry is part of its parent namespace, and its imports are the
_parent's_ edges. Classifying by directory reports namespaces the package does not have and edges nobody can import.

### 3e. Duplication Across a Leaf Boundary

**Duplicated markup or constants across a leaf boundary are an accepted cost, not an oversight**, where sharing a literal would add an edge the
graph rejects.

The test is what the copies couple to: two class strings resolving through one design token drift only in appearance, but copies that encode a
_behaviour_ get a declared edge instead.

---

## 4. Exported Symbol Naming Convention

### 4a. Factory and Accessor Verbs

`CODE_RULES.md` §1d owns the verbs — `create*` for a factory, `resolve*` for a request-time accessor, `define*` for a declarative
configuration object. This section adds only the exception class a layered namespace tree needs.

Value constructors are the one documented class of exception — a pair like `ok` / `err` builds values rather than configured objects, and prefixing
them would make every call site worse. An exception is documented in [`ERROR_HANDLING.md`][eh-1a] §1a or in the owning `docs/` doc; an undocumented
one is a defect.

### 4b. Option and Shape Type Suffixes

Exported option and shape types take a suffix chosen by what the type _is_:

| Suffix | Meaning | Examples |
| --- | --- | --- |
| `*Config` | Validated or resolved **data shape**, typically schema-backed | `MailerConfig`, `CacheConfig` |
| `*Options` | **Behaviour configuration** passed to a factory or middleware | `RetryOptions`, `CompressionOptions` |
| `*Definition` | **Declarative handler or component shape** consumed by a builder | `EndpointDefinition`, `WidgetDefinition` |
| `*Descriptor` / `*Def` | Fine-grained declarative **member shapes** within a definition | `ColumnDescriptor`, `SlotDef` |

<!-- rule:namespace-design-behaviour-suffix --> `*Config` implies validated env or data, so a wrong suffix misleads a caller in a way the type
system cannot catch.

---

## 5. When to Add a New Namespace

### 5a. Criteria for a New Namespace

Add one when **all** hold:

- The feature crosses runtime concerns and is reusable across applications.
- It is large enough — more than about three files — to warrant its own barrel.
- An existing namespace would _become_ an integration namespace if the feature were added to it.
- Its concern is bounded enough to describe in five words.

The third test decides most cases: a feature that would turn a leaf into an integration namespace does not belong in that leaf.

### 5b. Checklist Before Merge

- [ ] Reusable across multiple applications — otherwise it stays in application code
- [ ] Uses only Web APIs ([`LIBRARY_ARCHITECTURE.md`][la-1d] §1d)
- [ ] Has independent, co-located tests ([`TESTING.md`][testing-2a] §2a)
- [ ] Barrel written with named exports only (§1a)
- [ ] Added to `package.json` `exports`, or registered on the sealed-internal allowlist
- [ ] Classified leaf or integration in the graph config, with every edge declared (§3a, §3b)
- [ ] The export and graph gate steps pass
- [ ] Any governing document it gains is reachable by search — no register lists it (`AGENT_GUIDE.md` §1)

### 5c. Extraction Triggers

A namespace has outgrown its concern when a **countable** threshold is crossed, and the threshold is written down before it is reached. These shapes
recur:

- **A third variant of a builder or client family** — two is a pair, three is a category, and a category deserves its own namespace.
- **A component or symbol count** past which the barrel stops being scannable; introduce sub-barrels while keeping the export path stable.

**A trigger counts published entry points, not modules**: factoring a shared sequence out of two builders leaves the count at two. An ambiguous
trigger means the threshold was stated in the wrong unit — fix the threshold rather than arguing the instance.

[cr]: ../shared/CODE_RULES.md
[eh-1a]: ./ERROR_HANDLING.md#1a-the-unified-result-primitive
[la]: ./LIBRARY_ARCHITECTURE.md
[la-1d]: ./LIBRARY_ARCHITECTURE.md#1d-web-apis-only-constraint
[testing-2a]: ./TESTING.md#2a-which-files-get-a-test-and-the-naming-convention
