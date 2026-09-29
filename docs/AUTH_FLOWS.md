---
title: Auth Flows
description: "What each auth flow does once mounted — signup, sign-in, passkey and TOTP enrolment, email change, admin management, recovery from a lost value — and this release's limits."
audience: consumer
---

# Auth Flows

> Owns what each flow does once the capability is mounted — the credential each one issues, what the visitor is told, and where a resolution sends
> them. Owns the limits this release carries (§7), and how an account recovers when a key, a device or a code is lost (§8).
>
> Defers to: [`AUTH_MOUNTING.md`][am] for the mount itself — the builders, the guard table, the seams forge ships no implementation for, and
> embedding a single view; [`NAMESPACES.md`][namespaces-5h] §5h for the `auth` / `auth/web` / `auth/client` split and the one-way edge;
> [`src/auth/README.md`][auth-readme] for how each of these is called, task by task; [`FORGE_ERRORS.md`][eh-5e] §5e for why resolution throws and
> operations return a `Result`; [`UI_CLIENT_RUNTIME.md`][ucr-3c] §3c for `resume()` and scope registration.

---

## 0. Quick Reference

- §1 Signup: address in, code out, and why an address already taken is challenged rather than refused
- §2 Sign-in: the request/verify pair and what each factor requirement demands
- §2a What Each Requirement Demands: `optional`, `mandatory`, `mandatoryForRoles`
- §2b What the Visitor Is Told: the closed set of notices, and the reasons folded into them
- §2c Where a Resolution Sends the Visitor: enrolment, step-up, or the return path
- §3 Passkeys: the two-endpoint ceremony both halves share
- §3a Enrolment: the registration ceremony, the pending-enrolment gate, and the account's own ceremony
- §3b Sign-in: why a passkey never starts one
- §3c Management: what the shipped pages do, and the limits they carry
- §3d PRF Output Stays in the Page: never posted, judged by a real result, salted per credential
- §4 Authenticator App (TOTP): the secret, the URI, and the confirm step
- §5 Email Change: the two sealed links, the stage each one carries, and the confirm route you own
- §6 Admin Management: the user pages, the last-admin guard, and the first-admin bootstrap
- §7 Limits in This Release: what does not work yet, stated plainly
- §8 Recovery — No Lost Value Locks an Account Out or Lets It In on Less: what the user sees, and the way back from each loss
- §8a Choosing a Factor at Step-Up: every confirmed second factor is offered, and the URL names the one presented
- §8b A Confirmed Second Factor Comes Before Any Enrolment: why an owed enrolment waits for a step-up
- §8c Recovery Codes: who may be issued them, shown once and never downloadable, the staged set, single use, and the offering the registry demands
- §8d A Code Lands on the Repair Page: what a step-up by recovery code shows the user
- §8e The Administrator's Reset Is the Last Resort: what it clears, and the one weakening it allows

---

## 1. Signup

`authRoutes`' `signupSubmit` takes one field: an address. The address is normalised, and the response is a 303 to `verify.show` with the address
kept in the session — never in the URL, which lands in history, `Referer` and proxy logs.

**An address that already has an account is challenged, not refused.** "That email is taken" is the account-enumeration answer this flow exists not
to give, and a code delivered to the address's real owner is harmless. So both branches issue a real challenge, both render the same page, and the
timing is the same because the issue is deferred either way.

The credential itself depends on the primary factor. With email-OTP primary — the shipped case — the visitor is emailed a six-digit code valid for
five minutes, and the code is never stored: what the OTP state holds is the sealed token the code is checked against.

---

## 2. Sign-in

Sign-in is a request and a verification, and they are separate requests. `authRoutes`' `signinSubmit` defers the issue and redirects to
`verify.show`; `verify.submit` completes it. **An address with no account gets a decoy** — the same token work, the same shape of response, nothing
delivered — so the two cases cannot be told apart by timing or by what comes back.

Completion refuses a deactivated user at the same point it refuses an unknown one, and on success resolves the offered factors before deciding where
the visitor goes.

### 2a. What Each Requirement Demands

