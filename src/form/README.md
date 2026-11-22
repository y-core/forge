---
title: Form Submission Handling
description: "Guarding and reading a form submission: a byte-capped body read, stateless CSRF tokens, and Turnstile verification."
audience: consumer
---

# `@y-core/forge/form`

A form submission arrives as bytes you must cap before reading, a token you must verify before trusting, and a body a schema must see whole. This
namespace does all three, and each is a separate function so a route composes only what it needs.

```ts
import { mintCsrf, parseFormData, formToObject, verifyTurnstile } from "@y-core/forge/form";
```

**Most routes call almost none of it.** `defineAction` (`@y-core/forge/app`) runs the read, the bot guard and the parse itself, so a route names a
schema and the guard's options and writes no plumbing. What is here are the primitives that pipeline is built from, kept public for the handlers
that sit outside it. CSRF is configured once for the whole app, as the `csrf` policy on `applyMiddlewareChain` (`@y-core/forge/app`), which
takes this namespace's `CsrfPolicyOptions`.

---

## Getting started

The CSRF policy goes on the middleware chain once, and the action declares its schema. Nothing else is wired by hand.

```ts
import { applyMiddlewareChain } from "@y-core/forge/app";
import { fragmentResponse } from "@y-core/forge/http";
import { importKeyRing, parseKeyRingSecrets } from "@y-core/forge/crypto/keyring";
import { renderSuccess } from "@y-core/forge/render/htmx";
import { formMultilineText, formText, v } from "@y-core/forge/validation";

import { defineAction } from "./handlers"; // createHandlerFactory<Bindings, AppConfig>()
import { routes } from "./routes";

applyMiddlewareChain<AppEnv>(app, {
  securityHeaders: {},
  csrf: {
    ring: (env) => importKeyRing(parseKeyRingSecrets(env.CSRF_SECRET)),
    subject: false, // path-only tokens; bind to a session wherever one exists — see below
  },
});

const ContactSchema = v.strictObject({
  name: v.pipe(formText(), v.minLength(2)),
  email: v.pipe(formText(), v.email()),
  message: v.pipe(formMultilineText(), v.minLength(10)),
});

const contactAction = defineAction(routes.contact, {
  schema: ContactSchema,
  turnstile: { verify: () => ({ expectedAction: "contact" }) },
  handle: async (data) => {
    await sendEmail(data);
    return fragmentResponse(renderSuccess("Thanks — we'll be in touch."));
  },
});
```

`turnstile: {}` is the whole opt-in: the secret comes from `TURNSTILE_SECRET_KEY`, the token is pinned to the request's own hostname, and
`CF-Connecting-IP` goes to siteverify when the request carries one. `secretKey` and `verify` override those defaults, `verify` merged over them.
Render the widget's site key from `readTurnstileKey(c, "siteKey")`, exported by `@y-core/forge/app`, so the page and the check read one place. A
missing or blank key answers 500 naming it.

