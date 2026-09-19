---
title: Security Hardening
description: "The security namespace: CSP nonce headers, CORS, origin-guard tiering, rate limiting, request identity, and the Cloudflare-header trust boundary."
audience: consumer
---

# Security Hardening

> Owns the `security` namespace — transport-layer request/response hardening only — and the `trustCfHeaders` trust boundary. CSP, CORS, origin
> verification, rate limiting, request identity. Authentication, sessions, and RBAC are out of scope (§7).
>
> Defers to: [`INPUT_VALIDATION.md`][iv] for CSRF, Turnstile, and the form body cap; [`ROUTING_AND_MIDDLEWARE.md`][ram] for middleware placement;
> [`FORGE_ERRORS.md`][eh-2d] §2d and §5b for fragment-option escaping and the baseline-hardened 500; [`STORAGE_BINDINGS.md`][sb-3b] §3b, §3c, §4a
> for R2 serving, signed URLs, and binding shape checks.

---

## 0. Quick Reference

- §1 What Is Not in security: the symbols routinely looked for here
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
- §3f Deriving allowedOrigins in Dev: `BASE_URL` as the source, the dev allowance's `extraOrigins` as the sole escape hatch
- §4 Rate Limiting with Workers Binding: the limiter middleware
- §4a rateLimit Middleware Factory: per-route application
- §4b The Dev Allowance for a Missing Binding: the availability trade, and the key it takes
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

`src/security/mod.ts` is authoritative for what this namespace exports, and `src/security/README.md` teaches how to use them.

**Not in security** — a common mistake:

| Looked for here | Actually in |
| --- | --- |
| `timingSafeEqual` / `timingSafeEqualBytes` | internal `src/crypto/` (`@internal`) |
| `csrfProtection`, `importCsrfKey`, `mintCsrf` | `@y-core/forge/form` |
| `sessionMiddleware` | `@y-core/forge/session` |
| `isHxRequest` | `@y-core/forge/html/htmx` — a UX hint, not a boundary ([`HTMX.md`][htmx-7] §7) |

---

## 2. createSecurityHeaders and CSP Nonce

### 2a. createSecurityHeaders Factory Pattern

`createSecurityHeaders` generates a fresh nonce per request (16 random bytes, base64url), injects it into the CSP `script-src`, and stores it on the
request context for `getNonce(c)`. That pairing is what lets an inline `<script>` run under a policy carrying no `'unsafe-inline'`: the script tag
names the nonce, the header names the same nonce, and nothing else in the document executes.

**Every request gets a fresh nonce** — a static nonce defeats nonce enforcement entirely.

**Only the nonce is per-request.** The CSP is rendered once at factory time into a template holding a NUL placeholder where the nonce goes, the
other headers are computed once and frozen, and a request does one `replaceAll` over the template. The placeholder is unreachable to a caller:
`CSP_SOURCE_TOKEN` is `/^[\x21-\x7e]+$/`, which excludes NUL, and `assertValidCspOptions` still throws from the factory — before the first request —
rather than from the render.

**Computed headers are queued on the per-request pending-header channel** and flushed once by the app's outermost `applyHeaders` pass, rather than
each middleware rebuilding its own `Response`.

**They are queued _before_ `next()`, alongside the nonce.** Two consequences, both intended:

- **Error pages always carry them.** The headers are on the channel before anything deeper can throw, so they do not depend on the response
  unwinding back out through this middleware. Queuing them after `next()` instead would mean a guard registered downstream that throws yields a 500
  with no CSP and no HSTS.
- **Header-name conflicts resolve inner-wins.** `setPendingHeader` is last-writer-wins per name and a middleware registered deeper queues later, so
  a consumer middleware that queues an overlapping name overrides the security default rather than being overridden by it. Nothing inside forge
  overlaps — `createSecurityHeaders` owns the names it sets, `requestId` owns `x-request-id`, and session and flash use `set-cookie` with
  `{ append: true }` — so this is observable only from consumer middleware. Pinned in `src/security/headers.test.ts`.

Both the pending channel and a header baked into the handler's own `Response` are still resolved in the channel's favour: `applyPendingHeaders`
set-overwrites onto the response.

**Register once at app level via `app.use("*", …)`** so every route inherits the headers.

### 2b. NONCE Constant

`NONCE` is the literal `"'nonce-{nonce}'"` — a `scriptSrc` placeholder that `createSecurityHeaders` replaces with the real per-request value. **Use
the constant rather than hand-writing the placeholder** so it stays recognizable and typo-free.

