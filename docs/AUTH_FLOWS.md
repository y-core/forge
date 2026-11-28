---
title: Auth Flows
description: "What each auth flow does once mounted — signup, sign-in, factors, email change, admin, sessions and security events, recovery from a lost value — and this release's limits."
audience: consumer
---

# Auth Flows

> Owns what each flow does once the capability is mounted — the credential each one issues, what the visitor is told, and where a resolution sends
> them. Owns what a user can see of their sessions and what an account's security record holds (§7), the limits this release carries (§8), and how
> an account recovers when a key, a device or a code is lost (§9).
>
> Defers to: [`AUTH_MOUNTING.md`][am] for the mount itself — the builders, the guard table, the seams forge ships no implementation for, and
> embedding a single view; [`NAMESPACES.md`][namespaces-5h] §5h for the `auth` / `auth/web` / `auth/client` split and the one-way edge;
> [`src/auth/README.md`][auth-readme] for how each of these is called, task by task; [`FORGE_ERRORS.md`][eh-5e] §5e for why resolution throws and
> operations return a `Result`; [`UI_CLIENT_RUNTIME.md`][ucr-3c] §3c for `resume()` and scope registration.

---

## 0. Quick Reference

- §1 Signup: address in, code out, why an address already taken is challenged rather than refused, and when an unanswered account is deleted
- §2 Sign-in: the request/verify pair and what each second factor's requirement demands
- §2a What Each Requirement Demands: one way in, each second factor mandatory or optional, and the minimum read per factor
- §2b What the Visitor Is Told: the closed set of notices, the reasons folded into them, and the status each answers
- §2c Where a Resolution Sends the Visitor: the first owed enrolment page, step-up, or the return path, and a 503 for a failed read
- §3 Passkeys: the two-endpoint ceremony both halves share
- §3a Enrolment: owed kinds in offer order, the registration ceremony, the pending-enrolment gate, and the account's own ceremony
- §3b Sign-in: why a passkey never starts one
- §3c Management: a mandatory kind's last factor stays, replacing the app in place, which changes sign other sessions out, the pages' limits
- §3d PRF Output Stays in the Page: never posted, judged by a real result, salted per credential
- §4 Authenticator App (TOTP): the secret, the URI, and the confirm step
- §5 Email Change: the two sealed links, the stage each one carries, and the confirm route you own
- §6 Admin Management: the user pages, the last-admin guard, and the first-admin bootstrap
- §7 Sessions and Security Events: the session list, what each event row holds, who is told, and how long rows are kept
- §8 Limits in This Release: what does not work yet, stated plainly
- §9 Recovery — No Lost Value Locks an Account Out or Lets It In on Less: what the user sees, and the way back from each loss
- §9a Choosing a Factor at Step-Up: every confirmed second factor is offered, and the URL names the one presented
- §9b A Held Factor Is Passed Before Any Enrolment: why an owed enrolment waits for a step-up, and the purge that keeps it rare
- §9c Recovery Codes: required beside the second factors, who may be issued them, shown once and never downloadable, the staged set, single use
- §9d A Code Lands on the Repair Page: what a step-up by recovery code shows the user
- §9e The Administrator's Reset Is the Last Resort: what it clears, and why it is the one path below the minimum

---

## 1. Signup

`authRoutes`' `signupSubmit` takes one field: an address. The address is normalised, and the response is a 303 to `verify.show` with the address
kept in the session — never in the URL, which lands in history, `Referer` and proxy logs.

**An address that already has an account is challenged, not refused.** "That email is taken" is the account-enumeration answer this flow exists not
to give, and a code delivered to the address's real owner is harmless. So both branches issue a real challenge, both render the same page, and the
timing is the same because the issue is deferred either way.

The credential is the primary factor's: the visitor is emailed a short-lived code (`AUTH_OTP_DIGITS` and `AUTH_OTP_TTL_MS` in `src/auth/config.ts`).

**The code is stored only sealed, in `auth_otp_state`, and bound to the browser that asked for it.** The row holds the sealed token the code is
checked against and the SHA-256 of a random value the requesting browser's session keeps. A guess from any other browser matches no row and spends
nothing, and asking again from another browser moves the code there, so the first browser's code stops working. The guess budget stays the
account's, not the browser's (§8).

