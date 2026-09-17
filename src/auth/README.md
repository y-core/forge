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
| `@y-core/forge/auth/client` | bundling the browser half of the passkey ceremony. A side-effect import with no value exports |

The edge is one-way — `auth/web` imports `auth`, and `auth` never names `auth/web` ([`NAMESPACES.md`][namespaces-5h] §5h). A domain rule that
wants to redirect returns a reason instead, and the web layer alone turns it into a `Response`.

**Standing the capability up is [`AUTH_MOUNTING.md`][am] §1** — the builders, the one order that works, the guard table and the seams you supply.
**What each flow then does is [`AUTH_FLOWS.md`][af].** This README teaches the calls.

---

## Getting started

Everything the auth pages run against is built **per request**, because a passkey ceremony is bound to this request's session and every store
needs a binding off `c.env`. That per-request builder is the one function you write:

```ts
import {
  type AuthIssueOutcome,
  createAdminUserService,
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
    admin: createAdminUserService({ users: createAdminUserStore(db) }),
  };
}
```

Hand that to `AuthWebOptions.resolveServices` and mount the route builders as [`AUTH_MOUNTING.md`][am-1] §1 lays them out.
`resolveServices` is called **once per request** however many guards, loaders and actions ask for it, so building every store inside it costs one
build.

The seams above with no default and no way to guess them are `notifier` (next section), `defer` and `address`. `defer` must be
`executionCtx.waitUntil` or an equivalent — doing the work inline reopens the timing oracle the deferred issue exists to close.

**`resolveAuthServices` throws rather than returning a `Result`**, because the failures it can have — an `activeKeyId` the ring has no key for, a
key under 32 bytes, COSE `-8` on a runtime with no Ed25519 — are configuration that cannot work at all. Resolving a binding throws; operating on
a resolved store answers a `Result` ([`FORGE_ERRORS.md`][eh-5e] §5e).

---

## Choosing which factors a deployment offers

`AuthFactorsOptions.offered` is the whole policy. Each entry declares a service `primary` or `second`, and a `second` entry says what this
deployment demands of it:

```ts
const factors = createFactorRegistry(enrolments, {
  offered: [
    { service: emailOtp, role: "primary" },
    { service: totpApp, role: "second", requirement: "mandatory" },
  ],
});
```

**Exactly one entry may be `primary`, and only a factor that identifies the visitor may take it** — today `email-otp`, because the visitor types
the address. A passkey or an authenticator app proves possession and names nobody, so offering either as primary is a type error, and
`createFactorRegistry` refuses it at construction for a caller casting past the type. `authIdentifies(kind)` is the guard if you need to test
one.

The choice you are actually making is the `requirement` on each second factor, and [`AUTH_FLOWS.md`][af-2a] §2a is the table of what each one
demands. Consequences worth knowing before you pick:

- **An all-optional offering makes the enrolment pages unreachable**, because nobody is ever sent to them — §2a says what to do instead.
- **A primary factor is not available as a second factor.** Proving it again proves nothing new, so it is excluded by construction.

Each shipped factor is built per request alongside the stores, and each takes one seam that is a `UserStore` read and is easy to miss:
`EmailOtpOptions.address`, `PasskeyFactorOptions.subject`, `TotpAppFactorOptions.account`. The passkey factor additionally takes **this request's
session id**, which is what its challenge is bound to — a registry built once at bootstrap issues challenges bound to nobody.

Every numeric knob on a factor — `digits`, `ttlMs`, `maxAttempts`, `cooldownMs`, `period`, `secretBytes`, `lockoutMs`, `ttlSeconds` — is
optional, and each is bounded at construction with a message naming the bound it broke. Omit one for the matching `AUTH_*` constant.

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
the attempt rather than reporting a code that never left the building.

**A code nobody could receive costs no cooldown.** When `send` fails, the email-OTP factor rolls the claimed cooldown back by discarding that
named code, so a second issue that raced this one and did send is left alone.

---

## Signing a visitor in without forge's pages

The flows are callable on their own, and `auth/web`'s actions are thin wrappers over exactly these calls. Sign-in is two requests: a
request that defers the issue, and a completion.

