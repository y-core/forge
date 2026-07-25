---
title: Input Validation
description: "The valibot facade, form parsing and its byte cap, CSRF protection, honeypot and Turnstile bot defence, and the validate-at-boundary rule."
---

# Input Validation

> Owns the validation and form-parsing pipeline: the valibot facade, `defineAction`'s
> parse → validate → handle steps, field reading, CSRF, honeypot, and Turnstile.
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
- §1a v Namespace — Complete valibot Re-Export: the facade rule
- §1b v.safeParse with abortEarly: form-validation default
- §1c ValidationResult Type: the domain alias, owned elsewhere
- §1d defineAction — parse → validate → handle Pipeline: the wiring and its failure modes
- §2 Form Namespace — Field Reading and Parsing: FormData in, typed records out
- §2a readFields — Type-Safe FormData Extraction: literal keys narrow the record
- §2b readTextField — Single Field Extraction: the one-field form
- §2c parseFormData — Body Read with Size Limit: the two-way byte cap and 413
- §3 CSRF Protection: middleware, keys, token minting
- §3a csrfProtection Middleware: guarding mutating routes and the required `subject`
- §3b importCsrfKey and importCsrfKeyRing: secret import and rotation
- §3c mintCsrf — Token Minting for Form Injection: path scoping
- §3d createCsrfToken and verifyCsrfToken: the lower-level API
- §4 Bot Protection: honeypot and Turnstile
- §4a isHoneypotFilled — Hidden Field Bot Detection: the field name and placement
- §4b verifyTurnstile — Cloudflare Turnstile CAPTCHA: options and `expectedHostname`
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

```typescript
import { v } from "@y-core/forge/validation"

const ContactSchema = v.object({
  name:    v.pipe(v.string(), v.minLength(2)),
  email:   v.pipe(v.string(), v.email()),
  message: v.pipe(v.string(), v.minLength(10)),
})

type ContactInput = v.InferOutput<typeof ContactSchema>
```

All valibot primitives, pipes, and combinators are available under the `v` prefix.

### 1b. `v.safeParse` with `abortEarly`

**`abortEarly: true` stops at the first error — use it for form validation.**

```typescript
const result = v.safeParse(ContactSchema, fields, { abortEarly: true })
if (!result.success) {
  return fragmentResponse(renderValidationErrors(result.issues.map((i) => i.message)))
}
const contact = result.output   // typed as ContactInput
```

**Omit it (default `false`) when the response must enumerate every failing field** — an API
response rather than a progressive form.

### 1c. `ValidationResult` Type

`ValidationResult<T>` is the standard return type for the `validate` step and for service
functions that validate their own input. It is a domain alias of the one `Result` primitive —
success carries `data`, failure carries the per-field message list in the single `error` field.

[`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §1c owns the type. It is exported from
`@y-core/forge/result` and re-exported from `@y-core/forge/validation`.

### 1d. `defineAction` — parse → validate → handle Pipeline

`defineAction` (from `@y-core/forge/app`) wires a POST handler that parses the body, validates
it, and delegates to `handle`, returning a structured fragment for each failure mode.

```typescript
export const handleContact = defineAction<ContactInput, AppEnv, AppConfig>({
  parse: (formData) => readFields(formData, ["name", "email", "message"]),
  validate: (data): ValidationResult<ContactInput> => {
    const result = v.safeParse(ContactSchema, data, { abortEarly: true })
    return result.success
      ? { ok: true, data: result.output }
      : { ok: false, error: result.issues.map((i) => i.message) }
  },
  handle: async (data, c, config) => {
    await contactService.send(data, config)
    return fragmentResponse(renderSuccess("Thanks — we'll be in touch."))
  },
})
```

**`defineAction` calls `parseFormData(c)` internally**, so it enforces the body cap and surfaces
`413` on oversized bodies (§2c). A failing `validate` emits `renderValidationErrors` unless
`onValidationError` is supplied; a throwing `handle` returns a 500 fragment unless `onError` is.

**Middleware (CSRF, origin guards) attaches to the controller action object
`{ middleware, handler }` — never inside `defineAction`.**

---

## 2. Form Namespace — Field Reading and Parsing

### 2a. `readFields` — Type-Safe FormData Extraction

`readFields` extracts named fields from a `ReadonlyFormData` with keys inferred from the
field-name literals. Values are normalized (`\r\n` → `\n`) and trimmed; a missing field yields
an empty string.

```typescript
const fields = readFields(formData, ["name", "email", "message"])
// Record<"name" | "email" | "message", string>
```

**Pass the field names as literals (optionally `as const`)** so the key type narrows to the
union rather than widening to `string`.

### 2b. `readTextField` — Single Field Extraction

Returns the trimmed, newline-normalized value, or `""` when the field is absent or is not a
text value. **Use `readFields` when all expected fields are known upfront.**

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

---

## 3. CSRF Protection — Middleware, Keys, Token Minting

### 3a. `csrfProtection` Middleware — Guard Mutating Routes

`csrfProtection(options)` is a `Middleware` that mints a path-bound token on `GET`/`HEAD`
(exposed via `csrfTokenCtx` / `csrfMinterCtx`) and verifies the submitted token on mutations
against the HMAC key or key ring resolved from the configured secret.

The token is read from the `X-CSRF-Token` header, falling back to the `_csrf` form field
(`CSRF_FIELD_DEFAULT`; override with `tokenField` / `headerName`). **It returns `403` when the
token is absent, malformed, expired, path-mismatched, subject-mismatched, or badly signed.**

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
`HONEYPOT_FIELD_DEFAULT` is `"__surname"`; pass a second argument to override it.

```typescript
if (isHoneypotFilled(formData)) {
  return fragmentResponse(renderError("Invalid submission"), 400)
}
```

**Add the honeypot to every form view as a visually hidden input, using the same field name the
checker reads:**

```html
<input type="text" name="__surname" tabIndex={-1} autoComplete="off"
       style="position:absolute;left:-9999px" />
```

**Check `isHoneypotFilled` before schema validation** — bots that fill hidden fields are
rejected cheaply, without consuming further work.

### 4b. `verifyTurnstile` — Cloudflare Turnstile CAPTCHA

`verifyTurnstile(formData, secretKey, options)` calls the siteverify API and returns a
`TurnstileResult`. It reads the token field itself; **the token field and connecting IP live
inside the options object** — `options.tokenField` (default `"cf-turnstile-response"`) and
`options.remoteIp`.

**Always pass `options.expectedHostname` in production.** Without it the token's origin hostname
is not checked, so a token minted on an attacker-controlled site can be replayed against this
one. A runtime warning is logged when it is omitted.

```typescript
const result = await verifyTurnstile(formData, config.services.turnstile.secretKey, {
  expectedHostname: new URL(c.url).hostname,
  remoteIp: c.request.headers.get("CF-Connecting-IP") ?? undefined,
})
```

The options object also accepts `expectedAction`, `expectedCData`, and `timeoutMs` (default
5000). **`secretKey` is server-side only and must never appear in a client bundle**; `siteKey`
is the client-side half.

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
5. `readFields` — extract the expected field names
6. `v.safeParse` — produce typed output or issues
7. pass the typed output to the service

**Steps 1–4 reject invalid requests before schema validation runs**; steps 5–7 produce the typed
domain object services consume.