The requirement sits on the factor, not on the deployment. `AuthFactorsOptions.offered` is a tagged list: each entry declares its service `primary`
or `second`, and a `second` entry carries what this deployment demands of it.

| Requirement | What sign-in demands of that factor |
| --- | --- |
| `"optional"` | Nothing. It can satisfy a step-up once the user confirms it, and is never owed. |
| `"mandatory"` | An enrolment, until the user confirms it. |
| `{ mandatoryForRoles: [...] }` | `"mandatory"` for a user whose roles match, `"optional"` for everyone else. Forge sources no roles — the caller supplies them. |

**Mandatory governs enrolment, not step-up.** `resolve` answers in order: a mandatory factor this user has not confirmed is
`enrolment-required` naming **only the owed kinds**; otherwise any confirmed second factor is `step-up-required`; otherwise `satisfied`. So a
mandatory factor cannot be skipped by enrolling a different one, and an optional factor a visitor did enrol is still demanded at every later
sign-in.

**A deployment offering no second factor is `satisfied` without a store read** — an `offered` list with no `second` entry.

**An implicit factor is enrolled for everyone the moment it is offered.** Email-OTP has no enrolment row by design, so offering it as a second
factor puts it in the confirmed set unconditionally — it is never owed, and it always satisfies the step-up.

**A factor declared `primary` is not available as a second factor.** The registry's step-up set is the `role: "second"` entries alone, so the
primary is excluded by construction rather than by a filter: proving it again proves nothing new. An `email-otp` primary with a `second` passkey
therefore leaves the passkey as the only step-up factor, and `"mandatory"` there demands a **passkey** enrolment.

**The default this release is built around is email-OTP primary with a mandatory authenticator-app second factor**, plus the recovery codes that
offering requires (§8c). Both offerings work and both are driven through the mount in [`src/auth/web/mount.test.ts`](../src/auth/web/mount.test.ts);
the passkey step-up is the alternative. With two second factors confirmed the verify page presents **the first in `offered` order** and links the
others, so the user can choose (§8a).

**An all-optional offering sends nobody to the enrolment pages, so its factors are enrolled from the account pages.** `requirePendingEnrolment`
admits only a visitor who owes an enrolment, and nobody ever owes an `"optional"` factor — so every visitor goes to `settledPath`, and `authRoutes`'
`enrol` pages never open. A settled user adds a passkey from `accountRoutes`' `passkeys` page, whose enrol link opens the account's own ceremony
(§3a), and an authenticator app from its `totp` page (§4). Without `accountRoutes` mounted, an optional factor has no page to be enrolled from.

### 2b. What the Visitor Is Told

The notices are a closed set: the service is unavailable, you are throttled, or that did not match. Every other reason — expired, consumed, not
enrolled, deactivated, unrecognised — folds into **that did not match**, because telling them apart is the account-enumeration oracle the decoy
closes. The unredacted reason is for your logs and your branching, never for the page ([`FORGE_ERRORS.md`][eh-1c] §1c).

**A step-up adds one notice: that method cannot be checked right now.** It is the `unusable` reason, answered when a factor's stored secret will
not open, and it tells the user to choose another method (§8a). It says nothing about membership, because only a signed-in user reaches a
step-up.

**On the primary path, throttled folds in too.** A known-but-throttled address answering "you are throttled" where an unknown one answers "that did
not match" is the same membership answer, so `complete` reports both `too-many-attempts` and `too-soon` as `unrecognised` there. `stepUp` and
`requestStepUp` keep the true reason: the visitor is already signed in, so there is no membership left to leak, and being told to wait is what makes
a lockout comprehensible.

### 2c. Where a Resolution Sends the Visitor

A resolution that is not `satisfied` is **a successful outcome of a correct sign-in**, not a refusal of one, so it is a page to visit rather than a
4xx: `enrolment-required` redirects to the enrolment page **for a kind it actually names** — or to the verify page first, while the user holds a
confirmed second factor they have not yet passed (§8b) — `step-up-required` back to the verify page, and `satisfied` to
the return path — the `?next=` value reduced to a same-origin path, or your `settledPath`. Both the guards and the sign-in actions read the
resolution's `kinds`, because a passkey page cannot clear an owed authenticator-app enrolment and sending a visitor there is a loop.