**An account whose address never answers is deleted.** Sign-up writes an account for any new address it is given, so `purgeAuthEphemera` deletes one
still unverified `AUTH_UNVERIFIED_USER_TTL_MS` after it was created. The purge works in bounded steps, so a backlog clears over several runs, and
accounts go last, so a key of the app's whose constraint refuses their delete costs only the accounts: the purge names `users` in its report's
`blocked`, and the other tables still purge ([`src/auth/README.md`][auth-readme]'s "Clearing expired challenges, nonces and sessions").

---

## 2. Sign-in

Sign-in is a request and a verification, and they are separate requests. `authRoutes`' `signinSubmit` defers the issue and redirects to
`verify.show`; `verify.submit` completes it. **An address with no account gets a decoy** — the same token work, the same shape of response, nothing
delivered — so the two cases cannot be told apart by timing or by what comes back.

Completion refuses a deactivated user at the same point it refuses an unknown one, and on success resolves the offered factors before deciding where
the visitor goes.

### 2a. What Each Requirement Demands

**The emailed code is the only way in.** `AuthFactorsOptions.primary` takes a factor that identifies the visitor, and only `email-otp` does. The
authenticator app and the passkey are second factors only, offered under `second`: neither identifies anyone, so neither starts a sign-in (§3b).

**Each offered second factor is mandatory or optional, and the developer sets which.** `second.offered` lists the second factors as
`{ service, requirement }`, in the order every page shows them and owed kinds are enrolled in.

| `requirement` | What it demands of a user |
| --- | --- |
| `"mandatory"` | A confirmed factor of this kind. A user without one owes its enrolment before reaching anything else. |
| `"optional"` | Nothing. A factor of this kind the user did add is still asked for at every sign-in. |

**A requirement holds for every user, and nothing beyond the per-factor pair can be expressed.** There is no "at least one second factor, of the
user's choosing": a deployment that wants every user to hold a second factor names the kind that is mandatory. There is no role scoping: a factor
is mandatory for everyone or optional, and `resolve` takes the user's id alone. An offering carrying a requirement of its own, rather than one per
offer, is a type error, and `createFactorRegistry` throws on it for a caller casting past the type.

**`resolve` answers in order.** A user missing a mandatory kind is `enrolment-required`: its `kinds` are the mandatory kinds they lack, in `offered`
order, and its `stepUpKinds` are the offered second factors they hold, with `recovery-code` where they hold codes (§9b). Otherwise a user holding
any offered second factor is `step-up-required`. Anyone else is `satisfied`, and a deployment with no `second` is `satisfied` without a store read.

**The minimum is read per factor: a mandatory kind's last confirmed factor cannot be removed, and an optional kind's can** (§3c). Recovery codes
pass a step-up but are neither mandatory nor optional, and no minimum counts them (§9c). **Replacing a second factor in place, confirmed by a code
from the new one after a fresh step-up, is not a removal**, so the minimum does not bar it (§3c). The one way below the minimum is the
administrator's reset (§9e).

**An optional factor is added from the account pages.** `require-pending-enrolment` admits only a visitor who owes a mandatory kind, so where
nothing is mandatory the `authRoutes` `enrol` pages never open. A user adds a passkey from `accountRoutes`' `passkeys` page (§3a) and an
authenticator app from its `totp` page (§4); without `accountRoutes` mounted, there is nowhere to add an optional one.

### 2b. What the Visitor Is Told

The notices are a closed set: the service is unavailable, you are throttled, or that did not match. Every other reason — expired, consumed, not
enrolled, deactivated, unrecognised — folds into **that did not match**, because telling them apart is the account-enumeration oracle the decoy
closes. The unredacted reason is for your logs and your branching, never for the page ([`FORGE_ERRORS.md`][eh-1c] §1c).

**A step-up adds one notice: that method cannot be checked right now.** It is the `unusable` reason, answered when a factor's stored secret will not
open, and it tells the user to choose another method (§9a). It says nothing about membership, because only a signed-in user reaches a step-up.

**On the primary path, throttled folds in too.** A known-but-throttled address answering "you are throttled" where an unknown one answers "that did
not match" is the same membership answer, so `complete` reports both `too-many-attempts` and `too-soon` as `unrecognised` there. `stepUp` and
`requestStepUp` keep the true reason: the visitor is already signed in, so there is no membership left to leak, and being told to wait is what makes
a lockout comprehensible.

**A throttle the visitor is told about answers `429`; one folded into "that did not match" answers what that notice answers.** The status is part
of the membership answer as much as the copy is, so the primary path's folded throttle keeps the `422` an unrecognised code gets. The step-up's
reported throttle answers `429` with the same re-rendered page and `Retry-After` set from the factor's `attemptWindowMs` ([`FORGE_ERRORS.md`][eh-3e]
§3e): an emailed code's `guessWindowMs`, which a new code does not reopen, or an authenticator app's or recovery code's `lockoutMs`.

### 2c. Where a Resolution Sends the Visitor

A resolution that is not `satisfied` is **a successful outcome of a correct sign-in**, not a refusal of one, so it is a page to visit rather than a
4xx. `enrolment-required` redirects to the enrolment page of the first kind it names — or to the verify page first, while the user holds a
second factor or recovery codes they have not yet passed (§9b). Once that kind is confirmed, the next owed kind's page follows, in `offered` order.
`step-up-required` goes back to the verify page, and `satisfied` to the return path: the `?next=` value reduced to a same-origin path, or your
`settledPath`. The guards and the sign-in actions both pick the page from the resolution's `kinds`.

The step-up mark lives on the signed-in session's D1 row. A step-up verification writes it by moving the row onto a new token, so a token read
before the step-up does not carry it. A fresh sign-in creates a new row and deletes the one the session held, with no mark where a second factor is
owed — proving the primary factor again proves nothing about the second — and marked at sign-in where the resolution is `satisfied`, since for
that user the primary factor is the whole proof.

**A step-up records the factor kind it was verified with, and nothing compares kinds.** The sessions page shows the kind (§7). No guard ranks one
kind above another, so a step-up by recovery code satisfies a demand exactly as a passkey step-up of the same age does.

**A user owing no second factor re-proves with an emailed code, and arriving at the verify page mails nothing.** When `require-fresh-step-up`
sends such a user to verify, the page offers to send a code, and only that `POST` issues one: a `GET` with a side effect is one a cross-site
navigation can trigger.

