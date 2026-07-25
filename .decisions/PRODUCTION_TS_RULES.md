---
title: Production TypeScript Rules
description: "Six non-negotiable coding rules: zero global state, explicit errors, validation first, testability, TSDoc, and declarative style."
---

# Production TypeScript Rules

> Six non-negotiable rules for all TypeScript in forge, ensuring the library stays testable,
> predictable, and safe in the Cloudflare Workers runtime.
>
> Defers to: [`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §1 for the `Result` primitive;
> [`TESTING.md`](./TESTING.md) for test placement and fake patterns;
> [`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §5e for the naming convention;
> [`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md) for the structural constraints these
> rules serve.

---

## 0. Quick Reference

- §1 Zero Global State Rule: request state never lives at module scope
- §1a No Module-Level Mutable Variables: why isolates make this unsafe
- §1b Factory Function Pattern: capture config, not request state
- §1c Constants Are Acceptable: the permitted module-level form
- §1d Factory Naming and Bare Constructors: `create*` / `define*`, and the `Forge` carve-out
- §2 Explicit Errors via Result Monad: return failures, do not throw them
- §2a When to Throw vs Return Result: the three-way split
- §3 Validation First Rule: untrusted input stops at the boundary
- §3a Validate at System Boundaries: the handler and the config loader
- §3b Valibot v Facade: never import valibot directly
- §3c Abort-Early Validation: form-validation default
- §4 Testability Rule: design so tests need no mocks
- §4a No Globals to Mock: what factory functions buy
- §5 TSDoc on All Exports Rule: the documentation floor
- §5a TSDoc for Public Exports: one line minimum
- §5b @internal for Non-Public Symbols: the visibility marker
- §5c @example for Complex APIs: when usage is non-obvious
- §6 Declarative Over Imperative Rule: expression over statement

---

## 1. Zero Global State Rule

### 1a. No Module-Level Mutable Variables

**Never store request-scoped data in a module-level variable.** Each Workers isolate handles one
request at a time, but isolates are recycled — module-level mutations bleed between requests
sharing a module instance.

```typescript
let currentUser: User | null = null   // never do this
```

**Inject state as factory parameters, or read it from the request context** (`c.env`, a
`contextVar` accessor).

### 1b. Factory Function Pattern

**Use a factory to create stateful behaviour.** The factory captures configuration — immutable
after creation — never request state.

```typescript
export function createSecurityHeaders(options: SecurityHeadersOptions): Middleware {
  // `options` captured once at creation time
  return async (c, next) => next()   // request-scoped work uses `c`
}
```

### 1c. Constants Are Acceptable

Module-level **immutable** constants are fine:

```typescript
export const CSRF_FIELD_DEFAULT = "_csrf"
export const HONEYPOT_FIELD_DEFAULT = "__surname"
```

`src/form/constants.ts` owns these two values — never restate them elsewhere.

### 1d. Factory Naming and Bare Constructors

**Two verbs, one rule each** ([`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §5e owns the full
convention):

- **`define*`** names a **declarative handler config** — `definePage`, `defineAction`.
- **`create*`** names **every other factory** that instantiates behaviour from captured config.

**A class holding configuration exposes a `create*` factory rather than a public constructor.**
Where a class is unavoidable, pair a private `constructor` with a `static create`. The `Config`
holder is the canonical case: its constructor is `private`, and consumers call `createConfig`.

**Carve-out: `Forge` is a public constructor and `new Forge<Env>()` is correct.** It is exported
from `src/app/mod.ts`, and tests instantiate it directly ([`TESTING.md`](./TESTING.md) §5a).
The rule targets *configuration holders* that would otherwise expose partially-initialised
state — not the app object itself, whose constructor takes only an optional logger.

---

## 2. Explicit Errors via Result Monad

**forge has exactly one result primitive, with a single `error` failure field.** Return a
`Result` for expected failures rather than throwing; build values with `ok()` / `err()`; wrap a
throwing call with `result()`.

[`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §1 owns the primitive, its constructors, and the
`GuardResult` / `ValidationResult` domain aliases.

### 2a. When to Throw vs Return Result

- **Throw** — programming errors, missing required bindings at startup, violated invariants.
- **Return `Result`** — expected failures: parse errors, not-found, validation failures.
- **Never** — throw from middleware that is meant to degrade gracefully.

A canonical programming-error throw is `Button` with `asChild`: it merges props onto a single
JSX element child, so a string, fragment, array, or empty child cannot receive them and the
component throws rather than emitting malformed markup.

```tsx
if (asChild && !isValidElement(children)) {
  throw new Error("Button with asChild requires exactly one JSX element child")
}
```

That is a caller bug surfaced at render time — not an expected runtime failure — so a throw is
correct, where a parse or validation failure would return a `Result`.

---

## 3. Validation First Rule

### 3a. Validate at System Boundaries

**Validate all untrusted input — form data, request params, env vars — before it enters
business logic.** The boundary is the handler or the config loader.
[`INPUT_VALIDATION.md`](./INPUT_VALIDATION.md) §6 owns the ordered pipeline.

### 3b. Valibot v Facade

**All validation uses the `v` namespace from `@y-core/forge/validation`. Never import `valibot`
directly** — not in app code, not in a forge namespace.

```typescript
import { v } from "@y-core/forge/validation"
const Schema = v.object({ name: v.string(), email: v.pipe(v.string(), v.email()) })
```

### 3c. Abort-Early Validation

**Use `{ abortEarly: true }` in `v.safeParse` for form validation** so the first failing field
is reported immediately. Omit it when a response must enumerate every error.

---

## 4. Testability Rule

**Every source file has a co-located test file, and dependencies are faked rather than mocked.**
[`TESTING.md`](./TESTING.md) §2 and §4 own both rules.

### 4a. No Globals to Mock

Because forge uses factory functions and Web-standard APIs, **tests call functions directly
without mocking global state**. A function that cannot be tested without a mock is a design
signal: make its dependency an argument.

---

## 5. TSDoc on All Exports Rule

### 5a. TSDoc for Public Exports

**Every exported function, type, and constant carries at minimum a one-line TSDoc.**

```typescript
/** Creates a Forge app with a structured error boundary and config validation. */
export function createApp<Bindings extends object = Record<string, unknown>>(
  options?: AppOptions<Bindings>,
): Forge<Bindings>
```

### 5b. `@internal` for Non-Public Symbols

**Internal utilities that are not part of the public API must be marked `@internal`.** The tag
is what keeps a symbol out of the barrel without keeping it out of cross-namespace use.

### 5c. `@example` for Complex APIs

**Add `@example` when the usage pattern is non-obvious** — a builder, a multi-step lifecycle, or
an argument whose shape is not evident from its type.

---

## 6. Declarative Over Imperative Rule

- **Prefer array methods over loops** — `origins.filter(o => o.startsWith("https://"))`, not an
  accumulator loop.
- **Prefer object spread over mutation** — `{ ...defaults, ...overrides }`, not assign-then-patch.
- **Prefer nullish coalescing and optional chaining** — `input ?? fallback`,
  `user?.profile?.displayName`.

The rule is about expressing intent, not about avoiding loops on principle: reach for a loop
when the operation genuinely is sequential or early-exiting.
