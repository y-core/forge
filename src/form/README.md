# `@y-core/forge/form`

Form submission handling for server-rendered apps on `@remix-run/fetch-router` + Cloudflare Workers:
byte-capped form-data parsing, **stateless CSRF protection**, **honeypot bot detection**, and
**Cloudflare Turnstile** verification. Each concern is a separate, independently useful function —
compose only what a route needs.

```ts
import {
  csrfProtection,
  importCsrfKey,
  mintCsrf,
  csrfTokenCtx,
  csrfFieldCtx,
  parseFormData,
  formToObject,
  isHoneypotFilled,
  verifyTurnstile,
} from "@y-core/forge/form";
```

**The recommended path does not call most of this.** `defineAction` (`@y-core/forge/app`) takes a
schema and runs the whole pipeline itself — the byte-capped read, the honeypot check, Turnstile
verification, and the parse — so a route names its schema plus the field each guard consumes and
writes none of the plumbing. The functions here are the primitives that pipeline is built from, and
they stay public for handlers outside it.

`formToObject` is how a body becomes something a schema can parse: it carries **every** entry
through, so an undeclared field is refused rather than silently dropped, an absent field stays
absent rather than becoming `""`, a repeated key arrives as an array, and a `File` survives. This
namespace deliberately exposes no **named-field** reader — one existed, and it collapsed absence
into `""` before any schema could observe it.

---

## Features

- **Byte-capped form parsing** — `parseFormData` enforces a body-size budget via a `Content-Length`
  fast-path **and** a streaming counting transform, closing the chunked-transfer bypass. The parse is
  memoized per `Request`, so CSRF verification and the action handler share a single body read.
- **Stateless CSRF** — HMAC-SHA256 tokens bound to a request **path** and an optional **subject**,
  with **key-ring rotation** and a 30s clock-skew tolerance. No server-side token store.
- **CSRF middleware** — `csrfProtection` pre-mints a token on `GET`/`HEAD` and verifies it on every
  mutation, collapsing **every** failure to a bare `403`. It also publishes the field it took the
  token from on `csrfFieldCtx`, so a route builder downstream can drop exactly what the guard
  consumed.
- **Whole-body read** — `formToObject` turns a parsed form into a plain object with nothing named and
  nothing collapsed: absence stays absence, a repeated key becomes an array, a `File` passes through.
  Its `drop` set is how a consumed field leaves before a strict schema sees it.
- **Honeypot detection** — `isHoneypotFilled` flags submissions that filled an invisible decoy field.
  A `defineAction` route does not call it — it names `honeypot` and the pipeline runs the check.
- **Turnstile verification** — `verifyTurnstile` calls the Cloudflare siteverify API with mandatory
  hostname pinning plus optional action/cdata pinning and a request timeout. A `defineAction` route
  names `turnstile` instead of calling it.

---

## Usage

A complete contact-form flow: middleware verifies CSRF, the page handler mints a token for its form,
and the action declares its schema and the two fields its bot guards consume.