**A failed D1 read is an outage everywhere in auth, and answers 503.** It is never folded into a guess. A guard that cannot read the session or
the factor store, a redirect after a sign-in, step-up or enrolment that cannot read where the user stands, and an account page that cannot read
the user's enrolments each answer 503. A redirect on an unknown demand loops, and a page drawn as though nothing were held offers what the
minimum would refuse. Issuing a sign-up or sign-in code runs after the response, for the equal timing §1 and §2 owe, so it has no response
to answer with. A failed account lookup there is logged as `auth.signup.issue.failed` or `auth.signin.issue.failed`, a failure inside the
email-OTP factor as `auth.email-otp.<step>.failed` with the error it met, and the visitor's page does not change.

---

## 3. Passkeys

A passkey enrols a visitor and steps one up; it never starts a sign-in (§3b). On a factor service, `enrolment` sits at the top level rather than
under `capabilities` because TypeScript narrows a union only on a direct discriminant.

Every ceremony is two endpoints and two CSRF tokens. The server half stamps a contract onto the scope root; the browser half reads it off that
element and runs the ceremony ([`NAMESPACES.md`][namespaces-5h] §5h). **A token each, because the app's CSRF policy binds a token to one path** — a
ceremony spanning `begin` and `finish` cannot share one, and naming them apart stops either reaching the wrong endpoint.

The controller checks WebAuthn support **at mount, not at the press**: an unsupported browser reveals the fallback line and disables the trigger,
rather than failing after the visitor has committed.

### 3a. Enrolment

`authRoutes`' `enrol.passkey` and `enrol.totp` pages are guarded by `require-pending-enrolment`, which admits **only** a visitor who owes an
enrolment. **Nothing is chosen, because every owed kind must be enrolled:** a visitor owing several mandatory kinds is sent to the first one's page
in `offered` order, and to the next once it is confirmed. One who owes a step-up instead is sent to verify it first — an owed step-up cannot be
enrolled around — and so is one who owes an enrolment while holding another second factor or recovery codes (§9b). One who owes nothing is sent
to the settled path.

The ceremony posts to `enrol.ceremony.begin` for options and `enrol.ceremony.finish` with the credential. Registration excludes the credentials the
user already has, so re-enrolling one authenticator is refused by the browser, not by a later database conflict. `finish` writes no session
state: enrolment does not sign anyone in.

**A settled user adds a passkey through the account, never through `enrol.passkey`.** `accountRoutes`' `passkeyEnrol` page runs the same
ceremony against `passkeyCeremony.begin` and `passkeyCeremony.finish`, behind the `account` guards instead of the pending-enrolment one
([`AUTH_MOUNTING.md`][am-2] §2). When the last step-up has fallen outside the fresh window — single-factor users included — the page sends them to
verify and back before it renders, because `require-fresh-step-up` admits every `GET`; the ceremony's own 403 is the backstop. `finish` lands on the
`passkeys` list, or on the recovery-codes page when the user holds no unused codes (§9c). A user who still owes an enrolment is sent to
the `enrol` pages instead (§2c), because `require-enrolment` refuses them the whole `account` group.

### 3b. Sign-in

**A primary factor must identify the visitor, and a passkey identifies nobody — so no configuration makes one start a sign-in.**
`AuthFactorsOptions.primary` takes only a service whose kind is drawn from `AUTH_IDENTIFYING_FACTORS`: offering the passkey as primary is a type
error, and `createFactorRegistry` refuses it at runtime for a consumer casting past the type. The sign-in page therefore renders no passkey
trigger in any deployment, and no discoverable endpoint answers.

<!-- rule:forge-auth-passkey-user-verification --> A passkey only ever runs as a step-up or an enrolment, and a fresh human gesture is the point of
one. The second half of a sign-in runs the same step-up pair as any other step-up (§2c).

### 3c. Management

`accountRoutes`' `passkeys` page lists the visitor's credentials with their labels, creation and last-use times, a rename link and a remove control.
Removing a passkey is scoped to its owner in the statement's own `WHERE`, so ownership is not a check a caller can forget. Its enrol link, and
the one in its empty state, open the account ceremony (§3a). While the visitor holds exactly one passkey, the page also prompts them to add a
backup on another device or a security key — losing the only one leaves a recovery code as the way back in — and links to the same ceremony.

**The last confirmed factor of a mandatory kind is never removed, and the store holds the line (§2a).** `FactorStore.remove` and
`CredentialStore.removeForUser` take the floor — the mandatory kinds — and answer `second-factor-required` for a removal that would take a user's
last confirmed factor of one. An optional kind's last factor goes like any other. The check runs in the batch that deletes, so where passkeys are
mandatory, of two concurrent removals of a user's last two passkeys exactly one lands, and a refusal writes no event and signs nobody out. The store
refuses whoever calls; the one way below the minimum is the administrator's reset (§9e). Where the authenticator app is mandatory, the `totp` page
disables its remove control and points to replacing it instead; where passkeys are mandatory, the `passkeys` page disables removing a user's only
passkey and tells them to add another first. A removal that arrives anyway re-renders the page at **409** and sends no notice. Each page reads the
user's enrolments once, and a failed read answers 503 (§2c).

**Replacing the authenticator app in place is not a removal, so the minimum never comes into it.** The new secret is written over the old one
on the same row, which is never deleted, so at no instant does the user hold no second factor. A user who loses the app steps up with another
second factor or a recovery code and replaces it; the administrator's reset (§9e) is left for a user holding neither.

- **Where it starts.** The `totp` page links to `accountRoutes`' `totpReplace` page, which shows a new secret, and the code from it posts to
  `totpReplaceConfirm`. The link appears only on the account mount, and only where the offered authenticator-app factor can replace.
