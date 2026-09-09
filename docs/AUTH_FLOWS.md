---
title: Auth Flows
description: "What each auth flow does once mounted: signup, sign-in under each factor policy, passkey and TOTP enrolment, email change, admin management, and the limits this release carries."
audience: consumer
---

# Auth Flows

> Owns what each flow does once the capability is mounted — the credential each one issues, what the
> visitor is told, and where a resolution sends them. Owns the limits this release carries (§7).
>
> Defers to: [`AUTH_MOUNTING.md`](./AUTH_MOUNTING.md) for the mount itself — the builders, the guard
> table, the seams forge ships no implementation for, and embedding a single view;
> [`NAMESPACES.md`](./NAMESPACES.md) §5h for the `auth` / `auth/web` / `auth/client`
> split and the one-way edge; [`src/auth/README.md`](../src/auth/README.md) for every signature,
> option shape and export; [`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §5e for why resolution throws
> and operations return a `Result`; [`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §3c for
> `resume()` and scope registration.

---

## 0. Quick Reference

- §1 Signup: address in, code out, and why an address already taken is challenged rather than refused
- §2 Sign-in: the request/verify pair and what each factor policy demands
- §2a What Each Policy Demands: `single`, `always`, `when-enrolled`, `for-roles`
- §2b What the Visitor Is Told: the three notices, and the reasons folded into them
- §2c Where a Resolution Sends the Visitor: enrolment, step-up, or the return path
- §3 Passkeys: the two-endpoint ceremony both halves share
- §3a Enrolment: the registration ceremony and the pending-enrolment gate
- §3b Sign-in: the discoverable ceremony, and what it writes to the session
- §3c Management: what the shipped pages do, and the two limits they carry
- §4 Authenticator App (TOTP): the secret, the URI, and the confirm step
- §5 Email Change: the sealed link, and the confirm route you own
- §6 Admin Management: the user pages, the last-admin guard, and the first-admin bootstrap
- §7 Limits in This Release: what does not work yet, stated plainly

---

## 1. Signup

`POST /signup` takes one field: an address. The address is normalised, and the response is a 303 to `/verify` with the address kept in the session — never
in the URL, which lands in history, `Referer` and proxy logs.

**An address that already has an account is challenged, not refused.** "That email is taken" is the
account-enumeration answer this flow exists not to give, and a code delivered to the address's real
owner is harmless. So both branches issue a real challenge, both render the same page, and the
timing is the same because the issue is deferred either way.

The credential itself depends on the primary factor. With email-OTP primary — the shipped case — the
visitor is emailed a six-digit code valid for ten minutes, and the code is never stored: what the OTP
state holds is the sealed token the code is checked against.

---

## 2. Sign-in

Sign-in is a request and a verification, and they are separate requests. `POST /signin` defers the
issue and redirects to `/verify`; `POST /verify` completes it. **An address with no account gets a
decoy** — the same token work, the same shape of response, nothing delivered — so the two cases
cannot be told apart by timing or by what comes back.

Completion refuses a deactivated user at the same point it refuses an unknown one, and on success
resolves the factor policy before deciding where the visitor goes.

### 2a. What Each Policy Demands

`AuthFactorsOptions.policy` covers none, one or both, with no fourth state.

| Policy | What sign-in demands after the primary factor |
| --- | --- |
| `{ mode: "single" }` | Nothing. The resolution is `satisfied` without a store read. |
| `{ mode: "second-factor", required: "when-enrolled" }` | A step-up when the user has a step-up factor confirmed; otherwise `satisfied`. |
| `{ mode: "second-factor", required: "always" }` | A step-up when one is confirmed; otherwise `enrolment-required`, naming the kinds that can be enrolled. |
| `{ mode: "second-factor", required: "for-roles" }` | `always` semantics for a user whose roles match, `when-enrolled` for everyone else. Forge sources no roles — the caller supplies them. |

**An implicit factor is enrolled for everyone the moment it is offered.** Email-OTP has no enrolment
row by design, so offering it as the second factor demands it under `when-enrolled` as well as under
`always`. A `second-factor` policy whose offered factors contain nothing that could step up **throws
at construction**, rather than quietly behaving as `single`.

**That warning does not apply to the primary factor.** The registry builds its step-up set as
`offered.filter(s => s.capabilities.stepUp && s.kind !== primary.kind)` — the primary is excluded from
the factors that can satisfy a step-up, because proving it again proves nothing new. So an
`email-otp` + `passkey` offering with `primary: "email-otp"` leaves the passkey as the only step-up
factor, and `required: "always"` therefore demands a **passkey** enrolment. Read §2a's warning alone
and this configuration looks impossible; it is legitimate, and it is tested end to end.

**The default this release is built around is email-OTP primary with an authenticator-app step-up** —
`offered: [emailOtp, totpApp]`, `primary: "email-otp"`, `{mode: "second-factor", required: "always"}`.
Both offerings work and both are driven through the mount in
[`src/auth/web/mount.test.ts`](../src/auth/web/mount.test.ts); the passkey step-up is the alternative.
With two step-up factors offered the verify page demands **the first in `offered` order**, and forge
renders no chooser — that ordering is the whole of the choice.

**`{ mode: "single" }` makes the enrolment pages unreachable, and nothing says so at the option.**
`requirePendingEnrolment` admits only a visitor who owes an enrolment, and under `single` nobody ever
does — so every visitor goes to `settledPath` and no enrolment page can be opened. The consequence is
what matters: **the policy that looks like the safe default silently hides the passkey feature.** If
you offer passkeys, you want a `second-factor` policy; if you want them optional rather than demanded,
route your own enrolment page behind `requireAuth` alone. That guard exists to stop an owed step-up
being enrolled around, and has nothing to do on a page nobody is sent to.

### 2b. What the Visitor Is Told

Three notices, and only three: the service is unavailable, you are throttled, or that did not match.
Every other reason — expired, consumed, not enrolled, deactivated, unrecognised — folds into **that
did not match**, because telling them apart is the account-enumeration oracle the decoy closes. The
unredacted reason is for your logs and your branching, never for the page
([`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §1c).

### 2c. Where a Resolution Sends the Visitor

A resolution that is not `satisfied` is **a successful outcome of a correct sign-in**, not a refusal
of one, so it is a page to visit rather than a 4xx: `enrolment-required` redirects to the enrolment
page **for a kind it actually names**, `step-up-required` back to `/verify`, and `satisfied` to the
return path — the `?next=` value reduced to a same-origin path, or your `settledPath`. Both the guards
and the sign-in actions read the resolution's `kinds`, because a passkey page cannot clear an owed
authenticator-app enrolment and sending a visitor there is a loop.

The step-up mark is written in exactly one place, when a step-up verification succeeds, and a fresh
sign-in clears it: proving the primary factor again proves nothing about the second. `requireEnrolment`
answers **503** rather than redirecting when it cannot read the factor store, because a redirect on
an unknown demand loops.

---

## 3. Passkeys

Every ceremony is two endpoints and two CSRF tokens. The server half stamps a contract onto the
scope root; the browser half reads it off that element and runs the ceremony
([`NAMESPACES.md`](./NAMESPACES.md) §5h). **Two tokens because `csrfProtection` binds a token to one
path** — a ceremony spanning `begin` and `finish` cannot share one, and naming them apart is what
stops either being sent to the wrong endpoint.

The controller checks WebAuthn support **at mount, not at the press**: an unsupported browser reveals
the fallback line and disables the trigger, rather than failing after the visitor has committed.

### 3a. Enrolment

`GET /enrol/passkey` and `GET /enrol/totp` are guarded by `require-pending-enrolment`, which admits
**only** a visitor who owes an enrolment. One who owes a step-up instead is sent to verify it first — an owed step-up cannot
be enrolled around — and one who owes nothing is sent to the settled path.

The ceremony posts to `register/begin` for options and `register/finish` with the credential.
Registration excludes the credentials the user already has, so re-enrolling one authenticator is
refused by the browser rather than by a database conflict later. `finish` writes no session state:
enrolment does not sign anyone in.

### 3b. Sign-in

The sign-in ceremony sends no `userId`, which builds a **discoverable** login: `allowCredentials` is
empty, the authenticator names the user, and the server never leaks who is enrolled. On success it
establishes the session and answers JSON carrying the redirect target, which is resolved through the
same factor policy §2c describes — so a passkey sign-in can still land on an enrolment or a step-up.

A refused assertion is a 401 with one message. Which check failed is in your logs.

**The verification posture is yours to raise.** `AuthPasskeyCeremonyOptions.userVerification` is what
the authenticator is asked for, `requireUserVerification` whether an unverified assertion is refused.
They default to `"preferred"` and `false` — asking is not requiring, which is where every WebAuthn
library starts, because a key with no PIN or biometric would otherwise be locked out of a sign-in it
can perfectly well perform. Raise both when your population all carry verifying authenticators; forge
cannot make that trade for you. `createPasskeyFactor` picks its own per role and is unaffected: a
**step-up** passkey already requires verification, since a fresh human gesture is the point of one.

### 3c. Management

`GET /passkeys` lists the visitor's credentials with their labels, creation and last-use times, a
rename link and a remove control, and warns when removing the last credential would leave nothing to
sign in with. Removing a passkey is scoped to its owner in the statement's own `WHERE`, so ownership
is not a check a caller can forget.

**Two limits apply to this page, and no configuration removes either** — §7 states both.

---

## 4. Authenticator App (TOTP)

TOTP is **step-up only**: an authenticator app proves possession, it does not say who you are, so
the registry refuses it as a primary factor at construction.

The page is mounted **twice**, and the two are not interchangeable. `GET`/`POST /enrol/totp` sits in
`auth.enrol` behind `require-pending-enrolment` and is where a visitor who _owes_ the enrolment clears
it, because `require-enrolment` refuses the whole `account` group while that enrolment is outstanding.
`GET`/`POST`/`DELETE /totp` sits in `account` and is the settled visitor's management page; only it
offers removal, there being nothing to remove until something is enrolled.

Either mount renders the secret twice — as base32 to type, and as an `otpauth://` URI to paste.
**Forge renders no QR code**; the URI is the seam for one, and drawing it is yours. The `POST` takes
the code and confirms the enrolment, accepting one step of clock drift either way and advancing the
stored counter so a code cannot be replayed inside its own step. `DELETE /totp` removes the enrolment.

**A wrong code costs a guess, spent before it is compared.** `failed_attempts` is incremented by the
statement that admits the guess, so parallel attempts each spend one rather than all comparing against
a count none has written; past `maxAttempts` (5 by default, 1–20) even a correct code is refused until
an accepted one resets it. The ceiling holds on the enrolment ceremony too, which answers the same
secret. **The code width follows the factor**: `digits` is 6–8 on both code factors, and the verify
page sizes its field and its schema off whichever it is presenting.

The secret is stored sealed under a per-purpose subkey with the user's own identity as associated
data, so a secret lifted from one row cannot be replanted on another. An abandoned enrolment leaves
an unconfirmed row that the next visit replaces rather than colliding with.

---

## 5. Email Change

`POST /email-change` mints a sealed, one-hour token carrying the user and the new address, and
defers delivery of a link built by your `confirmUrl`. The page then says a confirmation has been
sent — a 200 with a notice, not a redirect, because nothing has changed yet.

**The link goes to the address the account already holds**, whenever that address is verified, so the
move is authorised by whoever owns the current mailbox rather than by whoever holds the session —
without which a stolen cookie moves the account to the thief's inbox and, with email-OTP as the
primary factor, locks the owner out for good. An unverified address has proved nothing, so there the
new one is the only address to ask and gets the link instead. The token binds the account and the new
address either way: where it is delivered changes who authorises the move, not what the move is.

**The new address is deliberately never looked up before the email goes out.** Answering "that
address is taken" here is the same enumeration oracle sign-in refuses to give.

**You mount the confirm route.** Forge ships `AuthEmailChangeFlow.confirm(token, now)` and no route
that calls it: the URL shape is yours, so the handler is too. `confirm` decodes the token, burns it
through the nonce store — a second visit to the same link answers `consumed`, which is what makes a
link scanner harmless — writes the new address, and marks the address verified, because answering
the link is the proof.

**The confirmation page is yours to render, and `resolveAuthView` does not reach it** — it is no
`AuthViewName`, so forge has no view for it. Render it in your own layout with your own copy;
[`AUTH_MOUNTING.md`](./AUTH_MOUNTING.md) §6 is the recipe for putting a forge auth view beside it.

**It renders in the same document shell the auth pages do**, because that shell belongs to the app
rather than to the mount ([`ROUTING_AND_MIDDLEWARE.md`](./ROUTING_AND_MIDDLEWARE.md) §6). Call
`renderShell(c, content, slot)` from your own view with a slot you name yourself — `mount` is an open
string — and the page comes out inside the chrome every auth page already renders in. There is no
adapter to write and no props this route cannot supply: forge asks a shell for a document, not for a
component typed against `AuthViewName`.

**That route is a `GET` that mutates, and the trade is deliberate.** A confirmation link in an email
can only be a `GET`, so the usual rule gives way; what makes it safe is that the mutation is
single-use. The first visit changes the address, and every visit after it — a link scanner's, a
prefetch, the user clicking twice — answers `consumed` and changes nothing. Do not add your own
idempotency around it, and do not make the route a `POST` behind an interstitial unless you want the
extra click: the nonce store already carries the guarantee.

**Branching on the failure needs `instanceof`.** `confirm` returns
`Result<AuthUser, AuthEmailChangeReason | AuthStoreError>` — a union of a string literal and a class,
so the two arms are told apart by type, not by value:

```ts
const outcome = await services.emailChange.confirm(token, Date.now());
if (!outcome.ok) {
  if (outcome.error instanceof AuthStoreError) return unavailablePage();  // the store is down
  return refusalPage(outcome.error);                                       // "expired" | "consumed" | …
}
```

**The token is encrypted, not merely signed.** The confirmation carries an address in a URL, and a
URL lands in browser history, the `Referer` header, corporate link scanners and proxy logs; a signed
cleartext token hands the address to every one of them.

The session is untouched by a confirmed change. Identity is re-read from the store on every request,
so the new address is live on the next one.

---

## 6. Admin Management

`GET /users` lists and searches accounts by cursor; `GET /users/:id/edit` carries the role, status
and delete controls. Each control is disabled with its own reason when the guard would refuse it,
and a refusal that happens anyway comes back as a **409** naming which guard fired.

**The last-admin guard lives in the statement's own `WHERE`, not in a count-then-write.** Two
concurrent demotions therefore leave one admin standing rather than none, and the admin count the
page displays is a display value only — never the thing a write is trusted against.

Deleting a user removes its children first, in one batch that rolls back whole, because D1 does not
guarantee foreign-key enforcement is on.

**Elevation is the first-admin bootstrap, which is why it is not admin-gated.** A signed-in,
enrolment-satisfied visitor may claim the role only while there is no admin at all, and the count is
re-read **at write time** — the check on the page is a courtesy, and the one at the write is what
stops two simultaneous visitors becoming two first admins.

---

## 7. Limits in This Release

Stated here rather than left to be discovered, because each changes what a consumer must build.

**A passkey list of more than one is not fully operable.** The page carries a single CSRF token and
renders one delete form per row, and a token is bound to one path — so on a list of several
credentials, only the first row's Remove succeeds. Supply your own list page until the view takes a
token per row.

**A passkey cannot be renamed through forge's own markup.** The `PATCH` route, its schema and its
action all work; no shipped view submits a label, and the rename link resolves to a page that shows
the credential rather than a form. Supply the page through the view-override seam if you want it.

**A nickname typed at enrolment is not kept.** The enrolment view offers the field and the controller
posts it; nothing reads it, so a newly enrolled credential is unlabelled.

**Rate limiting is yours to configure, and forge ships no numbers.** The seam exists —
`AuthGuardChainOptions.rateLimit`, keyed by group path,
[`AUTH_MOUNTING.md`](./AUTH_MOUNTING.md) §1 — and nothing is mounted until you fill it.
The OTP and TOTP counters bound one code's life and say nothing about how often a caller may ask
across identities, so outbound email is triggerable by anyone until you attach a limit.

**The email-change link is burned before the address is written.** A store failure between the two
spends the link and changes nothing, so the visitor asks for another — the deliberate side to fail on,
since burning after the write leaves a window in which one link applies the same change twice.

**Whether a synced passkey is acceptable is your policy, not forge's.** `backupEligible` is fixed for
a credential's life and is checked against the enrolled value on every assertion, so a changed one is
refused as the misreporting it is; `backedUp` moves and is kept current. Refusing a synced credential
outright is right for a high-assurance tenant and wrong for a consumer product — read both off
`CredentialStore` and decide.

**Removing a passkey or changing an address revokes no other session.** Sessions are keyed by id in
KV with no per-user index, so "every other session of this user" is not a set forge can name.
Deactivation does land on the next request of every session, since the identity is re-read each time;
a credential change does not. Carry a per-user session index of your own if you need that.

**The ephemeral stores are KV, and KV's read-then-write is not atomic.** Two requests inside the
consistency window can both see one challenge unconsumed. The exposure is mitigated by binding each
challenge to the session it was issued to, not eliminated; the strict fix is a Durable Object
adapter, which is not in this release.

**Federated identity is not here.** The OIDC relying party and the OAuth2 provider are a separate
effort, and they will publish their own subpaths under the same one-way rule
([`NAMESPACES.md`](./NAMESPACES.md) §5h).
