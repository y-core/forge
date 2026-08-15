---
title: Library Architecture
description: "Structural principles: the dependency facade, the runtime-only no-build-step constraint, demand composition, Web-APIs-only, and the isolate model."
---

# Library Architecture

> Owns the library's structural principles — how it is layered, why it ships raw TypeScript, and
> the constraints that keep it portable across Workers runtimes.
>
> Defers to: [`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §3 for the leaf/integration
> classification; [`PRODUCTION_TS_RULES.md`](./PRODUCTION_TS_RULES.md) for the coding rules;
> [`BOUNDARIES.md`](./BOUNDARIES.md) for the runtime and layering boundaries; `tsconfig.json`
> for the compiler configuration.

---

## 0. Quick Reference

- §1 Core Architectural Principles: the five structural commitments
- §1a Facade Over Dependencies: what the library wraps, and why
- §1b Runtime-Only Library Constraint: raw TypeScript, no build step
- §1c Demand Composition Principle: single-purpose namespaces
- §1d Web-APIs-Only Constraint: the permitted runtime surface
- §1e The Build-Time Exemption Is Reachability: why a path glob is evidence, not the rule
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

**The library wraps every external dependency behind its own export map.** Consumers import from
a library subpath — never from a wrapped package directly.

The benefit is containment: **a dependency's version bump or API change is absorbed inside the
library**, and every consumer is insulated from it. A consumer that reaches past the facade has
taken on a coupling the library exists to hold on its behalf, and it will not follow the next
upgrade.

**Not every namespace is a facade.** An in-house runtime — a renderer, a validation pipeline, a
component set — wraps nothing and is not judged by this rule. The repository's namespace catalog
records which is which; naming the dependency each facade covers is implementation, because
those names change.

### 1b. Runtime-Only Library Constraint

**The library ships raw TypeScript with no compilation step.** The `exports` map points directly
at source barrels.

- No `dist/` directory and no compile step in CI.
- The consumer's bundler compiles library source inline.
- **Any file that cannot be consumed directly by the consumer's bundler is a build failure by
  definition.**

This is the constraint that makes most of the others load-bearing: there is no build stage in
which a non-portable API could be polyfilled away.

### 1c. Demand Composition Principle

**Each namespace is single-purpose.** An app importing one namespace gets exactly that concern
and nothing else. Consumers assemble what they use; the library never assembles it for them.

### 1d. Web-APIs-Only Constraint

**Runtime source files may use only Web Platform APIs**: `fetch`, `Request`, `Response`,
`Headers`, `URL`, `URLSearchParams`, `crypto.subtle`, `TextEncoder` / `TextDecoder`,
`ReadableStream` / `WritableStream`.

**Never `process.env`, `require()`, runtime-specific globals, or a Node.js built-in**
(`node:fs`, `node:path`, `node:crypto`) in a runtime source file.

**Build-time and release tooling is exempt** — it runs on a developer's machine or in CI, never
inside a Worker.

### 1e. The Build-Time Exemption Is Reachability

**A module qualifies for the §1d exemption when no Worker-executed entry point reaches it. A
path is evidence of that; it is never the rule itself.**

Where a namespace's surface is mixed, the exemption reaches its build-time modules alone, and
**the burden sits on the caller**: such a helper is imported from a config file or a script,
never from a Worker-executed path. A namespace a Worker does execute is never exempt, however
tooling-shaped it looks.

Stating the exemption as reachability rather than as a directory list is what keeps it from
growing: a new glob is cheap to add and impossible to audit, whereas "does a Worker reach this"
has one answer per module.

---

## 2. Namespace Dependency Tiers

[`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §3 owns the leaf/integration classification, the
foundational primitives below it, and their enforcement.
**Classify before adding code; never introduce an undeclared cross-namespace dependency.**

---

## 3. Consequences of Shipping Source

### 3a. No Build Step in the Gate

**There is no build step in the verification gate** — the library is always consumed as raw
source. [`TESTING.md`](./TESTING.md) §6 owns the gate.

### 3b. TypeScript Configuration Constraints

`tsconfig.json` is the source of truth. One decision is load-bearing and easy to undo by
accident: **no ambient type packages are auto-included**, because every added `@types/*` widens
what source files believe the runtime offers, which is the exact belief §1d exists to constrain.

The hard ban on a runtime-specific type package, and the hand-written stub that replaces it, are
owned by [`TESTING.md`](./TESTING.md) §1b.

### 3c. Optional Peer Dependencies for Build Tools

Tools used only by the asset or release pipeline are **optional peer dependencies**. None is in
the main dependency tree, none is imported by runtime source, and none reaches a Worker bundle.

**A tool the pipeline shells out to is a peer dependency, declared.** An undeclared requirement
does not stop being a requirement — it only stops being checked, and the symptom is a
`command not found` in the middle of a build where the package manager should have warned.
Spawning a binary and importing a module are one category for this purpose.

### 3d. Asset Scanning Stops at the Component Tier

**A CSS scanner never scans `node_modules`.** Shipping raw source therefore does not ship
*rules* — a consumer's build sees the library's markup only if something tells its scanner where
to look, and a class with no rule renders as an attribute that does nothing.

The library's own stylesheet answers that for components, carrying source paths written
**relative to itself** so they resolve wherever the package landed — under a workspace, a git
dependency, or a nested install alike. A consumer-side path would have to hardcode an install
layout and would be wrong under most of them.

**The scope stops at the component tier, and that is a decision rather than the reach of a
relative path.** A component library owes its consumers the classes its own components emit —
importing the component namespace *is* the statement that they will be rendered. A namespace
whose markup is opt-in owes something different: whether an app mounts that surface is the
app's call, so what it owes is a **documented scanning requirement in that namespace's
README**, and the app declares it.

---

## 4. Facade Pattern Implementation

### 4a. Re-export Rules for Facade Namespaces

When a namespace wraps a third-party package:

- **Export only what consumers actually need.**
- **Never re-export the entire third-party namespace.**
- **Name exports by the library's own convention**, not the third party's naming quirks.
- **Never leak a third-party type into a library signature** where a library-owned type would
  do — a leaked type re-couples every consumer to the package the facade was hiding.

### 4b. Thin Pass-Through Facades

A facade may legitimately be a near-verbatim re-export with little or no authored surface, where
the wrapped package's API is already the right one and the value of the facade is the *import
path* rather than the adaptation.

**A thin facade still obeys the rule**: consumers import it through the library subpath, never
from the wrapped package. What makes it a facade is that the coupling has exactly one site.

### 4c. Breaking the Facade

When a consumer needs a third-party feature the facade does not yet expose:

1. Add the export to the appropriate namespace barrel.
2. Run the gate — export validation must pass.

**Never reach into `node_modules` directly from application code.** A local workaround that
bypasses the facade is a fork of the facade with no owner.

---

## 5. Demand Composition in Practice

### 5a. Namespace Assembly in Apps

Apps compose the namespaces they need, one import per namespace, each from that namespace's own
published subpath.

**No single barrel pulls them all in.** Tree-shaking operates at namespace granularity, so an
unused namespace is never bundled.

### 5b. No Namespace Aggregators

**There is no all-in-one subpath and no root index that re-exports everything.** An aggregator
would defeat tree-shaking and make the dependency graph unauditable — every consumer would
appear to depend on every namespace, and no reviewer could tell which edges were real.

---

## 6. Cloudflare Workers Runtime Model

Each request runs in a V8 isolate. There is no shared memory between requests and no persistent
in-process cache across isolate lifetimes.

**Module-level initialization must not:**

- open network connections,
- read environment variables — bindings arrive on the request context in handlers,
- store request-scoped mutable state
  ([`PRODUCTION_TS_RULES.md`](./PRODUCTION_TS_RULES.md) §1a).

**Use the execution context's `waitUntil(p)` for work that must outlive the response** —
logging, analytics, cache warming. An unguarded async side effect can be killed mid-flight when
the response stream closes; `waitUntil` extends the isolate lifetime until the promise settles.

**The promise handed to `waitUntil` must cover every piece of work the function started**, not
only the headline one. A detached `void work().catch(…)` branch is untracked, so the isolate may
suspend before it settles — a probabilistic cleanup pass detached from its write promise is the
canonical way this ships silently and fails under load.
