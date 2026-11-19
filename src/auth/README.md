---
title: Identity and Credentials
description: "The identity domain and the tiers over it: key rings, the AES-GCM token codec, stores, factors and ceremonies; the mountable routes, guards and views; and the browser passkey controller."
audience: consumer
---

# `@y-core/forge/auth`

Identity for a Workers app: who a visitor is, which credential proves it, and what their session may then do. Sign-in, passkeys, an authenticator
app, address changes and an administrative console are all here — a domain you can call directly, and a set of pages you can mount over it.

Which subpath you reach for is decided by what you are building:

| Subpath | Reach for it when you are… |
| --- | --- |
| `@y-core/forge/auth` | calling the domain — key rings, stores, factors, flows. It builds no `Response`, touches no `Session`, renders nothing |
| `@y-core/forge/auth/web` | mounting pages, guarding routes, or replacing forge's markup |
| `@y-core/forge/auth/client` | bundling the browser half of the passkey ceremony or of `signoutClearsSiteData` — a side-effect import, and `onPasskeyPrf` for a page that derives a key from a passkey |

The edge is one-way — `auth/web` imports `auth`, and `auth` never names `auth/web` ([`NAMESPACES.md`][namespaces-5h] §5h).

**Standing the capability up is [`AUTH_MOUNTING.md`][am]** — the one order that works (§1), the route groups and their guards (§2) and the
seams you supply (§3).
**What each flow then does is [`AUTH_FLOWS.md`][af].** This README teaches the calls.

---

## Getting started

Everything the auth pages run against is built **per request** — a passkey ceremony is bound to this request's session, and every store needs a
binding off `c.env`. That builder is the one function you write:

```ts
import {
  AuthStoreError,
  createAdminUserStore,
  createAuthSessionStore,
  createCredentialStore,
  createEmailChangeFlow,
  createEmailOtpFactor,
  createFactorRegistry,
  createFactorStore,
  createNonceStore,
  createOtpStateStore,
  createSecurityNotices,
  createSigninFlow,
  createSignupFlow,
  createUserStore,
  importAuthKeyRing,
  resolveAuthServices,
} from "@y-core/forge/auth";
import type { AuthRequestServices } from "@y-core/forge/auth/web";
import type { AppContext } from "@y-core/forge/context";
import { err, ok } from "@y-core/forge/result";
import { createD1Client } from "@y-core/forge/storage/db";

// Module scope: the ring is resolved once per isolate, not once per request.
const authOptions = { ring: (c: AppContext<Env>) => importAuthKeyRing([c.env.AUTH_SECRET]) };

// One builder for every session store, so the guards and the pages hold the same lifetime and idle bound.
const sessionStore = (c: AppContext<Env>) => createAuthSessionStore(createD1Client(c.env.DB));

async function resolveServices(c: AppContext<Env>): Promise<AuthRequestServices> {
  const { keys } = await resolveAuthServices(c, authOptions);
  const db = createD1Client(c.env.DB);
  const users = createUserStore(db);
  const enrolments = createFactorStore(db);
  const state = createOtpStateStore(db);
  const nonces = createNonceStore(db);
  const defer = (work: Promise<unknown>) => c.executionCtx.waitUntil(work);

  const emailOtp = createEmailOtpFactor({
    keys,
    state,
    nonces,
    notifier,
    address: async (userId) => {
      const found = await users.findById(userId);
      if (!found.ok) return found;
      return found.data ? ok(found.data.email) : err(new AuthStoreError("unavailable", "address"));
    },
  });
  const factors = createFactorRegistry(enrolments, { primary: emailOtp });

  return {
    users,
    sessions: sessionStore(c),
    credentials: createCredentialStore(db),
    enrolments,
    factors,
    signin: createSigninFlow({ keys, users, state, nonces, factors, defer }),
    signup: createSignupFlow({ users, factors, defer }),
    emailChange: createEmailChangeFlow({ keys, users, nonces, notifier, defer, confirmUrl: (token) => `${c.env.ORIGIN}/email/confirm?t=${token}` }),
    notices: createSecurityNotices({ notifier, defer }),
    admin: createAdminUserStore(db),
  };
}
```

Hand that to `AuthWebOptions.resolveServices` and mount the route builders as [`AUTH_MOUNTING.md`][am-1] §1 lays them out.
`resolveServices` is called **once per request** however many guards, loaders and actions ask for it, so building every store inside it costs one
build.

The seams above with no default and no way to guess them are `notifier` (next section), `defer` and `address`. `defer` must be
`executionCtx.waitUntil` or an equivalent, never inline.

**Build one `FactorStore` and hand it to everything that asks for one**: `createFactorRegistry`, the `enrolments` you return, and the `factors`
option of the passkey, authenticator-app and recovery-code factors. The account pages and redirects that weigh all of a user's factors at once
read them from `enrolments` in one read, not from each service's `listEnrolments`, so a custom factor service whose rows live in a store of its
own shows there as not enrolled.

**Hand the same `sessionStore` to the guards**, as `createAuthGuards`' `auth.sessions`. The store `resolveServices` returns sets a new session's
expiry, and the one the guards resolve decides whether a request is still signed in, so building both from one function is what keeps a lifetime
you configure in force everywhere. To shorten the bounds, pass them there once —
`createAuthSessionStore(createD1Client(c.env.DB), { absoluteLifetimeMs, idleTimeoutMs })`; which values reach AAL2 is
[`AUTH_MOUNTING.md`][am-5] §5.

**Back the session with `storage: "cookie"`.** A signed-in identity lives in D1, in the row `sessions` writes at sign-in, so the session only
carries that row's token beside the visitor's own state, and an anonymous visitor writes nothing anywhere. KV storage still works. Give the
cookie a `maxAge` of at least the session's absolute lifetime, because an idle touch does not rewrite it ([`AUTH_MOUNTING.md`][am-1] §1).

**`resolveAuthServices` throws rather than returning a `Result`**: resolving a binding throws, and operating on a resolved store answers a
`Result` ([`FORGE_ERRORS.md`][eh-5e] §5e).

---

## Choosing which factors a deployment offers

The emailed code is the way in, and is all `primary` takes. `second` is the policy: which second factors a user may enrol, whether each one is
mandatory or optional, and the recovery codes beside them. A deployment that signs in by emailed code, makes everyone hold an authenticator
app, and lets them add passkeys as well looks like this:

```ts
const factors = createFactorRegistry(enrolments, {
  primary: emailOtp,
  second: {
    offered: [
      { service: totpApp, requirement: "mandatory" },
      { service: passkey, requirement: "optional" },
    ],
    recovery: recoveryCodes,
  },
});
```

**Each `requirement` is the choice you are making: what the deployment demands of every user for that second factor.** `"mandatory"`
demands that every user hold that kind, and enrol it before they reach anything else; `"optional"` demands nothing, lets them add it if they want
it, and asks for it at sign-in once they have. There is no "any one of these" and no
per-role requirement — [`AUTH_FLOWS.md`][af-2a] §2a is the ruling. Consequences worth knowing before you pick:

- **A mandatory factor cannot be removed once it is the user's last of its kind.** The `totp` page offers replacing the app in place instead,
  and the `passkeys` page asks for another passkey first ([`AUTH_FLOWS.md`][af-3c] §3c). An optional factor can always be removed.
- **Optional factors are added from the account pages**, so mount `accountRoutes`. Only a mandatory factor sends anyone to the enrolment pages.
- **`offered` order is the order owed factors are enrolled in**, and the listing order on the verify page and the account pages. Two
  mandatory kinds are enrolled one after the other, never chosen between.
- **Sign-up tells the visitor a second factor follows** wherever any offered factor is mandatory.
- **`recovery` is not optional.** A lost device would otherwise lock its users out ([`AUTH_FLOWS.md`][af-9c] §9c).

Leave `second` out and the deployment has no second factor: every sign-in is the emailed code alone. Offering a passkey or an authenticator app
as `primary` is a type error, and `createFactorRegistry` refuses it at construction for a caller casting past the type.

Each shipped factor is built per request alongside the stores. The email-OTP, passkey and authenticator-app factors each take one seam that is a
`UserStore` read and is easy to miss: `EmailOtpOptions.address`, `PasskeyFactorOptions.subject`, `TotpAppFactorOptions.account`. The passkey factor
additionally takes **this request's session id**, which is what its challenge is bound to — a registry built once at bootstrap issues challenges
bound to nobody.

The recovery-code factor takes the factor store and a code store of its own instead:

```ts
import { createRecoveryCodeFactor, createRecoveryCodeStore } from "@y-core/forge/auth";

const recoveryCodes = createRecoveryCodeFactor({ factors: enrolments, codes: createRecoveryCodeStore(db) });
```

Every numeric knob on a factor's options is optional, and each is bounded at construction with a message naming the bound it broke. Omit one
for the matching `AUTH_*` constant.

---

## Delivering the codes and links forge does not send

Forge ships the delivery contract and **no mailer**. Nothing is emailed until you implement one method:

```ts
import { AuthStoreError, type AuthMessage, type AuthNotifier, type AuthStoreResult } from "@y-core/forge/auth";
import { err, ok } from "@y-core/forge/result";

function mailFor(message: AuthMessage): Mail {
  switch (message.kind) {
    case "otp":
      return codeMail(message.code, message.expiresAt);
    case "email-change":
      return linkMail(message.url, message.expiresAt);
    case "security-event":
      return noticeMail(message.notice.type, message.notice.factorKind, message.notice.at);
  }
}

const notifier: AuthNotifier = {
  async send(message: AuthMessage, signal: AbortSignal): Promise<AuthStoreResult<void>> {
    const delivered = await myMailer(message.to, mailFor(message), signal);
    return delivered ? ok() : err(new AuthStoreError("unavailable", "notifier.send"));
  },
};
```

**Switch on `message.kind` before reading a field.** A code carries `code`, an address change `url`, and a security notice `notice` — which change
happened, the factor it touched, and when — with no expiry. Write the notice as "this happened to your account; if it was not you, act", because
it is sent after the change, never to approve one. Which changes send one, and to which address, is [`AUTH_FLOWS.md`][af-7] §7.

**Key your notice copy by `AuthNotifiedEventType`, so a notice type you have not written fails to compile.** A forge release that adds one —
`factor-replaced`, for a replaced authenticator app — then breaks your build instead of mailing a blank:

```ts
import type { AuthNotifiedEventType } from "@y-core/forge/auth";

const NOTICE_SUBJECTS: Record<AuthNotifiedEventType, string> = {
  "factor-replaced": "Your authenticator app was replaced",
  // …one entry for every other member of the union
};
```

Return `ok()` on success — not `undefined` — and `err(new AuthStoreError("unavailable", "notifier.send"))` on failure. For a code or a link, the
flows read **any** failure as unavailable and refuse the attempt; for a notice, the failure is logged as `auth.security-notice.failed` and the
change it reports stands.

**A code nobody could receive costs no cooldown.** When `send` fails, the email-OTP factor rolls the claimed cooldown back.

Forge aborts `signal` once its delivery deadline passes, and a `send` that rejects is read like one that returns an error, so the cooldown is
still rolled back. **Watch `auth.email-otp.deliver.failed`:** the factor logs it at `error`, with what `send` answered, whenever a code could
not be delivered, and nobody else sees that failure — sign-in and sign-up send their codes after the response. Every store failure the factor
meets is logged the same way, as `auth.email-otp.<step>.failed`, and a flow's own deferred failure as
`auth.signin.issue.failed` or `auth.signup.issue.failed`. Pass `logger` to `createEmailOtpFactor` and to each flow's options to choose where
those records go, or leave it out for the console.

---

## Signing a visitor in without forge's pages

The flows are callable on their own, and `auth/web`'s actions are thin wrappers over exactly these calls. Sign-in is two requests: a request that
defers the issue, and a completion.

```ts
const caller = { binding: browserBinding(session), keep: null }; // the same browser must present the same binding
const challenge = services.signin.request(email, Date.now(), caller); // returns immediately; the code is deferred
// …later, with what the visitor typed:
const outcome = await services.signin.complete(email, code, Date.now(), caller);
if (!outcome.ok) return page(redactSigninReason(outcome.error));
switch (outcome.data.resolution.status) {
  case "enrolment-required": {
    const { kinds, stepUpKinds } = outcome.data.resolution;
    return redirect(stepUpKinds.length > 0 ? verifyPath : enrolmentPageFor(kinds));
  }
  case "step-up-required":
    return redirect(verifyPath);
  default:
    return establish(outcome.data.user);
}
```

**Every call that issues or checks an emailed code takes `caller`, an `AuthFactorCaller`.** Its `binding` is a value only this browser holds —
mint 32 random bytes once, keep them base64url-encoded in the visitor's session, and pass the same string on every call from that browser. The
code is bound to it, so a code typed into any other browser does not match. A `null` binding issues nothing and verifies nothing. `keep` is the
SHA-256 of the signed-in session's token, which a factor change spares when it signs other sessions out; it is `null` before sign-in.

**`request` returns synchronously, and its unknown-address branch spends the same statements the known one spends.** That is why
`AuthSigninOptions` takes `state` and `nonces` as well as the factors: they are the decoy's stores.

**A resolution that is not `satisfied` is a success, not a refusal** — a page to visit rather than a 4xx, and [`AUTH_FLOWS.md`][af-2c] §2c is
where each one sends the visitor. **An `enrolment-required` with a non-empty `stepUpKinds` goes to step-up first**, or a mailbox alone is enough to
enrol ([`AUTH_FLOWS.md`][af-9b] §9b). `requestStepUp` and `stepUp` run the second factor for a session that is already signed in.

