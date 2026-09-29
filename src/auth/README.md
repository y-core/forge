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
| `@y-core/forge/auth/client` | bundling the browser half of the passkey ceremony — a side-effect import, and `onPasskeyPrf` for a page that derives a key from a passkey |

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
  type AuthIssueOutcome,
  createAdminUserStore,
  createCredentialStore,
  createEmailChangeFlow,
  createEmailOtpFactor,
  createFactorRegistry,
  createFactorStore,
  createNonceStore,
  createOtpStateStore,
  createSigninFlow,
  createSignupFlow,
  createUserStore,
  importAuthKeyRing,
  resolveAuthServices,
} from "@y-core/forge/auth";
import type { AuthRequestServices } from "@y-core/forge/auth/web";
import type { AppContext } from "@y-core/forge/context";
import { createD1Client } from "@y-core/forge/storage/db";

// Module scope: the ring is resolved once per isolate, not once per request.
const authOptions = { secret: (c: AppContext<Env>) => importAuthKeyRing([c.env.AUTH_SECRET]) };

async function resolveServices(c: AppContext<Env>): Promise<AuthRequestServices> {
  const { keys } = await resolveAuthServices(c, authOptions);
  const db = createD1Client(c.env.DB);
  const users = createUserStore(db);
  const enrolments = createFactorStore(db);
  const state = createOtpStateStore(db);
  const nonces = createNonceStore(db);
  const defer = (work: Promise<AuthIssueOutcome>) => c.executionCtx.waitUntil(work);

  const emailOtp = createEmailOtpFactor({
    keys,
    state,
    nonces,
    notifier,
    address: async (userId) => {
      const found = await users.findById(userId);
      return found.ok && found.data ? found.data.email : "";
    },
  });
  const factors = createFactorRegistry(enrolments, { offered: [{ service: emailOtp, role: "primary" }] });

  return {
    users,
    credentials: createCredentialStore(db),
    enrolments,
    factors,
    signin: createSigninFlow({ keys, users, state, nonces, factors, defer }),
    signup: createSignupFlow({ users, factors, defer }),
    emailChange: createEmailChangeFlow({ keys, users, nonces, notifier, defer, confirmUrl: (token) => `${c.env.ORIGIN}/email/confirm?t=${token}` }),
    admin: createAdminUserStore(db),
  };
}
```

Hand that to `AuthWebOptions.resolveServices` and mount the route builders as [`AUTH_MOUNTING.md`][am-1] §1 lays them out.
`resolveServices` is called **once per request** however many guards, loaders and actions ask for it, so building every store inside it costs one
build.

The seams above with no default and no way to guess them are `notifier` (next section), `defer` and `address`. `defer` must be
`executionCtx.waitUntil` or an equivalent, never inline.

**`resolveAuthServices` throws rather than returning a `Result`**: resolving a binding throws, and operating on a resolved store answers a
`Result` ([`FORGE_ERRORS.md`][eh-5e] §5e).

---

## Choosing which factors a deployment offers

`AuthFactorsOptions.offered` is the whole policy. Each entry declares a service `primary` or `second`, and a `second` entry says what this
deployment demands of it:

```ts
const factors = createFactorRegistry(enrolments, {
  offered: [
    { service: emailOtp, role: "primary" },
    { service: totpApp, role: "second", requirement: "mandatory" },
    { service: recoveryCodes, role: "second", requirement: "optional" },
  ],
});
```

**Exactly one entry may be `primary`, and only a factor that identifies the visitor may take it** — today `email-otp`. Offering a passkey or an
authenticator app as primary is a type error, and `createFactorRegistry` refuses it at construction for a caller casting past the type.
`authIdentifies(kind)` is the guard if you need to test one.

The choice you are actually making is the `requirement` on each second factor, and [`AUTH_FLOWS.md`][af-2a] §2a is the table of what each one
demands. Consequences worth knowing before you pick:

- **An all-optional offering makes the enrolment pages unreachable** — §2a says what to do instead.
- **A primary factor is not available as a second factor.**
- **An authenticator app or a passkey needs recovery codes beside it**, offered `"optional"`; `createFactorRegistry` throws without them, or on
  any other requirement ([`AUTH_FLOWS.md`][af-8c] §8c).

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

const notifier: AuthNotifier = {
  async send(message: AuthMessage): Promise<AuthStoreResult<void>> {
    const delivered = await myMailer(message.to, message.kind === "otp" ? codeMail(message) : linkMail(message));
    return delivered ? ok() : err(new AuthStoreError("unavailable", "notifier.send"));
  },
};
```