A form that posts back to its own page renders `await mintCsrf(c, c.url.pathname)` into `<Form csrfToken={…}>` from `@y-core/forge/ui/core`,
which writes both the hidden `_csrf` input and the `hx-headers` entry htmx submits it on. A form htmx or the browser submits by GET or DELETE gets
the header alone, because those verbs put the form's fields in the URL. For a DELETE form that must also work without JavaScript, see
[`ui/core`'s form section][ui-form].

```tsx
import { mintCsrf } from "@y-core/forge/form";
import { Form } from "@y-core/forge/ui/core";

async function contactPage(c) {
  return <Form csrfToken={await mintCsrf(c, c.url.pathname)} hx-post='/contact' />;
}
```

A token is bound to **the path passed to it**, so `c.url.pathname` is the right path only when the form posts back to the page it was rendered
on. Anything else needs a token minted for its own path — see [Minting a token for another path][mint-section] below.

Neither the CSRF field nor the Turnstile field appears in `ContactSchema`: a guard that consumed a field is what removes it before validation
([`INPUT_VALIDATION.md`][iv-1d] §1d). Validate the
credentials themselves at startup with `CsrfConfigSchema` and `TurnstileConfigSchema` ([`INPUT_VALIDATION.md`][iv-5] §5).

---

## Binding a token to the session

`subject: false` above buys a path-only token, and a path-only token is valid for that path no matter who submits it. Where the app has sessions,
bind the token to the session id instead with `subject: "session"`:

```ts
import { applyMiddlewareChain } from "@y-core/forge/app";
import { importKeyRing, parseKeyRingSecrets } from "@y-core/forge/crypto/keyring";
import { createAnonymousSession } from "@y-core/forge/session";

applyMiddlewareChain<AppEnv>(app, {
  securityHeaders: {},
  session: createAnonymousSession<AppEnv>({
    ring: (env) => importKeyRing(parseKeyRingSecrets(env.SESSION_SECRET)),
    storage: "cookie",
  }),
  csrf: {
    ring: (env) => importKeyRing(parseKeyRingSecrets(env.CSRF_SECRET)),
    subject: "session",
  },
});
```

**The chain resolves `"session"` to the session id, and throws at registration when no session slot is supplied.** Where it mints and
verifies is the guard policy table's ([`ROUTING_AND_MIDDLEWARE.md`][ram-3e] §3e). A `subject` resolver of
your own that returns nothing is a refusal, not a fallback: the mutation answers `403` and one `[csrf]` warning names the likely cause. On a `GET`
the subject is read at the first mint, so a page that renders no form never reads the session id. The fixation risk path-only binding leaves
open, and why `subject` has no default, are [`INPUT_VALIDATION.md`][iv-3a] §3a's. `subject: false` is the only policy-wide opt-out;
`unboundPaths`, below, leaves named paths unbound.

---

## Choosing which paths the policy covers

The policy covers every path unless you say otherwise. `paths` narrows it, and `exclude` carves out a path that must take a mutation with no
token, such as a webhook that proves itself with a signature instead. Which endpoints need it is the guard policy table's
([`ROUTING_AND_MIDDLEWARE.md`][ram-3e] §3e):

```ts
import { applyMiddlewareChain } from "@y-core/forge/app";
import { importKeyRing, parseKeyRingSecrets } from "@y-core/forge/crypto/keyring";
import { createAnonymousSession } from "@y-core/forge/session";

applyMiddlewareChain<AppEnv>(app, {
  securityHeaders: {},
  session: createAnonymousSession<AppEnv>({
    ring: (env) => importKeyRing(parseKeyRingSecrets(env.SESSION_SECRET)),
    storage: "cookie",
  }),
  csrf: {
    ring: (env) => importKeyRing(parseKeyRingSecrets(env.CSRF_SECRET)),
    subject: "session",
    exclude: ["/hooks/*"],
  },
});
```

Nothing is minted on an excluded path either, so `mintCsrf` throws in a handler there.

**`unboundPaths` names paths whose tokens carry no subject**, for a form that must work without a session, such as a contact form beside a
bound sign-out control. The token's target path decides, at mint and at verify, so one page can carry both. A malformed pattern throws at
registration:

```ts
import { applyMiddlewareChain } from "@y-core/forge/app";
import { importKeyRing, parseKeyRingSecrets } from "@y-core/forge/crypto/keyring";
import { createAnonymousSession } from "@y-core/forge/session";

applyMiddlewareChain<AppEnv>(app, {
  securityHeaders: {},
  session: createAnonymousSession<AppEnv>({
    ring: (env) => importKeyRing(parseKeyRingSecrets(env.SESSION_SECRET)),
    storage: "cookie",
  }),
  csrf: {
    ring: (env) => importKeyRing(parseKeyRingSecrets(env.CSRF_SECRET)),
    subject: "session",
    unboundPaths: ["/", "/api/contact"],
  },
});
```

**An app has one policy.** It is `applyMiddlewareChain`'s own option, never a `MiddlewareContribution`'s. So `maxBytes` is app-wide: set it
on the one policy. Why there is one is [`ROUTING_AND_MIDDLEWARE.md`][ram-3f] §3f's.

**A route with its own origin check or rate limit goes in a guard group**, the chain's `guards`, not in its own `middleware` array. The group
verifies the token after those checks; a route's own middleware runs after the token was already verified.

---

## Wiring CSRF without the chain

An app that registers its middleware with `app.use` itself mounts `csrfMintStage` after its session middleware. `subject: "session"` is the
chain's to resolve, and `csrfMintStage` throws on it, so pass a resolver that reads the session:

```ts
import { importKeyRing, parseKeyRingSecrets } from "@y-core/forge/crypto/keyring";
import { csrfMintStage } from "@y-core/forge/form";
import { createAnonymousSession, sessionCtx } from "@y-core/forge/session";

app.use(
  "*",
  createAnonymousSession<AppEnv>({
    ring: (env) => importKeyRing(parseKeyRingSecrets(env.SESSION_SECRET)),
    storage: "cookie",
  }),
);
app.use(
  "*",
  csrfMintStage<AppEnv>({
    ring: (env) => importKeyRing(parseKeyRingSecrets(env.CSRF_SECRET)),
    subject: (c) => sessionCtx.get(c).id,
  }),
);
```

Forge's router verifies the token after your last `app.use` registration and before any route middleware, so an origin check or rate limit
registered with `app.use` runs before it. Without the chain no trust in Cloudflare headers is published, so such a rate limit needs a `key`.

---

## Minting a token for another path

When the form posts somewhere other than the page it renders on, mint a token for the path it posts to. `mintCsrf` uses the minter the CSRF
policy put on the context, under the policy's own `subject`:

```ts
import { mintCsrf } from "@y-core/forge/form";

const token = await mintCsrf(c, "/api/contact"); // throws if the CSRF policy does not cover this request
```

**The policy must cover the request rendering the form**, so shared chrome such as a sign-out control renders only on paths outside its
`exclude`. The token's target path decides its subject, so a token minted on an unbound page for a bound path is still bound
([`INPUT_VALIDATION.md`][iv-3a] §3a). For the auth navbar, `authNav` (`@y-core/forge/auth/web`) mints its sign-out token this way.

---

## Sending a token on a request with no form

An `hx-delete`, or a passkey ceremony, sends no body, so the token travels as a header. The CSRF policy publishes the header name it checks on
`csrfHeaderCtx`:

```ts
import { CSRF_HEADER_DEFAULT, csrfHeaderCtx } from "@y-core/forge/form";

const header = csrfHeaderCtx.getOptional(c) ?? CSRF_HEADER_DEFAULT;
```

Pass that name to `<Form>`'s `csrfHeader` prop where the app renamed it. A renamed header nobody propagated is a `403` with nothing on the page
explaining it.

`csrfFieldCtx` is the same idea for the form field, and is what the `defineAction` pipeline reads to know which field to drop.

**Read both with `.getOptional`, never `.get`.** Absence says the policy did not cover this request, so nothing was consumed and nothing should be
dropped for it ([`ROUTING_AND_MIDDLEWARE.md`][ram-2b] §2b).

---

## Answering a refusal yourself

An htmx target swaps whatever a refusal answers, so a bare `Forbidden` lands in the page as a word. The policy takes no hook of its own: a CSRF
refusal is answered by the refusal hook, `onRefuse`, declared once on the chain and overridable per guard group. Pass one that answers with
something the target can show:

```ts
import { applyMiddlewareChain } from "@y-core/forge/app";
import { importKeyRing, parseKeyRingSecrets } from "@y-core/forge/crypto/keyring";
import { fragmentResponse } from "@y-core/forge/http";
import { createAnonymousSession } from "@y-core/forge/session";

applyMiddlewareChain<AppEnv>(app, {
  securityHeaders: {},
  session: createAnonymousSession<AppEnv>({
    ring: (env) => importKeyRing(parseKeyRingSecrets(env.SESSION_SECRET)),
    storage: "cookie",
  }),
  csrf: {
    ring: (env) => importKeyRing(parseKeyRingSecrets(env.CSRF_SECRET)),
    subject: "session",
  },
  onRefuse: (_c, refusal) => fragmentResponse("<p>That did not go through. Reload the page and try again.</p>", refusal.status),
});
```

The hook receives a `Refusal` whose `guard` is `"csrf"`. Its statuses, which hook answers it and its log line are the guard policy table's
([`ROUTING_AND_MIDDLEWARE.md`][ram-3e] §3e).

**The reason is for routing and logging, never for the response body** — the [Security][security-section] rule below holds for it too.

**`"unbound-subject"` means a `subject` resolver of your own returned nothing**, usually because of registration order — see
[Binding a token to the session][binding-section]. Every other reason is a `CsrfResult` code.

---

## How long a token lives

A token verifies for the policy's `maxAgeMs`, which defaults to `CSRF_MAX_AGE_MS_DEFAULT`: 24 hours. That is past the 20 hours WCAG 2.2.1
Timing Adjustable exempts, and equal to the auth session's idle bound, so a form left open in a live session is not refused for its age alone.
`verifyCsrfToken` takes the same default.

```ts
import { applyMiddlewareChain } from "@y-core/forge/app";

applyMiddlewareChain(app, {
  securityHeaders: {},
  csrf: { ring: csrfRing, subject: false, maxAgeMs: 4 * 60 * 60 * 1000 }, // 4 hours
});
```

**An app that lowers `maxAgeMs` below 20 hours owes the visitor a warning before the token expires and a way to extend it** — a way to reload
the form and keep what they typed. A `maxAgeMs` that is not a whole number of at least one millisecond throws at registration. Why the default
is what it is, is [`INPUT_VALIDATION.md`][iv-3a] §3a's.

---

## Rotating the CSRF secret

**The secret is a key ring: hex root secrets comma-joined, newest first.** The first signs, and every one still verifies, so a token minted before
the rotation keeps working until it expires. The token carries the signing key's id, and `CsrfConfigSchema` accepts the comma-joined form.

```bash
CSRF_SECRET=9c1e…,ab3f…
```

Prepend the new secret, deploy, and remove the oldest once the token lifetime has elapsed — the procedure is [`INPUT_VALIDATION.md`][iv-3b] §3b's.
Each secret is held to [`SECURITY_HARDENING.md`][sh-8] §8's strength rule; `openssl rand -hex 32` gives one that passes.

**Tokens are signed under a subkey of their own.** The CSRF policy derives a `csrf` subkey from the ring, so a token signature never verifies as
anything else signed under the same ring. It refuses the auth key ring, which `importKeyRing` did not build.

---

## Reading a body outside `defineAction`

A handler that cannot use the pipeline reads the body with `parseFormData` and converts it with `formToObject`. The parse is memoized against the
`Request`, so the CSRF check and the handler share one read of the stream.

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

**Under the CSRF policy, that `drop` is not optional.** Without it a strict schema refuses `_csrf` and the route rejects every legitimate request.
Derive the name from `csrfFieldCtx` rather than writing `"_csrf"`, so renaming `tokenField` stays a one-place change.

`formToObject` carries **every** entry through: an absent field stays absent rather than becoming `""`, a repeated key arrives as an array rather
than last-wins, a `File` survives, and the result has no prototype — so reach for `Object.hasOwn(body, name)`, since `body.hasOwnProperty` is
`undefined` and calling it throws. Text normalization is the schema's job, via
`formText()`, `formMultilineText()` and `formDigits()` ([`INPUT_VALIDATION.md`][iv-1d] §1d).

`parseFormData` caps the body at `FORM_MAX_BYTES_DEFAULT` and takes `{ maxBytes }` to raise it; an oversized body rejects with an `Error`
carrying `{ status: 413 }`.

---

## Verifying a CAPTCHA outside the pipeline

`verifyTurnstile(formData, secretKey, options)` calls Cloudflare's siteverify API and answers a `GuardResult` — `{ ok: true }`, or `{ ok: false,
error }` naming why.

```ts
import { readTurnstileKey } from "@y-core/forge/app";
import { verifyTurnstile } from "@y-core/forge/form";

