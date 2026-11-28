---
title: Library Architecture
description: "Structural principles: the dependency facade, the runtime-only no-build-step constraint, demand composition, Web-APIs-only, and the isolate model."
---

# Library Architecture

> Owns the library's structural principles — how it is layered, why it ships raw TypeScript, and the constraints that keep it portable across
> Workers runtimes.
>
> Defers to: [`NAMESPACE_DESIGN.md`][nd-3] §3 for the leaf/integration classification; [`CODE_RULES.md`][cr] for the coding rules;
> [`BOUNDARIES.md`][boundaries] for the runtime and layering boundaries; `tsconfig.json` for the compiler configuration.

---

## 0. Quick Reference

- §1 Core Architectural Principles: the structural commitments
- §1a Facade Over Dependencies: what the library wraps, and why
- §1b Runtime-Only Library Constraint: raw TypeScript, no build step
- §1c Demand Composition Principle: single-purpose namespaces
- §1d Web-APIs-Only Constraint: the permitted runtime surface
- §1e The Build-Time Exemption Is Reachability: why a path glob is evidence, not the rule
- §1f Semantic Tokens Are a Facade Over the Scale: what a published component may resolve
- §2 Namespace Dependency Tiers: pointer to the owning classification
- §3 Consequences of Shipping Source: what raw TypeScript requires
- §3a No Build Step in the Gate: the library is always consumed as source
- §3b TypeScript Configuration Constraints: the ambient-types ban, and where the stub rule lives
- §3c Optional Peer Dependencies for Build Tools: declaring what the pipeline shells out to
- §3d Asset Scanning Stops at the Component Tier: what a consumer's build must be told
- §4 Facade Pattern Implementation: how a facade namespace is written
- §4a Re-export Rules for Facade Namespaces: expose what consumers need
- §4b Thin Pass-Through Facades: minimal surface, unchanged rule
- §4c Breaking the Facade: the sanctioned way to add an export
- §5 Demand Composition in Practice: assembly at the consumer
- §5a Namespace Assembly in Apps: one import per namespace
- §5b No Namespace Aggregators: why there is no all-in-one entry point
- §6 Cloudflare Workers Runtime Model: the module-scope constraints

---

## 1. Core Architectural Principles

### 1a. Facade Over Dependencies

<!-- rule:library-architecture-facade-import --> **The library wraps every external dependency behind its own export map.**

The benefit is containment: **a dependency's version bump or API change is absorbed inside the library**, and a consumer that reaches past the
facade takes on that coupling and will not follow the next upgrade.

**Not every namespace is a facade**: an in-house runtime — a renderer, a validation pipeline, a component set — wraps nothing. Each namespace's
README says whether it is one; which dependency each facade covers is implementation, because those names change.

### 1b. Runtime-Only Library Constraint

**The library ships raw TypeScript with no compilation step.** The `exports` map points directly at source barrels.

- No `dist/` directory and no compile step in CI.
- The consumer's bundler compiles library source inline.
- **Any file that cannot be consumed directly by the consumer's bundler is a build failure by definition.**

This is the constraint that makes most of the others load-bearing: there is no build stage in which a non-portable API could be polyfilled away.

### 1c. Demand Composition Principle

**Each namespace is single-purpose**: an app importing one gets exactly that concern, and consumers assemble what they use.

### 1d. Web-APIs-Only Constraint

**Runtime source files may use only Web Platform APIs**: `fetch`, `Request`, `Response`, `Headers`, `URL`, `URLSearchParams`, `crypto.subtle`,
`TextEncoder` / `TextDecoder`, `ReadableStream` / `WritableStream`.

<!-- rule:library-architecture-web-apis-only --> A Worker supplies none of them natively, so code reaching one passes under a local runtime and
fails, or quietly behaves differently, once deployed.

**Build-time and release tooling is exempt** — it runs on a developer's machine or in CI, never inside a Worker.

### 1e. The Build-Time Exemption Is Reachability

**A module qualifies for the §1d exemption when no Worker-executed entry point reaches it — a path is evidence of that, never the rule itself.**

Where a namespace's surface is mixed, the exemption reaches its build-time modules alone, and **the burden sits on the caller**: such a helper is
imported from a config file or a script, never from a Worker-executed path. A namespace a Worker does execute is never exempt.

Reachability, unlike a directory list, cannot quietly grow: a new glob is cheap to add and impossible to audit, whereas "does a Worker reach this"
has one answer per module.

### 1f. Semantic Tokens Are a Facade Over the Scale

**A published component resolves a semantic token and never a numbered scale step**: the scale is the dependency, and the semantic name is the
library's facade over it (§1a).

That containment is what a retheme is: a consumer swaps the scheme and every component follows, because each asked for a _role_ and never a colour;
one component reaching for a step makes a retheme a component-by-component audit again.