`AuthMessage` carries `to`, `kind`, `expiresAt`, and then `code` on an OTP or `url` on an email change. Return `ok()` on success — not
`undefined` — and `err(new AuthStoreError("unavailable", "notifier.send"))` on failure; the flows read **any** failure as unavailable and refuse
the attempt.

**A code nobody could receive costs no cooldown.** When `send` fails, the email-OTP factor rolls the claimed cooldown back.

---

## Signing a visitor in without forge's pages

The flows are callable on their own, and `auth/web`'s actions are thin wrappers over exactly these calls. Sign-in is two requests: a request that
defers the issue, and a completion.

```ts
const challenge = services.signin.request(email, Date.now()); // returns immediately; the code is deferred
// …later, with what the visitor typed:
const outcome = await services.signin.complete(email, code, Date.now());
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

**`request` returns synchronously, and its unknown-address branch spends the same statements the known one spends.** So `AuthSigninOptions` takes
`state` and `nonces` even on a deployment whose primary factor is not the emailed code: they are the decoy's stores.

**A resolution that is not `satisfied` is a success, not a refusal** — a page to visit rather than a 4xx, and [`AUTH_FLOWS.md`][af-2c] §2c is
where each one sends the visitor. **An `enrolment-required` with a non-empty `stepUpKinds` goes to step-up first**, or a mailbox alone is enough to
enrol ([`AUTH_FLOWS.md`][af-8b] §8b). `requestStepUp` and `stepUp` run the second factor for a session that is already signed in.

**Pass every sign-in refusal through `redactSigninReason` before it reaches a page.** It folds `AuthSigninReason` into the notices a
visitor may be shown; the unredacted reason is for your logs and your branching ([`AUTH_FLOWS.md`][af-2b] §2b, [`FORGE_ERRORS.md`][eh-1c] §1c).
`AuthEmailChangeReason` and `AuthStoreError` have no equivalent yet and must not be rendered raw.

Signup is one call — `services.signup.request(email, at)` — and answers the same `AuthFlowChallenge` whether the address is new or already
registered ([`AUTH_FLOWS.md`][af-1] §1).

---

## Completing an address change from your own route

Forge mounts every auth route except this one: the confirmation URL is yours, so its handler is too. Build the link with
`AuthEmailChangeOptions.confirmUrl`, then answer it by calling `confirm`:

```ts
const outcome = await services.emailChange.confirm(token, Date.now());
if (!outcome.ok) return outcome.error instanceof AuthStoreError ? unavailablePage() : refusalPage(outcome.error);
if (outcome.data.status === "forwarded") return checkInboxPage(outcome.data.sentTo);
return changedPage(outcome.data.user);
```

The **error** channel is a union of a reason string and a class, so the two arms are told apart with `instanceof` rather than by value. The
**success** value is discriminated on `status`, and a `forwarded` page has to say a step is left — [`AUTH_FLOWS.md`][af-5] §5 owns both stages,
and why a completed move signs every session out.

On the request side, render `AuthEmailChangeRequest.sentTo` and never the address the visitor typed: which address was mailed
depends on whether the account's own is verified.

The confirmation page is yours to render and `resolveAuthView` does not reach it — it is no `AuthViewName`. Render it through the same document
shell the auth pages use ([`ROUTING_AND_MIDDLEWARE.md`][ram-6] §6).

---

## Managing accounts from an admin page

Hand `resolveServices` an **`AdminUserStore`** as its `admin`. Forge builds the `AdminUserService` over it, per request — the read-and-write
surface the admin routes hold. The service is forge's, not yours to substitute.

**`UserStore` and `AdminUserStore` are two contracts.** A sign-in service given a `UserStore` cannot delete a user or set the admin flag, because
neither method is on the type it was given. Build the administrative one only where an administrative route needs it.

Every write answers an `AdminUserOutcome` rather than a boolean, so a refusal says which guard fired: `changed`, `not-found`, `admin-exists`,
`self`, or one of the last-admin refusals that `isLastAdminRefusal(outcome)` tests for. What each refusal means to a visitor, the prefix-only
search, and the first-admin bootstrap are [`AUTH_FLOWS.md`][af-6] §6.

**The first-admin claim needs `AuthWebOptions.bootstrapSecret`, and both halves answer 404 without one** — no secret, no claim endpoint and no
page. Give it a resolver reading the secret off `c.env` per request, and the claim form then asks for it alongside the confirmation.

```ts
const options: AuthWebOptions<Env> = { ...rest, bootstrapSecret: (c) => c.env.ADMIN_BOOTSTRAP_SECRET };
```

**Deactivation takes effect on the next request, not the next sign-in.** `resolveAuthIdentity` re-reads the user every request and answers `null`
for a deactivated one, dropping that session's auth keys as it does — so reactivating the account does not revive the cookies issued before it,
and the visitor signs in again. A store outage denies without clearing.

---

## Guarding a route you wrote yourself

`createAuthGuards` builds the stack for every group in one call and is what a mount uses (`AUTH_ROUTE_GROUPS` is the table it cuts them from, and
[`AUTH_MOUNTING.md`][am-2] §2 says why each group is guarded as it is). The guard primitives are exported for a page you route yourself:

| Guard | Admits |
| --- | --- |
| `resolveAuth` | Everyone. It establishes the identity where the session carries one and refuses nothing — including a session that still owes a step-up |
| `requireAuth` | A signed-in, non-deactivated visitor who owes no step-up, including one owed before an enrolment. It is what puts the identity on `authCtx` |
| `requireAdmin` | An administrator. Anyone else gets a plain 403, and it throws if `requireAuth` did not run first |
| `requireEnrolment` | A visitor who owes no factor. An owed enrolment or step-up is a redirect; an unreadable factor store is a 503 |
| `requirePendingEnrolment` | **Only** a visitor who owes an enrolment, so an owed step-up cannot be enrolled around — nor a confirmed second factor skipped |
| `requireFreshStepUp` | Every safe method, and a state-changing one only behind a recent step-up — or from a user who owes none |

Order is the contract: every guard below `requireAuth` in that table reads the identity it establishes, so a wrong order fails on the first
request rather than at construction.

Read the identity through `authCtx` — `authCtx.get(c)` where a guard has run, `authCtx.getOptional(c)` otherwise. The store is read once per
request however many guards run, so mounting `resolveAuth` globally costs the guarded routes nothing extra.

**`resolveAuth` is not a gate, and an identity on `authCtx` is not a finished sign-in.** A visitor who proved one factor of two carries a full
identity while the step-up is still owed. Anything that renders member data must be behind `requireAuth`; use `resolveAuth` for a nav that greets
a visitor by name, or a page whose anonymous and signed-in renders differ. A page mixing the two needs `requireAuth` on the half that is not
public, or its own check of `authCtx.get(c).stepUpAt`.

**`requireFreshStepUp` is on unless you turn it off**, and `freshStepUpMaxAgeMs` is its window: omit it for `AUTH_FRESH_STEP_UP_MS`, or pass
`null`, which is the only opt-out. It demands nothing of a user whose own resolution owes no step-up, so a deployment offering no second factor
is not locked out of its own admin pages.

**A guard refuses in the medium its group answers in.** Pass `medium: "json"` and `requireAuth` answers `401 {"error": …}` and the enrolment
guards `403 {"error": …}` instead of redirecting — which is what a browser controller posting a ceremony step can actually read.

**An htmx request is redirected by navigation, not by a 3xx.** Every redirect auth sends answers an htmx request with a 204 carrying
`HX-Redirect`: a refusal from `requireAuth`, `requireEnrolment`, `requirePendingEnrolment` or `requireFreshStepUp`, an auth page sending an
anonymous visitor to sign-in, the verify page sending on a visitor who owes no step-up, and an auth action's redirect such as the users list
after an admin remove. htmx then loads that page and updates the address bar, instead of swapping the page into the target. A request without
htmx still gets its 3xx, so your htmx forms and links need nothing extra.

**After sign-in, `requireAuth` returns the visitor to the page they were on.** It records that page in the sign-in URL's `next` parameter, or
the name you pass as `returnParam`:

- An htmx request records the page named by its `HX-Current-URL` header, whatever its method, so a visitor whose session expired mid-save lands
  back on the page holding the form. A header on another origin, or no header, records nothing.
- A request without htmx records its own URL when it is a GET or HEAD, and nothing otherwise, because a POST's URL has no page to return to.

Between requests, the session is written in one place per fact: `establishAuthSession`, `renewAuthSession`, `markAuthStepUp`,
`markAuthSigninPending` / `resolveAuthSigninPending`, and `clearAuthSession`. Reach for the `AUTH_*_SESSION_KEY` constants only to read the
session directly.

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

A refusal is an `AccessTokenIssueReason` — no scope, a scope outside the list, a missing expiry, or one outside `(now, now + maxLifetimeMs]` —
or the store's `AuthStoreError`.

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
const nav = authNav({ signoutPath: paths.auth.signout(), secret: (c) => importCsrfKey(config(c).csrf.secret) });
// …per request, in the layout:
<Navbar config={primaryNav} resolveHref={resolveNavHref} icon={AppIcon} {...(await nav(context))} />;
```