async function checkHuman(c, formData: FormData): Promise<Response | undefined> {
  const result = await verifyTurnstile(formData, await readTurnstileKey(c, "secretKey"), {
    expectedHostname: c.url.hostname,
    expectedAction: "contact",
    remoteIp: c.request.headers.get("CF-Connecting-IP") ?? undefined,
    signal: c.request.signal,
  });

  if (!result.ok) return new Response("Verification failed", { status: 403 });
}
```

The choice you are making in that options bag is **how tightly the token is pinned**. `expectedHostname` is required and is the anti-replay pin: a
token solved on an attacker's page carries their hostname and is refused. `expectedAction` and `expectedCData` narrow it further, to one form and to
one server-supplied payload, and each is worth setting when a site has more than one widget. Omitting `expectedHostname` fails closed — the network
call is never made. `timeoutMs` bounds how long a submission waits on Cloudflare; `remoteIp` and `tokenField` are wiring rather than
policy, the latter matching whatever field the widget writes.

`signal` is caller cancellation, and an abort on it **rejects** rather than resolving to a result. `defineAction` threads `c.request.signal` in by
default, and a `verify()` returning its own `signal` wins over that.

To submit forms locally against Cloudflare's published testing secrets, run the app with [`forge cf dev`][cf-dev] and set one of those secrets
as the secret key. Under it the hostname, action and cdata checks are skipped for a testing secret, and for nothing else; every other build
compares them ([`INPUT_VALIDATION.md`][iv-4a] §4a).

---

## Security

**Never surface `CsrfResult.error` or `TurnstileResult.error` to a client.** The codes are server diagnostics. The CSRF policy answers every
refusal with a bare status phrase and no body detail unless a refusal hook answers it, and `defineAction` answers a tripped bot guard in the
shape of an ordinary validation refusal ([`INPUT_VALIDATION.md`][iv-4b] §4b).

**An oversized body is a `413`, never a `403`.**

**`secretKey` is the Turnstile secret, never the site key**, and both come from bindings rather than literals. The same holds for `CSRF_SECRET`.
Cloudflare's always-pass testing keys are `TURNSTILE_TEST_KEYS` in `@y-core/forge/testing/form`, kept off every runtime subpath so that no
production Worker can ship them by accident.

**Origin and Fetch-Metadata checks are not here.** They are transport-layer, and live in [`@y-core/forge/security`][security-readme] — the split is
[`BOUNDARIES.md`][boundaries-2] §2's.

---

## Gotchas

**A raised `maxBytes` must be raised in both places.** The CSRF policy parses before the handler does, so a route that raises `defineAction`'s
`maxBytes` must raise the policy's to match or the policy rejects first ([`INPUT_VALIDATION.md`][iv-2c] §2c). The policy's cap is app-wide; each
route's own `maxBytes` still caps that route. Forgetting it says so: once the shared
parse has been **refused** at the smaller cap, a later, larger cap throws a wiring error naming both caps — `isFormCapConflict(error)` identifies
it — which the CSRF policy, the pipeline and `readAuthSubmission` all rethrow to the error boundary rather than replaying as a `413`.

**A token is bound to a path, so a token minted for `c.url.pathname` is wrong the moment the form posts elsewhere** — verification fails with
`path-mismatch`. Mint one token per render and never cache one across requests.

**The `ring` resolver runs once per distinct `env` object, not once per request.** The ring is cached against it, so a secret change is picked up
when a fresh isolate starts rather than mid-life.

---

## See also

- [`docs/INPUT_VALIDATION.md`][iv] — the rulings this README defers to: the CSRF policy, Turnstile, the byte cap, and the schema contract
- [`docs/ROUTING_AND_MIDDLEWARE.md`][ram-3f] §3f — why an app has one CSRF policy and no inline verifier
- [`src/session/README.md`][session-readme] — the sessions whose id `subject: "session"` binds a token to
- [`src/app/README.md`][app-readme] — `defineAction` and its options, which is the path most routes take instead of this one

[app-readme]: ../app/README.md
[binding-section]: #binding-a-token-to-the-session
[boundaries-2]: ../../warden/canon/libs/BOUNDARIES.md#2-transport-versus-application-security-layer
[cf-dev]: ../tooling/cf/README.md#running-the-app-locally
[iv]: ../../docs/INPUT_VALIDATION.md
[iv-1d]: ../../docs/INPUT_VALIDATION.md#1d-defineaction--the-schema-contract
[iv-2c]: ../../docs/INPUT_VALIDATION.md#2c-parseformdata--body-read-with-size-limit
[iv-3a]: ../../docs/INPUT_VALIDATION.md#3a-the-csrf-policy--guard-mutating-routes
[iv-3b]: ../../docs/INPUT_VALIDATION.md#3b-the-csrf-key-ring--import-and-rotation
[iv-4a]: ../../docs/INPUT_VALIDATION.md#4a-verifyturnstile--cloudflare-turnstile-captcha
[iv-4b]: ../../docs/INPUT_VALIDATION.md#4b-guard-refusal-shape-and-its-residual-oracle
[iv-5]: ../../docs/INPUT_VALIDATION.md#5-config-schemas
[mint-section]: #minting-a-token-for-another-path
[ram-2b]: ../../docs/ROUTING_AND_MIDDLEWARE.md#2b-action-only-routes-with-defineaction
[ram-3e]: ../../docs/ROUTING_AND_MIDDLEWARE.md#3e-applymiddlewarechain-canonical-chain-builder
[ram-3f]: ../../docs/ROUTING_AND_MIDDLEWARE.md#3f-one-csrf-policy-per-app-verified-once
[security-readme]: ../security/README.md
[security-section]: #security
[session-readme]: ../session/README.md
[sh-8]: ../../docs/SECURITY_HARDENING.md#8-secret-strength--one-rule-for-every-secret
[ui-form]: ../ui/README.md#build-a-form
