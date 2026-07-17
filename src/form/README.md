# `@y-core/forge/form`

Form submission handling for server-rendered apps on `@remix-run/fetch-router` + Cloudflare Workers:
byte-capped form-data parsing, field reading, **stateless CSRF protection**, **honeypot bot
detection**, and **Cloudflare Turnstile** verification. Each concern is a separate, independently
useful function — compose only what a route needs.

```ts
import {
  csrfProtection,
  importCsrfKey,
  mintCsrf,
  csrfTokenCtx,
  parseFormData,
  readFields,
  isHoneypotFilled,
  verifyTurnstile,
} from "@y-core/forge/form";
```

---

## Features

- **Byte-capped form parsing** — `parseFormData` enforces a body-size budget via a `Content-Length`
  fast-path **and** a streaming counting transform, closing the chunked-transfer bypass. The parse is
  memoized per `Request`, so CSRF verification and the action handler share a single body read.
- **Field reading** — `readTextField` / `readFields` normalise CRLF to LF and trim, returning `""`
  for absent or non-string (file) fields.
- **Stateless CSRF** — HMAC-SHA256 tokens bound to a request **path** and an optional **subject**,
  with **key-ring rotation** and a 30s clock-skew tolerance. No server-side token store.
- **CSRF middleware** — `csrfProtection` pre-mints a token on `GET`/`HEAD` and verifies it on every
  mutation, collapsing **every** failure to a bare `403`.
- **Honeypot detection** — `isHoneypotFilled` flags submissions that filled an invisible decoy field.
- **Turnstile verification** — `verifyTurnstile` calls the Cloudflare siteverify API with mandatory
  hostname pinning plus optional action/cdata pinning and a request timeout.

---

## Usage

A complete contact-form flow: middleware verifies CSRF, the page handler mints a token for its form,
and the action handler parses, filters bots, reads fields, and verifies Turnstile.

```ts
import {
  csrfProtection,
  importCsrfKey,
  csrfTokenCtx,
  parseFormData,
  readFields,
  isHoneypotFilled,
  verifyTurnstile,
} from "@y-core/forge/form";
import { getAppContext } from "@y-core/forge/context";

// 1. CSRF middleware — the secret is resolved lazily from the request context.
//    On GET/HEAD it pre-mints a token bound to the current path; on POST it verifies.
const csrfGuard = csrfProtection({
  secret: (context) => importCsrfKey(getAppContext(context).env.CSRF_SECRET),
});

// 2. Page handler (GET /contact) — read the pre-minted token bound to the current path
//    and stamp it into the form's hidden `_csrf` input.
function contactPage(context) {
  const token = csrfTokenCtx.get(context);
  return renderPage(<ContactForm csrfToken={token} />);
}

// 3. Action handler (POST /contact) — runs only after csrfGuard verified the token.
async function contactAction(context) {
  const formData = await parseFormData(context);

  // Reject obvious bots before any work.
  if (isHoneypotFilled(formData)) {
    return new Response("Bad request", { status: 400 });
  }

  // Verify the Turnstile challenge response.
  const env = getAppContext(context).env;
  const turnstile = await verifyTurnstile(formData, env.TURNSTILE_SECRET_KEY, {
    expectedHostname: "example.com",
    expectedAction: "contact",
  });
  if (!turnstile.ok) {
    return new Response("Verification failed", { status: 403 });
  }

  const { name, email, message } = readFields(formData, ["name", "email", "message"]);
  await sendEmail({ name, email, message });
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

### Field reading — `readTextField`, `readFields`

```ts
function readTextField(formData: ReadonlyFormData, field: string): string;
function readFields<K extends string>(formData: ReadonlyFormData, fields: K[]): Record<K, string>;
```

`readTextField` returns the field value with `\r\n` normalised to `\n` and surrounding whitespace
trimmed. It returns `""` when the field is absent or is a `File` (non-string) value — never `null` or
`undefined`. `readFields` applies `readTextField` across a list of names and returns a record keyed by
those names.

```ts
const { name, email } = readFields(formData, ["name", "email"]); // Record<"name" | "email", string>
```

### CSRF middleware — `csrfProtection`

```ts
function csrfProtection(options: CsrfProtectionOptions): Middleware;

