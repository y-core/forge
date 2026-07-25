---
title: Library Architecture
description: "Structural principles: the dependency facade, the runtime-only no-build-step constraint, demand composition, and the Web-APIs-only rule."
---

# Library Architecture

> Owns forge's structural principles — how it is layered, why it ships raw TypeScript, and the
> constraints that keep it portable across Workers runtimes.
>
> Defers to: [`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §4 for the leaf/integration
> classification and the namespace catalog; [`PRODUCTION_TS_RULES.md`](./PRODUCTION_TS_RULES.md)
> for the coding rules; `tsconfig.json` for the compiler configuration.

---

## 0. Quick Reference

- §1 Core Architectural Principles: the four structural commitments
- §1a Facade Over Dependencies Pattern: what forge wraps, and why
- §1b Runtime-Only Library Constraint: raw TypeScript, no build step
- §1c Demand Composition Principle: single-purpose namespaces
- §1d Web-APIs-Only Constraint: the permitted runtime surface
- §2 Namespace Dependency Tiers: pointer to the owning classification
- §3 Runtime-Only Library Constraints: what shipping raw TS requires
- §3a No Build Step in the Gate: the library is always consumed as source
- §3b TypeScript Configuration Constraints: what source and test files see
- §3c Peer Dependencies for Build Tools: esbuild and sharp are optional
- §4 Facade Pattern Implementation: how a facade namespace is written
- §4a Re-export Rules for Facade Namespaces: expose what consumers need
- §4b Breaking the Facade: the sanctioned way to add an export
- §5 Demand Composition in Practice: assembly at the consumer
- §5a Namespace Assembly Pattern in Apps: one import per namespace
- §5b No Namespace Aggregators: why there is no `forge/all`
- §6 Cloudflare Workers Runtime Model: the module-scope constraints

---

## 1. Core Architectural Principles

### 1a. Facade Over Dependencies Pattern

**Forge wraps its external dependencies behind its own export map.** Consumers import from
`@y-core/forge/{namespace}` — never from `@remix-run/*`, `valibot`, or any other dependency
directly.

| Dependency | Exposed as |
|---|---|
| `@remix-run/fetch-router`, `@remix-run/route-pattern` | `@y-core/forge/router`, `@y-core/forge/app` |
| `valibot` | `@y-core/forge/validation` (`v` + `ValidationResult`) |
| `@remix-run/headers`, `@remix-run/html-template` | `@y-core/forge/http` |
| `@remix-run/cookie`, `@remix-run/session` | `@y-core/forge/session` |
| `htmx.org` | `@y-core/forge/ui/client/htmx` (side-effect import) |

**`jsx` is not a facade** — it is forge's own in-house SSR runtime, exposed at
`@y-core/forge/jsx` and `@y-core/forge/jsx/jsx-runtime`. It composes `http` for escaping and
`SafeHtml`, which is why it classifies as integration.

The benefit is containment: **a dependency's version bump or API change is absorbed inside
forge**, and consumers are insulated.

### 1b. Runtime-Only Library Constraint

**Forge ships raw TypeScript with no compilation step.** The `exports` map points directly at
`src/{namespace}/mod.ts`.

- No `dist/` directory and no `tsc` build in CI.
- The consumer's bundler (esbuild / wrangler) compiles forge source inline.
- **Any file that cannot be consumed directly by esbuild is a build failure by definition.**

### 1c. Demand Composition Principle

**Each namespace is single-purpose.** An app importing only `@y-core/forge/security` gets
exactly the transport hardening code and nothing else. Consumers assemble what they use.

### 1d. Web-APIs-Only Constraint

**Source files may use only Web Platform APIs**: `fetch`, `Request`, `Response`, `Headers`,
`URL`, `URLSearchParams`, `crypto.subtle`, `TextEncoder` / `TextDecoder`, `ReadableStream` /
`WritableStream`.

**Never `process.env`, `require()`, `Bun.*`, or a Node.js built-in** (`node:fs`, `node:path`,
`node:crypto`) in a source file.

Build-time tooling under `src/**/cli/**` and `scripts/` is exempt — it runs on the developer's
machine, never in a Worker.

---

## 2. Namespace Dependency Tiers

Every namespace is either **leaf** (zero cross-namespace forge imports) or **integration**
(declared composition across namespaces), with `result` and `crypto` sitting below the split as
foundational primitives that anyone may import.

[`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §4 owns the classification and the current
membership of each tier. **Classify before adding code; never introduce an undeclared
cross-namespace dependency.**

---

## 3. Runtime-Only Library Constraints

### 3a. No Build Step in the Gate

**There is no build step in `bun run check`** — the library is always consumed as raw TS.
[`TESTING.md`](./TESTING.md) §6 owns the gate.

### 3b. TypeScript Configuration Constraints

`tsconfig.json` is the source of truth; the load-bearing decisions are:

- **`"types": []`** — no `@types/*` is auto-included.
- **Source files see `ESNext` + `DOM` + `DOM.Iterable`** — standard Web APIs only.
- **Test files additionally see `bun:test`**, via the hand-written stub at
  `.types/bun-test.d.ts`.

**Do NOT install `bun-types`** — it overrides DOM's `fetch` type with Bun-specific properties.
[`TESTING.md`](./TESTING.md) §1b owns that rule.

### 3c. Peer Dependencies for Build Tools

`esbuild` and `sharp` are **optional peer dependencies** for the `assets/build` pipeline.
Neither is in the main dependency tree — only apps that build assets need them.

---

## 4. Facade Pattern Implementation

### 4a. Re-export Rules for Facade Namespaces

When a namespace wraps a third-party package:

- **Export only what consumers actually need.**
- **Never re-export the entire third-party namespace.**
- **Name exports by forge convention**, not the third party's naming quirks.

`src/validation/mod.ts` exposes exactly two symbols — `v` and the `ValidationResult` type —
never the raw valibot surface.

Two facades are deliberately **thin pass-throughs** whose forge-authored surface is minimal:

- **`router`** re-exports the fetch-router and route-pattern engine verbatim; its only
  forge-authored surface is the `routePaths` / `RouteFilter` introspection pair.
- **`http/headers`** is a **pure re-export** of `@remix-run/headers` — the typed header classes
  and their `*Init` types, with no forge-authored logic.

**Both still obey the facade rule**: consumers import from `@y-core/forge/{router,http}`, never
from `@remix-run/*`.

### 4b. Breaking the Facade

When a consumer needs a third-party feature the facade does not yet expose:

1. Add the export to the appropriate namespace `mod.ts`.
2. Run the gate — `validate-exports` must pass.

**Never reach into `node_modules` directly from app code.**

---

## 5. Demand Composition in Practice

### 5a. Namespace Assembly Pattern in Apps

Apps compose the namespaces they need, one import per namespace:

```typescript
import { createApp, applyAssets } from "@y-core/forge/app"
import { route, createController } from "@y-core/forge/router"
import { createSecurityHeaders } from "@y-core/forge/security"
```

**No single barrel pulls them all in.** Tree-shaking operates at namespace granularity, so an
unused namespace is never bundled.

### 5b. No Namespace Aggregators

**There is no `@y-core/forge/all` and no root `index.ts` that re-exports everything.** An
aggregator would defeat tree-shaking and make the dependency graph unauditable. An app importing
only `@y-core/forge/security` carries zero bytes of router or form code.

---

## 6. Cloudflare Workers Runtime Model

Each request runs in a V8 isolate. There is no shared memory between requests and no persistent
in-process cache across isolate lifetimes.

**Module-level initialization must not:**

- open network connections,
- read environment variables — bindings arrive via `c.env` in handlers,
- store request-scoped mutable state ([`PRODUCTION_TS_RULES.md`](./PRODUCTION_TS_RULES.md) §1a).

**Use `c.executionCtx.waitUntil(p)` for work that must outlive the response** — logging,
analytics, cache warming. An unguarded async side effect can be killed mid-flight when the
response stream closes; `waitUntil` extends the isolate lifetime until the promise settles.

Runtime background and worked examples are in `src/app/README.md`.