- **A fresh step-up, checked in the handler.** The page and the `POST` both measure the step-up against the `require-fresh-step-up` window the way
  the recovery-code `POST`s do (§9c), the page included, because it hands out a secret. A stale one is sent to verify and brought back, where the
  current app or a recovery code satisfies it.
- **Nothing changes until a code from the new app commits.** The old secret keeps verifying until then, so an abandoned replacement costs nothing.
  The pending secret is held sealed in the challenge store, bound to the session that asked, for the lifetime `src/auth/factors/totp-app.ts`
  gives it.
- **Wrong codes spend the pending secret's own budget**, `maxAttempts`, never the live row's. At the limit, or once it lapses, the pending secret is
  dropped, and the page shows a new one and tells the user to add that to their app.
- **The commit is one batch:** the new secret, the confirming step and a cleared budget on the row, a `factor-replaced` event, and every other
  session signed out. The user lands on the `totp` page and is sent a notice (§7).
- **A row removed before the commit is not recreated.** Where another session or an administrator's reset took it first, the user lands on the
  `totp` page, which says so, and no notice is sent.

A passkey needs no such path: a user may hold several, so a new one is enrolled beside the old before the old is removed.

**Removing one signs every other session out, and so does every other change to how the account steps up.** Adding or removing a passkey,
adding, removing or replacing the authenticator app, confirming a new set of recovery codes and spending a recovery code each delete every session
row the account holds except the acting one. The delete runs in the batch of the change and only where the change landed, so a wrong code or a
refused write signs nobody out. A session on a device this request cannot see is anonymous on its own next request, and the visitor stays where
they are. What signs out every session, the acting one included, is §7.

**No configuration removes the limits that apply to this page** — §8 states them.

### 3d. PRF Output Stays in the Page

A passkey factor given `prf` salts asks the authenticator to evaluate its PRF during the ceremony. The result is a 32-byte secret an app uses to
derive a key its server never holds.

**The output is handed to the page and nowhere else.** The controller gives it to the handler `onPasskeyPrf` registered, after the server has
verified the ceremony and before the page navigates. It never reaches the server, nor `PASSKEY_OUTCOME_EVENT`, whose DOM event bubbles to every
listener on the page.

<!-- rule:forge-auth-prf-by-output --> `prf.enabled` and `getClientCapabilities()` both misreport: an authenticator can claim PRF and return
nothing. So the handler is called whenever the options asked for PRF, with `output` set to `null` when no 32-byte result arrived. That lets a page
tell "this passkey has no PRF" from "nothing ran" before navigation tears it down.

**Step-up salts are keyed per credential, and none are sent when the user has no listed credential.** The browser matches each salt against
`allowCredentials`. It throws `NotSupportedError` on `evalByCredential` with an empty `allowCredentials`, and `SyntaxError` on a key that list
does not hold. So the factor asks for step-up salts only when the user has credentials, and drops any salt keyed to an id outside the list.

**A registration's output equals later assertions with the same salt.** An app can wrap its key as soon as the passkey is enrolled, without
waiting for a first step-up.

---

## 4. Authenticator App (TOTP)

TOTP is **step-up only**: an authenticator app proves possession, not who you are, so the registry refuses it as a primary factor at construction.

The page is mounted **twice**, and the two are not interchangeable. `authRoutes`' `enrol.totp` sits in `auth.enrol` behind
`require-pending-enrolment` and is where a visitor who _owes_ the enrolment clears it, because `require-enrolment` refuses the whole `account` group
while that enrolment is outstanding. `accountRoutes`' `totp` sits in `account` and is the settled visitor's management page; only it offers removal
(`totpRemove`) and replacement (`totpReplace`, §3c), there being nothing to remove or replace until something is enrolled.

Either mount renders the secret twice — as base32 to type, and as an `otpauth://` URI to paste. **Forge renders no QR code**; the URI is the seam
for one, and drawing it is yours. Submitting the code (`enrol.totpEnrol` or `totpEnrol`) confirms the enrolment, accepting one step of clock drift
either way and advancing the stored counter so a code cannot be replayed inside its own step.

**A wrong code costs a guess, spent before it is compared.** `failed_attempts` is incremented by the statement that admits the guess, so parallel
attempts each spend one rather than all comparing against a count none has written; past `maxAttempts` even a correct code is refused.
`src/auth/factors/totp-app.ts` owns its default and bounds, and `lockoutMs`' below.

**A spent budget reopens on its own, and the window is why a run of typos is not a permanent lock.** An accepted code clears the count, and so does
the first guess made more than `lockoutMs` after the one that hit the cap — the same `UPDATE` that admits it resets the count to 1. The default is
`AUTH_TOTP_LOCKOUT_MS`, configurable on `TotpAppFactorOptions` up to a day, because a longer window is the permanent lock this exists to prevent. A
refused guess writes nothing, so the window runs from the moment the cap was hit rather than from the last attempt, and hammering the factor cannot
hold it shut. Without the window a user who mistypes `maxAttempts` times loses the factor for good — and, as their only second factor, the
whole account. The ceiling holds on the enrolment ceremony too, which answers the same secret.

The secret is stored sealed under a per-purpose subkey with the user's own identity as associated data, so a secret lifted from one row cannot be
replanted on another.

**Re-opening an unfinished enrolment shows the same secret again, not a new one.** A mistyped code re-renders the page, and a page that rotated the
secret would hand back one the visitor's authenticator does not hold. The row is rebuilt only when the
stored secret will not open, which is a rotated key rather than an abandoned attempt.

