---
title: Input Validation
description: "The valibot facade, form parsing and its byte cap, CSRF protection, Turnstile bot defence, and the validate-at-boundary rule."
audience: consumer
---

# Input Validation

> Owns the validation and form-parsing pipeline: the valibot facade, `defineAction`'s schema contract, body parsing and its byte cap, CSRF, and
> Turnstile.
>
> Defers to: [`FORGE_ERRORS.md`][eh-1c] §1c for `ValidationResult` and §2c for rendering its message list; [`SECURITY_HARDENING.md`][sh] for the
> transport-layer guards that sit in front of these; [`TEST_RUNNERS.md`][testing-3a] §3a for the HTML-entity assertion rule.

---

## 0. Quick Reference

- §1 Validation Namespace: the valibot facade and the action pipeline
- §1a v Namespace — Complete valibot Re-Export: the facade rule, and what the namespace exports beside `v`
- §1b v.safeParse with abortEarly: the form-validation default, which formatter a caller may read, and `safeCheck` — the one env message an author
  may vouch for
- §1d defineAction — The Schema Contract: the only way to reach a handler, what its guards consume, and the failure modes
- §2 Form Namespace — Body Parsing: FormData in, with a byte cap
- §2c parseFormData — Body Read with Size Limit: the two-way byte cap and 413
- §3 CSRF Protection: the app's policy, keys, token minting
- §3a The CSRF Policy — Guard Mutating Routes: the chain's one policy, what it refuses and with which status, the token's lifetime, and the
  required `subject`
- §3b The CSRF Key Ring: import, rotation and the `csrf` subkey
- §3c mintCsrf — Token Minting for Form Injection: path scoping
- §3d createCsrfToken and verifyCsrfToken: the lower-level API
- §4 Bot Protection: Turnstile
- §4a verifyTurnstile — Cloudflare Turnstile CAPTCHA: options, `expectedHostname`, and failing closed
- §4b Guard Refusal Shape and Its Residual Oracle: why a guard answers as a validation failure, and the residual that leaves
- §5 Config Schemas: startup validation of credentials
- §5a CsrfConfigSchema: hex key-ring validation
- §5b TurnstileConfigSchema: site and secret key validation
- §6 Validate-at-Boundary Rule: pointer to the governance rule that owns it

---

## 1. Validation Namespace (valibot facade)

### 1a. `v` Namespace — Complete valibot Re-Export

The facade is what keeps the valibot version single-sourced and lets forge bound its surface ([`FORGE_REVIEW.md`][fr-3b] §3b holds the import rule).

**`v` is complete, but it is not alone.** The namespace also ships forge's own schema and issue helpers, and they are named exports sitting _beside_
`v`, never members of it; `src/validation/mod.ts` is authoritative for the list. `src/validation/README.md` shows the import and a worked schema.

**A helper sits beside `v` only while it carries behaviour the pinned valibot does not.** Where valibot covers the behaviour itself, forge ships no
second name for it: the unknown-key guarantee in §1d is `v.strictObject`'s own, and nothing wraps it.

### 1b. `v.safeParse` with `abortEarly`

**`abortEarly: true` stops at the first error — use it for form validation.** `defineAction` passes it unconditionally (§1d), and bounding the issue
count is half of why: one issue reaches the fragment however many fields a caller chose to break, so a submission cannot multiply the refusal it
receives.

<!-- rule:forge-validation-issue-message --> `describeValidationIssue` names the failing field and nothing else, bounded in depth and in
per-segment length, so the refusal varies only with _which_ field failed and not with what was sent. The parts it refuses to reproduce are
each a disclosure: `issue.message` embeds the rejected value, `issue.expected` can be the source text of the schema's own `v.regex`, and
`issue.input` is the submission itself.

**No forge renderer reproduces `issue.message` on any channel, an operator's included**: a log is no safe home for a rejected value
([`BOUNDARIES.md`][boundaries-4a] §4a), and the env validator's throw reaches the logger, the KV log channel and the debug `500` body. Env
validation renders `field: reason` from `issue.type`, a closed vocabulary that carries neither caller text nor schema text.

**`safeCheck` is the one message that survives, and only because its author vouched for it.** Every `v.check` in a schema shares the single issue
type `check`, so the type alone tells an operator nothing: a rule whose sentence was written for a deployer reads as `site.url: check`.
`safeCheck(requirement, message)` registers `message` against the requirement function, and `describeEnvIssue` surfaces a registered one verbatim; a
plain `v.check` still renders as `check`. Only the author can tell whether a message interpolates its input, and forgetting to vouch costs detail,
not disclosure.

