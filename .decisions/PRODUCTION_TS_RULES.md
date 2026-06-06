---
title: Production TypeScript Rules
description: zero global state, factory functions, Result monad, explicit errors, validation first, co-located tests, TSDoc, declarative patterns, Web-APIs-only, testability, no side effects in module scope
weight: 20
---

# Production TypeScript Rules

> Six non-negotiable rules for all TypeScript in forge. These rules ensure the library
> is testable, predictable, and safe in the Cloudflare Workers runtime.
>
> Complements [LIBRARY_ARCHITECTURE.md](./LIBRARY_ARCHITECTURE.md) (structural constraints),
> [NAMESPACE_DESIGN.md](./NAMESPACE_DESIGN.md) (barrel discipline),
> [TESTING.md](./TESTING.md) (test co-location rules).

---

## 0. Quick Reference
- §1 Zero global state: factory/closure injection, no module-level mutable vars
- §2 Explicit errors via Result monad: result/toError pattern, ValidationResult
- §3 Validation first: validate at system boundaries, valibot v facade, abort-early
- §4 Testability: co-located *.test.ts, no globals to mock, fakes over mocks
- §5 TSDoc on all exports: @param, @returns, @example, @internal for non-public
- §6 Declarative over imperative: avoid loops when array methods/conditionals suffice
- §7 Rule summary: quick checklists for each rule

## 1. Zero Global State Rule

### 1a. No Module-Level Mutable Variables
Never store request-scoped data in module-level variables. Each Cloudflare Workers
isolate handles one request at a time, but isolates can be recycled, and module-level
mutations bleed between requests sharing the same module instance.

BAD:
```typescript
let currentUser: User | null = null // module-level mutable — never do this
```

GOOD:
```typescript
// Inject state as factory parameters or read it from the request context
import type { AppContext } from "@y-core/forge/context"
export function createService(config: ServiceConfig) {
  return { handle: (c: AppContext) => { /* use c.env, not module vars */ } }
}
```

### 1b. Factory Function Pattern
Use factory functions to create stateful behavior. The factory captures config
(immutable after creation), not request state.

```typescript
import type { Middleware } from "@y-core/forge/router"
export function makeSecurityHeaders(options: SecurityHeadersOptions): Middleware {
  // options captured at middleware creation time — immutable
  return async (c, next) => {
    // request-scoped work uses c (the RequestContext); return the downstream Response
    return next()
  }
}
```

### 1c. Constants Are Acceptable
Module-level constants (non-mutable) are fine:
```typescript
export const CSRF_FIELD_DEFAULT = "__csrf"
export const HONEYPOT_FIELD_DEFAULT = "__hp"
```

## 2. Explicit Errors via Result Monad

### 2a. Result Type Pattern
For operations that can fail with expected errors, use the Result monad from
@y-core/forge/result rather than throwing exceptions:

```typescript
import { result, type Result } from "@y-core/forge/result"

// result() wraps a throwing function, returning { ok: true; data } | { ok: false; error }.
export function parseUrl(url: string): Result<URL, Error> {
  return result(() => new URL(url))
}
```

### 2b. ValidationResult for Validation Failures
Use ValidationResult (from @y-core/forge/result) for validation operations:

```typescript
import type { ValidationResult } from "@y-core/forge/result"
// ValidationResult<T> = { ok: true; data: T } | { ok: false; errors: string[] }
// Also re-exported from @y-core/forge/validation alongside the `v` namespace.
```

### 2c. When to Throw vs Return Result
- **Throw**: programming errors, missing required bindings at startup, invariants
- **Return Result**: expected failures (parse errors, not-found, validation failures)
- **Never**: throw from middleware that should gracefully degrade

## 3. Validation First Rule

### 3a. Validate at System Boundaries
Validate all untrusted input (form data, request params, env vars) before it enters
business logic. The boundary is the handler or the config loader.

```typescript
import { v } from "@y-core/forge/validation"
import { fragmentResponse } from "@y-core/forge/http"
import { renderValidationErrors } from "@y-core/forge/http"

const result = v.safeParse(MySchema, rawInput, { abortEarly: true })
if (!result.success) {
  const messages = result.issues.map((i) => i.message)
  return fragmentResponse(renderValidationErrors(messages))
}
```

