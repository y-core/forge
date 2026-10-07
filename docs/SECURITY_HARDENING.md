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
- §2b NONCE Constant: the CSP placeholder
- §2c mergeSecurityHeaders for Dev/Prod Split: layering the live-reload hash
- §2d getNonce and Automatic URL Sanitization: reading the nonce; `safeUrl` at render time
- §2e Default Header Set: which headers are emitted, which are opt-in, and which are a route concern
- §2f createRouteSecurityHeaders and the Handler-Set CSP: why a response's own CSP combines with the app's, and how a route loosens it instead
- §2g Trusted Types and htmx — the forge-htmx Policy: the name to list, why a pass-through policy is acceptable, how it fails closed, and what
  enforcement forbids
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
- §8 Secret Strength — One Rule for Every Secret: the floor and the variety check, how each kind of secret is measured, and how to generate one

---

## 1. What Is Not in security

`src/security/mod.ts` is authoritative for what this namespace exports, and `src/security/README.md` teaches how to use them.

**Not in security** — a common mistake:

| Looked for here | Actually in |
| --- | --- |
| `timingSafeEqual` / `timingSafeEqualBytes` | internal `src/crypto/` (`@internal`) |
| `csrfProtection`, `importCsrfKey`, `mintCsrf` | `@y-core/forge/form` |
| `sessionMiddleware` | `@y-core/forge/session` |
| `isHxRequest` | `@y-core/forge/render/htmx` — a UX hint, not a boundary ([`HTMX.md`][htmx-7] §7) |

---

## 2. createSecurityHeaders and CSP Nonce

### 2a. createSecurityHeaders Factory Pattern

`createSecurityHeaders` generates a fresh nonce per request (16 random bytes, base64url), injects it into the CSP `script-src`, and stores it on the
request context for `getNonce(c)`. That pairing is what lets an inline `<script>` run under a policy carrying no `'unsafe-inline'`: the script tag
names the nonce, the header names the same nonce, and nothing else in the document executes.

**Every request gets a fresh nonce** — a static nonce defeats nonce enforcement entirely.

**Only the nonce is per-request.** Each CSP header is rendered once at factory time into a template holding a NUL placeholder where the nonce goes,
the other headers are computed once and frozen, and a request does one `replaceAll` per template. The placeholder is unreachable to a caller:
`CSP_SOURCE_TOKEN` is `/^[\x21-\x7e]+$/`, which excludes NUL. Validation still throws from the factory, before the first request, rather than from
the render: `assertValidSecurityHeadersOptions` is the entry, and it runs `assertValidCspDirectives` once for each policy it will emit.

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

A header baked into the handler's own `Response` is resolved in the channel's favour: `mergePendingHeaders` set-overwrites onto the response.
**`Content-Security-Policy` is the one name that combines instead of overwriting.** The queued policy is set and the response's own is appended
after it, so a handler's CSP can only tighten the app's (§2f).

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
`background`, `data` and the namespaced `xlink:href` / `xml:base` through `safeUrl` (`@y-core/forge/html`), which admits an allow-list of schemes
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
a `js:`-prefixed `hx-vals` or `hx-headers` is evaluated on the same terms; both are held by who wrote the value ([`HTMX.md`][htmx-7b] §7b). Where
Trusted Types is enforced, htmx's own writes go through the `forge-htmx` policy and both evaluated forms are refused (§2g).

### 2e. Default Header Set

`src/security/headers.ts` owns the emitted values. What this section owns is which headers are in the set and why:

- **Emitted with a hardened default:** `Content-Security-Policy` (strict, per-request nonce), `Strict-Transport-Security`, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy`.
- **`Strict-Transport-Security` defaults to a two-year `max-age` with `includeSubDomains` and `preload`, and one option, `hsts`, shapes it.**
  `hsts: false` omits the header. An object sets `maxAge`, a non-negative integer of seconds that throws otherwise, and turns off either token
  with `includeSubDomains: false` or `preload: false`; each field it leaves out keeps its default, which `HSTS_DEFAULT_MAX_AGE` in
  `src/security/headers.ts` owns for `maxAge`. `mergeSecurityHeaders` merges two `hsts` objects field by field, while an `extra` of `false`, or
  an object laid over a base of `false`, replaces the base outright.

  **`preload` is kept in the default and is the one token worth deciding on purpose.** On its own it does nothing; it is the consent
  hstspreload.org requires before listing a domain, and a listing ships inside browser releases, so leaving the list again takes months. An app
  that will never submit its domain, or cannot yet promise https on every subdomain, sets `preload: false`.
- **`X-Frame-Options` is emitted although `frame-ancestors` already covers it** — the redundancy is deliberate, for user agents that honour only the
  legacy header.
- **`Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy` each have a named override** (`crossOriginOpenerPolicy`,
  `crossOriginResourcePolicy`), because a popup-based OAuth or payment flow and an intentionally embeddable resource each need a looser value than
  the default.
- **`Referrer-Policy` has an override, `referrerPolicy`, that can tighten the default and never loosen it.** Its type admits only values at least
  as strict as the default, and it is app-level only, like the cross-origin policies. `no-referrer` is stricter still and is excluded all the same:
  `verifyOrigin` in `src/security/origin.ts` falls back to `Referer` when a request carries no `Origin`, and `no-referrer` strips the same-origin
  `Referer` too, so that fallback would become a 403.
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
- **Trusted Types, violation reporting and a Report-Only policy are opt-in**, and none of their headers or directives is emitted until its option is
  set. Each has its own merge rule in `mergeSecurityHeaders`, because each is a different kind of value.

  `trustedTypes` adds `require-trusted-types-for 'script'` and a `trusted-types` list of policy names, each name held to the Trusted Types name
  grammar. `require: false` omits the first directive, so an app can restrict which policies exist before it requires them. Merging concatenates
  the policy lists, and an `allowDuplicates` or `require` the extra states wins. An app that loads `ui/client/htmx` lists its policy name there, or
  no htmx swap succeeds (§2g).

  `reporting` emits `Reporting-Endpoints` and adds `report-to` to every CSP, with a `report-uri` fallback beside it because browser support for
  `report-to` still varies. The endpoint must be an absolute https URL or a root-relative path (`/…`, never `//…`), and throws otherwise; either is
  emitted verbatim. Merging replaces `reporting` outright: an app has one place its reports go, not a list.

  **A root-relative path is the per-deployment answer.** The browser resolves it against the page it is reporting from — the Reporting API
  parses a `Reporting-Endpoints` value against the response URL, and CSP resolves `report-uri` against the document — so one configuration
  reports to whichever origin served the page. An absolute URL names one deployment's origin, and every other deployment's reports then go
  cross-origin, where the Reporting API's CORS-mode upload goes unanswered and the reports are lost. A scheme-relative or bare relative value
  still throws: the first can name another host, and the second resolves differently on every page path.

  `reportOnly` emits `Content-Security-Policy-Report-Only` from the same builder and under the same nonce as the enforced policy. A field it states
  replaces the enforced field, and a field it leaves out is inherited, so a candidate is written as its difference from the enforced policy. It
  never carries `upgrade-insecure-requests`, which browsers ignore in a report-only policy. Merging concatenates its source lists as it does the
  enforced ones, and a directive the base's `reportOnly` never stated is backfilled from the merged enforced list rather than from the default,
  which is what inheritance would have given it.
- **`Cache-Control` is deliberately not a blanket default.** Caching is a per-route decision (`definePage({ cache })`), and a namespace-wide value
  would either over-cache a private page or defeat caching everywhere. Within that per-route decision, `cache.scope` defaults to `"private"`: a page
  that states a `maxAge` and no scope is browser-cacheable and never shared-cacheable, so forgetting the field on a personalised page cannot let an
  edge serve one reader's HTML to another. Edge caching is opted into with `scope: "public"`.

### 2f. createRouteSecurityHeaders and the Handler-Set CSP

**A response's own `Content-Security-Policy` is combined with the app's, never replaced by it.** Both the pending-header flush
(`mergePendingHeaders`) and `applySecurityHeaders` set the app's policy and then append the one the response already carried, so the response
leaves with two policies. A browser enforces every policy it receives, and a load must pass all of them. A second policy can therefore only take
permissions away: a handler's CSP tightens the app's and cannot loosen it. That is what makes combining safe as the default for every response,
including an upstream response a handler proxies through unchanged.

**The case this protects is `serveObject`'s `sandbox`.** Whether an object is active content is known only after the backend read, inside
`storage/r2`, which is a leaf with no request context ([`STORAGE_BINDINGS.md`][sb-3b] §3b). No middleware could decide it in advance. If the app's
policy overwrote the handler's, an uploaded HTML or SVG object served `inline` would render on the app's origin under the app policy instead of in
a sandbox.

**`Content-Security-Policy-Report-Only` still overwrites.** The combine rule is justified by enforcement, and a report-only policy enforces
nothing, so a handler's candidate gives up no protection when the app's replaces it.

**Loosening a route is `createRouteSecurityHeaders(extra)`'s job, because a handler's header cannot do it.** The middleware lays `extra` over the
options `createSecurityHeaders` recorded on the request, by `mergeSecurityHeaders`' rules (§2c, §2e), and queues the CSP family again under the
request's nonce. It is registered deeper than the app-level factory, so its queue wins per name (§2a).

- **It throws when `createSecurityHeaders` has not run on the request.** Without the app's options it has nothing to widen and no nonce to render
  with, and a policy built from defaults alone would silently drop every directive the app declared.