<!-- rule:forge-vouched-message-env-key --> The schema validates a value, and which key supplies it is the consuming app's choice, so `SITE_ORIGIN
must use https` sends an operator whose repo supplies it under another key looking for a variable that does not exist. The `<field>:` prefix already
locates it.

**Omit `abortEarly` only where a response must enumerate every failing field**, as an API's may: a caller can lengthen such a refusal by adding
fields.

### 1d. `defineAction` — The Schema Contract

`defineAction` ([`ROUTING_AND_MIDDLEWARE.md`][ram-2e] §2e) reads the body, runs the route's body-content guards, validates against the schema and
delegates to `handle`; `ActionDefinition` (`src/app/types.ts`) holds the options.

**The schema is the only way in.** `handle` is unreachable except through a passing `v.safeParse` of `schema`, and it receives the schema's
_output_, so a transform arrives as the type it actually is. A `parse`/`validate` callback pair is refused because it guarantees only the order the
two run in, and a `validate` returning its argument would pass.

**forge reads the body, so no named-field reader is needed or offered.** Every entry the caller sent reaches the schema, which is what gives
`v.strictObject` something to refuse; an **absent field stays absent** rather than becoming `""`, which is what keeps `v.optional` reachable and
required-ness a presence check; a **repeated key arrives as an array**, so a scalar schema refuses it and a route that accepts many declares
`v.array`; and a **`File` passes through unchanged**.

**A guard that consumes a field is what removes it.** A form carries entries the request itself does not assert — a CSRF token, a CAPTCHA token —
and a strict schema has no reason to declare either of them, so each is dropped before validation. **Nothing is dropped on a guess.** The Turnstile
field is dropped because this pipeline checked it (§4a); the CSRF field is dropped because the CSRF policy recorded which field it took the token
from (§3a). That derive-only rule, and a renamed field's one declaration, are [`ROUTING_AND_MIDDLEWARE.md`][ram-2b] §2b's.

**Declare a body schema with `v.strictObject`, not `v.object`.** An undeclared field is then _refused_ rather than silently stripped, and the
guarantee holds for every key a caller can send — a key colliding with an `Object.prototype` name (`__proto__`, `constructor`, `toString`) among
them, nested inside a `v.object` and behind a `v.union` alike. `src/validation/validation.test.ts` is where that guarantee is pinned.

**Normalizing form text is the schema's job, not the reader's** — `formText()` for a single-line control, `formMultilineText()` for a `<textarea>`
(§1a). The reader hands the schema exactly what was submitted: `" "` must stay representable for a schema that refuses whitespace-only input, a
normalization the schema cannot see is written down nowhere, and the reader never sees which control produced a value, so it cannot tell a
`<textarea>` from an `<input>`.

**`formMultilineText()` folds CRLF, and that is what makes a length check mean one thing:** under `v.pipe(formMultilineText(), v.maxLength(500))`
each line break counts once, so the limit means the same whether the newline arrived as LF or CRLF rather than silently halving the budget.
**`formDigits()` removes every non-digit, for the same reason and with a sharper edge:** under `v.pipe(formDigits(), v.length(16))` a card number
means one string however the user grouped it, so the length counts digits rather than the separators a rendering happened to carry. It only
_removes_ — it never throws, never coerces, and never refuses, because a throwing pipe action is a route defect answered `500` rather than the `422`
a bad value has earned, so refusing stays the job of a `v.length` or `v.minLength` composed after it. Only ASCII digits survive, so a length check
never passes on characters a payment processor refuses. Unlike its siblings it discards significant characters, a leading `+` among them, so it is
the wrong shape for a field that must preserve one.

**`defineAction` calls `parseFormData(c)` internally**, so it enforces the body cap and surfaces `413` on oversized bodies (§2c). A refused body
answers **`422`** — a well-formed request the server understood and declined — carrying one `<li>` that names the failing field and nothing else
(§1b). A schema, an `onValidationError` or a `handle` that _throws_ is a route defect rather than a bad request: it is logged and answered `500`
unless `onError` is supplied. Valibot does not catch what a pipe action throws, so a `v.transform` or `v.check` that throws on malformed input
reaches that same path instead of escaping the handler.

**A page's query string meets the same contract under its own status.** `definePage`'s `query` schema reads `c.url.searchParams` through
`formToObject`, so the entry rules above hold for it unchanged, and parses with `abortEarly` before the action and the loader on every method. The
loader receives the output; a refused query answers **`400`** with the same one-`<li>` refusal, or what `onQueryError` renders from the issues
([`ROUTING_AND_MIDDLEWARE.md`][ram-2d] §2d). Declare it with `v.strictObject` for the same reason as a body.

**A tripped bot guard answers with the refusal the schema itself would have produced** — the same status, one `<li>` naming a field the schema
declares, never the token field the guard consumed (§4b). `onBotDetected` replaces that default for an app that would rather ban, log, or stall.

**`onValidationError` receives the issues, not formatted strings.** A valibot issue embeds the rejected value, and under a strict object the
caller's own key lands in its path — so an app that renders more than the field name is choosing to, and how much of a caller's text travels back is
a decision only the consuming app can make. The default chooses the field name alone (§1b).

**Transport guards attach to the controller action object `{ middleware, handler }`; body-content guards live inside `defineAction`.** The line it
draws is what the guard needs in order to decide. A **transport** guard decides from the request's envelope — an origin, a header, a signed token it
minted itself — and needs to know nothing about what this route's form contains; that is why origin and rate-limit guards sit in the `middleware`
array, CSRF sits in the chain's policy (§3a), and each refuses before any route builder runs (one exception follows). A
**body-content** guard decides from a field that is part of the form's design — a CAPTCHA token the widget wrote — so it belongs where the body is
read, and where the field it consumes is dropped in the same step. Neither kind crosses: no middleware runs inside `defineAction`, and no
body-content guard is expressible as middleware. A rate limit keyed by identity or a route param is the one transport guard inside: `defineAction`'s
`rateLimit` stage, run ahead of the body-content guards ([`SECURITY_HARDENING.md`][sh-4e] §4e).

---

## 2. Form Namespace — Body Parsing

### 2c. `parseFormData` — Body Read with Size Limit

`parseFormData` takes the request context and **memoizes the parse per request**, so CSRF verification and the action handler share one body read.

**The cap is enforced two ways, and both matter:**

1. a `Content-Length` fast path that rejects an over-declared body before reading it, and
2. a **streaming byte counter** that aborts mid-parse once the running total exceeds the limit.

The streaming counter is what closes the header-only bypass — a request with an absent or lying `Content-Length` (chunked transfer) is still capped.
**Either path rejects with a `413`-carrying error before any field extraction occurs**, which `defineAction` translates into a `413` fragment.

`FORM_MAX_BYTES_DEFAULT` applies when `maxBytes` is omitted; `src/form/config.ts` owns its value.

**The first call for a request meters the stream; every later call re-checks the bytes actually read against its own `maxBytes`.** A body is
readable once, so a stricter caller gets its own `413` off the shared parse rather than a re-read. **A route that raises `defineAction`'s `maxBytes`
must raise the CSRF policy's to match**, since the policy parses first; that cap is app-wide (§3a).

Forgetting that rule reports itself. When the cached parse **rejected** at a smaller cap and a later caller asks for a larger one, the stream is
already gone and no cap can serve it — so `parseFormData` throws a distinct wiring error naming both caps and the remedy, rather than replaying the
`413` as though the uploader had sent too much. `isFormCapConflict(error)` identifies it, and the CSRF policy, the submission pipeline and
`readAuthSubmission` each rethrow it instead of collapsing it into a `403`, a `400` fragment or a field refusal; it reaches the error boundary as a
`500`. A cached parse that **succeeded** is unaffected: a body inside the smaller cap is still served to every later caller, at any cap.

---

## 3. CSRF Protection — the Policy, Keys, Token Minting

### 3a. The CSRF Policy — Guard Mutating Routes

**An app's CSRF protection is its one policy, the chain's `csrf`**, and [`ROUTING_AND_MIDDLEWARE.md`][ram-3f] §3f owns why there is one and no
inline verifier. The policy takes `CsrfPolicyOptions`, plus `paths`, `exclude` and `unboundPaths`. Its mint stage publishes a minter
(`csrfMinterCtx`, reached through `mintCsrf`) on every request the policy covers, mints a path-bound token only when asked, and on a mutation
arms a check of the submitted token against the key ring resolved from the configured secret. Where that check runs, on which requests,
and through which hook it refuses are the guard policy table's ([`ROUTING_AND_MIDDLEWARE.md`][ram-3e] §3e), in the order
[`BOUNDARIES.md`][boundaries-apps-2c] §2c sets.

The token is read from the `X-CSRF-Token` header, falling back to the `_csrf` form field (`CSRF_FIELD_DEFAULT`; override with `tokenField` /
`headerName`). **The policy answers `403` when the token is absent, malformed, expired, path-mismatched, subject-mismatched, or badly signed.**

**An oversized body returns `413`, not `403`** — the policy's form parse is capped by its own `maxBytes` (§2c), and a size failure reported as a
token failure sends the client after a problem that does not exist.

**A body the policy cannot parse returns `400` with reason `unreadable-body`, not a `403` for a missing token**, for the same reason: the token
may well be there, and RFC 9110 section 15.5.1 makes `400` the honest status for a request the server cannot read. The cap conflict of §2c is still
rethrown rather than answered.

**A token lives as long as the policy's `maxAgeMs`, which defaults to 24 hours.** A visitor who spends longer on a form than the token lives gets a
`403` with no warning, and WCAG 2.2.1 Timing Adjustable exempts only limits over 20 hours. The default also equals the auth session's idle bound, so
a form left open in a session that is still alive is not refused for its age alone. The token stays bound to its path and, through `subject`, to the
session, which is where its protection comes from, so the longer life adds little risk. An app that lowers `maxAgeMs` below 20 hours owes the
visitor a warning before expiry and a way to extend it.

**`subject` is required — the literal `"session"`, the literal `false`, or a per-request resolver. Omitting it is a compile error.** This forces
a deliberate decision about token binding instead of silently defaulting to a path-only token. **`"session"` binds every token to the chain
session's id** and is the idiom for an app with a session; a chain given it with no session slot throws at registration
([`ROUTING_AND_MIDDLEWARE.md`][ram-3h] §3h). A resolver remains for a subject that is not the session id.

**Why `subject` binding matters — the fixation risk it closes.** A token bound to the path alone is valid for that path regardless of who submits
it. An attacker can obtain a valid path-scoped token — it is minted on the public `GET` — and plant it in a victim's request, a CSRF-token fixation
/ cross-user replay against the same path. Binding to the session subject scopes the token to one identity: a token minted under session A fails
under session B with reason `subject-mismatch` → `403`.

**The session goes on the context before the mint stage.** The chain registers `session` ahead of the policy, so under `applyMiddlewareChain`
this holds by construction. An app that wires `app.use` by hand mounts `csrfMintStage` after its session middleware. Neither `form` nor `session`
imports the other: the chain, in `app`, resolves `"session"` to the session id and hands `form` the resolved subject, so the composition lives in
`app` and in an app wired by hand, never in `form`.

**A resolver returning `undefined` is a refusal.** The mutation answers `403` and the policy logs one `[csrf]` warning naming the likely cause
(session middleware absent, or registered after the mint stage). It does not degrade to a path-only token: silently dropping the binding is
exactly the fixation risk above, and a wiring error must not buy an attacker the opt-out.

**`subject: false` is the only policy-wide path-only opt-out**, for an app with no session identity to bind to. Being a literal makes every
deliberately unbound policy greppable and so auditable.

**`unboundPaths` leaves the tokens of the paths it names path-only, beside a bound subject.** It is decided by the token's target path: the
path a token is minted for, and the path a mutation is verified on. So a sign-out token minted on an unbound page is still bound, and an unbound
contact form posts with no session to read. A path there is verified without a subject, so the `unbound-subject` refusal never applies to it.
The patterns take `app.use`'s syntax and compile when the chain is built, so a malformed one throws at registration. A path that must take a
mutation with no token at all stays on `exclude` ([`ROUTING_AND_MIDDLEWARE.md`][ram-3e] §3e).

### 3b. The CSRF Key Ring — Import and Rotation

CSRF tokens are signed under a `KeyRing` from `@y-core/forge/crypto/keyring`. Its secrets are hex-encoded strings held to
[`SECURITY_HARDENING.md`][sh-8] §8's strength rule, comma-joined newest first in one variable. **Build the ring with
`importKeyRing(parseKeyRingSecrets(value))` and hand it to the middleware or token functions; never the auth key ring, which both refuse.**

The first secret signs and every one verifies, and the token carries the signing key's id. **Rotate by prepending the new secret and removing the
oldest once the token lifetime has elapsed.**

**Every token is signed under the ring's `csrf` subkey, never a root secret.** A ring shared with R2 signed URLs or at-rest sealing therefore
shares no key with them.

### 3c. `mintCsrf` — Token Minting for Form Injection

**`mintCsrf(c, path)` scopes a token to one action URL** — `c.url.pathname` when the form posts back to where it was rendered — and throws on a
route the policy installed no minter for (§3a). **Mint one token per form render; never cache one across requests.**

### 3d. `createCsrfToken` and `verifyCsrfToken` — Lower-Level API

**Use this API only when the chain's policy cannot cover the route** — a custom JSON API with non-standard token transport. It is path-scoped like
`mintCsrf`, its freshness default is the policy's (§3a), and its `CsrfResult` reason code is never sent to a client ([`FORGE_ERRORS.md`][eh-1c]
§1c).

---

## 4. Bot Protection — Turnstile

### 4a. `verifyTurnstile` — Cloudflare Turnstile CAPTCHA

`verifyTurnstile` reads the token field itself; `src/form/constants.ts` owns the default name the widget writes.

**A `defineAction` route does not call it — it names `turnstile`,** and the pipeline verifies the token and drops the token field in one step (§1d).
The split inside that option is deliberate: `tokenField` is fixed when the route is defined, because the field is dropped whether or not
verification ever reaches the network, while the secret and the verification constraints resolve per request, because a secret lives in a binding
and the hostname a token must have been minted on is usually the request's own.

**`turnstile: {}` is the whole opt-in, and forge supplies every per-request piece.** The secret is `readTurnstileKey(c, "secretKey")`, read from
`TURNSTILE_SECRET_KEY` alone and failing closed as §5b states; `expectedHostname` is `c.url.hostname`; `remoteIp` is `CF-Connecting-IP` when the
request carries one. `secretKey` and `verify` are overrides, `verify` merged over the defaults, and neither carries a relaxation: **the build is the
only source of one**, so a relaxation is never threaded by hand and never passed by a shared path.

**`auth`'s anonymous forms reach the same verification step through `AuthWebOptions.turnstile`**, which binds each form's action and token field
itself ([`AUTH_MOUNTING.md`][am-8] §8).

**`expectedHostname` is required, and an empty one is a refusal.** It is the anti-replay pin: a token minted on an attacker-controlled site carries
that site's hostname. Called directly with an empty `expectedHostname`, `verifyTurnstile` answers `hostname-mismatch` without calling siteverify.

**Cloudflare's testing secrets are accepted only in a Worker run by `forge cf dev`, and only those literals.** They make siteverify answer a fixed
`hostname` and no `action` or `cdata`, so an app pinning its own hostname would refuse **every** local submission. Under `forge cf dev`,
`verifyTurnstile` skips the hostname, action and cdata comparisons **only when `secretKey` is one of those literals**; a real secret is compared
normally there too. Every other build — `wrangler deploy`, and a plain `wrangler dev` — compares every secret normally. The `success` check and
`expectedHostname`'s fail-closed guard still run.

**There is no env var and no option, so nothing the deployed Worker reads can turn it on.** The testing-secret list lives in
`src/form/turnstile.dev.ts`, which `verifyTurnstile` reaches only through the `#relax/turnstile` import; its default target refuses every testing
secret, so a deployed bundle holds neither the list nor the skip ([`NAMESPACES.md`][namespaces-5i] §5i). It is the containment the extra origins
have ([`SECURITY_HARDENING.md`][sh-3f] §3f): a relaxation computed from an env check in the shared path is ruled out, and the build that deploys
cannot select the module that holds it.