**Pass every sign-in refusal through `redactSigninReason` before it reaches a page.** It folds `AuthSigninReason` into the notices a
visitor may be shown; the unredacted reason is for your logs and your branching ([`AUTH_FLOWS.md`][af-2b] §2b, [`FORGE_ERRORS.md`][eh-1c] §1c).
No other reason has a redactor; see [Security](#security).

Signup is one call — `services.signup.request(email, at, caller)` — and answers the same `AuthFlowChallenge` whether the address is new or already
registered ([`AUTH_FLOWS.md`][af-1] §1).

---

## Completing an address change from your own route

Forge mounts every auth route except this one: the confirmation URL is yours, so its handlers are too. Build the link with
`AuthEmailChangeOptions.confirmUrl`, then answer it in two requests — **a `GET` that calls `inspect` and renders `EmailChangeConfirmView`, and a
`POST` from that form that calls `confirm`**:

```tsx
// GET /email/confirm?t=…
const token = c.url.searchParams.get("t") ?? "";
const link = await services.emailChange.inspect(token, Date.now());
if (!link.ok) return refusalPage(link.error);
return confirmPage(
  <EmailChangeConfirmView {...link.data} token={token} submitPath='/email/confirm' csrfToken={await mintCsrf(c, "/email/confirm")} />,
);

// POST /email/confirm
const form = await parseFormData(c);
const outcome = await services.emailChange.confirm(String(form.get("token") ?? ""), Date.now());
if (!outcome.ok) return outcome.error instanceof AuthStoreError ? unavailablePage() : refusalPage(outcome.error);
if (outcome.data.status === "forwarded") return checkInboxPage(outcome.data.sentTo);
return changedPage(outcome.data.user);
```

**Never call `confirm` from the `GET`.** A mail client's link scanner opens the link before its owner does, and whichever request calls
`confirm` is the one that moves the account; `inspect` reads the link and writes nothing ([`AUTH_FLOWS.md`][af-5] §5).

The **error** channel is a union of a reason string and a class, so the two arms are told apart with `instanceof` rather than by value. The
**success** value is discriminated on `status`, and a `forwarded` page has to say a step is left — [`AUTH_FLOWS.md`][af-5] §5 owns both stages,
and why a completed move signs every session out.

On the request side, render `AuthEmailChangeRequest.sentTo` and never the address the visitor typed: which address was mailed
depends on whether the account's own is verified.

`EmailChangeConfirmView` is the form alone, and `resolveAuthView` does not reach it — it is no `AuthViewName`. Render it, and the refusal and
outcome pages, through the same document shell the auth pages use ([`ROUTING_AND_MIDDLEWARE.md`][ram-6] §6).

---

## Managing accounts from an admin page

Hand `resolveServices` an **`AdminUserStore`** as its `admin`. Forge builds the `AdminUserService` over it, per request — the read-and-write
surface the admin routes hold. The service is forge's, not yours to substitute.

**`UserStore` and `AdminUserStore` are two contracts.** A sign-in service given a `UserStore` cannot delete a user or set the admin flag, because
neither method is on the type it was given. Build the administrative one only where an administrative route needs it.

Every write answers an `AdminUserOutcome` rather than a boolean, so a refusal says which guard fired; `isLastAdminRefusal(outcome)` groups the
last-admin refusals. What each refusal means to a visitor, the
prefix-only search, and the first-admin bootstrap are [`AUTH_FLOWS.md`][af-6] §6.

**The first-admin claim needs an administrator approval, and both halves answer 404 without one.** Setting it up is the next section.

**Deactivation takes effect on the next request, not the next sign-in.** Deactivating deletes every session the user holds, and
`resolveAuthIdentity` refuses a deactivated owner besides — so reactivating the account revives none of them, and the visitor signs in again. A
store outage denies without signing anyone out.

**An account a key of yours blocks is not removed.** Where an app table's key to `auth_users` is neither `ON DELETE CASCADE` nor
`ON DELETE SET NULL` on a column that can hold `NULL`, `remove` answers `referenced` and deletes nothing — the account's factors and credentials
included — and the admin page shows it as a 409 refusal. The migration lint refuses that key
([Applying the auth schema to your database](#applying-the-auth-schema-to-your-database)); for one already in your database, delete or transfer
the rows that reference the user, or change the key, then call `remove`.

---

## Requiring administrator approval on a route

An approval holds a route until the visitor's session has presented a code you configured, such as an administrator code kept as a Worker
secret. Define one per deployment at module scope, then hand that same value to every place that uses it:

```ts
import { createAuthGuards, defineApproval, registerApproval, requireApproval } from "@y-core/forge/auth/web";
import { importKeyRing, parseKeyRingSecrets } from "@y-core/forge/crypto/keyring";

const approval = defineApproval<Env>({
  path: "/approve",
  code: (c) => c.env.ADMIN_APPROVAL_CODE,
  origin: { allowedOrigins: ["https://app.example"] },
  rateLimit: { limiter: (c) => c.env.APPROVAL_LIMITER, trustCfHeaders: true },
  ring: (c) => importKeyRing(parseKeyRingSecrets(c.env.CSRF_SECRET)),
});

registerApproval(app, approval);
app.use("/reports/*", requireApproval(approval));
const groups = createAuthGuards<Env>({ ...guardOptions, approval });
```

**`registerApproval` mounts the prompt page.** Without it, `requireApproval` sends visitors to a path that answers nothing. Mount it after the
session middleware, as you would any route that writes the session. A correct code sends the visitor back to the page they were stopped on.

**Read `code` off `c.env` on every request.** If it returns `undefined` or `""`, every approved route and the prompt itself answer 404. A
deployment that has no code configured therefore has no approved routes, rather than open ones. Changing the code ends every approval granted
under the old one: the session holds a digest of the code signed with `ring`, never the code itself.

**Passing `approval` to `createAuthGuards` is what turns the first-admin claim on.** The `admin.elevate` group ends with `require-approval`, so the
visitor presents the code and then confirms the claim. If you leave `approval` out, a signed-in visitor gets 404 from both elevate routes.
`createAdminElevateActions` and `loadAdminElevate` also answer 404 on a route you mount yourself unless `requireApproval` runs ahead of them. Any
group of your own can also list `require-approval`, and it does not need `require-auth` before it.

**Decide the window and the bot defence when you define the approval.** `ttlMs` is how long a presented code holds; leave it out and the window is
`APPROVAL_TTL_MS`. `rateLimit` is required, because the prompt is open to anyone and answers guesses at a shared code; forge picks no numbers. Pass
`turnstile: {}` to challenge it: it reads its keys and pins its token as `AuthWebOptions.turnstile` does, and takes the same `keys` and `verify`
overrides, but no `flows`. `view` replaces the prompt's
markup with your own component, which receives `ApprovalViewProps`.

**A route that answers JSON gets a 403 instead of a redirect.** Pass `requireApproval(approval, { medium: "json" })` for it.

**Signing in or out clears the approval.** A visitor who presented the code before signing in is asked for it again afterwards
([`AUTH_FLOWS.md`][af-6] §6).

**List `require-auth` ahead of `require-approval` where a revoked sign-in must end the approval too.** An approval rides the session rather
than the sign-in, so on a group without `require-auth` it holds until `ttlMs` runs out ([`AUTH_FLOWS.md`][af-6] §6).

---

## Guarding a route you wrote yourself

`createAuthGuards` builds the stack for every group in one call and is what a mount uses (`AUTH_ROUTE_GROUPS` is the table it cuts them from, and
[`AUTH_MOUNTING.md`][am-2] §2 says why each group is guarded as it is). The guard primitives are exported for a page you route yourself:

| Guard | Admits |
| --- | --- |
| `resolveAuth` | Everyone. It establishes the identity where the session carries one and refuses nothing — including a session that still owes a step-up |
| `requireAuth` | A signed-in, non-deactivated visitor who owes no step-up, including one owed before an enrolment. It is what puts the identity on `authCtx` |
| `requireAdmin` | An administrator. Anyone else gets a plain 403 unless you pass `onForbidden`, and it throws if `requireAuth` did not run first |
| `requireEnrolment` | A visitor who owes no factor. An owed enrolment or step-up is a redirect; an unreadable factor store is a 503 |
| `requirePendingEnrolment` | **Only** a visitor who owes an enrolment, so an owed step-up cannot be enrolled around — nor a held recovery code skipped |
| `requireFreshStepUp` | Every safe method, and a state-changing one only behind a recent step-up, whether or not the user holds a second factor |

Order is the contract: every guard below `requireAuth` in that table reads the identity it establishes, so a wrong order fails on the first
request rather than at construction.

**Answer a non-administrator with a page by passing `onForbidden`.** On your own route, hand it to the guard:

```ts
requireAdmin({ onForbidden: (c) => htmlResponse(renderAdminOnlyPage(c), 403) });
```

On a mount, pass it as `onForbidden` to `createAuthGuards`. The admin pages and their actions re-check the role themselves and answer with the same
function, or with the plain 403 where none was passed.

Read the identity through `authCtx` — `authCtx.get(c)` where a guard has run, `authCtx.getOptional(c)` otherwise. The store is read once per
request however many guards run, so mounting `resolveAuth` globally costs the guarded routes nothing extra.

**`resolveAuth` is not a gate, and an identity on `authCtx` is not a finished sign-in.** A visitor who proved one factor of two carries a full
identity while the step-up is still owed. Anything that renders member data must be behind `requireAuth`; use `resolveAuth` for a nav that greets
a visitor by name, or a page whose anonymous and signed-in renders differ. A page mixing the two needs `requireAuth` on the half that is not
public, or its own check of `authCtx.get(c).stepUpAt`.

**`requireFreshStepUp` is on unless you turn it off**, and `freshStepUpMaxAgeMs` is its window: omit it for `AUTH_FRESH_STEP_UP_MS`, or pass
`null`, which is the only opt-out. A user holding no second factor is held to it too, and re-proves with an emailed code from the verify page; the
code that signed them in counts as that proof for the window. Recovery codes are issued against the same window, and under `null` still need a
step-up in the session ([`AUTH_FLOWS.md`][af-9c] §9c).

**A guard refuses in the medium its group answers in.** Pass `medium: "json"` and `requireAuth` answers `401 {"error": …}` and the enrolment
guards `403 {"error": …}` instead of redirecting — which is what a browser controller posting a ceremony step can actually read.

**An htmx request is redirected by navigation, not by a 3xx.** Every redirect auth sends answers an htmx request with a 204 carrying
`HX-Redirect`: a refusal from `requireAuth`, `requireEnrolment`, `requirePendingEnrolment` or `requireFreshStepUp`, an auth page sending an
anonymous visitor to sign-in, the verify page sending on a visitor who owes an enrolment, and an auth action's redirect such as the users list
after an admin remove. htmx then loads that page and updates the address bar, instead of swapping the page into the target. A request without
htmx still gets its 3xx, so your htmx forms and links need nothing extra.

**After sign-in, `requireAuth` returns the visitor to the page they were on.** It records that page in the sign-in URL's `next` parameter, or
the name you pass as `returnParam`:

- An htmx request records the page named by its `HX-Current-URL` header, whatever its method, so a visitor whose session expired mid-save lands
  back on the page holding the form. A header on another origin, or no header, records nothing.
- A request without htmx records its own URL when it is a GET or HEAD, and nothing otherwise, because a POST's URL has no page to return to.

**`resolveAuth` and `requireAuth` take `sessions`, a per-request resolver for the session store.** An anonymous request never calls it, so a
page view with no one signed in reads nothing from D1.

Between requests, a sign-in is written in one place per fact: `establishAuthSession`, `markAuthStepUp`, `revokeOtherAuthSessions`,
`clearAuthSession`, and `markAuthSigninPending` / `resolveAuthSigninPending`. Each of the first four writes to D1 and answers an
`AuthStoreResult`; on a failure the session is left as it was, so answer 503 and let the visitor retry.

---

## Issuing API tokens and guarding an API with them

A personal access token lets a script or another service call your API as one of your users. Build the service per request, over the store's D1
adapter:

```ts
import { createAccessTokenService, createAccessTokenStore } from "@y-core/forge/auth";

const tokensFor = (c: AppContext<Env>) =>
  createAccessTokenService({
    store: createAccessTokenStore(createD1Client(c.env.DB)),
    prefix: "nt_",
    scopes: ["notes:read", "notes:write"],
  });
```

The scope list is typed from the literal you pass, so a scope you never configured is a compile error wherever the service or its guard is
asked for one. `prefix` is what a secret scanner keys on: a lowercase letter, then letters or digits, then one underscore. **Every token
expires**: `maxLifetimeMs` defaults to `AUTH_ACCESS_TOKEN_MAX_LIFETIME_MS`, and passing `null` is the only way to admit a token that never does.

**Show the token once.** `issue` answers the plaintext and the stored record together, and only the SHA-256 of the plaintext is kept, so a
token the user did not copy is gone and they issue another:

```ts
const now = Date.now();
const issued = await tokensFor(c).issue({ userId, label: "Laptop CLI", scopes: ["notes:read"], expiresAt: now + 90 * 86_400_000 }, now);
// issued.data.token is the plaintext — render it on this response and never again.
```

A refusal is an `AccessTokenIssueReason`, or the store's `AuthStoreError`. An `expiresAt` must fall in `(now, now + maxLifetimeMs]`.

`list(userId)` answers the user's tokens for a settings page, and `revoke(id, userId, at)` carries the owner, so a token id belonging to somebody
else revokes nothing.

**Guard the API routes with `requireBearer`, and read the token off `accessTokenCtx`:**

```ts
import { accessTokenCtx, requireBearer } from "@y-core/forge/auth/web";

app.use("/api/*", requireBearer({ tokens: tokensFor, scopes: ["notes:read"] }));
// …in a handler:
const { userId, id } = accessTokenCtx.get(c);
```

It reads the `Authorization` header and nothing else — a session cookie or an `?access_token=` query parameter is not a credential here — and
every listed scope must be held. The refusals follow RFC 6750:

| Request | Status | `WWW-Authenticate` |
| --- | --- | --- |
| No `Bearer` credentials | 401 | `Bearer` |
| A token that is malformed, fails its checksum, is unknown, revoked or expired | 401 | `Bearer error="invalid_token"` |
| A valid token missing a scope | 403 | `Bearer error="insufficient_scope", scope="…"` |
| The store cannot be read | 503 | none |

**Rate-limit by token, after the guard.** Mount `rateLimit` from `@y-core/forge/security` behind `requireBearer` with `app.use`, keyed on the
token it admitted:

```ts
app.use("/api/*", requireBearer({ tokens: tokensFor, scopes: ["notes:read"] }));
app.use("/api/*", rateLimit<Env>({ limiter: (c) => c.env.API_LIMITER, key: (c) => accessTokenCtx.get(c).id }));
```

A guard group's own `rateLimit` cannot do this: it runs before the group's guards, when no token has been admitted yet.

**Restrict a token to some of your own records in your own table**, keyed by the token's `id` — a notebook allowlist, say. Forge's table holds
only what verifying the token needs.

**A token is `{prefix}{secret}{checksum}`.** The secret is 24 random bytes in base32, and the checksum is the base32 of the big-endian CRC-32 of
everything before it. A scanner matches the prefix followed by 46 characters of the RFC 4648 base32 alphabet, and confirms a hit offline by
recomputing the CRC over all but the last seven characters, without ever calling you.

**There is no timing-safe compare, and none is missing.** The lookup key is the SHA-256 of a 192-bit secret, so timing the index tells an attacker
nothing about any token they do not already hold.

**A deactivated owner's tokens stop verifying at once** and verify again on reactivation; deleting the user removes their tokens in the same batch.

---

## Showing a navbar that knows who is signed in

`authNav` answers what a per-request navbar needs — the filter tokens this viewer holds, and a sign-out control carrying a token bound
to their session — shaped to spread straight onto `Navbar`:

```tsx
const nav = authNav({ signoutPath: paths.auth.signout(), ring: (c) => importKeyRing(parseKeyRingSecrets(config(c).csrf.secret)) });
// …per request, in the layout:
<Navbar config={primaryNav} resolveHref={resolveNavHref} icon={AppIcon} {...(await nav(context))} />;
```

Mark each item in your own nav definition with the tokens that may see it — `filters: [AUTH_NAV_FILTERS.anonymous]` on sign-in,
`[AUTH_NAV_FILTERS.admin]` on an admin destination — and `activeFilters` does the rest. An administrator holds `signedIn` **and** `admin`, so an
item marked for members does not vanish for them. Which items carry which tokens is yours to decide.

**Marking an item does not gate the route.** `filters` only decides what the bar paints — the item's `href` is in the delivered HTML whatever the
viewer holds. The destination still needs its own guard (`requireAuth`, `requireAdmin`).

`authNav` returns a **factory**, so call it at module scope and reuse the resolver it hands back per request: the signing key is then imported per
isolate rather than on every render. It reads the identity off `authCtx`, so `resolveAuth` or a `requireAuth` must run before the layout renders.
An anonymous request gets `activeFilters` and an empty slot map.

The sign-out slot is a function of where the bar places it: inside a menu the button is `role="menuitem"`, and at bar level or in the collapsed
copy it is a plain button. `signout.menuitem` overrides that in every place. To put the control somewhere other than a `Navbar`, call the slot
yourself, as `slots[AUTH_NAV_SIGNOUT_SLOT]?.({ inMenu: false })`.

---

## Replacing the markup of a shipped page

`AuthWebOptions.views` takes one override per page name, and each entry receives exactly the props forge's own view receives:

```tsx
const options: AuthWebOptions<Env> = {
  resolveServices,
  paths,
  icon,
  views: { signin: (props) => <MySignin {...props} /> },
};
```

An entry typed for the wrong page is a **compile** error rather than a view reading `undefined`. Each shipped view also accepts `class` and
`level` for placement. The factors page swapped into the admin edit page as an htmx fragment resolves at `level` 2, under that page's `<h1>`; if
you render the edit page at another level, set the fragment's in a `views.adminUserFactors` override.

To put one page inside a page of your own rather than replacing it, use `resolveAuthView` — the recipe, the `guarded` claim it takes, and the
CSRF configuration your route must share are [`AUTH_MOUNTING.md`][am-6] §6.

Some shipped views take props an override has to supply as well: `PasskeyEnrolView` needs `exit` and `csrfHeader`,
`AdminUserEditView` needs `self`, and `TotpEnrolView` needs `codeDigits` and `codePeriodSeconds` — read off the factor, never hard-coded.

**Some views update themselves in place.** Their htmx forms swap the action's answer, which is the whole view re-rendered, over the view's root
with `outerHTML`. The root carries an id exported from `@y-core/forge/auth/web`:

| View | Pages | Root id |
| --- | --- | --- |
| `PasskeyListView` | `accountPasskeys`, `accountPasskey` | `AUTH_PASSKEY_LIST_ID` |
| `PasskeyEditView` | `accountPasskeyEdit` | `AUTH_PASSKEY_EDIT_ID` |
| `TotpEnrolView` | `enrolTotp`, `accountTotp` | `AUTH_TOTP_ID` |
| `AdminUserEditView` | `adminUser` | `AUTH_ADMIN_USER_EDIT_ID` |

The action answers with your override when you have one, so an override of one of these pages that submits by htmx does the same: it puts the id
on its own root and targets it.

```tsx
import { AUTH_PASSKEY_LIST_ID, type PasskeyListViewProps } from "@y-core/forge/auth/web";
import { Button, Card, Form } from "@y-core/forge/ui/core";

const MyPasskeys = ({ rows, paths, csrfHeader }: PasskeyListViewProps) => (
  <Card id={AUTH_PASSKEY_LIST_ID}>
    <Card.Header>
      <Card.Title>
        <h1>Your passkeys</h1>
      </Card.Title>
    </Card.Header>
    <Card.Content>
      {rows.map(({ credential, csrfToken }) => (
        <Form
          csrfToken={csrfToken}
          csrfHeader={csrfHeader}
          hx-delete={paths.passkeyRemove({ id: credential.id })}
          hx-target={`#${AUTH_PASSKEY_LIST_ID}`}
          hx-swap='outerHTML'>
          <Button type='submit'>Remove</Button>
        </Form>
      ))}
    </Card.Content>
  </Card>
);
```

A page of your own that embeds one of these views renders a single copy of it, and gives no other element its id. The swap replaces the first
element carrying the id, which is not always the view that sent the request.

**A `verify` override must render `choices`.** They are the links to the user's other confirmed factors, and without them a user whose first
factor cannot be checked has no way to pick another.

The pages render into the shell your app registers, the same one every other mount renders into ([`ROUTING_AND_MIDDLEWARE.md`][ram-6] §6).

---

## Getting the shipped pages into your CSS build

`forge.css` does not scan the auth views, so an app that mounts them imports the namespace's own `@source` lines into its stylesheet:

```css
@import "@y-core/forge/auth/sources.css";
```

Those paths are relative to the file that declares them, so they resolve wherever the package landed — a hoisted install, pnpm, a workspace or a
git dependency. **Do not judge the import by comparing built stylesheets**: forge's `ui` scan set can already produce every class the auth views
use, so both builds may come out the same. The import is still required.

The views also draw their glyphs from **your** sprite rather than a bundled one. `AuthWebOptions.icon` is a `ForgeIcon<AuthIconName>`, and that
union names every symbol it must cover; where to get them is [`AUTH_MOUNTING.md`][am-3] §3.

---

## Running the passkey ceremony in the browser

Import the controller for its side effect, before `resume()`:

```ts
import "@y-core/forge/auth/client"; // registers the auth scopes, and every scope ui/core markup names
import { resume } from "@y-core/forge/ui/client";