The step-up mark is written in exactly one place, when a step-up verification succeeds, and a fresh sign-in clears it: proving the primary factor
again proves nothing about the second. `requireEnrolment` answers **503** rather than redirecting when it cannot read the factor store, because a
redirect on an unknown demand loops.

---

## 3. Passkeys

A passkey enrols a visitor and steps one up; it never starts a sign-in (§3b). On a factor service, `enrolment` sits at the top level rather than
under `capabilities` because TypeScript narrows a union only on a direct discriminant.

Every ceremony is two endpoints and two CSRF tokens. The server half stamps a contract onto the scope root; the browser half reads it off that
element and runs the ceremony ([`NAMESPACES.md`][namespaces-5h] §5h). **A token each, because `csrfProtection` binds a token to one path** — a
ceremony spanning `begin` and `finish` cannot share one, and naming them apart is what stops either being sent to the wrong endpoint.

The controller checks WebAuthn support **at mount, not at the press**: an unsupported browser reveals the fallback line and disables the trigger,
rather than failing after the visitor has committed.

### 3a. Enrolment

`authRoutes`' `enrol.passkey` and `enrol.totp` pages are guarded by `require-pending-enrolment`, which admits **only** a visitor who owes an
enrolment. One who owes a step-up instead is sent to verify it first — an owed step-up cannot be enrolled around — and so is one who owes an
enrolment while holding a confirmed second factor (§8b). One who owes nothing is sent to the settled path.

The ceremony posts to `enrol.ceremony.begin` for options and `enrol.ceremony.finish` with the credential. Registration excludes the credentials the
user already has, so re-enrolling one authenticator is refused by the browser rather than by a database conflict later. `finish` writes no session
state: enrolment does not sign anyone in.

**A settled user adds a passkey through the account, never through `enrol.passkey`.** `accountRoutes`' `passkeyEnrol` page runs the same
ceremony against `passkeyCeremony.begin` and `passkeyCeremony.finish`, behind the `account` guards instead of the pending-enrolment one
([`AUTH_MOUNTING.md`][am-2] §2). When the user is subject to a step-up and the last one has fallen outside the fresh window, the page sends them to
verify and back before it renders, because `require-fresh-step-up` admits every `GET`; the ceremony's own 403 is the backstop. `finish` lands on the
`passkeys` list, or on the recovery-codes page when the user holds no unused codes (§8c). A user who still owes an enrolment is sent to
`enrol.passkey`, because `require-enrolment` refuses them the whole `account` group.

### 3b. Sign-in

**A primary factor must identify the visitor, and a passkey identifies nobody — so no configuration makes one start a sign-in.** The primary variant
of `AuthFactorOffer` takes a service whose kind is drawn from `AUTH_IDENTIFYING_FACTORS`: offering the passkey as primary is a type error, and
`createFactorRegistry` refuses it at runtime for a consumer casting past the type. The sign-in page therefore renders no passkey trigger in any
deployment, and there are no discoverable endpoints to answer.

A passkey ceremony always requires user verification: it only ever runs as a step-up or an enrolment, and a fresh human gesture is the point of one.
The second half of a sign-in runs the same step-up pair as any other step-up — §2c describes where its resolution sends the visitor.

### 3c. Management

`accountRoutes`' `passkeys` page lists the visitor's credentials with their labels, creation and last-use times, a rename link and a remove control,
and warns when removing the last credential would leave nothing to sign in with. Removing a passkey is scoped to its owner in the statement's own
`WHERE`, so ownership is not a check a caller can forget. Its enrol link, and the one in its empty state, open the account ceremony (§3a).

**Removing one signs every other session out.** The removal raises the account's revocation barrier, and every session established at or before it —
including the ones on devices this request cannot see — is refused on its own next request. The acting session is carried past the barrier, so the
visitor stays where they are. Removing the authenticator-app factor does the same.