interface CsrfProtectionOptions {
  secret: (context: RequestContext) => CryptoKey | CsrfKeyRing | Promise<CryptoKey | CsrfKeyRing>;
  tokenField?: string;
  headerName?: string;
  subject: ((context: RequestContext) => string | undefined) | false;
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

Behaviour by method:

- **`GET` / `HEAD`** — sets the per-request minter (`csrfMinterCtx`) and pre-mints a token bound to
  `context.url.pathname`, exposed via `csrfTokenCtx`. Then calls `next()`.
- **Mutations (`POST`, etc.)** — reads the token from the `headerName` header, falling back to the
  `tokenField` form field, and verifies it against the current pathname (and `subject`, if configured).
  On **any** failure it short-circuits with a bare `403` `Response` and never calls `next()`.

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

### CSRF context accessors — `csrfTokenCtx`, `csrfMinterCtx`

```ts
const csrfTokenCtx: ContextVar<string>;
const csrfMinterCtx: ContextVar<(path: string) => Promise<string>>;
```

`csrfTokenCtx.get(context)` returns the pre-minted token bound to the **current request's pathname**,
set by `csrfProtection` on `GET`/`HEAD`. Use it only when the form POSTs back to the same path —
otherwise verification fails with `path-mismatch`. `csrfMinterCtx` holds the underlying minter function
and is normally accessed indirectly through `mintCsrf`.

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
const csrfGuard = csrfProtection({ secret: () => ring });
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

Combine with an early return so bot submissions never reach business logic:

```ts
if (isHoneypotFilled(formData)) return new Response("Bad request", { status: 400 });
```

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

| Parameter | Type | Default | Description |
|---|---|---|---|
| `formData` | `ReadonlyFormData` | — | Parsed form data carrying the Turnstile response. |
| `secretKey` | `string` | — | The Turnstile **secret** key (server-side; never the site key). |
| `options.expectedHostname` | `string` | — | **Required.** The siteverify hostname must match exactly, else `hostname-mismatch`. Prevents cross-site token replay. |
| `options.expectedAction` | `string` | — | When set, the verified action must match, else `action-mismatch`. |
| `options.expectedCData` | `string` | — | When set, the verified cdata must match, else `cdata-mismatch`. |
| `options.tokenField` | `string` | `"cf-turnstile-response"` | Form field holding the Turnstile response token. |
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
| `HONEYPOT_FIELD_DEFAULT` | `"__surname"` | Default honeypot field name. |
| `FORM_MAX_BYTES_DEFAULT` | `102400` | Default max form body size (100 KB). |
| `CsrfConfigSchema` | valibot schema | Validates `{ secret }` as ≥32 hex characters. |
| `TurnstileConfigSchema` | valibot schema | Validates `{ secretKey, siteKey }`. |

### Types

| Type | Description |
|---|---|
| `ReadonlyFormData` | Read-only `FormData` view (`get`/`getAll`/`has`/iteration); the shape every reader accepts. |
| `ParseFormDataOptions` | `{ maxBytes? }` for `parseFormData`. |
| `FormFieldReader` | `(formData, field) => string` — the shape of `readTextField`. |
| `CsrfKeyRing` | `{ activeKeyId, keys }` — active signing key plus all keys valid for verification. |
| `CsrfSecretResolver` | `(context) => CryptoKey \| CsrfKeyRing \| Promise<…>`. |
| `CsrfProtectionOptions` | `{ secret, tokenField?, headerName?, subject }` — the `csrfProtection` middleware options (`subject` is required: resolver or `false`). |
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
that accept only small text payloads.

### Layered defense

CSRF, honeypot, and Turnstile are complementary — apply them together on high-risk routes, and pair
with the transport-layer guards in `@y-core/forge/security` (`crossOriginProtection`,
`requireFormContentType`, `rateLimit`). CSRF token verification lives **here**, in
`@y-core/forge/form`; the origin/Fetch-Metadata guards live in `@y-core/forge/security`. Use both —
neither subsumes the other.
