---
title: Security Hardening
description: "The security namespace: CSP nonce headers, CORS, origin-guard tiering, rate limiting, request identity, and the Cloudflare-header trust boundary."
audience: consumer
---

# Security Hardening

> Owns the `security` namespace — transport-layer request/response hardening only — and the `trustCfHeaders` trust boundary. CSP, CORS, origin
> verification, rate limiting, request identity. Authentication, sessions, and RBAC are out of scope (§7). Also owns the one strength rule every
> secret forge imports is held to (§8).
>
> Defers to: [`INPUT_VALIDATION.md`][iv] for CSRF, Turnstile, and the form body cap; [`ROUTING_AND_MIDDLEWARE.md`][ram] for middleware placement;
> [`FORGE_ERRORS.md`][eh-2d] §2d and §5b for fragment-option escaping and the baseline-hardened 500; [`STORAGE_BINDINGS.md`][sb-3b] §3b, §3c, §4a
> for R2 serving, signed URLs, and binding shape checks.

---

## 0. Quick Reference

- §1 What Is Not in security: the symbols routinely looked for here
- §2 createSecurityHeaders and CSP Nonce: the header factory and its nonce contract
- §2a createSecurityHeaders Factory Pattern: per-request nonce, queued headers
- §2c mergeSecurityHeaders for Dev/Prod Split: layering the live-reload hash from a dev-only module
- §2d getNonce and Automatic URL Sanitization: reading the nonce; `safeUrl` at render time
- §2e Default Header Set: which headers are emitted, which are opt-in, and which are a route concern
- §2f createRouteSecurityHeaders and the Handler-Set CSP: why a response's own CSP combines with the app's, and how a route loosens it instead
- §2g Trusted Types and htmx — the forge-htmx Policy: the name to list, why a pass-through policy is acceptable, how it fails closed, and what
  enforcement forbids
- §3 CORS and Origin Protection: the cross-origin guards
- §3a cors Middleware for API Routes: scoped application and response rebuild
- §3b originGuard — Strict Origin Allowlist: the Origin/Referer tier
- §3d crossOriginProtection — Fetch Metadata: the `Sec-Fetch-Site` tier
- §3e Origin-Guard Tiering — Which Guard When: pick one, never stack; how a refusal is answered; the `missing` mode for callers that are not
  browsers
- §3f Deriving allowedOrigins in Dev: `SITE_ORIGIN` as the source, the `FORGE_DEV_ORIGINS` binding as the sole escape hatch
- §4 Rate Limiting with Workers Binding: the limiter middleware
- §4a rateLimit Middleware Factory: high-risk paths, and where a limit is applied
- §4b A Missing Binding Under `forge cf dev`: the availability trade, the build that alone may take it, and required versus optional
- §4c What the Binding Counts: approximate, per location, `{ success }` only — a brake, not a quota
- §4d Rate-Limit Key Selection: the default key and its trust precondition
- §4e One Declaration per Rate Limit: the binding by name, the window from wrangler, one type, trust once, the group and route placements, the
  entry points, and the alternatives rejected
- §5 Request Identity: request-id generation and the CF trust boundary
- §5a requestId Middleware: generation and placement
- §5b Logging Integration: correlation through `requestIdCtx`
- §5c Cloudflare Header Trust Boundary — trustCfHeaders: the single owner of the flag
- §6 Content Type Guards: incoming-body enforcement
- §6a requireFormContentType: the 415 guard
- §7 Transport-Layer Boundary: pointer to the governance rule that owns it
- §8 Secret Strength — One Rule for Every Secret: the floor and the variety check, how each kind of secret is measured, and how to generate one

---

## 1. What Is Not in security

`src/security/mod.ts` is authoritative for what this namespace exports, and `src/security/README.md` teaches how to use them.

**Not in security** — a common mistake:

| Looked for here | Actually in |
| --- | --- |
| `timingSafeEqual` / `timingSafeEqualBytes` | internal `src/crypto/primitives/` (`@internal`) |
| `csrfMintStage`, `mintCsrf` | `@y-core/forge/form` |
| `sessionMiddleware` | `@y-core/forge/session` |
| `isHxRequest` | `@y-core/forge/render/htmx` — a UX hint, not a boundary ([`HTMX.md`][htmx-7] §7) |

---

## 2. createSecurityHeaders and CSP Nonce

### 2a. createSecurityHeaders Factory Pattern

`createSecurityHeaders` generates a fresh nonce per request (16 random bytes, base64url), injects it into the CSP `script-src`, and stores it on the
request context for `getNonce(c)`. That pairing is what lets an inline `<script>` run under a policy carrying no `'unsafe-inline'`: the script tag
names the nonce, the header names the same nonce, and nothing else in the document executes.

**Every request gets a fresh nonce** — a static nonce defeats nonce enforcement entirely.

**Only the nonce is per-request.** Every header is rendered once at factory time, each CSP into a template whose nonce placeholder no valid source
token can contain, so a caller cannot reach it. Validation therefore throws from the factory, before the first request, never from a render.

**Computed headers are queued on the per-request pending-header channel** and flushed once by the app's outermost `applyHeaders` pass, rather than
each middleware rebuilding its own `Response`.

**They are queued _before_ `next()`, alongside the nonce.** Two consequences, both intended:

- **Error pages always carry them.** A guard registered downstream that throws still yields a 500 with CSP and HSTS, because the headers were on
  the channel before it ran.
- **Header-name conflicts resolve inner-wins.** `setPendingHeader` is last-writer-wins per name and a deeper middleware queues later, so a consumer
  middleware's overlapping name overrides the security default. Nothing inside forge overlaps — session, `d1Sessions` and flash each touch only
  their own `set-cookie` (or the bookmark header the app names), and `requestId` owns `x-request-id` — so this is observable only from consumer
  middleware. Pinned in `src/security/headers.test.ts`.

A header baked into the handler's own `Response` is resolved in the channel's favour: `mergePendingHeaders` set-overwrites onto the response.
**`Content-Security-Policy` is the one name that combines instead of overwriting.** The queued policy is set and the response's own is appended
after it, so a handler's CSP can only tighten the app's (§2f).

**Register once at app level via `app.use("*", …)`** so every route inherits the headers.

### 2c. mergeSecurityHeaders for Dev/Prod Split

`mergeSecurityHeaders(base, override)` deep-merges two `SecurityHeadersOptions`, concatenating directive arrays.

<!-- rule:forge-dev-csp-behind-relax --> It exists to layer the Wrangler live-reload inline-script hash onto the production CSP from a dev-only
module, which sits behind the app's own `imports` alias, whose `default` target layers nothing, so a deploy bundles no module that names the hash
([`NAMESPACES.md`][namespaces-5i] §5i).

### 2d. getNonce and Automatic URL Sanitization

`getNonce(c)` reads the per-request nonce for inline `<script nonce={…}>` attributes.

**It never throws: when the middleware has not run it returns `""`**, which renders an empty `nonce` the CSP will not honour. **Register
`createSecurityHeaders` before any nonce consumer** (see [`ROUTING_AND_MIDDLEWARE.md`][ram-3d] §3d).

**URL attributes in JSX are sanitized automatically at render time.** The renderer routes `href`, `src`, `action`, `formaction`, `poster`, `cite`,
`background`, `data` and the namespaced `xlink:href` / `xml:base` through `safeUrl` (`@y-core/forge/html`), which admits an allow-list of schemes
and collapses everything else — `javascript:`, `vbscript:`, `data:` — to `"#"`. **`<object data>` is in that set**, so a `javascript:` pseudo-URL
there is neutralised by the renderer rather than left to `object-src`. Before matching the scheme it strips control characters and whitespace, so
`java\tscript:` and a leading-newline variant are caught. **It does not decode HTML entities**, and does not need to: the same pass escapes the
value, so an entity-encoded payload is emitted with its `&` escaped and never re-decodes into a scheme in the browser. `safeUrl` picks the scheme;
escaping is what closes the entity route.

<!-- rule:forge-safe-url-renderer-only --> Together they are the render-layer complement to the nonce: a user-controlled URL cannot become script
execution even if it reaches an attribute.

**A handler drop and a double escape sit beside the URL pass.** An attribute whose lowercased name begins `on` is dropped outright, as `style`
is. A **string** `srcdoc` is escaped twice, because the browser decodes the attribute once before parsing the frame document, so a single escape
would cancel and the payload would parse as markup on the parent's origin. A `SafeHtml` `srcdoc` is escaped once, so trusted markup reaches the
frame as a document. `data-bind-attr` refuses `srcdoc` outright.

**No `hx-*` attribute is covered by this.** Selector and JSON values cannot be sanitized ([`HTMX.md`][htmx-7] §7), and a URL-valued `hx-*` is
deliberately not, because `"#"` is a live same-origin request once htmx fetches it ([`HTMX.md`][htmx-7a] §7a). `hx-on:*` begins `hx-`, not `on`,
so the handler drop misses it; it and a `js:`-prefixed `hx-vals` or `hx-headers` are held by who wrote the value ([`HTMX.md`][htmx-7b] §7b), and
refused under Trusted Types (§2g).

### 2e. Default Header Set

`src/security/headers.ts` owns the emitted values. What this section owns is which headers are in the set and why:

- **Emitted with a hardened default:** `Content-Security-Policy` (strict, per-request nonce), `Strict-Transport-Security`, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy`.
- **`Strict-Transport-Security` defaults to a two-year `max-age` with `includeSubDomains` and `preload`, shaped by one option, `hsts`.**
  `hsts: false` omits it; an object sets `maxAge` (a non-negative integer of seconds, `HSTS_DEFAULT_MAX_AGE` by default) or turns a token off,
  and keeps the default for each field it omits. `mergeSecurityHeaders` merges two objects field by field, and `false` on either side replaces.
  **Decide `preload` on purpose:** it is the consent hstspreload.org requires before listing a domain, and leaving the list takes months. An app
  that will never submit its domain, or cannot promise https on every subdomain, sets `preload: false`.
- **`X-Frame-Options` is emitted although `frame-ancestors` already covers it** — the redundancy is deliberate, for user agents that honour only the
  legacy header.
- **`Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy` each have a named override** (`crossOriginOpenerPolicy`,
  `crossOriginResourcePolicy`), because a popup-based OAuth or payment flow and an intentionally embeddable resource each need a looser value than
  the default.
- **`Referrer-Policy` has an override, `referrerPolicy`, that can tighten the default and never loosen it.** Its type admits only values at least
  as strict as the default, and it is app-level only, like the cross-origin policies. `no-referrer` is stricter still and is excluded all the same:
  `verifyOrigin` in `src/security/origin.ts` falls back to `Referer` when a request carries no `Origin`, and `no-referrer` strips the same-origin
  `Referer` too, so that fallback would become a 403.
- **`Cross-Origin-Embedder-Policy` is opt-in** (`crossOriginEmbedderPolicy`): `require-corp` breaks every subresource lacking a CORP or CORS
  opt-in, a site-wide change rather than a header default.
- <!-- rule:forge-csp-first-party-fonts --> **`style-src` and `font-src` default to `'self'` and are configurable** (`styleSrc`, `fontSrc`), so a
  route can name a font CDN without a string literal in the app. Widening them never adds `'unsafe-inline'`. A CDN font is never a shared cache hit
  under cache partitioning, so it costs two connections and a visitor-IP disclosure for nothing. Self-hosting through the asset pipeline's
  `fonts.downloads` needs no widening.
- **Every unsafe CSP keyword is refused as a string and admitted only as an imported symbol.** `'unsafe-inline'`, `'unsafe-eval'`,
  `'unsafe-hashes'` and `'wasm-unsafe-eval'` throw when named as a string, case-insensitively, in every directive, at construction and in
  `applySecurityHeaders`. The opt-out is a `unique symbol` per keyword (`UNSAFE_INLINE`, `UNSAFE_EVAL`, `UNSAFE_HASHES`, `WASM_UNSAFE_EVAL`) placed
  where the string would go — the seam `NONCE` rides. It is not a `#relax` module ([`NAMESPACES.md`][namespaces-5i] §5i), because
  `'wasm-unsafe-eval'` is legitimate in production.

  **They are separate flags because each costs something different.** `'unsafe-inline'` discards §2a's contract; `'unsafe-eval'` re-enables the
  `new Function` path that otherwise stops `hx-on:*` ([`HTMX.md`][htmx-7b] §7b); `'unsafe-hashes'` admits only hashed handler attributes;
  `'wasm-unsafe-eval'` admits WebAssembly compilation and no JavaScript. The practical cost of each, and the pairing CSP Level 3 would ignore, are
  `src/security/README.md`'s.
- **Trusted Types, violation reporting and a Report-Only policy are opt-in**, each with its own merge rule in `mergeSecurityHeaders`.

  `trustedTypes` adds `require-trusted-types-for 'script'` and a `trusted-types` list of grammar-checked policy names; `require: false` omits the
  first, so an app can restrict policies before requiring them. Merging concatenates the lists, and the extra's `allowDuplicates` and `require`
  win. An app loading `ui/client/htmx` lists its policy, or no swap succeeds (§2g).

  `reporting` emits `Reporting-Endpoints` and adds `report-to` to every CSP, with a `report-uri` fallback. The endpoint is an absolute https URL or
  a root-relative path (`/…`, never `//…`), emitted verbatim; anything else throws. Merging replaces it: an app has one report destination.
  **Prefer the root-relative path:** the browser resolves it against the reporting page, so one configuration reports to whichever deployment
  served the page, where an absolute URL sends every other deployment's reports cross-origin and loses them.

  `reportOnly` emits `Content-Security-Policy-Report-Only` from the same builder and nonce. A field it states replaces the enforced one and a field
  it omits is inherited, so a candidate is written as its difference from the enforced policy; it never carries `upgrade-insecure-requests`.
  Merging concatenates its lists, and backfills a directive the base never stated from the merged enforced list.
- **`Cache-Control` is not a blanket default.** Caching is a page's `cache` option, and `cache.scope` defaults to `"private"`, so a personalised
  page that states only a `maxAge` is never shared-cacheable. Edge caching is opted into with `scope: "public"`.

### 2f. createRouteSecurityHeaders and the Handler-Set CSP

**A response's own `Content-Security-Policy` is combined with the app's, never replaced by it.** `mergePendingHeaders` and
`applySecurityHeaders` set the app's policy and append the response's, and a browser enforces both, so a handler's CSP can only tighten the
app's. That makes combining safe for every response, a proxied upstream one included.

**The case this protects is `serveObject`'s `sandbox`.** Whether an object is active content is known only after the backend read, inside
`storage/r2`, which has no request context ([`STORAGE_BINDINGS.md`][sb-3b] §3b). Were the handler's policy overwritten, an uploaded HTML or SVG
object served `inline` would render on the app's origin instead of in a sandbox.

**`Content-Security-Policy-Report-Only` still overwrites**, because a report-only policy enforces nothing.

**Loosening a route is `createRouteSecurityHeaders(extra)`'s job, because a handler's header cannot do it.** The middleware lays `extra` over the
options `createSecurityHeaders` recorded on the request, by `mergeSecurityHeaders`' rules (§2c, §2e), and queues the CSP family again under the
request's nonce. It is registered deeper than the app-level factory, so its queue wins per name (§2a).

- **It throws when `createSecurityHeaders` has not run on the request.** Without the app's options it has nothing to widen and no nonce to render
  with, and a policy built from defaults alone would silently drop every directive the app declared.
- **It takes `CspOptions`, not `SecurityHeadersOptions`.** The CSP family is the only part of the header set rendered against the request's nonce,
  so it is the only part whose route variant must be built from the app's options and this request together. The rest of the set is origin-wide
  posture: HSTS, for one, is stored per hostname, so a per-route value is not one a browser can hold.