### 3b. Valibot v Facade
All validation uses the v namespace from @y-core/forge/validation (valibot facade).
Never import valibot directly in app code or forge namespaces — always use v.

```typescript
import { v } from "@y-core/forge/validation"
const Schema = v.object({ name: v.string(), email: v.pipe(v.string(), v.email()) })
```

### 3c. Abort-Early Validation
Use { abortEarly: true } in v.safeParse for form validation to stop at first error
and return field-specific errors via renderValidationErrors.

## 4. Testability Rule

### 4a. Co-Located Test Files
Every source file has a co-located test file:
- src/security/headers.ts → src/security/headers.test.ts
- src/form/csrf.ts → src/form/csrf.test.ts

Tests are excluded from npm publish via package.json "files" (`!**/*.test.ts`).

### 4b. No Globals to Mock
Because forge uses factory functions and Web-standard APIs, tests can call functions
directly without mocking global state:

```typescript
import { describe, expect, it } from "bun:test"
import { parseUrl } from "./url"

describe("parseUrl", () => {
  it("returns error for invalid URL", () => {
    const r = parseUrl("not-a-url")
    expect(r.ok).toBe(false)
  })
})
```

### 4c. Fakes Over Mocks
For dependencies, implement the required interface with a fake struct rather than
using mock libraries:

```typescript
const fakeKV: KVNamespace = {
  get: async (key) => null,
  put: async () => {},
  delete: async () => {},
  list: async () => ({ keys: [], list_complete: true, cursor: "" }),
  getWithMetadata: async () => ({ value: null, metadata: null }),
}
```

## 5. TSDoc on All Exports Rule

### 5a. TSDoc for Public Exports
Every exported function, type, and constant needs at minimum a one-line TSDoc:

```typescript
/** Creates a Forge app with a structured error boundary and config validation. */
export function createApp<Bindings extends object = Record<string, unknown>>(
  options?: AppOptions<Bindings>,
): Forge<Bindings>
```

### 5b. @internal for Non-Public Symbols
Internal utilities that are not part of the public API must be marked @internal:

```typescript
/** @internal */
export function timingSafeEqual(a: string, b: string): boolean
```

### 5c. @example for Complex APIs
Add @example when the usage pattern is non-obvious:

```typescript
/**
 * Registers the static-asset catch-all handler onto a Forge app.
 * @example
 * ```typescript
 * applyAssets(app, { notFoundView })
 * ```
 */
export function applyAssets<Bindings extends HasAssets = HasAssets>(
  app: Forge<Bindings>,
  options: AssetOptions<Bindings>,
): void
```

## 6. Declarative Over Imperative Rule

### 6a. Prefer Array Methods Over Loops
```typescript
// GOOD: declarative
const allowed = origins.filter(o => o.startsWith("https://"))

// BAD: imperative loop
const allowed: string[] = []
for (const o of origins) {
  if (o.startsWith("https://")) allowed.push(o)
}
```

### 6b. Prefer Object Spread Over Mutation
```typescript
// GOOD
const merged = { ...defaults, ...overrides }

// BAD
const config = { ...defaults }
config.prop = overrides.prop  // mutation
```

### 6c. Prefer Nullish Coalescing and Optional Chaining
```typescript
const value = input ?? defaultValue       // instead of: input !== null && input !== undefined ? input : defaultValue
const name = user?.profile?.displayName  // instead of: user && user.profile && user.profile.displayName
```

## 7. Rule Summary and Review Checklist

| Rule | Check |
|---|---|
| Zero global state | No module-level mutable vars; factory functions for behavior |
| Explicit errors | Result monad for expected failures; ValidationResult for validation |
| Validation first | v.safeParse at boundaries; abort-early for form validation |
| Testability | Co-located *.test.ts; no globals to mock; fakes not mocks |
| TSDoc | One-line doc on all exports; @internal on non-public; @example where needed |
| Declarative | Array methods, spread, nullish coalescing over imperative loops |
