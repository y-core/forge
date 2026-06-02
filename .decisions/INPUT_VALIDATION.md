---
title: Input Validation
description: "valibot facade, v namespace, v.safeParse, abortEarly, ValidationResult, form namespace, readFields, parseFormData, honeypot, Turnstile CAPTCHA, CSRF protection, importCsrfKey, csrfProtection, mintCsrf, CsrfConfigSchema, TurnstileConfigSchema, validate at boundary"
weight: 25
---

# Input Validation

> Authoritative source for forge's validation and form parsing patterns: the valibot
> facade, form field reading, CSRF protection, honeypot, and Turnstile.
>
> Complements [ERROR_HANDLING.md](./ERROR_HANDLING.md) (renderValidationErrors),
> [SECURITY_HARDENING.md](./SECURITY_HARDENING.md) (CSRF is in form, not security).

---

## 0. Quick Reference

- §1 validation namespace: v facade, ValidationResult, v.safeParse pattern
- §2 form namespace: readFields, parseFormData, readTextField
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

    const result = v.safeParse(ContactSchema, formData, { abortEarly: true })
    if (!result.success) {
      return renderValidationErrors(c, result.issues)
    }
    const contact = result.output // typed as ContactInput

When `abortEarly` is omitted (default `false`), all fields are validated and all
issues are collected — useful for API responses that must enumerate every error.

### 1c. ValidationResult Type — ok/error Discriminated Union

    import type { ValidationResult } from "@y-core/forge/result"
    // { ok: true; value: T } | { ok: false; issues: { path: string[]; message: string }[] }

`ValidationResult<T>` is the standard return type for service functions that perform
their own validation. Handlers inspect `result.ok` before proceeding. See
[ERROR_HANDLING.md](./ERROR_HANDLING.md) for `renderValidationErrors`.

---

## 2. Form Namespace — Field Reading and Parsing

### 2a. readFields — Type-Safe FormData Extraction

`readFields` extracts named fields from a `FormData` object with type-safe keys
inferred from the `as const` tuple. All values are strings; missing fields return
an empty string.

    import { readFields } from "@y-core/forge/form"

    const formData = await c.req.formData()
    const fields = readFields(formData, ["name", "email", "message"] as const)
    // fields: Record<"name" | "email" | "message", string>

The `as const` assertion is required to preserve the literal tuple type. Without it
`fields` degrades to `Record<string, string>` and the key-safety guarantee is lost.

### 2b. readTextField — Single Field Extraction

For extracting a single optional field without the full `readFields` tuple:

    import { readTextField } from "@y-core/forge/form"

    const name = readTextField(formData, "name") // string | undefined

Returns `undefined` when the field is absent, distinguishing absence from an empty
string value. Use `readFields` when all expected fields are known upfront.

### 2c. parseFormData — Body Read with Size Limit

`parseFormData` reads the raw request body as `FormData` with an optional byte cap.
Use instead of `c.req.formData()` whenever an explicit size limit is required.

    import { parseFormData } from "@y-core/forge/form"

    const formData = await parseFormData(c.req.raw, { maxBytes: 1024 * 10 })

`FORM_MAX_BYTES_DEFAULT` is the built-in default maximum applied when `maxBytes` is
omitted. Exceeding the limit rejects the request before any field extraction occurs.

---

## 3. CSRF Protection — Middleware, Keys, Token Minting

### 3a. csrfProtection Middleware — Guard Mutating Routes

`csrfProtection` is a Hono middleware that validates the `__csrf` token submitted in
form data against the HMAC key derived from the configured secret. Returns `403` if
the token is absent, malformed, or invalid.

    import { csrfProtection, importCsrfKey } from "@y-core/forge/form"

    export const csrfVerifyGuard = csrfProtection({
      secret: async (c) => importCsrfKey(configStore.get(c.env).security.csrf.secret),
    })

Apply `csrfVerifyGuard` to all `POST`/`PUT`/`DELETE` routes that process form
submissions. See [SECURITY_HARDENING.md](./SECURITY_HARDENING.md) for route-level
middleware placement patterns.

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

`mintCsrf` creates a signed CSRF token bound to the request context. The optional
`path` parameter scopes the token to a specific action URL, preventing token reuse
across endpoints.

    import { mintCsrf } from "@y-core/forge/form"

    const csrfToken = await mintCsrf(c, "/api/contact")
    // Inject into the form view:
    // <input type="hidden" name="__csrf" value={csrfToken} />

Mint one token per form render. Do not cache tokens across requests — each render
produces a fresh token tied to that response's context.

### 3d. createCsrfToken and verifyCsrfToken — Lower-Level API

For programmatic CSRF management outside the standard middleware flow:

    import { createCsrfToken, verifyCsrfToken } from "@y-core/forge/form"

    const token = await createCsrfToken(key)
    const valid = await verifyCsrfToken(token, key)

Use the lower-level API only when `csrfProtection` middleware cannot be applied
directly (e.g., custom JSON API routes with non-standard token transport). Prefer
the middleware path for all standard form submissions.

---

## 4. Bot Protection — Honeypot and Turnstile

### 4a. isHoneypotFilled — Hidden Field Bot Detection

Honeypot detection checks whether a hidden field that legitimate users never fill
has been populated by a bot. `HONEYPOT_FIELD_DEFAULT` is `"__hp"`.

    import { isHoneypotFilled, HONEYPOT_FIELD_DEFAULT } from "@y-core/forge/form"

    if (isHoneypotFilled(formData)) {
      return renderError(c, "Invalid submission", { status: 400 })
    }

Add the honeypot field to every form view as a visually hidden input:

    <input type="text" name="__hp" tabIndex={-1} autoComplete="off"
           style="position:absolute;left:-9999px" />

Check `isHoneypotFilled` before CSRF verification and schema validation. Bots that
fill hidden fields are rejected cheaply without consuming CSRF key operations.

### 4b. verifyTurnstile — Cloudflare Turnstile CAPTCHA

`verifyTurnstile` calls the Turnstile siteverify API and returns a `ValidationResult`.
Always pass the connecting IP from the `CF-Connecting-IP` header when running on
Cloudflare Workers.

    import { verifyTurnstile } from "@y-core/forge/form"

    const result = await verifyTurnstile({
      token: formData.get("cf-turnstile-response") as string,
      secretKey: config.services.turnstile.secretKey,
      ip: c.req.header("CF-Connecting-IP"),
    })
    if (!result.ok) {
      return renderError(c, "CAPTCHA verification failed", { status: 400 })
    }

Add the Turnstile widget to forms that require bot protection beyond the honeypot.
The `siteKey` is used client-side; `secretKey` is server-side only and must never
appear in client bundles. See §5b for the config schema.

---

## 5. Config Schemas — CsrfConfigSchema, TurnstileConfigSchema

### 5a. CsrfConfigSchema — CSRF Secret Validation

    import { CsrfConfigSchema } from "@y-core/forge/form"
    // v.object({ secret: v.string() })
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
    const fields = readFields(formData, ["name", "email"] as const)
    const result = v.safeParse(ContactSchema, fields, { abortEarly: true })
    if (!result.success) return renderValidationErrors(c, result.issues)

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
correctly in assertions. Hono JSX encodes these characters automatically:

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
