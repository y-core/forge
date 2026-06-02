---
title: Security Hardening
description: "makeSecurityHeaders, CSP nonce, NONCE constant, mergeSecurityHeaders, CORS, originGuard, verifyOrigin, crossOriginProtection, rateLimit, requestId, requireFormContentType, isHxRequest, transport-layer only, CSRF not in security, auth boundary"
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
- §2 makeSecurityHeaders and CSP nonce: factory, NONCE constant, mergeSecurityHeaders
- §3 CORS and origin protection: cors(), originGuard, verifyOrigin, crossOriginProtection
- §4 Rate limiting: rateLimit() with Workers binding
- §5 Request identity: requestId(), requestIdCtx contextVar
- §6 Content guards: requireFormContentType, isHxRequest
- §7 Transport-layer boundary: what is NOT in security

---

## 1. Security Namespace Exports

From `@y-core/forge/security` (`src/security/mod.ts`):

- `makeSecurityHeaders(options)` — middleware factory for security headers
- `mergeSecurityHeaders(base, override)` — merge two SecurityHeadersOptions
- `NONCE` — constant string `"'nonce-{nonce}'"` for CSP scriptSrc
- `requestId()` — middleware: injects X-Request-Id, sets requestIdCtx
- `requestIdCtx` — contextVar accessor for the request ID string
- `isHxRequest(c)` — returns true if HX-Request header is present
- `requireFormContentType` — middleware: enforces application/x-www-form-urlencoded
- `cors(options)` — CORS middleware factory
- `matchOrigin(url, allowed)` — utility: checks if URL matches allowed origins
- `crossOriginProtection(options)`, `checkCrossOriginProtection` — CSRF-via-origin guards
- `originGuard(allowed)`, `verifyOrigin(req, allowed)` — origin allowlist enforcement
- `rateLimit(options)` — Workers rate limiting middleware
- `BaseUrlConfigSchema`, `deriveAllowedOrigins`, `parseUrl` — URL/origin config helpers
- Type exports: `CorsOptions`, `CrossOriginProtectionOptions`, `RateLimitBinding/Options`,
  `RequestIdContext`, `SecureHeadersContext`, `BaseUrlConfig`, `SecurityHeadersOptions`, etc.

NOT in security (common mistake to avoid):

- `timingSafeEqual`/`timingSafeEqualBytes` — in internal `src/crypto/` (`@internal`)
- `csrfProtection`, `importCsrfKey`, `mintCsrf` — in `@y-core/forge/form`
- `sessionMiddleware` — in `@y-core/forge/session`

---

## 2. makeSecurityHeaders and CSP Nonce

### 2a. makeSecurityHeaders Factory Pattern

`makeSecurityHeaders` generates a unique nonce per request (via `crypto.getRandomValues`),
injects it into the CSP `script-src` directive, and stores it in context via
`SecureHeadersContext`. Every request gets a fresh nonce — static nonces defeat the
purpose of CSP nonce enforcement.

    import { makeSecurityHeaders, NONCE, type SecurityHeadersOptions } from "@y-core/forge/security"

    const securityHeaders: SecurityHeadersOptions = {
      scriptSrc: ["'self'", NONCE, "https://challenges.cloudflare.com"],
      connectSrc: ["'self'", "https://challenges.cloudflare.com"],
      frameSrc:   ["'self'", "https://challenges.cloudflare.com"],
    }

    app.use("*", makeSecurityHeaders(securityHeaders))

Register once at the app level via `app.use("*", ...)` so all routes inherit the headers.

### 2b. NONCE Constant

`NONCE` is the string literal `"'nonce-{nonce}'"` — a placeholder in `scriptSrc` that
`makeSecurityHeaders` replaces with the actual per-request nonce value at runtime.
Using the constant (rather than a hand-written string) makes the placeholder
recognizable and avoids typos.

The generated nonce is stored in context and retrieved via `getNonce(c)` for use in
inline `<script>` tags:

    import { getNonce } from "@y-core/forge/security"

    // Inside a Hono JSX view component
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

    export function MyPage(c: Context) {
      const nonce = getNonce(c)
      return <script nonce={nonce} src="/assets/js/main.js" />
    }

`getNonce` reads from `SecureHeadersContext`; it will throw if called before
`makeSecurityHeaders` runs, so always register the middleware first.

---

## 3. CORS and Origin Protection

### 3a. cors Middleware for API Routes