**`expectedAction` is only usable when the widget minted the token with one.** The action rides on the token, so `<Turnstile action='…'>`
([`UI_CLIENT_RUNTIME.md`][ucr-2f] §2f) is the other half of this option — set one without the other and every token is either refused or unscoped,
which lets a token minted on one form verify at another endpoint on the same host.

**`expectedCData` and `tokenField` each have a widget half too.** `<Turnstile cData='…'>` mints the customer data `expectedCData` compares against —
the only way to tie a challenge to an app-side record — and `<Turnstile responseFieldName='…'>` renames the hidden token input `tokenField` reads,
which is what lets two widgets live in one form. Both are named in [`UI_CLIENT_RUNTIME.md`][ucr-2f] §2f.

**An unverifiable CAPTCHA fails closed.** A siteverify call that timed out or never landed says nothing about the caller, so the submission is
refused anyway, and `onBotDetected` receives the reason so an app can tell an outage from an attack.

<!-- rule:forge-turnstile-secret-server-only --> `siteKey` is the client-side half.

### 4b. Guard Refusal Shape and Its Residual Oracle

**A tripped guard answers in the shape of a validation refusal**, naming a field the schema declares and never the token field the guard consumed,
so a bot reading only the response cannot tell a Turnstile rejection from a failed field (§1b bounds the same response to one issue).