**The code width and step follow the factor**, read off `codeDigits` and `codePeriodSeconds` rather than assumed, so a configured `digits` or
`period` is what the enrolment page states, what the `otpauth://` URI carries, and what the verify page sizes its field and schema to.

---

## 5. Email Change

**A change of address takes two links, and only the second one moves the account.** `accountRoutes`' `emailChangeSubmit` mints a sealed, short-lived
token and defers delivery of a link built by your `confirmUrl`. The page then says a confirmation has been sent — a 200 with a notice, not a
redirect, because nothing has changed yet.

**An account may ask for a change once per cooldown.** A request inside `AuthEmailChangeOptions.cooldownMs` of the account's last one —
`AUTH_EMAIL_CHANGE_COOLDOWN_MS` unless set — is refused as `too-soon` and sends nothing, and the page asks the visitor to try again in a few
minutes. The cooldown is the one bound on how much mail an account can have sent to an address it names.

**The first link goes to the address the account already holds**, whenever that address is verified, so the move is authorised by whoever owns the
current mailbox rather than by whoever holds the session — without which a stolen cookie moves the account to the thief's inbox and, with email-OTP
as the primary factor, locks the owner out for good. An unverified address has proved nothing, so there the new one is the only address to ask and
gets the link instead.

**Name `sentTo` on the page, not the address the visitor typed.** `AuthEmailChangeFlow.request` answers `AuthEmailChangeRequest`, whose `sentTo` is
the address the mail actually went to — and which of the two addresses that is depends on whether the account's own is verified. The shipped action
renders the flow's answer for exactly that reason; a page that echoes the typed address tells half its visitors to watch the wrong inbox.

**The token carries a stage, and only a `move` token changes the row.** A link mailed to the address the account already holds carries `approve`:
answering it writes nothing and instead forwards a second link, carrying `move`, to the new address. Answering _that_ one moves the account. An
unverified account has one stage rather than two — its single link already went to the new address, and already carries `move`.

**The stages are split, because marking an address verified that nobody answered verifies nothing.** `changeEmail` stamps the verification in the
same statement that writes the address, so the address it marks must be one that has answered a link sent to it. Under a single stage the _old_
address answered and the _new_ one became a verified primary factor unread — an account's whole sign-in resting on a mailbox no one had proved they
could open.

**The new address is deliberately never looked up before the email goes out.** Answering "that address is taken" here is the same enumeration oracle
sign-in refuses to give. The unique index refuses the collision at the `move` stage instead, folded into the same refusal an unknown account gets.

**You mount the confirm route, as a `GET` that reads and a `POST` that acts.** Forge ships `AuthEmailChangeFlow.inspect` and `confirm` and no
route that calls either: the URL shape is yours, so the handlers are too. `inspect` decodes the token and answers its stage and the new address,
touching neither the nonce store nor the account. `confirm` decodes it, burns it through the nonce store — a second post of the same token answers
`consumed` — and only then acts on the stage it read. An `approve` token defers the second mail and answers `forwarded`, whose `sentTo` names the
new address the second link went to. A `move` token writes the address and marks it verified in one statement, answering `moved`.

**Forge renders the form, and the pages around it are yours.** `EmailChangeConfirmView` renders the `POST` form for the stage `inspect` read,
carrying the link's token and a CSRF token you mint for your `POST` path with `mintCsrf`. `resolveAuthView` does not reach it — it is no
`AuthViewName` — so render it, and the refusal and outcome pages, in your own layout; [`AUTH_MOUNTING.md`][am-6] §6 is the recipe for putting a
forge auth view beside it.

**It renders in the same document shell the auth pages do**, because that shell belongs to the app rather than to the mount
([`ROUTING_AND_MIDDLEWARE.md`][ram-6] §6). Call `renderShell` from your own view with a slot you name yourself — its `mount` is an
open string — and the page comes out inside the chrome every auth page already renders in. Forge asks a shell for a document, not for a component
typed against `AuthViewName`, so there is no adapter to write.

**The link only reads, because a link scanner opens it before its owner does.** Mail scanners, prefetchers and preview panes issue the `GET` a
mailed link carries; a `GET` that burned the token let the scanner approve or complete the move and left the owner's own click answering
`consumed`. **Act only from the `POST`**, a step only a person takes, and add no idempotency of your own: the nonce store makes it single-use.

**The `POST` renders two success pages, and the failure arm needs `instanceof`.** The success value `confirm` answers is a union discriminated on
`status`, and its error is a union of a string literal and the `AuthStoreError` class, so those two arms are told apart by type rather than by
value. The handler is [`src/auth/README.md`][auth-readme]'s.

**A `forwarded` answer is not a finished change, and the page has to say so.** The visitor has approved the move and nothing has changed yet; what
clears it is the link now sitting in the new inbox. Render `sentTo` and the fact that one step is left, or the visitor reads approval as completion
and never opens the second link.

**The token is encrypted, not merely signed.** The confirmation carries an address in a URL, and a URL lands in browser history, the `Referer`
header, corporate link scanners and proxy logs; a signed cleartext token hands the address to every one of them.

**A completed move signs every session out, this one included.** The address is the account's identity, so the `move` stage deletes every session
row the account holds in the batch that writes the address, and spares none: the confirmation link is opened from whatever browser answered the
mail, which is not necessarily one the account was signed in on. Render the `moved` page as a page that asks the visitor to sign in again.

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
standing rather than none; the count the page displays is never what a write is trusted against.

