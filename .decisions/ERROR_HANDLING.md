---
title: Error Handling
description: "Result type, result function, toError, ValidationResult, renderError, renderSuccess, renderValidationErrors, fragmentResponse, htmlResponse, fragment rendering, error boundary middleware, baseline-hardened 500, defineAction 413, fail-closed, error taxonomy, HTMX fragment error pattern"
weight: 24
---

# Error Handling

> Authoritative source for forge's error patterns: the `Result` type, HTTP fragment
> renderers, the router error boundary, and the fail-closed posture for missing dependencies.
>
> Complements [INPUT_VALIDATION.md](./INPUT_VALIDATION.md) (validation pipeline),
> [ROUTING_AND_MIDDLEWARE.md](./ROUTING_AND_MIDDLEWARE.md) (action handler pattern).

---

## 0. Quick Reference

- §1 result namespace: `result()`, `toError()`, `Result<T,E>`, `ValidationResult`
- §2 Fragment renderers: `renderError`, `renderSuccess`, `renderValidationErrors`, `fragmentResponse`
- §3 `htmlResponse`: wraps JSX in full HTML response; `html` tag; `escapeHtml`
- §4 Fail-closed posture: 503 when critical context missing, not silent fallback
- §5 Error taxonomy: expected vs unexpected vs infrastructure errors; the error boundary; §5e startup invariants — env validation and binding resolvers throw, store operations return Result
- §6 Review checklist: error handling items

---

## 1. Result Monad

### 1a. `result` and `toError` Functions

The `result` function and `toError` helper live in `@y-core/forge/result` and
form a lightweight discriminated-union monad that keeps error paths explicit at
the type level without requiring exceptions.

```typescript
import { result, toError, type Result } from "@y-core/forge/result"

type Result<T, E = Error> =
    | { ok: true;  data: T }
    | { ok: false; error: E }

// `result` wraps a sync/async function or a promise, capturing any throw as `error`:
function result<T, E = Error>(fn: () => T): Result<T, E>
function result<T, E = Error>(fn: () => Promise<T>): Promise<Result<T, E>>
function result<T, E = Error>(promise: Promise<T>): Promise<Result<T, E>>

// `toError` coerces an unknown thrown value into an `Error` instance:
function toError(thrown: unknown): Error
```

Use `Result` as the return type for any function that can fail in a predictable
way. Never return `null | T` or throw for expected failures. The success variant
carries `data`; the failure variant carries `error`.

### 1b. Usage Pattern

Wrap a fallible operation with `result(...)`, then narrow the union with a single
`if (!r.ok)` guard:

```typescript
const r = result(() => new URL(input))
if (!r.ok) return new Response(r.error.message, { status: 400 })
const url = r.data  // type-narrowed to URL — no cast needed
```

For async work, `result` returns a `Promise<Result<T, E>>`:

```typescript
const r = await result(fetchRemote(id))
if (!r.ok) return new Response("Upstream unavailable", { status: 502 })
const payload = r.data
```

Chain multiple operations by returning early on each failure rather than
nesting. This keeps the happy path at the left margin.

### 1c. `ValidationResult` Type

`ValidationResult<T>` is a specialised variant used by the validation pipeline.
It replaces the generic `error: E` slot with an array of error messages:

```typescript
import type { ValidationResult } from "@y-core/forge/result"
// (also re-exported from "@y-core/forge/validation")

type ValidationResult<T> =
    | { ok: true;  data: T }
    | { ok: false; errors: string[] }
```

`errors` is a flat list of human-readable, already-formatted field messages
(e.g. `"Email is required"`). This structure feeds directly into
`renderValidationErrors` (§2c).

Validation operations backed by `v` (the valibot namespace from
`@y-core/forge/validation`) return `ValidationResult<T>`. Do not collapse the
issues into a single `Error` — preserve the per-field message list so the UI can
surface every failing field at once.

---

## 2. Fragment Renderers (`http` namespace)

All three renderers produce HTMX-compatible HTML fragments — partial HTML
suitable for `hx-swap` targets. They do NOT render a full `<html>` document.
Each renderer returns a `SafeHtml` value (the rendered markup), not a
`Response`; wrap it with `fragmentResponse(body, status?)` to set the HTTP
status. Import everything from `@y-core/forge/http`.

