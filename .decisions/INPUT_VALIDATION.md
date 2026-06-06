---
title: Input Validation
description: "valibot facade, v namespace, v.safeParse, abortEarly, ValidationResult, defineAction parse/validate/handle, form namespace, readFields, parseFormData byte cap 413, honeypot, Turnstile CAPTCHA expectedHostname, CSRF protection, importCsrfKey, csrfProtection, mintCsrf, csrfTokenCtx, CsrfConfigSchema, TurnstileConfigSchema, validate at boundary"
weight: 25
---

# Input Validation

> Authoritative source for forge's validation and form parsing patterns: the valibot
> facade, the `defineAction` parse → validate → handle pipeline, form field reading,
> CSRF protection, honeypot, and Turnstile.
>
> Complements [ERROR_HANDLING.md](./ERROR_HANDLING.md) (renderValidationErrors),
> [SECURITY_HARDENING.md](./SECURITY_HARDENING.md) (CSRF is in form, not security).
>
> Forge runs on `@remix-run/fetch-router`. The request context is `AppContext<Bindings>`
> (`c.request`, `c.env`, `c.url`); read the request via `c.request` and parse bodies via
> `parseFormData(c)`.

---

## 0. Quick Reference

- §1 validation namespace: v facade, ValidationResult, v.safeParse pattern, defineAction pipeline
- §2 form namespace: readFields, parseFormData (byte cap + 413), readTextField
- §3 CSRF protection: csrfProtection middleware, importCsrfKey, mintCsrf, createCsrfToken
- §4 Bot protection: isHoneypotFilled, verifyTurnstile
- §5 Config schemas: CsrfConfigSchema, TurnstileConfigSchema
- §6 Validate-at-boundary rule

---

## 1. Validation Namespace (valibot facade)

### 1a. v Namespace — Complete valibot Re-Export

`v` is the complete valibot namespace, re-exported as a single import. Never import
valibot directly — always use `v` from `@y-core/forge/validation`.

    import { v } from "@y-core/forge/validation"

    const ContactSchema = v.object({
      name: v.pipe(v.string(), v.minLength(2)),
      email: v.pipe(v.string(), v.email()),
      message: v.pipe(v.string(), v.minLength(10)),
    })

    type ContactInput = v.InferOutput<typeof ContactSchema>

All valibot primitives, pipes, and combinators are available under the `v` prefix.
Using `v` ensures the forge version of valibot is always used and avoids version
conflicts between direct valibot imports and the forge re-export.

### 1b. v.safeParse with abortEarly

`abortEarly: true` stops validation at the first error. Use for form validation to
return field-specific errors quickly rather than collecting all issues.

    const result = v.safeParse(ContactSchema, fields, { abortEarly: true })
    if (!result.success) {
      // renderValidationErrors takes a string[]; map valibot issues to messages
      return fragmentResponse(renderValidationErrors(result.issues.map((i) => i.message)))
    }
    const contact = result.output // typed as ContactInput

When `abortEarly` is omitted (default `false`), all fields are validated and all
issues are collected — useful for API responses that must enumerate every error.

### 1c. ValidationResult Type — ok/errors Discriminated Union

    import type { ValidationResult } from "@y-core/forge/validation"
    // also re-exported from "@y-core/forge/result"
    // { ok: true; data: T } | { ok: false; errors: string[] }

`ValidationResult<T>` is the standard return type for the `validate` step and for service
functions that perform their own validation. On success it carries the parsed `data`; on
failure it carries an array of human-readable `errors` strings. Inspect `result.ok` before
proceeding. `renderValidationErrors(errors)` accepts that `string[]` directly — see
[ERROR_HANDLING.md](./ERROR_HANDLING.md).

### 1d. defineAction — parse → validate → handle Pipeline