Deleting a user removes its children first, in one batch that rolls back whole. A row in an app table that still references the user refuses
the delete, and the page answers **409** with the outcome `referenced`: the app's own records go first.

**An account's factors page carries a reset control**, the last resort for a user who has lost every second factor and every recovery code.
What it clears and what it allows is §9e.

**Elevation is the first-admin bootstrap, which is why it is not admin-gated.** A signed-in, enrolment-satisfied visitor may claim the role only
while there is no admin at all, and the count is re-read **at write time** — the check on the page is a courtesy, and the one at the write is what
stops two simultaneous visitors becoming two first admins. **The claim moves the claimant's session onto a new token in the same batch**, and
only where the claim landed, so the token held before the claim never ends up elevated.

**The claim is two steps: an administrator approval, then the confirmation.** A visitor whose session holds no approval inside the window is sent
to the approval prompt to present the administrator code, then returned to the claim page. Only after that do they confirm. The claim form asks for
the confirmation alone, because the code is held by the approval and not by the form. On the prompt, a wrong code and a failed challenge get the
same **422** on the code field, so a script cannot tell which of the two it has to defeat, and its copy names neither, so an administrator whose
challenge fails is not told their code is wrong. How the approval is defined and passed to the guards is [`AUTH_MOUNTING.md`][am-3] §3.

**Signing in and signing out both clear the approval.** A sign-in never inherits an approval granted before it, including one granted to the
anonymous session that became it. A visitor who presented the code during sign-up is therefore asked for it again at the claim, after they sign
in. The same holds for an approval granted while another user was signed in on the same browser.

**An approval lives in the session for every visitor, signed in or not, and not on the signed-in session's row.** It has to, because an
anonymous sign-up can be held behind one. So ending a sign-in from elsewhere — another device's revoke, a deactivation — ends the approval only
where the route also runs `require-auth`, as `admin.elevate` does. On a route without it, the approval holds until its window runs out.

---

## 7. Sessions and Security Events

**`accountRoutes`' `sessions` page lists the user's live sessions, and signs any other one out.** Each row shows the device, when it signed in,
when it was last used and the factor it last stepped up with, and marks the session the page is read from. A row's sign-out posts the session's
public id to `sessionRevoke` as a form field, so one CSRF token serves every row. "Sign out everywhere else" posts to `sessionsRevokeOthers`. Both
`POST`s sit in the `account` group behind `require-fresh-step-up`. An id the user does not hold answers 404, and so does the current session's own
id, which only sign-out ends. The factors page links the list, and adding it to your app's navbar is yours ([`AUTH_MOUNTING.md`][am-5] §5).

**The device is a coarse label, never the client's own words.** A label such as "Firefox on macOS" is read off `User-Agent` at sign-in against a
fixed table of browser and platform names, and is absent where neither is recognised. Neither the user agent nor an IP address is stored.

**Sign-ins, step-ups and changes to an account's security each write one `auth_security_events` row.** `AuthSecurityEventType` in
`src/auth/types.ts` is the list: a sign-in, a step-up, sessions signed out, and every change to a factor, the recovery codes, the address, the
administrator role or the account's status. `createSecurityEventStore` reads an account's rows, newest first.

**A row holds the event type, the factor kind, the acting session's public id, the acting administrator and the time.** It never holds an
address, an IP address, a user agent, a code, a token or a token's hash.

**The row is written in the same batch as the change it records.** A refused write leaves no row, and a failed batch rolls the row back with the
change, so a row exists exactly where its change landed.

**The account holder is told about changes, not about sign-ins.** After a factor is added, removed or replaced, recovery codes are issued or one is
spent, the administrator role is granted or revoked, the factors are reset, or the account is deactivated or reactivated, the account's address is
sent a `security-event` message through your `AuthNotifier`. A sign-in, a step-up and a sessions sign-out send nothing; `AuthNotifiedEventType`
is the list. **An address change is told to the old address**, because the new one belongs to whoever moved the account.

**A notice is best-effort, and the event row is the durable record.** The notice is sent after the response through your `AuthDeferral`. A delivery
that fails is logged as `auth.security-notice.failed`, and is neither retried nor thrown. No notice is sent for a write whose row did not land.

**Rows are kept for a year, and go with the account.** `purgeAuthEphemera` deletes a row older than `AUTH_SECURITY_EVENT_TTL_MS` (365 days);
`AuthEphemeraPurgeOptions.securityEventTtlMs` changes that, but never below thirty days. A backlog older than that goes over several runs, since
each run deletes a bounded number. Deleting the account deletes its rows. An administrator's factor reset keeps them.

**Some changes sign out every session, the acting one included:** a completed address change (§5), a deactivation (§6) and the administrator's
reset (§9e). A factor change spares the acting session (§3c). Signing out destroys the session and the visitor's data with it, unless the app
passes `signOut: { keepVisitorData: true }` ([`AUTH_MOUNTING.md`][am-1] §1).

---

## 8. Limits in This Release

Stated here rather than left to be discovered, because each changes what a consumer must build.

**Rate limiting is yours to configure, and forge ships no numbers.** The seam exists — `AuthGuardChainOptions.rateLimit`, keyed by group path,
[`AUTH_MOUNTING.md`][am-1] §1 — and nothing is mounted until you fill it. The OTP and TOTP attempt budgets bound the guesses against one
identity and say nothing about how often a caller may ask across identities, so outbound email is triggerable by anyone until you attach a limit.

