---
title: Security Hardening
description: "createSecurityHeaders, CSP nonce, getNonce, NONCE constant, mergeSecurityHeaders, CORS response rebuild, originGuard, verifyOrigin, crossOriginProtection Sec-Fetch-Site, rateLimit, requestId, requireFormContentType, safeUrl JSX URL sanitization, parseFormData 413 byte cap, fragment escaping, R2 RFC 5987, storage shape checks, fallback 500 headers, transport-layer only, CSRF in form namespace, auth boundary"
weight: 22
---

# Security Hardening

> Authoritative source for the security namespace: transport-layer request/response
> hardening only. CSP, CORS, origin verification, rate limiting, request identity.
> Auth/session/RBAC are out of scope — they belong in future auth namespace.
>
> Complements [ROUTING_AND_MIDDLEWARE.md](./ROUTING_AND_MIDDLEWARE.md) (middleware usage),
> [INPUT_VALIDATION.md](./INPUT_VALIDATION.md) (CSRF lives in form namespace).

---

## 0. Quick Reference

- §1 Security namespace exports: complete list of what security/ ships
- §2 createSecurityHeaders and CSP nonce: factory, NONCE constant, mergeSecurityHeaders; §2e OWASP default-header audit (COOP/CORP defaults, COEP opt-in)
- §3 CORS and origin protection: cors(), originGuard, verifyOrigin, crossOriginProtection
- §4 Rate limiting: rateLimit() with Workers binding
- §5 Request identity: requestId(), requestIdCtx contextVar
- §6 Content guards: requireFormContentType (HTMX detection moved to `html/htmx` — see §6b)
- §7 Transport-layer boundary: what is NOT in security
- §8 Defense-in-depth across namespaces: JSX safeUrl, parseFormData byte cap, fragment escaping, R2 hardening, storage shape checks, fallback 500 headers

---

## 1. Security Namespace Exports

From `@y-core/forge/security` (`src/security/mod.ts`):

- `createSecurityHeaders(options)` — middleware factory for security headers
- `mergeSecurityHeaders(base, override)` — merge two SecurityHeadersOptions
- `NONCE` — constant string `"'nonce-{nonce}'"` for CSP scriptSrc
- `requestId()` — middleware: injects X-Request-Id, sets requestIdCtx
- `requestIdCtx` — contextVar accessor for the request ID string
- `requireFormContentType` — middleware: enforces application/x-www-form-urlencoded
- `cors(options)` — CORS middleware factory
- `matchOrigin(url, allowed)` — utility: checks if URL matches allowed origins
- `crossOriginProtection(options)`, `checkCrossOriginProtection` — CSRF-via-origin guards
- `originGuard(allowed)`, `verifyOrigin(req, allowed)` — origin allowlist enforcement
- `rateLimit(options)` — Workers rate limiting middleware
- `BaseUrlConfigSchema`, `deriveAllowedOrigins`, `parseUrl` — URL/origin config helpers
- `applySecurityHeaders(response, options?)` — applies the headers directly to a
  Response (for out-of-band responses that never pass through the middleware chain);
  `options` is `ApplySecurityHeadersOptions` (`SecurityHeadersOptions` + optional explicit `nonce`)
- `getNonce(c)` — returns the per-request CSP nonce (or `""` when none is set)
- Type exports: `CorsOptions`, `CrossOriginProtectionOptions`, `RateLimitBinding/Options`,
  `RequestIdContext`, `BaseUrlConfig`, `OriginResult`, `ParsedUrl`, `SecurityHeadersOptions`, etc.

NOT in security (common mistake to avoid):

- `timingSafeEqual`/`timingSafeEqualBytes` — in internal `src/crypto/` (`@internal`)
- `csrfProtection`, `importCsrfKey`, `mintCsrf` — in `@y-core/forge/form`
- `sessionMiddleware` — in `@y-core/forge/session`
- `isHxRequest` — moved to `@y-core/forge/html/htmx` (it is a UX routing hint, not a security boundary)

---

## 2. createSecurityHeaders and CSP Nonce

### 2a. createSecurityHeaders Factory Pattern