`defineAction` (from `@y-core/forge/app`) wires a POST handler that parses the body,
validates it, and delegates to `handle`, returning structured fragment responses for each
failure mode. It returns a `RequestHandler` you map to a route action in the controller.

    import { defineAction } from "@y-core/forge/app"
    import { readFields } from "@y-core/forge/form"
    import { v } from "@y-core/forge/validation"
    import type { ValidationResult } from "@y-core/forge/validation"

    export const handleContactAction = defineAction<ContactInput, AppEnv, AppConfig>({
      parse: (formData) => readFields(formData, ["name", "email", "message"]),
      validate: (data): ValidationResult<ContactInput> => {
        const result = v.safeParse(ContactSchema, data, { abortEarly: true })
        return result.success
          ? { ok: true, data: result.output }
          : { ok: false, errors: result.issues.map((i) => i.message) }
      },
      handle: async (data, c, config) => {
        await contactService.send(data, config)
        return fragmentResponse(renderSuccess("Thanks — we'll be in touch."))
      },
    })

`defineAction` calls `parseFormData(c)` internally (so it enforces the body size cap and
surfaces `413` on oversized bodies — see §2c), runs `parse`, then `validate`. A failing
`validate` emits `renderValidationErrors(errors)` unless `onValidationError` is supplied;
a thrown `handle` is logged via `createLogger("action")` and returns a 500 fragment unless
`onError` is supplied. Middleware (CSRF, origin guards) is attached on the controller
action object `{ middleware, handler }`, not inside `defineAction`.

---

## 2. Form Namespace — Field Reading and Parsing

### 2a. readFields — Type-Safe FormData Extraction

`readFields` extracts named fields from a `ReadonlyFormData` object with type-safe keys
inferred from the field-name literals. Each value is read via `readTextField`, so values
are normalized (`\r\n` → `\n`) and trimmed; missing fields return an empty string.

    import { parseFormData, readFields } from "@y-core/forge/form"

    const formData = await parseFormData(c)
    const fields = readFields(formData, ["name", "email", "message"])
    // fields: Record<"name" | "email" | "message", string>

Pass the field names as literals (optionally `as const`) so the key type narrows to the
union of names rather than `string`, preserving the key-safety guarantee on the returned
record.

### 2b. readTextField — Single Field Extraction

For extracting a single field without the full `readFields` list:

    import { readTextField } from "@y-core/forge/form"

    const name = readTextField(formData, "name") // string (trimmed, "" if absent)

Returns the trimmed, newline-normalized string value, or `""` when the field is absent
or is not a text value. Use `readFields` when all expected fields are known upfront.

### 2c. parseFormData — Body Read with Size Limit

`parseFormData` reads the request body as `ReadonlyFormData` with a byte cap. It takes the
request context (`c`), not a raw `Request`, and memoizes the parse per request so CSRF
verification and the action handler share a single body read without re-consuming the
stream.

    import { parseFormData } from "@y-core/forge/form"

    const formData = await parseFormData(c, { maxBytes: 1024 * 10 })

`FORM_MAX_BYTES_DEFAULT` (100 KB) is the built-in default applied when `maxBytes` is
omitted. The cap is enforced two ways: a `Content-Length` fast-path rejects an
over-declared body immediately, and a streaming byte counter aborts mid-parse once the
running total exceeds the limit — closing the bypass where `Content-Length` is absent or
lies (chunked transfer). Either path rejects with a `413`-carrying error before any field
extraction occurs; `defineAction` translates that into a `413` fragment response.

---

## 3. CSRF Protection — Middleware, Keys, Token Minting

### 3a. csrfProtection Middleware — Guard Mutating Routes

`csrfProtection` is a `Middleware` that, on `GET`/`HEAD`, mints a token bound to the
current path (exposed via `csrfTokenCtx`/`csrfMinterCtx`), and on mutations verifies the
submitted token against the HMAC key (or key ring) resolved from the configured secret.
The token is read from the `X-CSRF-Token` header or, failing that, the `_csrf` form field
(`CSRF_FIELD_DEFAULT`; override via `tokenField`/`headerName`). Returns `403` if the token
is absent, malformed, expired, path-mismatched, or has an invalid signature.

    import { csrfProtection, importCsrfKey } from "@y-core/forge/form"
    import type { Middleware } from "@y-core/forge/context"

    export const csrfVerifyGuard: Middleware = csrfProtection({
      secret: (c) => importCsrfKey(configStore.get(c.env).security.csrf.secret),
    })