### 2c. mergeSecurityHeaders for Dev/Prod Split

`mergeSecurityHeaders(base, override)` deep-merges two `SecurityHeadersOptions`, concatenating directive arrays.

**Use it exclusively in the dev entry point** to layer the Wrangler live-reload inline-script hash onto the production CSP. **The live-reload hash
must never appear in the production CSP** — keeping it in the dev entry only means it cannot leak by construction.

### 2d. getNonce and Automatic URL Sanitization

`getNonce(c)` reads the per-request nonce for inline `<script nonce={…}>` attributes.

**It never throws: when the middleware has not run it returns `""`**, which renders an empty `nonce` the CSP will not honour. **Register
`createSecurityHeaders` before any nonce consumer** (see [`ROUTING_AND_MIDDLEWARE.md`][ram-3d] §3d).

**URL attributes in JSX are sanitized automatically at render time.** The renderer routes `href`, `src`, `action`, `formaction`, `poster`, `cite`,
`background`, `data` and the namespaced `xlink:href` / `xml:base` through `safeUrl` (`@y-core/forge/http`), which admits an allow-list of schemes
and collapses everything else — `javascript:`, `vbscript:`, `data:` — to `"#"`. **`<object data>` is in that set**, so a `javascript:` pseudo-URL
there is neutralised by the renderer rather than left to `object-src`. Before matching the scheme it strips control characters and whitespace, so
`java\tscript:` and a leading-newline variant are caught. **It does not decode HTML entities**, and does not need to: the same pass escapes the
value, so an entity-encoded payload is emitted with its `&` escaped and never re-decodes into a scheme in the browser. `safeUrl` picks the scheme;
escaping is what closes the entity route. **Consumers never call either.** Together they are the render-layer complement to the nonce: a
user-controlled URL cannot become script execution even if it reaches an attribute.

**A handler drop and a double escape sit beside the URL pass.** An attribute whose lowercased name begins `on` is dropped outright, as `style`
already was, so an untrusted spread key cannot inject a handler. A **string** `srcdoc` is escaped twice, because the browser decodes an attribute
value once before parsing the frame document — a single escape would cancel exactly, and the payload would parse as markup on the parent's origin. A
`SafeHtml` `srcdoc` is escaped once, so that cancellation is exactly what delivers it: trusted markup reaches the frame as a document, and the
`SafeHtml` type is the statement that it is trusted. `data-bind-attr` refuses `srcdoc` outright, so no signal can reach one.

**No `hx-*` attribute is covered by this**, in either half. Selector and JSON values cannot be sanitized at all ([`HTMX.md`][htmx-7] §7); URL-valued
`hx-*` attributes deliberately are not, because `"#"` is a live same-origin request rather than a dead link once htmx fetches it
([`HTMX.md`][htmx-7a] §7a). `hx-on:*` is outside the handler drop for the same reason its name is outside the test — it begins `hx-`, not `on` — and
a `js:`-prefixed `hx-vals` or `hx-headers` is evaluated on the same terms; both are held by who wrote the value ([`HTMX.md`][htmx-7b] §7b).

### 2e. Default Header Set

`src/security/headers.ts` owns the emitted values. What this section owns is which headers are in the set and why:

- **Emitted with a hardened default:** `Content-Security-Policy` (strict, per-request nonce), `Strict-Transport-Security`, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy`.
- **`X-Frame-Options` is emitted although `frame-ancestors` already covers it** — the redundancy is deliberate, for user agents that honour only the
  legacy header.
- **`Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy` each have a named override** (`crossOriginOpenerPolicy`,
  `crossOriginResourcePolicy`), because a popup-based OAuth or payment flow and an intentionally embeddable resource each need a looser value than
  the default.
- **`Cross-Origin-Embedder-Policy` is not emitted, and opting in is the caller's decision** (`crossOriginEmbedderPolicy`): `require-corp` breaks
  every subresource lacking a CORP or CORS opt-in, which is a site-wide behavioural change rather than a header default.
- **`style-src` and `font-src` default to `'self'` and are configurable** (`styleSrc`, `fontSrc`), so a route that loads a web font from a CDN can
  name that origin without any directive becoming a string literal in the app. Widening them never introduces `'unsafe-inline'` — the JSX renderer
  still drops inline `style` props. **Forge ships no named third-party origins for either.** A CDN font in particular is the wrong default — cache
  partitioning means it is never a shared cache hit, so it costs two connection setups and a visitor-IP disclosure and buys nothing back.
  Self-hosting through the asset pipeline's `fonts.downloads` needs no widening at all, which is why the directives are a plain escape hatch rather
  than a convenience API.
- **Every unsafe CSP keyword is refused as a string and admitted only as an imported symbol.** `'unsafe-inline'`, `'unsafe-eval'`,
  `'unsafe-hashes'` and `'wasm-unsafe-eval'` throw when named as a string source, case-insensitively, in every directive and at both entry points
  (`createSecurityHeaders` at construction, `applySecurityHeaders` per call). The opt-out is a `unique symbol` per keyword (`UNSAFE_INLINE`,
  `UNSAFE_EVAL`, `UNSAFE_HASHES`, `WASM_UNSAFE_EVAL`), placed in the source list exactly where the string would have gone; the validator skips
  non-strings, which is the same seam `NONCE` rides.

  This is deliberately **not** a `DevAllowance` grant ([`NAMESPACES.md`][namespaces-5i] §5i): the dev token is for relaxations that must never
  reach production, and `'wasm-unsafe-eval'` is legitimate there.

  **Each costs something different, which is why they are separate flags rather than one.** `'unsafe-inline'` discards §2a's whole contract.
  `'unsafe-eval'` re-enables the `new Function` path that is otherwise the one thing stopping an `hx-on:*` attribute from executing
  ([`HTMX.md`][htmx-7b] §7b). `'unsafe-hashes'` is narrower than `'unsafe-inline'`: it admits _hashed_ event-handler attributes and no `<script>`
  block. `'wasm-unsafe-eval'` is narrowest — WebAssembly compilation only, granting no JavaScript evaluation — and is what a WebAssembly consumer
  reaches for rather than `UNSAFE_EVAL`. What each one costs in practice, and the pairing the validator refuses because CSP Level 3 would
  ignore it, are `src/security/README.md`'s, at the point a caller reaches for it.
- **`Cache-Control` is deliberately not a blanket default.** Caching is a per-route decision (`definePage({ cache })`), and a namespace-wide value
  would either over-cache a private page or defeat caching everywhere. Within that per-route decision, `cache.scope` defaults to `"private"`: a page
  that states a `maxAge` and no scope is browser-cacheable and never shared-cacheable, so forgetting the field on a personalised page cannot let an
  edge serve one reader's HTML to another. Edge caching is opted into with `scope: "public"`.

---

## 3. CORS and Origin Protection

### 3a. cors Middleware for API Routes

**Apply CORS only on routes consumed cross-origin — never globally.** Derive `allowedOrigins` from `BaseUrlConfig` so the list matches the deployed
environment automatically.

**`cors()` rebuilds the downstream `Response` rather than mutating it in place.** A downstream response may carry immutable headers, where in-place
mutation would throw or silently no-op; rebuilding with a fresh `Headers` clone is correct by construction.

**Every response whose content depends on `Origin` is marked `Vary: Origin` — including the refusal.** The rule is not "did we add an ACAO header",
it is "does this middleware's output depend on the request's `Origin`", and it does on both branches. An unmarked refusal — no ACAO, no `Vary` — is
one a shared cache may store and replay to an allowed origin, which is the CORS-defeating direction; a request carrying no `Origin` at all is the
same case. **The price is stated plainly:** a non-wildcard `cors()` rebuilds every response, including the ones it refuses. That is the cost of a
correct cache key, and it follows the same rebuild-rather-than-mutate ruling above. **The one exception is `origins: ["*"]` without credentials**,
where the ACAO header is the constant `"*"`: it is the same for every caller, so `Vary` would only shred the cache key, and it is suppressed.

**The allowlist compiles once.** `compileOriginMatcher(patterns)` builds an exact-match `Set` and the wildcard patterns' `RegExp`s at factory time;
the public `matchOrigin` is now one call into it, so there is a single implementation of the matching rules (including the escaped `?` and the
excluded delimiters, each of which fixes a real widening bug). The preflight header object, `methods.join`, `allowedHeaders.join` and
`String(maxAge)` are likewise built once rather than per preflight.

### 3b. originGuard — Strict Origin Allowlist

Middleware that rejects any request whose `Origin` is not in the allowlist. Use on webhook or privileged endpoints.

**It fails closed on no signal at all.** `Origin` decides where it is present; otherwise the `Referer`'s origin does; a request carrying neither is
`"missing"` and is refused with `403` like a disallowed one. Safe methods (`GET`/`HEAD`/`OPTIONS`/`TRACE`) are exempt before the check runs, so what
this refuses is a state-changing request that offered no origin evidence — a curl `POST`, not a same-origin navigation.

### 3c. verifyOrigin — Inline Origin Check

For a one-off check inside a handler rather than as middleware. Takes the standard `Request`, inspects `Origin`, and returns an `OriginResult`
(`{ ok: boolean }`).

### 3d. crossOriginProtection — Fetch Metadata

`crossOriginProtection()` enforces same-origin for state-changing requests (anything other than `GET`/`HEAD`/`OPTIONS`) using the browser
`Sec-Fetch-Site` header.

**Requests labelled `cross-site` are rejected with `403`, and a missing header is rejected by default (fail-closed).** The one way to accept it is
`dev`, a [`DevAllowance`][dev-readme] granting `missingFetchMetadata` — a token only a development entry can mint, so no production module can pass
one and `validate-dev-boundary` fails the import that would try.

`checkCrossOriginProtection(request, options)` performs the same check as a plain function, returning a `GuardResult` alias with the reason code in
`error`. Use it when the result must drive conditional logic rather than an automatic rejection.

**The origin guards inspect browser-sent headers — they are not a CSRF token mechanism.** CSRF minting and verification live in
`@y-core/forge/form`.

### 3e. Origin-Guard Tiering — Which Guard When

The middleware below defend against cross-origin mutation. They form a deliberate tiering: **pick one per route rather than stacking them.**

| Guard | Signal | When the signal is absent | Use when |
| --- | --- | --- | --- |
| `originProtection(options)` | `Sec-Fetch-Site` **and** the `Origin`/`Referer` allowlist, both applied | Falls back to Fetch-Metadata vouching; fails closed with no signal at all | **The default.** Broadest coverage — modern browsers plus older UAs |
| `crossOriginProtection(options)` | `Sec-Fetch-Site` only | Fails closed (`403`) unless a dev allowance grants `missingFetchMetadata` | Stricter, no allowlist |
| `originGuard(allowed)` | `Origin`/`Referer` only | Fails closed (`403`) — no signal is refused like a disallowed one | Webhook/privileged endpoints keyed purely on an origin allowlist |

**`originProtection` is the recommended default** — the others are the single-signal tiers it is built from.

All of them exempt safe methods (`GET`/`HEAD`/`OPTIONS`/`TRACE`) first, so only state-changing requests are gated. `originProtection` treats
`Sec-Fetch-Site` as a **veto, not a pass**: any value other than `same-origin`/`none` rejects outright, and a good value does _not_ short-circuit
the allowlist. `allowedOrigins` — a static `string[]` or a per-request resolver — is consulted on every mutating request carrying an `Origin` or
`Referer`; only when both are absent does the guard fall back to the browser's Fetch-Metadata vouching, and with no signal at all it fails closed.

Consequence: an app must list **its own origin** in `allowedOrigins`, or its own same-origin mutations are rejected. Letting a present
`Sec-Fetch-Site` short-circuit the allowlist is the specific shortcut this rules out: the header is forgeable by any non-browser client, and
skipping the allowlist on it would put this tier in standing disagreement with `originGuard`, which enforces the allowlist unconditionally.

`Sec-Fetch-Site` is also matched as an **allowlist**: `same-site` is rejected, not just `cross-site`, since any sibling subdomain produces it.

`applyMiddlewareChain` wires `originProtection` for each guard group's `origin` option, so apps using the canonical chain get the recommended tier
by default.

### 3f. Deriving allowedOrigins in Dev

**The posture itself is canon.** Development is https at every hop, the dev server's local protocol is set to https, a scheme-rewriting middleware
is never the fix, and `upgrade-insecure-requests`/HSTS/`Secure` cookies stay hardcoded: [`WORKERS_PLATFORM.md`][wp-4e] §4e rules on all of it, and a
consuming app cites that. This section holds only what is forge's own — how `allowedOrigins` reaches the guards of §3b–§3e.

**`BASE_URL` is the derivation source.** `deriveAllowedOrigins` (`src/security/url.ts`) builds the allowed-origin set from it, and
`BaseUrlConfigSchema` validates it at boot. In dev that value is the canonical proxy origin — the same URL the browser is pointed at, https and all.

**`extraOrigins` is the only escape hatch, and it rides on the dev allowance.** It exists for the proxy-less fallback — the dev server on a bare
machine with the browser at `https://localhost:8787`. Entries must be normalized origins and https-or-loopback, and throw at boot otherwise.
`deriveAllowedOrigins(parsed, { dev })` reads them off a [`DevAllowance`][dev-readme]; there is no `extraOrigins` option and **no env var**. Minting
the token means importing `@y-core/forge/dev` at value, which `validate-dev-boundary` permits from a `*.dev.ts` entry and from nowhere else — so the
production bundle structurally contains no extra origin, the same containment guarantee as the live-reload CSP hash (§2c), and now a checked one.

