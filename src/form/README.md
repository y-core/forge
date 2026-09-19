---
title: Form Submission Handling
description: "Guarding and reading a form submission: a byte-capped body read, stateless CSRF tokens, and Turnstile verification."
audience: consumer
---

# `@y-core/forge/form`

A form submission arrives as bytes you must cap before reading, a token you must verify before trusting, and a body a schema must see whole. This
namespace does all three, and each is a separate function so a route composes only what it needs.

```ts
import { csrfProtection, importCsrfKey, mintCsrf, parseFormData, formToObject, verifyTurnstile } from "@y-core/forge/form";
```

**Most routes call almost none of it.** `defineAction` (`@y-core/forge/app`) runs the read, the bot guard and the parse itself, so a route names a
schema and the guard's options and writes no plumbing. What is here are the primitives that pipeline is built from, kept public for the handlers
that sit outside it — and `csrfProtection`, which is middleware and is always yours to mount.

---

## Getting started

The CSRF guard is mounted as middleware, and the action declares its schema. Nothing else is wired by hand.

```ts
import { defineAction } from "@y-core/forge/app";
import { getAppContext } from "@y-core/forge/context";
import { csrfProtection, importCsrfKey } from "@y-core/forge/form";
import { fragmentResponse, renderSuccess } from "@y-core/forge/http";
import { formMultilineText, formText, v } from "@y-core/forge/validation";

const csrfGuard = csrfProtection({
  secret: (c) => importCsrfKey(getAppContext(c).env.CSRF_SECRET),
  subject: false, // path-only tokens; bind to a session wherever one exists — see below
});

const ContactSchema = v.strictObject({
  name: v.pipe(formText(), v.minLength(2)),
  email: v.pipe(formText(), v.email()),
  message: v.pipe(formMultilineText(), v.minLength(10)),
});

const contactAction = defineAction<typeof ContactSchema, Bindings, AppConfig>({
  schema: ContactSchema,
  turnstile: {
    secretKey: (_c, config) => config.services.turnstile.secretKey,
    verify: (c) => ({ expectedHostname: c.url.hostname, expectedAction: "contact" }),
  },
  handle: async (data) => {
    await sendEmail(data);
    return fragmentResponse(renderSuccess("Thanks — we'll be in touch."));
  },
});
```

On `GET` the guard pre-mints a token for the current path; render it with `<Form csrfToken={…}>` from `@y-core/forge/ui/core`, which writes both the
hidden `_csrf` input and the `hx-headers` entry htmx submits it on.

```tsx
import { csrfTokenCtx } from "@y-core/forge/form";
import { Form } from "@y-core/forge/ui/core";

function contactPage(c) {
  return <Form csrfToken={csrfTokenCtx.get(c)} hx-post='/contact' />;
}
```

`csrfTokenCtx` carries a token bound to **this request's pathname**, so it is the right token only when the form posts back to the page it was
rendered on. Anything else needs a minted token — see [Minting a token for another path][mint-section] below.

Neither the CSRF field nor the Turnstile field appears in `ContactSchema`: a guard that consumed a field is what removes it before validation
([`INPUT_VALIDATION.md`][iv-1d] §1d). Validate the
credentials themselves at startup with `CsrfConfigSchema` and `TurnstileConfigSchema` ([`INPUT_VALIDATION.md`][iv-5] §5).

---

## Binding a token to the session

`subject: false` above buys a path-only token, and a path-only token is valid for that path no matter who submits it. Where the app has sessions,
bind the token to the session id instead — the whole composition is a one-line resolver:

```ts
import { getAppContext } from "@y-core/forge/context";
import { csrfProtection, importCsrfKey } from "@y-core/forge/form";
import { sessionCtx, sessionMiddleware } from "@y-core/forge/session";

const csrfGuard = csrfProtection({
  secret: (c) => importCsrfKey(getAppContext(c).env.CSRF_SECRET),
  subject: (c) => sessionCtx.getOptional(c)?.id,
});

app.use("*", sessionMiddleware(storage, sessionCookie));
app.use("*", csrfGuard); // after the session middleware, always
```

**Register `sessionMiddleware` before `csrfProtection`.** The resolver runs before `next()`, so a guard registered first resolves against a context
carrying no session at all — and a resolver that returns nothing is a refusal, not a fallback: the mutation answers `403` and one `[csrf]` warning
names the likely cause. The fixation risk path-only binding leaves open, and why `subject` has no default, are [`INPUT_VALIDATION.md`][iv-3a] §3a's.
`subject: false` is the only opt-out.

---

## Minting a token for another path

When the form posts somewhere other than the page it renders on, mint a token for the path it posts to. `mintCsrf` uses the minter `csrfProtection`
put on the context, under that guard's own subject policy:

```ts
import { mintCsrf } from "@y-core/forge/form";

const token = await mintCsrf(c, "/api/contact"); // throws if csrfProtection is not mounted here
```