`createSecurityHeaders` generates a unique nonce per request (16 random bytes,
base64url-encoded), injects it into the CSP `script-src` directive, and stores it on the request context in an
internal context variable that `getNonce(c)` reads back. Every request gets a fresh nonce
— static nonces defeat the purpose of CSP nonce enforcement. The computed headers are
queued on the per-request pending-header channel and flushed once by the app's outermost
`applyHeaders` pass, rather than each middleware rebuilding its own Response.

    import { createSecurityHeaders, NONCE, type SecurityHeadersOptions } from "@y-core/forge/security"

    const securityHeaders: SecurityHeadersOptions = {
      scriptSrc: ["'self'", NONCE, "https://challenges.cloudflare.com"],
      connectSrc: ["'self'", "https://challenges.cloudflare.com"],
      frameSrc:   ["'self'", "https://challenges.cloudflare.com"],
    }

    app.use("*", createSecurityHeaders(securityHeaders))

Register once at the app level via `app.use("*", ...)` so all routes inherit the headers.

### 2b. NONCE Constant

`NONCE` is the string literal `"'nonce-{nonce}'"` — a placeholder in `scriptSrc` that
`createSecurityHeaders` replaces with the actual per-request nonce value at runtime.
Using the constant (rather than a hand-written string) makes the placeholder
recognizable and avoids typos.

The generated nonce is stored in context and retrieved via `getNonce(c)` for use in
inline `<script>` tags:

    import { getNonce } from "@y-core/forge/security"

    // Inside a JSX view component
    const nonce = getNonce(c)
    // <script nonce={nonce}>...</script>

### 2c. mergeSecurityHeaders for Dev/Prod Split

`mergeSecurityHeaders(base, override)` deep-merges two `SecurityHeadersOptions` objects,
concatenating directive arrays. Use exclusively in the dev entry point to layer the
Wrangler live-reload inline-script hash onto the production CSP:

    import { mergeSecurityHeaders } from "@y-core/forge/security"

    const WRANGLER_LIVE_RELOAD_HASH = "'sha256-g5a3SrOYIecCloZ8S7M4xdT1pbYi6e7mjHrmwphRxfE='"

    export default createWorker(
      mergeSecurityHeaders(securityHeaders, {
        scriptSrc: [WRANGLER_LIVE_RELOAD_HASH],
      })
    )

The live-reload hash must never appear in the production CSP — keeping it in the dev
entry only means it cannot leak by construction. See `src/worker.dev.ts`.

### 2d. getNonce — Retrieve Request Nonce in Views

Retrieve the per-request nonce inside view components to attach it to inline scripts:

    import { getNonce } from "@y-core/forge/security"
    import type { AppContext } from "@y-core/forge/context"

    export function MyPage(c: AppContext) {
      const nonce = getNonce(c)
      return <script nonce={nonce} src="/assets/js/main.js" />
    }

`getNonce(c)` reads the per-request nonce stored in context by `createSecurityHeaders`.
It never throws: when the middleware has not run it returns `""`, which renders an empty
`nonce` attribute that the CSP will not honor — register `createSecurityHeaders` before
any nonce consumer so the value is always present (see ROUTING_AND_MIDDLEWARE.md §3d).

> URL attributes in JSX (`href`, `src`, `action`, …) are sanitized automatically at
> render time: the renderer routes those attribute values through `safeUrl`
> (`@y-core/forge/http`), which neutralizes dangerous schemes (`javascript:`,
> `vbscript:`, `data:`, including obfuscated variants) to `"#"`. This complements the
> nonce-based CSP — even a missed nonce cannot turn a user-controlled URL into script
> execution.

### 2e. Default Header Set — OWASP Baseline Audit

Audit of the emitted default header set against the OWASP secure-headers baseline
(2026-07-02), with the decision taken for each candidate:

| Header | Default | Decision |
|---|---|---|
| `Content-Security-Policy` | strict, per-request nonce | present since v0 |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | present since v0 |
| `X-Content-Type-Options` | `nosniff` | present since v0 |
| `X-Frame-Options` | `DENY` | present since v0 (redundant with `frame-ancestors 'none'`, kept for legacy UAs) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | present since v0 |
| `Permissions-Policy` | `camera/microphone/geolocation/payment` all `()` | present since v0 |
| `Cross-Origin-Opener-Policy` | `same-origin` | **added as default** — overridable via `crossOriginOpenerPolicy` (`same-origin-allow-popups` for OAuth/payment popups) |
| `Cross-Origin-Resource-Policy` | `same-origin` | **added as default** — overridable via `crossOriginResourcePolicy` (`cross-origin` for embeddable resources) |
| `Cross-Origin-Embedder-Policy` | not emitted | **opt-in only** via `crossOriginEmbedderPolicy` — `require-corp` breaks any subresource lacking CORP/CORS opt-in |
| `Cache-Control` on sensitive responses | per-route | route concern (`definePage({ cache })`, `healthCheck` sets `no-store`) — not a blanket default |

---

## 3. CORS and Origin Protection

### 3a. cors Middleware for API Routes

Apply CORS headers only on routes that need them. Derive `allowedOrigins` from the
`BaseUrlConfig` so the allowed list matches the deployed environment automatically:

    import { cors } from "@y-core/forge/security"

    app.use("/api/*", cors({ origins: config.site.url.allowedOrigins }))

Do not apply `cors()` globally — it is only needed on endpoints consumed cross-origin.

`cors()` does not mutate the downstream response in place. After `next()` returns it
**rebuilds** the `Response` with a fresh `Headers` clone (`new Response(res.body, …)`)
before setting `Access-Control-Allow-Origin`/`Vary`. A downstream response may carry
immutable headers (e.g. a cached or constructed `Response`), where in-place mutation
would throw or silently no-op; rebuilding is correct by construction.

### 3b. originGuard — Strict Origin Allowlist Middleware

`originGuard` is a middleware that rejects any request whose `Origin` header is not in
the provided allowlist. Use on webhook or privileged endpoints where a strict allowlist
is required:

    import { originGuard } from "@y-core/forge/security"

    app.use("/webhook/*", originGuard(["https://trusted.example.com"]))

Requests with no `Origin` header (same-origin browser requests, curl) are allowed
through — `originGuard` only blocks cross-origin requests from non-listed origins.

### 3c. verifyOrigin — Inline Origin Check

For one-off checks inside a handler (rather than middleware), use `verifyOrigin`:

    import { verifyOrigin } from "@y-core/forge/security"

    const { ok } = verifyOrigin(c.request, allowedOrigins)
    if (!ok) return new Response("Forbidden", { status: 403 })

`verifyOrigin` takes the standard `Request` (`c.request`), inspects the `Origin`
header, and returns an `OriginResult` (`{ ok: boolean }`).

### 3d. crossOriginProtection and checkCrossOriginProtection

`crossOriginProtection()` is a middleware that enforces same-origin for state-changing
requests (anything other than `GET`/`HEAD`/`OPTIONS`) using the browser **Fetch
Metadata** `Sec-Fetch-Site` header. Requests labelled `cross-site` are rejected with
`403`; requests with no `Sec-Fetch-Site` header are rejected by default (fail-closed)
unless `allowMissingHeader: true` is passed:

    import { crossOriginProtection } from "@y-core/forge/security"

    app.use("/form/*", crossOriginProtection())

`checkCrossOriginProtection(request, options)` performs the same check as a plain
function, returning `{ ok: true } | { ok: false; reason: string }` without wrapping in
middleware. Use when you need the check result to drive conditional logic rather than an
automatic rejection. Both accept `CrossOriginProtectionOptions` (`{ allowMissingHeader? }`).

> Note: `crossOriginProtection` checks Origin/Referer headers — it is not a CSRF token
> mechanism. CSRF token minting and verification live in `@y-core/forge/form`. See §7.

---

## 4. Rate Limiting with Workers Binding

### 4a. rateLimit Middleware Factory

`rateLimit` wraps the Cloudflare Workers Rate Limiting binding. Apply per-route, not
globally, to target high-risk endpoints (form submissions, API mutations):

    import { rateLimit } from "@y-core/forge/security"
    import { createController } from "@y-core/forge/router"

    const rateLimitGuard = rateLimit<AppEnv>({
      limiter: (c) => c.env.RATE_LIMITER,
      required: false, // graceful: skip if binding absent (dev)
    })

    // Routes are declared as a map; route-level middleware lives in the controller action.
    export const controller = createController(routes, {
      actions: {
        contact: { middleware: [rateLimitGuard, csrfVerifyGuard], handler: contactHandler },
      },
    })

