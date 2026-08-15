---
title: Namespace Design
description: "Barrel discipline and the export-star ban, the no-sibling-barrel rule, leaf-versus-integration classification, naming conventions, and when to add a namespace."
---

# Namespace Design

> Owns barrel discipline, the import guard that prevents cycles, the leaf/integration
> classification, the exported-symbol naming convention, and the criteria for adding a
> namespace. The repository's own catalog of namespaces lives in `implementation/`.
>
> Defers to: [`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md) for the facade and
> runtime-only principles these rules serve;
> [`PRODUCTION_TS_RULES.md`](./PRODUCTION_TS_RULES.md) for the coding rules inside a namespace;
> `package.json` `exports` for the subpath names themselves.

---

## 0. Quick Reference

- §1 Barrel Rules and Export Discipline: one barrel per namespace, named exports only
- §1a Barrel Convention: the three rules a barrel obeys
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
- §4a Factory and Accessor Verbs: `create*`, `resolve*`, `define*`
- §4b Option and Shape Type Suffixes: `*Config`, `*Options`, `*Definition`, `*Descriptor`
- §5 When to Add a New Namespace: criteria and checklist
- §5a Criteria for a New Namespace: the four tests
- §5b Checklist Before Merge: what must be true
- §5c Extraction Triggers: when an existing namespace has outgrown its concern

---

## 1. Barrel Rules and Export Discipline

### 1a. Barrel Convention

Every namespace has exactly one barrel — a single `mod.ts` at the namespace root — and it is the
only file listed in `package.json` `exports` for that subpath. All public API flows through it.

- **A barrel uses named exports only** — never `export * from …` (§1b).
- **Every new public symbol in the namespace is added to the barrel.**
- **A barrel imports from concrete files, never from another barrel** (§2).

The barrel is the namespace's published surface. It is not a convenience index, and it is not a
place to shorten an import path — those are what a barrel means inside an *application*, and the
inversion is the single most common mistake carried in from app work.

### 1b. Export Star Ban

**`export * from "./foo"` is banned.** It leaks internal symbols into the public surface, risks
circular dependencies, and makes the public API ungreppable — the three harms are independent,
and any one of them is sufficient.

**All three spellings are banned**, not just the bare one:

| Form | Banned | Why |
|---|---|---|
| `export * from "./foo"` | yes | all three harms |
| `export * as ns from "./foo"` | yes | the same leak behind one extra token |
| `export type * from "./foo"` | yes | leaks every internal type, and is equally ungreppable |

The type-only form is erased at emit, so it cannot create a runtime cycle — but two of the three
harms still apply, and a barrel's job is to *state* its surface. Name the types.

### 1c. What the Export Gate Proves

A gate step is the enforcement authority for everything in §1a–§1b, and it proves more than a
reader would check by hand: that each subpath resolves to a real, published file; that no barrel
uses `export *`; that every symbol marked public reaches its barrel; that every barrel in the
source tree is either exported or explicitly sealed; and that every published-files entry exists
on disk.

**Read the check, not this section, for the current rule set.** The check is the source of
truth, and a prose copy of its rules is a second copy that will disagree with it.

**A sealed-internal barrel is legitimate and must be declared.** A namespace with no export
subpath is valid only when it appears on the gate's sealed allowlist — a barrel is valid if it
is exported *or* explicitly sealed, and never merely by existing.

---

## 2. No-Sibling-Barrel Import Rule

### 2a. The Import Guard

**Importing another namespace's barrel from inside the source tree is banned by a lint rule**,
with a small set of named exemptions (§2c). Import the concrete file instead.

### 2b. Why Sibling Barrels Are Forbidden

When one namespace imports another's barrel, any future import in *that* barrel which reaches
back creates a cycle — and the cycle is invisible at both ends, because neither file names the
module that closes it. **Importing the concrete file makes the dependency explicit and
bounded**: it names one module, and a reviewer can see exactly what was taken.

This is the inverse of the rule an application repository would use. Inside a library, the
barrel is the *published surface*, not a convenience; consuming your own published surface from
within is how a namespace ends up depending on its own export map.

### 2c. Granting an Exemption

An exemption is warranted only where the barrel *is* the abstraction — a facade whose whole
point is that every consumer takes the same single symbol from it, or a sealed-internal utility
module several namespaces need.

**Every exemption is a §3c foundational primitive**, and that is not a coincidence: the property
that makes a barrel safe to import everywhere is the same closure property that makes a
namespace a primitive. The repository's `implementation/` docs name the current exemptions; this
section owns only the test for granting one.

---

## 3. Namespace Classification

### 3a. Leaf Namespace Rules

A namespace is **leaf** when it imports only from its own directory, external packages, Web
APIs, and the foundational primitives of §3c — **zero other cross-namespace imports.**

**Which namespaces are leaf is declared in a config file, not in prose.** That file is
authoritative for the graph and the documentation enumerates none of it: a second copy of a
graph is indistinguishable from an amendment the moment the two disagree. What stays in prose is
*why* a classification holds, which is the part prose is better at.

### 3b. Integration Namespace Rules

A namespace is **integration** when it composes across namespaces. **Every edge is declared as
source, target, and kind**; an undeclared cross-namespace import is a defect, and so is a
declared edge no source file makes. Imports of §3c primitives are not edges and are not declared.

A gate step walks the source tree, builds the observed graph, and diffs it against the
declaration, so an undeclared import, a stale declaration, and a leaf that quietly gained an
edge each fail rather than passing unnoticed. Three properties of that walk are load-bearing and
not self-evident:

- **Test files are excluded.** Counting them would reclassify most declared leaves as
  integration and invent edges into test-fixture namespaces no consumer can reach. A fixture
  import is not a layering claim.
- **The §3c exemption is target-only.** An edge *into* a primitive is exempt; an edge *out of*
  one is a reported violation. That is §3c's closure property, enforced rather than trusted.
- **An edge's kind is the AND across its import sites.** One value import anywhere makes the
  whole edge a value edge, so declaring an edge type-only is a claim about every site, not the
  first one a reader happens to open.

**A type-only import still counts as an edge.** It is erased at emit and so cannot create a
runtime cycle (§2), but it is a coupling a rename breaks, so it is declared with its kind rather
than left out. A namespace whose every edge is type-only is integration all the same.

**A type-only edge is what lets two namespaces name each other.** A mutually-naming pair is
legal exactly while one direction stays type-only; flipping it to a value import closes a real
cycle. Kind is therefore a rule, not an annotation.

### 3c. Foundational Primitives

A small, **closed** set of namespaces sits below the leaf/integration split: any namespace may
import them without that import counting as a layering violation.

**The test for membership is arithmetic, not taste: how many namespaces reach for it
independently.** A namespace a dozen others need is a primitive; declaring twelve edges instead
would describe the same graph while implying a choice each consumer made, and none of them did.

**The set must stay closed — no primitive may reach back into a consumer.** Every edge out of a
primitive lands inside the set. That is what makes the carve-out safe, and it is the property to
re-check before admitting a new member: a primitive that imported a leaf would put every
consumer of the primitive behind that leaf.

### 3d. A Directory Is a Namespace Only With a Subpath

**Classify by published subpath, never by directory.** A subdirectory with no export entry is
part of its parent namespace, and its imports are the *parent's* edges.

Classifying by directory reports namespaces the package does not have and edges nobody can
import — a graph that is both larger and less true than the real one.

### 3e. Duplication Across a Leaf Boundary

**Duplicated markup or constants across a leaf boundary are an accepted cost, not an oversight.**
Where sharing a class string or a small literal would add an edge the graph rejects, and would
put every consumer of the lower tier behind the higher one for the sake of that literal, the two
copies are correct.

The test is what the copies actually couple to: two class strings that resolve through the same
design token drift only in appearance, and the coupling that matters lives in the token. Where
the copies encode a *behaviour* rather than a presentation, this argument does not apply and the
edge should be declared.

---

## 4. Exported Symbol Naming Convention

### 4a. Factory and Accessor Verbs

**Three verbs, one rule each:**

- **`create*`** names **any factory** that instantiates behaviour from captured configuration.
  Never `make*`, never `new*`.
- **`resolve*`** names a **request-time accessor** that reads a binding or a value off the
  context and fails closed when it is absent.
- **`define*`** names a **declarative configuration object** consumed by a builder.

Value constructors are the one documented class of exception — a pair like `ok` / `err` builds
values rather than configured objects, and prefixing them would make every call site worse. An
exception is documented in [`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §1a or in the owning
`implementation/` doc; an undocumented one is a defect.

### 4b. Option and Shape Type Suffixes

Exported option and shape types take a suffix chosen by what the type *is*:

| Suffix | Meaning | Examples |
|---|---|---|
| `*Config` | Validated or resolved **data shape**, typically schema-backed | `MailerConfig`, `CacheConfig` |
| `*Options` | **Behaviour configuration** passed to a factory or middleware | `RetryOptions`, `CompressionOptions` |
| `*Definition` | **Declarative handler or component shape** consumed by a builder | `EndpointDefinition`, `WidgetDefinition` |
| `*Descriptor` / `*Def` | Fine-grained declarative **member shapes** within a definition | `ColumnDescriptor`, `SlotDef` |

**A declarative shape must not be named `*Config`** — that suffix implies validated env or data
— and **behaviour knobs must not be named `*Config` or `*Definition`.** The suffix is how a
caller predicts whether a value was validated, and getting it wrong is a documentation defect
that the type system cannot catch.

---

## 5. When to Add a New Namespace

### 5a. Criteria for a New Namespace

Add one when **all** hold:

- The feature crosses runtime concerns and is reusable across applications.
- It is large enough — more than about three files — to warrant its own barrel.
- An existing namespace would *become* an integration namespace if the feature were added to it.
- Its concern is bounded enough to describe in five words.

The third test is the one that decides most cases. A feature that would turn a leaf into an
integration namespace is a feature that does not belong in that leaf.

### 5b. Checklist Before Merge

- [ ] Reusable across multiple applications — otherwise it stays in application code
- [ ] Uses only Web APIs ([`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md) §1d)
- [ ] Has independent, co-located tests ([`TESTING.md`](./TESTING.md) §2a)
- [ ] Barrel written with named exports only (§1a)
- [ ] Added to `package.json` `exports`, or registered on the sealed-internal allowlist
- [ ] Classified leaf or integration in the graph config, with every edge declared (§3a, §3b)
- [ ] The export and graph gate steps pass
- [ ] Registered in the `CLAUDE.md` Guide Index if it gains a governing document
      ([`AGENT_GUIDE.md`](./AGENT_GUIDE.md) §5c)

### 5c. Extraction Triggers

A namespace has outgrown its concern when a **countable** threshold is crossed, and the
threshold is written down before it is reached. Two shapes recur:

- **A third variant of a builder or client family** — two is a pair, three is a category, and a
  category deserves its own namespace.
- **A component or symbol count** past which the barrel stops being scannable; introduce
  sub-barrels while keeping the export path stable.

**A trigger counts published entry points, not modules.** Factoring a shared sequence out of two
builders is an implementation seam and leaves the count at two; it does not fire the rule. Where
the trigger is ambiguous, that ambiguity means the threshold was stated in the wrong unit — fix
the threshold rather than arguing the instance.
