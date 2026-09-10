---
title: Error Handling
description: "The published Result signatures, the http fragment renderers, and the router error boundary's header guarantees across its three paths."
audience: consumer
---

# Error Handling

> Owns forge's published `Result` signatures and domain aliases, the `http` fragment renderers,
> and the router error boundary's header guarantees. The primitive's _rules_ — narrowing, the
> single failure channel, the taxonomy — are governance; this document owns the surface.
>
> Defers to: [`INPUT_VALIDATION.md`](./INPUT_VALIDATION.md) for the validation pipeline that
> produces a `ValidationResult`; [`ROUTING_AND_MIDDLEWARE.md`](./ROUTING_AND_MIDDLEWARE.md) for
> where handlers sit in the chain; [`STORAGE_BINDINGS.md`](./STORAGE_BINDINGS.md) for the
> resolver pattern §5e references.

---

## 0. Quick Reference

- §1 Result Monad: the single failure channel and its constructors
- §1a The Unified Result Primitive: `Result<T,E>`, `ok`/`err`, `result`, `toError`
- §1b Narrowing a Result: the `if (!r.ok)` guard and early return
- §1c `GuardResult` and `ValidationResult` Domain Aliases: domain shapes that narrow only `E`
- §2 Fragment Renderers: `SafeHtml` in, status on the response
- §2a renderError: single-message failure fragment
- §2b renderSuccess: success banner fragment
- §2c renderValidationErrors: per-field message list fragment
- §2d Fragment Options and Escaping: presentation only; option values are escaped
- §3 htmlResponse, html Tag, and escapeHtml: full-page and raw-string render paths
- §3a htmlResponse: full-page render with a fixed content-type
- §3b html Tagged Template: `SafeHtml` from a raw string fragment
- §3c escapeHtml: manual escaping outside the auto-escaping render paths
- §3d Who Answers in What: guards in plain text, handlers in fragments or pages
- §4 Fail-Closed Posture: missing security dependency means 503
- §5 Error Taxonomy: expected, unexpected, and infrastructure failures
- §5a Expected Errors: return a Result or a fragment, never throw
- §5b Unexpected Errors and the Router Error Boundary: in-chain vs out-of-chain headers, and cancellation
- §5c Infrastructure Errors: log with context, then fail closed
- §5d defineAction and definePage Error Recovery: the intentional divergence
- §5e Startup Invariants: resolvers throw, operations return Result
- §5f Configuration Knobs: asserted where accepted, by authLimit

---

## 1. Result Monad

### 1a. The Unified `Result` Primitive, `ok`/`err`, `result` and `toError`

forge has exactly **one** result primitive, published from `@y-core/forge/result` as the type
`Result<T, E>` plus four values — `ok`, `err`, `result` and `toError`. **`src/result/mod.ts` is
authoritative for every one of those signatures**, including `ok`'s void overload and `result`'s
sync/async/promise overloads; `src/result/README.md` shows them in use.

**Return `Result` from any function that can fail predictably.** Never return `null | T` and
never throw for an expected failure.

**There is exactly one failure field: `error`.** No `errors`, no `reason` — every domain shape
reuses that one channel. Success carries `data`.

**Build values with `ok()` / `err()`, never object literals.** They are the one documented
exception to the `create*` factory-naming rule ([`NAMESPACES.md`](./NAMESPACES.md)
§5e): they construct values, not configured objects.

### 1b. Narrowing a Result

See [`ERROR_HANDLING.md`](../warden/canon/libs/ERROR_HANDLING.md) §1b for the guard shape, the
early-return rule, and why a cast after a `Result` check is a defect.

### 1c. `GuardResult` and `ValidationResult` Domain Aliases

Both are plain aliases of §1a that narrow only the failure type `E`. The discriminant stays
`ok`; the failure channel stays `error`. `ValidationResult<T>` narrows `E` to a readonly string
list, `GuardResult<R>` narrows the success type to `void`; both are declared in
`src/result/mod.ts`, and `ValidationResult` is re-exported from `@y-core/forge/validation`.

**`ValidationResult<T>` carries the per-field message list in `error`.** A flat list of
already-formatted messages (`"Email is required"`). Do not collapse the issues into a single
`Error` — the list feeds `renderValidationErrors` (§2c) so every failing field surfaces at once.

**`GuardResult<R>` is for predicate checks that produce no success value** (origin, CSRF,
Turnstile). `R` is typically a string-literal union of reason codes. Construct with `ok()` and
`err(reason)`.

**Never echo a `GuardResult` reason code to a client.** It is a server diagnostic.

---

