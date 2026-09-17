---
title: Transport-Layer Hardening
description: "Hardening a Forge app before any handler runs: CSP with per-request nonces, cross-origin guards, CORS, rate limiting, and request identity."
audience: consumer
---

# `@y-core/forge/security`

Everything about an HTTP request that is decided before your handler sees it: which scripts the browser may run, which origins may talk to you, how
often one client may knock, and what to call this request in the logs.

This namespace works on the raw HTTP layer only. It knows nothing about users, sessions or application state — the boundary is
[`BOUNDARIES.md`][boundaries-2] §2's.

```ts
import { cors, createSecurityHeaders, getNonce, NONCE, originProtection, rateLimit, requestId } from "@y-core/forge/security";
```

**CSRF tokens are not here.** Minting and verifying them is `@y-core/forge/form`'s work; the origin guards below are a complementary defence, not a
token mechanism. See [Security][sec-anchor].

---

## Getting started

Two middleware belong at app level, on every route: a request id, and the security headers.

```ts
app.use("*", requestId());
app.use("*", createSecurityHeaders({ scriptSrc: ["'self'", NONCE] }));
```

`createSecurityHeaders` mints a fresh nonce per request, substitutes it wherever the `NONCE` placeholder appears in your directives, and queues the
whole header set on the request's pending-header channel — the app makes a single flushing pass, so no middleware here rebuilds a `Response` merely
to add a header. Which headers are in that set, and why each default is what it is, are [`SECURITY_HARDENING.md`][sh-2e] §2e's.

**The one ordering rule:** `createSecurityHeaders` runs before anything that reads the nonce. `requestId` may come first.

Everything else is route-scoped. Apply each guard where it belongs and nowhere else:

```ts
app.use("/api/*", cors({ origins: ["https://app.example.com"] }));
app.use("/form/*", originProtection({ allowedOrigins: config.allowedOrigins }));
```

An app composing the full global chain should prefer `applyMiddlewareChain` (`@y-core/forge/app`), which registers these in the canonical order for
you ([`ROUTING_AND_MIDDLEWARE.md`][ram-3e] §3e).

---

## Putting the nonce on a script tag

The emitted policy carries no `'unsafe-inline'`, so a `<script>` runs only if it carries this request's nonce. `getNonce(c)` is how markup gets it.

```tsx
export function Page(c: AppContext) {
  const nonce = getNonce(c);
  return <script nonce={nonce} src='/assets/js/main.js' />;
}
```

Header and markup cannot disagree: the `NONCE` placeholder resolves to exactly the value `getNonce` returns.

A response built **outside** the middleware chain — an error page raised before the chain runs, say — was never seen by `createSecurityHeaders`.
Mint the nonce yourself, render with it, then harden the response with that same value:

```ts
const nonce = crypto.randomUUID().replaceAll("-", "");
return applySecurityHeaders(htmlResponse(renderErrorPage(nonce)), { nonce });
```

`applySecurityHeaders` takes every option `createSecurityHeaders` takes, plus that optional `nonce`, and mints a fresh one when you omit it. The
app's last-resort `500` already ships baseline-hardened on its own — that path is [`FORGE_ERRORS.md`][eh-5b] §5b's.

**`getNonce` never throws; it answers `""`.** A forgotten `createSecurityHeaders` registration therefore shows up as scripts silently blocked — the
empty attribute satisfies no policy, so the script fails closed rather than running unnonced. When a script is not running, check middleware order
first ([`ROUTING_AND_MIDDLEWARE.md`][ram-3d] §3d).

---

## Widening the policy for a third-party origin

A directive you pass replaces its default outright, so name `'self'` and `NONCE` again when you widen one. `scriptSrc`, `connectSrc`, `frameSrc`,
`imgSrc`, `styleSrc` and `fontSrc` all have defaults; `workerSrc` and `childSrc` have none and are emitted only when you pass them.

For Cloudflare Turnstile, `TURNSTILE_CSP` is the CDN origin as a constant, so the string is never spelled out in the app:

```ts
app.use(
  "*",
  createSecurityHeaders({
    scriptSrc: ["'self'", NONCE, TURNSTILE_CSP],
    connectSrc: ["'self'", TURNSTILE_CSP],
    frameSrc: ["'self'", TURNSTILE_CSP],
  }),
);
```

**`script-src` has a second route.** `mountTurnstile` copies the page's own nonce onto the `api.js` tag it injects, reading it off an already-nonced
`<script>`'s `nonce` **property**, so `scriptSrc: ["'self'", NONCE, "'strict-dynamic'"]` covers Cloudflare's script and everything it loads in turn,
with no CDN origin in `script-src` at all. `frameSrc` and `connectSrc` still need `TURNSTILE_CSP`: `strict-dynamic` governs script loading only, and
the challenge itself runs in an iframe. A page that sets no nonce gets a bare tag, and wants the first shape.