**No configuration removes the limits that apply to this page** — §7 states them.

### 3d. PRF Output Stays in the Page

A passkey factor given `prf` salts asks the authenticator to evaluate its PRF during the ceremony. The result is a 32-byte secret an app uses to
derive a key its server never holds.

**The output is handed to the page and nowhere else.** The controller gives it to the handler `onPasskeyPrf` registered, after the server has
verified the ceremony and before the page navigates. It is never posted to the server, and it never rides on `PASSKEY_OUTCOME_EVENT`, because a
DOM event bubbles to every listener on the page. The server never learns whether a PRF result came back.

**Support is judged by a real 32-byte result, never by `prf.enabled` or `getClientCapabilities()`.** Both misreport: an authenticator can claim
PRF and return nothing. So the handler is called whenever the options asked for PRF, with `output` set to `null` when no 32-byte result arrived.
That lets a page tell "this passkey has no PRF" from "nothing ran" before navigation tears it down.

**Step-up salts are keyed per credential, and none are sent when the user has no listed credential.** The browser matches each salt against
`allowCredentials`. It throws `NotSupportedError` on `evalByCredential` with an empty `allowCredentials`, and `SyntaxError` on a key that list
does not hold. So the factor asks for step-up salts only when the user has credentials, and drops any salt keyed to an id outside the list.

**A registration's output equals later assertions with the same salt.** An app can wrap its key as soon as the passkey is enrolled, without
waiting for a first step-up.

---

## 4. Authenticator App (TOTP)

TOTP is **step-up only**: an authenticator app proves possession, it does not say who you are, so the registry refuses it as a primary factor at
construction.

The page is mounted **twice**, and the two are not interchangeable. `authRoutes`' `enrol.totp` sits in `auth.enrol` behind
`require-pending-enrolment` and is where a visitor who _owes_ the enrolment clears it, because `require-enrolment` refuses the whole `account` group
while that enrolment is outstanding. `accountRoutes`' `totp` sits in `account` and is the settled visitor's management page; only it offers removal
(`totpRemove`), there being nothing to remove until something is enrolled.

Either mount renders the secret twice — as base32 to type, and as an `otpauth://` URI to paste. **Forge renders no QR code**; the URI is the seam
for one, and drawing it is yours. Submitting the code (`enrol.totpEnrol` or `totpEnrol`) confirms the enrolment, accepting one step of clock drift
either way and advancing the stored counter so a code cannot be replayed inside its own step.

**A wrong code costs a guess, spent before it is compared.** `failed_attempts` is incremented by the statement that admits the guess, so parallel
attempts each spend one rather than all comparing against a count none has written; past `maxAttempts` (5 by default, 1–20) even a correct code is
refused.

**A spent budget reopens on its own, and the window is why a run of typos is not a permanent lock.** An accepted code clears the count, and so does
the first guess made more than `lockoutMs` after the one that hit the cap — the same `UPDATE` that admits it resets the count to 1. The default is
`AUTH_TOTP_LOCKOUT_MS`, fifteen minutes, configurable on `TotpAppFactorOptions` between one minute and one day. A refused guess writes nothing, so
the window runs from the moment the cap was hit rather than from the last attempt, and hammering the factor cannot hold it shut. Without the window
a user who mistypes `maxAttempts` times loses the factor for good, and where that factor is the deployment's one `"mandatory"` second factor, that
is the whole account. The ceiling holds on the enrolment ceremony too, which answers the same secret. **The code width follows the factor**:
`digits` is 6–8 on both code factors, and the verify page sizes its field and its schema off whichever it is presenting.

The secret is stored sealed under a per-purpose subkey with the user's own identity as associated data, so a secret lifted from one row cannot be
replanted on another.

**Re-opening an unfinished enrolment shows the same secret again, not a new one.** A mistyped code re-renders the page, and a page that rotated the
secret would hand back one the visitor's authenticator does not hold — a ceremony that could never be finished. The row is rebuilt only when the
stored secret will not open, which is a rotated key rather than an abandoned attempt.