```ts
const challenge = services.signin.request(email, Date.now()); // returns immediately; the code is deferred
// …later, with what the visitor typed:
const outcome = await services.signin.complete(email, code, Date.now());
if (!outcome.ok) return page(redactSigninReason(outcome.error));
switch (outcome.data.resolution.status) {
  case "enrolment-required":
    return redirect(enrolmentPageFor(outcome.data.resolution.kinds));
  case "step-up-required":
    return redirect(verifyPath);
  default:
    return establish(outcome.data.user);
}
```

**`request` returns synchronously and tells an address it knows nothing from one it does not** — the unknown branch spends the same statements
the known one spends. That is why `AuthSigninOptions` takes `state` and `nonces` even on a deployment whose primary factor is not the emailed
code: they are the decoy's stores, and a decoy holding none is a latency oracle.

**A resolution that is not `satisfied` is a success, not a refusal.** Needing to enrol or to step up is a normal outcome of a correct sign-in, so
it is a page to visit rather than a 4xx — [`AUTH_FLOWS.md`][af-2c] §2c is where each one sends the visitor. `requestStepUp` and `stepUp` run the
second factor for a session that is already signed in.

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

The shape of that snippet is carrying rules of its own. The **error** channel is a union of a reason string and a class, so both arms are told
apart with `instanceof` rather than by value. The **success** value is discriminated on `status`, because a change takes two links and the first
one only forwards the second. And a `forwarded` page has to say a step is left — [`AUTH_FLOWS.md`][af-5] §5 owns both stages, why the first
link goes to the address the account already holds, and why a completed move signs every session out.

On the request side, render `AuthEmailChangeRequest.sentTo` and never the address the visitor typed: which address was mailed
depends on whether the account's own is verified.

The confirmation page is yours to render and `resolveAuthView` does not reach it — it is no `AuthViewName`. Render it through the same document
shell the auth pages use ([`ROUTING_AND_MIDDLEWARE.md`][ram-6] §6) and it comes out inside the chrome they already render in.

---

## Managing accounts from an admin page

`createAdminUserService({ users })` takes an `AdminUserStore` and is the read-and-write surface an admin route holds: `list`, `search`, `view`,
`countAdmins`, `claimFirst`, `elevate` / `demote`, `deactivate` / `reactivate`, `remove`.

**`UserStore` and `AdminUserStore` are two contracts on purpose.** A sign-in service given a `UserStore` cannot delete a user or set the admin
flag, because neither method is on the type it was given — not merely unused. Build the administrative one only where an administrative route
needs it.

Every write answers an `AdminUserOutcome` rather than a boolean, so a refusal says which guard fired: `changed`, `not-found`, `admin-exists`,
`self`, or one of the last-admin refusals that `isLastAdminRefusal(outcome)` tests for. The service adds no guard of its own — each is
decided in the statement that writes, so two concurrent demotions leave one admin standing rather than none. What each refusal means to a
visitor, the prefix-only search, and the first-admin bootstrap are [`AUTH_FLOWS.md`][af-6] §6.

**Deactivation takes effect on the next request, not the next sign-in.** `resolveAuthIdentity` re-reads the user every request and answers `null`
for a deactivated one, dropping that session's auth keys as it does — so reactivating the account does not revive the cookies issued before it,
and the visitor signs in again. A store outage denies without clearing, because signing every user out of a database blip is the worse failure.

---

## Guarding a route you wrote yourself

`createAuthGuards` builds the stack for every group in one call and is what a mount uses ([`AUTH_MOUNTING.md`][am-2] §2 is the table it cuts them
from). The guard primitives are exported for a page you route yourself:

| Guard | Admits |
| --- | --- |
| `resolveAuth` | Everyone, establishing the identity where the session carries one — for a page that serves anonymous and signed-in visitors alike |
| `requireAuth` | A signed-in, non-deactivated visitor. It is what puts the identity on `authCtx` |
| `requireAdmin` | An administrator. Anyone else gets a plain 403, and it throws if `requireAuth` did not run first |
| `requireEnrolment` | A visitor who owes no factor. An owed enrolment or step-up is a redirect; an unreadable factor store is a 503 |
| `requirePendingEnrolment` | **Only** a visitor who owes an enrolment, so an owed step-up cannot be enrolled around |
| `requireFreshStepUp` | Every safe method, and a state-changing one only behind a recent step-up — or from a user who owes none |