To widen a directive on top of an options object you already have, `mergeSecurityHeaders` concatenates each source list, backfilling a directive the
base never mentioned with its default before the concatenation:

```ts
const withCdnSheet = mergeSecurityHeaders(baseHeaders, { styleSrc: ["https://cdn.example.com"] });
// style-src 'self' https://cdn.example.com — the app's own stylesheet survives
```

**For web fonts, self-host rather than widen.** The asset pipeline's `fonts.downloads` fetches at build time and serves same-origin, needing no CSP
change at all ([`src/tooling/assets/README.md`][assets-readme]); why a font CDN is the wrong default is [`SECURITY_HARDENING.md`][sh-2e] §2e's.

---

## Opting out of a CSP restriction

Every unsafe CSP keyword stays reachable, but only as a symbol you import by name. The string spelling throws in every directive,
case-insensitively, at both entry points — `createSecurityHeaders` at construction and `applySecurityHeaders` per call. So a policy snippet pasted
from elsewhere can never widen the emitted header, and a real weakening is greppable as an `UNSAFE_` import and visible in the diff. Why that
asymmetry is the control is [`SECURITY_HARDENING.md`][sh-2e] §2e's.

The choice you are making is how much you hand back:

| Import | Hands back |
| --- | --- |
| `WASM_UNSAFE_EVAL` | WebAssembly compilation, and no JavaScript `eval` — the narrowest, and what a Wasm consumer actually needs |
| `UNSAFE_HASHES` | Hashed inline event handlers (`onclick="…"`), without admitting an inline `<script>` block |
| `UNSAFE_EVAL` | `eval` and `new Function` — which re-opens htmx's `hx-on:*` compilation ([`HTMX.md`][htmx-7b] §7b) |
| `UNSAFE_INLINE` | Every inline `<script>` and `<style>` — the whole nonce contract |

Reach down that table from the top, never up from the bottom.

```ts
// script-src 'self' 'nonce-<base64url>' 'wasm-unsafe-eval'
app.use("*", createSecurityHeaders({ scriptSrc: ["'self'", NONCE, WASM_UNSAFE_EVAL] }));

// Throws, and the message names WASM_UNSAFE_EVAL as the way to say it deliberately.
createSecurityHeaders({ scriptSrc: ["'self'", "'wasm-unsafe-eval'"] });
```

A symbol goes in any source list and renders as its token in that directive alone; `mergeSecurityHeaders` carries one through like any
other source. `UnsafeCspSource` is the union type, should you need to name it.

**`UNSAFE_INLINE` beside a nonce or a hash throws.** CSP Level 3 has the browser ignore `'unsafe-inline'` in any directive that also carries a nonce
or a hash source, so that pair is an opt-out which cannot take effect; the validator refuses it at construction rather than emit a header reading as
though it had worked. State the directive without the nonce instead: `scriptSrc: ["'self'", UNSAFE_INLINE]`.

That bites through a merge too. `scriptSrc` defaults to `["'self'", NONCE]` and `mergeSecurityHeaders` backfills that default, so merging
`{ scriptSrc: [UNSAFE_INLINE] }` onto a base that never mentioned `scriptSrc` yields `'self'`, the nonce and `UNSAFE_INLINE` together — and throws.
Name the whole directive in the merge, nonce omitted, when that is the policy you want.

---

## Keeping dev-only sources out of the production policy

Compute dev-only CSP sources — a live-reload hash, a local tooling origin — in the dev worker entry, never in the shared base:

```ts
// src/worker.dev.ts — production never imports this file
const WRANGLER_LIVE_RELOAD_HASH = "'sha256-g5a3SrOYIecCloZ8S7M4xdT1pbYi6e7mjHrmwphRxfE='";

app.use("*", createSecurityHeaders(mergeSecurityHeaders(baseHeaders, { scriptSrc: [WRANGLER_LIVE_RELOAD_HASH] })));
```

The hash cannot reach production, because production never imports the entry that names it. The containment guarantee is
[`SECURITY_HARDENING.md`][sh-2c] §2c's.

---

## Guarding a mutating route

`originProtection` is the one to reach for by default: it applies Fetch Metadata **and** an `Origin`/`Referer` allowlist, exempting safe methods
(`GET`, `HEAD`, `OPTIONS`, `TRACE`) before either.