## 2. Fragment Renderers (`http` namespace)

All three render HTMX-compatible partial HTML — never a full `<html>` document — and return
`SafeHtml`, not a `Response`. Import from `@y-core/forge/http`.

**Set the status on `fragmentResponse(body, status?, headers?)`, not on the renderer.**
`fragmentResponse` fixes `content-type` to `text/html; charset=utf-8`; passing a `content-type`
key (case-insensitive) **throws** rather than being silently ignored.

**`serveObject` is the one ratified exception to "return `SafeHtml`, not `Response`."**
As an HTTP-boundary method it owns its full response — see §5e.

### 2a. `renderError` — Error Fragment

Use for single-message failures with no field attribution: rate-limit exceeded, service
unavailable, generic handler errors.

### 2b. `renderSuccess` — Success Fragment

Success uses the `fragmentResponse` default status `200` so HTMX swaps the target instead of
triggering error handling.

### 2c. `renderValidationErrors` — Validation Error Fragment

Renders the flat message list as a `<ul>`. Pass the `error` list from a `ValidationResult`
(§1c) directly.

### 2d. Fragment Options and Escaping

`FragmentOptions` controls presentation only — `class`, `successAttr`, `ulClass`.

**Every option _class_ value is HTML-escaped before interpolation**, so a hostile class string
cannot break out of the attribute.

**`successAttr` is interpolated verbatim** — it is by contract a developer-supplied raw
attribute fragment. Never pass user input to it.

---

## 3. `htmlResponse`, `html` Tag, and `escapeHtml`

### 3a. `htmlResponse` Pattern

`htmlResponse(body, status?, headers?)` is the primary full-page return. It guarantees a
leading `<!DOCTYPE html>` and fixes `content-type: text/html; charset=utf-8` — passing a
`content-type` key **throws**. `body` is a string or `SafeHtml`.

**For HTMX partials that must not carry a DOCTYPE, use `fragmentResponse` (§2).**

### 3b. `html` Tagged Template

`html` returns a `SafeHtml`-branded value (test membership with `isSafeHtml`). It escapes
interpolated strings by default; `rawHtml(...)` opts a pre-trusted fragment out.

**Prefer JSX components over `html`.** Use the tag only when building raw string fragments for
injection into pre-existing HTML strings.

### 3c. `escapeHtml`

Escapes `&`, `<`, `>`, `"`, `'` to their entity equivalents.

```ts
escapeHtml('<script>alert("xss")</script>');
// → '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
```

**Required for any dynamic string injected via `rawHtml` or raw concatenation.** The JSX
runtime and the `html` tag auto-escape, so `escapeHtml` is only needed outside those paths.

**For URL attribute values use `safeUrl`, not `escapeHtml`** — see
[`SECURITY_HARDENING.md`](./SECURITY_HARDENING.md) §2d.

Test assertions against rendered HTML must match the encoded form —
[`TESTING.md`](./TESTING.md) §3a owns the encoding map.

### 3d. Who Answers in What — Guards in Plain Text, Handlers in Markup

**A guard refuses in plain text; a handler refuses in a fragment or a page.** Every transport guard
answers with a bare string body — `Forbidden` (403) from `crossOriginProtection`, `originProtection`
and `originGuard`, `Too many requests. Please try again later.` (429) and `Service unavailable`
(503) from `rateLimit`, `Unsupported Media Type` (415) from the content-type guard. The handler
tiers answer in markup: a fragment renderer (§2) for `defineAction`, a full page for `definePage`
and the boundary (§5b).

**Why: a guard has no page context.** It runs before any handler, so it knows neither the shell nor
the route's render mode, and it must be equally correct in front of an API route and an HTML one.
Rendering a document there would be a guess.

**The consequence to design for: an HTMX target will swap the raw text.** A `403 Forbidden` from a
guard lands in the swap target as the literal word, not as a styled banner. Where that matters,
give the guard its own answer — `rateLimit` takes `onLimit` — rather than expecting forge to guess
a fragment.

**`auth/web`'s guards are the documented exception, and mostly are not refusals at all.** They route
through `refuse()`, which redirects an HTML request to the remedy page and answers a JSON one with a
JSON body. Only two produce plain text: `requireAdmin`'s `Forbidden`, and the unknown-demand
`Service Unavailable` (503), which cannot redirect because every remedy page asks the same
unavailable store and the redirect would loop.

---

## 4. Fail-Closed Posture

See [`BOUNDARIES.md`](../warden/canon/libs/BOUNDARIES.md) §5 for the fail-closed posture, the
`required: false` asymmetry, and the three conditions a ratified fail-open exception must meet.
forge's one such exception is `cn`'s conflict resolver
([`UI_CLASS_COMPOSITION.md`](./UI_CLASS_COMPOSITION.md) §1a).