- **The merged policy is rendered once per app options object**, so a request on the route pays what an app-level request does.
- **An invalid merge throws at the route's first request, not at construction.** `extra` is validated alone when the middleware is built, but the
  app's options exist only on a request. A combination the validator refuses — `UNSAFE_INLINE` merged onto a backfilled nonce (§2e) — is never
  cached, so it throws on every request to the route.

### 2g. Trusted Types and htmx — the forge-htmx Policy

**An app that enforces Trusted Types and loads `ui/client/htmx` lists `forge-htmx` in its `trusted-types` directive.** The entry creates a policy by
that name when it loads and hands it to htmx. htmx then routes its one HTML parse, and the text of every script in swapped content, through it. The
name is exported as `HTMX_TRUSTED_TYPES_POLICY` from `@y-core/forge/ui/contracts`. A page that renders `<Turnstile>` also lists
`forge-turnstile`, exported beside it as `TURNSTILE_TRUSTED_TYPES_POLICY`:

```ts
import { createSecurityHeaders } from "@y-core/forge/security";
import { HTMX_TRUSTED_TYPES_POLICY, TURNSTILE_TRUSTED_TYPES_POLICY } from "@y-core/forge/ui/contracts";

createSecurityHeaders({ trustedTypes: { policies: [HTMX_TRUSTED_TYPES_POLICY, TURNSTILE_TRUSTED_TYPES_POLICY] } });
```

`security` re-exports neither, which would add a `security → ui/contracts` dependency for names the app already imports.

**Each policy has one sink and fails visibly.** When the browser refuses a policy or a write, its owner logs a `console.error` naming the
`trusted-types` fix:

- **`forge-turnstile`** writes only `TURNSTILE_SCRIPT_URL` into the `src` of the script the Turnstile controller injects; any other URL throws.
  Refused, the widget shows its fallback message.
- **`forge-markdown`** (`MARKDOWN_TRUSTED_TYPES_POLICY`, from `@y-core/forge/render/markdown`, importable without the editor) writes the
  markdown viewport's own container `innerHTML`, and only what the app's `dialect.html` returns — `renderMarkdownHtml` output under the app's
  schema. Refused, it writes nothing and marks the container `data-viewport-html="refused"`.

**`forge-htmx` returns its input unchanged, which is acceptable because of what reaches it.** htmx fetches only from the page's own origin
([`HTMX.md`][htmx-7a] §7a), and every body forge renders is escaped server markup. Everything else — an app `innerHTML` write, a third-party
script, `eval` — has no policy and is refused. Only htmx holds `forge-htmx`, and forge creates no `default` policy.

**It fails closed.** When the browser refuses to create it — the name is missing from `trusted-types`, or it exists already without
`'allow-duplicates'` — htmx gets a policy that throws on every call, so it reports `htmx:error` and swaps nothing. That holds under
`require: false` too.

**What enforcing Trusted Types forbids in an htmx page:**

- **No `hx-on:*` attribute and no `js:` value.** htmx compiles them with the native `Function` constructor, which no policy covers, so they are
  refused even under `UNSAFE_EVAL` ([`HTMX.md`][htmx-7b] §7b). A `js:` request URL is refused by `forge-htmx` itself, with or without Trusted
  Types.
- **No `<script src>` in swapped content, a boosted page's `<body>` included.** htmx copies script attributes with `setAttribute`, outside the
  policy, so the write throws and the whole swap is lost, back navigation too. `pageShell` puts its scripts in `<head>` for this reason
  ([`ROUTING_AND_MIDDLEWARE.md`][ram-6a] §6a); a hand-written shell must too. Inline script text goes through the policy and runs.
- **An htmx `extensions` allowlist, if set, names `forge-htmx`**, or htmx keeps its own pass-through object and every sink write is refused.

**A browser without the Trusted Types API enforces none of this**; `script-src` (§2e) is the only layer, and the `js:` URL refusal still applies.