Forge's own browser set serves no origin at all, so the canon's loopback-https rule for a browser suite does not reach it (`playwright.config.ts`
owns why).

**`createAnonymousSession`'s `Secure` escape hatch is gone, and this is the ruling on it.** The option served plain-http development, which
[`WORKERS_PLATFORM.md`][wp-4e] §4e rules out: development is https at every hop, so `Secure` is correct there by construction and needs no switch.
An in-process test harness never needed one either — `Secure` is enforced by a browser deciding whether to send a cookie back over http, and forge's
own session suite passes identically with it on. `createSignedCookie` therefore hardcodes `Secure` as it already hardcodes `httpOnly`, and the
failure the option made reachable — a relaxation computed from a mistyped env check, shipped silently — has no expression left.

---

## 4. Rate Limiting with Workers Binding

### 4a. rateLimit Middleware Factory

`rateLimit` wraps the Cloudflare Workers Rate Limiting binding. **Apply per-route, not globally**, to target high-risk endpoints such as form
submissions and API mutations.

### 4b. The Dev Allowance for a Missing Binding

**An absent binding returns `503` per request, and the only thing that changes it is a token production cannot mint.** `rateLimit({ dev })` takes a
[`DevAllowance`][dev-readme]; with `rateLimitOptional` granted, a missing binding is logged and skipped instead. With no token — which is every
production route, by construction — a misconfigured binding fails closed rather than silently disabling the limit.

