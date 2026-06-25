# `@y-core/forge/security`

Transport-layer request/response hardening for Forge apps on Cloudflare Workers: Content-Security-Policy with per-request nonces, CORS, origin verification, cross-origin (Fetch Metadata) protection, rate limiting, request identity, and content-type guards.

This namespace operates on the raw HTTP layer — before any application logic runs. It does **not** know about users, sessions, or application state.

> **CSRF tokens live elsewhere.** Cross-Site Request Forgery token minting and verification are in [`@y-core/forge/form`](../form/) (`csrfProtection`, `mintCsrf`, `importCsrfKey`), not here. The origin-based guards in this namespace (`crossOriginProtection`, `originGuard`) are a complementary defense, not a token mechanism. See [Security](#security) below.

---

## Features

| Feature | Entry point |
|---|---|
| Security headers (CSP nonce, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy) | `makeSecurityHeaders`, `applySecurityHeaders`, `mergeSecurityHeaders`, `getNonce`, `NONCE`, `TURNSTILE_CSP` |
| CORS | `cors`, `matchOrigin` |
| Origin allowlist enforcement | `originGuard`, `verifyOrigin` |
| Cross-origin (Fetch Metadata) protection | `crossOriginProtection`, `checkCrossOriginProtection`, `originProtection` |
| Rate limiting (Cloudflare binding) | `rateLimit` |
| Request identity | `requestId`, `requestIdCtx` |
| Content-type guard | `requireFormContentType` |
| URL / origin config | `parseUrl`, `deriveAllowedOrigins`, `BaseUrlConfigSchema` |

All middleware factories return a Forge `Middleware` (`@remix-run/fetch-router`). Pure predicates (`matchOrigin`, `verifyOrigin`, `checkCrossOriginProtection`, `parseUrl`, `deriveAllowedOrigins`) take plain inputs and return plain results — register them as middleware only via their wrapping factories.

---

## Usage

Register `makeSecurityHeaders` and `requestId` once at the app level; apply route-specific guards (`cors`, `originGuard`, `rateLimit`, `requireFormContentType`) only where needed.

```typescript
import {
  makeSecurityHeaders,
  requestId,
  cors,
  NONCE,
} from "@y-core/forge/security";

// App-wide: every response gets a fresh CSP nonce + hardened headers, and a request ID.
app.use("*", requestId());
app.use("*", makeSecurityHeaders({ scriptSrc: ["'self'", NONCE] }));

// Route-scoped: CORS only on the API surface that is consumed cross-origin.
app.use("/api/*", cors({ origins: ["https://app.example.com"] }));
```

Inside a JSX view, read the per-request nonce to attach it to an inline `<script>`:

```tsx
import { getNonce } from "@y-core/forge/security";
import type { AppContext } from "@y-core/forge/context";

export function Page(c: AppContext) {
  const nonce = getNonce(c);
  return <script nonce={nonce} src="/assets/js/main.js" />;
}
```

`getNonce(c)` returns the nonce that `makeSecurityHeaders` minted for the current request, or `""` when none is set — so always register `makeSecurityHeaders` first.

---

## Core Components & APIs

### `makeSecurityHeaders(options?)`

Middleware factory. Mints a fresh per-request nonce (16 random bytes, base64url-encoded), substitutes it into any directive containing the `NONCE` placeholder, and queues the full header set on the per-request pending-header channel (flushed once by the app's outer `applyHeaders` pass, rather than each middleware rebuilding its own `Response`).

Headers set on every response:

| Header | Value |
|---|---|
| `Content-Security-Policy` | Strict policy — `default-src 'self'`, `style-src 'self'` (no `'unsafe-inline'`), `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `upgrade-insecure-requests`, plus your directives |
| `Strict-Transport-Security` | `max-age=<hstsMaxAge>; includeSubDomains; preload` (default `hstsMaxAge` = `63072000`) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Content-Type-Options` | `nosniff` |
| `Permissions-Policy` | `camera`, `microphone`, `geolocation`, `payment` — each `()` (disabled) unless allowlisted |
| `X-Frame-Options` | `DENY` |

`SecurityHeadersOptions`:

| Field | Type | Default | Notes |
|---|---|---|---|
| `scriptSrc` | `CspSourceValue[]` | `["'self'", NONCE]` | CSP `script-src` |
| `connectSrc` | `CspSourceValue[]` | `["'self'"]` | CSP `connect-src` |
| `frameSrc` | `CspSourceValue[]` | `["'self'"]` | CSP `frame-src` |
| `imgSrc` | `CspSourceValue[]` | `["'self'", "data:"]` | CSP `img-src` |
| `workerSrc` | `CspSourceValue[]` | — | Emitted only when provided |
| `childSrc` | `CspSourceValue[]` | — | Emitted only when provided |
| `hstsMaxAge` | `number` | `63072000` | HSTS `max-age` in seconds |
| `permissionsPolicy` | `PermissionsPolicyOptions` | all disabled | `{ camera?, microphone?, geolocation?, payment? }` allowlists |

The factory rejects empty or whitespace-only directive source entries (which would silently break the policy) by throwing at construction time.

```typescript
import { makeSecurityHeaders, NONCE, TURNSTILE_CSP, type SecurityHeadersOptions } from "@y-core/forge/security";

const headers: SecurityHeadersOptions = {
  scriptSrc:  ["'self'", NONCE, TURNSTILE_CSP],
  connectSrc: ["'self'", TURNSTILE_CSP],
  frameSrc:   ["'self'", TURNSTILE_CSP],
};

app.use("*", makeSecurityHeaders(headers));
```

### `NONCE`

A `unique symbol` placeholder. Place it in a CSP directive's source array (`scriptSrc: ["'self'", NONCE]`); `makeSecurityHeaders` substitutes the real per-request value (`'nonce-<base64url>'`) when the response is built.

> **Never emit `NONCE` to clients directly.** It is a build-time marker, not a header value. The actual nonce for a request is obtained via `getNonce(c)`.

### `TURNSTILE_CSP`

The Cloudflare Turnstile CDN origin (`"https://challenges.cloudflare.com"`) as a typed constant. Add it to `scriptSrc`, `connectSrc`, and `frameSrc` when Turnstile is active, rather than hardcoding the string.

### `getNonce(context)`

Returns the per-request CSP nonce that `makeSecurityHeaders` set on the context, or `""` when none is set. Use it in view components to attach the nonce to inline scripts.

### `applySecurityHeaders(response, options?, nonce?)`

Applies the full header set directly to a `Response`, returning a new `Response`. Use for out-of-band responses that never pass through the middleware chain (for example an error page produced before the chain runs). When no `nonce` is supplied a fresh one is minted.

```typescript
import { applySecurityHeaders } from "@y-core/forge/security";

const hardened = applySecurityHeaders(new Response("oops", { status: 500 }));
```

### `mergeSecurityHeaders(base, extra)`

Layers extra CSP sources onto a base `SecurityHeadersOptions`, concatenating each directive's source list (and shallow-merging `permissionsPolicy`, overriding `hstsMaxAge`). The canonical use is adding dev-only sources — such as the Wrangler live-reload inline-script hash — in the dev worker entry only, so they cannot leak into production by construction.

```typescript
import { mergeSecurityHeaders } from "@y-core/forge/security";

const WRANGLER_LIVE_RELOAD_HASH = "'sha256-g5a3SrOYIecCloZ8S7M4xdT1pbYi6e7mjHrmwphRxfE='";

const devHeaders = mergeSecurityHeaders(headers, {
  scriptSrc: [WRANGLER_LIVE_RELOAD_HASH],
});
```

### `cors(options)`

Middleware that adds CORS response headers for allowed origins and answers preflight (`OPTIONS`) requests with `204`. It validates the request `Origin` against the allowlist — exact strings or single-label subdomain wildcards (`https://*.example.com`). After `next()` returns it **rebuilds** the `Response` with a cloned `Headers` (the downstream response may carry immutable headers), then sets `Access-Control-Allow-Origin` and appends `Origin` to `Vary`.

`CorsOptions`:

| Field | Type | Default | Notes |
|---|---|---|---|
| `origins` | `string[]` | — (required) | Exact origins, `"*"`, or `"https://*.example.com"` patterns |
| `methods` | `string[]` | `GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS` | Preflight `Access-Control-Allow-Methods` |
| `allowedHeaders` | `string[]` | `["Content-Type"]` | Preflight `Access-Control-Allow-Headers` |
| `credentials` | `boolean` | `false` | Sets `Access-Control-Allow-Credentials` |
| `maxAge` | `number` | `86400` | Preflight cache duration (seconds) |

Combining `credentials: true` with a wildcard `"*"` origin throws at construction — the two are mutually exclusive per the CORS spec.

```typescript
import { cors } from "@y-core/forge/security";

app.use("/api/*", cors({ origins: ["https://app.example.com", "https://*.preview.example.com"] }));
```

Apply `cors` only on routes consumed cross-origin — never globally.

### `matchOrigin(origin, patterns)`

Pure predicate: returns `true` when `origin` matches any entry in `patterns` exactly, or matches a single-label subdomain wildcard (`*` expands to one DNS label). Used internally by `cors`; exported for custom origin logic.

### `originGuard(allowedOrigins)`

Middleware that rejects requests whose `Origin`/`Referer` does not match the allowlist with `403 Forbidden`. Safe methods (`GET`, `HEAD`, `OPTIONS`, `TRACE`) are exempt. Requests with no `Origin` and no `Referer` are treated as missing and rejected.

```typescript
import { originGuard } from "@y-core/forge/security";

app.use("/webhook/*", originGuard(["https://trusted.example.com"]));
```

### `verifyOrigin(request, allowedOrigins)`

Pure predicate behind `originGuard`. Checks the `Origin` header first, then falls back to the `Referer` origin, against `allowedOrigins`. Returns an `OriginResult`:

```typescript
type OriginResult = { ok: true } | { ok: false; reason: "missing" | "disallowed" };
```

Use it for one-off in-handler checks instead of route-wide middleware.

```typescript
import { verifyOrigin } from "@y-core/forge/security";

const result = verifyOrigin(c.request, allowedOrigins);
if (!result.ok) return new Response("Forbidden", { status: 403 });
```

### `rateLimit(options)`

Middleware that enforces a Cloudflare Workers Rate Limiting binding. Resolves the binding per request via `limiter(c)`, computes a key, and calls `binding.limit({ key })`; on failure it returns the `onLimit` response (default `429`).

`RateLimitOptions`:

| Field | Type | Default | Notes |
|---|---|---|---|
| `limiter` | `(c) => RateLimitBinding \| undefined` | — (required) | Resolves the binding from app context |
| `key` | `(c) => string` | `CF-Connecting-IP` header | The rate-limit key; **supply your own off Cloudflare** |
| `onLimit` | `(c) => Response \| Promise<Response>` | `429 Too many requests` | Response when the limit is exceeded |
| `required` | `boolean` | `true` | When `true`, returns `503` if the binding is absent; `false` skips the check |

```typescript
import { rateLimit, type RateLimitBinding } from "@y-core/forge/security";

interface AppEnv {
  RATE_LIMITER: RateLimitBinding;
}

const rateLimitGuard = rateLimit<AppEnv>({
  limiter: (c) => c.env.RATE_LIMITER,
  required: false, // dev-graceful: skip when the binding is absent
});
```

Declare the binding in `wrangler.jsonc`:

```jsonc
"ratelimits": [
  { "name": "RATE_LIMITER", "namespace_id": "1001", "simple": { "limit": 5, "period": 60 } }
]
```

> The default key (`CF-Connecting-IP`) is only trustworthy when the Worker runs behind Cloudflare. On other platforms a client can forge it — always supply a custom `key`. If the default key throws because the header is absent, the request fails closed with `503`.

### `requestId()` / `requestIdCtx`

`requestId()` is middleware that propagates the `CF-Ray` header (or a generated `crypto.randomUUID()` when absent) as the request ID: it stores the value in `requestIdCtx` and sets the `x-request-id` response header. `requestIdCtx` is the typed context accessor for reading it back.

```typescript
import { requestId, requestIdCtx } from "@y-core/forge/security";

app.use("*", requestId());

// Later, in a handler or logger:
const id = requestIdCtx.getOptional(c); // string | undefined
```

Register at the top of the middleware stack so downstream middleware (e.g. `requestLogger`) can correlate by request ID.

> Off Cloudflare, `CF-Ray` is client-supplied and untrusted — treat the echoed value as a correlation hint, not a verified identifier.

### `requireFormContentType()`

Middleware that rejects requests whose `Content-Type` is not `application/x-www-form-urlencoded` or `multipart/form-data` with `415 Unsupported Media Type`. The comparison is case-insensitive (RFC 9110 §8.3.1) and ignores any `; charset=…` parameter. Apply only on HTML form endpoints — never on JSON API routes.

```typescript
import { requireFormContentType } from "@y-core/forge/security";

app.use("/form/*", requireFormContentType());
```

### `parseUrl(input)`

Pure function. Parses a URL string into `ParsedUrl` (`{ origin, hostname, protocol }`). Throws on invalid input.

### `deriveAllowedOrigins(parsed, options?)`

Computes the allowed-origin list for a `ParsedUrl`. Always includes the base origin; pass `{ includeWww: true }` to also add the `www.`-prefixed variant for non-`www` hostnames.

```typescript
import { parseUrl, deriveAllowedOrigins } from "@y-core/forge/security";

const parsed = parseUrl("https://example.com");
const origins = deriveAllowedOrigins(parsed, { includeWww: true });
// ["https://example.com", "https://www.example.com"]
```

### `BaseUrlConfigSchema`

A Valibot schema that validates a URL string and transforms it into a `BaseUrlConfig` (`ParsedUrl` plus `allowedOrigins`). It rejects non-`https:` URLs, except `http://localhost` and `http://127.0.0.1` for local development. Use it to derive a deployment's allowed-origin list from a `BASE_URL` env var, then feed `config.allowedOrigins` into `cors`/`originGuard`.

```typescript
import { BaseUrlConfigSchema } from "@y-core/forge/security";
import { v } from "@y-core/forge/validation";

const config = v.parse(BaseUrlConfigSchema, env.BASE_URL);
app.use("/api/*", cors({ origins: config.allowedOrigins }));
```

---

## Security

This namespace is **transport-layer only**. The guards below are the building blocks of the app's HTTP security posture; pair them according to the threat you are addressing.

### CSP nonces vs. inline scripts

`makeSecurityHeaders` emits a strict CSP with **no `'unsafe-inline'`** for either `script-src` or `style-src`. Every inline `<script>` must carry the per-request nonce from `getNonce(c)`; inline `style=` attributes are dropped by the JSX renderer because the policy forbids them. A static nonce defeats the mechanism — the factory always mints a fresh one per request.

### CSRF defense lives in two places

| Layer | Mechanism | Where |
|---|---|---|
| Token-based CSRF | Per-session token mint + verify | `@y-core/forge/form` (`csrfProtection`, `mintCsrf`) |
| Origin-based CSRF | Fetch Metadata / Origin allowlist | This namespace (`crossOriginProtection`, `originProtection`, `originGuard`) |
| Content-type defense | Reject non-form bodies on form routes | This namespace (`requireFormContentType`) |

The origin guards here are **not** a token mechanism — they are a complementary defense. Token CSRF protection comes from `@y-core/forge/form`. A typical form route combines all three: `requireFormContentType()`, an origin/cross-origin guard, and the form-namespace CSRF verify.

#### `crossOriginProtection(options?)` / `checkCrossOriginProtection(request, options?)`

Rejects state-changing requests (anything other than `GET`/`HEAD`/`OPTIONS`/`TRACE`) flagged `cross-site` by the browser **Fetch Metadata** `Sec-Fetch-Site` header with `403`. Requests with no `Sec-Fetch-Site` header are rejected by default (fail-closed) unless `allowMissingHeader: true` is passed.

`checkCrossOriginProtection` is the pure predicate form, returning `CopResult` (`{ ok: true } | { ok: false; reason: string }`) so you can branch on it instead of auto-rejecting.

```typescript
import { crossOriginProtection } from "@y-core/forge/security";

app.use("/form/*", crossOriginProtection());
```

| `CrossOriginProtectionOptions` field | Type | Default | Notes |
|---|---|---|---|
| `allowMissingHeader` | `boolean` | `false` | When `true`, allows requests with no `Sec-Fetch-Site` header |

#### `originProtection(options)`

A combined guard for mutating routes. Fetch Metadata is authoritative when `Sec-Fetch-Site` is present (cross-site → `403`); when the header is absent it falls back to an `Origin`/`Referer` allowlist check. Safe methods are always exempt.

`OriginProtectionOptions`:

| Field | Type | Notes |
|---|---|---|
| `allowedOrigins` | `string[] \| (c) => string[]` | Static list, or a per-request resolver over the app context (e.g. parsed `BASE_URL` config) |

```typescript
import { originProtection } from "@y-core/forge/security";

app.use("/api/*", originProtection({
  allowedOrigins: (c) => c.var.config.allowedOrigins,
}));
```

### Rate-limit key trust

The default `rateLimit` key (`CF-Connecting-IP`) is forgeable off Cloudflare. Off-Cloudflare deployments must pass a custom `key`; use `required: true` (default) on production-only routes so a misconfigured binding fails closed with `503` rather than silently disabling the limit.

### Out-of-scope (do not look for it here)

| Concern | Where it lives |
|---|---|
| CSRF token mint/verify | `@y-core/forge/form` |
| Session management | `@y-core/forge/session` |
| Authentication / RBAC | Future `@y-core/forge/auth` |
| Constant-time comparison | Internal `src/crypto/` (`@internal`) |
| HTMX request detection (`isHxRequest`) | `@y-core/forge/html/htmx` (a UX hint, not a security boundary) |

---

## Advanced

### Out-of-band responses keep their headers

Responses produced **outside** the middleware chain (router internals, a 500 thrown before the chain runs) never see `makeSecurityHeaders`. Use `applySecurityHeaders(response, options?, nonce?)` to harden them explicitly. The app's last-resort `500` already ships a baseline-hardened response (`X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`, `Referrer-Policy: no-referrer`), so no error path emits an unprotected response.

### Dev/prod CSP split without leakage

Keep dev-only CSP sources (live-reload hashes, local tooling origins) out of the production policy by computing them in the dev worker entry only, via `mergeSecurityHeaders`:

```typescript
import { makeSecurityHeaders, mergeSecurityHeaders } from "@y-core/forge/security";

// production base — shared
export const baseHeaders = { scriptSrc: ["'self'", NONCE] };

// dev worker entry (src/worker.dev.ts) — never imported by production
export default createWorker(
  makeSecurityHeaders(
    mergeSecurityHeaders(baseHeaders, { scriptSrc: [WRANGLER_LIVE_RELOAD_HASH] }),
  ),
);
```

The hash cannot reach production because production never imports the dev entry.

### Deriving origins from a single `BASE_URL`

`BaseUrlConfigSchema` collapses environment configuration into one source of truth: validate `BASE_URL` once at boot, then feed `allowedOrigins` into every origin-aware guard (`cors`, `originGuard`, `originProtection`). Because `originProtection.allowedOrigins` accepts a resolver, you can keep the parsed config on the context and resolve per request, so a single env change updates CORS, origin guards, and cross-origin protection together.

---

## See also

- [`@y-core/forge/form`](../form/) — CSRF tokens, form parsing with byte caps
- [`@y-core/forge/session`](../session/) — session cookies and middleware
- [`@y-core/forge/http`](../http/) — `safeUrl` URL sanitization, response fragments
- `.decisions/SECURITY_HARDENING.md` — governing architecture and defense-in-depth posture