Mark each item in your own nav definition with the tokens that may see it — `filters: [AUTH_NAV_FILTERS.anonymous]` on sign-in,
`[AUTH_NAV_FILTERS.admin]` on an admin destination — and `activeFilters` does the rest. An administrator holds `signedIn` **and** `admin`, so an
item marked for members does not vanish for them. Which items carry which tokens is yours to decide.

**Marking an item does not gate the route.** `filters` only decides what the bar paints — the item's `href` is in the delivered HTML whatever the
viewer holds. The destination still needs its own guard (`requireSignedIn`, `requireAdmin`).

`authNav` returns a **factory**, so call it at module scope and reuse the resolver it hands back per request: the signing key is then imported per
isolate rather than on every render. It reads the identity off `authCtx`, so `resolveAuth` or a `requireAuth` must run before the layout renders.
An anonymous request gets `activeFilters` and an empty slot map.

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

`AuthViews` is keyed on `AuthViewProps`, so an entry typed for the wrong page is a **compile** error rather than a view reading `undefined`. Each
shipped view also accepts `class` and `level` for placement. `AUTH_VIEWS` is forge's own markup per page name, and `renderAuthPage` is the seam
that resolves a name against your override.

To put one page inside a page of your own rather than replacing it, use `resolveAuthView` — the recipe, the `guarded` claim it takes, and the
CSRF configuration your route must share are [`AUTH_MOUNTING.md`][am-6] §6.