---

## 5. Error Taxonomy

### 5a. Expected Errors — Return `Result` or Fragment

See [`ERROR_HANDLING.md`](../warden/canon/libs/ERROR_HANDLING.md) §5a for the tier itself and the
never-throw rule. What is local: a forge handler renders an expected failure with a fragment
renderer (§2) returned through `fragmentResponse`, and never as a thrown error.

### 5b. Unexpected Errors — The Router Error Boundary

Programming mistakes that cannot be recovered at the call site. **The app needs no per-route
`try/catch`** — the router installs an error boundary as a global middleware, at two depths: one
innermost, one wrapped around the path-scoped guard stack.

Three paths, with different header guarantees, plus a fourth that is not an error at all:

- **In-chain errors** (thrown by a route handler or route-level middleware) — the innermost
  `errorBoundary` catches the throw; the response flows back out through the path-scoped guards
  and the outermost `applyHeaders` flush, so error pages carry the consumer's full CSP.
- **Guard errors** (thrown by an `app.use` middleware) — the outer boundary catches them, so the
  response still reaches `applyHeaders` and carries whatever headers were already queued. The
  guards downstream of the throw never ran, so their headers are not among them. `createSecurityHeaders`
  queues **before** `next()` (`SECURITY_HARDENING.md` §2a), so a guard throwing after it still
  yields a fully hardened error page; a guard that queues on the way out — `session`, `flash` — does
  not, which is what the innermost boundary depth still protects.

**Queued-header precedence** is _last writer wins per name_, and inner middleware queues after
outer, so an overlapping name resolves **inner-wins**. That is distinct from the pending-vs-Response
rule below: pending always beats a header the handler baked into its own `Response`.

- **Out-of-chain errors** (thrown in router internals, or by env/config resolution before routing)
  never reach the consumer's security middleware, so the handler emits a self-contained
  **baseline-hardened 500**:

  | Header | Value |
  | --- | --- |
  | `X-Content-Type-Options` | `nosniff` |
  | `Content-Security-Policy` | `default-src 'none'` |
  | `Referrer-Policy` | `no-referrer` |
  | `X-Request-Id` | this request's id — **only when `requestId` middleware already ran** |

  On the in-chain path `applyPendingHeaders` set-overwrites these with the consumer's policy.
  No error path ships an unprotected response.

**Both error pages quote the request id when there is one to quote.** The default page and
`createErrorPage` render a short `Reference: <id>` line from `requestIdCtx`, escaped — the opaque
internal identifier canon §3b permits, and what a user can paste into a support ticket. **Neither
generates one:** without the `requestId` middleware there is no id, and the line is omitted. On the
out-of-chain path no middleware ran, so a throw before `requestId` carries neither the line nor the
header.

- **Cancellation** (the client disconnected before the handler finished) — **not an error.**
  `@remix-run/fetch-router` races every handler against `request.signal` and rejects with the
  signal's reason, which reaches the boundary like any throw. The boundary checks
  `request.signal.aborted` first and answers a bodyless **499**: no `onError` override is called, no
  error page is rendered, and nothing is logged — not by the boundary, and not by `requestLogger`,
  whose own error record is suppressed on the same condition. There is no client left to receive a
  page, and a disconnect is not a defect to page anyone about. `definePage` and `defineAction`
  rethrow on the same condition, so neither an `onError` page nor the generic fragment is built for
  a gone client — **this is the one case `defineAction` rethrows** (§5d).

The boundary logs via `createLogger("app")` and includes the escaped `err.message` only in
debug builds (the `isDebug` predicate passed to `createApp`). **The client never receives a
stack trace.** Consumers may override the page with `onError` on `createApp`, `definePage`, or
`defineAction`.

### 5c. Infrastructure Errors — Log and Fail Closed

See [`ERROR_HANDLING.md`](../warden/canon/libs/ERROR_HANDLING.md) §5c for the tier, the
catch-log-`503` rule, and what a log line may and may not carry. What is local: the log goes through
`createLogger` rather than `console`, so a Worker's structured output carries the request context
the canon calls for.