That is enough whenever the target path is guarded the same way this one is. It is not enough for shared chrome — a navbar sign-out control needs
a token for a path whose guard this request never ran, under a subject policy this request's guard may not share. Mint it with `csrfMinter`, which
is `csrfProtection`'s minting half wired directly:

```ts
import { csrfMinter, importCsrfKey } from "@y-core/forge/form";
import { sessionCtx } from "@y-core/forge/session";

const mintSignout = csrfMinter({
  secret: (c) => importCsrfKey(config(c).csrf.secret),
  subject: (c) => sessionCtx.getOptional(c)?.id,
});

const token = await mintSignout(c, "/auth/signout");
```

**Pass the same `secret` and `subject` the guard on the target path was given** — that is the whole contract. A `subject` resolver that returns
`undefined` throws here rather than minting a token that could only be refused. The key ring is cached per `env`, so a control on every page costs
one key import per isolate, not one per render.

For the auth navbar this exists for, reach for `authNav` (`@y-core/forge/auth/web`) instead of wiring the minter yourself.

---

## Sending a token on a request with no form

An `hx-delete`, or a passkey ceremony, sends no body, so the token travels as a header. The guard publishes the header name it checks on
`csrfHeaderCtx`:

```ts
import { csrfHeaderCtx, csrfTokenCtx } from "@y-core/forge/form";

const header = csrfHeaderCtx.getOptional(c) ?? "X-CSRF-Token";
```

Pass that name to `<Form>`'s `csrfHeader` prop where the app renamed it. A renamed header nobody propagated is a `403` with nothing on the page
explaining it.

`csrfFieldCtx` is the same idea for the form field, and is what the `defineAction` pipeline reads to know which field to drop.

**Read both with `.getOptional`, never `.get`.** Absence says no guard ran on this request, so nothing was consumed and nothing should be dropped
for it ([`ROUTING_AND_MIDDLEWARE.md`][ram-2b] §2b).

---

## Rotating the CSRF secret

`importCsrfKeyRing` takes an ordered array. The first secret signs; every secret in the array still verifies, so tokens minted before the rotation
keep working until they expire.

```ts
const ring = await importCsrfKeyRing([env.CSRF_SECRET_NEW, env.CSRF_SECRET_OLD]);
const csrfGuard = csrfProtection({ secret: () => ring, subject: false });
```

Prepend the new secret, deploy, and remove the oldest once the token lifetime has elapsed — the procedure is [`INPUT_VALIDATION.md`][iv-3b] §3b's.
Each secret must be at least 32 hex characters.

---

## Reading a body outside `defineAction`

A handler that cannot use the pipeline reads the body with `parseFormData` and converts it with `formToObject`. The parse is memoized against the
`Request`, so the guard and the handler share one read of the stream.

```ts
import { csrfFieldCtx, formToObject, parseFormData } from "@y-core/forge/form";
import { describeValidationIssue, v } from "@y-core/forge/validation";

async function contactAction(c) {
  const formData = await parseFormData(c);

  const consumed = csrfFieldCtx.getOptional(c);
  const body = formToObject(formData, { drop: new Set(consumed === undefined ? [] : [consumed]) });

  const parsed = v.safeParse(ContactSchema, body, { abortEarly: true });
  if (!parsed.success) {
    return new Response(parsed.issues.map(describeValidationIssue).join(", "), { status: 422 });
  }
  return new Response("Thanks — we'll be in touch.");
}
```

**Behind a CSRF guard, that `drop` is not optional.** Without it a strict schema refuses `_csrf` and the route rejects every legitimate request.
Derive the name from `csrfFieldCtx` rather than writing `"_csrf"`, so renaming `tokenField` stays a one-place change.

`formToObject` carries **every** entry through: an absent field stays absent rather than becoming `""`, a repeated key arrives as an array rather
than last-wins, a `File` survives, and the result has no prototype — so reach for `Object.hasOwn(body, name)`, since `body.hasOwnProperty` is
`undefined` and calling it throws. Text normalization is the schema's job, via
`formText()`, `formMultilineText()` and `formDigits()` ([`INPUT_VALIDATION.md`][iv-1d] §1d).

`parseFormData` defaults to a 100 KB cap and takes `{ maxBytes }` to raise it; an oversized body rejects with an `Error` carrying `{ status: 413 }`.

---

## Verifying a CAPTCHA outside the pipeline

`verifyTurnstile(formData, secretKey, options)` calls Cloudflare's siteverify API and answers a `GuardResult` — `{ ok: true }`, or `{ ok: false,
error }` naming why.

```ts
const result = await verifyTurnstile(formData, env.TURNSTILE_SECRET_KEY, {
  expectedHostname: c.url.hostname,
  expectedAction: "contact",
  remoteIp: c.request.headers.get("CF-Connecting-IP") ?? undefined,
  signal: c.request.signal,
});