```ts
import { csrfProtection, importCsrfKey, csrfTokenCtx } from "@y-core/forge/form";
import { defineAction } from "@y-core/forge/app";
import { getAppContext } from "@y-core/forge/context";
import { fragmentResponse, renderSuccess } from "@y-core/forge/http";
import { formMultilineText, formText, strictObject, v } from "@y-core/forge/validation";

// One app-owned constant, referenced by the view and by the action. Never a forge-published name:
// a decoy works only while a bot cannot predict it, and forge is open source.
export const CONTACT_DECOY = "company";

// 1. CSRF middleware — the secret is resolved lazily from the request context. On GET/HEAD it
//    pre-mints a token bound to the current path; on POST it verifies, and on both it records the
//    field it read the token from so the action can drop exactly that field.
const csrfGuard = csrfProtection({
  secret: (context) => importCsrfKey(getAppContext(context).env.CSRF_SECRET),
  subject: false, // path-only tokens — the greppable opt-out; bind to a session where one exists
});

// 2. Page handler (GET /contact) — read the pre-minted token bound to the current path and stamp it
//    into the form's hidden `_csrf` input, alongside the decoy under the shared constant.
function contactPage(context) {
  const token = csrfTokenCtx.get(context);
  return renderPage(<ContactForm csrfToken={token} decoy={CONTACT_DECOY} />);
}

// 3. Action handler (POST /contact) — the pipeline reads the body, checks the decoy, verifies the
//    CAPTCHA, drops all three consumed fields, then parses. `_csrf` is dropped because csrfGuard
//    published its name; the other two because this route named them.
const ContactSchema = strictObject({
  name: v.pipe(formText(), v.minLength(2)),
  email: v.pipe(formText(), v.email()),
  message: v.pipe(formMultilineText(), v.minLength(10)),
});

const contactAction = defineAction<typeof ContactSchema, Bindings, AppConfig>({
  schema: ContactSchema,
  honeypot: CONTACT_DECOY,
  turnstile: {
    secretKey: (_c, config) => config.services.turnstile.secretKey,
    verify: (c) => ({
      expectedHostname: c.url.hostname,
      expectedAction: "contact",
      remoteIp: c.request.headers.get("CF-Connecting-IP") ?? undefined,
    }),
  },
  handle: async (data) => {
    await sendEmail(data);
    return fragmentResponse(renderSuccess("Thanks — we'll be in touch."));
  },
});
```

### Outside the pipeline

A handler that cannot use `defineAction` reads the body with `parseFormData` and converts it with
`formToObject`. **Behind a CSRF guard, that conversion must drop the field the guard consumed** —
otherwise a strict schema refuses `_csrf` and the route rejects every legitimate request:

```ts
import { csrfFieldCtx, formToObject, parseFormData } from "@y-core/forge/form";
import { describeValidationIssue, v } from "@y-core/forge/validation";

async function contactAction(context) {
  const formData = await parseFormData(context);

  // The guard published the field it read the token from. Absent means no guard ran, so nothing was
  // consumed and nothing is dropped — and a `_csrf` arriving anyway is an undeclared field the
  // strict schema is right to refuse, which names the missing middleware.
  const consumed = csrfFieldCtx.getOptional(context);
  const body = formToObject(formData, { drop: new Set(consumed === undefined ? [] : [consumed]) });

  const parsed = v.safeParse(ContactSchema, body, { abortEarly: true });
  if (!parsed.success) {
    return new Response(parsed.issues.map(describeValidationIssue).join(", "), { status: 422 });
  }

  await sendEmail(parsed.output);
  return new Response("Thanks — we'll be in touch.");
}
```

When the form POSTs to a **different** path than the page it renders on, mint a token bound to that
action path instead of reading `csrfTokenCtx`:

```ts
import { mintCsrf } from "@y-core/forge/form";

// In a GET handler that renders a form posting to /api/contact:
const actionToken = await mintCsrf(context, "/api/contact");
```

---

## Core Components & APIs

### Form parsing — `parseFormData`

```ts
function parseFormData(
  context: RequestContext,
  options?: ParseFormDataOptions,
): Promise<ReadonlyFormData>;
```

Parses the request body into a `ReadonlyFormData`, rejecting oversized bodies. The result is memoized
against the underlying `Request` in a `WeakMap`, so calling it from CSRF middleware and again from the
action handler parses the stream **once**. Bodies that exceed the budget reject with an `Error`
carrying `{ status: 413 }`.

| Parameter | Type | Description |
|---|---|---|
| `context` | `RequestContext` | The request context; `parseFormData` reads `context.request`. |
| `options.maxBytes` | `number` | Max body size in bytes. Defaults to `FORM_MAX_BYTES_DEFAULT` (100 KB). |

The cap is enforced two ways: a `Content-Length` fast-path that rejects before reading the body, and a
streaming counting transform that errors once the running byte total exceeds `maxBytes` — so a request
with an absent or lying `Content-Length` (chunked transfer) is still capped.

A body can only be read once, so the **first** call for a request is what meters the stream and its
`maxBytes` is the ceiling for everyone. Later callers are not silently bound by it: each re-checks the
bytes actually read against its own `maxBytes` and rejects with its own `413`. The consequence for
ordering is that a guard which parses first — `csrfProtection` — must be given the same raised cap as
the route handler, or it rejects the request before the handler is reached.