Pinned in `src/ui/client/htmx-security.browser.ts` (the swap, both refusals, the lost `<script src>` swap, the `js:` refusal) and
`src/ui/client/turnstile.browser.ts` (the script load and its CSP fallback, against a stand-in for Cloudflare's `api.js`).

---

## 3. CORS and Origin Protection

### 3a. cors Middleware for API Routes

<!-- rule:forge-cors-per-route --> Derive `allowedOrigins` from `BaseUrlConfig` so the list matches the deployed
environment automatically.

**`cors` has one placement: `app.use("/api/*", cors(...))`, registered after `applyMiddlewareChain`.** It answers a preflight without calling
`next`, so the preflight must first pass the group's checks; which of them arm on an `OPTIONS` is [`ROUTING_AND_MIDDLEWARE.md`][ram-3e] §3e's.

**`cors()` rebuilds the downstream `Response` rather than mutating it in place.** A downstream response may carry immutable headers, where in-place
mutation would throw or silently no-op; rebuilding with a fresh `Headers` clone is correct by construction.

**Every response whose content depends on `Origin` is marked `Vary: Origin` — the refusal and the no-`Origin` request included.** An unmarked
refusal is one a shared cache may store and replay to an allowed origin. The price is that a non-wildcard `cors()` rebuilds every response.
**The exception is `origins: ["*"]` without credentials**, whose ACAO is the constant `"*"`, so `Vary` would only shred the cache key.

**`cors()` and the public `matchOrigin` share one compiled matcher**, so the origin-matching rules have a single implementation.

**`exposedHeaders` is sent on an allowed actual response, never on a preflight or a refusal.** `Access-Control-Expose-Headers` governs which headers
a script may read from the response it arrives on, so it means something only where the read is permitted. Each entry is checked as an RFC 9110
header-name token when `cors()` is constructed, so a name with whitespace, a comma or a control character throws rather than splitting the list.
`"*"` with `credentials: true` throws as well, matching the wildcard-origin interlock: on a credentialed request the browser reads `*` as a header
named `*`, so the option would expose nothing while appearing to expose everything.

**Private Network Access is not offered.** Chrome 142 replaced the PNA preflight with the Local Network Access permission, and a Worker is
never the private-network target `Access-Control-Allow-Private-Network` was for.

### 3b. originGuard — Strict Origin Allowlist

**`originGuard` is for a privileged endpoint a browser calls, never a webhook receiver**: a delivery carries no origin signal, so the guard
refuses it. A receiver checks the signature instead ([Signing and verifying webhooks][security-webhooks]).

**It fails closed on no signal at all.** `Origin` decides, else the `Referer`'s origin, and a mutating request carrying neither is refused with
`403` — a curl `POST`, not a same-origin navigation, since safe methods are exempt (§3e).

### 3d. crossOriginProtection — Fetch Metadata

**`crossOriginProtection()` refuses a mutating request whose `Sec-Fetch-Site` is `cross-site` or absent, with `403`.** The one build that accepts it
is a Worker run by `forge cf dev`, whose `#relax/cop` module admits a request carrying no Fetch Metadata ([`NAMESPACES.md`][namespaces-5i] §5i). The
middleware takes no options, so no production call site can ask for the same.

`checkCrossOriginProtection` is the same check for logic that branches on the result.

**The origin guards inspect browser-sent headers — they are not a CSRF token mechanism.** CSRF minting and verification live in
`@y-core/forge/form`.

### 3e. Origin-Guard Tiering — Which Guard When

The middleware below defend against cross-origin mutation. They form a deliberate tiering: **pick one per route rather than stacking them.**

| Guard | Signal | When the signal is absent | Use when |
| --- | --- | --- | --- |
| `originProtection(options)` | `Sec-Fetch-Site` **and** the `Origin`/`Referer` allowlist, both applied | Falls back to Fetch-Metadata vouching; fails closed with no signal at all | **The default.** Broadest coverage — modern browsers plus older UAs |
| `crossOriginProtection()` | `Sec-Fetch-Site` only | Fails closed (`403`), except in a Worker run by `forge cf dev` | Stricter, no allowlist |
| `originGuard(allowed)` | `Origin`/`Referer` only | Fails closed (`403`) — no signal is refused like a disallowed one | Privileged browser-called endpoints keyed purely on an origin allowlist (§3b) |

**`originProtection` is the recommended default** — the others are the single-signal tiers it is built from.

All of them exempt safe methods (`GET`/`HEAD`/`OPTIONS`/`TRACE`) first. **A `GET` carrying `Upgrade: websocket` is not exempt**: the handshake
opens a cookie-bearing channel, so a foreign page holding one is cross-site WebSocket hijacking. It is judged on `Origin` alone, which a browser
always sends on a handshake (RFC 6455 §4.1), with no `Referer` or Fetch-Metadata fallback.

`originProtection` treats `Sec-Fetch-Site` as a **veto, not a pass**: any value but `same-origin`/`none` refuses — `same-site` too, since any
sibling subdomain produces it — and a good value does _not_ skip the allowlist, because any non-browser client can forge it. `allowedOrigins` (a
`string[]` or a per-request resolver) is consulted on every mutating request carrying `Origin` or `Referer`; only with both absent does
Fetch-Metadata vouch, and with no signal at all the guard fails closed. **An app must list its own origin**, or its own mutations are refused.

Only `originProtection` reports why it refused: its `OriginRefusal` reason is `cross-site` or `same-site` from the Fetch-Metadata veto, and
`disallowed` or `missing` from the allowlist. How it is answered and logged is the guard policy table's
([`ROUTING_AND_MIDDLEWARE.md`][ram-3e] §3e).

**A caller that is not a browser is admitted by name: `originProtection({ missing: "allow" })`.** Under it a mutating request carrying neither
`Origin`, `Referer` nor `Sec-Fetch-Site` passes, while a present `Origin` that is disallowed and a `cross-site` or `same-site` Fetch-Metadata value
are still refused. A browser sends `Origin` on every cross-origin `POST`, so a request with no signal at all is not a browser carrying the
visitor's cookies. **The default stays `missing: "refuse"`**, the
fail-closed posture for a cookie-authenticated group, and the option is a named value, not a boolean, so every admitting group is greppable
([`NAMESPACES.md`][namespaces-5i] §5i). It is for an endpoint called by a server or a tool — an MCP endpoint, a CSP report receiver — that also
sits under a group's origin check; such an endpoint never authenticates by cookie.

`applyMiddlewareChain` wires `originProtection` for each guard group's `origin` option, so apps using the canonical chain get the recommended tier
by default.

### 3f. Deriving allowedOrigins in Dev

**The development transport posture is canon's** ([`WORKERS_PLATFORM.md`][wp-4e] §4e). This section holds only how `allowedOrigins` reaches the
guards of §3.

**HSTS is on in development too, so choose the dev hostname for it.** A browser stores the policy per hostname, every port and, with
`includeSubDomains`, every name below; stored for bare `localhost`, it forces https on every local project there. Reach dev at a per-project
hostname or `127.0.0.1` (no policy is stored for an IP address), and clear a stored one in the browser's HSTS settings. A certificate error
does not reliably prevent storage: the header is ignored only while the certificate is untrusted (RFC 6797, section 8.1).

**`SITE_ORIGIN` is the derivation source.** `deriveAllowedOrigins` (`src/security/url.ts`) builds the allowed-origin set from it, and
`BaseUrlConfigSchema` validates it at boot. In dev that value is the canonical proxy origin — the same URL the browser is pointed at, https and all.

**The `FORGE_DEV_ORIGINS` binding is the only escape hatch, and only a Worker run by `forge cf dev` reads it.** It exists for the proxy-less
fallback — the dev server on a bare machine with the browser at `https://localhost:8787`. The binding is a comma-separated list in `.dev.vars`, and
each entry must be a normalized origin, https or loopback; a bad entry throws on the guarded request that reads it, with no partial list applied.
**The origin guards apply them, per request:** `originProtection` and `originGuard` admit them beside their own allowlist. `deriveAllowedOrigins`
does not — it runs at config parse, with no request whose bindings it could read. There is no `extraOrigins` option. The reader is the
`#relax/origin` module, whose default target admits no extra origin whatever the bindings carry, so a deployed Worker ignores the binding even if
one is set: the same containment as the live-reload CSP hash (§2c), and a checked one ([`NAMESPACES.md`][namespaces-5i] §5i).

Forge's own browser set serves no origin at all, so the canon's loopback-https rule for a browser suite does not reach it (`playwright.config.ts`
owns why).

**A session cookie's `Secure` flag has no off switch**, as `httpOnly` has none: development is https, and an in-process test harness is not a
browser that would withhold the cookie, so an option could only ship a relaxation computed from a mistyped env check.

---

## 4. Rate Limiting with Workers Binding

### 4a. rateLimit Middleware Factory

`rateLimit` wraps the Workers Rate Limiting binding. **Apply it to high-risk paths, not globally** — form submissions and API mutations; whether
on a guard group or the route is §4e's.

### 4b. A Missing Binding Under `forge cf dev`

**An absent binding returns `503` per request, and only a Worker run by `forge cf dev` skips it instead.** There the `#relax/rate-limit` module
logs a warning and admits the request; in every other build — every deployed one, by construction — a misconfigured binding fails closed rather
than silently disabling the limit. `rateLimit` takes no option for it.

**This is the graceful degradation [`BOUNDARIES.md`][boundaries-5b] §5b scopes to rate limiting** — bypassed rate limiting costs availability,
bypassed CSRF costs integrity — with the call site made unreachable: the build selects the module, so no production code can set it
([`NAMESPACES.md`][namespaces-5i] §5i), and `validate-dev-bundle` proves `src/security/rate-limit.dev.ts` is absent from the production bundle.

**Whether an absent binding is a deploy failure or a per-path `503` is the `bindings` declaration's to say, not `rateLimit`'s.** A binding
declared required fails `validateBindings`, which serves no path at all. One declared `optional` passes it, and its limiter answers `503` with
reason `binding-absent` on its own paths while the rest of the site serves — the mode an app chooses when a missing limiter must not take the
site down. That `503` is answered and logged like any rate-limit refusal ([`ROUTING_AND_MIDDLEWARE.md`][ram-3e] §3e), in every build.

**The `503` covers only the methods the limit counts.** `rateLimit` passes a request whose method is outside its `methods` (§4e) before it looks
for the binding, so under `methods: ["POST"]` a `GET` on the same path is served with the binding absent.

### 4c. What the Binding Counts

**The binding is an abuse brake, not a quota: its count is approximate, kept per Cloudflare location, and reported only as `{ success }`.** Per
[Cloudflare's Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/):

- **Counts are local to a location and eventually consistent.** A request served in another location spends a separate count, and a burst can
  pass `limit` before the background update arrives.
- **`period` is `10` or `60` seconds**, declared in `wrangler.jsonc`'s `ratelimits` beside `limit`.
- **`limit()` answers `{ success }` and nothing else** — no remaining count and no reset time.

So size a limit as a brake on a hostile rate; a quota that must hold exactly is a Durable Object counter the app builds. How a `429` reports the
window is [`FORGE_ERRORS.md`][eh-3e] §3e's.

### 4d. Rate-Limit Key Selection

**The chain's `trustCfHeaders` decides whether the default key may read `CF-Connecting-IP`; `rateLimit` takes no trust option of its own**
(§5c):

- **The chain trusts the CF headers** — the default key is `CF-Connecting-IP`; a missing header fails closed with `503`, reason `key-failed`.
- **A guard group's limit with no custom `key` under a chain that does not trust them** — the chain **throws at registration**, naming the
  group's paths, rather than key on a forgeable header.
- **A route-level limit with no custom `key` where no chain trust is published** — it cannot see the chain when it is built, so it answers `503`
  with reason `key-failed` on each request, logged.
- **A custom `key` always overrides**, whatever the trust. Supply one for non-Cloudflare deployments. A throwing `key` function likewise
  fails closed with `503`, reason `key-failed`.
- **`keySuffix` extends the default key** to `<CF-Connecting-IP>:<suffix>`, keeping the missing-header `503`. It is refused alongside `key`.

**§5c owns the trust rationale** and how `applyMiddlewareChain` threads one flag to every surface. Binding configuration and key-selection strategy
are `src/security/README.md`'s.

### 4e. One Declaration per Rate Limit

**A rate limit names its binding, takes its window from wrangler, keys under the chain's one trust declaration, and is declared on a guard group
when its key exists before routing or at the route when it is keyed by identity or route params.** An absent binding stays §4b's per-path `503`.

**The binding is named, and the chain checks the name.** `rateLimit: { binding: "MAIN_LIMITER", key?, keySuffix?, methods? }` replaces a
resolver over `c.env`. When the chain is built, a group's binding must be declared in `bindings` or in a contribution's binding specs — required or
optional — and present in the chain's `rateLimits` table, so a typo throws at registration, naming the group. Required or optional is decided
there, as §4b states; `rateLimit` has no boot check of its own, and `#relax/rate-limit` still skips an absent one under `forge cf dev`.

<!-- rule:forge-rate-limit-window-generated --> `forge cf gen env` emits a typed `RATELIMITS` constant, `{ NAME: { limit, period }
}`, from `wrangler.jsonc`'s `ratelimits`, and the app passes it to `applyMiddlewareChain` as `rateLimits`. The chain publishes it on the request
context, so a route-level limit reads it too, and a name missing from it is a wiring error thrown where it is read. `validate-env-schema` holds
the generated file to `wrangler.jsonc`, so the period a `429`'s `Retry-After` reports ([`FORGE_ERRORS.md`][eh-3e] §3e) is the one Cloudflare
enforces.

**One type: `RateLimit`**, Cloudflare's own shape and the name `wrangler types` and `forge cf gen env` emit; `RateLimitBinding` goes without a
shim ([`FORGE_STRUCTURE.md`][fs-7] §7). Trust is the chain's alone (§4d, §5c).

**A limit whose key exists before routing goes on the group; one keyed by identity or route params goes on the route.** A chain group runs before
params resolve and before its `guards[]` establish identity, so it holds the address-keyed limit [`BOUNDARIES.md`][boundaries-apps-2c] §2c orders
ahead of CSRF; it takes one options object or an array, so such limits stack. A limit keyed by a user, a token or a route param is a `rateLimit`
stage in `definePage`'s or `defineAction`'s guard step, or `rateLimit` on the route: it runs after CSRF and identity, as a second limit behind the
group's. The bearer-token limit behind `requireBearer` is this case.

**`methods?: readonly string[]` filters what a limit counts**, every method by default, so a `GET` flood is counted unless the app says otherwise.

**A nested auth group inherits its parent's limit, keyed per route.** `createAuthGuards({ rateLimit })` gives a keyless group the nearest keyed
ancestor's options with the route pattern appended (`routeKeySuffix`), so routes never share a budget and a request never spends two. `false`
opts out; a group with a route and no keyed ancestor still throws.

**The entry points, each with one job:** raw `rateLimit` for a route or guard step; a guard group's `rateLimit`; `createAuthGuards({ rateLimit })`,
sugar over groups; and an approval's limit, a chain contribution. `buildGuardChain` is internal. Statuses are
[`FORGE_ERRORS.md`][eh-3e] §3e's.

These alternatives were rejected:

- **Failing at boot for every named binding.** `validateBindings` sits on `*`, so the whole site would go down for a limiter on a few paths,
  against §4b. A required binding already fails at boot, and the name check catches a misspelling.
- **A window declared in forge beside wrangler's.** The two drift, and `Retry-After` would name a period Cloudflare does not enforce.
- **A chain slot after `guards[]`.** It still runs before the router, so it cannot see the route params a notebook- or bundle-keyed limit needs.
- **A `trustCfHeaders` on each surface.** A surface that disagreed with the chain silently flipped which header keyed the limit (§5c).
- **The `RateLimit` / `RateLimitBinding` pair.** One shape under two names makes an app cast between its generated type and forge's.

---

## 5. Request Identity

### 5a. requestId Middleware

**`requestId` goes first in the chain**, so everything downstream can read `requestIdCtx` — the position
[`ROUTING_AND_MIDDLEWARE.md`][ram-3e] §3e gives it. It adopts `CF-Ray` only under `trustCfHeaders` (§5c).

### 5b. Logging Integration

`requestLogger` correlates a request's entries through `requestIdCtx`, which §5a guarantees is set; what it does with the id is
[`STRUCTURED_LOGGING.md`][sl-3c] §3c's.

### 5c. Cloudflare Header Trust Boundary — `trustCfHeaders`

`CF-Ray` and `CF-Connecting-IP` are trustworthy **only when the request transited Cloudflare's edge**. A Worker reachable directly receives
whatever a client sent, so adopting them unconditionally lets a client forge its own request id or rate-limit key. **Forge therefore distrusts
them unless `trustCfHeaders: true`**, and every surface defaults to `false`:

| Surface | With `trustCfHeaders: true` | Default |
| --- | --- | --- |
| `requestId({ trustCfHeaders })` | Adopt `CF-Ray` as the id (UUID fallback) | Always mint a UUID; ignore `CF-Ray` |
| `MiddlewareChainOptions.trustCfHeaders` | Threaded to `requestId()`, and published on the request context for every rate limit — a group's, a route's, an approval's (§4d) | Both distrust the CF headers |

**`applyMiddlewareChain` takes a single `trustCfHeaders`, and it is the only place an app declares it**, so the trust posture is stated once and
no surface can disagree with it. `rateLimit`, an approval and a hand-mounted group take no trust option of their own (§4e).

**A Cloudflare-deployed app must set `trustCfHeaders: true` or pass a custom rate-limit `key`**; what each limit does otherwise is §4d's.

---

## 6. Content Type Guards

### 6a. requireFormContentType

**Apply `requireFormContentType` to HTML form endpoints, never to an API route that accepts JSON.** Its `415` stops a JSON-bodied cross-site
request that same-site cookies do not.

---

## 7. Transport-Layer Boundary

See [`BOUNDARIES.md`][boundaries-2] §2 for the transport-versus-application boundary: what `security` may hold, what belongs to a higher-level
namespace, and why identity is application-layer.

---

## 8. Secret Strength — One Rule for Every Secret

**Every secret forge imports is held to one rule, and a secret that fails it throws where it is imported — for a session secret, where the
cookie is created — naming the call that refused it.** The rule is
`assertSecretStrength` in `src/crypto/primitives/strength.ts`, which is the source of truth:

- **At least 32 bytes** — HMAC-SHA-256's full security margin, and HKDF's floor for input keying material.
- **Not one byte value repeated** throughout.
- **At least eight distinct byte values.** A CSPRNG's 32 bytes clear this by a wide margin; a placeholder drawn from seven byte values or fewer
  does not.

The variety check refuses a secret that was plainly never generated. It does not measure entropy: a typed passphrase or a patterned hex string
passes it, so passing proves nothing about a secret chosen by hand.

**The bytes measured depend on the kind of secret:**

| Secret | Imported by | Measured as |
| --- | --- | --- |
| Key-ring root secret, the CSRF, signed-URL and session secrets included | `importKeyRing`, `importAuthKeyRing`, and a hand-built `KeyRing` when `resolveAuthServices` checks it | the hex-decoded bytes, so 64 hex characters is the floor |
| Webhook secret | `createWebhookSigning` | the base64-decoded bytes after `whsec_` |

<!-- rule:forge-secret-from-binding --> A secret in a binding is one `forge cf sync --rotate` can replace; a literal ships in every bundle and every
clone of the repository.

**Generate every secret from a CSPRNG.** `openssl rand -hex 32` gives a secret that passes for every row above; a webhook secret is
`whsec_$(openssl rand -base64 32)`. `forge cf sync --rotate` generates 32 CSPRNG bytes of hex for a key marked `# forge:generate`; a key ring is
marked `# forge:ring`, and `--local --rotate` prepends a fresh key to it.

**`CsrfConfigSchema` checks the length half earlier**, when the config is parsed at startup ([`INPUT_VALIDATION.md`][iv-5a] §5a); the variety check
runs when the secret is imported.

[boundaries-2]: ../warden/canon/libs/BOUNDARIES.md#2-transport-versus-application-security-layer
[boundaries-5b]: ../warden/canon/libs/BOUNDARIES.md#5b-required-false--non-security-features-only
[boundaries-apps-2c]: ../warden/canon/apps/BOUNDARIES.md#2c-guard-order-within-a-route
[eh-2d]: ./FORGE_ERRORS.md#2d-fragment-options-and-escaping
[eh-3e]: ./FORGE_ERRORS.md#3e-one-refusal-contract-for-every-guard
[fs-7]: ./FORGE_STRUCTURE.md#7-pre-10-api-evolution
[htmx-7]: ./HTMX.md#7-trust-posture--selectors-and-json-values-must-be-developer-supplied
[htmx-7a]: ./HTMX.md#7a-url-valued-hx-attributes-are-deliberately-unsanitized
[htmx-7b]: ./HTMX.md#7b-what-htmx-evaluates-hx-on-and-a-js-prefixed-hx-vals-or-hx-headers
[iv]: ./INPUT_VALIDATION.md
[iv-5a]: ./INPUT_VALIDATION.md#5a-csrfconfigschema--csrf-secret-validation
[namespaces-5i]: ./NAMESPACES.md#5i-dev-only-relaxations--a-relax-module-never-a-boolean-on-a-production-option
[ram]: ./ROUTING_AND_MIDDLEWARE.md
[ram-3d]: ./ROUTING_AND_MIDDLEWARE.md#3d-security-middleware-placement
[ram-3e]: ./ROUTING_AND_MIDDLEWARE.md#3e-applymiddlewarechain-canonical-chain-builder
[ram-6a]: ./ROUTING_AND_MIDDLEWARE.md#6a-registering-a-shell
[sb-3b]: ./STORAGE_BINDINGS.md#3b-serveobject--direct-response-from-a-backend
[security-webhooks]: ../src/security/README.md#signing-and-verifying-webhooks
[sl-3c]: ./STRUCTURED_LOGGING.md#3c-ordering-requestid-before-requestlogger
[wp-4e]: ../warden/canon/apps/WORKERS_PLATFORM.md#4e-development-transport-posture