**Key trust boundary.** The default key is the `CF-Connecting-IP` header, which is only
trustworthy when the Worker actually runs behind Cloudflare's edge — a directly-reachable
origin or another platform lets clients forge it to evade or poison the limit. Off
Cloudflare, always supply a custom `key`. A missing header (or a throwing `key` function)
fails closed with `503`. For key-selection strategies (per-IP vs per-session vs
route-scoped composite keys), see the "Choosing a rate-limit key" section in
`src/security/README.md`.

### 4b. required: false for Dev Graceful Degradation

Setting `required: false` means the middleware no-ops when the `RATE_LIMITER` binding is
absent (local dev without wrangler bindings). In production the binding is always present.
Leaving `required: true` (default) makes the middleware return `503 Service Unavailable`
per request when the binding is missing — use this on production-only routes where rate
limiting is non-negotiable, so a misconfigured binding fails closed rather than silently
disabling the limit.

### 4c. Workers Rate Limiter Binding Configuration

Declare the binding in `wrangler.jsonc`:

    "ratelimits": [
      {
        "name": "RATE_LIMITER",
        "namespace_id": "1001",
        "simple": { "limit": 5, "period": 60 }
      }
    ]

Add the binding type to `AppEnv`:

    interface AppEnv {
      RATE_LIMITER: RateLimitBinding
    }

`RateLimitBinding` is exported from `@y-core/forge/security`.

---

## 5. Request Identity

### 5a. requestId Middleware

`requestId()` generates a unique ID (UUID v4 via `crypto.randomUUID`) per request, sets
the `X-Request-Id` response header, and stores the value in `requestIdCtx`:

    import { requestId, requestIdCtx } from "@y-core/forge/security"

    app.use("*", requestId())

    // Inside a handler or middleware:
    const id = requestIdCtx.getOptional(c)  // string | undefined

Register at the top of the middleware stack so all subsequent middleware and handlers
can read the ID.

### 5b. Logging Integration

`requestLogger` uses `requestIdCtx` to correlate log entries with request IDs across
the lifetime of a request:

    import { requestLogger } from "@y-core/forge/logging"
    import { requestIdCtx } from "@y-core/forge/security"

    app.use("*", requestLogger({
      bindings: (c) => ({ requestId: requestIdCtx.getOptional(c) }),
    }))

Because `requestId()` runs first, the logger always finds the ID already set.

---

## 6. Content Type Guards

### 6a. requireFormContentType

Middleware factory that enforces a form content type — either
`application/x-www-form-urlencoded` or `multipart/form-data`. The comparison is
case-insensitive (media types are case-insensitive per RFC 9110 §8.3.1) and ignores any
`; charset=…` parameter. Rejects requests with a wrong or missing content type with
`415 Unsupported Media Type`. Apply on form routes to prevent JSON-based CSRF attacks
that bypass browser same-site cookie protections:

    import { requireFormContentType } from "@y-core/forge/security"
    import { createController } from "@y-core/forge/router"

    export const controller = createController(routes, {
      actions: {
        contact: { middleware: [requireFormContentType(), csrfVerifyGuard], handler: contactHandler },
      },
    })

`requireFormContentType` is a factory — call it (`requireFormContentType()`) to get the
middleware. Do not use on API routes that accept JSON — apply only on HTML form
submission endpoints.

### 6b. HTMX Detection (moved)

`isHxRequest` was previously exported from `security`. It now lives in
`@y-core/forge/html/htmx` — see [HTMX.md](./HTMX.md) §1 for usage.

It remains a UX routing hint, not a security boundary. Always pair with `originGuard`
or `crossOriginProtection` for actual enforcement.

---

## 7. Transport-Layer Boundary

### 7a. What Belongs in security

The security namespace covers transport-layer concerns only:

- HTTP security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, etc.)
- CORS policy enforcement
- Origin verification (request origin matches allowlist)
- Request rate limiting (via Workers Rate Limiting binding)
- Request identity (request ID generation and propagation)
- Content type enforcement on incoming requests

All of these operate on the raw HTTP request/response layer, before any application
logic runs.

### 7b. What Does NOT Belong in security