Some shipped views take props an override has to supply as well: `PasskeyEnrolView` needs `signoutCsrfToken` and `csrfHeader`,
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
import { Button, Form } from "@y-core/forge/ui/core";

const MyPasskeys = ({ rows, paths, csrfHeader }: PasskeyListViewProps) => (
  <section id={AUTH_PASSKEY_LIST_ID}>
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
  </section>
);
```

A page of your own that embeds one of these views renders a single copy of it, and gives no other element its id. The swap replaces the first
element carrying the id, which is not always the view that sent the request.

**A `verify` override must render `choices`.** They are the links to the user's other confirmed factors, and without them a user whose first
factor cannot be checked has no way to pick another.

The pages render into the shell your app registers, the same one every other mount renders into ([`ROUTING_AND_MIDDLEWARE.md`][ram-6] §6).

---

## Getting the shipped pages into your CSS build

`forge.css` does not scan the auth views, so an app that mounts them must add this line to its own stylesheet, copied as it stands — the path is
relative to the stylesheet, and this is what it is from an `src/` beside `node_modules`:

```css
@source "../node_modules/@y-core/forge/src/auth";
```

Tailwind's scanner follows the symlink a `file:` dependency installs, so it works against a local checkout too. **Do not A/B it against your
built stylesheet to check**: every class the auth views use is also produced today by forge's `ui/core` and `ui/chrome` scan set, so both builds
come out the same size. The line is still required.

The views also draw their glyphs from **your** sprite rather than a bundled one. `AuthWebOptions.icon` is a `ForgeIcon<AuthIconName>`, and that
union names every symbol it must cover; where to get them is [`AUTH_MOUNTING.md`][am-3] §3.

---

## Running the passkey ceremony in the browser

Import the controller for its side effect, before `resume()`:

```ts
import "@y-core/forge/auth/client"; // registers the `passkey` scope
import { resume } from "@y-core/forge/ui/client";

