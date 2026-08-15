---
title: Security Hardening
description: "The security namespace: CSP nonce headers, CORS, origin-guard tiering, rate limiting, request identity, and the Cloudflare-header trust boundary."
---

# Security Hardening

> Owns the `security` namespace — transport-layer request/response hardening only — and the
> `trustCfHeaders` trust boundary. CSP, CORS, origin verification, rate limiting, request
> identity. Authentication, sessions, and RBAC are out of scope (§7).
>
> Defers to: [`INPUT_VALIDATION.md`](./INPUT_VALIDATION.md) for CSRF, honeypot, Turnstile, and
> the form body cap; [`ROUTING_AND_MIDDLEWARE.md`](./ROUTING_AND_MIDDLEWARE.md) for middleware
> placement; [`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §2d and §5b for fragment-option escaping
> and the baseline-hardened 500; [`STORAGE_BINDINGS.md`](./STORAGE_BINDINGS.md) §3b, §3c, §4a
> for R2 serving, signed URLs, and binding shape checks.

---

## 0. Quick Reference

- §1 What Is Not in security: the four symbols routinely looked for here
- §2 createSecurityHeaders and CSP Nonce: the header factory and its nonce contract
- §2a createSecurityHeaders Factory Pattern: per-request nonce, queued headers
- §2b NONCE Constant: the CSP placeholder
- §2c mergeSecurityHeaders for Dev/Prod Split: layering the live-reload hash
- §2d getNonce and Automatic URL Sanitization: reading the nonce; `safeUrl` at render time
- §2e Default Header Set: which headers are emitted, which are opt-in, and which are a route concern
- §3 CORS and Origin Protection: the cross-origin guards
- §3a cors Middleware for API Routes: scoped application and response rebuild
- §3b originGuard — Strict Origin Allowlist: the Origin/Referer tier
- §3c verifyOrigin — Inline Origin Check: the in-handler form
- §3d crossOriginProtection — Fetch Metadata: the `Sec-Fetch-Site` tier
- §3e Origin-Guard Tiering — Which Guard When: pick one, never stack
- §4 Rate Limiting with Workers Binding: the limiter middleware
- §4a rateLimit Middleware Factory: per-route application
- §4b required false for Dev Graceful Degradation: the availability trade
- §4c Workers Rate Limiter Binding Configuration: wrangler and env typing
- §4d Rate-Limit Key Selection: the default key and its trust precondition
- §5 Request Identity: request-id generation and the CF trust boundary
- §5a requestId Middleware: generation and placement
- §5b Logging Integration: correlation through `requestIdCtx`
- §5c Cloudflare Header Trust Boundary — trustCfHeaders: the single owner of the flag
- §6 Content Type Guards: incoming-body enforcement
- §6a requireFormContentType: the 415 guard
- §7 Transport-Layer Boundary: pointer to the governance rule that owns it

---

## 1. What Is Not in security

`src/security/mod.ts` is authoritative for what this namespace exports, and
`src/security/README.md` documents each symbol.

**Not in security** — a common mistake:

| Looked for here | Actually in |
|---|---|
| `timingSafeEqual` / `timingSafeEqualBytes` | internal `src/crypto/` (`@internal`) |
| `csrfProtection`, `importCsrfKey`, `mintCsrf` | `@y-core/forge/form` |
| `sessionMiddleware` | `@y-core/forge/session` |
| `isHxRequest` | `@y-core/forge/html/htmx` — a UX hint, not a boundary ([`HTMX.md`](./HTMX.md) §7) |

---

## 2. createSecurityHeaders and CSP Nonce

### 2a. createSecurityHeaders Factory Pattern

`createSecurityHeaders` generates a fresh nonce per request (16 random bytes, base64url),
injects it into the CSP `script-src`, and stores it on the request context for `getNonce(c)`.

**Every request gets a fresh nonce** — a static nonce defeats nonce enforcement entirely.

**Computed headers are queued on the per-request pending-header channel** and flushed once by
the app's outermost `applyHeaders` pass, rather than each middleware rebuilding its own
`Response`.

**They are queued *before* `next()`, alongside the nonce.** Two consequences, both intended:

- **Error pages always carry them.** The headers are on the channel before anything deeper can
  throw, so they do not depend on the response unwinding back out through this middleware. Queuing
  them after `next()` instead would mean a guard registered downstream that throws yields a 500
  with no CSP and no HSTS.
- **Header-name conflicts resolve inner-wins.** `setPendingHeader` is last-writer-wins per name and
  a middleware registered deeper queues later, so a consumer middleware that queues an overlapping
  name overrides the security default rather than being overridden by it. Nothing inside forge
  overlaps — `createSecurityHeaders` owns its 8–9 names, `requestId` owns `x-request-id`, and
  session and flash use `set-cookie` with `{ append: true }` — so this is observable only from
  consumer middleware. Pinned in `src/security/headers.test.ts`.

Both the pending channel and a header baked into the handler's own `Response` are still resolved in
the channel's favour: `applyPendingHeaders` set-overwrites onto the response.

**Register once at app level via `app.use("*", …)`** so every route inherits the headers.

### 2b. NONCE Constant

`NONCE` is the literal `"'nonce-{nonce}'"` — a `scriptSrc` placeholder that
`createSecurityHeaders` replaces with the real per-request value. **Use the constant rather
than hand-writing the placeholder** so it stays recognizable and typo-free.

### 2c. mergeSecurityHeaders for Dev/Prod Split

`mergeSecurityHeaders(base, override)` deep-merges two `SecurityHeadersOptions`, concatenating
directive arrays.

**Use it exclusively in the dev entry point** to layer the Wrangler live-reload inline-script
hash onto the production CSP. **The live-reload hash must never appear in the production CSP** —
keeping it in the dev entry only means it cannot leak by construction.

### 2d. getNonce and Automatic URL Sanitization

`getNonce(c)` reads the per-request nonce for inline `<script nonce={…}>` attributes.

**It never throws: when the middleware has not run it returns `""`**, which renders an empty
`nonce` the CSP will not honour. **Register `createSecurityHeaders` before any nonce consumer**
(see [`ROUTING_AND_MIDDLEWARE.md`](./ROUTING_AND_MIDDLEWARE.md) §3d).

**URL attributes in JSX are sanitized automatically at render time.** The renderer routes
`href`, `src`, `action`, and the other URL-bearing attribute values through `safeUrl`
(`@y-core/forge/http`), which admits an allow-list of schemes and collapses everything else —
`javascript:`, `vbscript:`, `data:` — to `"#"`. Before matching the scheme it strips control
characters and whitespace, so `java\tscript:` and a leading-newline variant are caught. **It does
not decode HTML entities**, and does not need to: the same pass escapes the value, so an
entity-encoded payload is emitted with its `&` escaped and never re-decodes into a scheme in the
browser. `safeUrl` picks the scheme; escaping is what closes the entity route. **Consumers never
call either.** Together they are the render-layer complement to the nonce: a user-controlled URL
cannot become script execution even if it reaches an attribute.

**No `hx-*` attribute is covered by this**, in either half. Selector and JSON values cannot be
sanitized at all ([`HTMX.md`](./HTMX.md) §7); URL-valued `hx-*` attributes deliberately are not,
because `"#"` is a live same-origin request rather than a dead link once htmx fetches it
([`HTMX.md`](./HTMX.md) §7a).

### 2e. Default Header Set

The emitted defaults, and the reasoning where a choice was available:

`src/security/headers.ts` owns the emitted values. What this section owns is which headers are in
the set and why:

- **Emitted with a hardened default:** `Content-Security-Policy` (strict, per-request nonce),
  `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`,
  `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy`.
- **`X-Frame-Options` is emitted although `frame-ancestors` already covers it** — the redundancy is
  deliberate, for user agents that honour only the legacy header.
- **`Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy` each have a named override**
  (`crossOriginOpenerPolicy`, `crossOriginResourcePolicy`), because a popup-based OAuth or payment
  flow and an intentionally embeddable resource each need a looser value than the default.
- **`Cross-Origin-Embedder-Policy` is not emitted, and opting in is the caller's decision**
  (`crossOriginEmbedderPolicy`): `require-corp` breaks every subresource lacking a CORP or CORS
  opt-in, which is a site-wide behavioural change rather than a header default.
- **`Cache-Control` is deliberately not a blanket default.** Caching is a per-route decision
  (`definePage({ cache })`), and a namespace-wide value would either over-cache a private page or
  defeat caching everywhere.

---

## 3. CORS and Origin Protection

### 3a. cors Middleware for API Routes

**Apply CORS only on routes consumed cross-origin — never globally.** Derive `allowedOrigins`
from `BaseUrlConfig` so the list matches the deployed environment automatically.

**`cors()` rebuilds the downstream `Response` rather than mutating it in place.** A downstream
response may carry immutable headers, where in-place mutation would throw or silently no-op;
rebuilding with a fresh `Headers` clone is correct by construction.

### 3b. originGuard — Strict Origin Allowlist

Middleware that rejects any request whose `Origin` is not in the allowlist. Use on webhook or
privileged endpoints.

**Requests with no `Origin` header are allowed through** (same-origin browser requests, curl) —
`originGuard` only blocks cross-origin requests from non-listed origins.

### 3c. verifyOrigin — Inline Origin Check

For a one-off check inside a handler rather than as middleware. Takes the standard `Request`,
inspects `Origin`, and returns an `OriginResult` (`{ ok: boolean }`).

### 3d. crossOriginProtection — Fetch Metadata

`crossOriginProtection()` enforces same-origin for state-changing requests (anything other than
`GET`/`HEAD`/`OPTIONS`) using the browser `Sec-Fetch-Site` header.

**Requests labelled `cross-site` are rejected with `403`, and a missing header is rejected by
default (fail-closed)** unless `allowMissingHeader: true`.

`checkCrossOriginProtection(request, options)` performs the same check as a plain function,
returning a `GuardResult` alias with the reason code in `error`. Use it when the result must
drive conditional logic rather than an automatic rejection.

**The origin guards inspect browser-sent headers — they are not a CSRF token mechanism.** CSRF
minting and verification live in `@y-core/forge/form`.

### 3e. Origin-Guard Tiering — Which Guard When

Three middleware defend against cross-origin mutation. They form a deliberate tiering:
**pick one per route rather than stacking them.**

| Guard | Signal | When the signal is absent | Use when |
|---|---|---|---|
| `originProtection(options)` | `Sec-Fetch-Site` **and** the `Origin`/`Referer` allowlist, both applied | Falls back to Fetch-Metadata vouching; fails closed with no signal at all | **The default.** Broadest coverage — modern browsers plus older UAs |
| `crossOriginProtection(options)` | `Sec-Fetch-Site` only | Fails closed (`403`) unless `allowMissingHeader` | Stricter, no allowlist |
| `originGuard(allowed)` | `Origin`/`Referer` only | Allowed through | Webhook/privileged endpoints keyed purely on an origin allowlist |

**`originProtection` is the authoritative recommended default** — the other two are the
single-signal tiers it is built from.

All three exempt safe methods (`GET`/`HEAD`/`OPTIONS`/`TRACE`) first, so only state-changing
requests are gated. `originProtection` treats `Sec-Fetch-Site` as a **veto, not a pass**: any
value other than `same-origin`/`none` rejects outright, and a good value does *not* short-circuit
the allowlist. `allowedOrigins` — a static `string[]` or a per-request resolver — is consulted on
every mutating request carrying an `Origin` or `Referer`; only when both are absent does the guard
fall back to the browser's Fetch-Metadata vouching, and with no signal at all it fails closed.

Consequence: an app must list **its own origin** in `allowedOrigins`, or its own same-origin
mutations are rejected. Letting a present `Sec-Fetch-Site` short-circuit the allowlist is the
specific shortcut this rules out: the header is forgeable by any non-browser client, and skipping
the allowlist on it would put this tier in standing disagreement with `originGuard`, which enforces
the allowlist unconditionally.

`Sec-Fetch-Site` is also matched as an **allowlist**: `same-site` is rejected, not just
`cross-site`, since any sibling subdomain produces it.

`applyMiddlewareChain` wires `originProtection` for each guard group's `origin` option, so apps
using the canonical chain get the recommended tier by default.

---

## 4. Rate Limiting with Workers Binding

### 4a. rateLimit Middleware Factory

`rateLimit` wraps the Cloudflare Workers Rate Limiting binding. **Apply per-route, not
globally**, to target high-risk endpoints such as form submissions and API mutations.

### 4b. `required: false` for Dev Graceful Degradation

`required: false` makes the middleware a no-op when the binding is absent (local dev without
wrangler bindings).

**The default `required: true` returns `503` per request when the binding is missing** — use it
on production routes where rate limiting is non-negotiable, so a misconfigured binding fails
closed rather than silently disabling the limit.

### 4c. Workers Rate Limiter Binding Configuration

Declare the binding in `wrangler.jsonc` under `ratelimits` with a `name`, `namespace_id`, and a
`simple` `{ limit, period }`; then add that name to `AppEnv` typed as `RateLimitBinding`
(exported from `@y-core/forge/security`).

### 4d. Rate-Limit Key Selection

`RateLimitOptions.trustCfHeaders` (default `false`) controls whether the default key may read
`CF-Connecting-IP`:

- **`trustCfHeaders: true`** — the default key is `CF-Connecting-IP`; a missing header fails
  closed with `503`.
- **Default (`false`) with no custom `key`** — the default key resolver **throws → `503`**,
  refusing to key on a forgeable header.
- **A custom `key` always overrides**, regardless of `trustCfHeaders`. Supply one for
  non-Cloudflare deployments. A throwing `key` function likewise fails closed with `503`.

**§5c owns the trust rationale** and how `applyMiddlewareChain` threads one flag to every
surface. For key-selection strategy (per-IP vs per-session vs route-scoped composite), see
`src/security/README.md`.

---

## 5. Request Identity

### 5a. requestId Middleware

`requestId(options?)` generates a unique ID per request, sets the `X-Request-Id` response
header, and stores the value in `requestIdCtx`.

**Register at the top of the middleware stack** so all downstream middleware and handlers can
read it. Read it with `requestIdCtx.getOptional(c)`.

The inbound `CF-Ray` header is ignored unless `trustCfHeaders` is set — see §5c.

### 5b. Logging Integration

`requestLogger` reads `requestIdCtx` to correlate log entries across a request's lifetime.
**Because `requestId()` runs first, the logger always finds the ID already set** — see
[`STRUCTURED_LOGGING.md`](./STRUCTURED_LOGGING.md) §3c for the ordering rule.

### 5c. Cloudflare Header Trust Boundary — `trustCfHeaders`

`CF-Ray` and `CF-Connecting-IP` are injected by Cloudflare's edge and are trustworthy **only
when the request actually transited that edge**. A Worker reachable directly — a custom origin,
another platform, a misrouted deployment — receives whatever a client chose to send, so
adopting those headers unconditionally lets a client forge its own request id or rate-limit key.

**Forge therefore defaults to distrust: the CF headers are used only when the caller opts in
with `trustCfHeaders: true`.**

The flag surfaces in three places, all defaulting to `false`:

| Surface | With `trustCfHeaders: true` | Default |
|---|---|---|
| `requestId({ trustCfHeaders })` | Adopt `CF-Ray` as the id (UUID fallback) | Always mint a UUID; ignore `CF-Ray` |
| `RateLimitOptions.trustCfHeaders` (§4d) | Default key reads `CF-Connecting-IP` | Default keying throws → `503` unless a custom `key` is given |
| `MiddlewareChainOptions.trustCfHeaders` | Threaded to `requestId()` and every guard group's rate-limit guard | Both distrust the CF headers |

**`applyMiddlewareChain` takes a single `trustCfHeaders` and threads it to both**, so an app
declares its trust posture once:

```typescript
applyMiddlewareChain(app, {
  trustCfHeaders: true,   // this Worker runs behind Cloudflare
  securityHeaders: { scriptSrc: ["'self'", NONCE] },
  guards: [{ paths: ["/api/*"], rateLimit: { limiter: (c) => c.env.RATE_LIMITER } }],
})
```

**A Cloudflare-deployed app must set `trustCfHeaders: true` or pass a custom rate-limit `key`**
— otherwise the default keying fails closed with `503`.

---

## 6. Content Type Guards

### 6a. requireFormContentType

Middleware factory enforcing a form content type — `application/x-www-form-urlencoded` or
`multipart/form-data`. The comparison is case-insensitive and ignores any `; charset=…`
parameter. A wrong or missing content type is rejected with `415`.

**Apply on HTML form submission endpoints to prevent JSON-based CSRF that bypasses same-site
cookie protections. Do not use on API routes that accept JSON.**

**It is a factory — call it**: `requireFormContentType()`.

---

## 7. Transport-Layer Boundary

See [`BOUNDARIES.md`](../governance/BOUNDARIES.md) §2 for the transport-versus-application
boundary: what `security` may hold, what belongs to a higher-level namespace, and why identity
is application-layer.