**The named field is the schema's _first declared_ field, and that is an accepted residual, not a bug.** A caller who knows its own body would have
validated can still infer that the refusal came from a guard. Closing it means synthesising a plausible per-submission field, which manufactures a
second, richer signal; forge takes the narrower residual. An app that needs the distinction hidden from a knowledgeable caller supplies
`onBotDetected` and renders its own response.

**Every trip is logged at `warn`, naming the guard and, for Turnstile, the reason.** The refusal is deliberately indistinguishable from a validation
failure to the caller, so without the log line it is indistinguishable to the operator too — and a CAPTCHA that cannot pass in a given environment,
such as a local dev server whose widget issues no token, then reads as every submission getting its first field wrong. The response the caller sees
is unchanged; only the server-side record is.

---

## 5. Config Schemas

### 5a. `CsrfConfigSchema` — CSRF Secret Validation

It holds a key ring to the length half of [`SECURITY_HARDENING.md`][sh-8] §8 at parse.

<!-- rule:forge-csrf-config-via-store --> `parseKeyRingSecrets` only splits the value, so a raw string skips that check.

### 5b. `TurnstileConfigSchema` — Turnstile Credentials Validation

The shape an `AuthTurnstileOptions.keys` override returns. **The default reads each key per request through
`requiredGroup`, and only where it is used**, so a missing or blank key throws `Invalid environment: <KEY>: missing` and the guarded page or
submission answers 500 — never an unguarded form.