### Body to object — `formToObject`

```ts
function formToObject(
  formData: ReadonlyFormData,
  options?: FormToObjectOptions,
): Record<string, FormDataEntryValue | FormDataEntryValue[]>;
```

Converts a parsed form into a plain object a schema can validate, carrying every entry the caller
sent. This is what `defineAction` uses internally; call it directly only for a handler outside that
pipeline.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `formData` | `ReadonlyFormData` | — | The parsed body, from `parseFormData`. |
| `options.drop` | `ReadonlySet<string>` | — | Field names to leave out. Use it for fields a guard already consumed — a CSRF token, a decoy, a CAPTCHA token — since a strict schema has no reason to declare them. |

Four properties are load-bearing, and each is why a named-field reader could not do this job:

- **An absent field is absent**, never `""`. That keeps `v.optional` reachable and required-ness a
  presence check rather than a min-length check.
- **A repeated key arrives as an array**, so a scalar schema refuses it in its own words and a route
  that genuinely accepts many says so with `v.array`. Note this is *not* `Object.fromEntries`
  behaviour, which is last-wins and hides the duplicate entirely.
- **A `File` passes through unchanged**, so an upload schema can see one.
- **The result has no prototype**, which matters to a caller that inspects it:
  `body.hasOwnProperty(name)` is `undefined` rather than a method and calling it throws. Use
  `Object.hasOwn(body, name)` or `name in body`.

Text normalization is deliberately **not** done here — it belongs to the schema, via `formText()` and
`formMultilineText()` from `@y-core/forge/validation`. See
[`INPUT_VALIDATION.md`](../../.decisions/INPUT_VALIDATION.md) §1d for the four reasons.

### CSRF middleware — `csrfProtection`

```ts
function csrfProtection(options: CsrfProtectionOptions): Middleware;

interface CsrfProtectionOptions {
  secret: (context: RequestContext) => CryptoKey | CsrfKeyRing | Promise<CryptoKey | CsrfKeyRing>;
  tokenField?: string;
  headerName?: string;
  subject: ((context: RequestContext) => string | undefined) | false;
  maxBytes?: number;
}
```

`CsrfProtectionOptions` is a named, exported type — import it to type a guard defined outside the
`csrfProtection(...)` call.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `secret` | resolver | — | Returns the signing key or key ring. Invoked once per distinct `context.env` object and cached against it (`WeakMap`), so the key imports once per isolate. |
| `tokenField` | `string` | `CSRF_FIELD_DEFAULT` (`"_csrf"`) | Hidden-input field name the token is read from on mutations. |
| `headerName` | `string` | `"X-CSRF-Token"` | Request header checked for the token before the form body. |
| `subject` | resolver \| `false` | — | **Required.** A resolver binding the token to a session/user identifier so a token minted for one subject cannot be used by another, or the literal `false` to opt into a deliberate path-only token. |
| `maxBytes` | `number` | `FORM_MAX_BYTES_DEFAULT` (100 KB) | Body-size cap for the token lookup's form parse. The guard parses the body first, so a route that raises its handler's cap must raise this one to match. |

Behaviour by method:

- **`GET` / `HEAD`** — sets the per-request minter (`csrfMinterCtx`) and pre-mints a token bound to
  `context.url.pathname`, exposed via `csrfTokenCtx`. Then calls `next()`.
- **Mutations (`POST`, etc.)** — reads the token from the `headerName` header, falling back to the
  `tokenField` form field, and verifies it against the current pathname (and `subject`, if configured).
  On **any** token failure it short-circuits with a bare `403` `Response` and never calls `next()`.
  A body that exceeds `maxBytes` is a size failure, not a token failure, and short-circuits with a
  bare `413` instead — reporting it as `403` would send the client hunting for a token problem that
  does not exist.

#### Binding tokens to a session (recommended when a session exists)

Path binding alone does not stop a token minted in one user's browser from being replayed by
another user against the same path. When the app has sessions, bind the token to the session id —
the standard composition is a one-line `subject` resolver reading `sessionCtx`:

```ts
import { csrfProtection } from "@y-core/forge/form";
import { sessionCtx } from "@y-core/forge/session";

const csrfGuard = csrfProtection({
  secret: (c) => resolveCsrfKey(c),
  // Token is minted AND verified against the current session id — a token minted under
  // one session verifies only under that session (mismatch → 403, reason "subject-mismatch").
  subject: (c) => sessionCtx.getOptional(c)?.id,
});
```

Register `sessionMiddleware` **before** `csrfGuard` so the session exists when the subject is
resolved. `form` and `session` are independent leaf namespaces — this composition lives in the
consuming app, which is why forge does not auto-wire it. The subject-mismatch contract is pinned
by the integration test in `csrf.test.ts` ("subject binding — wrong session returns 403").

### CSRF context accessors — `csrfTokenCtx`, `csrfMinterCtx`, `csrfFieldCtx`

```ts
const csrfTokenCtx: ContextVar<string>;
const csrfMinterCtx: ContextVar<(path: string) => Promise<string>>;
const csrfFieldCtx: ContextVar<string>;
```

`csrfTokenCtx.get(context)` returns the pre-minted token bound to the **current request's pathname**,
set by `csrfProtection` on `GET`/`HEAD`. Use it only when the form POSTs back to the same path —
otherwise verification fails with `path-mismatch`. `csrfMinterCtx` holds the underlying minter function
and is normally accessed indirectly through `mintCsrf`.

`csrfFieldCtx` carries the field name this request's guard took the token from — `tokenField`, or its
default. `csrfProtection` sets it above every early return, so it is present on every request the
guard ran on: the `GET` that mints, the mutation that passes, and the mutation it refuses alike.

**Read it with `.getOptional`, never `.get`.** Absence is meaningful rather than an error: it says no
guard ran on this request, so nothing consumed the field and nothing should be dropped for it. That is
the whole contract a downstream reader needs, which is why the accessor lives apart from `csrf.ts` —
importing it pulls in no token implementation and no Web Crypto work. See
[`ROUTING_AND_MIDDLEWARE.md`](../../.decisions/ROUTING_AND_MIDDLEWARE.md) §2b for the derive-only rule
built on it.

### Mint for another path — `mintCsrf`

```ts
function mintCsrf(context: RequestContext, path?: string): Promise<string>;
```

Mints a CSRF token bound to `path` using the minter installed by `csrfProtection`. `path` is
**required** — a token must declare the action path it authorizes. Throws if `path` is missing/empty,
or if no minter is on the context (i.e. `csrfProtection` is not mounted on the route).

| Parameter | Type | Description |
|---|---|---|
| `context` | `RequestContext` | A context that ran through `csrfProtection`. |
| `path` | `string` | The action path the minted token authorizes (e.g. `"/api/contact"`). |

### CSRF token primitives — `importCsrfKey`, `importCsrfKeyRing`, `createCsrfToken`, `verifyCsrfToken`

The lower-level primitives, used directly when you mint or verify tokens outside the middleware.

```ts
function importCsrfKey(hexSecret: string): Promise<CryptoKey>;
function importCsrfKeyRing(secrets: [string, ...string[]]): Promise<CsrfKeyRing>;
function createCsrfToken(key: CryptoKey, path: string, options?: CsrfTokenOptions): Promise<string>;
function verifyCsrfToken(
  keyOrRing: CryptoKey | CsrfKeyRing,
  token: string,
  path: string,
  options?: CsrfVerifyOptions,
): Promise<CsrfResult>;
```

```ts
const key = await importCsrfKey(env.CSRF_SECRET);          // hex secret → HMAC-SHA256 key
const token = await createCsrfToken(key, "/api/contact");  // path-bound token
const verdict = await verifyCsrfToken(key, token, "/api/contact", { maxAgeMs: 3_600_000 });
if (verdict.ok) {
  // accept
}
```