**The page states the factor's own width and step**, read off `codeDigits` and `codePeriodSeconds` rather than assuming six digits every thirty
seconds, so a configured `digits` or `period` is what the visitor is told and what the `otpauth://` URI carries.

---

## 5. Email Change

**A change of address takes two links, and only the second one moves the account.** `accountRoutes`' `emailChangeSubmit` mints a sealed, one-hour
token and defers delivery of a link built by your `confirmUrl`. The page then says a confirmation has been sent — a 200 with a notice, not a
redirect, because nothing has changed yet.

**The first link goes to the address the account already holds**, whenever that address is verified, so the move is authorised by whoever owns the
current mailbox rather than by whoever holds the session — without which a stolen cookie moves the account to the thief's inbox and, with email-OTP
as the primary factor, locks the owner out for good. An unverified address has proved nothing, so there the new one is the only address to ask and
gets the link instead.

**Name `sentTo` on the page, not the address the visitor typed.** `AuthEmailChangeFlow.request` answers `AuthEmailChangeRequest`, whose `sentTo` is
the address the mail actually went to — and which of the two addresses that is depends on whether the account's own is verified. The
shipped action renders the flow's answer for exactly that reason; a page that echoes the typed address tells half its visitors to watch the wrong
inbox.

**The token carries a stage, and only a `move` token changes the row.** A link mailed to the address the account already holds carries `approve`:
answering it writes nothing and instead forwards a second link, carrying `move`, to the new address. Answering _that_ one moves the account. An
unverified account has one stage rather than two — its single link already went to the new address, and already carries `move`.

**The stages are split, because marking an address verified that nobody answered verifies nothing.** `changeEmail` stamps the verification in the
same statement that writes the address, so the address it marks must be one that has answered a link sent to it. Under a single stage the _old_
address answered and the _new_ one became a verified primary factor unread — an account's whole sign-in resting on a mailbox no one had proved they
could open.

**The new address is deliberately never looked up before the email goes out.** Answering "that address is taken" here is the same enumeration oracle
sign-in refuses to give. The unique index refuses the collision at the `move` stage instead, folded into the same refusal an unknown account gets.

**You mount the confirm route, and the one route serves both stages.** Forge ships `AuthEmailChangeFlow.confirm` and no route that calls it: the URL
shape is yours, so the handler is too. `confirm` decodes the token and burns it through the nonce store — a second visit to the same link answers
`consumed`, which is what makes a link scanner harmless — and then acts on the stage it read. An `approve` token defers the second mail and answers
`forwarded`, whose `sentTo` names the new address the second link went to. A `move` token writes the address and marks it verified in one statement,
answering `moved`.

**The confirmation page is yours to render, and `resolveAuthView` does not reach it** — it is no `AuthViewName`, so forge has no view for it. Render
it in your own layout with your own copy; [`AUTH_MOUNTING.md`][am-6] §6 is the recipe for putting a forge auth view beside it.

**It renders in the same document shell the auth pages do**, because that shell belongs to the app rather than to the mount
([`ROUTING_AND_MIDDLEWARE.md`][ram-6] §6). Call `renderShell` from your own view with a slot you name yourself — its `mount` is an
open string — and the page comes out inside the chrome every auth page already renders in. Forge asks a shell for a document, not for a component
typed against `AuthViewName`, so there is no adapter to write.

**That route is a `GET` that mutates, and the trade is deliberate.** A confirmation link in an email can only be a `GET`, so the usual rule gives
way; what makes it safe is that each link is single-use. The first visit does its stage's work, and every visit after it — a link scanner's, a
prefetch, the user clicking twice — changes nothing. Do not add your own idempotency around it, and do not make the route a `POST` behind an
interstitial unless you want the extra click: the nonce store already carries the guarantee.

**The route renders two success pages, and the failure arm needs `instanceof`.** The success value `confirm` answers is a union discriminated on
`status`, and its error is a union of a string literal and the `AuthStoreError` class, so those two arms are told apart by type rather than by
value.