**This is the graceful degradation [`BOUNDARIES.md`][boundaries-5b] §5b scopes to rate limiting, with the call site made unforgeable.** The
asymmetry §5b draws holds: bypassed rate limiting is an availability concern, bypassed CSRF is an integrity breach. The relaxation is a token rather
than a boolean on a production option, so no shared middleware module reached from the production entry can set it and silently disable rate
limiting. Minting the token is an import, and `validate-dev-boundary` fails that import outside a `*.dev.ts` entry.

### 4c. Workers Rate Limiter Binding Configuration

Declare the binding in `wrangler.jsonc` under `ratelimits` with a `name`, `namespace_id`, and a `simple` `{ limit, period }`; then add that name to
`AppEnv` typed as `RateLimitBinding` (exported from `@y-core/forge/security`).

### 4d. Rate-Limit Key Selection

`RateLimitOptions.trustCfHeaders` (default `false`) controls whether the default key may read `CF-Connecting-IP`:

- **`trustCfHeaders: true`** — the default key is `CF-Connecting-IP`; a missing header fails closed with `503`.
- **Default (`false`) with no custom `key`** — the default key resolver **throws → `503`**, refusing to key on a forgeable header.
- **A custom `key` always overrides**, regardless of `trustCfHeaders`. Supply one for non-Cloudflare deployments. A throwing `key` function likewise
  fails closed with `503`.

**§5c owns the trust rationale** and how `applyMiddlewareChain` threads one flag to every surface. For key-selection strategy (per-IP vs per-session
vs route-scoped composite), see `src/security/README.md`.

---

## 5. Request Identity

### 5a. requestId Middleware

`requestId(options?)` generates a unique ID per request, sets the `X-Request-Id` response header, and stores the value in `requestIdCtx`.

**Register at the top of the middleware stack** so all downstream middleware and handlers can read it — the position
[`ROUTING_AND_MIDDLEWARE.md`][ram-3e] §3e gives it, and `applyMiddlewareChain` puts it there. Read it with `requestIdCtx.getOptional(c)`.

The inbound `CF-Ray` header is ignored unless `trustCfHeaders` is set — see §5c.

### 5b. Logging Integration