resume();
```

**Without that import the ceremony buttons render correctly and do nothing.**

The controller speaks each outcome through `announce()`, so **the page needs `<Announcer />` from `@y-core/forge/ui/core`** in its layout: a
refusal interrupts, a success does not. Without one the ceremony still works and says nothing to a screen reader.

When you render a ceremony root yourself, take every attribute name and default from the `PASSKEY_*` constants in `@y-core/forge/auth`, never a
literal.

**A token per endpoint, never one shared** — `csrfProtection` binds a token to a path, and a ceremony spans two ([`AUTH_FLOWS.md`][af-3] §3).

To react to a ceremony from your own code, listen for `PASSKEY_OUTCOME_EVENT` on the scope root: its `detail` is a `PasskeyOutcomeDetail`, whose
`reason` is absent exactly when the ceremony succeeded. The scope root is hand-rendered rather than wrapped in `Resumable`
([`UI_CLIENT_RUNTIME.md`][ucr-2a] §2a).

---

## Deriving a key in the page from a passkey

Give `createPasskeyFactor` a `prf` option, and the ceremony asks the authenticator for a 32-byte secret that only the page ever sees:

```ts
createPasskeyFactor({
  // …
  prf: {
    registration: (userId) => saltFor(userId),
    stepUp: async (userId, credentialIds) => new Map(await saltsFor(userId, credentialIds)),
  },
});
```

`registration` returns the salt a new passkey is first evaluated with, or `null` to ask nothing of this user. `stepUp` returns a salt per
credential id, and an id you leave out is asked for nothing. A salt is any non-empty `Uint8Array`, and it need not be secret.

Take the output in the page, before the ceremony navigates:

```ts
import { onPasskeyPrf } from "@y-core/forge/auth/client";