```ts
app.use("/form/*", originProtection({ allowedOrigins: config.allowedOrigins }));

// Or resolve per request, so a config change reaches the guard without a redeploy of the route table:
app.use("/api/*", originProtection<AppEnv>({ allowedOrigins: (c) => originsFor(c.env) }));
```

> **List the app's own origin in `allowedOrigins`**, or its own same-origin mutations are refused.

The two single-signal tiers `originProtection` is built from are exported too — `crossOriginProtection` (Fetch Metadata only) and `originGuard` (the
allowlist only, taking a plain `string[]`). Which to reach for, why `same-site` is refused alongside `cross-site`, and why `Sec-Fetch-Site` is a
veto rather than a pass are [`SECURITY_HARDENING.md`][sh-3e] §3e's. **Pick one tier per route; do not stack them.**

`crossOriginProtection` fails closed on a request carrying no `Sec-Fetch-Site` at all. A [`DevAllowance`][dev-readme] granting
`missingFetchMetadata`, passed as `dev`, accepts it instead — and only a development entry can mint one.

For a one-off check inside a handler rather than a route-wide middleware, the pure predicates behind the middleware take plain inputs and return
plain results:

```ts
const result = verifyOrigin(c.request, allowedOrigins);
if (!result.ok) return new Response("Forbidden", { status: 403 });
```

`checkCrossOriginProtection(request, options?)` is the Fetch-Metadata equivalent. Both answer a `GuardResult`, so the reason code is in `.error` —
`"missing" | "disallowed"` for origins, `"missing-fetch-metadata" | "cross-site" | "same-site"` for Fetch Metadata. `same-site` is reported apart
from `cross-site` because the two describe different attackers: a sibling subdomain you may partly control, versus an unrelated origin.

An HTML form endpoint wants one guard more. `requireFormContentType()` answers `415` to anything whose `Content-Type` is not
`application/x-www-form-urlencoded` or `multipart/form-data`, comparing case-insensitively (RFC 9110 §8.3.1) and ignoring any `; charset=…`. Apply
it on form routes only — never on a JSON API.

```ts
app.use("/form/*", requireFormContentType());
```

---

## Opening an API to another origin

```ts
app.use("/api/*", cors({ origins: ["https://app.example.com", "https://*.preview.example.com"] }));
```

`cors` answers preflights with `204` and adds the CORS headers to allowed responses, rebuilding the response rather than mutating headers that may
be immutable. An `origins` entry is either an exact origin or a single-label subdomain wildcard: `*` expands to one DNS label and stops at `.`, `/`,
`:`, `@`, `?` and `#`, so `https://a/b.example.com` does not match `https://*.example.com`. The allowlist compiles once, at `cors()` time.
`matchOrigin(origin, patterns)` is the same test, exported for custom origin logic.

The rest of the options are the trade-offs you are choosing between: `methods` and `allowedHeaders` (what the preflight advertises), `maxAge` (how
long a browser may cache that preflight, default `86400` seconds), and `credentials` (off by default, and the only one with a safety interlock).
**`credentials: true` with a `"*"` origin throws at construction** — the CORS spec makes the two mutually exclusive.

`Vary: Origin` is marked on every origin-dependent response, refusals included. The single exception is `origins: ["*"]` without credentials, where
the constant answer varies on nothing. The cache-poisoning direction that closes is [`SECURITY_HARDENING.md`][sh-3a] §3a's.

**Apply `cors` on the routes actually consumed cross-origin, never globally.**

---

## Rate limiting a route

```ts
const rateLimitGuard = rateLimit<AppEnv>({
  limiter: (c) => c.env.RATE_LIMITER,
  trustCfHeaders: true, // this Worker runs behind Cloudflare — key by CF-Connecting-IP
});
```

Declare the binding in `wrangler.jsonc`:

```jsonc
"ratelimits": [
  { "name": "RATE_LIMITER", "namespace_id": "1001", "simple": { "limit": 5, "period": 60 } }
]
```

`limiter(c)` resolves the binding per request — its shape is the exported `RateLimitBinding` type. An absent binding answers `503`, unless a
[`DevAllowance`][dev-readme] granting `rateLimitOptional` is passed as `dev`, which skips the guard and logs a warning instead. Over the limit,
`onLimit(c)` answers; it defaults to `429`.

### Choosing the key

The key decides _what_ is throttled. Pick it for the abuse you are defending against.