resume();
```

**Without that import the ceremony buttons render correctly and do nothing.**

The controller speaks each outcome through `announce()`, so **the page needs `<Announcer />` from `@y-core/forge/ui/core`** in its layout: a
refusal interrupts, a success does not. Without one the ceremony still works and says nothing to a screen reader.

Import the `PASSKEY_*` constants from `@y-core/forge/auth` when you render a ceremony root yourself: `PASSKEY` for the `data-ref` names,
`PASSKEY_SCOPE`, `PASSKEY_MODE_ATTR`, the `PASSKEY_OPTIONS_*` and `PASSKEY_VERIFY_*` path and token attributes, `PASSKEY_CSRF_HEADER_ATTR` with
its `PASSKEY_CSRF_HEADER_DEFAULT`, and `PASSKEY_REDIRECT_ATTR` with its `PASSKEY_REDIRECT_FALLBACK`.

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

A value you store rather than send belongs in [`@y-core/forge/keyring`][keyring-readme], not in a token with a long TTL.

---

## Applying the auth schema to your database

`src/auth/schema.sql` is the **desired state**. **This library ships no SQL that runs**, and nothing is generated beside it. Your app names the
file by path in its own host config, alongside its own:

```ts
// config/db.ts
export default { schemas: ["node_modules/@y-core/forge/src/auth/schema.sql", "config/schema.sql"] };
```

Then compose the migration from every file named there, and apply it:

```bash
forge db migrate compose   # writes the app's next migration
forge db migrate
```

The forward-only policy, what the snapshot records, and the undo for each target are [`DATABASE_MANAGEMENT.md`][dm]'s. A change here that needs a
backfill is announced in forge's `CHANGELOG.md`, and you write it as `forge db migrate compose --custom <name>`.

**An upgrade that adds a table reaches your database only through a migration you compose**: run `forge db migrate compose` after upgrading,
and apply it before you deploy. Forge's `CHANGELOG.md` names each table an upgrade adds.

For a database that will never be migrated, the desired state is also the one-shot build:

```bash
wrangler d1 execute <DATABASE> --file node_modules/@y-core/forge/src/auth/schema.sql
```

The tables carry rulings that change what you write against them. **The `auth_` prefix is fixed.** And **case-insensitive addresses are a column,
not a collation**: every write feeds `email_key` with `normalizeEmail(email)`, which trims, applies NFKC and lowercases, and a `CHECK` refuses an
address that expands past 254 characters. Plus tags and dots in the local part are **kept** — `aurora+news@` is a different mailbox from
`aurora@` everywhere except Gmail.

No table carries a TTL: every read holds a row against the clock.

---

## Rotating the signing secret

A rotation is prepending a secret. `importAuthKeyRing` takes hex root secrets **newest first**, and derives each key id from the key material
rather than taking one you type. Hold them in one variable, comma-joined, and split it with `keyRingSecrets` from `@y-core/forge/keyring`:

```ts
const keys = await importAuthKeyRing(keyRingSecrets(c.env.AUTH_KEY_RING));
```

Mark the variable `# forge:ring` in `.dev.vars`, so `forge cf sync --commit --local --rotate AUTH_KEY_RING` prepends a new key and keeps the old
ones rather than replacing the ring.

**Rotate on a schedule, not only on suspicion.** Every seal spends part of a bounded per-key budget, and crossing it costs the integrity of
everything already sealed under that key — the bound, the failure mode and the cadence to hold to are [`AUTH_MOUNTING.md`][am-7] §7.

Tokens minted under the old key keep opening for as long as it stays in the list, so leave the old secret in place for at least the longest TTL a
token of yours carries. A TOTP secret carries no TTL, so a secret that ever wrapped one stays until `authKeysRetirable` says otherwise: drop it
early and each of those users spends a recovery code and enrols their authenticator app again. A token consumed before a rotation stays consumed
after one, because its nonce key is derived from the **token's own** key id.

**Each secret is held to [`SECURITY_HARDENING.md`][sh-8] §8's strength rule**, which `importAuthKeyRing` applies and `resolveAuthServices`
applies again to a ring built by hand. Generate each with `openssl rand -hex 32`, and source them from Worker secrets, never from a literal.

---

## Getting a user back in when a factor stops working

What a user sees when a key, a device or their codes go missing, and their way back from each, is [`AUTH_FLOWS.md`][af-8] §8. What falls to you
is noticing a lost key, and resetting an account nothing else can reach.

**Treat `auth.factor.unusable` as a key to put back.** The verify page logs it at warn, with the factor's `kind`, when an authenticator-app
secret will not open under the ring — in practice, a secret dropped from the ring while enrolments were still sealed under it. It is written
through `requestLog`, so it reaches your logs only where `requestLogger` from `@y-core/forge/logging` is mounted. Append the dropped secret to the
end of the ring, keeping the active one first, and every enrolment still under it works again, with nobody re-enrolling.

**Reset an account only for a user who has nothing left to step up with.** Once every second factor and every recovery code is gone, only an
administrator can let them back in. The admin factors page, `adminRoutes`' `users.factors`, carries the reset control. From a route of your own the
same write is `resetFactors` on the `AdminUserStore` you hand `resolveServices`.

**Confirm who is asking before you reset.** The user signs back in on their address alone, which makes the reset the one path that admits an
account on less than it needed before ([`AUTH_FLOWS.md`][af-8e] §8e). The shipped action refuses an administrator's own account; a route of your
own must refuse it too, because the store does not.

---

## Clearing expired challenges and nonces

Challenges and one-shot nonces live on the same D1 binding every durable store does, and SQLite keeps an expired row. Call the purge from your
Worker's scheduled handler:

```ts
export default {
  async scheduled(event, env) {
    await purgeAuthEphemera(createD1Client(env.DB), Date.now());
  },
};
```

**A deployment that never calls it is slower, not wrong.** Correctness rests on the `expires_at` predicate every read carries.

