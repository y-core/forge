---
title: Library Architecture
description: facade over dependencies, runtime-only library, demand composition, Web-APIs-only, leaf namespace, integration namespace, dependency tiers, no build step, Cloudflare Workers, fetch-router, valibot, @remix-run
weight: 12
---

# Library Architecture

> Authoritative source for @y-core/forge's structural principles: how it is layered,
> why it ships raw TypeScript, how namespaces are composed, and what constraints ensure
> it stays portable across Workers runtimes.
>
> Complements [NAMESPACE_DESIGN.md](./NAMESPACE_DESIGN.md) (barrel rules, export catalog),
> [PRODUCTION_TS_RULES.md](./PRODUCTION_TS_RULES.md) (coding rules), and
> [TESTING.md](./TESTING.md) (test discipline).

---

## 0. Quick Reference

- §1 Core principles: facade, runtime-only, demand composition, Web-APIs-only
- §2 Namespace dependency tiers: leaf vs integration, what each means
- §3 Runtime-only constraint: no build step, why raw TS ships
- §4 Facade pattern: wrapping fetch-router, valibot, @remix-run behind forge exports
- §5 Demand composition: single-purpose namespaces, consumers assemble what they need
- §6 Workers runtime model: V8 isolate, no Node.js APIs, global scope constraints
- §7 Review checklist: architecture compliance items

---

## 1. Core Architectural Principles

### 1a. Facade Over Dependencies Pattern

Forge wraps its external dependencies behind its own export map. Consumers import from
`@y-core/forge/{namespace}`, never from `@remix-run/*`, `valibot`, or other deps directly.

Wrapped dependencies:

- `@remix-run/fetch-router` → `@y-core/forge/router` (`route`, `createController`, `Middleware`,
  `RequestContext`) and `@y-core/forge/app` (the `createApp` factory / `Forge` app object)
- forge's own SSR JSX runtime → `@y-core/forge/jsx` (`createRemixElement`, `Fragment`),
  `@y-core/forge/jsx-runtime` (transform target), and `@y-core/forge/render` (`renderToString`)
- `valibot` → `@y-core/forge/validation` (`v` namespace + `ValidationResult`)
- `@remix-run/headers` + `@remix-run/html-template` → `@y-core/forge/http` (`CacheControl`,
  `ContentType`, `SetCookie`, `html`, `rawHtml`, etc.)
- `@remix-run/cookie`, `@remix-run/session` → `@y-core/forge/session`
- `htmx.org` → `@y-core/forge/ui/client/htmx` (side-effect import)

Benefits: version bumps and API changes are isolated to forge; consumers are insulated.

### 1b. Runtime-Only Library Constraint

Forge ships raw TypeScript source with no compilation step. `package.json` `"exports"` map
points directly to `src/{namespace}/mod.ts`. This means:

- No `dist/` directory
- No `tsc` build in CI
- Consumers' bundler (`esbuild`/`wrangler`) compiles forge source inline
- Runtime is always Web APIs (no Node.js, no Bun-specific APIs)

### 1c. Demand Composition Principle

Each namespace is single-purpose. An app importing only `@y-core/forge/security` gets
exactly the transport hardening code — nothing else. There is no `forge/all` mega-import.
Consumers assemble the namespaces they actually use.

### 1d. Web-APIs-Only Constraint

Source files must only use APIs available in the Web Platform standard:

- `fetch`, `Request`, `Response`, `Headers`, `URL`, `URLSearchParams`
- `crypto.subtle` (Web Crypto API) — used in `form/csrf` and `security`
- `TextEncoder`, `TextDecoder`
- `ReadableStream`, `WritableStream`

Never: `process.env`, `require()`, `Bun.file()`, Node.js `fs`/`path`/`crypto` modules.

---

## 2. Namespace Dependency Tiers

### 2a. Leaf Namespaces — Zero Cross-Namespace Dependencies

These namespaces import only from their own `src/{name}/` directory, external npm deps,
and Web APIs. They can be imported by anyone without pulling in other forge namespaces.

Current leaf namespaces:

```
assets/build, assets/manifest, cli, config, form, http, jsx, logging,
result, router, session, ui/client, validation
```

### 2b. Integration Namespaces — Compose Across Namespaces

These namespaces import from multiple other forge namespaces. They are higher-level
composition points.

| Namespace | Imports from |
|---|---|
| `app` | `form`, `http`, `logging`, `result`, `router`, `security`, `validation` |
| `assets` | `validation` (schema and type definitions in `config.ts` / `types.ts`) |
| `security` | `logging` (createLogger for rate-limit internals) |
| `ui` (ui/core) | `form` (CSRF/honeypot field name constants) |
| `logging/http` | `logging`, `http`, `ui` (for LogTable, LogFilterBar JSX) |
| `pkg` | `cli` |