| Strategy | Key | When |
| --- | --- | --- |
| Per-IP — the default, under `trustCfHeaders: true` | `CF-Connecting-IP` | Anonymous endpoints behind Cloudflare. Coarse: NAT users share an IP, and botnets rotate them |
| Per-session | `(c) => sessionCtx.get(c).id` | Session-bearing apps — throttles the actor rather than the network |
| Route-scoped composite | pathname plus the client key | One binding shared across several routes, each with an independent budget per client |

```ts
import { sessionCtx } from "@y-core/forge/session";

const perSession = rateLimit<AppEnv>({
  limiter: (c) => c.env.RATE_LIMITER,
  key: (c) => sessionCtx.get(c).id, // register sessionMiddleware BEFORE this guard
});
```

That import couples _your app_ to `@y-core/forge/session`; forge's own `security` namespace does not depend on it. A custom `key` always wins,
whatever `trustCfHeaders` says.

**Every failure here is closed, with `503`.** A `key` function that throws — `sessionCtx.get` before the session middleware ran, say — is refused;
so is an absent `CF-Connecting-IP` under `trustCfHeaders: true`; so is the default keying with no `trustCfHeaders` and no custom `key` at all. Why
the flag exists, and how `applyMiddlewareChain` threads one value to every surface that takes it, are [`SECURITY_HARDENING.md`][sh-5c] §5c's.

---

## Correlating requests in logs

```ts
app.use("*", requestId({ trustCfHeaders: true })); // behind Cloudflare — adopt CF-Ray

const id = requestIdCtx.getOptional(c); // string | undefined
```

`requestId` assigns an id, stores it under `requestIdCtx`, and queues `x-request-id` onto the response. Register it at the top of the stack so
everything downstream — `requestLogger` above all — can correlate by it.

By default it always mints a `crypto.randomUUID()` and **ignores** any inbound `CF-Ray`, because off Cloudflare that header is whatever the client
sent. With `trustCfHeaders: true` it adopts `CF-Ray`, falling back to a UUID when the header is absent, empty or whitespace-only.

---

## Deriving allowed origins from BASE_URL

One env var can feed every origin-aware guard. `BaseUrlConfigSchema` validates `BASE_URL` at boot and transforms it into a `BaseUrlConfig` — the
parsed origin, hostname and protocol, plus the derived `allowedOrigins`. It refuses anything that is not `https:`, excepting `http://localhost` and
`http://127.0.0.1` for local development.

```ts
import { BaseUrlConfigSchema } from "@y-core/forge/security";
import { v } from "@y-core/forge/validation";

const config = v.parse(BaseUrlConfigSchema, env.BASE_URL);
app.use("/api/*", cors({ origins: config.allowedOrigins }));
```

Feed the same `config.allowedOrigins` into `originGuard` and `originProtection` and one env change moves all three together.

Without the schema, `parseUrl(input)` gives the `ParsedUrl` and `deriveAllowedOrigins(parsed, options?)` the list. `{ includeWww: true }` adds the
`www.` variant of a non-`www` hostname, carrying the base origin's port — so a `BASE_URL` on a non-default port grants the `www` host on that same
port and nothing else.

```ts
deriveAllowedOrigins(parseUrl("https://example.com:8443"), { includeWww: true });
// ["https://example.com:8443", "https://www.example.com:8443"]
```

**A dev entrypoint can append more origins, and nothing else can.** `{ dev }` takes a [`DevAllowance`][dev-readme] carrying `extraOrigins`. Each
entry must be a normalized origin — exactly what a browser puts in an `Origin` header, so no path, no trailing slash, no credentials, no redundant
default port — and `https:` or an `http://localhost` / `http://127.0.0.1` loopback, the same rule the schema applies. Anything else throws, which in
a dev entry is boot time. An entry already in the list is dropped, so passing the base origin back in is harmless.

```ts
// dev worker entry only — browser at https://localhost:8787, no proxy in front
deriveAllowedOrigins(parseUrl(env.BASE_URL), { dev: devAllowance({ extraOrigins: ["https://localhost:8787"] }) });
```

There is no env var for this and no plain option: the token comes from `@y-core/forge/dev`, and `validate-dev-boundary` refuses that import from
anything but a `*.dev.ts` entry — so the production bundle structurally contains no extra origin. Under the standard posture none is needed at all;
what `extraOrigins` may hold, and how the set reaches the guards, are [`SECURITY_HARDENING.md`][sh-3f] §3f's.

---

## Security

This namespace is transport-layer only, and the guards above are building blocks rather than a posture. Pair them to the threat.

**CSRF defence lives in two places, and this namespace holds only one of them.**