`createChallengeStore(db, { prefix })` and `createNonceStore(db, { prefix })` namespace their key text inside those shared tables. Omit `prefix`
for the default; an empty string is **refused**.

### Bounding how long a key rotation waits

A `totpWrap` secret is droppable once no factor is sealed under it, and a verification re-seals a stale one on its own — but only for users who sign
in. `purgeStaleTotpSecrets` closes the window on the ones who do not:

```ts
const dropped = await purgeStaleTotpSecrets(createD1Client(env.DB), Date.now(), {
  keys: ring,
  idleForMs: 90 * 86_400_000,
  requirement: "mandatory",
});
```

It answers how many rows it dropped. **It takes the ring, not a key id** — the statement deletes the complement of the active key, so a key id
naming the _retiring_ one would delete the live enrolments instead; a ring whose `activeKeyId` is not the shape `importAuthKeyRing` derives is
refused before any statement runs.

The window is measured from `last_verified_at` — the moment a code was last _accepted_ — or from enrolment for a row that never had one. Not from
`updated_at`: a spent guess moves that too, so a user whose app drifted and who keeps trying wrong codes would hold their own row outside the window
indefinitely, and they are exactly who this is for. `idleForMs` is held between a day and a year. **`requirement` is refused unless it is
`mandatory`**: a dropped row routes the user to re-enrol only where the factor is demanded of them, and under any other requirement they lose a
second factor with nothing asking them to replace it.

**Backfill `last_verified_at` when you add the column, or the first purge drops standing enrolments.** A row that predates the column reads NULL,
the window falls back to `created_at`, and every confirmed factor not re-sealed since the rotation is old enough to delete. Run this once, in the
migration that adds the column:

```sql
UPDATE auth_factors SET last_verified_at = <migration time>
  WHERE last_verified_at IS NULL AND confirmed_at IS NOT NULL;
```

The `confirmed_at IS NOT NULL` half is what keeps the fallback doing its other job: an abandoned, never-confirmed ceremony stays purgeable on
`created_at`, and without that nothing would ever let the retiring key go.

Whether the key is droppable at all is `authKeysRetirable(factors, "totp-app", ring)` — see [`AUTH_MOUNTING.md`][am-7] §7.

---

## Backing a store contract yourself

Every store is a contract with a shipped D1 adapter ([`NAMESPACES.md`][namespaces-5h] §5h). To back one with something else, implement the
contract — and know that **the methods below carry rules the caller does none of**:

| Method | What your statement must do |
| --- | --- |
| `UserStore.revokeSessions` | Raise a monotonic barrier: never lower one already stamped later |
| `FactorStore.countAttempt` | Find the factor **and** spend one guess in the one statement, reopening a budget spent longer ago than `lockoutMs`. `null` is "no such factor, or the budget refusing" |
| `FactorStore.recordVerification` | Write the counter, the cleared budget, `last_verified_at` **and** any re-sealed `secret` in the one statement, under the `last_counter <` guard. Split across two, a replayed code re-seals a row it did not advance |
| `FactorStore.recordVerification` — and nothing else | **This is the only method that may stamp `last_verified_at`.** `purgeStaleTotpSecrets` deletes by it; leave it NULL and the window is measured from enrolment instead, so the first run drops the factor of every long-standing user, including the ones signing in daily. Stamp it anywhere a guess is merely spent and the purge never reaches anyone |
| `FactorStore.countSecretsNotUnder` | Read the key id out of the secret's own first six bytes. A column holding it separately can disagree with the bytes that actually decide whether the secret opens |
| `FactorStore.remove` | Delete the factor and, in the same batch, the user's recovery codes and `recovery-code` row once no confirmed `totp-app` or `passkey` remains. Split, a failure between them leaves an account holding codes alone |
| `RecoveryCodeStore.consume` | Spend a live, unused code and clear the factor's `failed_attempts` in one batch — clearing only when this call spent the code. A staged code, a used one or another user's never matches |
| `RecoveryCodeStore.commit` | Swap the staged set in for the live one and confirm the factor in one batch, so a failure leaves the old set working |
| `AdminUserStore.resetFactors` | Delete the user's factors, credentials and recovery codes, and raise the revocation barrier, in one batch |
| `IdentityLinkStore.unlink` | Carry the owner in the `WHERE`, so a link id belonging to somebody else unlinks nothing |
| `OtpStateStore.discard` | Delete **that named code** and no other, so an undelivered issue returns its cooldown without wiping a racing issue that did send |
| `OtpStateStore.issue` / `countAttempt` | Decide in one conditional statement. A read then a write hands every parallel request a free extra guess |
| `AccessTokenStore.recordUse` | Decide the throttle in the one conditional statement: stamp `last_used_at` only where none landed after `at - intervalMs`, and report whether it did |
| `AccessTokenStore.findByHash` | Answer `null` for a token whose owner is deactivated, so a deactivated account's tokens stop verifying without being revoked |