**This constrains the library, not the consumer**: an application composing its own markup may use the published scale directly — that half belongs
to the application governance corpus, and the two halves let one scheme drive a prescriptive component set and an expressive page.

**Which families exist, how many steps each carries, and which step each semantic name resolves to are implementation**, owned by the scheme file.

---

## 2. Namespace Dependency Tiers

[`NAMESPACE_DESIGN.md`][nd-3] §3 owns the leaf/integration classification, the foundational primitives below it, and their enforcement.

<!-- rule:library-architecture-declared-edge --> Classify before adding code: an edge added first and declared afterwards is a layering decision
nobody made.

---

## 3. Consequences of Shipping Source

### 3a. No Build Step in the Gate

**There is no build step in the verification gate** — the library is always consumed as raw source. [`TESTING.md`][testing-6] §6 owns the gate.

### 3b. TypeScript Configuration Constraints

`tsconfig.json` is the source of truth. One decision is load-bearing and easy to undo by accident: **no ambient type packages are auto-included**,
because every added `@types/*` widens what source files believe the runtime offers, which is the exact belief §1d exists to constrain.

The hard ban on a runtime-specific type package, and the hand-written stub that replaces it, are owned by [`TESTING.md`][testing-1b] §1b.

### 3c. Optional Peer Dependencies for Build Tools

Tools used only by the asset or release pipeline are **optional peer dependencies**. None is in the main dependency tree, none is imported by
runtime source, and none reaches a Worker bundle.

**A tool the pipeline shells out to is a peer dependency, declared**, since spawning a binary counts as importing a module: an undeclared
requirement only stops being checked, and surfaces as a `command not found` mid-build.

### 3d. Asset Scanning Stops at the Component Tier

**A CSS scanner never scans `node_modules`**, so a consumer's build sees the library's markup only if something tells its scanner where to look,
and a class with no rule does nothing.

The library's own stylesheet answers that for components, with source paths **relative to itself** so they resolve wherever the package landed; a
consumer-side path would hardcode an install layout.

**The scope stops at the component tier, by decision**: importing the component namespace _is_ the statement that its classes will be rendered. A
namespace whose markup is opt-in is not scanned by default, because mounting it is the app's call; it publishes **its own source declaration**
instead — a stylesheet beside it with paths relative to itself, which the app imports rather than writing a path.

---

## 4. Facade Pattern Implementation

### 4a. Re-export Rules for Facade Namespaces

When a namespace wraps a third-party package:

- **Export only what consumers actually need.**
- <!-- rule:library-architecture-no-namespace-reexport --> A star re-export publishes the third party's surface as the library's own.
- **Name exports by the library's own convention**, not the third party's naming quirks.
- **Never leak a third-party type into a library signature** where a library-owned type would do — a leaked type re-couples every consumer to the
  package the facade was hiding.

### 4b. Thin Pass-Through Facades

A facade may be a near-verbatim re-export where the wrapped API is already right and its value is the _import path_. **A thin facade still obeys the
rule** (§1a): what makes it a facade is that the coupling has exactly one site.

### 4c. Breaking the Facade

When a consumer needs a third-party feature the facade does not yet expose:

1. Add the export to the appropriate namespace barrel.
2. Run the gate — export validation must pass.

<!-- rule:library-architecture-no-node-modules-path --> A local workaround that bypasses the facade is a fork of the facade with no owner.

---

## 5. Demand Composition in Practice

### 5a. Namespace Assembly in Apps

Apps compose the namespaces they need, one import per namespace, each from that namespace's own published subpath.

**No single barrel pulls them all in**, so tree-shaking at namespace granularity never bundles an unused one.

### 5b. No Namespace Aggregators

**There is no all-in-one subpath and no root index that re-exports everything.** An aggregator would defeat tree-shaking and make every consumer
appear to depend on every namespace.

---

## 6. Cloudflare Workers Runtime Model

Each request runs in a V8 isolate. There is no shared memory between requests and no persistent in-process cache across isolate lifetimes.

**Module-level initialization must not:**

- open network connections,
- read environment variables — bindings arrive on the request context in handlers,
- store request-scoped mutable state ([`CODE_RULES.md`][cr-1a] §1a).

**Use the execution context's `waitUntil(p)` for work that must outlive the response** — logging, analytics, cache warming — because an unguarded
async side effect can be killed when the response stream closes.

**The promise handed to `waitUntil` must cover every piece of work the function started**: a detached `void work().catch(…)` branch is untracked,
and the isolate may suspend before it settles.

[boundaries]: ./BOUNDARIES.md
[cr]: ../shared/CODE_RULES.md
[cr-1a]: ../shared/CODE_RULES.md#1a-no-module-level-mutable-variables
[nd-3]: ./NAMESPACE_DESIGN.md#3-namespace-classification
[testing-1b]: ./TESTING.md#1b-no-runtime-specific-type-package
[testing-6]: ./TESTING.md#6-the-verification-gate