- **It takes `CspOptions`, not `SecurityHeadersOptions`.** The CSP family is the only part of the header set rendered against the request's nonce,
  so it is the only part whose route variant must be built from the app's options and this request together. The rest of the set is origin-wide
  posture: HSTS, for one, is stored per hostname, so a per-route value is not one a browser can hold.
- **The merged policy is built once per base-options object.** A `WeakMap` keyed on the options object the app passed to `createSecurityHeaders`
  holds the rendered templates, so a request on the route pays one `replaceAll` per header, as it does at app level.
- **An invalid merge throws at the route's first request, not at construction.** `extra` is validated alone when the middleware is built, but the
  app's options exist only on a request. A combination the validator refuses — `UNSAFE_INLINE` merged onto a backfilled nonce (§2e) — is never
  cached, so it throws on every request to the route.

### 2g. Trusted Types and htmx — the forge-htmx Policy

**An app that enforces Trusted Types and loads `ui/client/htmx` lists `forge-htmx` in its `trusted-types` directive.** The entry creates a policy by
that name when it loads and hands it to htmx. htmx then routes its one HTML parse, and the text of every script in swapped content, through it. The
name is exported as `HTMX_TRUSTED_TYPES_POLICY` from `@y-core/forge/ui/contracts`. A page that renders `<Turnstile>` also lists
`forge-turnstile`, exported beside it as `TURNSTILE_TRUSTED_TYPES_POLICY`:

```ts
createSecurityHeaders({ trustedTypes: { policies: [HTMX_TRUSTED_TYPES_POLICY, TURNSTILE_TRUSTED_TYPES_POLICY] } });
```

`security` does not re-export either name. That would add a dependency from `security` to `ui/contracts`, and the app already imports both.

**The `forge-turnstile` policy admits only Cloudflare's script URL.** The Turnstile controller creates one per window and uses it for a single
write: `TURNSTILE_SCRIPT_URL` into the `src` of the script it injects. Any other URL throws. When the browser refuses the policy or the write, the
controller logs a `console.error` naming the `trusted-types` fix and shows the widget's fallback message instead of loading the script.

**The policy returns its input unchanged, and that is acceptable because of what reaches it.** htmx fetches only from the page's own origin
([`HTMX.md`][htmx-7a] §7a), and every body forge renders is escaped server-side markup. The policy therefore vouches only for markup the app's own
server wrote. Trusted Types still guards everything else: an `innerHTML` write in app code, a third-party script, a string handed to `eval` — none
of them has a policy, so the browser refuses each. `forge-htmx` is a named policy that only htmx holds, and forge creates no `default` policy.

**It fails closed.** When the browser refuses to create the policy — the name is missing from `trusted-types`, or something already created it and
the list carries no `'allow-duplicates'` — the entry logs a `console.error` naming the `trusted-types` fix. It then gives htmx a policy that throws
on every call, so htmx reports `htmx:error` and swaps nothing rather than writing to a sink unguarded. That holds even under `require: false`: a
`trusted-types` list that leaves the name out refuses the policy whether or not the browser requires one.

**What enforcing Trusted Types forbids in an htmx page:**

- **No `hx-on:*` attribute and no `js:` value.** htmx compiles them with the native `Function` constructor and `forge-htmx` gives it no policy for
  that, so the browser refuses them even where `UNSAFE_EVAL` admits eval ([`HTMX.md`][htmx-7b] §7b). A `js:` request URL is refused earlier, by
  `forge-htmx` itself, whether or not Trusted Types is enforced.
- **No `<script src>` in content htmx swaps in, including the `<body>` of a page a boosted link navigates to.** htmx rebuilds each swapped script by
  copying its attributes with `setAttribute`, and `src` is a Trusted Types sink htmx does not send through the policy. The write throws and the
  whole swap is lost: the URL is pushed and the body is never replaced, and going back fails the same way. `pageShell` puts its scripts in
  `<head>` for this reason ([`ROUTING_AND_MIDDLEWARE.md`][ram-6a] §6a), and a hand-written shell must do the same. Inline script text goes through
  the policy and runs.
- **An htmx `extensions` allowlist, if the app sets one, names `forge-htmx`.** htmx refuses to register an extension the list leaves out. The
  entry logs a `console.error`, htmx keeps its own pass-through object, and the browser refuses every sink write made with it.

**Nothing is enforced in a browser without the Trusted Types API.** It ignores both directives, the entry creates no policy, and htmx writes as it
always has; `script-src` (§2e) is then the only layer. The `js:` request-URL refusal still applies there, because it belongs to the extension and
not to the policy.