```ts
const outcome = await services.emailChange.confirm(token, Date.now());
if (!outcome.ok) {
  if (outcome.error instanceof AuthStoreError) return unavailablePage();  // the store is down
  return refusalPage(outcome.error);                                       // "expired" | "consumed" | …
}
if (outcome.data.status === "forwarded") return checkInboxPage(outcome.data.sentTo);  // one link left
return changedPage(outcome.data.user);                                                // the move is done
```

**A `forwarded` answer is not a finished change, and the page has to say so.** The visitor has approved the move and nothing has changed yet; what
clears it is the link now sitting in the new inbox. Render `sentTo` and the fact that one step is left, or the visitor reads approval as completion
and never opens the second link.

**The token is encrypted, not merely signed.** The confirmation carries an address in a URL, and a URL lands in browser history, the `Referer`
header, corporate link scanners and proxy logs; a signed cleartext token hands the address to every one of them.

**A completed move signs every session out, this one included.** The address is the account's identity, so the `move` stage raises the revocation
barrier and nothing is carried over it: the confirmation link is opened from whatever browser answered the mail, which is not necessarily one the
account was signed in on. Render the `moved` page as a page that asks the visitor to sign in again.

---

## 6. Admin Management

`adminRoutes`' `users.list` lists and searches accounts by cursor; `users.edit` carries the role, status and delete controls. Each control is
disabled with its own reason when the guard would refuse it, and a refusal that happens anyway comes back as a **409** naming which guard fired.

**An administrator cannot deactivate or delete their own account.** The last-admin guard does not catch it — a deployment with two admins would
admit it — so both controls are disabled on the page with their own reason, and a request that arrives anyway comes back **409** with the outcome
`self`. Reactivating your own account is still allowed, since it locks nobody out.

**Search is prefix-matched.** A term matches an address that _starts_ with it, which is what lets the unique index on `email_key` answer the query
instead of a full table scan. A substring in the middle of an address — the domain, say — matches nothing. Search by the start of the local part.

**The last-admin guard lives in the statement's own `WHERE`, not in a count-then-write.** Two concurrent demotions therefore leave one admin
standing rather than none, and the admin count the page displays is a display value only — never the thing a write is trusted against.

Deleting a user removes its children first, in one batch that rolls back whole, because D1 does not guarantee foreign-key enforcement is on.

**An account's factors page carries a reset control**, the last resort for a user who has lost every second factor and every recovery code.
What it clears and what it allows is §8e.

**Elevation is the first-admin bootstrap, which is why it is not admin-gated.** A signed-in, enrolment-satisfied visitor may claim the role only
while there is no admin at all, and the count is re-read **at write time** — the check on the page is a courtesy, and the one at the write is what
stops two simultaneous visitors becoming two first admins.

---

## 7. Limits in This Release

Stated here rather than left to be discovered, because each changes what a consumer must build.

**A passkey list of more than one is not fully operable.** The page carries a single CSRF token and renders one delete form per row, and a token is
bound to one path — so on a list of several credentials, only the first row's Remove succeeds. Supply your own list page until the view takes a
token per row.

**A passkey cannot be renamed through forge's own markup.** The `PATCH` route, its schema and its action all work; no shipped view submits a label,
and the rename link resolves to a page that shows the credential rather than a form. Supply the page through the view-override seam if you want it.

**Rate limiting is yours to configure, and forge ships no numbers.** The seam exists — `AuthGuardChainOptions.rateLimit`, keyed by group path,
[`AUTH_MOUNTING.md`][am-1] §1 — and nothing is mounted until you fill it. The OTP and TOTP counters bound one code's life and say nothing about how
often a caller may ask across identities, so outbound email is triggerable by anyone until you attach a limit.

**No mutation is held across a re-authentication.** When `requireFreshStepUp` refuses a state-changing request, the visitor steps up, lands on the
settled page and repeats the action — forge keeps no pending write to replay for them.

**The email-change link is burned before the address is written.** A store failure between the two spends the link and changes nothing, so the
visitor asks for another — the deliberate side to fail on, since burning after the write leaves a window in which one link applies the same change
twice.

