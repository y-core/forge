---
title: Transport-Layer Hardening
description: "Content-Security-Policy with per-request nonces, CORS, origin and cross-origin guards, rate limiting and content-type checks — before any application logic runs."
---

# `@y-core/forge/security`

Transport-layer request/response hardening for Forge apps on Cloudflare Workers: Content-Security-Policy with per-request nonces, CORS, origin verification, cross-origin (Fetch Metadata) protection, rate limiting, request identity, and content-type guards.

This namespace operates on the raw HTTP layer — before any application logic runs. It does **not** know about users, sessions, or application state.

> **CSRF tokens live elsewhere.** Cross-Site Request Forgery token minting and verification are in [`@y-core/forge/form`](../form/) (`csrfProtection`, `mintCsrf`, `importCsrfKey`), not here. The origin-based guards in this namespace (`crossOriginProtection`, `originGuard`) are a complementary defense, not a token mechanism. See [Security](#security) below.

---

## Features

| Feature | Entry point |
| --- | --- |
| Security headers (CSP nonce, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy) | `createSecurityHeaders`, `applySecurityHeaders`, `mergeSecurityHeaders`, `getNonce`, `NONCE`, `TURNSTILE_CSP` |
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

Register `createSecurityHeaders` and `requestId` once at the app level; apply route-specific guards (`cors`, `originGuard`, `rateLimit`, `requireFormContentType`) only where needed.

> Apps composing the full global chain should prefer `applyMiddlewareChain` (`@y-core/forge/app`) — it registers these in the canonical order automatically (see [ROUTING_AND_MIDDLEWARE.md](../../docs/ROUTING_AND_MIDDLEWARE.md) §3e). The manual registrations below remain valid; the one ordering rule is that `createSecurityHeaders` precedes any nonce consumer (`requestId`/logging may come first).

```ts
import { createSecurityHeaders, requestId, cors, NONCE } from "@y-core/forge/security";

// App-wide: every response gets a fresh CSP nonce + hardened headers, and a request ID.
app.use("*", requestId());
app.use("*", createSecurityHeaders({ scriptSrc: ["'self'", NONCE] }));

// Route-scoped: CORS only on the API surface that is consumed cross-origin.
app.use("/api/*", cors({ origins: ["https://app.example.com"] }));
```

Inside a JSX view, read the per-request nonce to attach it to an inline `<script>`:

```tsx
import { getNonce } from "@y-core/forge/security";
import type { AppContext } from "@y-core/forge/context";

export function Page(c: AppContext) {
  const nonce = getNonce(c);
  return <script nonce={nonce} src='/assets/js/main.js' />;
}
```

`getNonce(c)` returns the nonce that `createSecurityHeaders` minted for the current request, or `""` when none is set — so always register `createSecurityHeaders` first.

---

## Core Components & APIs

### `createSecurityHeaders(options?)`

Middleware factory. Mints a fresh per-request nonce (16 random bytes, base64url-encoded), substitutes it into any directive containing the `NONCE` placeholder, and queues the full header set on the per-request pending-header channel (flushed once by the app's outer `applyHeaders` pass, rather than each middleware rebuilding its own `Response`).

Headers set on every response:

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | Strict policy — `default-src 'self'`, `style-src`/`font-src` defaulting to `'self'` and extensible via `styleSrc`/`fontSrc` (never `'unsafe-inline'`), `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `upgrade-insecure-requests`, plus your directives |
| `Strict-Transport-Security` | `max-age=<hstsMaxAge>; includeSubDomains; preload` (default `hstsMaxAge` = `63072000`) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Content-Type-Options` | `nosniff` |
| `Permissions-Policy` | `camera`, `microphone`, `geolocation`, `payment` — each `()` (disabled) unless allowlisted |
| `X-Frame-Options` | `DENY` |
| `Cross-Origin-Opener-Policy` | `same-origin`, overridable via `crossOriginOpenerPolicy` |
| `Cross-Origin-Resource-Policy` | `same-origin`, overridable via `crossOriginResourcePolicy` |
| `Cross-Origin-Embedder-Policy` | **not set** — opt in via `crossOriginEmbedderPolicy` |

Which headers are in this set, why `X-Frame-Options` is emitted although `frame-ancestors` already covers it, when to loosen each override, and why COEP is opt-in are [`SECURITY_HARDENING.md`](../../docs/SECURITY_HARDENING.md) §2e's.

`SecurityHeadersOptions`:

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `scriptSrc` | `CspSourceValue[]` | `["'self'", NONCE]` | CSP `script-src` |
| `connectSrc` | `CspSourceValue[]` | `["'self'"]` | CSP `connect-src` |
| `frameSrc` | `CspSourceValue[]` | `["'self'"]` | CSP `frame-src` |
| `imgSrc` | `CspSourceValue[]` | `["'self'", "data:"]` | CSP `img-src` |
| `styleSrc` | `CspSourceValue[]` | `["'self'"]` | CSP `style-src` — widen for a web-font CDN stylesheet |
| `fontSrc` | `CspSourceValue[]` | `["'self'"]` | CSP `font-src` — widen for a web-font CDN's font files |
| `workerSrc` | `CspSourceValue[]` | — | Emitted only when provided |
| `childSrc` | `CspSourceValue[]` | — | Emitted only when provided |
| `hstsMaxAge` | `number` | `63072000` | HSTS `max-age` in seconds |
| `permissionsPolicy` | `PermissionsPolicyOptions` | all disabled | `{ camera?, microphone?, geolocation?, payment? }` allowlists |
| `crossOriginOpenerPolicy` | `"same-origin" \| "same-origin-allow-popups" \| "unsafe-none"` | `"same-origin"` | COOP; loosen for OAuth/payment popup flows |
| `crossOriginResourcePolicy` | `"same-origin" \| "same-site" \| "cross-origin"` | `"same-origin"` | CORP; loosen for embeddable assets/APIs |
| `crossOriginEmbedderPolicy` | `"require-corp" \| "credentialless"` | — (not emitted) | COEP; opt-in only |

Every string source in every directive must be a single CSP source token: non-empty, and free of whitespace, `;`, `,` and control characters — a malformed entry silently breaks the whole policy, so it throws instead. `'unsafe-inline'` is rejected outright, case-insensitively, in every directive. The `NONCE` symbol is exempt (it is not a string). Both `createSecurityHeaders` (at construction) and `applySecurityHeaders` (per call) apply the rule.

```ts
import { createSecurityHeaders, NONCE, TURNSTILE_CSP, type SecurityHeadersOptions } from "@y-core/forge/security";

const headers: SecurityHeadersOptions = {
  scriptSrc: ["'self'", NONCE, TURNSTILE_CSP],
  connectSrc: ["'self'", TURNSTILE_CSP],
  frameSrc: ["'self'", TURNSTILE_CSP],
};

app.use("*", createSecurityHeaders(headers));
```

### `NONCE`

A `unique symbol` placeholder. Place it in a CSP directive's source array (`scriptSrc: ["'self'", NONCE]`); `createSecurityHeaders` substitutes the real per-request value (`'nonce-<base64url>'`) when the response is built.

> **Never emit `NONCE` to clients directly.** It is a build-time marker, not a header value. The actual nonce for a request is obtained via `getNonce(c)`.

### `TURNSTILE_CSP`

The Cloudflare Turnstile CDN origin (`"https://challenges.cloudflare.com"`) as a typed constant. Add it to `scriptSrc`, `connectSrc`, and `frameSrc` when Turnstile is active, rather than hardcoding the string.

> **It is no longer the only route for `script-src`.** `mountTurnstile` copies the page's own CSP nonce onto the `api.js` tag it injects, reading it from an already-nonced `<script>`'s `nonce` **property** — so `scriptSrc: ["'self'", NONCE, "'strict-dynamic'"]` covers Cloudflare's script and everything it loads in turn, with no CDN origin in `script-src` at all. `frameSrc` and `connectSrc` still need `TURNSTILE_CSP`: `strict-dynamic` governs script loading only, and the challenge runs in an iframe. A page that sets no nonce is unaffected — the tag is injected bare, and `scriptSrc: ["'self'", TURNSTILE_CSP]` is still the right shape for it.

### Widening `style-src` / `font-src`

Both default to `["'self'"]` and take a source list like any other directive, for a third-party stylesheet or font host. `mergeSecurityHeaders` concatenates them, and a directive the base omits falls back to its default before the concatenation — so merging `{ styleSrc: ["https://cdn.example.com"] }` onto a base that never mentioned `styleSrc` yields `style-src 'self' https://cdn.example.com`, keeping the app's own stylesheet.

```ts
const withCdnSheet = mergeSecurityHeaders(headers, { styleSrc: ["https://cdn.example.com"] });
```

> **For web fonts, prefer self-hosting over widening** — the asset pipeline's `fonts.downloads` fetches at build time and serves same-origin, needing no CSP change at all ([`../assets/README.md`](../assets/README.md)); why a font CDN is the wrong default is [`SECURITY_HARDENING.md`](../../docs/SECURITY_HARDENING.md) §2e's.

### `getNonce(context)`

Returns the per-request CSP nonce that `createSecurityHeaders` set on the context, or `""` when none is set. Use it in view components to attach the nonce to inline scripts.

#### Getting the nonce into your markup

There are exactly two supported paths, depending on whether the response passes through the middleware chain:

1. **Through the chain (normal case):** register `createSecurityHeaders` before any nonce consumer; views read the value with `getNonce(c)` and attach it to script tags. The `NONCE` placeholder in CSP directives is substituted with the same value, so the header and the markup always agree.

   ```tsx
   const nonce = getNonce(c);
   return <script nonce={nonce} src='/assets/js/main.js' />;
   ```

2. **Outside the chain (out-of-band responses):** mint your own nonce, render the markup with it, then harden the response with the same value so header and markup agree:

   ```ts
   const nonce = crypto.randomUUID().replaceAll("-", "");
   const page = htmlResponse(renderErrorPage(nonce));
   return applySecurityHeaders(page, { nonce });
   ```

**Failure mode:** `getNonce` never throws. If `createSecurityHeaders` did not run, it returns `""` — the empty `nonce` attribute will not satisfy the CSP, so the affected script fails closed (blocked) instead of executing unnonced. If scripts are unexpectedly blocked, check the middleware registration order first (see [ROUTING_AND_MIDDLEWARE.md §3d](../../docs/ROUTING_AND_MIDDLEWARE.md)).

### `applySecurityHeaders(response, options?)`

Applies the full header set directly to a `Response`, returning a new `Response`. Use for out-of-band responses that never pass through the middleware chain (for example an error page produced before the chain runs). `options` is `ApplySecurityHeadersOptions` — all `SecurityHeadersOptions` fields plus an optional explicit `nonce`; when `options.nonce` is omitted a fresh one is minted.

```ts
import { applySecurityHeaders } from "@y-core/forge/security";

const hardened = applySecurityHeaders(new Response("oops", { status: 500 }));

// With an explicit nonce (e.g. to match markup already rendered with it):
const withNonce = applySecurityHeaders(page, { scriptSrc: ["'self'", NONCE], nonce });
```

### `mergeSecurityHeaders(base, extra)`

Layers extra CSP sources onto a base `SecurityHeadersOptions`, concatenating each directive's source list (and shallow-merging `permissionsPolicy`, overriding `hstsMaxAge`). A directive the base omits falls back to its default before the concatenation, so merging onto a partial base never drops `'self'` or the nonce placeholder; `workerSrc` and `childSrc` have no default and stay absent unless one side provides them. Its canonical use — dev-only sources in the dev worker entry alone — is [`SECURITY_HARDENING.md`](../../docs/SECURITY_HARDENING.md) §2c's.

```ts
import { mergeSecurityHeaders } from "@y-core/forge/security";

const WRANGLER_LIVE_RELOAD_HASH = "'sha256-g5a3SrOYIecCloZ8S7M4xdT1pbYi6e7mjHrmwphRxfE='";

const devHeaders = mergeSecurityHeaders(headers, { scriptSrc: [WRANGLER_LIVE_RELOAD_HASH] });
```

### `cors(options)`

Middleware that adds CORS response headers for allowed origins and answers preflight (`OPTIONS`) requests with `204`. It validates the request `Origin` against the allowlist — exact strings or single-label subdomain wildcards (`https://*.example.com`). After `next()` returns it rebuilds the `Response` with a cloned `Headers`, then sets `Access-Control-Allow-Origin` and appends `Origin` to `Vary`.

**`Vary: Origin` is marked on every origin-dependent response, refusals included**, with one exception — `origins: ["*"]` without `credentials`, where the constant `"*"` means nothing varies. The rule that decides this, the cache-poisoning direction it closes, and the rebuild-rather-than-mutate ruling above it are [`SECURITY_HARDENING.md`](../../docs/SECURITY_HARDENING.md) §3a's. The allowlist is compiled once, at `cors()` time.

`CorsOptions`:

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `origins` | `string[]` | — (required) | Exact origins, `"*"`, or `"https://*.example.com"` patterns |
| `methods` | `string[]` | `GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS` | Preflight `Access-Control-Allow-Methods` |
| `allowedHeaders` | `string[]` | `["Content-Type"]` | Preflight `Access-Control-Allow-Headers` |
| `credentials` | `boolean` | `false` | Sets `Access-Control-Allow-Credentials` |
| `maxAge` | `number` | `86400` | Preflight cache duration (seconds) |

Combining `credentials: true` with a wildcard `"*"` origin throws at construction — the two are mutually exclusive per the CORS spec.

```ts
import { cors } from "@y-core/forge/security";

app.use("/api/*", cors({ origins: ["https://app.example.com", "https://*.preview.example.com"] }));
```

Apply `cors` only on routes consumed cross-origin — never globally.

### `matchOrigin(origin, patterns)`

Pure predicate: returns `true` when `origin` matches any entry in `patterns` exactly, or matches a single-label subdomain wildcard (`*` expands to one DNS label). Used internally by `cors`; exported for custom origin logic.

### `originGuard(allowedOrigins)`

Middleware that rejects requests whose `Origin`/`Referer` does not match the allowlist with `403 Forbidden`. Safe methods (`GET`, `HEAD`, `OPTIONS`, `TRACE`) are exempt, and a state-changing request carrying neither header is refused like a disallowed one ([`SECURITY_HARDENING.md`](../../docs/SECURITY_HARDENING.md) §3b).

```ts
import { originGuard } from "@y-core/forge/security";

app.use("/webhook/*", originGuard(["https://trusted.example.com"]));
```

### `verifyOrigin(request, allowedOrigins)`

Pure predicate behind `originGuard`. Checks the `Origin` header first, then falls back to the `Referer` origin, against `allowedOrigins`. Returns an `OriginResult` — a `GuardResult` alias, so the failure reason code lives in the single `error` field:

```ts
type OriginResult = { ok: true } | { ok: false; error: "missing" | "disallowed" };
// ≡ GuardResult<"missing" | "disallowed"> from @y-core/forge/result
```

Use it for one-off in-handler checks instead of route-wide middleware.

```ts
import { verifyOrigin } from "@y-core/forge/security";

const result = verifyOrigin(c.request, allowedOrigins);
if (!result.ok) return new Response("Forbidden", { status: 403 });
```

### `rateLimit(options)`

Middleware that enforces a Cloudflare Workers Rate Limiting binding. Resolves the binding per request via `limiter(c)`, computes a key, and calls `binding.limit({ key })`; on failure it returns the `onLimit` response (default `429`).

`RateLimitOptions`:

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `limiter` | `(c) => RateLimitBinding \| undefined` | — (required) | Resolves the binding from app context |
| `key` | `(c) => string` | see `trustCfHeaders` | The rate-limit key. Always overrides the default, whatever `trustCfHeaders` says |
| `onLimit` | `(c) => Response \| Promise<Response>` | `429 Too many requests` | Response when the limit is exceeded |
| `required` | `boolean` | `true` | When `true`, returns `503` if the binding is absent; `false` skips the check |
| `trustCfHeaders` | `boolean` | `false` | Opts the **default** key into reading `CF-Connecting-IP`. Left at `false` with no custom `key`, the default resolver throws and the request fails closed with `503` |

```ts
import { rateLimit, type RateLimitBinding } from "@y-core/forge/security";

interface AppEnv {
  RATE_LIMITER: RateLimitBinding;
}

const rateLimitGuard = rateLimit<AppEnv>({
  limiter: (c) => c.env.RATE_LIMITER,
  trustCfHeaders: true, // this Worker runs behind Cloudflare — key by CF-Connecting-IP
  required: false, // dev-graceful: skip when the binding is absent
});
```

Declare the binding in `wrangler.jsonc`:

```jsonc
"ratelimits": [
  { "name": "RATE_LIMITER", "namespace_id": "1001", "simple": { "limit": 5, "period": 60 } }
]
```

Under `trustCfHeaders: true` an **absent** `CF-Connecting-IP` still fails closed with `503`. The trust boundary itself — which surfaces carry the flag, and how `applyMiddlewareChain` threads one value to all of them — is [`SECURITY_HARDENING.md`](../../docs/SECURITY_HARDENING.md) §5c's.

#### Choosing a rate-limit key

The key defines _what_ gets throttled — pick it to match the abuse you are defending against:

| Strategy | Key | When |
| --- | --- | --- |
| Per-IP (the default, under `trustCfHeaders: true`) | `CF-Connecting-IP` header | Anonymous endpoints behind Cloudflare. Coarse: NAT/CGNAT users share an IP; botnets rotate IPs. |
| Per-session | `key: (c) => sessionCtx.get(c).id` | Session-bearing apps — throttles the actor, not the network. The `sessionCtx` import couples _your app_ (not forge) to `@y-core/forge/session`. |
| Route-scoped composite | `key: (c) => \`${c.url.pathname}:${c.request.headers.get("CF-Connecting-IP")}\`` | One shared binding across several routes, each with an independent budget per client. |

```ts
import { sessionCtx } from "@y-core/forge/session";

const perSession = rateLimit<AppEnv>({
  limiter: (c) => c.env.RATE_LIMITER,
  key: (c) => sessionCtx.get(c).id, // register sessionMiddleware BEFORE this guard
});
```

A `key` function that throws (e.g. `sessionCtx.get` before the session middleware ran) fails closed with `503` — same as the missing-header case.

### `requestId()` / `requestIdCtx`

`requestId(options?)` is middleware that assigns a request ID, stores it in `requestIdCtx`, and sets the `x-request-id` response header. `requestIdCtx` is the typed context accessor for reading it back.

By default it always mints a `crypto.randomUUID()` and **ignores** any inbound `CF-Ray`. Pass `trustCfHeaders: true` to adopt `CF-Ray` instead, falling back to a UUID when it is absent, empty, or whitespace-only:

```ts
import { requestId, requestIdCtx } from "@y-core/forge/security";

app.use("*", requestId({ trustCfHeaders: true })); // behind Cloudflare — adopt CF-Ray

// Later, in a handler or logger:
const id = requestIdCtx.getOptional(c); // string | undefined
```

Register at the top of the middleware stack so downstream middleware (e.g. `requestLogger`) can correlate by request ID. Off Cloudflare, `CF-Ray` is client-supplied — which is why adopting it is opt-in ([`SECURITY_HARDENING.md`](../../docs/SECURITY_HARDENING.md) §5c).

### `requireFormContentType()`

Middleware that rejects requests whose `Content-Type` is not `application/x-www-form-urlencoded` or `multipart/form-data` with `415 Unsupported Media Type`. The comparison is case-insensitive (RFC 9110 §8.3.1) and ignores any `; charset=…` parameter. Apply only on HTML form endpoints — never on JSON API routes.

```ts
import { requireFormContentType } from "@y-core/forge/security";

app.use("/form/*", requireFormContentType());
```

### `parseUrl(input)`

Pure function. Parses a URL string into `ParsedUrl` (`{ origin, hostname, protocol }`). Throws on invalid input.

### `deriveAllowedOrigins(parsed, options?)`

Computes the allowed-origin list for a `ParsedUrl`. Always includes the base origin; pass `{ includeWww: true }` to also add the `www.`-prefixed variant for non-`www` hostnames. The variant carries the base origin's port, so a `BASE_URL` on a non-default port grants the `www` host on that same port and nothing else.

`{ extraOrigins: [...] }` appends further origins after those. Each entry must be a **normalized origin** — exactly what a browser puts in an `Origin` header, so no path, no trailing slash, no credentials, no redundant default port — and must be `https:` or an `http://localhost` / `http://127.0.0.1` loopback, the same rule `BaseUrlConfigSchema` applies. Anything else throws, which for a dev entrypoint is boot time. An entry already in the list is dropped, so passing the base origin back in is harmless.

```ts
import { parseUrl, deriveAllowedOrigins } from "@y-core/forge/security";

const parsed = parseUrl("https://example.com");
const origins = deriveAllowedOrigins(parsed, { includeWww: true });
// ["https://example.com", "https://www.example.com"]

deriveAllowedOrigins(parseUrl("https://example.com:8443"), { includeWww: true });
// ["https://example.com:8443", "https://www.example.com:8443"]

// dev worker entry only — browser at https://localhost:8787, no proxy in front
deriveAllowedOrigins(parseUrl(env.BASE_URL), { extraOrigins: ["https://localhost:8787"] });
```

> **Dev entrypoints only.** There is no env var for `extraOrigins` — extras arrive as a parameter from a dev worker entry that production never imports, so the production bundle structurally contains no extra origin, exactly as with the live-reload CSP hash above. Under the standard posture dev is https at every hop and no extra origin is needed at all; see [Dev is https at every hop](#dev-is-https-at-every-hop).

### `BaseUrlConfigSchema`

A Valibot schema that validates a URL string and transforms it into a `BaseUrlConfig` (`ParsedUrl` plus `allowedOrigins`). It rejects non-`https:` URLs, except `http://localhost` and `http://127.0.0.1` for local development. Use it to derive a deployment's allowed-origin list from a `BASE_URL` env var, then feed `config.allowedOrigins` into `cors`/`originGuard`.

```ts
import { BaseUrlConfigSchema } from "@y-core/forge/security";
import { v } from "@y-core/forge/validation";

const config = v.parse(BaseUrlConfigSchema, env.BASE_URL);
app.use("/api/*", cors({ origins: config.allowedOrigins }));
```

---

## Security

This namespace is **transport-layer only**. The guards below are the building blocks of the app's HTTP security posture; pair them according to the threat you are addressing.

### CSP nonces vs. inline scripts

`createSecurityHeaders` emits a strict CSP with **no `'unsafe-inline'`** for either `script-src` or `style-src`, so every inline `<script>` must carry the per-request nonce from `getNonce(c)`, and inline `style=` attributes are dropped by the JSX renderer. The fresh-nonce-per-request contract is [`SECURITY_HARDENING.md`](../../docs/SECURITY_HARDENING.md) §2a's, and which headers are in the emitted set and why — including that widening `styleSrc`/`fontSrc` never introduces `'unsafe-inline'` — is §2e's.

### CSRF defense lives in two places

| Layer | Mechanism | Where |
| --- | --- | --- |
| Token-based CSRF | Per-session token mint + verify | `@y-core/forge/form` (`csrfProtection`, `mintCsrf`) |
| Origin-based CSRF | Fetch Metadata / Origin allowlist | This namespace (`crossOriginProtection`, `originProtection`, `originGuard`) |
| Content-type defense | Reject non-form bodies on form routes | This namespace (`requireFormContentType`) |

The origin guards here are **not** a token mechanism — they are a complementary defense. Token CSRF protection comes from `@y-core/forge/form`. A typical form route combines all three: `requireFormContentType()`, an origin/cross-origin guard, and the form-namespace CSRF verify.

#### `crossOriginProtection(options?)` / `checkCrossOriginProtection(request, options?)`

Rejects state-changing requests (anything other than `GET`/`HEAD`/`OPTIONS`/`TRACE`) with `403` unless the browser **Fetch Metadata** `Sec-Fetch-Site` header says `same-origin` or `none`, and rejects a request carrying no such header unless `allowMissingHeader: true` is passed. It matches Go's `http.CrossOriginProtection`. Why `same-site` is rejected too — the allowlist-not-denylist reading — is [`SECURITY_HARDENING.md`](../../docs/SECURITY_HARDENING.md) §3e's.

`checkCrossOriginProtection` is the pure predicate form, returning a `CrossOriginResult` (a `GuardResult` alias — `{ ok: true } | { ok: false; error: "missing-fetch-metadata" | "cross-site" | "same-site" }`, with the failure reason code in `.error`) so you can branch on it instead of auto-rejecting. `same-site` is reported distinctly from `cross-site` because the two describe different attackers — a sibling subdomain you may partly control, versus an unrelated origin.

```ts
import { crossOriginProtection } from "@y-core/forge/security";

app.use("/form/*", crossOriginProtection());
```

| `CrossOriginProtectionOptions` field | Type | Default | Notes |
| --- | --- | --- | --- |
| `allowMissingHeader` | `boolean` | `false` | When `true`, allows requests with no `Sec-Fetch-Site` header |

#### `originProtection(options)`

A combined guard for mutating routes: Fetch Metadata **and** an `Origin`/`Referer` allowlist, both applied. Safe methods are always exempt. It is the **recommended default** of the three origin guards; which tier to reach for, and why `Sec-Fetch-Site` is a veto rather than a pass, are [`SECURITY_HARDENING.md`](../../docs/SECURITY_HARDENING.md) §3e's.

> **List the app's own origin in `allowedOrigins`**, or its own same-origin mutations are rejected.

`OriginProtectionOptions`:

| Field | Type | Notes |
| --- | --- | --- |
| `allowedOrigins` | `string[] \| (c) => string[]` | Static list, or a per-request resolver over the app context (e.g. parsed `BASE_URL` config). Consulted on **every** mutating request carrying `Origin`/`Referer` — must include the app's own origin |

```ts
import { originProtection } from "@y-core/forge/security";

app.use("/api/*", originProtection({ allowedOrigins: (c) => c.var.config.allowedOrigins }));
```

### Out-of-scope (do not look for it here)

| Concern | Where it lives |
| --- | --- |
| CSRF token mint/verify | `@y-core/forge/form` |
| Session management | `@y-core/forge/session` |
| Authentication / RBAC | `@y-core/forge/auth` |
| Constant-time comparison | Internal `src/crypto/` (`@internal`) |
| HTMX request detection (`isHxRequest`) | `@y-core/forge/html/htmx` (a UX hint, not a security boundary) |

---

## Advanced

### Out-of-band responses keep their headers

Responses produced **outside** the middleware chain (router internals, a 500 thrown before the chain runs) never see `createSecurityHeaders`. Use `applySecurityHeaders(response, options?)` to harden them explicitly (pass `options.nonce` to reuse a nonce already embedded in the markup). The app's last-resort `500` already ships a baseline-hardened response of its own — that baseline, and the three error paths it belongs to, are [`ERROR_HANDLING.md`](../../docs/ERROR_HANDLING.md) §5b's.

### Dev/prod CSP split without leakage

Keep dev-only CSP sources (live-reload hashes, local tooling origins) out of the production policy by computing them in the dev worker entry only, via `mergeSecurityHeaders` — the containment guarantee this buys is [`SECURITY_HARDENING.md`](../../docs/SECURITY_HARDENING.md) §2c's:

```ts
import { createSecurityHeaders, mergeSecurityHeaders } from "@y-core/forge/security";

// production base — shared
export const baseHeaders = { scriptSrc: ["'self'", NONCE] };

// dev worker entry (src/worker.dev.ts) — never imported by production
export default createWorker(createSecurityHeaders(mergeSecurityHeaders(baseHeaders, { scriptSrc: [WRANGLER_LIVE_RELOAD_HASH] })));
```

The hash cannot reach production because production never imports the dev entry.

### Deriving origins from a single `BASE_URL`

`BaseUrlConfigSchema` collapses environment configuration into one source of truth: validate `BASE_URL` once at boot, then feed `allowedOrigins` into every origin-aware guard (`cors`, `originGuard`, `originProtection`). Because `originProtection.allowedOrigins` accepts a resolver, you can keep the parsed config on the context and resolve per request, so a single env change updates CORS, origin guards, and cross-origin protection together.

### Dev is https at every hop

**Symptom:** every write in local development 403s, while the same code is fine in production. The origin guards compare origins by exact string, so a dev server speaking `http` behind a TLS-terminating proxy rejects the browser's `https` origin — its own forms included.

**What to do:** serve https at every hop in dev — the proxy's canonical origin, `BASE_URL`, and the dev server's own protocol all agreeing — and reach for `extraOrigins` only in the proxy-less case. The posture — including why the scheme is never patched up in middleware and why HSTS and `Secure` cookies stay hardcoded — is [`WORKERS_PLATFORM.md`](../../warden/canon/apps/WORKERS_PLATFORM.md) §4e's; how `allowedOrigins` is derived here, and what `extraOrigins` may hold, are [`SECURITY_HARDENING.md`](../../docs/SECURITY_HARDENING.md) §3f's.

---

## See also

- [`@y-core/forge/form`](../form/) — CSRF tokens, form parsing with byte caps
- [`@y-core/forge/session`](../session/) — session cookies and middleware
- [`@y-core/forge/http`](../http/) — `safeUrl` URL sanitization, response fragments
- [`SECURITY_HARDENING.md`](../../docs/SECURITY_HARDENING.md) — the header
  factory and its nonce contract (§2), origin-guard tiering (§3e), deriving `allowedOrigins` in dev
  (§3f), rate-limit key selection (§4d), and the Cloudflare header trust boundary (§5c)
- [`WORKERS_PLATFORM.md`](../../warden/canon/apps/WORKERS_PLATFORM.md) §4e — the https-everywhere
  development transport posture the origin guards depend on