A token embeds `kid | path | subject | timestamp | nonce`, base64url-encoded and HMAC-signed.
`verifyCsrfToken` checks, in order: format, timestamp (rejecting expired tokens past `maxAgeMs` —
default 1 hour — and future timestamps beyond a 30s clock-skew window), `path` match, optional
`subject` match, key lookup by `kid`, and finally the signature.

| `createCsrfToken` option (`CsrfTokenOptions`) | Type | Description |
|---|---|---|
| `kid` | `string` | Key id embedded in the token; selects the verification key from a ring. |
| `subject` | `string` | Session/user identifier bound to the token. |

| `verifyCsrfToken` option (`CsrfVerifyOptions`) | Type | Description |
|---|---|---|
| `maxAgeMs` | `number` | Max token age in ms before it is treated as `expired` (default `3_600_000`). |
| `subject` | `string` | When set, the token's subject must match exactly, else `subject-mismatch`. |

The fourth argument is always the `CsrfVerifyOptions` object — pass `{ maxAgeMs }` to set the
freshness window. There is no bare-`number` shorthand.

### Key rotation — `importCsrfKeyRing`

`importCsrfKeyRing` imports multiple hex secrets into a `CsrfKeyRing`. The **first** secret becomes the
active signing key (`activeKeyId`); **all** secrets remain valid for verification. This lets you rotate
the signing secret without invalidating tokens minted under the previous one — add the new secret at
the front, deploy, and retire the old secret only after the longest token lifetime has elapsed.

```ts
const ring = await importCsrfKeyRing([env.CSRF_SECRET_NEW, env.CSRF_SECRET_OLD]);
const csrfGuard = csrfProtection({ secret: () => ring, subject: false });
```

### Honeypot — `isHoneypotFilled`

```ts
function isHoneypotFilled(formData: ReadonlyFormData, field?: string): boolean;
```

Returns `true` when the honeypot field has content — a signal the submitter is a bot, since the field
is hidden from human users. Returns `false` when the field is absent or empty.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `formData` | `ReadonlyFormData` | — | Parsed form data. |
| `field` | `string` | `HONEYPOT_FIELD_DEFAULT` (`"__surname"`) | The decoy field name to inspect. |

**A `defineAction` route does not call this.** It names `honeypot: CONTACT_DECOY`, and the pipeline
runs the check before the schema and drops the field because it checked it — so the schema never has
to declare a field no human fills. There is no default for that option and no shorthand: a name forge
could supply is a name every bot already knows to skip, in every deployment at once.

Hold the name as **one app-owned constant referenced twice** — by the view that renders the decoy and
by the action that checks it. Forgetting the action half is then a missing argument at the call site
rather than a form that silently stops being protected.

For a handler outside the pipeline, combine `isHoneypotFilled` with an early return so bot
submissions never reach business logic:

```ts
if (isHoneypotFilled(formData, CONTACT_DECOY)) return new Response("Bad request", { status: 400 });
```

#### Rendering the decoy — compose `<Honeypot />` explicitly

**`Form` does not render a honeypot.** It used to, unconditionally — including on `method="get"`,
where the browser serialises the decoy into the query string of every resulting URL, so `?__surname=`
leaked into the address bar, bookmarks, shared links, history, and the outbound `Referer`. It also
protects nothing there: `isHoneypotFilled` is only consulted by mutation handlers.

Render `Honeypot` from `@y-core/forge/ui/core` on the forms that submit mutations:

```tsx
import { Form, Honeypot } from "@y-core/forge/ui/core";

<Form method='post' csrfToken={token}>
  <Honeypot field={CONTACT_DECOY} />
  <input name='email' />
</Form>;
```

`Honeypot` takes an optional `field` defaulting to `HONEYPOT_FIELD_DEFAULT`. Pass the app's own
constant instead — the default is public, so it is the one name every bot already knows — and pass the
same constant to whatever checks it: `defineAction`'s `honeypot`, or `isHoneypotFilled`'s second
argument. The rendered markup carries no attribute naming the wrapper as a honeypot, for the same
reason the field name should not be forge's: an attribute nothing reads still identifies the decoy.