onPasskeyPrf(async ({ credentialId, output }) => {
  if (output === null) return; // this passkey returned no PRF result — fall back
  await unlockWith(credentialId, output);
});
```

**Test `output` for `null`, never `prf.enabled` or `getClientCapabilities()`.** A registration already returns the bytes a later step-up with
the same salt will, so you can wrap a key at once. Why the output never reaches your server is [`AUTH_FLOWS.md`][af-3d] §3d.

A handler that throws does not stop the ceremony succeeding or navigating. Only the last handler registered is called, and `onPasskeyPrf`
returns the function that removes it.

---

## Sealing a value into a link of your own

`encodeAuthToken` seals a payload under AES-256-GCM with a per-purpose subkey, and `decodeAuthToken` opens it again, answering a `Result`. Use
them where a value has to survive a round trip through an email or a URL and must not be readable on the way.

A token is authenticated before it is judged expired, so a reason is trustworthy when you get one. `AuthTokenReason` is for your logs and your
branching, never for a client.

**Every `AuthTokenPurpose` is taken, and `identity` in particular is not a spare** — it is the email-change purpose. A genuinely new use needs a
purpose of its own, which is a change to this namespace rather than a call you can make.

`authNonceKey(ring, token)` derives the key to spend a token against a `NonceStore`.

A value you store rather than send belongs in [`@y-core/forge/crypto/keyring`][keyring-readme], not in a token with a long TTL.

---

## Applying the auth schema to your database

`src/auth/schema.sql` is the **desired state**. **This library ships no SQL that runs**, and nothing is generated beside it. Your app names the
file in its own host config with `forgeSchema`, alongside its own:

```ts
// config/db.config.ts
import { defineDbConfig, forgeSchema } from "@y-core/forge/tooling/db/host";

export default defineDbConfig({ schemas: [forgeSchema("auth"), "config/db/schema.sql"] });
```

Then compose the migration from every file named there, and apply it:

```bash
forge db migrate compose   # writes the app's next migration
forge db migrate
```

The forward-only policy, what the snapshot records, and the undo for each target are [`DATABASE_MANAGEMENT.md`][dm]'s. A change here that needs a
backfill is announced in forge's `CHANGELOG.md` with the fill your seed or app writes, in the order [`DATABASE_MANAGEMENT.md`][dm] §7a gives.

**An upgrade that adds a table reaches your database only through a migration you compose**: run `forge db migrate compose` after upgrading,
and apply it before you deploy. Forge's `CHANGELOG.md` names each table an upgrade adds, and where an upgrade also drops a column, the order the
two must go out in.

For a database that will never be migrated, the desired state is also the one-shot build:

```bash
wrangler d1 execute <DATABASE> --file node_modules/@y-core/forge/src/auth/schema.sql
```

The tables carry rulings that change what you write against them. **The `auth_` prefix is fixed.** And **case-insensitive addresses are a column,
not a collation**: every write feeds `email_key` with `normalizeEmail(email)`, which trims, applies NFKC and lowercases, and a `CHECK` refuses an
address that expands past 254 characters. Plus tags and dots in the local part are **kept** — `aurora+news@` is a different mailbox from
`aurora@` everywhere except Gmail.

**Declare every key of yours to an `auth_` table `ON DELETE CASCADE`, or `ON DELETE SET NULL` on a nullable column.** Forge deletes auth rows
itself — the scheduled purge and an administrator's `remove` — and D1 refuses a delete that any other key still points at. The migration lint
refuses such a key as `auth-key-blocks-delete`, before every apply and under `forge db lint` ([`DATABASE_MANAGEMENT.md`][dm-5] §5), so compose
refuses to write one declared in your `schema.sql`. It counts a column as unable to hold `NULL` when it is `NOT NULL`, part of a primary key, or
named in a table `CHECK (… IS NOT NULL)`. The lint reads each migration's SQL, so two keys get past it: `SET NULL` on a column a trigger, or a
`CHECK` it cannot read, keeps from `NULL`, and a key in a migration your database already holds. At runtime such a key puts the table in the
purge's `blocked` and makes `remove` answer `referenced`. Clear the rows it names, or change the key.

No table carries a TTL: every read holds a row against the clock.

---

## Rotating the signing secret

A rotation is prepending a secret. `importAuthKeyRing` takes hex root secrets **newest first**, and derives each key id from the key material rather
than taking one you type. Hold them in one variable, comma-joined, and split it with `parseKeyRingSecrets` from `@y-core/forge/crypto/keyring`:

```ts
const keys = await importAuthKeyRing(parseKeyRingSecrets(c.env.AUTH_KEY_RING));
```

Mark the variable `# forge:ring` in `.dev.vars`, so `forge cf sync --commit --local --rotate AUTH_KEY_RING` prepends a new key and keeps the old
ones rather than replacing the ring.

**Rotate on a schedule, not only on suspicion.** Every seal spends part of a bounded per-key budget, and crossing it costs the integrity of
everything already sealed under that key — the bound, the failure mode and the cadence to hold to are [`AUTH_MOUNTING.md`][am-7] §7.

Tokens minted under the old key keep opening for as long as it stays in the list, so leave the old secret in place for at least the longest TTL a
token of yours carries. A secret that ever wrapped a TOTP secret stays until `authKeysRetirable` says otherwise; what dropping it early costs is
[`AUTH_MOUNTING.md`][am-7] §7. A token consumed before a rotation stays consumed
after one, because its nonce key is derived from the **token's own** key id.

**Each secret is held to [`SECURITY_HARDENING.md`][sh-8] §8's strength rule**, which `importAuthKeyRing` applies and `resolveAuthServices`
applies again to a ring built by hand. Generate each with `openssl rand -hex 32`, and source them from Worker secrets, never from a literal.

---

## Replacing a user's authenticator app

A user whose phone is lost or replaced swaps the app for a new one from the account pages, without removing it first. That matters wherever
the app is mandatory, because removing it would be refused. Mount `accountRoutes` and the `totp` page links
to the replacement page. The one thing the factor needs from you is a `ChallengeStore` to hold the new secret until a code from it confirms
the swap:

```ts
import { createChallengeStore, createTotpAppFactor } from "@y-core/forge/auth";

const totpApp = createTotpAppFactor({
  keys,
  factors: enrolments,
  challenges: createChallengeStore(db),
  issuer: "Example",
  account: async (userId) => {
    const found = await users.findById(userId);
    return found.ok && found.data ? found.data.email : userId;
  },
});
```

**The pages demand a fresh step-up, and you cannot turn that off.** A user who signed in a while ago is sent to verify first and brought back. A
user who has lost the app steps up with a recovery code or another second factor, so the replacement is also how they recover. What the flow
guarantees, and why it is not a removal, is [`AUTH_FLOWS.md`][af-3c] §3c.