Order is the contract: every guard below `requireAuth` in that table reads the identity it establishes, and a standalone one cannot know what was
mounted
before it, so a wrong order fails on the first request rather than at construction.

Read the identity through `authCtx` — `authCtx.get(c)` where a guard has run, `authCtx.getOptional(c)` otherwise. The store is read once per
request however many guards run, so mounting `resolveAuth` globally costs the guarded routes nothing extra.

**`requireFreshStepUp` is on unless you turn it off**, and `freshStepUpMaxAgeMs` is its window: omit it for `AUTH_FRESH_STEP_UP_MS`, or pass
`null`, which is the only opt-out. It demands nothing of a user whose own resolution owes no step-up, so a deployment offering no second factor
is not locked out of its own admin pages.

**A guard refuses in the medium its group answers in.** Pass `medium: "json"` and `requireAuth` answers `401 {"error": …}` and the enrolment
guards `403 {"error": …}` instead of redirecting — which is what a browser controller posting a ceremony step can actually read.

Between requests, the session is written in one place per fact: `establishAuthSession`, `renewAuthSession`, `markAuthStepUp`,
`markAuthSigninPending` / `resolveAuthSigninPending`, and `clearAuthSession`. Reach for the `AUTH_*_SESSION_KEY` constants only to read the
session directly.

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
item marked for members does not vanish for them. Which items carry which tokens is yours to decide; the token names are not, or two apps spell
them differently.

`authNav` returns a **factory**, so call it at module scope and the resolver it hands back per request: the signing key is then imported per
isolate rather than on every render. It reads the identity off `authCtx`, so `resolveAuth` or a `requireAuth` must run before the layout renders.
An anonymous request gets `activeFilters` and an empty slot map, and no key is imported and no token signed.

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

The pages render into the shell your app registers, the same one every other mount renders into ([`ROUTING_AND_MIDDLEWARE.md`][ram-6] §6).
`AuthWebOptions` carries no `layout` and no `document`, so there is no second chrome configuration to keep in step.

---

## Getting the shipped pages into your CSS build

`forge.css` does not scan the auth views, so an app that mounts them must add this line to its own stylesheet, copied as it stands — the path is
relative to the stylesheet, and this is what it is from an `src/` beside `node_modules`:

```css
@source "../node_modules/@y-core/forge/src/auth";
```

Tailwind's scanner follows the symlink a `file:` dependency installs, so it works against a local checkout too. **Do not A/B it against your
built stylesheet to check.** Every class the auth views use is also produced by forge's `ui/core` and `ui/chrome` scan set today, so both
builds come out the same size — an overlap of the current markup, not a guarantee. The line is still required.

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

**Without that import the ceremony buttons render correctly and do nothing.** The scope is eager, because the markup carries no `data-on-*`
action of its own and an unsupported browser must be told before the button is pressed rather than after.

The server half stamps a declared DOM contract onto the scope root and the browser half reads it back, so neither side hand-writes a string the
other has to match. Import the `PASSKEY_*` constants from `@y-core/forge/auth` when you render a ceremony root yourself: `PASSKEY` for the
`data-ref` names, `PASSKEY_SCOPE`, `PASSKEY_MODE_ATTR`, the `PASSKEY_OPTIONS_*` and `PASSKEY_VERIFY_*` path and token attributes,
`PASSKEY_CSRF_HEADER_ATTR` with
its `PASSKEY_CSRF_HEADER_DEFAULT`, and `PASSKEY_REDIRECT_ATTR` with its `PASSKEY_REDIRECT_FALLBACK`.

**A token per endpoint, never one shared**, because `csrfProtection` binds a token to a path and a ceremony spans two endpoints — naming them
apart is what stops
either being sent to the wrong one ([`AUTH_FLOWS.md`][af-3] §3).