**No mutation is held across a re-authentication.** When `requireFreshStepUp` refuses a state-changing request, the visitor steps up, lands on the
settled page and repeats the action — forge keeps no pending write to replay for them.

**The email-change link is burned before the address is written.** A store failure between the two spends the link and changes nothing, so the
visitor asks for another — the deliberate side to fail on, since burning after the write leaves a window in which one link applies the same change
twice.

**Whether a synced passkey is acceptable is your policy, not forge's.** `backupEligible` is fixed for a credential's life and is checked against the
enrolled value on every assertion, so a changed one is refused as the misreporting it is; `backedUp` moves and is kept current. Refusing a synced
credential outright is right for a high-assurance tenant and wrong for a consumer product — read both off `CredentialStore` and decide.

**A new set of recovery codes has no print view.** The user copies the set from the codes page, the only place it is shown, before confirming one
of the codes. That it is never offered as a download is a ruling rather than a limit (§9c).

**Federated identity is not here.** An OIDC relying party or OAuth2 provider is a subpath of its own under the same one-way rule
([`NAMESPACES.md`][namespaces-5h] §5h).

**Anyone who knows an address can spend its emailed-code guesses.** A code is bound to the browser that asked for it (§1), but the attempt budget
belongs to the account. So an attacker can ask for a code for someone else's address, which binds it to the attacker's browser, and spend the
account's guesses there. Until the guess window (`AUTH_OTP_GUESS_WINDOW_MS`) reopens, the owner's own code is refused, and sign-in tells them only
that it did not match (§2b). A request made once the cooldown (`AUTH_OTP_COOLDOWN_MS` by default) has run also replaces the live code with a new
one, mailed to the owner but bound to the browser that asked, so the code the owner holds stops working and the one they are sent works only in the
asker's browser. That needs nothing beyond the address and grants no guess the account's budget does not already allow. This is accepted. A budget
per browser would give every new browser a fresh set of guesses at the account, so the budget stays per account. A rate limit on the sign-in group
(above) is what narrows how often one caller can do it.

**Under D1 read replication, a revocation can lag on another device.** A session ended from one device is a deleted row, and a read on another
device can land on a replica that has not seen the delete yet. With `d1Sessions` and a bookmark carrier, that device's reads start from its own
last bookmark or from any replica, so it can stay signed in until the replica catches up. Without read replication every read reaches the
primary, and a revocation holds on the next request. How the bookmark carrier routes a read is
[`STORAGE_BINDINGS.md`][sb-1g] §1g.

---

## 9. Recovery — No Lost Value Locks an Account Out or Lets It In on Less

**No missing key, device or code may lock an account out, and none may let it in on less than it needed before.** Every way back below passes
through a second factor the user still holds. The one exception is the administrator's reset (§9e), by design.

| What was lost | What the user sees | How they get back in |
| --- | --- | --- |
| The ring key an authenticator-app secret is sealed under, or a secret that will not open under it | The verify page says the method cannot be checked right now, and offers their other methods | Step up with a passkey or a recovery code, then replace the app in place (§3c). Putting the key back in the ring instead makes the old enrolment work again |
| An authenticator-app row `purgeStaleTotpSecrets` dropped | The verify page, not the enrolment page | Step up with another second factor or a recovery code, then enrol the app again, since the purge runs only where it is mandatory (§9b) |
| The phone or security key itself | The verify page | Choose a recovery code, then replace the lost factor from the repair page (§9d) |
| The session secret | A signed-out session | Sign in again with the address and the second factor |
| The CSRF secret | A 403 on a form already on screen | Reload the page and submit again |
| Every second factor and every recovery code | No way to step up | An administrator resets the account (§9e) |

### 9a. Choosing a Factor at Step-Up

**The verify page offers every second factor the user has confirmed, recovery codes included.** It presents the first in `offered` order and
links each of the others. The link names the kind as `?factor=<kind>` and keeps the return path, and the form posts to the same query. The server
presents the named kind only when it is one this user's resolution offers, so a forged value falls back to the first.

**A factor whose stored secret cannot be opened answers `unusable`, and costs no guess.** The authenticator-app factor opens the secret before it
spends an attempt, and the enrolment stays confirmed, so a key put back in the ring makes it work again. Verify re-renders at 422 with the notice
of §2b and the other methods, and logs `auth.factor.unusable` at warn with the factor's kind. That log is the operator's cue; what to do on it is
[`src/auth/README.md`][auth-readme]'s.

### 9b. A Held Factor Is Passed Before Any Enrolment

**A user who owes an enrolment while holding a second factor or recovery codes passes one first.** `resolve` answers `enrolment-required` with
`stepUpKinds`, which names the offered second factors this user holds, and `recovery-code` when they hold codes. While that list is not empty and
the session holds no step-up mark inside `stepUpMaxAgeMs`, sign-in, verify, `require-auth` and `require-pending-enrolment` all send the user to
verify. A mark dated in the future counts as none. Verify measures the mark against the same window as the guards, so the two cannot bounce a user
between them. After the step-up they go on to the enrolment page.

Without this, holding the mailbox would be enough to enrol an authenticator of your own. The ordinary way to reach it is `purgeStaleTotpSecrets`.
The purge runs only where `totp-app` is offered as mandatory. It drops a stale row only from a user who holds another confirmed offered second
factor or an unused recovery code, and keeps the row of anyone who holds neither. It answers a `TotpSecretPurgeReport` counting both. A replacement
(§3c) seals the new secret under the active key, so a user the purge was keeping leaves its `kept` count by replacing the app.

