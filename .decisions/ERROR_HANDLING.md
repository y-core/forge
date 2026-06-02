---
title: Error Handling
description: "Result monad, result function, toError, ValidationResult, renderError, renderSuccess, renderValidationErrors, htmlResponse, fragment rendering, fail-closed, error taxonomy, ValidationIssue, HTMX fragment error pattern"
weight: 24
---

# Error Handling

> Authoritative source for forge's error patterns: the Result monad, HTTP fragment
> renderers, and the fail-closed posture for missing dependencies.
>
> Complements [INPUT_VALIDATION.md](./INPUT_VALIDATION.md) (validation pipeline),
> [ROUTING_AND_MIDDLEWARE.md](./ROUTING_AND_MIDDLEWARE.md) (action handler pattern).

---

## 0. Quick Reference

- §1 result namespace: `result()`, `toError()`, `Result<T,E>`, `ValidationResult`
- §2 Fragment renderers: `renderError`, `renderSuccess`, `renderValidationErrors`
- §3 `htmlResponse`: wraps JSX in full HTML response; `html` tag; `escapeHtml`
- §4 Fail-closed posture: 503 when critical context missing, not silent fallback
- §5 Error taxonomy: expected vs unexpected vs infrastructure errors
- §6 Review checklist: error handling items

---

## 1. Result Monad

### 1a. `result` and `toError` Functions

The `result` and `toError` constructors live in `@y-core/forge/result` and form
a lightweight discriminated-union monad that keeps error paths explicit at the
type level without requiring exceptions.

```typescript
import { result, toError, type Result } from "@y-core/forge/result"

type Result<T, E = Error> =
    | { ok: true;  value: T }
    | { ok: false; error: E }

function result<T>(value: T): Result<T, never>   // success variant
function toError<E>(error: E): Result<never, E>  // failure variant
```

Use `Result` as the return type for any function that can fail in a predictable
way. Never return `null | T` or throw for expected failures.

### 1b. Usage Pattern

Callers narrow the union with a single `if (!r.ok)` guard:

```typescript
function parseUrl(raw: string): Result<URL, Error> {
    try {
        return result(new URL(raw))
    } catch {
        return toError(new Error(`Invalid URL: ${raw}`))
    }
}

const r = parseUrl(input)
if (!r.ok) return c.text(r.error.message, 400)
const url = r.value  // type-narrowed to URL — no cast needed
```

Chain multiple operations by returning early on each failure rather than
nesting. This keeps the happy path at the left margin.

### 1c. `ValidationResult` Type

`ValidationResult<T>` is a specialised variant used by the validation pipeline.
It replaces the generic `error: E` slot with a structured issues array:

```typescript
import type { ValidationResult } from "@y-core/forge/result"

// Equivalent shape:
// | { ok: true;  value: T }
// | { ok: false; issues: ValidationIssue[] }

// ValidationIssue:
// { path: string[]; message: string }
```

`path` is the dot-path of the failing field (e.g. `["email"]`). `message` is
a human-readable description. This structure feeds directly into
`renderValidationErrors` (§2c).

Validation operations backed by valibot return `ValidationResult<T>`. Do not
convert validation issues into a single `Error` — preserve the per-field
structure so the UI can place each message next to the correct input.

---

## 2. Fragment Renderers (`http` namespace)

All three renderers produce HTMX-compatible HTML fragments — partial HTML
suitable for `hx-swap` targets. They do NOT render a full `<html>` document.
Import them from `@y-core/forge/http`.

### 2a. `renderError` — Error Fragment

```typescript
import { renderError, type FragmentOptions } from "@y-core/forge/http"

// Inside a Hono handler:
return renderError(c, "Something went wrong", { status: 400 })
```

Renders a styled error fragment. The second argument is the user-visible message
string. `FragmentOptions.status` sets the HTTP status code (default `500`).

Use `renderError` for single-message failures where no field attribution is
needed: rate-limit exceeded, service unavailable, generic handler errors.

### 2b. `renderSuccess` — Success Fragment

```typescript
import { renderSuccess } from "@y-core/forge/http"

return renderSuccess(c, "Message sent successfully")
```

Renders a styled success fragment. No `FragmentOptions` overload — success
responses always use status `200` so HTMX swaps the target without triggering
error handling.

### 2c. `renderValidationErrors` — Validation Error Fragment

```typescript
import { renderValidationErrors } from "@y-core/forge/http"
import * as v from "valibot"

const parsed = v.safeParse(Schema, formData)
if (!parsed.success) {
    return renderValidationErrors(c, parsed.issues)
}
```

Renders per-field validation errors as an HTMX fragment. Each issue maps
`path[0]` to the field name shown in the UI. Preserves the full issue list
so all fields show errors simultaneously rather than one at a time.