Attach `csrfVerifyGuard` to all mutating routes that process form submissions via the
controller action's `middleware` array. See
[SECURITY_HARDENING.md](./SECURITY_HARDENING.md) for route-level middleware placement
patterns.

### 3b. importCsrfKey and importCsrfKeyRing — Secret Import

CSRF secrets are hex-encoded strings (minimum 32 hex characters = 16 bytes). Import
them into `CryptoKey` objects before passing to middleware or token functions.

    import { importCsrfKey, importCsrfKeyRing } from "@y-core/forge/form"

    // Single active key
    const key = await importCsrfKey(hexSecret)

    // Key ring for rotation: current key + previous key(s)
    const keyRing = await importCsrfKeyRing([hexSecret1, hexSecret2])

`importCsrfKeyRing` accepts an ordered array; the first entry is the signing key,
subsequent entries are accepted for verification during rotation windows. Rotate by
prepending the new secret and removing the oldest after the rotation window closes.

### 3c. mintCsrf — Token Minting for Form Injection

`mintCsrf` creates a signed CSRF token using the minter installed by `csrfProtection` on
the request context. The `path` argument is **required** and scopes the token to a specific
action URL — verification fails with `path-mismatch` if the token's path does not match the
request pathname, preventing token reuse across endpoints. `mintCsrf` throws when `path` is
missing or empty, or when no minter is on the context (i.e. `csrfProtection` is not mounted
on the route).

    import { mintCsrf } from "@y-core/forge/form"

    const csrfToken = await mintCsrf(c, "/api/contact")
    // Inject into the form view:
    // <input type="hidden" name="_csrf" value={csrfToken} />

When the form POSTs back to the same path it was rendered on, you can instead read the
pre-minted `csrfTokenCtx.get(c)` token (bound to the current request pathname). Mint one
token per form render; do not cache tokens across requests.

### 3d. createCsrfToken and verifyCsrfToken — Lower-Level API

For programmatic CSRF management outside the standard middleware flow. Both functions are
path-scoped: `createCsrfToken(key, path, options?)` embeds the path, and
`verifyCsrfToken(keyOrRing, token, path, maxAgeMsOrOptions?)` checks it (along with the
signature and a freshness window).

    import { createCsrfToken, verifyCsrfToken } from "@y-core/forge/form"

    const token = await createCsrfToken(key, "/api/contact")
    const result = await verifyCsrfToken(key, token, "/api/contact")
    // result: { ok: true } | { ok: false; reason: "expired" | "path-mismatch" | ... }

`verifyCsrfToken` accepts either a single `CryptoKey` or a `CsrfKeyRing` (for rotation) and
returns a `CsrfResult` discriminated union — inspect `result.ok`. Use the lower-level API
only when `csrfProtection` middleware cannot be applied directly (e.g., custom JSON API
routes with non-standard token transport). Prefer the middleware path for all standard form
submissions.

---

## 4. Bot Protection — Honeypot and Turnstile

### 4a. isHoneypotFilled — Hidden Field Bot Detection

Honeypot detection checks whether a hidden field that legitimate users never fill
has been populated by a bot. `HONEYPOT_FIELD_DEFAULT` is `"surname"`; pass a second
argument to `isHoneypotFilled(formData, field)` to override it.

    import { isHoneypotFilled, HONEYPOT_FIELD_DEFAULT } from "@y-core/forge/form"

    if (isHoneypotFilled(formData)) {
      return fragmentResponse(renderError("Invalid submission"), 400)
    }

Add the honeypot field to every form view as a visually hidden input:

    <input type="text" name="surname" tabIndex={-1} autoComplete="off"
           style="position:absolute;left:-9999px" />

Check `isHoneypotFilled` early — before schema validation. Bots that fill hidden fields are
rejected cheaply without consuming further work.

### 4b. verifyTurnstile — Cloudflare Turnstile CAPTCHA