**Your notifier is sent `factor-replaced`** once the swap commits, so a renderer covering every notice type must cover it
([Delivering the codes and links forge does not send](#delivering-the-codes-and-links-forge-does-not-send)).

**A custom `FactorStore` must implement `replaceSecret`** ([Backing a store contract yourself](#backing-a-store-contract-yourself)).

---

## Getting a user back in when a factor stops working

What a user sees when a key, a device or their codes go missing, and their way back from each, is [`AUTH_FLOWS.md`][af-9] §9. What falls to you
is noticing a lost key, and resetting an account nothing else can reach.

**Treat `auth.factor.unusable` as a key to put back.** The verify page logs it at warn, with the factor's `kind`, when an authenticator-app
secret will not open under the ring — in practice, a secret dropped from the ring while enrolments were still sealed under it. It is written
through `requestLog`, so it reaches your logs only where `requestLogger` from `@y-core/forge/logging` is mounted. Append the dropped secret to the
end of the ring, keeping the active one first, and every enrolment still under it works again, with nobody re-enrolling.

**Reset an account only for a user who has nothing left to step up with.** Once every second factor and every recovery code is gone, only an
administrator can let them back in. A user who lost their authenticator app but can still step up replaces it themselves
([Replacing a user's authenticator app](#replacing-a-users-authenticator-app)). The admin factors page, `adminRoutes`'
`users.factors`, carries the reset control. From a route of your own the same write is `resetFactors` on the `AdminUserStore` you hand
`resolveServices`.

**Confirm who is asking before you reset.** The user signs back in on their address alone, which makes the reset the one path that admits an
account on less than it needed before ([`AUTH_FLOWS.md`][af-9e] §9e). The shipped action refuses an administrator's own account; a route of your
own must refuse it too, because the store does not.

---

## Clearing expired challenges, nonces and sessions

Challenges, one-shot nonces and signed-in sessions live on the same D1 binding every durable store does, and SQLite keeps an expired row. The same
purge deletes the accounts that never verified their address and the security events past their retention. Call it from your Worker's scheduled
handler:

```ts
export default {
  async scheduled(event, env) {
    const purged = await purgeAuthEphemera(createD1Client(env.DB), Date.now());
    if (!purged.ok) throw purged.error;
    const { deleted, complete, blocked } = purged.data;
    console.log(JSON.stringify({ event: "auth.purge", deleted, complete, blocked }));
  },
};
```

**A deployment that never calls it is slower, not wrong, for the expired rows.** Correctness rests on the `expires_at` predicate every read
carries. The other two are different: nothing else deletes an account that sign-up created for an address that never answered, or a security
event, so without the purge both build up for good.

**One run deletes a bounded amount, so a backlog clears over several runs.** It works through challenges, nonces, sessions, security events and
then accounts, in steps of a fixed number of rows with a ceiling of steps per table, and no transaction spans them: a step that fails takes only
itself back. `deleted` counts each table's own rows, and the rows a deleted account's cascade removes are not counted. A run sends at most 40
queries against the free plan's 50 per invocation, which leaves little for other work in the same invocation.

**Schedule it more often while `complete` is `false`.** A table still held lapsed rows when its step ceiling ran out, or a constraint blocked
it, and the rest waits for the next run.

**`blocked` names each table a constraint stopped, in the order the run reached them.** The purge's deletes write no value, so a foreign-key,
`NOT NULL` or `CHECK` refusal comes from a key of yours to an auth table: one that is neither `CASCADE` nor `SET NULL`, or a `SET NULL` on a
column that cannot hold `NULL`. That table's remaining steps are skipped and the other tables still purge. Accounts go last, so their
expired sessions and events are gone even when the accounts step is blocked. A trigger that fails the delete with one of those constraint errors
blocks the table the same way. Clear the rows the key names, or change the key; the migration lint refuses such a key before it is applied
([Applying the auth schema to your database](#applying-the-auth-schema-to-your-database)).

**Any other failure stops the run where it is** and answers an `AuthStoreError` whose `operation` names the table, such as `ephemera.purge.users` —
a `UNIQUE` refusal, an outage and a trigger's `RAISE(ABORT)` included. The rows earlier steps deleted stay deleted. A retention option under its
floor throws before any query is sent.

**Choose how long each is kept with `AuthEphemeraPurgeOptions`.** `unverifiedUserTtlMs` is how long an unanswered account waits, and
`securityEventTtlMs` how long an event row is kept — a year by default, and never less than thirty days. Omit either for its `AUTH_*` default. An
account's events are deleted with the account and survive an administrator's factor reset:

```ts
await purgeAuthEphemera(createD1Client(env.DB), Date.now(), { securityEventTtlMs: 2 * 31_536_000_000 });
```

`createChallengeStore(db, { prefix })` and `createNonceStore(db, { prefix })` namespace their key text inside those shared tables. Omit `prefix`
for the default; an empty string is **refused**.

### Bounding how long a key rotation waits

A `totpWrap` secret is droppable once no factor is sealed under it, and a verification re-seals a stale one on its own — but only for users who sign
in. `purgeStaleTotpSecrets` closes the window on the ones who do not:

```ts
import { purgeStaleTotpSecrets, type TotpSecretPurgeOptions } from "@y-core/forge/auth";

const SECOND_FACTORS: TotpSecretPurgeOptions["factors"] = { offered: ["totp-app", "passkey"], mandatory: ["totp-app"] };

const swept = await purgeStaleTotpSecrets(createD1Client(env.DB), Date.now(), {
  keys: ring,
  idleForMs: 90 * 86_400_000,
  factors: SECOND_FACTORS,
});
if (!swept.ok) throw swept.error;
console.log(JSON.stringify({ event: "auth.totp-purge", ...swept.data }));
```

**`factors` is plain values, not the registry**, because a scheduled handler has no request to build factor services from. Keep it in a
constant beside the `second` offering your request-time registry uses: the kinds of its `offered` list, and those of them marked
`"mandatory"`.

**`purged` counts the rows it deleted, and `kept` the stale rows it left** because their owner holds no other second factor and no unused
recovery code — deleting those would let a mailbox enrol a new one ([`AUTH_FLOWS.md`][af-9b] §9b). A later run purges a kept row once its owner
holds either, and their next accepted code re-seals it under the active key. **It takes the ring, not a key id**
([`AUTH_MOUNTING.md`][am-7] §7); a ring whose `activeKeyId` is not the shape `importAuthKeyRing` derives is refused before any statement runs.

The window is measured from `last_verified_at` — the moment a code was last _accepted_ — or from enrolment for a row that never had one. Not from
`updated_at`: a spent guess moves that too, so a user whose app drifted and who keeps trying wrong codes would hold their own row outside the window
indefinitely, and they are exactly who this is for. `idleForMs` is held between a day and a year. **It throws unless `totp-app` is offered
and mandatory**, for the reason [`AUTH_MOUNTING.md`][am-7] §7 gives, and on a kind listed twice or one that is
not a second factor.

**Backfill `last_verified_at` when you add the column, or the first purge drops standing enrolments.** A row that predates the column reads NULL,
the window falls back to `created_at`, and every confirmed factor not re-sealed since the rotation is old enough to delete. Run this once, in the
migration that adds the column:

```sql
UPDATE auth_factors SET last_verified_at = <migration time>
  WHERE last_verified_at IS NULL AND confirmed_at IS NOT NULL;
```

The `confirmed_at IS NOT NULL` half is what keeps the fallback doing its other job: an abandoned, never-confirmed ceremony stays purgeable on
`created_at`, and without that nothing would ever let the retiring key go.

Whether the key is droppable at all is `authKeysRetirable(factors, "totp-app", ring)`.

---

## Backing a store contract yourself

Every store is a contract with a shipped D1 adapter ([`NAMESPACES.md`][namespaces-5h] §5h). To back one with something else, implement the
contract — and know that **the methods below carry rules the caller does none of**:

| Method | What your statement must do |
| --- | --- |
| `AuthSessionStore.resolve` | Hold the row against `expires_at > at`, the idle bound **and** a deactivated owner in the one statement that reads it, naming the owner's columns rather than selecting them all. Write `last_seen_at` back only when the row read shows the touch interval has passed, under a guard repeating that test, and resolve the identity even when that write fails. Correctness rests on the predicate, not on the purge |
| `AuthSessionStore.create` | Insert the row with an id of its own, `last_seen_at` set to the sign-in, and an expiry from the store's lifetime, and record `signed-in`, deleting the replaced row first, in one batch |
| `AuthSessionStore.rotate` | Move the row onto the new token with one in-place `UPDATE`, so every other column carries over, and record `stepped-up` only where that `UPDATE` moved a row |
| `AuthSessionStore.revoke` / `revokeOthers` | Delete the user's rows except the one `origin.keep` names, and record `sessions-revoked` in the batch only where a row went. With `keep: null`, drop the `token_hash != ?` term rather than binding `NULL` into it, which matches no row and so deletes nothing |
| `UserStore.changeEmail` | Move the address, mark it verified, record `email-changed` and delete every session the user holds, the current one included, in one batch |
| `UserStore.claimEmailChange` | Stamp the request unless one was stamped inside `cooldownMs`, deciding in the one statement |
| `FactorStore.listConfirmedKinds` | Select the kind alone, of confirmed rows only. A signed-in request under `requireAuth` reads it, and a sealed secret must never ride along |
| `FactorStore.confirm` | Confirm only a row not yet confirmed, answering `false` otherwise. For any kind but `passkey`, record `factor-added` and delete the user's other sessions in the same batch, each only where the confirmation landed |
| `FactorStore.countAttempt` | Find the factor **and** spend one guess in the one statement, reopening a budget spent longer ago than `lockoutMs`. `null` is "no such factor, or the budget refusing" |
| `FactorStore.recordVerification` | Write the counter, the cleared budget, `last_verified_at` **and** any `resealed` secret in the one statement, under the `last_counter <` guard **and** a `secret = frame` guard. Split across two, a replayed code re-seals a row it did not advance; without the frame guard, a code checked against a secret a concurrent replacement swapped out is accepted, and a re-seal riding it writes the old secret back |
| `FactorStore.replaceSecret` | Update a confirmed `totp-app` row of that user in place — the secret, the counter, the cleared budget, `last_verified_at` and `updated_at` — then record `factor-replaced` and delete the user's sessions but `origin.keep`, each only where the update landed, in one batch. Answer `false` where no row matched. Never delete and re-insert: that passes through zero second factors, which is the removal the minimum refuses |
| `FactorStore.recordVerification` and `replaceSecret` — and nothing else | **These are the only methods that may stamp `last_verified_at`.** `purgeStaleTotpSecrets` deletes by it; leave it NULL and the window is measured from enrolment instead, so the first run drops the factor of every long-standing user, including the ones signing in daily. Stamp it anywhere a guess is merely spent and the purge never reaches anyone |
| `FactorStore.countSecretsNotUnder` | Read the key id out of the secret's own first six bytes. A column holding it separately can disagree with the bytes that actually decide whether the secret opens |
| `FactorStore.remove` / `CredentialStore.removeForUser` | Decide the `floor` in the batch that deletes: probe, then guard the event, the session revocation and the delete on the user still holding a confirmed row of a `floor` kind afterwards. Answer `second-factor-required` where the guard refuses, writing nothing. A count read before the batch lets two concurrent removals take a user's last two second factors |
| `FactorStore.remove` | Delete the factor and, in the same batch, the user's recovery codes and `recovery-code` row once the user holds no confirmed factor that needs recovery codes beside it ([Choosing which factors a deployment offers](#choosing-which-factors-a-deployment-offers)). Where the factor was confirmed, record `factor-removed` and delete the user's other sessions in that batch too. Split, a failure between them leaves an account holding codes alone |
| `CredentialStore.create` / `removeForUser` | Insert or delete the credential, record `factor-added` or `factor-removed`, and delete the owner's other sessions, in one batch. `removeForUser` carries the owner in the `WHERE`, so another user's credential deletes nothing. In the same batch, after the credential goes, it deletes the owner's `passkey` factor row once no credential remains, and then the recovery codes and `recovery-code` row on the same condition as `FactorStore.remove`. Out of that order, the last passkey's factor row keeps the codes alive |
| `RecoveryCodeStore.consume` | Spend a live, unused code, then record `recovery-code-used`, delete the user's other sessions and clear the factor's `failed_attempts`, in one batch and only where this call spent the code. A staged code, a used one or another user's never matches |
| `RecoveryCodeStore.commit` | Swap the staged set in for the live one and confirm the factor, recording `recovery-codes-issued` and deleting the user's other sessions, in one batch, so a failure leaves the old set working. Answer `false` when no staged set was there |
| `AdminUserStore.claimFirstAdmin` | Take the role only while no administrator exists, then record `admin-granted`, then move the claimant's session per `rotation`, each guarded on the write before it, in one batch |
| `AdminUserStore.setAdmin` / `setDeactivated` | Match only an account not already in the asked-for state, and record the event naming `adminId` only where the row changed; answer `unchanged` for an account already there. Deactivating deletes the user's sessions in the same batch, and only when the deactivation landed, so a refused last-admin deactivation signs nobody out |
| `AdminUserStore.resetFactors` | Delete the user's factors, credentials, recovery codes and sessions, revoke their unrevoked bearer tokens and record `factors-reset`, in one batch. Keep the user's security events |
| `AdminUserStore.remove` | Delete the user and every row of theirs in the auth tables, sessions and security events among them, in one transaction, and answer `referenced` — not an error — when a foreign-key, `NOT NULL` or `CHECK` constraint refuses the user row's delete, leaving every child in place. The shipped adapter deletes the user row alone and the schema's `ON DELETE CASCADE` removes the rest |
| `IdentityLinkStore.unlink` | Carry the owner in the `WHERE`, so a link id belonging to somebody else unlinks nothing |
| `OtpStateStore.discard` | Retire **that named code** and no other, so an undelivered issue returns its cooldown without wiping a racing issue that did send — keeping the row, whose guess window must outlive the code |
| `OtpStateStore.issue` / `countAttempt` | Decide in one conditional statement. A read then a write hands every parallel request a free extra guess |
| `OtpStateStore.issue` / `countAttempt` / `read` | `issue` moves the code to the binding it is given and never resets the spent guesses; `countAttempt` and `read` match the binding, so another browser's guess updates no row and spends nothing |
| `AccessTokenStore.recordUse` | Decide the throttle in the one conditional statement: stamp `last_used_at` only where none landed after `at - intervalMs`, and report whether it did |
| `AccessTokenStore.findByHash` | Answer `null` for a token whose owner is deactivated, so a deactivated account's tokens stop verifying without being revoked |

Contract-wide rules hold for every method you write:

- **Not-found is `data: null`, never an error** — the same shape `KVStore.get` and `D1Client.queryOne` already answer with.
- **I/O failure is one `AuthStoreError`**, carried in the `Result` and never thrown across the boundary. A domain rule refusing is a reason union
  on the service that owns the rule, not this class.
- **A security event lands in the batch of the change it records, and only where the change did.** Guard the `auth_security_events` insert with
  `changes() > 0` directly after the statement it reads, or with the predicate the change itself uses, so a refused write records nothing and a
  failed batch takes the row with it. A deletion of the user's other sessions chains off the event the same way.
- **Every write reports whether it changed a row** — `false`, or an `AdminUserOutcome` naming which guard refused — so a write against an id that
  is not there is never mistaken for one that landed.

`AuthStoreError` carries `code`, `operation`, and `constraint` where the backend named an index. Branch on `code`: `conflict` is a uniqueness
violation the caller can act on, `invalid` says the caller's own value was refused (rendering that as an outage tells a visitor the deployment is
down when their address was simply too long), `reference` is a foreign key refusing the write — a row still points at the one deleted, or an
insert names an owner that is not there — and `unavailable` is everything else.

`ChallengeStore` and `NonceStore` are shapes rather than tables, and both are load-bearing: `ChallengeStore.take` is **read-and-delete**, and
`NonceStore.markConsumed` reports `true` **only the first time**.

---

## Testing a mount

[`src/auth/web/mount.test.ts`](./web/mount.test.ts) is a working mount driven end to end, and reading it is the shortest way in.

**Use `fakeAuthD1` for the durable side.** State an account in domain terms and the fake answers the user, factor and session stores' own
statements, binding each id as its 16 `BLOB` bytes, and holds the session rows a sign-in writes:

```ts
const env = { DB: fakeAuthD1([{ id: ADA, email: "ada@example.com", isAdmin: true, factors: [{ kind: "passkey" }] }]) };
```

An enrolment is confirmed by default; `confirmedAt: null` gives the unconfirmed row that makes a user owe an enrolment, which is how the
pending-enrolment and step-up paths are reached. A statement the fake does not model answers no rows, so a test needing a challenge to survive a
round trip hands the ceremony a `ChallengeStore` of its own.

**Build a UUID with `uuidToBytes` from [`@y-core/forge/storage/db`][storage-readme], not from `crypto`.** `fakeAuthD1` converts for you, so you
need it only when asserting against a bound parameter.

**A signed-in session is built, not faked.** Mount the same `createAnonymousSession` the app mounts, then sign the user in from a middleware
ahead of the guards: call `establishAuthSession` on the session `sessionCtx` holds, with `createAuthSessionStore(createD1Client(env.DB))` over
that `fakeAuthD1`, and `markAuthStepUp` after it for a session that has already stepped up. For an anonymous
mutation, seed nothing: carry the cookie from the page `GET` to the `POST` as a browser does, and the id the CSRF token was minted under is the
id the `POST` is verified against.

**The CSRF guard answers before the auth guards do.** With `csrfProtection` mounted ahead of the guard chain — the order
[`AUTH_MOUNTING.md`][am-1] §1 gives — an anonymous, tokenless `POST` to a ceremony endpoint answers **`403` as plain text**, not the `401` JSON
that group's medium implies. Assert the 403 for a tokenless request and the 401 only for one carrying a valid token, or the test asserts the
wrong layer.

---

## Wiping the browser's copy of a user's data at sign-out

An app that keeps a signed-in user's data in the browser — a service-worker cache, IndexedDB, `localStorage` — can have the sign-out response
clear it, so the next person at the machine finds nothing:

```ts
const options: AuthWebOptions<Env> = { ...rest, signoutClearsSiteData: true };
```

The sign-out response then carries `Clear-Site-Data: "cache"`, on the `303` and on the htmx `204` alike, and the sign-in page it lands on posts to
`auth.signoutSiteData()` for `Clear-Site-Data: "storage"`. It clears only once per sign-out: the mark it consumes is set by the sign-out on the new
session, so a link to the endpoint wipes nothing. `"storage"` also unregisters the origin's service workers, so the next page load registers yours
afresh.

**The `"storage"` half needs the auth pages to import `@y-core/forge/auth/client` before `resume()` and to run JavaScript**, the same import the
passkey ceremony takes, even in an app with no passkeys. Without it nothing fails: sign-out still sends `"cache"`, but IndexedDB,
`localStorage`, Cache Storage and the service workers survive it for the next person at the machine.

**It is off by default** because it wipes the whole origin, including anything the app has not yet synced: warn about unsynced work before the form
posts. The header is honoured only over HTTPS and on `localhost`, and the endpoint is under the auth prefix, so it carries the same CSRF and origin
protection as every other auth `POST`.

---

## Signing out from a page left open past an hour

A sign-out form carries a CSRF token minted when the page rendered, and `csrfProtection` refuses a token older than an hour. Without recovery, a
sign-out pressed on a page left open that long answers `403` and the session stays signed in. Hand the guard `authCsrfRefusal`:

```ts
import { authCsrfRefusal } from "@y-core/forge/auth/web";

csrfProtection({ ring, subject, onForbidden: authCsrfRefusal(paths.auth) });
```

A refused sign-out now answers a `303` to `auth.signoutConfirm()`, or a `204` with `HX-Redirect` under htmx. That page carries a fresh token, and
its button signs out.

**A refused token never ends the session.** Only the confirm page's own `POST` does, so a cross-site sign-out attempt lands the visitor on a page
that changes nothing.

**Every other refusal still answers `403`**, including `"unbound-subject"`, which means the session middleware is missing. To answer the rest
your own way, see [Answering a refusal yourself][form-readme-refusal]; the hook takes one function, so choose one or the other.

The confirm page is replaceable like any other, through `views.signoutConfirm`.

---

## Challenging bots on the sign-in and sign-up forms

Set `turnstile` and the sign-in, sign-up and verify pages carry an invisible Cloudflare Turnstile challenge, and refuse a submission that arrives
without a solved token:

```ts
import type { AuthWebOptions } from "@y-core/forge/auth/web";

const options: AuthWebOptions<Env> = { ...rest, turnstile: {} };
```

Forge reads `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` off the request's bindings, and a missing or blank one answers 500 naming it rather
than leaving a form unguarded. It pins each token to the request's own hostname, sends `CF-Connecting-IP` as the remote address when the request
carries one, and picks each form's action and token field itself ([`INPUT_VALIDATION.md`][iv-4a] §4a). The page needs the client imports and the
CSP in [`AUTH_MOUNTING.md`][am-3] §3, or every guarded form is refused.

**Guard fewer forms by naming the ones you want.** Leave `flows` out and every form it can cover is guarded:

```ts
turnstile: { flows: ["signup", "resend"] },
```

**Override a default only where a deployment differs.** `keys` replaces the bindings read, and `verify` is merged over the defaults — a site served
on more than one hostname pins the one its widget is registered for:

```ts
turnstile: { verify: () => ({ expectedHostname: "example.com" }) },
```

**Run the app with [`forge cf dev`][cf-dev] to submit against Cloudflare's testing keys.** Those keys answer a fixed hostname and no action, so
under any other build every local submission is refused. Put a testing pair in `.dev.vars`; nothing changes in `turnstile`:

```bash
# .dev.vars — Cloudflare's always-passes testing pair
TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

Under `forge cf dev` the hostname, action and cdata checks are skipped for a testing secret and for nothing else, so a real secret in `.dev.vars`
is still checked in full ([`INPUT_VALIDATION.md`][iv-4a] §4a).

**A view you replace through `views` renders the widget itself.** Its props carry `turnstile`, and on the verify page `resendTurnstile`, whenever
that form is guarded. A replacement whose forms swap a refusal into the view the way the shipped ones do gives its root `AUTH_SIGNIN_ID`,
`AUTH_SIGNUP_ID` or `AUTH_VERIFY_ID`. Which forms can be guarded, and what a refusal answers, is [`AUTH_MOUNTING.md`][am-8] §8.

---

## Security

**Never render a reason a flow or a store hands back.** `redactSigninReason` is required at the rendering boundary, and `AuthEmailChangeReason`,
`AuthFactorReason`, `AuthTokenReason`, `AccessTokenReason` and `AuthStoreError` have no equivalent — they are for logs and branching only
([`FORGE_ERRORS.md`][eh-1c] §1c).

**A session ends at its absolute lifetime or once it goes unused for its idle bound, and revoking a session deletes its row.** The bounds, their
defaults and the settings that reach AAL2 are [`AUTH_MOUNTING.md`][am-5] §5. Which changes delete a user's other rows, and which delete all of
them, is [`AUTH_FLOWS.md`][af-3c] §3c and §7. Deleting the row is how a change reaches sessions on devices this request cannot see, whichever
session storage you chose. The row is keyed by the SHA-256 of the token the cookie carries, never the token, so a read of the table or a
backup of it opens no session. Under D1 read replication a revocation can lag on another device ([`AUTH_FLOWS.md`][af-8] §8).

**The emailed code is rate-limited by a cooldown, not by a count.** **Bounding a caller's rate is a different control, and forge ships no numbers
for it** ([`AUTH_FLOWS.md`][af-8] §8).

**A credential this runtime cannot verify is never advertised.** `AUTH_SUPPORTED_ALGORITHMS` is the default set, and COSE `-8` is opt-in behind a
probe that throws at resolution rather than at the first sign-in ([`NAMESPACES.md`][namespaces-5h] §5h).

**Forge's own auth pages default to `Cache-Control: no-store`** and carry `robots: "noindex"`. The header is merged rather than imposed, so a page
naming its own still wins; a page you route yourself has to set both.

**Mount `csrfProtection` after the session middleware, never before.** Its subject resolver runs ahead of `next()`, so one mounted first binds the
token to nobody and refuses every mutation with a `[csrf]` warning. The chain order that gets this right is [`AUTH_MOUNTING.md`][am-1] §1's.

---

## Gotchas

**Every store method is total, including on input you never validated.** An id that is not a canonical UUID answers what that method calls no
such row — `null`, `false`, or `"not-found"` — and binds no statement at all, so a crafted `?after=u9` is an empty page and not a 500. An insert
is the one shape with no in-band answer of that kind, so a malformed owner id comes back as `unavailable`.

**`list` and `search` clamp `limit` in the adapter.**

**Deleting a user removes its auth rows through the schema's `ON DELETE CASCADE`.** D1 always enforces foreign keys, so the cascade needs no
`PRAGMA`. A key of yours that is neither `CASCADE` nor `SET NULL` on a nullable column makes `remove` answer `referenced` and delete nothing.

**`AuthFactorService` is a union discriminated on `enrolment`, at the top level.** Write `if (service.enrolment === "explicit")` to reach
`beginEnrolment` and `completeEnrolment`.

---

## See also

- [`docs/AUTH_MOUNTING.md`][am] — the mount: the builders, the order, the guard table, the seams forge does not ship, and embedding one view
- [`docs/AUTH_FLOWS.md`][af] — every flow end to end, and its limits
- [`docs/NAMESPACES.md`][namespaces-5h] §5h — the rule binding every `auth` subpath, and why identity is not `security`'s
- [`warden/canon/libs/BOUNDARIES.md`][boundaries-2c] §2c — why identity is application-layer, and what that buys in testability
- [`src/session/README.md`][session-readme] — the session the identity rides on, and the cookie under it
- [`src/form/README.md`][form-readme] — `csrfProtection`, the token every auth mutation carries
- [`src/storage/README.md`][storage-readme] — the `D1Client` every adapter is built over, and the UUIDv7 set
- [`src/crypto/README.md`][crypto-readme] — the `crypto` container, and the key ring this namespace signs and seals under

[af]: ../../docs/AUTH_FLOWS.md
[af-1]: ../../docs/AUTH_FLOWS.md#1-signup
[af-2a]: ../../docs/AUTH_FLOWS.md#2a-what-each-requirement-demands
[af-2b]: ../../docs/AUTH_FLOWS.md#2b-what-the-visitor-is-told
[af-2c]: ../../docs/AUTH_FLOWS.md#2c-where-a-resolution-sends-the-visitor
[af-3]: ../../docs/AUTH_FLOWS.md#3-passkeys
[af-3c]: ../../docs/AUTH_FLOWS.md#3c-management
[af-3d]: ../../docs/AUTH_FLOWS.md#3d-prf-output-stays-in-the-page
[af-5]: ../../docs/AUTH_FLOWS.md#5-email-change
[af-6]: ../../docs/AUTH_FLOWS.md#6-admin-management
[af-7]: ../../docs/AUTH_FLOWS.md#7-sessions-and-security-events
[af-8]: ../../docs/AUTH_FLOWS.md#8-limits-in-this-release
[af-9]: ../../docs/AUTH_FLOWS.md#9-recovery--no-lost-value-locks-an-account-out-or-lets-it-in-on-less
[af-9b]: ../../docs/AUTH_FLOWS.md#9b-a-held-factor-is-passed-before-any-enrolment
[af-9c]: ../../docs/AUTH_FLOWS.md#9c-recovery-codes
[af-9e]: ../../docs/AUTH_FLOWS.md#9e-the-administrators-reset-is-the-last-resort
[am]: ../../docs/AUTH_MOUNTING.md
[am-1]: ../../docs/AUTH_MOUNTING.md#1-the-mount-in-order
[am-2]: ../../docs/AUTH_MOUNTING.md#2-the-route-groups-and-their-guards
[am-3]: ../../docs/AUTH_MOUNTING.md#3-what-forge-does-not-ship
[am-5]: ../../docs/AUTH_MOUNTING.md#5-what-mounting-costs-you
[am-6]: ../../docs/AUTH_MOUNTING.md#6-embedding-an-auth-view-in-your-own-page
[am-7]: ../../docs/AUTH_MOUNTING.md#7-rotating-the-key-ring
[am-8]: ../../docs/AUTH_MOUNTING.md#8-turnstile-on-the-anonymous-forms
[boundaries-2c]: ../../warden/canon/libs/BOUNDARIES.md#2c-why-identity-is-application-layer
[cf-dev]: ../tooling/cf/README.md#running-the-app-locally
[crypto-readme]: ../crypto/README.md
[dm]: ../../docs/DATABASE_MANAGEMENT.md
[dm-5]: ../../docs/DATABASE_MANAGEMENT.md#5-the-migration-lint-rules
[eh-1c]: ../../docs/FORGE_ERRORS.md#1c-guardresult-and-validationresult-domain-aliases
[eh-5e]: ../../docs/FORGE_ERRORS.md#5e-startup-invariants--env-validation-and-binding-resolvers-throw
[form-readme]: ../form/README.md
[form-readme-refusal]: ../form/README.md#answering-a-refusal-yourself
[iv-4a]: ../../docs/INPUT_VALIDATION.md#4a-verifyturnstile--cloudflare-turnstile-captcha
[keyring-readme]: ../crypto/keyring/README.md
[namespaces-5h]: ../../docs/NAMESPACES.md#5h-auth--identity-and-only-the-domain-of-it
[ram-6]: ../../docs/ROUTING_AND_MIDDLEWARE.md#6-the-page-shell
[session-readme]: ../session/README.md
[sh-8]: ../../docs/SECURITY_HARDENING.md#8-secret-strength--one-rule-for-every-secret
[storage-readme]: ../storage/README.md
[ucr-2a]: ../../docs/UI_CLIENT_RUNTIME.md#2a-state-only-islands-versus-contract-bearing-scopes