Contract-wide rules hold for every method you write:

- **Not-found is `data: null`, never an error** — the same shape `KVStore.get` and `D1Client.queryOne` already answer with.
- **I/O failure is one `AuthStoreError`**, carried in the `Result` and never thrown across the boundary. A domain rule refusing is a reason union
  on the service that owns the rule, not this class.
- **Every write reports whether it changed a row** — `false`, or an `AdminUserOutcome` naming which guard refused — so a write against an id that
  is not there is never mistaken for one that landed.

`AuthStoreError` carries `code`, `operation`, and `constraint` where the backend named an index. Branch on `code`: `conflict` is a uniqueness
violation the caller can act on, `invalid` says the caller's own value was refused (rendering that as an outage tells a visitor the deployment is
down when their address was simply too long), and `unavailable` is everything else.

`ChallengeStore` and `NonceStore` are shapes rather than tables, and both are load-bearing: `ChallengeStore.take` is **read-and-delete**, and
`NonceStore.markConsumed` reports `true` **only the first time**.

---

## Testing a mount

[`src/auth/web/mount.test.ts`](./web/mount.test.ts) is a working mount driven end to end, and reading it is the shortest way in.

**Use `fakeAuthD1` for the durable side and `fakeKV` for the session.** State an account in domain terms and the fake answers the user and factor
stores' own statements, binding each id as its 16 `BLOB` bytes:

```ts
const env = { DB: fakeAuthD1([{ id: ADA, email: "ada@example.com", isAdmin: true, factors: [{ kind: "passkey" }] }]), KV: fakeKV() };
```

An enrolment is confirmed by default; `confirmedAt: null` gives the unconfirmed row that makes a user owe an enrolment, which is how the
pending-enrolment and step-up paths are reached. A statement the fake does not model answers no rows, so a test needing a challenge to survive a
round trip hands the ceremony a `ChallengeStore` of its own.

**Build a UUID with `uuidToBytes` from [`@y-core/forge/storage/db`][storage-readme], not from `crypto`.** That subpath is where the UUIDv7 set is
surfaced, alongside `uuidFromBytes`, `uuidv7` and `uuidv7Bytes`. `fakeAuthD1` converts for you, so you need these only when asserting against a
bound parameter.

**A signed-in session is built, not faked.** Mount the same `createAnonymousSession` the app mounts, then write `AUTH_SESSION_KEY` — and
`AUTH_STEP_UP_SESSION_KEY` for a session that has already stepped up — through `sessionCtx` in a middleware ahead of the guards. For an anonymous
mutation, seed nothing: carry the cookie from the page `GET` to the `POST` as a browser does, and the id the CSRF token was minted under is the
id the `POST` is verified against.

**The CSRF guard answers before the auth guards do.** With `csrfProtection` mounted ahead of the guard chain — the order
[`AUTH_MOUNTING.md`][am-1] §1 gives — an anonymous, tokenless `POST` to a ceremony endpoint answers **`403` as plain text**, not the `401` JSON
that group's medium implies. Assert the 403 for a tokenless request and the 401 only for one carrying a valid token, or the test asserts the
wrong layer.

---

## Security

**Never render a reason a flow or a store hands back.** `redactSigninReason` is required at the rendering boundary, and `AuthEmailChangeReason`,
`AuthFactorReason`, `AuthTokenReason`, `AccessTokenReason` and `AuthStoreError` have no equivalent — they are for logs and branching only
([`FORGE_ERRORS.md`][eh-1c] §1c).

**Session lifetime is absolute, and two bounds refuse one.** A session is refused once it is older than `AUTH_SESSION_MAX_MS` measured from when
it was established and never refreshed, and again when it was established at or before the account's revocation barrier — which is how removing a
passkey, removing the authenticator-app factor, an administrator's factor reset or completing an address change reaches sessions this request
cannot see. A session carrying no
established-at stamp is over rather than unbounded, so the deployment that adds this signs its live population out once.

**The emailed code is rate-limited by a cooldown, not by a count.** **Bounding a caller's rate is a different control, and forge ships no numbers
for it** ([`AUTH_FLOWS.md`][af-7] §7).

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

**Deleting a user removes its children in one batch, and the batch rolls back whole.** The `ON DELETE CASCADE` clauses in the schema are
documentation: D1 does not guarantee `PRAGMA foreign_keys` is on.