**Whether a synced passkey is acceptable is your policy, not forge's.** `backupEligible` is fixed for a credential's life and is checked against the
enrolled value on every assertion, so a changed one is refused as the misreporting it is; `backedUp` moves and is kept current. Refusing a synced
credential outright is right for a high-assurance tenant and wrong for a consumer product — read both off `CredentialStore` and decide.

**A new set of recovery codes has no print view.** The user copies the set from the codes page, the only place it is shown, before confirming one
of the codes. That it is never offered as a download is a ruling rather than a limit (§8c).

**Federated identity is not here.** The OIDC relying party and the OAuth2 provider are a separate effort, and they will publish their own subpaths
under the same one-way rule ([`NAMESPACES.md`][namespaces-5h] §5h).

---

## 8. Recovery — No Lost Value Locks an Account Out or Lets It In on Less

**No missing key, device or code may lock an account out, and none may let it in on less than it needed before.** Every way back below passes
through a second factor the user still holds. The one exception is the administrator's reset (§8e), and it is deliberate.

| What was lost | What the user sees | How they get back in |
| --- | --- | --- |
| The ring key an authenticator-app secret is sealed under, or a secret that will not open under it | The verify page says the method cannot be checked right now, and offers their other methods | Step up with a passkey or a recovery code, then remove the authenticator app and add it again. Putting the key back in the ring makes the old enrolment work again |
| An authenticator-app row `purgeStaleTotpSecrets` dropped | The verify page, not the enrolment page | Step up with another confirmed factor or a recovery code, then enrol again (§8b) |
| The phone or security key itself | The verify page | Choose a recovery code, then replace the lost factor from the repair page (§8d) |
| The session secret | A signed-out session | Sign in again with the address and the second factor |
| The CSRF secret | A 403 on a form already on screen | Reload the page and submit again |
| Every second factor and every recovery code | No way to step up | An administrator resets the account (§8e) |

### 8a. Choosing a Factor at Step-Up

**The verify page offers every second factor the user has confirmed, recovery codes included.** It presents the first in `offered` order and
links each of the others. The link names the kind as `?factor=<kind>` and keeps the return path, and the form posts to the same query. The server
presents the named kind only when it is one this user's resolution offers, so a forged value falls back to the first.

**A factor whose stored secret cannot be opened answers `unusable`, and costs no guess.** The authenticator-app factor opens the secret before it
spends an attempt, and the enrolment stays confirmed, so a key put back in the ring makes it work again. Verify re-renders at 422 with the notice
of §2b and the other methods, and logs `auth.factor.unusable` at warn with the factor's kind. That log is the operator's cue; what to do on it is
[`src/auth/README.md`][auth-readme]'s.

### 8b. A Confirmed Second Factor Comes Before Any Enrolment

**A user who owes an enrolment while holding a confirmed second factor passes that factor first.** `resolve` answers `enrolment-required` with
`stepUpKinds`, the second kinds this user has confirmed. While that list is not empty and the session holds no step-up mark inside
`stepUpMaxAgeMs`, sign-in, verify, `require-auth` and `require-pending-enrolment` all send the user to verify. A mark dated in the future counts as
none. Verify measures the mark against the same window as the guards, so the two cannot bounce a user between them. After the step-up they go on to
the enrolment page.

Without this, holding the mailbox would be enough to enrol an authenticator of your own. It is reachable in two ordinary ways: after
`purgeStaleTotpSecrets` drops a row under a `"mandatory"` authenticator app, and with a mandatory factor offered beside an optional one the user has
already confirmed.

### 8c. Recovery Codes

**An offering that includes an authenticator app or a passkey must include recovery codes.** `createFactorRegistry` throws at construction when:

- `totp-app` or `passkey` is offered as a second factor without `recovery-code`, because a lost device or key would lock its users out;
- `recovery-code` is offered as primary;
- `recovery-code` is offered with a requirement other than `"optional"`, because codes are issued after a step-up and so can never be owed before
  one;
- `recovery-code` is the only explicit second factor, because codes recover a factor and have nothing to recover on their own.