`requestLogger` reads `requestIdCtx` to correlate log entries across a request's lifetime. **Because `requestId()` runs first, the logger always
finds the ID already set** — the chain order is [`ROUTING_AND_MIDDLEWARE.md`][ram-3e] §3e's; what the logger does with the id is
[`STRUCTURED_LOGGING.md`][sl-3c] §3c's.

### 5c. Cloudflare Header Trust Boundary — `trustCfHeaders`

`CF-Ray` and `CF-Connecting-IP` are injected by Cloudflare's edge and are trustworthy **only when the request actually transited that edge**. A
Worker reachable directly — a custom origin, another platform, a misrouted deployment — receives whatever a client chose to send, so adopting those
headers unconditionally lets a client forge its own request id or rate-limit key.

**Forge therefore defaults to distrust: the CF headers are used only when the caller opts in with `trustCfHeaders: true`.**

Every surface it reaches defaults to `false`:

| Surface | With `trustCfHeaders: true` | Default |
| --- | --- | --- |
| `requestId({ trustCfHeaders })` | Adopt `CF-Ray` as the id (UUID fallback) | Always mint a UUID; ignore `CF-Ray` |
| `RateLimitOptions.trustCfHeaders` (§4d) | Default key reads `CF-Connecting-IP` | Default keying throws → `503` unless a custom `key` is given |
| `MiddlewareChainOptions.trustCfHeaders` | Threaded to `requestId()` and every guard group's rate-limit guard | Both distrust the CF headers |

**`applyMiddlewareChain` takes a single `trustCfHeaders` and threads it to both**, so an app declares its trust posture once:

```ts
applyMiddlewareChain(app, {
  trustCfHeaders: true, // this Worker runs behind Cloudflare
  securityHeaders: { scriptSrc: ["'self'", NONCE] },
  guards: [{ paths: ["/api/*"], rateLimit: { limiter: (c) => c.env.RATE_LIMITER } }],
});
```

**A Cloudflare-deployed app must set `trustCfHeaders: true` or pass a custom rate-limit `key`** — otherwise the default keying fails closed with
`503`.

---

## 6. Content Type Guards

### 6a. requireFormContentType

Middleware factory enforcing a form content type — `application/x-www-form-urlencoded` or `multipart/form-data`. The comparison is case-insensitive
and ignores any `; charset=…` parameter. A wrong or missing content type is rejected with `415`.

**Apply on HTML form submission endpoints to prevent JSON-based CSRF that bypasses same-site cookie protections. Do not use on API routes that
accept JSON.**

**It is a factory — call it**: `requireFormContentType()`.

---

## 7. Transport-Layer Boundary

See [`BOUNDARIES.md`][boundaries-2] §2 for the transport-versus-application boundary: what `security` may hold, what belongs to a higher-level
namespace, and why identity is application-layer.

[boundaries-2]: ../warden/canon/libs/BOUNDARIES.md#2-transport-versus-application-security-layer
[boundaries-5b]: ../warden/canon/libs/BOUNDARIES.md#5b-required-false--non-security-features-only
[dev-readme]: ../src/dev/README.md
[eh-2d]: ./FORGE_ERRORS.md#2d-fragment-options-and-escaping
[htmx-7]: ./HTMX.md#7-trust-posture--selectors-and-json-values-must-be-developer-supplied
[htmx-7a]: ./HTMX.md#7a-url-valued-hx-attributes-are-deliberately-unsanitized
[htmx-7b]: ./HTMX.md#7b-what-htmx-evaluates-hx-on-and-a-js-prefixed-hx-vals-or-hx-headers
[iv]: ./INPUT_VALIDATION.md
[namespaces-5i]: ./NAMESPACES.md#5i-dev--a-dev-only-allowance-never-a-boolean-on-a-production-option
[ram]: ./ROUTING_AND_MIDDLEWARE.md
[ram-3d]: ./ROUTING_AND_MIDDLEWARE.md#3d-security-middleware-placement
[ram-3e]: ./ROUTING_AND_MIDDLEWARE.md#3e-applymiddlewarechain-canonical-chain-builder
[sb-3b]: ./STORAGE_BINDINGS.md#3b-serveobject--direct-response-from-a-backend
[sl-3c]: ./STRUCTURED_LOGGING.md#3c-ordering-requestid-before-requestlogger
[wp-4e]: ../warden/canon/apps/WORKERS_PLATFORM.md#4e-development-transport-posture