**`AuthFactorService` is a union discriminated on `enrolment`, at the top level.** Write `if (service.enrolment === "explicit")` to reach
`beginEnrolment` and `completeEnrolment`.

**Offering an implicit factor as a second factor never owes an enrolment.** It is confirmed the moment it is offered and always satisfies the
step-up, whatever requirement you give it.

**`authFactorContext(subject)` is the only place forge turns a subject into a role**, mapping `isAdmin` to `AUTH_ADMIN_ROLE`. Passing no context
at all silently degrades `mandatoryForRoles` to `optional`; `resolve(userId, context?)` takes a context of your own for a deployment whose roles
go beyond `isAdmin`.

---

## See also

- [`docs/AUTH_MOUNTING.md`][am] — the mount: the builders, the order, the guard table, the seams forge does not ship, and embedding one view
- [`docs/AUTH_FLOWS.md`][af] — every flow end to end, and the limits this release carries
- [`docs/NAMESPACES.md`][namespaces-5h] §5h — the rule binding every `auth` subpath, and why identity is not `security`'s
- [`warden/canon/libs/BOUNDARIES.md`][boundaries-2c] §2c — why identity is application-layer, and what that buys in testability
- [`src/session/README.md`][session-readme] — the session the identity rides on, and the cookie under it
- [`src/form/README.md`][form-readme] — `csrfProtection`, the token every auth mutation carries
- [`src/storage/README.md`][storage-readme] — the `D1Client` every adapter is built over, and the UUIDv7 set
- [`src/crypto/README.md`][crypto-readme] — the sealed primitives this namespace builds on

[af]: ../../docs/AUTH_FLOWS.md
[af-1]: ../../docs/AUTH_FLOWS.md#1-signup
[af-2a]: ../../docs/AUTH_FLOWS.md#2a-what-each-requirement-demands
[af-2b]: ../../docs/AUTH_FLOWS.md#2b-what-the-visitor-is-told
[af-2c]: ../../docs/AUTH_FLOWS.md#2c-where-a-resolution-sends-the-visitor
[af-3]: ../../docs/AUTH_FLOWS.md#3-passkeys
[af-3d]: ../../docs/AUTH_FLOWS.md#3d-prf-output-stays-in-the-page
[af-5]: ../../docs/AUTH_FLOWS.md#5-email-change
[af-6]: ../../docs/AUTH_FLOWS.md#6-admin-management
[af-7]: ../../docs/AUTH_FLOWS.md#7-limits-in-this-release
[af-8]: ../../docs/AUTH_FLOWS.md#8-recovery--no-lost-value-locks-an-account-out-or-lets-it-in-on-less
[af-8b]: ../../docs/AUTH_FLOWS.md#8b-a-confirmed-second-factor-comes-before-any-enrolment
[af-8c]: ../../docs/AUTH_FLOWS.md#8c-recovery-codes
[af-8e]: ../../docs/AUTH_FLOWS.md#8e-the-administrators-reset-is-the-last-resort
[am]: ../../docs/AUTH_MOUNTING.md
[am-1]: ../../docs/AUTH_MOUNTING.md#1-the-mount-in-order
[am-2]: ../../docs/AUTH_MOUNTING.md#2-the-route-groups-and-their-guards
[am-3]: ../../docs/AUTH_MOUNTING.md#3-what-forge-does-not-ship
[am-6]: ../../docs/AUTH_MOUNTING.md#6-embedding-an-auth-view-in-your-own-page
[am-7]: ../../docs/AUTH_MOUNTING.md#7-rotating-the-key-ring
[boundaries-2c]: ../../warden/canon/libs/BOUNDARIES.md#2c-why-identity-is-application-layer
[crypto-readme]: ../crypto/README.md
[dm]: ../../docs/DATABASE_MANAGEMENT.md
[eh-1c]: ../../docs/FORGE_ERRORS.md#1c-guardresult-and-validationresult-domain-aliases
[eh-5e]: ../../docs/FORGE_ERRORS.md#5e-startup-invariants--env-validation-and-binding-resolvers-throw
[form-readme]: ../form/README.md
[keyring-readme]: ../keyring/README.md
[namespaces-5h]: ../../docs/NAMESPACES.md#5h-auth--identity-and-only-the-domain-of-it
[ram-6]: ../../docs/ROUTING_AND_MIDDLEWARE.md#6-the-page-shell
[session-readme]: ../session/README.md
[sh-8]: ../../docs/SECURITY_HARDENING.md#8-secret-strength--one-rule-for-every-secret
[storage-readme]: ../storage/README.md
[ucr-2a]: ../../docs/UI_CLIENT_RUNTIME.md#2a-state-only-islands-versus-contract-bearing-scopes