When using the forge validation helpers that return `ValidationResult<T>`,
pass `result.issues` directly:

```typescript
const r = validateContactForm(data)
if (!r.ok) return renderValidationErrors(c, r.issues)
```

### 2d. Fragment Options

`FragmentOptions` is a single-field interface:

```typescript
interface FragmentOptions {
    status?: number   // HTTP status code; default 200 for success, 500 for errors
}
```

Pass `{ status: 422 }` for semantic correctness on validation failures when the
HTMX client is configured to handle non-2xx responses. Default `200` works with
standard HTMX `hx-swap` without additional client configuration.

---

## 3. `htmlResponse`, `html` Tag, and `escapeHtml`

### 3a. `htmlResponse` Pattern

`htmlResponse` is the primary way to return a full-page JSX render from a
Hono handler. It sets `Content-Type: text/html; charset=UTF-8` and serialises
the JSX tree.

```typescript
import { htmlResponse } from "@y-core/forge/http"

app.get("/", async (c) => {
    const data = await fetchPageData(c)
    return htmlResponse(c.req.raw, <Layout nonce={c.get("nonce")}><Page data={data} /></Layout>)
})
```

Pass `c.req.raw` (the native `Request`), not the Hono context, so
`htmlResponse` can read request headers for conditional rendering if needed.

### 3b. `html` Tagged Template

```typescript
import { html } from "@y-core/forge/http"

const snippet = html`<div class="item">${escapeHtml(label)}</div>`
```

`html` returns a tagged-template string typed as `TrustedHtml` (an opaque
brand). It does not auto-escape interpolations — the caller is responsible for
escaping dynamic content before interpolation. Use `escapeHtml` (§3c) for every
non-literal value.

Prefer Hono JSX components over `html` tagged templates wherever possible. Use
`html` only when building raw string fragments that will be injected into
pre-existing HTML strings.

### 3c. `escapeHtml`

```typescript
import { escapeHtml } from "@y-core/forge/http"

const safe = escapeHtml('<script>alert("xss")</script>')
// → '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
```

Escapes `&`, `<`, `>`, `"`, `'` to their HTML entity equivalents. Required for
any dynamic string injected via `html` tagged templates or raw string
concatenation. Hono JSX auto-escapes text nodes — `escapeHtml` is only needed
outside JSX render paths.

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
if (!csrfKey) return c.text("Service Unavailable", 503)
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
- Return `renderValidationErrors`, `renderError`, or `renderSuccess` from
  Hono handlers.
- Never `throw` for expected failures — it hides the error path from the type
  system and forces callers to use `try/catch`.

### 5b. Unexpected Errors — Let Bubble or Return 500

Unexpected errors are programming mistakes: `null` dereferences, failed
invariant assertions, type errors at runtime. They cannot be meaningfully
recovered from at the call site.

Let them propagate to the Hono top-level error handler, which must:
1. Log the full error (including stack trace) server-side.
2. Return a generic `500` or `503` message to the client.
3. Never include `err.message` or `err.stack` in the client response.

```typescript
// Top-level handler in worker.ts (set once, not per-route)
app.onError((err, c) => {
    console.error("unhandled error", err)
    return c.text("Internal Server Error", 500)
})
```

### 5c. Infrastructure Errors — Log and Fail Closed

External service failures (KV store unavailable, email API down, third-party
timeout) fall between expected and unexpected. The service call itself is
expected to sometimes fail; the specific error is not actionable by the user.

Pattern: catch, log with context, return `503` via `renderError`:

```typescript
try {
    await emailService.send(msg)
} catch (err) {
    console.error("email: send failed", { error: String(err) })
    return renderError(c, "Message could not be sent. Please try again later.", { status: 503 })
}
```

Log enough context to diagnose the failure (service name, operation, sanitised
input identifiers) but never log user-supplied content verbatim if it may
contain PII.

---

## 6. Error Handling Review Checklist

Before merging any handler or service change, verify:

- [ ] Expected failures use `Result` monad or fragment renderers — not thrown exceptions
- [ ] Validation errors use `renderValidationErrors` with per-field `ValidationIssue[]`
- [ ] Stack traces and raw `err.message` strings never reach the client
- [ ] Security-critical paths are fail-closed (missing env var → `503`, not silent skip)
- [ ] Infrastructure errors are logged with context before returning `503`
- [ ] `escapeHtml` is applied to every dynamic value interpolated via `html` tagged templates
- [ ] Test assertions for HTML output match encoded entities (`&amp;`, `&lt;`, etc.)
- [ ] `required: false` is only used for non-security hardening middleware (rate limiting)