<!-- rule:forge-auth-last-verified-stamp --> The purge measures staleness by `last_verified_at`: left NULL, the first run drops every long-standing
user's factor; stamped on a merely spent guess, it reaches no one.

### 9c. Recovery Codes

**Recovery codes are required beside the second factors, and are not one of them.** `AuthSecondFactorOffering` takes them as `recovery`, apart
from `offered`, because a lost device or key would otherwise lock its users out. So an offering without codes, codes offered as the primary or
among `offered`, and a requirement set on codes are each a type error, and `createFactorRegistry` throws on the same shapes for a caller casting
past the types. Codes pass a step-up, but the user does not elect them, and they are neither mandatory nor optional: no minimum counts them (§2a).

**Codes are issued only to a user who holds a confirmed second factor and has stepped up inside the `require-fresh-step-up`
window.** Both code `POST`s check this in the handler, not through `require-fresh-step-up` alone, which a mount can turn off with `null`. Without
it, holding the mailbox would be enough to mint a way past the second factor. A user holding no such factor gets a 409, and a stale step-up is
redirected to verify and brought back to the codes page.

**The handler measures the step-up against the window the guard is configured with, never a window of its own.** A tightened
`freshStepUpMaxAgeMs` tightens code issuance with it, and `null` still demands a step-up in this session, of any age — the guard opting out of the
demand does not let a mailbox mint codes. Where `require-fresh-step-up` did not run, no window exists and the handler sends the user
to verify every time. The window itself is set at the mount ([`AUTH_MOUNTING.md`][am-2] §2).

**A new set replaces the old one only when the user types one of the new codes back.** Generating a set stages it, and the old set keeps working
until the confirmation, so a set the user never saved costs them nothing.

<!-- rule:forge-auth-recovery-codes-no-file --> **A set is shown once, laid out for copying.** The codes page presents a new set in one block the
user can copy whole, and tells them to keep it somewhere safe now, because it will not be shown again. Only the SHA-256 of each code is stored, and
the page is sent `no-store`.

**Each code works once.** Using one spends it and clears the factor's spent guesses in the same batch. A wrong code spends a guess, against the
same `maxAttempts` and `lockoutMs` budget the authenticator app uses. Spaces, dashes and letter case are ignored.

**A user who holds no unused codes is sent to generate them.** After every step-up or enrolment, a user holding a confirmed second factor and
no unused codes is redirected to the codes page. Enrolling is not a step-up, so after a first enrolment the user proves the new factor
once on verify before the codes page lets them generate.

**Removing the last second factor removes the codes with it**, in the same batch, so no account is left holding codes alone.

### 9d. A Code Lands on the Repair Page

**A step-up by recovery code always lands on the account's factors page with `?recovered=1`**, whatever return path the step-up began with. The
page says how many unused codes are left and how to repair the factor that stopped working, then to generate a new set. A user holding an
authenticator app the factor can replace is linked to replace it in place (§3c), because a second app row is impossible. A passkey is added
before the old one is removed, since removing it first may be refused (§3c). Where the app cannot be replaced, the page gives the
add-before-remove advice for both. A code is spent on getting in, so the repair is the next thing the user must see.

### 9e. The Administrator's Reset Is the Last Resort

**The reset deletes the user's factors, passkeys, recovery codes and sessions, and revokes every bearer token they hold, in one batch.** Every
session and every token the user holds is refused on its next request. The control is on the account's admin factors page
and posts to `adminRoutes`' `users.resetFactors`, which sits in `admin.users`, so the administrator must have stepped up recently.

**This is the one path below the second-factor minimum (§3c), and the one that lets an account in on less than it needed before.** It is for a
user who has lost every device and every code; a user with a recovery code left replaces a lost authenticator app in place instead (§3c).
They sign in with the address alone. Where a second factor is mandatory, they reach nothing until they enrol each mandatory kind, on the strength
of the mailbox, and are then sent to generate codes. Where none is, zero is already the minimum, and they are simply signed in. That is why the
reset takes an administrator rather than anything the user can do.

**An administrator cannot reset their own account.** The request answers 409 with the outcome `self`, and an unknown user answers 404.

[am]: ./AUTH_MOUNTING.md
[am-1]: ./AUTH_MOUNTING.md#1-the-mount-in-order
[am-2]: ./AUTH_MOUNTING.md#2-the-route-groups-and-their-guards
[am-3]: ./AUTH_MOUNTING.md#3-what-forge-does-not-ship
[am-5]: ./AUTH_MOUNTING.md#5-what-mounting-costs-you
[am-6]: ./AUTH_MOUNTING.md#6-embedding-an-auth-view-in-your-own-page
[auth-readme]: ../src/auth/README.md
[eh-1c]: ./FORGE_ERRORS.md#1c-guardresult-and-validationresult-domain-aliases
[eh-3e]: ./FORGE_ERRORS.md#3e-one-refusal-contract-for-every-guard
[eh-5e]: ./FORGE_ERRORS.md#5e-startup-invariants--env-validation-and-binding-resolvers-throw
[namespaces-5h]: ./NAMESPACES.md#5h-auth--identity-and-only-the-domain-of-it
[ram-6]: ./ROUTING_AND_MIDDLEWARE.md#6-the-page-shell
[sb-1g]: ./STORAGE_BINDINGS.md#1g-transactions--batch-is-the-boundary
[ucr-3c]: ./UI_CLIENT_RUNTIME.md#3c-resumable-scopes