> **Migrating from ≤ 0.0.79.** Every `<Form method='post'>` needs a `<Honeypot />` child added.
> Nothing fails at build or at runtime if you forget — the form simply stops being protected.
> `Form`'s `honeypotField` prop was removed rather than deprecated so a form that *customised* the
> name becomes a type error instead of degrading silently.

### Turnstile — `verifyTurnstile`

```ts
function verifyTurnstile(
  formData: ReadonlyFormData,
  secretKey: string,
  options: TurnstileVerifyOptions,
): Promise<TurnstileResult>;
```

Verifies a Cloudflare Turnstile token against the siteverify API and returns a discriminated result.
The token field and the client IP live **inside** `options` (`tokenField` / `remoteIp`) — there are no
trailing positional arguments.

**A `defineAction` route does not call this either.** It names `turnstile: { secretKey, verify }`, and
the pipeline verifies the token and drops the token field in one step. `tokenField` is fixed when the
route is defined, because the field is dropped whether or not verification ever reaches the network,
while `secretKey` and `verify` resolve per request — a secret lives in a binding, and the hostname a
token must have been minted on is usually the request's own.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `formData` | `ReadonlyFormData` | — | Parsed form data carrying the Turnstile response. |
| `secretKey` | `string` | — | The Turnstile **secret** key (server-side; never the site key). |
| `options.expectedHostname` | `string` | — | **Required.** The siteverify hostname must match exactly, else `hostname-mismatch`. Prevents cross-site token replay. |
| `options.expectedAction` | `string` | — | When set, the verified action must match, else `action-mismatch`. |
| `options.expectedCData` | `string` | — | When set, the verified cdata must match, else `cdata-mismatch`. |
| `options.tokenField` | `string` | `TURNSTILE_FIELD_DEFAULT` | Form field holding the Turnstile response token — the field Cloudflare's widget writes. |
| `options.remoteIp` | `string` | — | Client IP forwarded to siteverify (e.g. the `CF-Connecting-IP` header). |
| `options.timeoutMs` | `number` | `5000` | Request timeout; clamped to a 1 ms minimum. A timed-out request returns `timeout`. |

```ts
const result = await verifyTurnstile(formData, env.TURNSTILE_SECRET_KEY, {
  expectedHostname: "example.com",
  expectedAction: "contact",
  remoteIp: context.request.headers.get("CF-Connecting-IP") ?? undefined,
});

if (!result.ok) {
  // result.error is one of: hostname-mismatch | action-mismatch | cdata-mismatch |
  //   missing-token | verification-failed | timeout | network-error | parse-error
  return new Response("Verification failed", { status: 403 });
}
```

`verifyTurnstile` returns `{ ok: false, error: "hostname-mismatch" }` immediately when
`expectedHostname` is omitted — the network call is never made.

### Constants & config

| Export | Value | Description |
|---|---|---|
| `CSRF_FIELD_DEFAULT` | `"_csrf"` | Default CSRF hidden-input field name. |
| `HONEYPOT_FIELD_DEFAULT` | `"__surname"` | Default honeypot field name. Prefer an app-owned name — this one is public. |
| `TURNSTILE_FIELD_DEFAULT` | `"cf-turnstile-response"` | The field Cloudflare's Turnstile widget writes its token into. |
| `FORM_MAX_BYTES_DEFAULT` | `102400` | Default max form body size (100 KB). |
| `CsrfConfigSchema` | valibot schema | Validates `{ secret }` as ≥32 hex characters. |
| `TurnstileConfigSchema` | valibot schema | Validates `{ secretKey, siteKey }`. |

### Types