To react to a ceremony from your own code, listen for `PASSKEY_OUTCOME_EVENT` on the scope root: its `detail` is a `PasskeyOutcomeDetail`, whose
`reason` is absent exactly when the ceremony succeeded. The scope root is hand-rendered rather than wrapped in `Resumable`
([`UI_CLIENT_RUNTIME.md`][ucr-2a] §2a).

---

## Sealing a value into a link of your own

`encodeAuthToken(ring, purpose, payload, ttlMs, options?)` seals a payload under AES-256-GCM with a per-purpose subkey, and `decodeAuthToken`
answers a `Result<AuthTokenClaims, AuthTokenReason>`. Use them where a value has to survive a round trip through an email or a URL and must not
be readable on the way — which is why the email-change confirmation is encrypted rather than merely signed: a URL lands in browser history, the
`Referer` header, link scanners and proxy logs.

A token is authenticated before it is judged expired, so a reason is trustworthy when you get one. `AuthTokenReason` is for your logs and your
branching, never for a client.

**Every `AuthTokenPurpose` is taken, and `identity` in particular is not a spare.** It is the email-change purpose and nothing else uses it; minting
a second use against it would open every email-change token to whatever the new caller accepts as a payload. A genuinely new use needs a purpose of
its own, which is a change to this namespace rather than a call you can make.

`authNonceKey(ring, token)` derives the key to spend a token against a `NonceStore` — an HMAC under a secret subkey rather than a bare hash of
the token, so holding the token is not enough to ask the nonce store whether it has been used.

---

## Applying the auth schema to your database

`src/auth/schema.sql` is the **desired state** — what the schema is, as one readable file. **This library ships no SQL that runs**, and nothing
is generated beside it. Your app names the file by path in its own host config, alongside its own:

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

For a database that will never be migrated, the desired state is also the one-shot build:

```bash
wrangler d1 execute <DATABASE> --file node_modules/@y-core/forge/src/auth/schema.sql
```

The tables carry rulings that change what you write against them. **The `auth_` prefix is fixed** — making it configurable would need raw
identifier concatenation, which `src/storage/db/sql.ts` exists to forbid. And **case-insensitive addresses are a column, not a collation**: every
write feeds `email_key` with `normalizeEmail(email)`, which trims, applies NFKC and lowercases, and a `CHECK` refuses an address that expands
past 254 characters. Plus tags and dots in the local part are **kept** — `aurora+news@` is a different mailbox from `aurora@` everywhere except
Gmail.

No table carries a TTL and none needs one: every read holds a row against the clock, so an expired row is already inert.

---

## Rotating the signing secret

A rotation is prepending a secret. `importAuthKeyRing` takes hex root secrets **newest first**, and each key id is derived from the key material
rather than typed, so the id in a token frame and the id in the ring can never disagree:

```ts
const keys = await importAuthKeyRing([c.env.AUTH_SECRET_NEW, c.env.AUTH_SECRET_OLD]);
```

Tokens minted under the old key keep opening for as long as it stays in the list, so leave the old secret in place for at least the longest TTL a
token of yours carries. A token consumed before a rotation stays consumed after one, because its nonce key is derived from the **token's own**
key id.

**Each secret must be at least 32 bytes, and a degenerate one is refused rather than merely a short one.** `importAuthKeyRing` throws on a secret
whose bytes are all one value, and on one carrying fewer than eight distinct byte values: both say the secret was never generated. Source them
from Worker secrets, never from a literal.

---

## Clearing expired challenges and nonces

Challenges and one-shot nonces live on the same D1 binding every durable store does, and SQLite keeps an expired row where KV would have dropped
it. Call the purge from your Worker's scheduled handler:

```ts
export default {
  async scheduled(event, env) {
    await purgeAuthEphemera(createD1Client(env.DB), Date.now());
  },
};
```

**A deployment that never calls it is slower, not wrong.** Correctness rests on the `expires_at` predicate every read carries, never on a row
being gone.

`createChallengeStore(db, { prefix })` and `createNonceStore(db, { prefix })` namespace their key text inside those shared tables. Omit `prefix`
for the default; an empty string is **refused**, because it drops the separator with it and the store then shares a keyspace with every other
store on the binding.

---

## Backing a store contract yourself