### 2c. Internal Namespaces — No Public Export Path

These directories exist in `src/` but have NO entry in `package.json` `"exports"`:

| Directory | Content | Used by |
|---|---|---|
| `src/context/` | `contextVar` accessor for `RequestContext` variables | `security`, `form` |
| `src/crypto/` | HMAC/timing-safe/base64url utilities (`@internal`) | `form`, `security`, `session` |

Never import these from outside forge. They have no stability guarantee.

---

## 3. Runtime-Only Library Constraints

### 3a. No Build Step in the Check Gate

`bun run check` = `typecheck(tsgo)` + `lint(biome)` + `test(bun test)` + `validate-exports`.

There is no `bun run build` in the check gate. The library is always consumed as raw TS.
Any file that cannot be consumed directly by `esbuild` is a build failure by definition.

### 3b. TypeScript Configuration Constraints

- `"types": []` in `tsconfig` — no `@types/*` auto-inclusion
- Source files: `ES2025` + `DOM` + `DOM.Iterable` (standard Web APIs only)
- Test files: above + `bun:test` (via custom stub at `types/bun-test/index.d.ts`)
- Do NOT install `bun-types` — it overrides DOM's `fetch` type with Bun-specific properties

### 3c. Peer Dependencies for Build Tools

`esbuild` is a `peerDependency` (optional) for the `assets/build` pipeline. `sharp` is a
`peerDependency` (optional) for image processing in build. Neither is in the main
dependency tree — only apps that use asset building need them.

---

## 4. Facade Pattern Implementation

### 4a. Re-export Rules for Facade Namespaces

When a facade namespace (like `validation` or `session`) wraps a third-party package:

- Export ONLY what consumers actually need
- Never re-export the entire third-party package namespace
- Name exports consistently with forge conventions (no re-exporting third-party naming quirks)

Example of correct facade exposure in `src/validation/mod.ts`:

    export type { ValidationResult } from "./validation"
    export { v } from "./validation"

This exposes exactly two symbols: `v` (the valibot namespace) and the `ValidationResult<T>`
type — never the raw `valibot` surface. Not:

    export * from "valibot"   // WRONG — exposes entire valibot surface

### 4b. Breaking the Facade

If consumers need a third-party feature not yet exposed by the forge facade:

1. Add the export to the appropriate namespace `mod.ts`
2. Run `bun run check` (validate-exports gate must pass)
3. Never reach into `node_modules` directly from app code

---

## 5. Demand Composition in Practice

### 5a. Namespace Assembly Pattern in Apps

Apps (like `forge-starter`) compose forge namespaces they need:

    import { createApp, applyAssets } from "@y-core/forge/app"
    import { route, createController } from "@y-core/forge/router"
    import { makeSecurityHeaders } from "@y-core/forge/security"
    import { requestLogger } from "@y-core/forge/logging"

Each import is a separate namespace. No single barrel pulls them all in together.
Tree-shaking operates at namespace granularity — unused namespaces are never bundled.

### 5b. No Namespace Aggregators

There is no `@y-core/forge/all` or root `index.ts` that re-exports everything. This
prevents tree-shaking failures and keeps dependency graphs explicit and auditable.
An app that imports only `@y-core/forge/security` has zero bytes of router or form code
in its bundle.

---

## 6. Cloudflare Workers Runtime Model

### 6a. V8 Isolate Execution Context

Each request runs in a V8 isolate. Module-level state is isolated per isolate instantiation.
There is no shared memory between requests, no goroutine-style worker pools, and no
persistent in-process cache across isolate lifetimes.

### 6b. Global Scope Constraints

Module-level initialization must not:

- Open network connections
- Read environment variables (use Bindings via `c.env` in handlers)
- Store mutable request-scoped state in module-level variables

Factory functions (`createApp`, `createD1Client`, `createKVStore`) are the safe pattern.
They capture bindings at request time, not at module evaluation time.

### 6c. ctx.waitUntil for Fire-and-Forget Operations

For operations that should outlive the response (logging, analytics, cache warming):

    c.executionCtx.waitUntil(logToKV(...))

Never use unguarded async side effects that could be killed mid-flight when the response
stream closes. `waitUntil` extends the isolate lifetime until the promise settles.

---

## 7. Architecture Review Checklist

Before merging changes to forge, verify each item:

- [ ] New code uses only Web APIs (no Node.js, no Bun-specific APIs)
- [ ] New namespace classified as leaf or integration (no undeclared cross-namespace deps)
- [ ] Internal utilities placed in `context/` or `crypto/` with `@internal` JSDoc tag
- [ ] All new exports added to namespace `mod.ts` barrel
- [ ] `bun run check` passes (typecheck + lint + test + validate-exports)
- [ ] No module-level mutable state that is request-scoped
- [ ] Facade exports only what consumers need (no full re-export of third-party package)
