---
title: Error Handling
description: "The one Result primitive, HTTP fragment renderers, the router error boundary, and the fail-closed posture for missing dependencies."
---

# Error Handling

> Owns the `Result` primitive and its two domain aliases, the `http` fragment renderers, the
> router error boundary, and the fail-closed rule. Every other document links here rather than
> restating the primitive.
>
> Defers to: [`INPUT_VALIDATION.md`](./INPUT_VALIDATION.md) for the validation pipeline that
> produces a `ValidationResult`; [`ROUTING_AND_MIDDLEWARE.md`](./ROUTING_AND_MIDDLEWARE.md) for
> where handlers sit in the chain; [`STORAGE_BINDINGS.md`](./STORAGE_BINDINGS.md) for the
> resolver pattern §5e references.

---

## 0. Quick Reference

- §1 Result Monad: the single failure channel and its constructors
- §1a The Unified Result Primitive: `Result<T,E>`, `ok`/`err`, `result`, `toError`
- §1b Narrowing a Result: the `if (!r.ok)` guard and early return
- §1c GuardResult and ValidationResult Aliases: domain shapes that narrow only `E`
- §2 Fragment Renderers: `SafeHtml` in, status on the response
- §2a renderError: single-message failure fragment
- §2b renderSuccess: success banner fragment
- §2c renderValidationErrors: per-field message list fragment
- §2d Fragment Options and Escaping: presentation only; option values are escaped
- §3 htmlResponse, html Tag, and escapeHtml: full-page and raw-string render paths
- §3a htmlResponse: full-page render with a fixed content-type
- §3b html Tagged Template: `SafeHtml` from a raw string fragment
- §3c escapeHtml: manual escaping outside the auto-escaping render paths
- §4 Fail-Closed Posture: missing security dependency means 503
- §4a Fail Closed on Missing Critical Context: never degrade silently
- §4b required false — Non-Security Features Only: the deliberate asymmetry
- §5 Error Taxonomy: expected, unexpected, and infrastructure failures
- §5a Expected Errors: return a Result or a fragment, never throw
- §5b Unexpected Errors and the Router Error Boundary: in-chain vs out-of-chain headers
- §5c Infrastructure Errors: log with context, then fail closed
- §5d defineAction and definePage Error Recovery: the intentional divergence
- §5e Startup Invariants: resolvers throw, operations return Result

---

## 1. Result Monad

### 1a. The Unified `Result` Primitive, `ok`/`err`, `result` and `toError`

forge has exactly **one** result primitive, in `@y-core/forge/result`:

```typescript
import { ok, err, result, toError, type Result } from "@y-core/forge/result"

type Result<T, E = Error> =
    | { ok: true;  data: T }
    | { ok: false; error: E }

function ok(): Result<void, never>          // a passing void check
function ok<T>(data: T): Result<T, never>   // success carrying `data`
function err<E>(error: E): Result<never, E> // failure carrying `error`

function result<T, E = Error>(fn: () => T): Result<T, E>
function result<T, E = Error>(fn: () => Promise<T>): Promise<Result<T, E>>
function result<T, E = Error>(promise: Promise<T>): Promise<Result<T, E>>

function toError(thrown: unknown): Error
```

**Return `Result` from any function that can fail predictably.** Never return `null | T` and
never throw for an expected failure.

**There is exactly one failure field: `error`.** No `errors`, no `reason` — every domain shape
reuses that one channel. Success carries `data`.