Apply CORS headers only on routes that need them. Derive `allowedOrigins` from the
`BaseUrlConfig` so the allowed list matches the deployed environment automatically:

    import { cors } from "@y-core/forge/security"

    app.use("/api/*", cors({ origins: config.site.url.allowedOrigins }))

Do not apply `cors()` globally — it is only needed on endpoints consumed cross-origin.

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

    const { ok } = verifyOrigin(c.req.raw, allowedOrigins)
    if (!ok) return c.text("Forbidden", 403)

`verifyOrigin` inspects the `Origin` header and returns `{ ok: boolean }`.

### 3d. crossOriginProtection and checkCrossOriginProtection

`crossOriginProtection()` is a middleware that enforces same-origin for state-changing
requests (`POST`, `PUT`, `PATCH`, `DELETE`) by comparing the `Origin` and `Referer`
headers against the configured base URL:

    import { crossOriginProtection } from "@y-core/forge/security"

    app.use("/form/*", crossOriginProtection({ baseUrl: config.site.url.base }))

`checkCrossOriginProtection(req, options)` performs the same check as a plain function,
returning a `CrossOriginProtectionOptions` result without wrapping in middleware. Use when
you need the check result to drive conditional logic rather than an automatic rejection.

> Note: `crossOriginProtection` checks Origin/Referer headers — it is not a CSRF token
> mechanism. CSRF token minting and verification live in `@y-core/forge/form`. See §7.

---

## 4. Rate Limiting with Workers Binding

### 4a. rateLimit Middleware Factory

`rateLimit` wraps the Cloudflare Workers Rate Limiting binding. Apply per-route, not
globally, to target high-risk endpoints (form submissions, API mutations):

    import { rateLimit } from "@y-core/forge/security"

    const rateLimitGuard = rateLimit<AppEnv>({
      limiter: (c) => c.env.RATE_LIMITER,
      required: false, // graceful: skip if binding absent (dev)
    })

    app.post("/contact", rateLimitGuard, contactHandler)

### 4b. required: false for Dev Graceful Degradation

Setting `required: false` means the middleware no-ops when the `RATE_LIMITER` binding is
absent (local dev without wrangler bindings). In production the binding is always present.
Setting `required: true` (default) causes a startup error if the binding is missing —
use this in production-only routes where rate limiting is non-negotiable.

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

    import { requestLogger } from "@y-core/forge/logger"
    import { requestIdCtx } from "@y-core/forge/security"

    app.use("*", requestLogger({
      bindings: (c) => ({ requestId: requestIdCtx.getOptional(c) }),
    }))

Because `requestId()` runs first, the logger always finds the ID already set.

---

## 6. Content Type Guards

### 6a. requireFormContentType

Middleware that enforces `Content-Type: application/x-www-form-urlencoded`. Rejects
requests with a wrong or missing content type with `415 Unsupported Media Type`. Apply
on form `POST` routes to prevent JSON-based CSRF attacks that bypass browser same-site
cookie protections:

    import { requireFormContentType } from "@y-core/forge/security"

    app.post("/contact", requireFormContentType, contactHandler)

Do not use on API routes that accept JSON — apply only on HTML form submission endpoints.

### 6b. isHxRequest — HTMX-Only Enforcement

`isHxRequest(c)` returns `true` if the `HX-Request: true` header is present, indicating
the request originated from an HTMX trigger. Use to restrict partial-HTML endpoints to
HTMX consumers only:

    import { isHxRequest } from "@y-core/forge/security"

    app.get("/partials/results", (c) => {
      if (!isHxRequest(c)) return c.text("Forbidden", 403)
      return c.html(<ResultsPartial />)
    })

`HX-Request` is a client-supplied header and can be spoofed — treat it as a UX guard,
not a security boundary. Pair with `originGuard` or `crossOriginProtection` for actual
enforcement.

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
| Session management | `@y-core/forge/session` |
| Authentication (JWT, OAuth, magic links) | Future: `@y-core/forge/auth` |
| Permissions/RBAC | Future: `@y-core/forge/auth` |
| `timingSafeEqual` / `timingSafeEqualBytes` | Internal `src/crypto/` (`@internal`) |
| Input sanitization and schema validation | `@y-core/forge/form` / `@y-core/forge/validation` |

The security namespace does not know about users, sessions, or application state. Any
feature that requires reading session data or user identity belongs in a higher-level
namespace. This boundary keeps the security primitives composable and testable in
isolation.