Every store is a contract with a shipped D1 adapter, and each adapter is named for the contract it fulfils rather than the product beneath it
([`NAMESPACES.md`][namespaces-5h] §5h). To back one with something else, implement the contract — and know that **the methods below carry rules the
caller does none of**, because they are decided in the statement that writes:

| Method | What your statement must do |
| --- | --- |
| `UserStore.revokeSessions(id, at)` | Raise a monotonic barrier: never lower one already stamped later |
| `FactorStore.countAttempt(userId, kind, maxAttempts, at, lockoutMs)` | Find the factor **and** spend one guess in the one statement, reopening a budget spent longer ago than `lockoutMs`. `null` is "no such factor, or the budget refusing" |
| `IdentityLinkStore.unlink(id, userId)` | Carry the owner in the `WHERE`, so a link id belonging to somebody else unlinks nothing |
| `OtpStateStore.discard(userId, token)` | Delete **that named code** and no other, so an undelivered issue returns its cooldown without wiping a racing issue that did send |
| `OtpStateStore.issue` / `countAttempt` | Decide in one conditional statement. A read then a write hands every parallel request a free extra guess |

Contract-wide rules hold for every method you write:

- **Not-found is `data: null`, never an error** — the same shape `KVStore.get` and `D1Client.queryOne` already answer with.
- **I/O failure is one `AuthStoreError`**, carried in the `Result` and never thrown across the boundary. A domain rule refusing is a reason union
  on the service that owns the rule, not this class.
- **Every write reports whether it changed a row** — `false`, or an `AdminUserOutcome` naming which guard refused — so a write against an id that
  is not there is never mistaken for one that landed.

`AuthStoreError` carries `code`, `operation`, and `constraint` where the backend named an index. Branch on `code`: `conflict` is a uniqueness
violation the caller can act on, `invalid` says the caller's own value was refused (rendering that as an outage tells a visitor the deployment is
down when their address was simply too long), and `unavailable` is everything else.

`ChallengeStore` and `NonceStore` are shapes rather than tables, and both are load-bearing: `ChallengeStore.take` is **read-and-delete**, which
makes "clear the challenge even when verification fails" structural rather than a branch someone forgets; and `NonceStore.markConsumed` reports
`true` **only the first time**, which is what makes a consumed token stay consumed past its own expiry.

---

## Testing a mount

[`src/auth/web/mount.test.ts`](./web/mount.test.ts) is a working mount driven end to end, and reading it is the shortest way in. What follows
about testing this capability is not derivable from any signature.

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
`AuthFactorReason`, `AuthTokenReason` and `AuthStoreError` have no equivalent — they are for logs and branching only ([`FORGE_ERRORS.md`][eh-1c]
§1c). Telling a known address from an unknown one is the account-enumeration oracle the whole deferred-issue design exists to close.

**Session lifetime is absolute, and two bounds refuse one.** A session is refused once it is older than `AUTH_SESSION_MAX_MS` measured from when
it was established and never refreshed — a sliding window is one an attacker who took a session can keep alive forever — and again when it was
established at or before the account's revocation barrier, which is how removing a passkey, removing the authenticator-app factor or completing
an address change reaches sessions this request cannot see. A session carrying no established-at stamp is over rather than unbounded, so the
deployment that adds this signs its live population out once.

**The emailed code is rate-limited by a cooldown, not by a count, and the difference matters.** Issuing needs only an address, so any
per-identity ceiling is a budget an unauthenticated attacker can spend on the victim's behalf — a handful of posts naming an address would buy a day
with no email-OTP, which where it is the primary factor is a repeatable account outage. A cooldown bounds the mail one address can trigger while
leaving the victim a minute from a code. **Bounding a caller's rate is a different control, and forge ships no numbers for it**
([`AUTH_FLOWS.md`][af-7] §7).

**A credential this runtime cannot verify is never advertised.** `AUTH_SUPPORTED_ALGORITHMS` is the default set, and COSE `-8` is opt-in behind a
probe that throws at resolution rather than at the first sign-in ([`NAMESPACES.md`][namespaces-5h] §5h). Enrolling a credential nothing can check
locks a user out of the account they just made.