| Feature | Correct namespace |
|---|---|
| CSRF token minting/verification | `@y-core/forge/form` |
| Session management | `@y-core/forge/session` — standard pattern: `createAnonymousSession` with KV-backed storage (opaque id-only cookie, server-side data + revocation); see `src/session/README.md` |
| Authentication (JWT, OAuth, magic links) | Future: `@y-core/forge/auth` |
| Permissions/RBAC | Future: `@y-core/forge/auth` |
| `timingSafeEqual` / `timingSafeEqualBytes` | Internal `src/crypto/` (`@internal`) |
| Input sanitization and schema validation | `@y-core/forge/form` / `@y-core/forge/validation` |

The security namespace does not know about users, sessions, or application state. Any
feature that requires reading session data or user identity belongs in a higher-level
namespace. This boundary keeps the security primitives composable and testable in
isolation.

---

## 8. Defense-in-Depth Across Namespaces

The security namespace is transport-layer only (§7), but several adjacent namespaces
carry hardening that backstops it. These belong to their own namespaces — they are
documented here so the full posture is visible in one place.

### 8a. JSX URL-Attribute Sanitization (`safeUrl`)

The JSX renderer routes every URL-bearing attribute value (`href`, `src`, `action`, and
the other URL attributes) through `safeUrl` (`@y-core/forge/http`) at render time.
`safeUrl` neutralizes dangerous schemes — `javascript:`, `vbscript:`, `data:`, including
whitespace/entity-obfuscated variants — to `"#"`. This is automatic; consumers do not
call it. It is a render-layer complement to the CSP nonce: a user-controlled URL cannot
become script execution even if it reaches an attribute.

### 8b. parseFormData Streaming Byte Cap (413)

`parseFormData(c)` (`@y-core/forge/form`) enforces a body-size budget two ways:

1. a `Content-Length` fast-path that rejects before reading the body, and
2. a **streaming byte cap** — the body is piped through a counting transform that errors
   once the running total exceeds `maxBytes`.

The streaming cap closes the header-only bypass: a request with an absent or lying
`Content-Length` (chunked transfer) is still capped. Oversized bodies surface as a `413`.
The default budget is `FORM_MAX_BYTES_DEFAULT` (100 KB), overridable via
`{ maxBytes }`.

### 8c. Fragment Option Escaping

`renderSuccess`/`renderError`/`renderValidationErrors` (`@y-core/forge/http`) escape not
only the message but also caller-supplied option values — the `class` override and the
`ulClass` override are run through `escapeHtml` before interpolation. A caller cannot
inject attributes or markup through a styling option.

### 8d. R2 Object Serving Hardening

`serveObject` (`@y-core/forge/storage/r2`) builds the `Content-Disposition` header with a
sanitized ASCII `filename="…"` fallback (C0 controls, `"`, and `\` stripped) **plus** an
RFC 5987 `filename*=UTF-8''…` parameter for non-ASCII names, so a crafted object key
cannot break out of the quoted string.

Signed object URLs (`createSignedObjectUrl`/`verifySignedObjectUrl`) HMAC a
**length-prefixed** payload — `${key.length}:${key}|${exp}` — so the `key`/`exp`
boundary is unambiguous even when the key itself contains the `|` delimiter. Verification
checks expiry first, then compares signatures in constant time
(`timingSafeEqualBytes`).

### 8e. Storage Binding Shape Checks

`validateKVBinding` / `validateR2Binding` / `validateD1Binding`
(`@y-core/forge/storage/{kv,r2,db}`) do a **functional-shape** check, not a mere presence
check: a KV binding must expose `get`/`put` as functions, an R2 binding its object
methods, a D1 binding `prepare` as a function. A string or number mistakenly bound to the
name is rejected at the boundary rather than failing deep inside a handler.

### 8f. Fallback 500 Carries Baseline Security Headers

When an error is thrown **outside** the middleware chain (router internals, before the
consumer's `createSecurityHeaders` can run), the app's last-resort 500 still ships a
baseline-hardened response: `Content-Type: text/html; charset=utf-8`,
`X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`, and
`Referrer-Policy: no-referrer`. Errors thrown **inside** the chain flow back through the
error boundary so the consumer's full security headers still apply (they
set-overwrite the baseline). No error path ships an unprotected response.