**`Network connection lost` is one of these**, not a special case. Cloudflare lists it among the
runtime errors a `fetch` or a binding call can throw
([Workers runtime errors](https://developers.cloudflare.com/workers/observability/errors/)); forge's
answer is the same catch-log-`503`. **Retry is the consumer's decision, so no retry loop belongs
inside a storage client** — the client cannot know whether the call was idempotent or how long the
caller is willing to wait (`src/storage/README.md`).

### 5d. `defineAction` and `definePage` Error Recovery

`defineAction` centralises action error handling: an oversized body surfaces **413**, an
otherwise unparseable body **400**, validation failures `renderValidationErrors` (unless
`onValidationError` is supplied), and a throw from `handle` a generic **500** fragment logged
via `createLogger("action")` (unless `onError` is supplied).

`definePage` accepts `onError(error, c)`; with no hook the error **re-throws** so the boundary
(§5b) handles it.

**The divergence is intentional.** A full-page `definePage` GET is part of a navigable
document, so an unhandled failure must bubble to the full-page boundary. A `defineAction` HTMX
call swaps a fragment into an existing page, so it stays self-contained. The difference is only in
what the client receives, never in whether the error is recorded.

**One error, one record, written by the layer that terminates it.** A `definePage` with no
`onError` logs nothing and re-throws — the boundary is the terminating layer and reports it there.
A builder that recovers the error itself logs it, because the boundary never will: `definePage`
with an `onError` at error level, `defineAction` at **warn** when its `onError` recovers and at
error when it renders the generic 500. Every one of those records carries `serializeError(error)`,
so the shape is the same wherever it was written. `requestLogger`'s per-request summary is a
separate record by design — it carries the `method`, `path` and `duration` the error record does
not.

**A throwing `onError` is attributed to the hook, not folded into the original.** All three hooks —
`createApp`'s, `definePage`'s and `defineAction`'s — log their own failure with the original error
alongside it, then fall through as if no hook had been supplied.

**Use these hooks for per-route recovery instead of ad-hoc `try/catch`.**

### 5e. Startup Invariants — Env Validation and Binding Resolvers Throw

A missing or malformed binding is a **deployment defect**, not a runtime condition to degrade
around. These surfaces `throw` a plain `Error` instead of returning `Result`:

- `Config.get` and config `resolve` (`config`)
- `validateEnv` and the `validateBindings` middleware (`app`)
- `resolveKVStore`, `resolveD1Client`, `resolveObjectStore` (`storage/*`)

**Env and config failures throw the normalized shape `Invalid environment: <field>: <reason>; …`**
produced by `formatEnvIssues` (`src/validation/format-issues.ts`, `@internal`) — never hand-roll the
formatting, and never reproduce `issue.message`, which embeds the rejected value
([`INPUT_VALIDATION.md`](./INPUT_VALIDATION.md) §1b).

**The dividing line: resolving a binding throws ([`BOUNDARIES.md`](../warden/canon/libs/BOUNDARIES.md)
§5a); operating on a resolved store returns
`Result` (§5a).** See [`STORAGE_BINDINGS.md`](./STORAGE_BINDINGS.md) §4a.

**The free `serveObject(backend, …)` (`storage/r2`) is the one ratified exception to "operating
returns `Result`."** It sits on the HTTP boundary and returns a `Response` — `200` / `206` (range)
/ `304` (conditional) / `404` (missing) / `416` (unsatisfiable range). Callers hand its return
value straight back from the handler.

**The bound `store.serveObject` is not the exception, and returns `Result<Response>`** — a rejected
key and a backend fault are failures, not rendered ones, and the store's other five operations
already say so ([`STORAGE_BINDINGS.md`](./STORAGE_BINDINGS.md) §3b).

### 5f. Configuration Knobs — Asserted Where They Are Accepted

A configuration knob is asserted by **the function that accepts it, synchronously, before that
function returns** — so a misconfiguration throws in the same stack frame as the mistake, and a
function typed `Promise<Result<…>>` never carries a second failure channel beside its per-request
one (§5a). A misconfiguration is a deployment defect, and belongs with the invariants of §5e.

**The three message shapes, which are §5e's normalised shape for this surface:**

    ${operation}: ${knob} is ${value}, below the ${min}-${unit} floor — ${why}.
    ${operation}: ${knob} is ${value}, above the ${max}-${unit} ceiling — ${why}.
    ${operation}: ${knob} is ${value}, which is not a whole number.

`unit` is omitted where the number has none, giving `below the 1 floor`. `why` states the reason
the bound exists, not the bound again — `the shortest expiration the nonce store accepts, below
which a code outlives its own replay guard`, never `the minimum is 60000`.

**`operation` is the function the consumer called** — `createEmailOtpFactor`, not `auth/passkey`.
Helpers wrapping `authLimit` take the label as a parameter and never supply their own
(`passkeyTtlSeconds(operation, requested)`), because the wrapper's name is not one a consumer has
ever typed.