### 2a. `renderError` — Error Fragment

```typescript
import { fragmentResponse, renderError } from "@y-core/forge/http"

return fragmentResponse(renderError("Something went wrong"), 400)
```

`renderError(message, options?)` renders a styled error fragment from the
user-visible `message` string. The HTTP status is the second argument to
`fragmentResponse` (default `200`).

Use `renderError` for single-message failures where no field attribution is
needed: rate-limit exceeded, service unavailable, generic handler errors.

### 2b. `renderSuccess` — Success Fragment

```typescript
import { fragmentResponse, renderSuccess } from "@y-core/forge/http"

return fragmentResponse(renderSuccess("Message sent successfully"))
```

`renderSuccess(message, options?)` renders a styled success banner. Success
responses use status `200` (the `fragmentResponse` default) so HTMX swaps the
target without triggering error handling.

### 2c. `renderValidationErrors` — Validation Error Fragment

```typescript
import { fragmentResponse, renderValidationErrors } from "@y-core/forge/http"

const r = validateContact(formData)   // returns ValidationResult<T>
if (!r.ok) {
    return fragmentResponse(renderValidationErrors(r.errors), 422)
}
```

`renderValidationErrors(errors, options?)` renders the flat list of field error
messages as a `<ul>` inside an HTMX fragment, so every failing field surfaces at
once rather than one at a time. Pass the `errors` array from a
`ValidationResult<T>` (§1c) directly.

### 2d. Fragment Options

`FragmentOptions` controls presentation only — the HTTP status is set by
`fragmentResponse`, not by the renderer:

```typescript
interface FragmentOptions {
    class?: string         // override the banner container class
    successAttr?: string   // raw attribute fragment on the success banner (e.g. `data-status="ok"`)
    ulClass?: string       // override the <ul> class in renderValidationErrors
}
```

All option *class* values are HTML-escaped before interpolation, so a hostile
class string cannot break out of the attribute. (`successAttr` is, by contract,
a developer-supplied raw attribute fragment and is interpolated verbatim — never
pass user input to it.) For the status code, pass it to `fragmentResponse`:
`fragmentResponse(renderValidationErrors(errors), 422)`.

---

## 3. `htmlResponse`, `html` Tag, and `escapeHtml`

### 3a. `htmlResponse` Pattern

`htmlResponse` is the primary way to return a full-page render from a handler.
It guarantees a leading `<!DOCTYPE html>` and sets
`content-type: text/html; charset=utf-8`. Its signature is
`htmlResponse(body, status?, headers?)` where `body` is a string or a `SafeHtml`
value (e.g. the output of `renderToString`).

```typescript
import { htmlResponse } from "@y-core/forge/http"
import { renderToString } from "@y-core/forge/render"
import { getNonce } from "@y-core/forge/security"

const homeView = async (c: AppContext<AppEnv>) => {
    const data = await fetchPageData(c)
    const markup = await renderToString(<Layout nonce={getNonce(c)}><Page data={data} /></Layout>)
    return htmlResponse(markup)
}
```

The handler receives an `AppContext<Bindings>` (a `RequestContext` plus `.env`
and `.executionCtx`); read request headers via `c.request.headers.get(...)` and
the CSP nonce via `getNonce(c)`. For HTMX partials that must NOT carry a
DOCTYPE, use `fragmentResponse` (§2) instead.

### 3b. `html` Tagged Template

```typescript
import { html } from "@y-core/forge/http"

const snippet = html`<div class="item">${escapeHtml(label)}</div>`
```

`html` returns a tagged-template value typed as `SafeHtml` (an opaque brand;
test membership with `isSafeHtml`). It escapes interpolated string values by
default; use `rawHtml(...)` to opt a pre-trusted fragment out of escaping, and
`escapeHtml` (§3c) for any value built up outside the tag.

Prefer JSX components over `html` tagged templates wherever possible. Use `html`
only when building raw string fragments that will be injected into pre-existing
HTML strings.

### 3c. `escapeHtml`