| Type | Description |
|---|---|
| `ReadonlyFormData` | Read-only `FormData` view (`get`/`getAll`/`has`/iteration); what `parseFormData` resolves to and what every consumer of a parsed body accepts. |
| `ParseFormDataOptions` | `{ maxBytes? }` for `parseFormData`. |
| `FormToObjectOptions` | `{ drop? }` for `formToObject` — the field names a guard already consumed. |
| `CsrfKeyRing` | `{ activeKeyId, keys }` — active signing key plus all keys valid for verification. |
| `CsrfSecretResolver` | `(context) => CryptoKey \| CsrfKeyRing \| Promise<…>`. |
| `CsrfProtectionOptions` | `{ secret, tokenField?, headerName?, subject, maxBytes? }` — the `csrfProtection` middleware options (`subject` is required: resolver or `false`). |
| `CsrfTokenOptions` | `{ kid?, subject? }` for `createCsrfToken`. |
| `CsrfVerifyOptions` | `{ maxAgeMs?, subject? }` for `verifyCsrfToken`. |
| `CsrfResult` | `GuardResult<…>` — `{ ok: true } \| { ok: false, error }`; the failure reason code is in `.error`. See Security below. |
| `TurnstileVerifyOptions` | `{ expectedHostname, expectedAction?, expectedCData?, tokenField?, remoteIp?, timeoutMs? }`. |
| `TurnstileResult` | `GuardResult<…>` — `{ ok: true } \| { ok: false, error }`; the failure reason code is in `.error`. |

---

## Security

This namespace is security-critical. The notes below are load-bearing, not advisory.

### CSRF failure reasons are server-log-only

On failure, `verifyCsrfToken` returns a discriminated reason code in `.error`
(`missing-token`, `invalid-format`, `expired`, `future-timestamp`, `path-mismatch`,
`subject-mismatch`, `unknown-key`, `invalid-signature`). `CsrfResult` is a
`GuardResult` alias, so this reason lives in the single `error` field. It is for
**server diagnostics only** — `csrfProtection` deliberately collapses **every** failure
to a bare `403` with no body detail.

**Never surface `CsrfResult.error` to clients.** Echoing it back turns the endpoint into a
token-introspection oracle on unauthenticated input — an attacker can distinguish "wrong signature"
from "expired" from "wrong path" and probe accordingly. The same applies to `TurnstileResult.error`.

### Tokens are stateless and path-bound

CSRF tokens carry no server-side state; integrity rests entirely on the HMAC-SHA256 signature over
`kid | path | subject | timestamp | nonce`. A token is valid **only** for the exact path it was minted
for. Mint a separate token per action path (`mintCsrf(context, path)`) rather than reusing one across
routes. The signature is verified with `hmacVerify` (constant-time comparison), so verification does
not leak timing information about the expected signature.

### Bind tokens to a subject for authenticated flows

Pass `subject` to `csrfProtection` (or `createCsrfToken`/`verifyCsrfToken`) to bind a token to a
session or user id. A token minted for one subject then fails verification (`subject-mismatch`) if
replayed under another — defending against token-fixation across sessions.

### Rotate keys without downtime

Rotate signing secrets with `importCsrfKeyRing`: front-load the new secret (it becomes the active
signing key), keep the old one in the ring for verification, and retire it only after the maximum token
age has elapsed. Existing tokens stay valid throughout rotation.

### Always pin the Turnstile hostname

`expectedHostname` is mandatory and strongly load-bearing: without it, a Turnstile token solved on an
attacker's domain can be replayed against your endpoint. `verifyTurnstile` refuses to proceed
(returning `hostname-mismatch`) when it is omitted. Pin `expectedAction` as well so a token solved for
one widget cannot be reused on another action. Always pass the Turnstile **secret** key — never the
site key, which is public.

### Enforce the body-size cap

`parseFormData` caps body size both via `Content-Length` and a streaming counter, so a malicious
chunked request without a truthful `Content-Length` cannot exhaust memory. Surface the thrown
`{ status: 413 }` error as a `413` response; do not catch and ignore it. Lower `maxBytes` on routes
that accept only small text payloads. When raising it above the default, raise it on **both** the
route handler and any `csrfProtection` guard in front of it — the guard parses first, so a mismatch
rejects the request before the handler runs.

### Layered defense

CSRF, honeypot, and Turnstile are complementary — apply them together on high-risk routes, and pair
with the transport-layer guards in `@y-core/forge/security` (`crossOriginProtection`,
`requireFormContentType`, `rateLimit`). CSRF token verification lives **here**, in
`@y-core/forge/form`; the origin/Fetch-Metadata guards live in `@y-core/forge/security`. Use both —
neither subsumes the other.