if (!result.ok) return new Response("Verification failed", { status: 403 });
```

The choice you are making in that options bag is **how tightly the token is pinned**. `expectedHostname` is required and is the anti-replay pin: a
token solved on an attacker's page carries their hostname and is refused. `expectedAction` and `expectedCData` narrow it further, to one form and to
one server-supplied payload, and each is worth setting when a site has more than one widget. Omitting `expectedHostname` fails closed — the network
call is never made. `timeoutMs` (default 5 s) bounds how long a submission waits on Cloudflare; `remoteIp` and `tokenField` are wiring rather than
policy, the latter matching whatever field the widget writes.

`signal` is caller cancellation, and an abort on it **rejects** rather than resolving to a result. `defineAction` threads `c.request.signal` in by
default, and a `verify()` returning its own `signal` wins over that.

Relaxing the hostname check for local development takes a `DevAllowance` grant **and** one of Cloudflare's published testing secrets; neither half
relaxes anything alone ([`INPUT_VALIDATION.md`][iv-4a] §4a).

---

## Security

**Never surface `CsrfResult.error` or `TurnstileResult.error` to a client.** The codes are server diagnostics. `csrfProtection` collapses every
token failure to a bare `403` with no body detail, and `defineAction` answers a tripped bot guard in the shape of an ordinary validation refusal
([`INPUT_VALIDATION.md`][iv-4b] §4b).

**An oversized body is a `413`, never a `403`.**

**`secretKey` is the Turnstile secret, never the site key**, and both come from bindings rather than literals. The same holds for `CSRF_SECRET`.

**Origin and Fetch-Metadata checks are not here.** They are transport-layer, and live in [`@y-core/forge/security`][security-readme] — the split is
[`BOUNDARIES.md`][boundaries-2] §2's.

---

## Gotchas

**A raised `maxBytes` must be raised in both places.** `csrfProtection` parses before the handler does, so a route that raises `defineAction`'s
`maxBytes` must raise the guard's to match or the guard rejects first ([`INPUT_VALIDATION.md`][iv-2c] §2c). Forgetting it says so: once the shared
parse has been **refused** at the smaller cap, a later, larger cap throws a wiring error naming both caps — `isFormCapConflict(error)` identifies
it — which `csrfProtection`, the pipeline and `readAuthSubmission` all rethrow to the error boundary rather than replaying as a `413`.

**A token is bound to a path, so `csrfTokenCtx` is wrong the moment the form posts elsewhere** — verification fails with `path-mismatch`. Mint one
token per render and never cache one across requests.

**The `secret` resolver runs once per distinct `env` object, not once per request.** The ring is cached against it, so a secret change is picked up
when a fresh isolate starts rather than mid-life.

**`formToObject` returns a prototype-less object.** `body.hasOwnProperty(name)` is `undefined`, and calling it throws.

**`CsrfProtectionOptions` is exported**, so a guard defined away from its `csrfProtection(…)` call can still be typed.

---

## See also

- [`docs/INPUT_VALIDATION.md`][iv] — the rulings this README defers to: the CSRF guard contract (§3), Turnstile (§4), the byte cap (§2c), and the
  schema contract `defineAction` enforces (§1d)
- [`src/session/README.md`][session-readme] — the sessions whose id the `subject` resolver above reads
- [`src/app/README.md`][app-readme] — `defineAction` and its options, which is the path most routes take instead of this one

[app-readme]: ../app/README.md
[boundaries-2]: ../../warden/canon/libs/BOUNDARIES.md#2-transport-versus-application-security-layer
[iv]: ../../docs/INPUT_VALIDATION.md
[iv-1d]: ../../docs/INPUT_VALIDATION.md#1d-defineaction--the-schema-contract
[iv-2c]: ../../docs/INPUT_VALIDATION.md#2c-parseformdata--body-read-with-size-limit
[iv-3a]: ../../docs/INPUT_VALIDATION.md#3a-csrfprotection-middleware--guard-mutating-routes
[iv-3b]: ../../docs/INPUT_VALIDATION.md#3b-importcsrfkey-and-importcsrfkeyring--secret-import
[iv-4a]: ../../docs/INPUT_VALIDATION.md#4a-verifyturnstile--cloudflare-turnstile-captcha
[iv-4b]: ../../docs/INPUT_VALIDATION.md#4b-guard-refusal-shape-and-its-residual-oracle
[iv-5]: ../../docs/INPUT_VALIDATION.md#5-config-schemas
[mint-section]: #minting-a-token-for-another-path
[ram-2b]: ../../docs/ROUTING_AND_MIDDLEWARE.md#2b-action-only-routes-with-defineaction
[security-readme]: ../security/README.md
[session-readme]: ../session/README.md