**Build values with `ok()` / `err()`, never object literals.** They are the one documented
exception to the `create*` factory-naming rule ([`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md)
§5e): they construct values, not configured objects.

```typescript
function parsePort(raw: string): Result<number, string> {
    const n = Number(raw)
    return Number.isInteger(n) && n > 0 ? ok(n) : err("port must be a positive integer")
}
```

### 1b. Narrowing a Result

**Narrow with a single `if (!r.ok)` guard and return early.** Chaining by early return keeps
the happy path at the left margin; nesting does not.

```typescript
const r = result(() => new URL(input))
if (!r.ok) return new Response(r.error.message, { status: 400 })
const url = r.data  // narrowed to URL — no cast

const remote = await result(fetchRemote(id))
if (!remote.ok) return new Response("Upstream unavailable", { status: 502 })
```

### 1c. `GuardResult` and `ValidationResult` Domain Aliases

Both are plain aliases of §1a that narrow only the failure type `E`. The discriminant stays
`ok`; the failure channel stays `error`.

```typescript
import type { GuardResult, ValidationResult } from "@y-core/forge/result"
// ValidationResult is also re-exported from "@y-core/forge/validation"

type ValidationResult<T> = Result<T, readonly string[]>
type GuardResult<R = string> = Result<void, R>
```

**`ValidationResult<T>` carries the per-field message list in `error`.** A flat list of
already-formatted messages (`"Email is required"`). Do not collapse the issues into a single
`Error` — the list feeds `renderValidationErrors` (§2c) so every failing field surfaces at once.

**`GuardResult<R>` is for predicate checks that produce no success value** (origin, CSRF,
Turnstile). `R` is typically a string-literal union of reason codes. Construct with `ok()` and
`err(reason)`.

**Never echo a `GuardResult` reason code to a client.** It is a server diagnostic.

---

## 2. Fragment Renderers (`http` namespace)

All three render HTMX-compatible partial HTML — never a full `<html>` document — and return
`SafeHtml`, not a `Response`. Import from `@y-core/forge/http`.

**Set the status on `fragmentResponse(body, status?, headers?)`, not on the renderer.**
`fragmentResponse` fixes `content-type` to `text/html; charset=utf-8`; passing a `content-type`
key (case-insensitive) **throws** rather than being silently ignored.

**`serveObject` is the one ratified exception to "return `SafeHtml`, not `Response`."**
As an HTTP-boundary method it owns its full response — see §5e.

### 2a. `renderError` — Error Fragment

```typescript
return fragmentResponse(renderError("Something went wrong"), 400)
```

Use for single-message failures with no field attribution: rate-limit exceeded, service
unavailable, generic handler errors.

### 2b. `renderSuccess` — Success Fragment

```typescript
return fragmentResponse(renderSuccess("Message sent successfully"))
```

Success uses the `fragmentResponse` default status `200` so HTMX swaps the target instead of
triggering error handling.

### 2c. `renderValidationErrors` — Validation Error Fragment

```typescript
const r = validateContact(formData)   // ValidationResult<T>
if (!r.ok) return fragmentResponse(renderValidationErrors(r.error), 422)
```

Renders the flat message list as a `<ul>`. Pass the `error` list from a `ValidationResult`
(§1c) directly.

### 2d. Fragment Options and Escaping

`FragmentOptions` controls presentation only — `class`, `successAttr`, `ulClass`.

**Every option *class* value is HTML-escaped before interpolation**, so a hostile class string
cannot break out of the attribute.

**`successAttr` is interpolated verbatim** — it is by contract a developer-supplied raw
attribute fragment. Never pass user input to it.

---

## 3. `htmlResponse`, `html` Tag, and `escapeHtml`

### 3a. `htmlResponse` Pattern

`htmlResponse(body, status?, headers?)` is the primary full-page return. It guarantees a
leading `<!DOCTYPE html>` and fixes `content-type: text/html; charset=utf-8` — passing a
`content-type` key **throws**. `body` is a string or `SafeHtml`.

```typescript
import { htmlResponse } from "@y-core/forge/http"
import { renderToString } from "@y-core/forge/jsx"
import { getNonce } from "@y-core/forge/security"

const homeView = async (c: AppContext<AppEnv>) => {
    const markup = await renderToString(<Layout nonce={getNonce(c)}><Page /></Layout>)
    return htmlResponse(markup)
}
```

**For HTMX partials that must not carry a DOCTYPE, use `fragmentResponse` (§2).**

### 3b. `html` Tagged Template

`html` returns a `SafeHtml`-branded value (test membership with `isSafeHtml`). It escapes
interpolated strings by default; `rawHtml(...)` opts a pre-trusted fragment out.

**Prefer JSX components over `html`.** Use the tag only when building raw string fragments for
injection into pre-existing HTML strings.

### 3c. `escapeHtml`

Escapes `&`, `<`, `>`, `"`, `'` to their entity equivalents.

```typescript
escapeHtml('<script>alert("xss")</script>')
// → '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
```

**Required for any dynamic string injected via `rawHtml` or raw concatenation.** The JSX
runtime and the `html` tag auto-escape, so `escapeHtml` is only needed outside those paths.

**For URL attribute values use `safeUrl`, not `escapeHtml`** — see
[`SECURITY_HARDENING.md`](./SECURITY_HARDENING.md) §2d.

Test assertions against rendered HTML must match the encoded form —
[`TESTING.md`](./TESTING.md) §3a owns the encoding map.

---

## 4. Fail-Closed Posture

### 4a. Fail Closed on Missing Critical Context

**When a security-critical dependency is absent, return an error response immediately.**
Silent continuation with degraded behaviour is never acceptable.

```typescript
// BAD — silently skips CSRF when the key is absent
if (csrfKey) await verifyCsrf(c)

// GOOD — fail closed
const csrfKey = c.env.CSRF_SECRET
if (!csrfKey) return new Response("Service Unavailable", { status: 503 })
await verifyCsrf(c, csrfKey)
```

This covers authentication tokens, signing keys, and origin validation secrets: absent binding
→ `503`, never a degraded unauthenticated mode.

### 4b. `required: false` — Non-Security Features Only

Some middleware accepts `required: false` for graceful degradation. **It is scoped to
non-security hardening only** — rate limiting, where a missing binding should not hard-fail.

**Never acceptable with `required: false`:** CSRF verification, authentication middleware,
origin/Referer checks, signature validation.

The asymmetry is deliberate: bypassed rate limiting is an availability concern, bypassed CSRF
is an integrity breach.

---

## 5. Error Taxonomy

### 5a. Expected Errors — Return `Result` or Fragment

Predictable outcomes of valid interactions: validation errors, not-found resources, business
rule violations. They are not exceptional.

**Return `Result<T, E>` from service and utility functions**, and a fragment via
`fragmentResponse(...)` from handlers. **Never `throw`** — it hides the error path from the
type system and forces callers into `try/catch`.

### 5b. Unexpected Errors — The Router Error Boundary

Programming mistakes that cannot be recovered at the call site. **The app needs no per-route
`try/catch`** — the router installs an error boundary as a global middleware, at two depths: one
innermost, one wrapped around the path-scoped guard stack.

Three paths, with different header guarantees:

- **In-chain errors** (thrown by a route handler or route-level middleware) — the innermost
  `errorBoundary` catches the throw; the response flows back out through the path-scoped guards
  and the outermost `applyHeaders` flush, so error pages carry the consumer's full CSP.
- **Guard errors** (thrown by an `app.use` middleware) — the outer boundary catches them, so the
  response still reaches `applyHeaders` and carries whatever headers were already queued. The
  guards downstream of the throw never ran, so their headers are not among them. `createSecurityHeaders`
  queues **before** `next()` (`SECURITY_HARDENING.md` §2a), so a guard throwing after it still
  yields a fully hardened error page; a guard that queues on the way out — `session`, `flash` — does
  not, which is what the innermost boundary depth still protects.

**Queued-header precedence** is *last writer wins per name*, and inner middleware queues after
outer, so an overlapping name resolves **inner-wins**. That is distinct from the pending-vs-Response
rule below: pending always beats a header the handler baked into its own `Response`.
- **Out-of-chain errors** (thrown in router internals, or by env/config resolution before routing)
  never reach the consumer's security middleware, so the handler emits a self-contained
  **baseline-hardened 500**:

  | Header | Value |
  |---|---|
  | `X-Content-Type-Options` | `nosniff` |
  | `Content-Security-Policy` | `default-src 'none'` |
  | `Referrer-Policy` | `no-referrer` |

  On the in-chain path `applyPendingHeaders` set-overwrites these with the consumer's policy.
  No error path ships an unprotected response.

The boundary logs via `createLogger("app")` and includes the escaped `err.message` only in
debug builds (the `isDebug` predicate passed to `createApp`). **The client never receives a
stack trace.** Consumers may override the page with `onError` on `createApp`, `definePage`, or
`defineAction`.

### 5c. Infrastructure Errors — Log and Fail Closed

External service failures sit between expected and unexpected: the call is expected to fail
sometimes, but the specific error is not actionable by the user.

**Catch, log with context via the request logger, return `503`.**

```typescript
const r = await result(emailService.send(msg))
if (!r.ok) {
    requestLog.get(c).error("email: send failed", { error: r.error.message })
    return fragmentResponse(renderError("Message could not be sent. Please try again later."), 503)
}
```

Log enough to diagnose (service, operation, sanitised identifiers) — never user-supplied
content that may carry PII.

### 5d. `defineAction` and `definePage` Error Recovery

`defineAction` centralises action error handling: an oversized body surfaces **413**, an
otherwise unparseable body **400**, validation failures `renderValidationErrors` (unless
`onValidationError` is supplied), and a throw from `handle` a generic **500** fragment logged
via `createLogger("action")` (unless `onError` is supplied).

`definePage` accepts `onError(error, c)`; with no hook the error **re-throws** so the boundary
(§5b) handles it.

**The divergence is intentional.** A full-page `definePage` GET is part of a navigable
document, so an unhandled failure must bubble to the full-page boundary. A `defineAction` HTMX
call swaps a fragment into an existing page, so it stays self-contained. **Both log on the way
out** — the difference is only in what the client receives, never in whether the error is
recorded.

**Use these hooks for per-route recovery instead of ad-hoc `try/catch`.**

### 5e. Startup Invariants — Env Validation and Binding Resolvers Throw

A missing or malformed binding is a **deployment defect**, not a runtime condition to degrade
around. These surfaces `throw` a plain `Error` instead of returning `Result`:

- `Config.get` and config `resolve` (`config`)
- `validateEnv` and the `validateBindings` middleware (`app`)
- `resolveKVStore`, `resolveD1Client`, `resolveObjectStore` (`storage/*`)

**Env and config failures throw the normalized shape `Invalid environment: <path>: <message>; …`**
produced by `formatValidationIssues` (`@y-core/forge/validation`) — never hand-roll the
formatting.

**The dividing line: resolving a binding throws (§4a); operating on a resolved store returns
`Result` (§5a).** See [`STORAGE_BINDINGS.md`](./STORAGE_BINDINGS.md) §4a.

**`serveObject` (`storage/r2`) is the one ratified exception to "operating returns `Result`."**
It sits on the HTTP boundary and returns a `Response` — `200`/`206` (range) / `304`
(conditional) / `404` (missing) / `416` (unsatisfiable range), `400` for an invalid key, `500`
on backend failure. Callers hand its return value straight back from the handler.