| Layer | Mechanism | Where |
| --- | --- | --- |
| Token-based CSRF | Per-session token mint and verify | `@y-core/forge/form` — `csrfProtection`, `mintCsrf`, `importCsrfKey` |
| Origin-based CSRF | Fetch Metadata and the origin allowlist | Here — `originProtection`, `crossOriginProtection`, `originGuard` |
| Content-type defence | Refuse a non-form body on a form route | Here — `requireFormContentType` |

A typical form route combines all three: `requireFormContentType()`, one origin tier, and the form namespace's CSRF verify. The origin guards are
not a token mechanism and do not substitute for one.

**`NONCE` is never emitted to a client.** It is a placeholder symbol the header builder resolves, not a header value; the real nonce for a request
comes from `getNonce(c)` and from nowhere else.

**What is routinely looked for here lives elsewhere:** CSRF token mint and verify in `@y-core/forge/form`, session management in
`@y-core/forge/session`, authentication and RBAC in `@y-core/forge/auth`, and constant-time comparison in the internal `src/crypto/`
([`SECURITY_HARDENING.md`][sh-1] §1 has the full list). `isHxRequest` from `@y-core/forge/html/htmx` is a UX hint, not a security boundary.

---

## Gotchas

**Every write 403s locally while production is fine — the dev transport is the cause.** The origin guards compare origins by exact string, so a dev
server speaking `http` behind a TLS-terminating proxy refuses the browser's `https` origin, its own forms included. Serve https at every hop in dev
— the proxy's canonical origin, `BASE_URL`, and the dev server's own protocol all agreeing — and reach for `extraOrigins` only in the proxy-less
case. The posture, including why the scheme is never patched up in middleware, is [`WORKERS_PLATFORM.md`][wp-4e] §4e's.

**A pure predicate is not middleware.** `matchOrigin`, `verifyOrigin`, `checkCrossOriginProtection`, `parseUrl` and `deriveAllowedOrigins` take
plain inputs and return plain results. They reach a route only through the factory that wraps them.

**A malformed CSP source throws rather than shipping.** Every string source must be a single CSP source token — non-empty, and free of whitespace,
`;`, `,` and control characters — because a malformed entry silently breaks the whole policy instead of one directive.

---

## See also

- [`src/form/README.md`][form-readme] — CSRF tokens, and form parsing with byte caps
- [`src/session/README.md`][session-readme] — session cookies and the middleware that persists them
- [`src/http/README.md`][http-readme] — `safeUrl` sanitization, response builders, typed headers
- [`docs/SECURITY_HARDENING.md`][sh] — the header set and nonce contract (§2), origin-guard tiering (§3e), `allowedOrigins` in dev (§3f),
  rate-limit key selection (§4d), and the Cloudflare header trust boundary (§5c)
- [`WORKERS_PLATFORM.md`][wp-4e] §4e — the https-everywhere dev transport posture the origin guards depend on

[assets-readme]: ../tooling/assets/README.md
[boundaries-2]: ../../warden/canon/libs/BOUNDARIES.md#2-transport-versus-application-security-layer
[dev-readme]: ../dev/README.md
[eh-5b]: ../../docs/FORGE_ERRORS.md#5b-unexpected-errors--the-router-error-boundary
[form-readme]: ../form/README.md
[htmx-7b]: ../../docs/HTMX.md#7b-hx-on-is-the-one-family-htmx-evaluates
[http-readme]: ../http/README.md
[ram-3d]: ../../docs/ROUTING_AND_MIDDLEWARE.md#3d-security-middleware-placement
[ram-3e]: ../../docs/ROUTING_AND_MIDDLEWARE.md#3e-applymiddlewarechain-canonical-chain-builder
[sec-anchor]: #security
[session-readme]: ../session/README.md
[sh]: ../../docs/SECURITY_HARDENING.md
[sh-1]: ../../docs/SECURITY_HARDENING.md#1-what-is-not-in-security
[sh-2c]: ../../docs/SECURITY_HARDENING.md#2c-mergesecurityheaders-for-devprod-split
[sh-2e]: ../../docs/SECURITY_HARDENING.md#2e-default-header-set
[sh-3a]: ../../docs/SECURITY_HARDENING.md#3a-cors-middleware-for-api-routes
[sh-3e]: ../../docs/SECURITY_HARDENING.md#3e-origin-guard-tiering--which-guard-when
[sh-3f]: ../../docs/SECURITY_HARDENING.md#3f-deriving-allowedorigins-in-dev
[sh-5c]: ../../docs/SECURITY_HARDENING.md#5c-cloudflare-header-trust-boundary--trustcfheaders
[wp-4e]: ../../warden/canon/apps/WORKERS_PLATFORM.md#4e-development-transport-posture