**Codes are issued only to a user who holds a confirmed authenticator app or passkey and has stepped up inside the `require-fresh-step-up`
window.** Both code `POST`s check this in the handler, not through `require-fresh-step-up`, which admits a user the policy owes no step-up. Without
it, holding the mailbox would be enough to mint a way past the second factor. A user holding neither factor gets a 409, and a stale step-up is
redirected to verify and brought back to the codes page.

**The handler measures the step-up against the window the guard is configured with, never a window of its own.** A tightened
`freshStepUpMaxAgeMs` tightens code issuance with it, and `null` still demands a step-up in this session, of any age — the guard opting out of the
demand does not let a mailbox mint codes. Where `require-fresh-step-up` did not run on the request, no window exists and the handler sends the user
to verify on every attempt. The window itself is set at the mount ([`AUTH_MOUNTING.md`][am-2] §2).

**A new set replaces the old one only when the user types one of the new codes back.** Generating a set stages it, and the old set keeps working
until the confirmation, so a set the user never saved costs them nothing.

**A set is shown once, laid out for copying, and is never downloadable.** The codes page presents a new set in one block the user can copy
whole, and tells them to keep it somewhere safe now, because it will not be shown again. No route hands a set over as a file — not a file
endpoint, not a `data:` link and not a blob the page builds. Only the SHA-256 of each code is stored, and the page is sent `no-store`.

**Each code works once.** Using one spends it and clears the factor's spent guesses in the same batch. A wrong code spends a guess, against the
same `maxAttempts` and `lockoutMs` budget the authenticator app uses. Spaces, dashes and letter case are ignored.

**A user who holds no unused codes is sent to generate them.** After every step-up or enrolment, a user holding a confirmed authenticator app or
passkey and no unused codes is redirected to the codes page. Enrolling is not a step-up, so after a first enrolment the user proves the new factor
once on verify before the codes page lets them generate.

**Removing the last authenticator app or passkey removes the codes with it**, in the same batch, so no account is left holding codes alone.

### 8d. A Code Lands on the Repair Page

**A step-up by recovery code always lands on the account's factors page with `?recovered=1`**, whatever return path the step-up began with. The
page says how many unused codes are left, and tells the user to remove an authenticator that does not work, add it again, and then generate a new
set. A code is spent on getting in, so the repair is the next thing the user must see.

### 8e. The Administrator's Reset Is the Last Resort

**The reset deletes the user's factors, passkeys and recovery codes, revokes every bearer token they hold, and raises their revocation barrier,
in one batch.** Every session and every token the user holds is refused on its next request. The control is on the account's admin factors page
and posts to `adminRoutes`' `users.resetFactors`, which sits in `admin.users`, so the administrator must have stepped up recently.

**This is the one path back that lets an account in on less than it needed before.** The user signs in with the address alone. Where a second
factor is demanded they enrol it on the strength of the mailbox and are then sent to generate codes; where none is, they are simply signed in.
That is why the reset takes an administrator rather than anything the user can do.

**An administrator cannot reset their own account.** The request answers 409 with the outcome `self`, and an unknown user answers 404.

[am]: ./AUTH_MOUNTING.md
[am-1]: ./AUTH_MOUNTING.md#1-the-mount-in-order
[am-2]: ./AUTH_MOUNTING.md#2-the-route-groups-and-their-guards
[am-6]: ./AUTH_MOUNTING.md#6-embedding-an-auth-view-in-your-own-page
[auth-readme]: ../src/auth/README.md
[eh-1c]: ./FORGE_ERRORS.md#1c-guardresult-and-validationresult-domain-aliases
[eh-5e]: ./FORGE_ERRORS.md#5e-startup-invariants--env-validation-and-binding-resolvers-throw
[namespaces-5h]: ./NAMESPACES.md#5h-auth--identity-and-only-the-domain-of-it
[ram-6]: ./ROUTING_AND_MIDDLEWARE.md#6-the-page-shell
[ucr-3c]: ./UI_CLIENT_RUNTIME.md#3c-resumable-scopes