The swap under the policy, both refusals of it, the lost `<script src>` swap and the `js:` refusal are pinned in
`src/ui/client/htmx-security.browser.ts`.
The Turnstile script load under `forge-turnstile` and the fallback when the CSP leaves it out are pinned in
`src/ui/client/turnstile.browser.ts`. That spec serves a stand-in for Cloudflare's `api.js`, so what the real script writes once it runs is not
covered.

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

Middleware that rejects any request whose `Origin` is not in the allowlist. Use on privileged endpoints a browser calls. **Never put it on a webhook
receiver:** a delivery is server-to-server and carries no origin signal, so this guard refuses it. A receiver checks the signature with
`createWebhookSigning`'s `verify` instead ([Signing and verifying webhooks][security-webhooks]).

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
| `originGuard(allowed)` | `Origin`/`Referer` only | Fails closed (`403`) — no signal is refused like a disallowed one | Privileged browser-called endpoints keyed purely on an origin allowlist — never a webhook receiver |

**`originProtection` is the recommended default** — the others are the single-signal tiers it is built from.

All of them exempt safe methods (`GET`/`HEAD`/`OPTIONS`/`TRACE`) first, so only state-changing requests are gated. **A `GET` carrying
`Upgrade: websocket` is not exempt**: the handshake opens a cookie-bearing channel, so a foreign page holding one open is cross-site WebSocket
hijacking. It is judged on `Origin` alone, which a browser always sends on a handshake (RFC 6455 §4.1): a `Referer` does not stand in for it, and
`originProtection` does not fall back to Fetch-Metadata vouching when it is absent. `originProtection` treats
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

**HSTS is on in development too, so choose the dev hostname for it.** A browser stores the policy per hostname, on every port, and with the
default `includeSubDomains` for every name below it. Stored for bare `localhost`, it forces https on every local project that browser opens there.
Reach dev at a per-project hostname or at `127.0.0.1`, never at bare `localhost`; a browser stores no policy for an IP address at all. To clear a
policy a browser already holds, delete it in that browser's own HSTS settings. An untrusted dev certificate is no defence to rely on either way —
a browser ignores the header on a connection with a certificate error (RFC 6797, section 8.1), so whether a policy was stored depends on whether
the certificate was trusted at the time.

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

---

## 8. Secret Strength — One Rule for Every Secret

**Every secret forge imports is held to one rule, and a secret that fails it throws where it is imported — for a session secret, where the
cookie is created — naming the call that refused it.** The rule is
`assertSecretStrength` in `src/crypto/strength.ts`, which is the source of truth:

- **At least 32 bytes** — HMAC-SHA-256's full security margin, and HKDF's floor for input keying material.
- **Not one byte value repeated** throughout.
- **At least eight distinct byte values.** A CSPRNG's 32 bytes clear this by a wide margin; a placeholder drawn from seven byte values or fewer
  does not.

The variety check refuses a secret that was plainly never generated. It does not measure entropy: a typed passphrase or a patterned hex string
passes it, so passing proves nothing about a secret chosen by hand.

**The bytes measured depend on the kind of secret:**

| Secret | Imported by | Measured as |
| --- | --- | --- |
| CSRF secret | `importCsrfKey`, `importCsrfKeyRing` | the hex-decoded bytes, so 64 hex characters is the floor |
| Signed-URL secret | `importSignedUrlKeyRing` | the hex-decoded bytes |
| Key-ring root secret | `importKeyRing`, `importAuthKeyRing`, and a hand-built `AuthKeyRing` when `resolveAuthServices` checks it | the hex-decoded bytes |
| Session secret | `createSignedCookie`, so `createAnonymousSession` and flash cookies too | the UTF-8 bytes of the string, never hex-decoded |
| Webhook secret | `createWebhookSigning` | the base64-decoded bytes after `whsec_` |

A session secret is used as the string it is, so 64 hex characters count as 64 bytes there. Hex-decoding it instead would change the HMAC key
and invalidate every cookie already issued.

**Generate every secret from a CSPRNG.** `openssl rand -hex 32` gives a secret that passes for every row above; a webhook secret is
`whsec_$(openssl rand -base64 32)`. `forge cf sync --rotate` generates 32 CSPRNG bytes of hex for a key marked `# forge:generate`.

**`CsrfConfigSchema` checks the length alone.** It requires at least 64 hex characters, so a short CSRF secret fails when the config is parsed at
startup. The variety check runs when the secret is imported.

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
[ram-6a]: ./ROUTING_AND_MIDDLEWARE.md#6a-registering-a-shell
[sb-3b]: ./STORAGE_BINDINGS.md#3b-serveobject--direct-response-from-a-backend
[security-webhooks]: ../src/security/README.md#signing-and-verifying-webhooks
[sl-3c]: ./STRUCTURED_LOGGING.md#3c-ordering-requestid-before-requestlogger
[wp-4e]: ../warden/canon/apps/WORKERS_PLATFORM.md#4e-development-transport-posture