---

## 6. Validate-at-Boundary Rule

See [`BOUNDARIES.md`][boundaries-3] §3 for the validate-at-boundary rule and the ordered validation steps. This document owns only the concrete
surface each step calls.

[am-8]: ./AUTH_MOUNTING.md#8-turnstile-on-the-anonymous-forms
[boundaries-3]: ../warden/canon/libs/BOUNDARIES.md#3-validate-at-the-boundary
[boundaries-4a]: ../warden/canon/libs/BOUNDARIES.md#4a-the-prohibited-field-classes
[boundaries-apps-2c]: ../warden/canon/apps/BOUNDARIES.md#2c-guard-order-within-a-route
[eh-1c]: ./FORGE_ERRORS.md#1c-guardresult-and-validationresult-domain-aliases
[fr-3b]: ./FORGE_REVIEW.md#3b-tier-2--pattern-sweep-with-triage
[namespaces-5i]: ./NAMESPACES.md#5i-dev-only-relaxations--a-relax-module-never-a-boolean-on-a-production-option
[ram-2b]: ./ROUTING_AND_MIDDLEWARE.md#2b-action-only-routes-with-defineaction
[ram-2d]: ./ROUTING_AND_MIDDLEWARE.md#2d-the-shared-submission-pipeline
[ram-2e]: ./ROUTING_AND_MIDDLEWARE.md#2e-a-page-or-action-names-its-route
[ram-3e]: ./ROUTING_AND_MIDDLEWARE.md#3e-applymiddlewarechain-canonical-chain-builder
[ram-3f]: ./ROUTING_AND_MIDDLEWARE.md#3f-one-csrf-policy-per-app-verified-once
[ram-3h]: ./ROUTING_AND_MIDDLEWARE.md#3h-the-session-is-a-typed-chain-slot
[sh]: ./SECURITY_HARDENING.md
[sh-3f]: ./SECURITY_HARDENING.md#3f-deriving-allowedorigins-in-dev
[sh-4e]: ./SECURITY_HARDENING.md#4e-one-declaration-per-rate-limit
[sh-8]: ./SECURITY_HARDENING.md#8-secret-strength--one-rule-for-every-secret
[testing-3a]: ./TEST_RUNNERS.md#3a-the-encoding-map
[ucr-2f]: ./UI_CLIENT_RUNTIME.md#2f-turnstile--the-token-its-messages-and-the-theme