```typescript
import { escapeHtml } from "@y-core/forge/http"

const safe = escapeHtml('<script>alert("xss")</script>')
// → '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
```

Escapes `&`, `<`, `>`, `"`, `'` to their HTML entity equivalents. Required for
any dynamic string injected via `rawHtml` or raw string concatenation. The JSX
runtime and the `html` tag auto-escape text/interpolations — `escapeHtml` is
only needed outside those render paths. (For URL attribute values, use `safeUrl`
from `@y-core/forge/http`, which neutralises `javascript:`-style payloads and is
applied automatically to `href`/`src`/`action` in JSX output.)

Test assertions for HTML output must match the encoded form (e.g. `&amp;`, `&lt;`)
not the raw characters. See CLAUDE.md: "account for HTML-encoded entities in test
assertions for HTML output."

---

## 4. Fail-Closed Posture

### 4a. Fail Closed on Missing Critical Context

When a security-critical dependency is absent or fails, the handler must
return an error response immediately. Silent continuation with degraded
behaviour is never acceptable for security-relevant operations.

```typescript
// BAD: silently skips CSRF check when key is absent
if (csrfKey) await verifyCsrf(c)
// continues without CSRF protection — attacker can forge requests

// GOOD: fail closed
const csrfKey = c.env.CSRF_SECRET
if (!csrfKey) return new Response("Service Unavailable", { status: 503 })
await verifyCsrf(c, csrfKey)
```

The principle extends to authentication tokens, signing keys, and origin
validation secrets. If the binding or environment variable is not present,
return `503` — do not degrade to an unauthenticated mode.

### 4b. `required: false` — Non-Security Features Only

Some forge middleware accepts `required: false` to allow graceful degradation.
This is intentionally scoped to non-security hardening measures (e.g. rate
limiting) where a missing Redis binding should not hard-fail a request.

```typescript
// Acceptable: rate limiting is hardening, not a security gate
await rateLimit(c, { required: false })

// Never acceptable with required: false:
// - CSRF verification
// - Authentication middleware
// - Origin / Referer checks
// - Signature validation
```

The asymmetry is deliberate. Bypassed rate limiting is an availability concern.
Bypassed CSRF is an integrity breach.

---

## 5. Error Taxonomy

### 5a. Expected Errors — Return `Result` or Fragment

Expected failures are predictable outcomes of valid user interactions:
validation errors, not-found resources, business rule violations (duplicate
email, expired token). They are not exceptional.

Handle them explicitly:
- Return `Result<T, E>` from service/utility functions.
- Return a fragment via `fragmentResponse(renderValidationErrors(...) | renderError(...) | renderSuccess(...))`
  from handlers.
- Never `throw` for expected failures — it hides the error path from the type
  system and forces callers to use `try/catch`.

### 5b. Unexpected Errors — The Router Error Boundary

Unexpected errors are programming mistakes: `null` dereferences, failed
invariant assertions, type errors at runtime. They cannot be meaningfully
recovered from at the call site. The app does not need a per-route `try/catch`;
the router installs an error boundary as its innermost global middleware.

Two paths exist, with different header guarantees:

- **In-chain errors** — anything thrown by a route handler or route-level
  middleware. The `errorBoundary` middleware catches the throw and produces the
  error response, which then flows back out through the path-scoped guards
  (including the consumer's security-headers middleware) and the outermost
  `applyHeaders` flush. Error pages therefore carry the consumer's full CSP and
  security headers.
- **Out-of-chain errors** — anything thrown outside the middleware chain (router
  internals). These never reach the consumer's security middleware, so the
  handler emits a **baseline-hardened 500** that is self-contained:

  | Header | Value |
  |---|---|
  | `X-Content-Type-Options` | `nosniff` |
  | `Content-Security-Policy` | `default-src 'none'` |
  | `Referrer-Policy` | `no-referrer` |

  On the in-chain path, `applyPendingHeaders` set-overwrites these baseline
  values with the consumer's policy.

The boundary logs the failure via the app logger (`createLogger("app")`) and,
in debug builds (the `isDebug` predicate passed to `createApp`), includes the
escaped `err.message` in the page; otherwise it shows a generic notice. The
client never receives a stack trace. Consumers may override the page entirely
by passing `onError` to `createApp` (or to `definePage`/`defineAction` for a
single route — see §5d).

### 5c. Infrastructure Errors — Log and Fail Closed

External service failures (KV store unavailable, email API down, third-party
timeout) fall between expected and unexpected. The service call itself is
expected to sometimes fail; the specific error is not actionable by the user.

Pattern: catch, log with context via the request logger, return `503` via
`fragmentResponse(renderError(...))`:

```typescript
import { fragmentResponse, renderError } from "@y-core/forge/http"
import { requestLog } from "@y-core/forge/logging"

const log = requestLog.get(c)
const r = await result(emailService.send(msg))
if (!r.ok) {
    log.error("email: send failed", { error: r.error.message })
    return fragmentResponse(renderError("Message could not be sent. Please try again later."), 503)
}
```

Log enough context to diagnose the failure (service name, operation, sanitised
input identifiers) but never log user-supplied content verbatim if it may
contain PII.

### 5d. `defineAction` and `definePage` Error Recovery

`defineAction` (the parse → validate → handle pipeline) centralises action error
handling so individual handlers stay thin:

- An oversized request body surfaces a **413** fragment
  (`fragmentResponse(renderError(...), 413)`); an otherwise unparseable body
  yields **400**.
- Validation failures return `renderValidationErrors(validation.errors)` unless
  an `onValidationError` hook is provided.
- A throw from the `handle` step is logged via `createLogger("action")` and
  converted to a generic **500** fragment, unless an `onError` hook overrides it.

`definePage` likewise accepts an `onError(error, c)` hook; if a `loader` or
`view` throws and no hook is set, the error re-throws so the router error
boundary (§5b) handles it. Use these hooks for per-route recovery instead of
wrapping handlers in ad-hoc `try/catch`.

### 5e. Startup Invariants — Env Validation and Binding Resolvers Throw

A missing or malformed Worker binding/secret is a **deployment defect**, not a
runtime condition to degrade around. These surfaces therefore `throw` a plain
`Error` (Infrastructure tier) instead of returning `Result`:

- `Config.get` / config `resolve` (`config` namespace)
- `validateEnv` and the `validateBindings` middleware (`app` namespace)
- Storage binding resolvers: `resolveKVStore`, `resolveD1Client`,
  `resolveObjectStore` (`storage/*` namespaces)

Env/config validation failures all throw the normalized message shape
`Invalid environment: <path>: <message>; …`, produced by the shared
`formatValidationIssues` helper (`@y-core/forge/validation`) — never hand-roll
the issue formatting. Storage resolvers throw
`"<KV namespace|D1 database|R2 bucket> binding not available"` when the binding
is absent; passing `required: false` opts into a `null` return for
non-security-critical features (§4b).

The dividing line: **resolving** a binding throws (startup invariant, fail
closed — §4a); **operating** on a resolved store returns `Result<T,E>` (expected
runtime failures — §5a). See
[STORAGE_BINDINGS.md](./STORAGE_BINDINGS.md) §4a for the resolver pattern.

---

## 6. Error Handling Review Checklist

Before merging any handler or service change, verify:

- [ ] Expected failures use the `Result` type or fragment renderers — not thrown exceptions
- [ ] Validation errors use `renderValidationErrors` with the `ValidationResult.errors` list
- [ ] Fragments are returned via `fragmentResponse(render*(...), status)` (status on the response, not the renderer)
- [ ] Stack traces and raw `err.message` strings never reach the client (the error boundary gates this)
- [ ] Unexpected throws propagate to the router error boundary or a `definePage`/`defineAction` `onError` hook — no ad-hoc per-route `try/catch`
- [ ] Security-critical paths are fail-closed (missing env var → `503`, not silent skip)
- [ ] Infrastructure errors are logged with context (`requestLog.get(c)`) before returning `503`
- [ ] `escapeHtml` is applied to every dynamic value interpolated via `rawHtml` or raw string concatenation; URL attributes use `safeUrl`
- [ ] Test assertions for HTML output match encoded entities (`&amp;`, `&lt;`, etc.)
- [ ] `required: false` is only used for non-security hardening middleware (rate limiting)
