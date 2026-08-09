---
title: Input Validation
description: "The valibot facade, form parsing and its byte cap, CSRF protection, honeypot and Turnstile bot defence, and the validate-at-boundary rule."
---

# Input Validation

> Owns the validation and form-parsing pipeline: the valibot facade, `defineAction`'s schema
> contract, body parsing and its byte cap, CSRF, honeypot, and Turnstile.
>
> Defers to: [`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §1c for `ValidationResult` and §2c for
> rendering its message list; [`SECURITY_HARDENING.md`](./SECURITY_HARDENING.md) for the
> transport-layer guards that sit in front of these; [`TESTING.md`](./TESTING.md) §3a for the
> HTML-entity assertion rule.
>
> The request context is `AppContext<Bindings>` (`c.request`, `c.env`, `c.url`); parse bodies
> with `parseFormData(c)`.

---

## 0. Quick Reference

- §1 Validation Namespace: the valibot facade and the action pipeline
- §1a v Namespace — Complete valibot Re-Export: the facade rule, and what the namespace exports beside `v`
- §1b v.safeParse with abortEarly: the form-validation default, and which formatter a caller may read
- §1c ValidationResult Type: the domain alias, owned elsewhere
- §1d defineAction — The Schema Contract: the only way to reach a handler, what its guards consume, and the failure modes
- §2 Form Namespace — Body Parsing: FormData in, with a byte cap
- §2c parseFormData — Body Read with Size Limit: the two-way byte cap and 413
- §3 CSRF Protection: middleware, keys, token minting
- §3a csrfProtection Middleware: guarding mutating routes and the required `subject`
- §3b importCsrfKey and importCsrfKeyRing: secret import and rotation
- §3c mintCsrf — Token Minting for Form Injection: path scoping
- §3d createCsrfToken and verifyCsrfToken: the lower-level API
- §4 Bot Protection: honeypot and Turnstile
- §4a isHoneypotFilled — Hidden Field Bot Detection: the decoy's name, its home in the pipeline, and where it is rendered
- §4b verifyTurnstile — Cloudflare Turnstile CAPTCHA: options, `expectedHostname`, and failing closed
- §5 Config Schemas: startup validation of credentials
- §5a CsrfConfigSchema: hex secret validation
- §5b TurnstileConfigSchema: site and secret key validation
- §6 Validate-at-Boundary Rule: untrusted input never reaches a service raw
- §6a The Boundary Rule: services receive typed domain objects
- §6b Validation Flow — Ordered Steps: the canonical sequence

---

## 1. Validation Namespace (valibot facade)

### 1a. `v` Namespace — Complete valibot Re-Export

`v` is the complete valibot namespace, re-exported as one import.

**Never import `valibot` directly — always use `v` from `@y-core/forge/validation`.** The
facade is what keeps the valibot version single-sourced and lets forge bound its surface.

**`v` is complete, but it is not alone.** The namespace also ships forge's own schema and issue
helpers, and they are named exports sitting *beside* `v`, never members of it: `strictObject`
(§1d), `formText` and `formMultilineText` (§1d), and `describeValidationIssue` (§1b).
`src/validation/mod.ts` is authoritative for the list. The import shape is what matters here,
because `strictObject` and `v.strictObject` are two different functions and only one of them is
the recommendation (§1d):

```typescript
import { formMultilineText, formText, strictObject, v } from "@y-core/forge/validation"

const ContactSchema = strictObject({
  name:    v.pipe(formText(), v.minLength(2)),
  email:   v.pipe(formText(), v.email()),
  message: v.pipe(formMultilineText(), v.minLength(10)),
})

type ContactInput = v.InferOutput<typeof ContactSchema>
```

All valibot primitives, pipes, and combinators are available under the `v` prefix; nothing forge
added is.

### 1b. `v.safeParse` with `abortEarly`

**`abortEarly: true` stops at the first error — use it for form validation.** `defineAction`
passes it unconditionally (§1d), and bounding the issue count is half of why: one issue reaches
the fragment however many fields a caller chose to break, so a submission cannot multiply the
refusal it receives.

**Render issues through `describeValidationIssue` — never `issue.message`.** It names the failing
field and nothing else, bounded in depth and in per-segment length, so the refusal varies only
with *which* field failed and not with what was sent. The three parts it refuses to reproduce are
each a disclosure: `issue.message` embeds the rejected value, `issue.expected` can be the source
text of the schema's own `v.regex`, and `issue.input` is the submission itself.

```typescript
const result = v.safeParse(ContactSchema, fields, { abortEarly: true })
if (!result.success) {
  return fragmentResponse(renderValidationErrors(result.issues.map(describeValidationIssue)), 422)
}
const contact = result.output   // typed as ContactInput
```

**`formatValidationIssues` is not interchangeable with it.** That one reproduces `issue.message`,
which is what makes it the internal diagnostic the env and config validators share (§5a, §5b).
It must never reach a response a caller reads.

**Omit `abortEarly` (default `false`) when the response must enumerate every failing field** — an
API response rather than a progressive form. An enumerating refusal is one a caller can lengthen
by adding fields, so choose it deliberately rather than by omission.

### 1c. `ValidationResult` Type

`ValidationResult<T>` is the standard return type for service functions that validate their own
input. It is a domain alias of the one `Result` primitive —
success carries `data`, failure carries the per-field message list in the single `error` field.

[`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §1c owns the type. It is exported from
`@y-core/forge/result` and re-exported from `@y-core/forge/validation`.

### 1d. `defineAction` — The Schema Contract

`defineAction` (from `@y-core/forge/app`) wires a POST handler that reads the body, runs the
route's body-content guards, validates against a declared schema, and delegates to `handle`,
returning a structured fragment for each failure mode. `ActionDefinition` (`src/app/types.ts`) is
authoritative for the option list, and `src/app/README.md` documents each option with its type.

**The schema is the only way in.** `handle` is unreachable except through a passing `v.safeParse`
of `schema`, and it receives the schema's *output*, so a transform arrives as the type it actually
is. This replaced a `parse`/`validate` pair of arbitrary callbacks: that pair fixed the order the
two ran in and nothing more — neither had to involve a schema, so a `validate` that returned its
own argument compiled and was accepted. **Order is a weaker guarantee than validation, and only
the second one is worth stating.**

**forge reads the body, so no named-field reader is needed or offered.** Every entry the caller
sent reaches the schema, which is what gives `strictObject` something to refuse; an **absent
field stays absent** rather than becoming `""`, which is what keeps `v.optional` reachable and
required-ness a presence check; a **repeated key arrives as an array**, so a scalar schema refuses
it and a route that accepts many declares `v.array`; and a **`File` passes through unchanged**.

**A guard that consumes a field is what removes it.** A form carries entries the request itself
does not assert — a CSRF token, a honeypot decoy, a CAPTCHA token — and a strict schema has no
reason to declare any of them, so each is dropped before validation. **Nothing is dropped on a
guess.** The honeypot and Turnstile fields are dropped because this pipeline checked them (§4a,
§4b); the CSRF field is dropped because `csrfProtection` recorded which field it took the token
from (§3a). A route that renames one of those fields therefore declares the name once, to the
guard that reads it, and never a second time to the schema. What happens on a request where no
guard ran is the derive-only rule, owned by
[`ROUTING_AND_MIDDLEWARE.md`](./ROUTING_AND_MIDDLEWARE.md) §2b.

**Prefer `strictObject` from `validation` over `v.strictObject`** (§1a). The unknown-key
guarantee — an undeclared field is *refused*, not silently stripped — is stated against the
former, and a schema written with the raw valibot form does not carry the correction that makes
that guarantee hold for every key a caller can send. That is an opt-in property rather than a
hidden one: the choice is visible at the call site, and `src/validation/strict-object.ts` states
exactly what it settles.

**Normalizing form text is the schema's job, not the reader's** — `formText()` for a single-line
control, `formMultilineText()` for a `<textarea>` (§1a). The reader hands the schema exactly what
was submitted, and that is a deliberate split rather than an omission, for four reasons. It does
not only see strings, so trimming there would mean one special case for a `File` and another for
the array a repeated key produces. `"   "` has to stay representable, or a schema that wants to
refuse whitespace-only input no longer can — by the time it runs, an all-spaces submission and a
well-formed one are indistinguishable. A normalization the schema cannot see makes the parsed
output differ from the declared input for reasons written down nowhere in the schema, which is the
defect the old named-field reader had. And line-ending folding is right for a `<textarea>` and
wrong for an `<input>`, a distinction the reader cannot make, because it sees a name and a value
and never the control that produced them.

**`formMultilineText()` folds CRLF, and that is what makes a length check mean one thing:** under
`v.pipe(formMultilineText(), v.maxLength(500))` each line break counts once, so the limit means the
same whether the newline arrived as LF or CRLF rather than silently halving the budget. The benefit
belongs to the fold's *presence*, not to where it sits relative to the trim — that position is not
observable from anywhere, including from a check the caller appends, and `src/validation/form-text.ts`
records why so the justification is not invented a third time.

**`defineAction` calls `parseFormData(c)` internally**, so it enforces the body cap and surfaces
`413` on oversized bodies (§2c). A refused body answers **`422`** — a well-formed request the
server understood and declined — carrying one `<li>` that names the failing field and nothing
else (§1b). A schema, an `onValidationError` or a `handle` that *throws* is a route defect rather
than a bad request: it is logged and answered `500` unless `onError` is supplied. Valibot does not
catch what a pipe action throws, so a `v.transform` or `v.check` that throws on malformed input
reaches that same path instead of escaping the handler.

**A tripped bot guard answers with the refusal the schema itself would have produced** — the same
status, one `<li>` naming a field the schema declares, never the decoy, whose name only the guard
knows. Because `abortEarly` holds a real refusal to a single issue too, a bot cannot tell a guard
from a mistyped field by comparing the two answers. `onBotDetected` replaces that default for an
app that would rather ban, log, or stall.

**`onValidationError` receives the issues, not formatted strings.** A valibot issue embeds the
rejected value, and under a strict object the caller's own key lands in its path — so an app that
renders more than the field name is choosing to, and how much of a caller's text travels back is
a decision only the consuming app can make. The default chooses the field name alone (§1b).

**Transport guards attach to the controller action object `{ middleware, handler }`; body-content
guards live inside `defineAction`.** The rule is unchanged, and the line it draws is what the
guard needs in order to decide. A **transport** guard decides from the request's envelope — an
origin, a header, a signed token it minted itself — and needs to know nothing about what this
route's form contains; that is why CSRF, origin, and rate-limit guards sit in the `middleware`
array and refuse before any route builder runs. (`csrfProtection` falls back to reading a field out
of the body, which is a lookup of the one field the guard itself owns and named, not a reading of
the route's own fields.) A **body-content** guard decides from a field that is part of the form's
design — a
decoy the view placed, a CAPTCHA token the widget wrote — so it belongs where the body is read,
and where the field it consumes is dropped in the same step. No middleware moved inside
`defineAction`, and neither guard became middleware.

---

## 2. Form Namespace — Body Parsing

### 2c. `parseFormData` — Body Read with Size Limit

`parseFormData(c, options?)` reads the request body as `ReadonlyFormData` with a byte cap. It
takes the request **context**, not a raw `Request`, and **memoizes the parse per request** so
CSRF verification and the action handler share one body read without re-consuming the stream.

**The cap is enforced two ways, and both matter:**

1. a `Content-Length` fast path that rejects an over-declared body before reading it, and
2. a **streaming byte counter** that aborts mid-parse once the running total exceeds the limit.

The streaming counter is what closes the header-only bypass — a request with an absent or lying
`Content-Length` (chunked transfer) is still capped. **Either path rejects with a `413`-carrying
error before any field extraction occurs**, which `defineAction` translates into a `413`
fragment.

`FORM_MAX_BYTES_DEFAULT` (100 KB) applies when `maxBytes` is omitted.

**The first call for a request meters the stream; every later call re-checks the bytes actually
read against its own `maxBytes`.** A body is readable once, so a stricter caller gets its own
`413` off the shared parse rather than a re-read. The consequence is an ordering rule: a route
that raises `defineAction`'s `maxBytes` must raise `csrfProtection`'s to match, because the guard
parses first and would otherwise reject before the handler runs.

---

## 3. CSRF Protection — Middleware, Keys, Token Minting

### 3a. `csrfProtection` Middleware — Guard Mutating Routes

`csrfProtection(options)` is a `Middleware` that mints a path-bound token on `GET`/`HEAD`
(exposed via `csrfTokenCtx` / `csrfMinterCtx`) and verifies the submitted token on mutations
against the HMAC key or key ring resolved from the configured secret.

The token is read from the `X-CSRF-Token` header, falling back to the `_csrf` form field
(`CSRF_FIELD_DEFAULT`; override with `tokenField` / `headerName`). **It returns `403` when the
token is absent, malformed, expired, path-mismatched, subject-mismatched, or badly signed.**

**An oversized body returns `413`, not `403`** — the guard's form parse is capped by its own
`maxBytes` (§2c), and a size failure reported as a token failure sends the client after a problem
that does not exist.

**`subject` is required — a per-request resolver, or the literal `false`. Omitting it is a
compile error.** This forces a deliberate decision about token binding at every call site
instead of silently defaulting to a path-only token.

```typescript
export const csrfVerifyGuard: Middleware = csrfProtection({
  secret: (c) => importCsrfKey(configStore.get(c.env).security.csrf.secret),
  subject: (c) => sessionCtx.getOptional(c)?.id,   // mint AND verify per session
})
```

**Why `subject` binding matters — the fixation risk it closes.** A token bound to the path alone
is valid for that path regardless of who submits it. An attacker can obtain a valid path-scoped
token — it is minted on the public `GET` — and plant it in a victim's request, a CSRF-token
fixation / cross-user replay against the same path. Binding to the session subject scopes the
token to one identity: a token minted under session A fails under session B with reason
`subject-mismatch` → `403`.

**Register `sessionMiddleware` before the guard** so the session exists when the resolver runs.
`form` and `session` are independent leaf namespaces, so this composition lives in the consuming
app — forge does not auto-wire it. A resolver returning `undefined` mints and verifies a
path-only token for that request.

**Path-only opt-out — `subject: false`.** For routes with no session identity to bind to, pass
the literal `false`. It is the explicit, greppable opt-out that makes "this route accepts
path-only CSRF tokens" auditable — grep `subject: false` to review every deliberately unbound
guard.

**Attach the guard through the controller action's `middleware` array**, not inline in the
handler.

### 3b. `importCsrfKey` and `importCsrfKeyRing` — Secret Import

CSRF secrets are hex-encoded strings, minimum 32 hex characters (16 bytes). **Import them into
`CryptoKey` objects before passing to middleware or token functions.**

`importCsrfKeyRing` accepts an ordered array: the first entry signs, the rest are accepted for
verification during a rotation window. **Rotate by prepending the new secret and removing the
oldest once the window closes.**

### 3c. `mintCsrf` — Token Minting for Form Injection

`mintCsrf(c, path)` creates a signed token using the minter installed by `csrfProtection`.

**`path` is required and scopes the token to one action URL** — verification fails with
`path-mismatch` if it does not match the request pathname, preventing reuse across endpoints.
It **throws** when `path` is missing or empty, or when no minter is on the context (i.e.
`csrfProtection` is not mounted on the route).

When the form POSTs back to the path it was rendered on, read the pre-minted
`csrfTokenCtx.get(c)` instead. **Mint one token per form render; never cache across requests.**

### 3d. `createCsrfToken` and `verifyCsrfToken` — Lower-Level API

Both are path-scoped: `createCsrfToken(key, path, options?)` embeds the path, and
`verifyCsrfToken(keyOrRing, token, path, options?)` checks it along with the signature and a
freshness window. The fourth argument is a `CsrfVerifyOptions` object — `{ maxAgeMs?, subject? }`;
**there is no bare `number` overload.**

`verifyCsrfToken` accepts a single `CryptoKey` or a `CsrfKeyRing` and returns a `CsrfResult` — a
`GuardResult` alias with the reason code in `error`. **Inspect `result.ok`; never echo
`result.error` to a client.**

**Use this API only when `csrfProtection` cannot be applied directly** — a custom JSON API with
non-standard token transport. Prefer the middleware for all standard form submissions.

---

## 4. Bot Protection — Honeypot and Turnstile

### 4a. `isHoneypotFilled` — Hidden Field Bot Detection

Checks whether a hidden field that legitimate users never fill has been populated by a bot.
`HONEYPOT_FIELD_DEFAULT` is the fallback field name (`src/form/constants.ts`); pass a second
argument to override it.

**A `defineAction` route does not call it — it names `honeypot`,** and the pipeline runs the check
and drops the field in one step, before the schema (§1d). Bots that fill hidden fields are
therefore rejected cheaply, without the schema running. `isHoneypotFilled` stays public for a
hand-rolled handler outside that pipeline.

**The `honeypot` option has no default and no shorthand, and that is the security property, not an
ergonomic gap.** A decoy works only while its name is unguessable and plausible; forge is open
source, so any name or prefix forge could supply is a name every bot already knows to skip, in
every deployment at once. **Declare the name once as the app's own constant and reference it from
both the view and the action** — `<Honeypot field={CONTACT_DECOY} />` beside
`defineAction({ honeypot: CONTACT_DECOY, … })`. Forgetting the action half is then a missing
argument at the call site rather than a silent loss of protection in production.

**Render the decoy with the `Honeypot` component from `ui/core`, on every form view that submits a
mutation.** `Form` renders none of its own, deliberately: a form that renders one unconditionally
puts the decoy into the query string of every `method="get"` submission — into the address bar,
bookmarks, shared links, history, and the outbound `Referer` — where it also protects nothing,
since only mutation handlers consult a honeypot at all. Explicit composition puts the decoy
exactly where it defends something. The rendered markup carries no attribute naming it as a
honeypot, for the same reason the field name is unpublished.

### 4b. `verifyTurnstile` — Cloudflare Turnstile CAPTCHA

`verifyTurnstile(formData, secretKey, options)` calls the siteverify API and returns a
`TurnstileResult`. It reads the token field itself; **the token field and connecting IP live
inside the options object** — `options.tokenField`, defaulting to `TURNSTILE_FIELD_DEFAULT`
(`src/form/constants.ts`, which owns the name the Cloudflare widget writes), and
`options.remoteIp`.

**A `defineAction` route does not call it — it names `turnstile`,** and the pipeline verifies the
token and drops the token field in one step (§1d). The split inside that option is deliberate:
`tokenField` is fixed when the route is defined, because the field is dropped whether or not
verification ever reaches the network, while the secret and the verification constraints resolve
per request, because a secret lives in a binding and the hostname a token must have been minted on
is usually the request's own.

**Always pass `expectedHostname` in production.** Without it the token's origin hostname is not
checked, so a token minted on an attacker-controlled site can be replayed against this one. A
runtime warning is logged when it is omitted.

**An unverifiable CAPTCHA fails closed.** A siteverify call that timed out or never landed says
nothing about the caller, so the submission is refused anyway — but it is logged, because a run of
those is an outage rather than an attack, and `onBotDetected` receives the reason so an app can
tell the two apart.

The options object also accepts `expectedAction`, `expectedCData`, and `timeoutMs`.
**`secretKey` is server-side only and must never appear in a client bundle**; `siteKey` is the
client-side half.

---

## 5. Config Schemas

### 5a. `CsrfConfigSchema` — CSRF Secret Validation

Expects a hex-encoded secret string of at least 32 hex characters. **Parse environment-sourced
CSRF config through it at startup via the config store — never pass a raw `c.env` string to
`importCsrfKey`.**

### 5b. `TurnstileConfigSchema` — Turnstile Credentials Validation

Both `secretKey` and `siteKey` must be present. **Validate through the config store at startup**
so missing credentials fail on deploy rather than at first form submission.

---

## 6. Validate-at-Boundary Rule

### 6a. The Boundary Rule

**All untrusted input is validated at the boundary — the handler — before it reaches services,
domain logic, or storage.** Raw `FormData` and unvalidated strings must not be passed into a
service function. **Services receive typed domain objects.**

### 6b. Validation Flow — Ordered Steps

The canonical sequence for a mutating form handler:

1. `parseFormData` — read the body with the size limit
2. `isHoneypotFilled` — reject bots cheaply
3. `csrfProtection` middleware — already applied at route level; rejects before the handler
4. `verifyTurnstile` — CAPTCHA check when configured
5. `v.safeParse` — the whole body against the schema, producing typed output or issues
6. pass the typed output to the service

**Steps 1–4 reject invalid requests before schema validation runs**; steps 5–6 produce the typed
domain object services consume. A route built on `defineAction` gets steps 1, 2, 4, 5 and 6 for
free — it names the schema and the field each of its body-content guards consumes, and nothing
else (§1d). **Step 3 stays middleware**, because CSRF is a transport guard and rejects before the
body's contents matter (§1d, §3a).