`verifyTurnstile` calls the Turnstile siteverify API and returns a `TurnstileResult`
discriminated union. Its arguments are positional: the form data (it reads the
`cf-turnstile-response` field itself), the secret key, an optional token-field override,
an optional remote IP, and an options object. Pass the connecting IP from the
`CF-Connecting-IP` header when running on Cloudflare Workers, and **always** pass
`options.expectedHostname` in production — without it the token's origin hostname is not
checked, allowing a token minted on an attacker-controlled site to be replayed against this
one (a runtime warning is logged when it is omitted).

    import { verifyTurnstile } from "@y-core/forge/form"

    const result = await verifyTurnstile(
      formData,
      config.services.turnstile.secretKey,
      "cf-turnstile-response",
      c.request.headers.get("CF-Connecting-IP") ?? undefined,
      { expectedHostname: new URL(c.url).hostname },
    )
    if (!result.ok) {
      return fragmentResponse(renderError("CAPTCHA verification failed"), 400)
    }

The options object also accepts `expectedAction`, `expectedCData`, and `timeoutMs`
(default 5000 ms). Add the Turnstile widget to forms that require bot protection beyond the
honeypot. The `siteKey` is used client-side; `secretKey` is server-side only and must never
appear in client bundles. See §5b for the config schema.

---

## 5. Config Schemas — CsrfConfigSchema, TurnstileConfigSchema

### 5a. CsrfConfigSchema — CSRF Secret Validation

    import { CsrfConfigSchema } from "@y-core/forge/form"
    // v.object({ secret: v.pipe(v.string(), v.regex(/^[0-9a-fA-F]{32,}$/, ...)) })
    // Expects a hex-encoded secret string (min 32 hex chars)

Parse environment-sourced CSRF config through `CsrfConfigSchema` at startup via the
config store. Do not pass raw `c.env` strings directly to `importCsrfKey` without
prior schema validation.

### 5b. TurnstileConfigSchema — Turnstile Credentials Validation

    import { TurnstileConfigSchema } from "@y-core/forge/form"
    // v.object({ secretKey: v.string(), siteKey: v.string() })

Both `secretKey` and `siteKey` must be present. `siteKey` is exposed to the browser
via the Turnstile widget; `secretKey` is used only by `verifyTurnstile` server-side.
Validate through the config store at startup so missing credentials fail fast on
deploy rather than at first form submission.

---

## 6. Validate-at-Boundary Rule

### 6a. The Boundary Rule — Untrusted Input Never Crosses into Services Raw

All untrusted input is validated at the system boundary — the handler — before it
enters services, domain logic, or storage. Raw `FormData` and unvalidated strings
must not be passed into service functions. Services receive typed domain objects.

    // Handler (boundary)
    const formData = await parseFormData(c)
    const fields = readFields(formData, ["name", "email"])
    const result = v.safeParse(ContactSchema, fields, { abortEarly: true })
    if (!result.success) {
      return fragmentResponse(renderValidationErrors(result.issues.map((i) => i.message)))
    }

    // Service receives typed domain object, not raw strings
    await contactService.send(result.output)

### 6b. Validation Flow — Ordered Steps

The canonical validation sequence for a mutating form handler:

1. `parseFormData` — read body with size limit
2. `isHoneypotFilled` — reject bots cheaply
3. `csrfProtection` middleware (already applied at route level) — rejects before handler
4. `verifyTurnstile` — CAPTCHA check when configured
5. `readFields` — extract expected field names
6. `v.safeParse` with schema — produce typed output or issues
7. Pass typed output to service

Steps 1-4 reject invalid requests before schema validation runs. Steps 5-7 produce
the typed domain object that services consume.

### 6c. HTML Entity Encoding in Test Assertions

When testing validation error output rendered as HTML, entities must be encoded
correctly in assertions. Forge's JSX renderer (`renderToString`) and `escapeHtml`
encode these characters automatically:

| Character | Encoded form |
|-----------|--------------|
| `'`       | `&#39;`      |
| `&`       | `&amp;`      |
| `<`       | `&lt;`       |
| `>`       | `&gt;`       |

Always use exact-match assertions (`toBe`/`toEqual`) over partial matching
(`toContain`) when the output is deterministic. Substring matching hides encoding
bugs and produces false positives when error text changes.

    // Correct: exact match with encoded entity
    expect(html).toBe('<span class="error">Name can&#39;t be empty</span>')

    // Wrong: toContain masks encoding differences
    expect(html).toContain("Name can't be empty")