**Forge's own auth pages default to `Cache-Control: no-store`** — a sign-in, an account or an admin page has no business in a shared cache or on
the back button after a sign-out — and carry `robots: "noindex"`. The header is merged rather than imposed, so a page naming its own still wins;
a page you route yourself has to set both.

**Mount `csrfProtection` after the session middleware, never before.** Its subject resolver runs ahead of `next()`, so one mounted first reads no
session, binds the token to nobody, and refuses every mutation with a `[csrf]` warning. The chain order that gets this right is
[`AUTH_MOUNTING.md`][am-1] §1's.

---

## Gotchas

**Every store method is total, including on input you never validated.** An id that is not a canonical UUID answers what that method calls no
such row — `null`, `false`, or `"not-found"` — and binds no statement at all, so a crafted `?after=u9` is an empty page and not a 500. An insert
is the one shape with no in-band answer of that kind, so a malformed owner id comes back as `unavailable`, which is what the foreign key would
have said.

**`list` and `search` clamp `limit` in the adapter.** SQLite reads `LIMIT -1` as no limit, so an unclamped page size is a whole-table read a
query string could ask for.

**Deleting a user removes its children in one batch, and the batch rolls back whole.** The `ON DELETE CASCADE` clauses in the schema are
documentation: D1 does not guarantee `PRAGMA foreign_keys` is on, so correctness cannot rest on it.

**`AuthFactorService` is a union discriminated on `enrolment`, at the top level.** Write `if (service.enrolment === "explicit")` to reach
`beginEnrolment` and `completeEnrolment`; the discriminant is not nested inside `capabilities` because TypeScript narrows only a direct one, and
a nested one is the shape that gets papered over with a cast.

**Offering an implicit factor as a second factor never owes an enrolment.** It has no factor row by design, so it is confirmed the moment it is
offered and always satisfies the step-up, whatever requirement you give it.

**`authFactorContext(subject)` is the only place forge turns a subject into a role**, mapping `isAdmin` to `AUTH_ADMIN_ROLE`. Passing no context
at all silently degrades `mandatoryForRoles` to `optional`, which is why no caller in forge does; `resolve(userId, context?)` takes a context of
your own for a deployment whose roles go beyond `isAdmin`.

**`UserStore.findByWebAuthnId` and the branch of `verifyPasskeyAuthentication` that resolves an account from a user handle alone have no caller in
forge, and are kept deliberately.** They are the substrate a discoverable login would need, unit-tested and unused.

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
[af-5]: ../../docs/AUTH_FLOWS.md#5-email-change
[af-6]: ../../docs/AUTH_FLOWS.md#6-admin-management
[af-7]: ../../docs/AUTH_FLOWS.md#7-limits-in-this-release
[am]: ../../docs/AUTH_MOUNTING.md
[am-1]: ../../docs/AUTH_MOUNTING.md#1-the-mount-in-order
[am-2]: ../../docs/AUTH_MOUNTING.md#2-the-three-route-groups-and-their-guards
[am-3]: ../../docs/AUTH_MOUNTING.md#3-what-forge-does-not-ship
[am-6]: ../../docs/AUTH_MOUNTING.md#6-embedding-an-auth-view-in-your-own-page
[boundaries-2c]: ../../warden/canon/libs/BOUNDARIES.md#2c-why-identity-is-application-layer
[crypto-readme]: ../crypto/README.md
[dm]: ../../docs/DATABASE_MANAGEMENT.md
[eh-1c]: ../../docs/FORGE_ERRORS.md#1c-guardresult-and-validationresult-domain-aliases
[eh-5e]: ../../docs/FORGE_ERRORS.md#5e-startup-invariants--env-validation-and-binding-resolvers-throw
[form-readme]: ../form/README.md
[namespaces-5h]: ../../docs/NAMESPACES.md#5h-auth--identity-and-only-the-domain-of-it
[ram-6]: ../../docs/ROUTING_AND_MIDDLEWARE.md#6-the-page-shell
[session-readme]: ../session/README.md
[storage-readme]: ../storage/README.md
[ucr-2a]: ../../docs/UI_CLIENT_RUNTIME.md#2a-state-only-islands-versus-contract-bearing-scopes
