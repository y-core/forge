---
title: Identity and Credentials
description: "The identity domain and the two tiers over it: key rings, the AES-GCM token codec, stores, factors and ceremonies; the mountable routes, guards and views; and the browser passkey controller."
audience: consumer
---

# `@y-core/forge/auth`

Identity for Workers apps: who a user is, which credentials prove it, and what a session may then
do. The capability ships as **three subpaths**, and the split is what keeps the domain testable with
no authenticated world to build first ([`BOUNDARIES.md`](../../warden/canon/libs/BOUNDARIES.md) §2c).
The rule that binds all three is [`NAMESPACES.md`](../../docs/NAMESPACES.md) §5h.

| Sub-path | Owns | Entry points |
| --- | --- | --- |
| `@y-core/forge/auth` | The identity **domain** — no `Response`, no `Session`, no markup | `resolveAuthServices`, the stores, the factor registry, the ceremony parsers |
| `@y-core/forge/auth/web` | The mountable **web layer** — routes, guards, loaders, actions, views | `registerAuth`, `registerAccount`, `registerAdmin`, `createAuthGuards` |
| `@y-core/forge/auth/client` | The **browser half** of the passkey ceremony | a side-effect import, no value exports |

**The edge is one-way: `auth/web` imports `auth`, and `auth` never names `auth/web`.** A domain rule
that wants to redirect is reaching across the split — the rule returns a reason, and the web layer
alone turns it into a `Response`.

**Mounting the capability** — the order, the guards and the seams you supply — is
[`AUTH_MOUNTING.md`](../../docs/AUTH_MOUNTING.md); what each flow does once mounted is
[`AUTH_FLOWS.md`](../../docs/AUTH_FLOWS.md). This README is the export surface.

---

## `@y-core/forge/auth` — the identity domain

> Import path: `@y-core/forge/auth` → `src/auth/mod.ts`

```ts
import {
  AUTH_SUPPORTED_ALGORITHMS,
  AuthStoreError,
  authNonceKey,
  decodeAuthToken,
  encodeAuthToken,
  createUserStore,
  createEmailOtpFactor,
  createFactorRegistry,
  createChallengeStore,
  createNonceStore,
  createPasskeyRegistrationOptions,
  createPasskeyRequestOptions,
  importAuthKeyRing,
  normalizeEmail,
  purgeAuthEphemera,
  resolveAuthServices,
} from "@y-core/forge/auth";
```

### Features

- **Per-request capability resolution** — `resolveAuthServices` reads the root key ring off the
  request context, validates it, and caches the result per `env` object and per options object.
- **A capability probe that fails closed** — configuring COSE `-8` on a runtime that cannot import
  an Ed25519 key throws at resolution rather than at the first sign-in.
- **Deterministic email identity** — `normalizeEmail` produces the key a unique index holds, so two
  spellings of one mailbox cannot become two accounts.
- **One I/O error class** — `AuthStoreError` carries `code`, `operation`, `constraint` and `cause`.
  A domain rule refusing is a reason union, never this class.
- **An encrypted token codec** — `encodeAuthToken` / `decodeAuthToken` seal a payload under
  AES-256-GCM with a per-purpose subkey, so the address inside an email-change confirmation link is
  not readable from the URL.
- **Store contracts with shipped adapters** — every store, durable and ephemeral alike, is a SQL
  adapter over one `D1Client`, every method returning a `Result`, with `UserStore` and
  `AdminUserStore` split so a sign-in service cannot hold the capability to delete a user.
- **A factor contract and registry** — email-OTP, passkey and TOTP-app, closed, with the enrolment
  ceremony reached by control flow rather than by a cast.
- **The email-OTP factor** — an exact issue counter inside a self-healing window, and attempts
  checked before they are incremented.
- **The passkey ceremony substrate** — options builders that advertise only what this runtime can
  verify, plus client-data and authenticator-data verification.
- **Three flows over all of it** — signup, sign-in with step-up, and email change, each deferring
  its delivery so the response says nothing by its timing.

### Capability resolution — `resolveAuthServices`

```ts
function resolveAuthServices(context: RequestContext, options: AuthOptions): Promise<AuthServices>;
```

`options.secret` is a resolver over the request context returning an `AuthKeyRing` — an
`activeKeyId` plus every key id still valid for reads, each at least 32 bytes. Rotation is adding a
key and moving `activeKeyId`; the old key stays for as long as tokens signed under it may arrive.

Resolution **throws** on a configuration that cannot work: an `activeKeyId` the ring has no key
for, a key shorter than 32 bytes, or COSE `-8` on a runtime without Ed25519. That is the
resolving-a-binding half of [`ERROR_HANDLING.md`](../../docs/ERROR_HANDLING.md) §5e — operating on
a resolved store returns a `Result` instead.

The result is cached in a `WeakMap<env, WeakMap<AuthOptions, AuthServices>>`, so one Worker isolate
resolves the ring once and every later request on that isolate reuses it. **Both keys, because one
would be wrong:** keyed on the `env` alone, two mounts with different `AuthOptions` on one binding
set shared a single `AuthServices`, and the second caller silently got the first's key ring — a
token minted under one deployment's secret and read under another's.

### Supported algorithms — `AUTH_SUPPORTED_ALGORITHMS`

```ts
const AUTH_SUPPORTED_ALGORITHMS: readonly AuthAlgorithm[]; // [-7, -257]
```

The COSE algorithms a passkey ceremony advertises by default: ES256 and RS256. SimpleWebAuthn
advertises `[-8, -7, -257]`; forge omits `-8` because advertising an algorithm the runtime may not
verify is fail-open in shape — the browser enrols an Ed25519 credential and the user is then locked
out of the account it belongs to. Opt in by passing `algorithms: [-8, -7, -257]`, which arms the
probe above.

### The token codec — `encodeAuthToken`, `decodeAuthToken`, `authNonceKey`

```ts
function encodeAuthToken(ring: AuthKeyRing, purpose: AuthTokenPurpose, payload: string, ttlMs: number, options?: AuthTokenOptions): Promise<string>;
function decodeAuthToken(ring: AuthKeyRing, purpose: AuthTokenPurpose, token: string, options?: AuthTokenOptions): Promise<Result<AuthTokenClaims, AuthTokenReason>>;
function authNonceKey(ring: AuthKeyRing, token: string): Promise<Result<string, AuthTokenReason>>;
```

Every emailed credential rides on this codec: OTP tokens and email-change confirmations.

**AES-256-GCM, not a signed-but-readable token.** An email-change confirmation carries the new
address **in a URL**, and a URL lands in browser history, the `Referer` header, corporate link
scanners and proxy logs. A signed cleartext token hands the address to every one of them.

The frame is `version(1) ‖ kid(6) ‖ iv(12) ‖ iat(8) ‖ exp(8) ‖ ct‖tag`, base64url, opening with
`AUTH_TOKEN_VERSION`. The whole header is the AEAD's associated data, so a flipped byte in any field
fails the tag rather than quietly moving the expiry. A token is authenticated **before** it is judged
expired — an expiry read off an unauthenticated frame is an attacker's number.

**Four purposes, four subkeys.** `verify`, `identity`, `totpWrap` and `nonce` each expand a distinct
HKDF subkey from the root, and the purpose is bound into the associated data as well. A token minted
for one purpose does not open under any other.

**`identity` is the email-change purpose, and nothing else uses it.** The name stays general, but the
subkey is not a shared one to mint against: a second use would open every email-change token to
whatever the new caller accepts as a payload. Mint a purpose of its own instead — that is a key-ring
change, which is why the present single use is named here rather than renamed.

**`authNonceKey` is `HMAC(nonceSubkey, token)`, not `sha256(token)`.** A bare hash is computable by
anyone holding the token, which hands an observer with read access to the nonce store a
consumed-or-not oracle for a token they merely saw in a log.

`AuthTokenReason` is `"expired" | "malformed" | "not-authentic" | "unknown-key" |
"unsupported-version"`. It is for your logs and your branching — never echo it to a client
([`ERROR_HANDLING.md`](../../docs/ERROR_HANDLING.md) §1c).

### Key ring construction — `importAuthKeyRing`, `authKeyId`

```ts
function importAuthKeyRing(secrets: [string, ...string[]]): Promise<AuthKeyRing>;
function authKeyId(key: Uint8Array): Promise<string>;
```

Hand `importAuthKeyRing` the hex root secrets, newest first. Each id is **derived** —
`AUTH_KEY_ID_LENGTH` base64url characters, a domain-separated fingerprint of the key material, which
is exactly the six kid bytes the frame carries. Nobody types a key id, so the frame field and the
ring can never disagree.

Rotation is prepending a secret. Tokens minted under the old key keep opening for as long as it
stays in the list, and `authNonceKey` derives from the **token's own** key id, so a token consumed
before a rotation stays consumed after one.

**A degenerate secret is refused, not merely a short one.** The 32-byte floor is a length check, and
32 zero bytes passes it — so `importAuthKeyRing` also throws on a secret whose bytes are all one
value, and on one carrying fewer than eight distinct byte values. Both are shapes that say the secret
was never generated.

Each derived subkey and each imported `CryptoKey` is cached per ring, the `CryptoKey` under its kid,
purpose **and** algorithm — the AEAD key and the HMAC key of one subkey carry different usages and
are not the same key under a new name.

### Stores — the contracts

Every method returns a `Result`. **Not-found is `data: null`, never an error** — the same shape
`KVStore.get` and `D1Client.queryOne` already return. I/O failure is the one `AuthStoreError`; a
domain rule refusing is a reason union on the service that owns the rule.

| Contract | Owns |
| --- | --- |
| `UserStore` | the reads and writes a sign-in service makes. `remove` and `setAdmin` are **absent** |
| `AdminUserStore` | listing, searching, elevating, deactivating and deleting — the surface an admin route holds |
| `FactorStore` | enrolments, including `findEnrolled`, which resolves every offered kind in one query |
| `CredentialStore` | registered passkeys, keyed by the base64url id the browser reports. Every write is scoped to the owner |
| `IdentityLinkStore` | federated identities bound to a local user |
| `ChallengeStore` | ceremony challenges. `take` is read-and-delete |
| `NonceStore` | one-shot consumption. `markConsumed` reports `true` only the first time |
| `OtpStateStore` | one identity's live emailed code and the guesses spent against it |
| `AuthNotifier` | delivery. Forge ships the contract and **no mailer** |

**Five methods carry rules a hand-written adapter has to reproduce**, because the caller does none of
this itself:

| Method | What the statement must do |
| --- | --- |
| `UserStore.revokeSessions(id, at)` | Raise a monotonic barrier. Every session established at or before `at` is refused on its next request, so the write must not lower one already stamped later. |
| `FactorStore.countAttempt(userId, kind, maxAttempts, at, lockoutMs)` | Find the factor **and** spend one guess against it in the one statement, answering the `AuthFactor` or `null`. `null` is "no such factor, or the budget refusing" — the two are told apart by a second read, and only once the write has already been refused. |
| `IdentityLinkStore.unlink(id, userId)` | Carry the owner in the `WHERE`, so a link id belonging to somebody else unlinks nothing. |
| `OtpStateStore.discard(userId, token)` | Delete **that named code** and no other, so an undelivered issue hands its cooldown back without wiping a racing issue that did send. |
| `OtpStateStore.issue` / `countAttempt` | Decide in one conditional statement. These are security counters on the primary factor, and a read followed by a write hands every parallel request a free extra guess. |

**The `UserStore` / `AdminUserStore` split is the point, not tidiness.** A sign-in service that
holds a `UserStore` cannot delete a user, because the method is not on the type it was given — not
merely unused.

**Writing an `AuthNotifier`.** One method, `send(message: AuthMessage): Promise<AuthStoreResult<void>>`
— so a delivery that worked returns `ok()`, not `undefined`, and `ok` comes from
[`@y-core/forge/result`](../result/README.md). A failure returns `err(new AuthStoreError("unavailable",
"notifier.send"))`; the flows read any failure as `unavailable` and refuse the attempt rather than
reporting a code that never left the building.

**`ChallengeStore.take` is read-and-delete.** "Clear the challenge even when verification fails" is
then structural rather than a branch a later contributor forgets to write.

**A refusal is one conditional statement that reports rows-affected, never a read then a write.**
The last admin who could still sign in cannot be demoted, deactivated or deleted — a deactivated
admin is exempt, since removing one locks nobody out; a TOTP code cannot be replayed inside its own
step; a passkey cannot be renamed or deleted by anyone but its owner — each because the rule is
in the statement's own `WHERE`, evaluated where the write happens. Two concurrent demotions
therefore leave one admin standing rather than none. And **every** write on every store reports
whether it changed a row — `false`, or an `AdminUserOutcome` naming which guard refused — so a write
against an id that is not there is never mistaken for one that landed.

**Deactivation revokes access at the next request, not at the next sign-in.** `deactivatedAt` is
refused at every entry point that admits a user: the passkey verifier, the sign-in flow, the
step-up, and the email change — each under its own reason, so an operator's log distinguishes them.
`resolveAuthIdentity` in `auth/web` re-reads the user on every request and answers `null` for a
deactivated one, so a session issued before the deactivation stops working on its next request
rather than surviving until the cookie expires. That refusal also **drops the session's own auth
keys**, so reactivating the account does not revive the cookies issued before it — the visitor signs
in again. A store outage denies without clearing: it is a transient answer, and signing every user
out of a database blip is the worse failure. What the **visitor** sees says none of this:
`redactSigninReason` folds `deactivated` into the same `unrecognised` an unknown address gets, since
telling the two apart is the account-enumeration oracle the deferred challenge exists to close.

**Rows-affected is measured, not assumed.** Every one of those guards decides on `rowsWritten > 0`,
which `D1Client` reads as `meta.rows_written ?? meta.changes` — so a matched write reporting zero
would invert all of them at once. `tests/workerd/auth-schema.test.ts` asks a real D1 and holds the
answer: **both fields are populated and they agree**, a matched `UPDATE` or `DELETE` reports `1`, an
unmatched one reports `0`, and a row that matched the guard but whose value did not change still
reports `1` — so re-stamping a state a row already holds is `changed`, never a refusal.

### Durable store adapters — `createUserStore` and its four siblings

```ts
function createUserStore(db: D1Client): UserStore;
function createAdminUserStore(db: D1Client): AdminUserStore;
function createFactorStore(db: D1Client): FactorStore;
function createCredentialStore(db: D1Client): CredentialStore;
function createIdentityLinkStore(db: D1Client): IdentityLinkStore;
function createOtpStateStore(db: D1Client): OtpStateStore;
```

Each is named for the contract it fulfils, and the backing is the argument: a `D1Client` from
[`@y-core/forge/storage/db`](../storage/README.md), so every statement is a `sql` fragment and every
value a bind parameter. A second adapter for the same contract would be named by what distinguishes
it, never by the product beneath it ([`NAMESPACES.md`](../../docs/NAMESPACES.md) §5h).

A `UNIQUE constraint failed` from D1 becomes `AuthStoreError` with `code: "conflict"` and the index
name in `constraint`; a `CHECK constraint failed` becomes `code: "invalid"`, which says the caller's
own value was refused rather than that the backend is down; anything else becomes
`code: "unavailable"`. None is ever thrown across the boundary.

**Every method is total, including on input the caller never validated.** An id that is not a
canonical UUID answers what that method's contract calls no such row — `null` for a finder, `false`
for a conditional write, `"not-found"` for an `AdminUserOutcome` — and binds no statement at all, so
a crafted `?after=u9` is an empty page and not a 500. An insert is the one shape with no in-band
answer of that kind, so a malformed owner id is reported as `unavailable`, which is what the foreign
key would have said. A row that will not decode is `unavailable` too, rather than a throw out of the
`ok(read(row))` branch. `list` and `search` clamp `limit` into `[1, 200]` in the adapter: SQLite
reads `LIMIT -1` as no limit, so an unclamped page size is a whole-table read a query string can ask
for.

**Deleting a user removes its children first, in one `batch()`.** The `ON DELETE CASCADE` clauses
in the schema are documentation: D1 does not guarantee `PRAGMA foreign_keys` is on, so correctness
cannot rest on it. `batch()` is one transaction and rolls back whole, so a half-deleted account is
not a state this can leave behind. Every statement in that batch carries the last-admin guard, so a
refused delete leaves the children too. The outcome is the final `DELETE`'s own rows-affected; the
leading probe only names which refusal it was, and a probe that disagrees with the delete is
reported as `unavailable` rather than resolved either way.

### Ephemeral store adapters — `createChallengeStore`, `createNonceStore`, `purgeAuthEphemera`

```ts
function createChallengeStore(db: D1Client, options?: ChallengeStoreOptions): ChallengeStore;
function createNonceStore(db: D1Client, options?: NonceStoreOptions): NonceStore;
function purgeAuthEphemera(db: D1Client, at: number): Promise<AuthStoreResult<void>>;
```

Challenges and nonces sit on the same `D1Client` every durable store sits on, in `auth_challenges`
and `auth_nonces`. **They were KV, and KV's read-then-write made them wrong**: two requests inside
the consistency window could each take the same challenge, and two verifications could each be told
a nonce was theirs to spend. Each is now decided by one statement — `take` is a
`DELETE … WHERE key = ? AND expires_at > ? RETURNING value`, so whichever `DELETE` matches the row
is the only call `RETURNING` answers a value to; `markConsumed` is an
`INSERT … ON CONFLICT (key) DO NOTHING`, so the primary key and not a prior read decides who was
first.

**`DO NOTHING` and never a conditional update**, which is why an unpurged nonce row can only refuse a
replay and never admit one: a consumed key stays consumed past its own expiry.

`prefix` still namespaces both stores, but it now namespaces the key **text** inside a shared table
rather than a KV keyspace. Omit it for the default; an empty string is refused, because it drops the
separator with it and the store then shares a keyspace with every other store on the binding.

**KV expired a key for free and SQLite does not.** Correctness rests on the `expires_at` predicate
every read carries, never on a row being gone — so a dead row is already inert.
`purgeAuthEphemera(db, at)` deletes the challenge and nonce rows that expired at or before `at`, in
one `batch()`; call it from your Worker's scheduled handler. A deployment that never calls it is
slower, not wrong.

**The email code's state is a durable store, not one of these.** Both counters it holds are security
counters on the primary factor, so `createOtpStateStore` lives with the durable adapters above.

### Factors — `createFactorRegistry`

```ts
type AuthFactorKind = "email-otp" | "passkey" | "totp-app";
function createFactorRegistry(store: FactorStore, options: AuthFactorsOptions): AuthFactorRegistry;
```

| kind | primary | step-up | enrolment |
| --- | --- | --- | --- |
| `email-otp` | ✓ | ✓ | _implicit_ — a verified address is the enrolment, and there is no factor row |
| `passkey` | ✓ | ✓ | explicit |
| `totp-app` | ✗ | ✓ | explicit |

**TOTP-app is step-up only, deliberately.** An authenticator app proves possession; it does not say
who you are. Offering it as the primary factor would be a sign-in with no subject, so the registry
refuses it at construction.

**Its guess budget reopens on a timer as well as on a correct code.**
`FactorStore.countAttempt(userId, kind, maxAttempts, at, lockoutMs)` finds the factor and spends a
guess against it in the one `UPDATE` that admits it — keyed on the owner and the kind, so the find
and the spend are not two statements with a race between them — and that statement admits while
`failed_attempts < maxAttempts` **or** the last write is older than
`lockoutMs`, reopening a spent budget at 1 in the same statement rather than in a second write. It
answers the `AuthFactor` or `null`, and `null` is either no such factor or the budget refusing; a
second read tells those apart, after the guess has already been spent. A
refused guess writes nothing, so the window runs from the moment the cap was hit. `lockoutMs`
defaults to `AUTH_TOTP_LOCKOUT_MS` and is bounded 60_000–86_400_000 at construction; why the window
exists at all is [`AUTH_FLOWS.md`](../../docs/AUTH_FLOWS.md) §4.

**Reach the enrolment ceremony through `service.enrolment`.** `AuthFactorService` is a union of
`ImplicitFactorService` and `EnrollableFactorService`, discriminated on that literal, so
`if (service.enrolment === "explicit")` narrows natively and no call site needs an `as`. The
discriminant sits on the service rather than inside `capabilities` because TypeScript narrows only
a _direct_ discriminant — a nested one leaves the union unnarrowed, which is exactly the shape that
gets papered over with a cast.

`offered` is a tagged list: each entry declares its service `primary` or `second`, and a `second`
entry carries an `AuthFactorRequirement` — `"optional"`, `"mandatory"`, or `{mandatoryForRoles}`.
Exactly one entry may be `primary`, and it is not available as a second factor. A user who has not
confirmed a mandatory factor gets `{status: "enrolment-required"}` naming **only the owed kinds** — a
**successful outcome**, because needing to enrol is a normal onboarding step and modelling it as an
error puts it on the path every caller treats as exceptional.

**Mandatory governs enrolment, not step-up.** Once nothing is owed, _any_ confirmed second factor
satisfies the step-up, so an optional factor a visitor enrolled is still useful and a mandatory one
cannot be skipped by enrolling a different one.

**An implicit step-up factor is enrolled for everyone the moment it is offered.** It has no factor
row by design, so `resolve` puts it in the confirmed set unconditionally rather than asking the
store a question the store can only answer "no". Offering email-OTP as a second factor therefore
never owes an enrolment and always satisfies the step-up, whatever its requirement — the reading the
capability matrix above already implies. The rule is on the `enrolment` discriminant, not on the kind, so a later implicit
factor gets it too.

`enrolment-required` can never carry an empty `kinds` list: it is reported only for kinds actually
owed, and an implicit factor is confirmed the moment it is offered. An `offered` list with no
`second` entry is `satisfied` without a store read at all.

`resolve` reads the offered factors against one user's enrolments in **one** factor-table query,
whatever the offered count, and in **none** when every second factor is implicit.

**Forge sources exactly one role, and `authFactorContext` is the only place it is derived.** It maps a
subject's `isAdmin` to `{ roles: [AUTH_ADMIN_ROLE] }` and everything else to `{}`; the guards, the
verify page and the sign-in flow all resolve through it, so `mandatoryForRoles` means the same thing
in each. Passing no context at all is what silently degrades `mandatoryForRoles` to `"optional"`,
which is why no caller in forge does. `resolve(userId, context?)` keeps taking a context of your own — that is
the escape hatch for a deployment whose roles go beyond `isAdmin`.

### Email-OTP — `createEmailOtpFactor`

Two rules are the whole point of this factor, and each is one conditional statement.

**Issues are spaced, not counted.** An identity may be issued a code once every
`AUTH_OTP_COOLDOWN_MS` (a minute), configurable with `cooldownMs` on `EmailOtpOptions`. The upsert
carries the cooldown as its own condition, so parallel requests send one mail between them and not
one each.

**A count is what this deliberately is not**, and the reason is worth stating plainly. Issuing needs
only an email address, so any per-identity ceiling is a budget an unauthenticated attacker can spend
on the victim's behalf: three posts naming an address bought a day with no email-OTP, which where it
is the primary factor is an account outage, repeatable daily. A cooldown bounds the mail one address
can trigger — the ceiling's actual purpose — while leaving the victim at most a minute from a code.
Bounding a _caller's_ rate is a different control, and it is not in this release.

**A guess is spent by the statement that admits it.** `countAttempt` increments and compares in one
`UPDATE ... WHERE attempts < ?`, so N parallel guesses spend N of the budget; a read followed by a
write hands every concurrent guess the same count and the ceiling stops meaning anything. The refusal
that returns no row is then classified by a second read — expired code, or budget spent — which is a
race that cannot change the answer, because the attempt was already refused. The guess ceiling is
`AUTH_OTP_MAX_ATTEMPTS`, the code is `AUTH_OTP_DIGITS` long, and it lives `AUTH_OTP_TTL_MS`.

**A code nobody could receive costs no cooldown.** When `AuthNotifier.send` fails, the factor rolls
the claimed cooldown back with `OtpStateStore.discard(userId, token)` — named by token and not
`clear`, so a second issue that raced this one and _did_ send is left alone.

`OtpStateStore.clear` remains public for the operator support path.

The code itself is never stored: what the state holds is the sealed `verify`-purpose token, and the
code is compared against the token's payload in constant time. On success the token is consumed
through `NonceStore`, so it cannot be replayed inside its own lifetime.

Rate limiting is **not** in scope. These rules bound one code's life and one identity's mail, not a
caller's request rate.

### Passkey ceremonies — `createPasskeyRegistrationOptions`, `createPasskeyRequestOptions`

```ts
function createPasskeyRegistrationOptions(options: PasskeyCeremonyOptions, subject: PasskeyRegistrationSubject): Promise<Result<PasskeyRegistrationOptions, AuthStoreError>>;
function createPasskeyRequestOptions(options: PasskeyCeremonyOptions, subject: { sessionId: string; userId?: string }): Promise<Result<PasskeyRequestOptions, AuthStoreError>>;
```

`attestation` is `"none"` and nothing else: a format forge cannot check is one it must not claim
to. `pubKeyCredParams` is built from the configured algorithms, so a browser is never offered one
this deployment cannot verify.

The challenge carries `AUTH_PASSKEY_CHALLENGE_BYTES` of entropy, is stored through `ChallengeStore`
under a **session-bound** key, and lives `AUTH_PASSKEY_TTL_SECONDS` unless configured otherwise. A
configured `ttlSeconds` is held to `AUTH_PASSKEY_TTL_MIN_SECONDS`–`AUTH_PASSKEY_TTL_MAX_SECONDS`
(60–600) and the builder **throws** outside it: below the floor a slow authenticator loses the race
against the expiry, and above the ceiling a replayable challenge outlives an emailed code.
Registration excludes the credentials the user already has, so re-enrolling one authenticator is
refused by the browser rather than by a database conflict later. Omitting `userId` from a request
builds a discoverable sign-in: `allowCredentials` is empty, which is what lets the authenticator name
the user without the server leaking who is enrolled.

`createPasskeyFactor` wraps both into an `AuthFactorService`; its `role` picks the user verification
the ceremony asks for — preferred for a primary sign-in, required for a step-up.

### Ceremony verification — `verifyClientData`, `verifyAuthData`

Every check here is one an attacker gets to attempt on every sign-in, so each has its own reason.

**`origin` is compared as an exact string** — not a prefix, not a host-only parse.
`https://example.com.evil.test` passes every relaxed form of this check and fails only the exact
one.

**A reported `topOrigin` is refused, not dropped unread.** WebAuthn L3 §5.8.1 defines the field only
for a cross-origin ceremony, so one present at all says this ceremony ran inside a frame forge did
not authorise — `ClientData` keeps it on the parse precisely so `verifyClientData` has something to
judge, and the reason is `"top-origin"`.

**`rpIdHash` is compared as a hash**, SHA-256 of the configured id against the presented digest, in
constant time. Comparing it as text, or decoding it back to a name, is what makes a credential
minted for another relying party look valid.

**`be === false && bs === true` is refused.** A credential that is not eligible for backup cannot be
backed up; the specification calls that combination invalid, and accepting it is accepting an
authenticator lying about its own state.

The attested-credential segment's boundary comes from the CBOR decoder reporting where the COSE key
ended, so the extension bytes that follow it are never swallowed and nothing is re-encoded to
measure.

**The sign counter refuses in two places and both answer `sign-count-reused`** — the pre-check
against the stored row, and the conditional write that finds the row already advanced. A lost write
is the same replay the pre-check catches when the two requests do not overlap, so naming it anything
else would report the concurrent case as an unknown credential.

**A registration's `credential.id` is held against the attested credential id** and a disagreement is
`credential-id-mismatch`. WebAuthn L3 §7.1 makes the two the same value, so a client reporting
something else is not reporting what it enrolled; the attested id remains the one stored. An
assertion carries no attested credential segment, so its `id` has nothing to be held against — it is
the store lookup, and the key it finds is what the signature must verify under.

**A discoverable assertion must carry a `userHandle`.** Where the stored challenge names no `userId`,
nothing but the authenticator's own user handle says whose account this is, so an assertion without
one has not answered the question the ceremony asked and is refused as `unrecognised`. Where the
challenge _does_ name a subject, an absent handle stays admitted: the account was already known.

`verifyPasskeyRegistration` and `verifyPasskeyAuthentication` are the whole-ceremony verifiers built
on those checks: each consumes the stored challenge, applies both parsers, and answers a `Result`
whose error is a reason union.

### The flows — `createSignupFlow`, `createSigninFlow`, `createEmailChangeFlow`

Each flow returns before its credential is delivered, handing the work to the `AuthDeferral` you
supply — `executionCtx.waitUntil` in a Worker. **That is a security property, not a latency one:** an
address with no account gets a decoy that does the same token work and delivers nothing, and a decoy
only hides anything if the real branch does not block the response either.

**Every branch of `complete` costs what verifying a real code costs.** An unknown address and a
deactivated one spend the guess, open the sealed token and consume the nonce the known branch
spends before returning; a verifier that answers the two cheap cases early bins an address list by
latency, which is the enumeration the deferred `request` exists to refuse. **One asymmetry is left,
and closing it would mean mailing an address nobody asked about:** the real issue ends in
`AuthNotifier.send` and the decoy cannot. Every statement before it matches.

**`complete` reports a throttled primary factor as `unrecognised`.** A known-but-throttled address
answering `too-many-attempts` where an unknown one answers `unrecognised` is the same membership
answer the decoy exists to withhold, and `redactSigninReason` renders the two as different notices.
`stepUp` and `requestStepUp` keep the true reason — the visitor is already signed in, so there is no
membership left to leak.

`redactSigninReason` is **required at the rendering boundary** — every response carrying a sign-in
refusal passes through it, and an `AuthSigninReason` never reaches a page. It maps to the three
notices a page may carry — unavailable, throttled, or unrecognised — with everything else folded
into `unrecognised` deliberately. `AuthEmailChangeReason` and `AuthStoreError` have no equivalent
yet and must not be rendered raw. `confirm` folds the unique index catching the new address into
`unrecognised` for the same reason `request` never looks it up: reporting the collision would hand
back at confirmation the enumeration answer the request withheld. What each flow does end to end is
[`AUTH_FLOWS.md`](../../docs/AUTH_FLOWS.md) §1, §2 and §5.

**The email-change flow takes two links, and both of its calls answer a record rather than a
scalar.** `request(userId, email, at)` gives `AuthEmailChangeRequest` — `expiresAt`, and `sentTo`,
the address the mail actually went to: the account's own where that is verified, the new one where it
is not. Render `sentTo`, never the address the visitor typed. `confirm(token, at)` gives
`AuthEmailChangeConfirm`, discriminated on `status`: `"forwarded"` carries the `sentTo` and
`expiresAt` of a second link just deferred to the new address, and `"moved"` carries the updated
`user`. The `move` stage writes the address and marks it verified in one statement — answering a link
sent to _that_ mailbox is the proof of control, and a second write could fail and leave the account
holding an address no passkey sign-in accepts. That stage also raises the account's revocation
barrier and carries nothing over it, so a completed move signs **every** session out — the
confirmation link is opened from whatever browser answered the mail, which need not be one the
account was signed in on.

```ts
const outcome = await services.emailChange.confirm(token, Date.now());
if (!outcome.ok) return outcome.error instanceof AuthStoreError ? unavailablePage() : refusalPage(outcome.error);
if (outcome.data.status === "forwarded") return checkInboxPage(outcome.data.sentTo);
return changedPage(outcome.data.user);
```

#### What each flow is constructed with

Every field without a default is required. All three are built per request, because each holds stores
that are.

| `AuthSignupOptions` | Type |
| --- | --- |
| `users` | `UserStore` |
| `factors` | `AuthFactorRegistry` |
| `defer` | `AuthDeferral` |

| `AuthSigninOptions` | Type |
| --- | --- |
| `keys` | `AuthKeyRing` |
| `users` | `UserStore` |
| `state` | `OtpStateStore` — the decoy branch's, and it spends the same statements the real branch spends |
| `nonces` | `NonceStore` — the same |
| `factors` | `AuthFactorRegistry` |
| `defer` | `AuthDeferral` |

**`state` and `nonces` are here for the decoy, not for the sign-in.** `AuthDecoyStores` is the
sub-shape they make up — the emailed-code factor's stores, whatever this deployment's primary factor
turns out to be. That coupling is the price of the two branches being indistinguishable: a decoy
holding no store is a latency oracle the moment a caller awaits the promise.

| `AuthEmailChangeOptions` | Type |
| --- | --- |
| `keys` | `AuthKeyRing` |
| `users` | `UserStore` |
| `nonces` | `NonceStore` |
| `notifier` | `AuthNotifier` |
| `defer` | `AuthDeferral` |
| `confirmUrl` | `(token: string) => string` — the link the confirmation mail carries. The route it points at is yours ([`AUTH_FLOWS.md`](../../docs/AUTH_FLOWS.md) §6) |
| `ttlMs` | `number` — optional; defaults to one hour |

`AuthDeferral` is `(work: Promise<AuthIssueOutcome>) => void` — `executionCtx.waitUntil` in a Worker.
`AuthMessage`, what a notifier is handed, is `{ to, kind: "email-change" | "otp", expiresAt, code?,
url? }`: `code` on an OTP, `url` on an email change.

#### What each factor is constructed with

All three are built per request: each holds stores, and the passkey factor holds this request's
session id.

| `EmailOtpOptions` | Type |
| --- | --- |
| `keys` | `AuthKeyRing` |
| `state` | `OtpStateStore` |
| `nonces` | `NonceStore` |
| `notifier` | `AuthNotifier` |
| `address` | `(userId) => string \| Promise<string>` — the address a code goes to. A `UserStore` read |
| `digits`, `ttlMs`, `maxAttempts`, `cooldownMs` | `number` — all optional, each bounded at construction |

| `PasskeyFactorOptions` | Type |
| --- | --- |
| `rpId`, `rpName`, `origin` | `string` |
| `sessionId` | `string` — this request's session; the challenge is bound to it |
| `role` | `"primary" \| "step-up"` — `step-up` demands user verification, `primary` merely prefers it |
| `users`, `factors`, `credentials`, `challenges` | `UserStore`, `FactorStore`, `CredentialStore`, `ChallengeStore` |
| `subject` | `(userId) => { name, displayName } \| Promise<…>` — how the account appears in the authenticator's own picker. A `UserStore` read |
| `algorithms`, `ttlSeconds` | optional |

| `TotpAppFactorOptions` | Type |
| --- | --- |
| `keys` | `AuthKeyRing` |
| `factors` | `FactorStore` |
| `issuer` | `string` — what the authenticator app shows as the account's issuer |
| `account` | `(userId) => string \| Promise<string>` — the account label the provisioning URI carries. A `UserStore` read |
| `digits`, `period`, `secretBytes`, `maxAttempts` | `number` — all optional, each bounded at construction |
| `lockoutMs` | `number` — optional; how long a spent guess budget stays refused. Defaults to `AUTH_TOTP_LOCKOUT_MS` (15 minutes), bounded 1 minute–1 day |

**`address`, `subject` and `account` are the three seams most easily missed.** Each is required, each
is a `UserStore` read, and none of them is inferable from the factor's name — which is why the factor
has to be constructed per request alongside the stores rather than once at bootstrap.

### Admin operations — `createAdminUserService`

`createAdminUserService({ users })` is the read-and-write surface an admin route holds: listing and
searching by cursor, `view`, `countAdmins`, `elevate` / `demote`, `deactivate` / `reactivate` and
`remove`. It adds no guard of its own — every refusal is decided in the store's statement — and
`isLastAdminRefusal` is the predicate that tells the three last-admin outcomes apart from the rest.

**Search matches a prefix, not a substring.** `search` builds `LIKE 'term%'`, escaping the two
wildcards a caller's text may carry, so the unique index on `email_key` answers the query instead of
a full table scan. **This is a behaviour change a consumer feels**: a term matching the middle of an
address — a domain, say — no longer finds it. Search by the start of the local part.

**`AdminUserOutcome` carries a sixth member, `"self"`.** An administrator may not deactivate or
delete their own account: the last-admin guard does not catch it, since a deployment with two admins
would admit it, and either write locks the operator out of the console they are standing in — the
delete irreversibly. Reactivating your own account is still allowed. `"self"` is decided in the web
layer against the acting identity, not in the store's statement, and the shipped page answers it
with a 409.

### The passkey contract — `PASSKEY_*`

The server half of a passkey ceremony (an `auth/web` view) and the browser half (the controller
`./auth/client` registers) share one declared DOM contract, published from this namespace as pure
data so both tiers import the same names and neither hand-writes a string the other has to match.

| Symbol | Kind | Purpose |
| --- | --- | --- |
| `PASSKEY`, `PASSKEY_SCOPE`, `PASSKEY_MODE_ATTR`, `PasskeyMode` | const, type | The `data-ref` values a passkey ceremony's controller addresses (trigger, status, unsupported message, nickname field), the scope name, and the attribute naming which ceremony the root runs — enrolling a credential or signing in with one. |
| `PASSKEY_OPTIONS_PATH_ATTR`, `PASSKEY_VERIFY_PATH_ATTR`, `PASSKEY_OPTIONS_TOKEN_ATTR`, `PASSKEY_VERIFY_TOKEN_ATTR` | const | The ceremony's two endpoints and **two** CSRF tokens, one per endpoint. `csrfProtection` binds a token to the request path, so a ceremony spanning two endpoints cannot share one token; naming them apart is what stops either being sent to the wrong endpoint. |
| `PASSKEY_CSRF_HEADER_ATTR`, `PASSKEY_CSRF_HEADER_DEFAULT` | const | The header both tokens are sent on, and `csrfProtection`'s own default used when the attribute is absent. `csrfProtection` checks the header before the form field and lets an app rename it, so a controller assuming the default would 403 with no explanation against an app that renamed it. |
| `PASSKEY_REDIRECT_ATTR`, `PASSKEY_REDIRECT_FALLBACK` | const | Where the controller navigates once verification succeeds, and where a target that is not a same-origin path is sent instead. |
| `PASSKEY_OUTCOME_EVENT`, `PasskeyOutcomeDetail`, `PasskeyFailureReason` | const, type | The event a ceremony dispatches on its scope root however it ended, and its `detail` — `reason` is absent exactly when the ceremony succeeded. |

### The schema — `src/auth/schema.sql`

It ships as a **file**, not a subpath. `files[]` publishes `src/auth/`, so apply it from the
installed package with a filesystem path:

```bash
wrangler d1 execute <DATABASE> --file node_modules/@y-core/forge/src/auth/schema.sql
```

Seven tables — `auth_users`, `auth_factors`, `auth_credentials`, `auth_identity_links`,
`auth_otp_state`, `auth_challenges` and `auth_nonces` — all `STRICT`. The first four take a 16-byte
UUIDv7 `BLOB` primary key, and bytewise order on a UUIDv7 **is** time order, which is why no table
carries an index on `created_at` and why paging is a cursor over the key itself. `auth_otp_state` is
keyed by the user it belongs to and holds at most one live code.

**No table carries a TTL, and none of them needs one.** A row is dead once its `expires_at` has
passed, because every read holds it against the clock. The two ephemeral tables are keyed by the
store's own key text and indexed on `expires_at`, which is what `purgeAuthEphemera` reclaims them
by; the next issue for an identity overwrites its `auth_otp_state` row.

`auth_users` carries `sessions_invalid_before INTEGER` — the revocation barrier `revokeSessions`
raises — and a `CHECK (length(email) <= 254 AND length(email_key) <= 254)`. The web schema caps a
typed address at 254 characters _before_ `normalizeEmail` NFKC-expands it, so an expanding input
reaches the unique index over-length; the `CHECK` is the backstop that refuses it, and it surfaces as
`AuthStoreError` with `code: "invalid"`.

The `auth_` prefix is fixed. Making it configurable would need raw identifier concatenation, which
is the one thing `src/storage/db/sql.ts` exists to forbid and offers no escape hatch for.

Case-insensitive addresses are `email` plus a `email_key TEXT UNIQUE` fed by `normalizeEmail` —
**not** `COLLATE NOCASE`, which folds ASCII only and is invisible at the query site.

### Email identity — `normalizeEmail`

```ts
function normalizeEmail(email: string): string;
```

Trims, applies NFKC, and lowercases the whole address. The result is what the `email_key` unique
index holds; the address as the user typed it is stored beside it.

SQLite's `COLLATE NOCASE` folds ASCII only, so `İSMAIL@…` and `aurora@ｅｘａｍｐｌｅ.test` would each
open a second account for one mailbox — and the collation is invisible at the query site, where a
reader has no way to tell which comparisons are case-folded. A function is visible and testable.

Plus tags and dots in the local part are **kept**: `aurora+news@` is a different mailbox from
`aurora@` everywhere except Gmail, and folding them would merge accounts that are genuinely
distinct.

### Store errors — `AuthStoreError`

```ts
class AuthStoreError extends Error {
  readonly code: "conflict" | "invalid" | "unavailable";
  readonly operation: string;
  readonly constraint?: string;
}
```

The single I/O failure an auth store reports, carried in a `Result`'s error channel rather than
thrown across the boundary. `conflict` is a uniqueness violation the caller can act on; `invalid` is
a `CHECK` the value broke — the caller's own input was refused, and rendering it as an outage tells
a visitor this deployment is down when their address was simply too long; `unavailable` is
everything else the backend refused. `operation` names the store method, and `constraint` names the
index a conflict violated when the backend says which.

### Exports

| Export | Kind | Description |
| --- | --- | --- |
| `resolveAuthServices(context, options)` | function | Resolves and caches this deployment's key ring and algorithms per `env`; throws on a configuration that cannot work. |
| `importAuthKeyRing(secrets)`, `authKeyId(key)` | function | Builds a ring from hex root secrets newest-first, and derives one key's id. |
| `encodeAuthToken(…)`, `decodeAuthToken(…)`, `authNonceKey(ring, token)` | function | The AES-256-GCM codec every emailed credential rides on, and the nonce key derived from a token. |
| `AUTH_TOKEN_VERSION` | const | The version byte a token frame opens with. |
| `AUTH_SUPPORTED_ALGORITHMS` | const | `[-7, -257]` — the COSE algorithms a ceremony advertises by default. |
| `AUTH_KEY_ID_LENGTH` | const | Characters in a derived key id. |
| `AUTH_OTP_DIGITS`, `AUTH_OTP_TTL_MS`, `AUTH_OTP_MAX_ATTEMPTS`, `AUTH_OTP_COOLDOWN_MS` | const | The emailed code's shape, life, guess ceiling and the wait between issues. |
| `AUTH_TOTP_LOCKOUT_MS` | const | How long an authenticator-app factor stays refused once its guess budget is spent, before the next guess reopens it. |
| `AUTH_FRESH_STEP_UP_MS` | const | How recent a step-up a state-changing request must carry, unless a mount names its own window or opts out with `null`. |
| `AUTH_PASSKEY_CHALLENGE_BYTES`, `AUTH_PASSKEY_CHALLENGE_MIN_BYTES`, `AUTH_PASSKEY_TTL_SECONDS`, `AUTH_PASSKEY_TTL_MIN_SECONDS`, `AUTH_PASSKEY_TTL_MAX_SECONDS` | const | A ceremony challenge's entropy, the floor a configured `challengeBytes` throws below, the stored lifetime, and the range a configured `ttlSeconds` throws outside. |
| `AUTH_KV_MIN_TTL_SECONDS` | const | Workers KV's expiration floor. Session storage is still KV, and it is the floor `AUTH_PASSKEY_TTL_MIN_SECONDS` is set from. |
| `AUTH_SESSION_MAX_MS` | const | How long a signed-in session stays valid from the moment it was established — an absolute lifetime, not a window activity extends. |
| `createUserStore(db)`, `createAdminUserStore(db)`, `createFactorStore(db)`, `createCredentialStore(db)`, `createIdentityLinkStore(db)`, `createOtpStateStore(db)` | function | The six durable adapters, each over a `D1Client`. |
| `createChallengeStore(db, options?)`, `createNonceStore(db, options?)` | function | The two ephemeral adapters, each over the same `D1Client`. |
| `purgeAuthEphemera(db, at)` | function | Deletes the challenge and nonce rows that expired at or before `at`. Call it from a scheduled handler; never calling it is slower, not wrong. |
| `normalizeEmail(email)` | function | The key the `email_key` unique index holds. |
| `AuthStoreError` | class | The one I/O failure an auth store reports, carried in a `Result`. |
| `createFactorRegistry(store, options)` | function | Resolves the offered factors against one user's enrolments and hands out the factor services. |
| `authFactorContext(subject)` | function | The `AuthFactorContext` a subject's `isAdmin` amounts to — the one place forge turns it into a role name. |
| `AUTH_ADMIN_ROLE` | const | `"admin"` — the one role forge sources itself, and the name a `mandatoryForRoles` requirement is written against. |
| `createEmailOtpFactor(…)`, `createPasskeyFactor(…)`, `createTotpAppFactor(…)` | function | The three shipped factor services. |
| `createPasskeyRegistrationOptions(…)`, `createPasskeyRequestOptions(…)` | function | The two ceremony option builders, each storing a session-bound challenge. |
| `verifyClientData(…)`, `verifyAuthData(…)` | function | The two ceremony parsers, each check with its own reason. |
| `verifyPasskeyRegistration(…)`, `verifyPasskeyAuthentication(…)` | function | The whole-ceremony verifiers built on those parsers. |
| `createSignupFlow(options)`, `createSigninFlow(options)`, `createEmailChangeFlow(options)` | function | The three flows, each deferring delivery through your `AuthDeferral`. |
| `redactSigninReason(reason)` | function | Folds a sign-in reason into the three notices a page may carry. |
| `createAdminUserService(options)`, `isLastAdminRefusal(outcome)` | function | The administrative surface, and the predicate over its three last-admin refusals. |
| `PASSKEY`, `PASSKEY_SCOPE`, `PASSKEY_MODE_ATTR`, `PASSKEY_OPTIONS_PATH_ATTR`, `PASSKEY_VERIFY_PATH_ATTR`, `PASSKEY_OPTIONS_TOKEN_ATTR`, `PASSKEY_VERIFY_TOKEN_ATTR`, `PASSKEY_CSRF_HEADER_ATTR`, `PASSKEY_CSRF_HEADER_DEFAULT`, `PASSKEY_REDIRECT_ATTR`, `PASSKEY_REDIRECT_FALLBACK`, `PASSKEY_OUTCOME_EVENT` | const | The DOM contract both ceremony halves import, as pure data. |
| `AuthOptions`, `AuthServices`, `AuthSecretResolver`, `AuthKeyRing`, `AuthAlgorithm` | types | Namespace configuration, what one request resolves to, the ring resolver, the ring itself, and a COSE algorithm identifier. |
| `AuthTokenPurpose`, `AuthTokenClaims`, `AuthTokenOptions`, `AuthTokenReason` | types | The four purposes, a decoded token's claims, the injected clock, and why a token did not decode. |
| `AuthUser`, `AuthUserInput`, `AuthUserPage` | types | The user record — `sessionsInvalidBefore` included — its insert shape, and one cursor page of them. |
| `AuthFactor`, `AuthFactorInput`, `AuthFactorKind` | types | A stored enrolment, `failedAttempts` included, its insert shape, and the closed kind union. |
| `AuthCredential`, `AuthCredentialInput` | types | A registered passkey and its insert shape. |
| `AuthIdentityLink`, `AuthIdentityLinkInput` | types | A federated identity bound to a local user, and its insert shape. |
| `AuthChallenge` | type | A ceremony challenge, bound to the session it was issued to. |
| `UserStore`, `AdminUserStore`, `FactorStore`, `CredentialStore`, `IdentityLinkStore`, `ChallengeStore`, `NonceStore`, `OtpStateStore` | types | The eight store contracts. |
| `OtpState` | type | The sealed code and its two counters. |
| `ChallengeStoreOptions`, `NonceStoreOptions` | types | `{ prefix? }` — the key-text prefix each ephemeral adapter writes under inside its shared table; omit it for the default, and an empty string is refused because it drops the namespacing with the separator. A lifetime is per call, not an option. |
| `AuthNotifier`, `AuthMessage` | types | The delivery seam, and what it is asked to deliver. |
| `AuthStoreErrorCode`, `AuthStoreResult` | types | `"conflict" \| "invalid" \| "unavailable"`, and what every store method resolves to. |
| `AdminUserOutcome`, `AdminUserService`, `AdminUserServiceOptions` | types | What an administrative write reports — the three last-admin refusals, `not-found`, `self` and `changed` — the service surface, and its construction options. |
| `AuthFactorService`, `ImplicitFactorService`, `EnrollableFactorService` | types | The factor contract, discriminated on `enrolment`. |
| `AuthFactorRegistry`, `AuthFactorsOptions`, `AuthFactorOffer`, `AuthFactorRequirement`, `AuthFactorCapabilities`, `AuthFactorContext` | types | The registry, its options, one tagged offer, what it is demanded to be, what a kind can do, and the context a resolution reads roles from. |
| `AuthFactorChallenge`, `AuthFactorVerified`, `AuthFactorResolution`, `AuthFactorReason` | types | An issued challenge, a verified factor, the three resolutions, and why one refused. |
| `EmailOtpOptions`, `PasskeyFactorOptions`, `PasskeyFactorRole`, `PasskeyFactorSubject`, `TotpAppFactorOptions`, `TotpAppEnrolment` | types | Per-factor configuration, the passkey factor's two roles and its subject resolver, and what a TOTP enrolment hands back. |
| `PasskeyCeremonyOptions`, `PasskeyRegistrationOptions`, `PasskeyRequestOptions`, `PasskeyRegistrationSubject` | types | What a ceremony is held against, the two option payloads a browser receives, and the subject a registration names. |
| `PublicKeyCredentialParameter`, `PublicKeyCredentialDescriptor`, `UserVerification` | types | The WebAuthn shapes those payloads carry. |
| `PasskeyRegistrationInput`, `PasskeyRegistrationCredential`, `PasskeyRegistrationResponse`, `PasskeyRegistrationVerifyOptions`, `PasskeyRegistrationReason` | types | The registration verifier's input, the credential it parses, its response half, its options and its reason union. |
| `PasskeyAuthenticationInput`, `PasskeyAssertionCredential`, `PasskeyAssertionResponse`, `PasskeyAuthenticationVerifyOptions`, `PasskeyAuthentication`, `PasskeyAuthenticationReason` | types | The same five for an assertion, plus what a verified authentication carries. |
| `ClientData`, `ClientDataExpectation`, `ClientDataReason`, `PasskeyCeremony` | types | Parsed client data — `topOrigin` included, so a reported one can be refused rather than dropped unread — what it is held against, why it failed, and which ceremony it belongs to. |
| `AuthData`, `AuthDataExpectation`, `AuthDataFlags`, `AuthDataReason`, `AttestedCredential` | types | Parsed authenticator data, its expectation, its flags, its reason union, and the attested credential inside it. |
| `AuthSignupFlow`, `AuthSignupOptions` | types | The signup flow and its options. |
| `AuthSigninFlow`, `AuthSigninOptions`, `AuthSignin`, `AuthSigninReason`, `AuthSigninNotice` | types | The sign-in flow, its options, what a completion carries, why one refused, and the redacted notice a page shows. |
| `AuthEmailChangeFlow`, `AuthEmailChangeOptions`, `AuthEmailChangeRequest`, `AuthEmailChangeConfirm`, `AuthEmailChangeReason` | types | The email-change flow, its options, where a request mailed its link, what answering one did — forwarded a second link or moved the account — and why one refused. |
| `AuthFlowChallenge`, `AuthIssueOutcome`, `AuthDeferral`, `AuthDecoyStores` | types | What a request hands back immediately, what the deferred issue reports, the deferral you supply, and the stores the unknown-address branch spends so it costs what a known one costs. |
| `PasskeyMode`, `PasskeyOutcomeDetail`, `PasskeyFailureReason` | types | Which ceremony a scope root runs, what its outcome event carries, and why a ceremony ended badly. |

---

## `@y-core/forge/auth/web` — routes, guards, loaders, actions and views

> Import path: `@y-core/forge/auth/web` → `src/auth/web/mod.ts`

```ts
import { accountRoutes, authPaths, authRoutes, createAuthGuards, registerAccount, registerAuth } from "@y-core/forge/auth/web";
```

### Features

- **Three route builders, each optional** — `authRoutes`, `accountRoutes` and `adminRoutes`. A
  capability is omitted by not calling its builder.
- **No path literal written twice** — `authPaths(routeMap)` derives every href builder from the map
  the routes were built from, and every loader, action and view reads its targets off it.
- **One route-group table, two readers** — `AUTH_ROUTE_GROUPS` is what `register*` cuts its
  `app.map` calls along and what `createAuthGuards` builds its middleware stacks from, so the guards
  and the routes cannot drift apart.
- **Guards that fail usefully** — an owed enrolment or step-up is a redirect, not a 4xx, and a guard
  that cannot read the factor store answers 503 rather than starting a redirect loop.
- **Markup you can replace page by page** — `views` takes an override per `AuthViewName`, each
  receiving exactly the props forge's own view does — `AuthViewProps` maps every name to that page's
  own props type, so the **compiler** refuses an override with the wrong ones rather than handing it
  `undefined` at runtime. Every `load*` / `create*Actions` is exported, so `register*` is a
  convenience rather than a gate.
- **Sessions written in one place each** — the identity, the step-up mark and the pending sign-in
  address each have exactly one writer, and a fresh sign-in clears the step-up mark.

### Mounting — `registerAuth`, `registerAccount`, `registerAdmin`

```ts
function registerAuth<Bindings extends object>(app: Forge<Bindings>, routes: ReturnType<typeof authRoutes<string>>, options: AuthWebOptions<Bindings>): void;
function registerAccount<Bindings extends object>(app: Forge<Bindings>, routes: ReturnType<typeof accountRoutes<string>>, options: AuthWebOptions<Bindings>): void;
function registerAdmin<Bindings extends object>(app: Forge<Bindings>, routes: ReturnType<typeof adminRoutes<string>>, options: AuthWebOptions<Bindings>): void;
```

**Each mounts handlers and wires no guard.** The stacks come from `createAuthGuards` off the same
`AUTH_ROUTE_GROUPS` table, because a second copy of that table is an unguarded admin page that looks
guarded. The mount order, the middleware that must already be up, and every seam you supply are
[`AUTH_MOUNTING.md`](../../docs/AUTH_MOUNTING.md) §1.

### Options — `AuthWebOptions`

| Field | Type | Required |
| --- | --- | --- |
| `resolveServices` | `(c) => AuthRequestServices \| Promise<AuthRequestServices>` | yes — built per request, because a ceremony is bound to its session |
| `paths` | `AuthWebPaths` — `{ auth, account, admin }`, one `authPaths(map)` result each. `authPaths` returns **one** map, so the three are assembled by hand: `{ auth: authPaths(authMap), account: authPaths(accountMap), admin: authPaths(adminMap) }` | yes |
| `icon` | `ForgeIcon<AuthIconName>` — build it with `createIcon`, documented at [`src/ui/README.md`](../ui/README.md) section “Icons”. The four glyphs it must cover, and where to get them, are [`AUTH_MOUNTING.md`](../../docs/AUTH_MOUNTING.md) §3 | yes |
| `views` | `AuthViews` — one override per `AuthViewName`, each held to that page's `AuthViewProps` entry | no |
| `settledPath` | `string` — where a settled sign-in lands. Defaults to the passkey page | no |
| `returnParam` | `string` — the return-to query parameter. Defaults to `next` | no |
| `now` | `() => number` — the clock every flow call is made against | no |

### The mandatory seam — `AuthRequestServices`

What `resolveServices` returns. It is built per request because a passkey ceremony is bound to its
session, and because on a Worker every store underneath it needs a binding off `c.env`.

| Field | Type | Required |
| --- | --- | --- |
| `users` | `UserStore` — `createUserStore(d1Client)` | yes |
| `credentials` | `CredentialStore` — `createCredentialStore(d1Client)` | yes |
| `factors` | `AuthFactorRegistry` — `createFactorRegistry(factorStore, { offered })` | yes |
| `enrolments` | `FactorStore` — `createFactorStore(d1Client)`. The rows themselves, which the registry keeps private and the account pages must delete | yes |
| `signin` | `AuthSigninFlow` — `createSigninFlow(…)` | yes |
| `signup` | `AuthSignupFlow` — `createSignupFlow(…)` | yes |
| `emailChange` | `AuthEmailChangeFlow` — `createEmailChangeFlow(…)` | yes |
| `admin` | `AdminUserService` — `createAdminUserService(…)` | yes |
| `passkey` | `AuthPasskeyCeremonyOptions`, or absent when the deployment offers no passkey | no |

`AuthPasskeyCeremonyOptions` is what a **discoverable** sign-in is held against — the one ceremony with
no user to name, so it cannot run through the registry:

| Field | Type | Required |
| --- | --- | --- |
| `rpId`, `rpName`, `origin` | `string` | yes |
| `sessionId` | `string` — the session the challenge is bound to, so a challenge issued to one visitor cannot be answered by another | yes |
| `challenges` | `ChallengeStore` — `createChallengeStore(d1Client)` | yes |
| `algorithms` | `readonly AuthAlgorithm[]` | no |
| `ttlSeconds` | `number` | no |

**`resolveServices` is called once per request, however many times the request asks.** A guard, a
loader and often an action each need the services, and each rebuilding every store was the cost this
memoisation removes. The **promise** is held rather than the value, so two parallel callers share one
build rather than racing two.

### Guards — `createAuthGuards` and the four primitives

`createAuthGuards` builds the middleware stack for every group in one call, and is what a consumer
mounts. The six primitives are exported for pages a consumer routes themselves:

| Guard | Admits |
| --- | --- |
| `requireAuth` | A signed-in, non-deactivated visitor. It is what puts the identity on `authCtx`. |
| `resolveAuth` | Everyone. It establishes the identity when the session carries one, so a page serving an anonymous and a signed-in visitor alike can tell them apart. |
| `requireAdmin` | An admin. Anyone else gets a plain 403, and it throws if `requireAuth` did not run first. |
| `requireEnrolment` | A visitor who owes no factor. An owed enrolment or step-up is redirected; an unreadable store answers 503. |
| `requirePendingEnrolment` | **Only** a visitor who owes an enrolment. An owed step-up goes to the step-up page, and a settled visitor to the settled path. |
| `requireFreshStepUp` | Every safe method, and a state-changing one only while the session's step-up mark is inside `freshStepUpMaxAgeMs` — or the user owes no step-up at all. |

**`requireFreshStepUp` is on by default, and gates only what changes something.** Every `POST`,
`PATCH` or `DELETE` in the `account`, `admin.users` and `admin.elevate` groups needs a step-up no
older than the window — which is what stands between a long-lived session and stripping the second
factor, taking a passkey off, moving the address, or changing another account's role. A `GET` is
always admitted: reading the page that offers an action is not the action, and gating it would leave
the visitor unable to reach the form that clears the demand. A refused request is sent to
`stepUpPath` with a **303**, so the browser does not replay the mutation; forge keeps no pending
write across a re-authentication, so the visitor repeats the action afterwards.

**`freshStepUpMaxAgeMs` is `number | null` and optional.** Omit it for `AUTH_FRESH_STEP_UP_MS`
(fifteen minutes, exported from `@y-core/forge/auth`); pass `null`, which is the only opt-out, and
the guard admits every request.

**The demand is the user's own resolution, not the mount's.** The guard resolves through `factors.resolve`
and asks for a mark only where that answers `step-up-required`, so a deployment offering no second factor and
an all-optional user with nothing enrolled are admitted rather than sent to a page that could never
clear the demand. It reuses the resolution `requireEnrolment` already made on the same request
through a context variable, so mounting both costs one registry query rather than two, and a registry
it cannot read answers **503** exactly as the other enrolment guards do.

**A guard refuses in the medium its group answers in.** `AuthGuardOptions` and
`AuthEnrolmentGuardOptions` each take a `medium` (`"html" | "json"`, defaulting to `"html"`), and
`createAuthGuards` passes each group's own value down. On a `json` group `requireAuth` answers
`401 {"error": …}` and the two enrolment guards `403 {"error": …}` instead of redirecting, because a
browser controller posting a ceremony step cannot read an HTML sign-in page. `requireAdmin` has no
JSON branch — no JSON group carries it.

**Only a replayable request is recorded as a return-to.** `requireAuth` sets the `next` parameter for
a `GET` or `HEAD` and answers 302; anything else is sent to the sign-in path with no `next` and a 303,
since the visitor returns by `GET` and a mutation's URL has no `GET` handler to return to.

`resolveAuthIdentity` re-reads the user on every request and answers `null` for a deactivated one,
which is what makes deactivation take effect on the next request rather than at the next sign-in. It
also drops that session's auth keys, so reactivating the account revives none of the cookies issued
before it; a store outage denies without clearing, since a blip must not sign everyone out.

**It enforces two more bounds on every request, and both are absolute.** A session is refused once
`at - signedInAt >= AUTH_SESSION_MAX_MS` (seven days), measured from when it was established and
never refreshed — a sliding window is one an attacker who took a session can keep alive forever. And
it is refused when `signedInAt <= user.sessionsInvalidBefore`, which is how removing a passkey,
removing the authenticator-app factor or completing an address change reaches sessions this request
cannot see. A session carrying **no** stamp — one issued before this field existed — is over rather
than unbounded, so the deployment that adds this signs its live population out once.

**The barrier refuses the session that raised it, too**, which is why the two factor removals call
`renewAuthSession` and the address change does not: a visitor removing their own passkey should stay
where they are, while a confirmation link is opened from whatever browser answered the mail.

`AuthGuardOptions` takes an optional `now?: () => number` — the clock `requireAuth` and `resolveAuth`
measure both bounds against — so a test drives them off an injected clock rather than off real time.

**What the chain mounts.** The guard stack of every group in the table, and — when you pass
`origin: { allowedOrigins }` — origin protection on every group carrying a mutating leaf, guard-less
groups included. That is what puts a cross-origin check on `POST /auth/signin`, `/auth/signup`,
`/auth/verify`, `/auth/verify/resend`, `/auth/signout` and both `/auth/passkey/authenticate/*`, which
carry no identity for a guard to read. Without `origin` nothing is mounted on them, because forge
cannot pick your origins. The check is safe-method exempt, so `GET /auth/signin` stays reachable while
its POST is verified. Two risks worth naming: a wrong `allowedOrigins` breaks sign-in with a bare 403,
and a consumer already mounting `originProtection` globally ends up with two — harmless, since both
agree.

**What it does not mount, and you must.** `csrfProtection({ subject })` — the subject is your policy,
not forge's. Rate limiting — it needs your binding, and one limiter across every mutating auth group
would share a bucket between an admin `PATCH` burst and a sign-in flood while a misconfigured binding
answered 503 for the whole namespace; the paths above now appear in the emitted `paths` and the
returned objects are plain, so attach your own per-path limiter before handing the array to
`applyMiddlewareChain`. Session middleware — that one already throws if it is missing.

**The primitives throw per request, not at boot.** `requireAdmin`, `requireEnrolment` and
`requirePendingEnrolment` each read the identity `requireAuth` establishes, and a standalone one
cannot know what was mounted before it, so a wrong order fails on the first request rather than at
construction. Fail-closed, but the group table's own ordering check is the only one there is.

### Loaders, actions and the render seam

Every page is a `load*` function and every submission a `create*Actions` factory, all exported. The
render seam is `renderAuthPage`, which resolves the view for a page name against your `views`
override and wraps it in a layout. Replacing one page means supplying one entry; the props it
receives are exactly the ones forge's own view takes, and `AuthViews` is keyed on `AuthViewProps`, so
an entry typed for the wrong page is a compile error rather than a page reading `undefined`.

**`renderAuthPage` defaults `Cache-Control: no-store` on every auth page.** A sign-in, an account or
an admin page has no business in a shared cache or on the back button after a sign-out. The header is
merged rather than imposed, so a page that names its own `Cache-Control` still wins.

**The three ceremony JSON endpoints bound what they read.** A body over
`AUTH_CEREMONY_MAX_BYTES` (64 KiB) is answered **413** — refused on a `Content-Length` that already
says too much, then metered through the stream, because a chunked body's header may be absent or
lying. The assertion's `id` is bounded and shaped before it reaches `findByCredentialId`: 1 to 1400
base64url characters, past every real credential id, so an id of any length and any alphabet is not a
bind parameter every unauthenticated POST can supply.

**Three shipped views changed shape**, and an override is held to the new props:

| View | What is new |
| --- | --- |
| `PasskeyEnrolView` | `signoutCsrfToken` and `csrfHeader`. The sign-out control is a `<form method="post">` with its own token — it was a `<Link>` to a POST-only route, which could not work, and `csrfProtection` binds a token to one path. |
| `AdminUserEditView` | `self: boolean` — whether the administrator reading the page _is_ this account, which disables the deactivate and delete controls with their own reasons. |
| `TotpEnrolView` | `codeDigits` and `codePeriodSeconds`, read off the factor rather than hard-coded at six digits and thirty seconds. |

**The enrolment nickname is held to `authPasskeyLabelSchema`.** It was trimmed and nothing more; it
now carries that schema's 64-character cap, so one field cannot be bounded on the rename route and
unbounded on the enrolment one. A missing nickname is still a name the visitor declined to give, not
a refusal.

**Two shipped pages carry limits** — the passkey list holds one CSRF token against one delete form
per row, and no shipped view submits a rename. Both are stated in
[`AUTH_FLOWS.md`](../../docs/AUTH_FLOWS.md) §7, with what to supply instead.

#### Embedding a page in your own — `resolveAuthView`

`resolveAuthView(c, options, request)` is the same resolution the loaders run, stopping one step
short of a `Response`. It answers `Result<AuthViewResolved<Name>, Response>`: on success the page's
`name`, its resolved `props`, the `node` built from them, and the `status` this render carries; on
failure the exact refusal forge's own route would have given, since eight of the thirteen pages can
answer a redirect, a 404 or a 503 rather than props.

A page whose route runs guards needs `guarded`, spelled `AUTH_VIEW_GUARDS.<name>` — the compiler
holds you to that page's exact list, `require-auth` and `require-admin` are re-checked against
`authCtx` rather than trusted, and a guarded name with no claim throws. The recipe, the claim's
contract and the `class` / `level` chrome props are
[`AUTH_MOUNTING.md`](../../docs/AUTH_MOUNTING.md) §6.

#### The document shell

**The auth pages render into the shell your app registers**, the same one the showcase and the log
viewer render into: `createApp({ shell })`, or `app.setShell(shell)`
([`ROUTING_AND_MIDDLEWARE.md`](../../docs/ROUTING_AND_MIDDLEWARE.md) §6). `AuthWebOptions` has no
`layout` and no `document` — a mountable takes no chrome options, so there is nothing here to keep in
step with the rest of your app.

The shell is handed this request, the page's markup, and a slot: `{ mount: "auth", page, meta }`,
where `page` is the `AuthViewName` and `meta` is a `PageMeta` carrying forge's own title for it
(`Sign in`, `Passkeys`, `Users`, …) and **`robots: "noindex"` on every auth page** — a sign-in, an
account or an admin page has no business in a search index. A shell that wants to vary its chrome
per auth page branches on `slot.page`; one that does not, ignores the slot and serves every mount
alike. **An htmx fragment gets no shell** — it is swapped into a document that already exists.

**With no shell registered, forge renders a bare document** — `<html lang>`, a `<head>` with charset,
viewport and the slot's title, and the page in `<body>`. That is readable but unstyled: forge ships no
stylesheet URL it could guess. For a deployment whose whole chrome is a stylesheet, register
`pageShell({ stylesheet, script, lang })` rather than writing a layout component; anything more — a
favicon, a manifest, an Open Graph tag, a nonce-bearing inline script — is your shell's to render, and
the whole `<head>` is yours once you register one.

`renderAuthPage` takes a `meta` — a `Partial<PageMeta>` merged over forge's own with `mergeMeta`, so
a mount can set a canonical or an `og` field for one page without restating the rest.

The views are Tailwind-classed and `forge.css` does not scan them, so an app that mounts them must add
this line to its own stylesheet, copied as it stands — the path is relative to the stylesheet, and this
is what it is from an `src/` next to `node_modules`:

```css
@source "../node_modules/@y-core/forge/src/auth";
```

Tailwind's scanner follows the symlink a `file:` dependency installs, so this works against a local
checkout too. Do not A/B it against your built stylesheet to check: every class the auth views use is
already produced by forge's `ui/core` and `ui/chrome` scan set, so the two builds come out the same
size today. That overlap is a coincidence of the current markup, not a guarantee — the line is still
required.

### Testing a mount

[`src/auth/web/mount.test.ts`](./web/mount.test.ts) is a working mount test, and the shortest way in is
to read it. Four things about testing this capability are not derivable from any signature.

**Use `fakeAuthD1` for the durable side.** `@y-core/forge/testing` exports it: state an account in
domain terms and it answers the user and factor stores' own statements, binding each id as its 16
`BLOB` bytes. Pair it with `fakeKV` for the **session** storage, which is the one thing here still on
KV. A statement it does not model answers no rows, so a test that needs a challenge to survive a
round trip hands the ceremony a `ChallengeStore` of its own rather than one over the fake —
[`src/auth/web/mount.test.ts`](./web/mount.test.ts) does exactly that.

```ts
const env = { DB: fakeAuthD1([{ id: ADA, email: "ada@example.com", isAdmin: true, factors: [{ kind: "passkey" }] }]), KV: fakeKV() };
```

An enrolment is confirmed by default; `confirmedAt: null` gives the unconfirmed row that makes a user
owe an enrolment, which is how the pending-enrolment and step-up paths are reached.

**Build a UUID with `uuidToBytes` from [`@y-core/forge/storage/db`](../storage/README.md), not from
`crypto`.** There is no `@y-core/forge/crypto` subpath — the namespace is sealed-internal
([`NAMESPACES.md`](../../docs/NAMESPACES.md) §3b) — and `storage/db` is where the UUIDv7 set is
surfaced, alongside `uuidFromBytes`, `uuidv7` and `uuidv7Bytes`. `fakeAuthD1` does the conversion for
you, so you need these only when asserting against a bound parameter yourself.

**A signed-in session is built, not faked.** Mount the same `createAnonymousSession` the app mounts,
then write `AUTH_SESSION_KEY` — and `AUTH_STEP_UP_SESSION_KEY` for a session that has already stepped
up — through `sessionCtx` in a middleware ahead of the guards. **An anonymous mutation needs no seeded
session.** Reading `session.id` — which is exactly what a `subject: (c) => sessionCtx.getOptional(c)?.id`
resolver does — marks a session dirty **when the presented cookie would not already reproduce that
id**, which on a first anonymous request means no cookie at all: the page GET emits a `Set-Cookie`,
and the id the token was minted under is the id the POST is verified against. Carry the cookie from
the GET to the POST, as a browser does, and the round trip works:
[`src/auth/web/mount.test.ts`](./web/mount.test.ts) does it against the real mount. On every request
after that the cookie **does** reproduce the id, so reading it rewrites nothing — which is why the
CSRF wiring above no longer costs a session write per request.

**Register `csrfProtection` after the session middleware, never before.** The subject resolver runs
before `next()`, so a `csrfProtection` mounted first sees no session at all: the resolver returns
`undefined` and the mutation is refused with a `[csrf]` warning naming the cause.

**The CSRF guard answers before the auth guards do.** With `csrfProtection` mounted on the prefix
ahead of the guard chain — which is the order §1 gives — an anonymous, tokenless
`POST /auth/enrol/passkey/register/finish` answers **`403 "Forbidden"` as plain text**, not the `401`
JSON the ceremony group's `medium` implies. It never reaches `requireAuth`. Assert the 403 for a
tokenless request and the 401 only for a request that carries a valid token, or the test asserts the
wrong layer.

### Exports

| Export | Kind | Description |
| --- | --- | --- |
| `authRoutes(base)`, `accountRoutes(base)`, `adminRoutes(base)` | function | The three route-map builders — entry, self-service and administrative. |
| `AUTH_ROUTE_GROUPS` | const | Every middleware group the builders produce, with its guards and its medium. |
| `authPaths(routeMap)` | function | Turns a built route map into href builders, so no path literal is written twice. |
| `authEnrolmentPaths(paths)` | function | The whole `enrolmentPaths` record, one page per kind a user enrols in deliberately — so a chain wired from it cannot owe an enrolment it has nowhere to send. |
| `registerAuth(app, routes, options)`, `registerAccount(…)`, `registerAdmin(…)` | function | Mount each group's handlers on a `Forge` app. No guard is wired here. |
| `createAuthGuards(options)` | function | The middleware stack for every group, built off `AUTH_ROUTE_GROUPS`, plus the configured origin protection on every group that mutates. |
| `requireAuth`, `requireAdmin`, `requireEnrolment`, `requirePendingEnrolment` | function | The four guard primitives, for pages a consumer routes themselves. |
| `requireFreshStepUp` | function | Demands a step-up no older than `freshStepUpMaxAgeMs` on every state-changing request of a user who owes one. Defaults to `AUTH_FRESH_STEP_UP_MS`; `null` is the opt-out. |
| `resolveAuth` | function | Establishes the identity when the session carries one and admits an anonymous request unchanged — what the verify group runs, since that page serves a sign-in and a step-up alike. |
| `authCtx` | const | The context variable `requireAuth` writes the identity to and every later guard reads. |
| `resolveAuthIdentity(session, users, at)` | function | Re-reads the signed-in user, answering `null` for a missing or deactivated one, for a session past its absolute lifetime, for one carrying no established-at stamp, and for one established at or before the account's revocation barrier — and **writes**, dropping that session's auth keys in each of those cases. A store outage denies without clearing. |
| `establishAuthSession(session, userId, at)` | function | Writes the identity and the established-at stamp, clears the step-up mark and the pending address, and regenerates the session id. |
| `renewAuthSession(session, at)` | function | Re-stamps this session past a revocation barrier raised at `at`, so the request that raised one keeps its own session. No id rotation and no cleared step-up mark — the actor is not gaining privilege. |
| `markAuthStepUp(session, at)` | function | Records a satisfied step-up — the only writer of that mark, clamped to no later than now so a skewed clock cannot make one outlast its window. |
| `markAuthSigninPending(session, email)`, `resolveAuthSigninPending(session)` | function | Carry the address awaiting verification in the session rather than the URL. |
| `clearAuthSession(session)` | function | Unsets all three keys and regenerates the session id. |
| `AUTH_SESSION_KEY`, `AUTH_SIGNED_IN_SESSION_KEY`, `AUTH_STEP_UP_SESSION_KEY`, `AUTH_PENDING_SIGNIN_SESSION_KEY` | const | The four session keys, so a consumer reading the session directly names them once. |
| `loadSignin`, `loadSignup`, `loadVerify`, `loadPasskeyEnrol` | function | The four entry-flow page loaders. |
| `loadEnrolTotp` | function | The authenticator-app page an owed enrolment lands on, outside the account group the enrolment guard closes. |
| `loadPasskeyList`, `loadPasskey`, `loadPasskeyEdit`, `loadTotpEnrol`, `loadEmailChange` | function | The five self-service page loaders. |
| `loadAccountFactors`, `loadAdminUserFactors` | function | The sign-in methods panel, for the holder's own account and for the one an administrator named. |
| `loadAdminUsers`, `loadAdminUser`, `loadAdminUserEdit`, `loadAdminElevate` | function | The four administrative page loaders. |
| `createSigninActions`, `createSignupActions`, `createVerifyActions`, `createSignoutActions` | function | The entry-flow submissions, resend and sign-out included. |
| `createPasskeySigninActions`, `createPasskeyEnrolActions`, `createPasskeyManageActions` | function | The two JSON ceremony pairs, and the rename and remove writes. |
| `createPasskeyStepUpActions` | function | The step-up ceremony pair, held against the session already signed in — never the discoverable sign-in, which would clear the mark it must write. |
| `createTotpEnrolActions`, `createTotpManageActions`, `createEmailChangeActions` | function | The owed authenticator-app enrolment, its account-page counterpart, and the email-change submission. |
| `createAdminUserActions`, `createAdminElevateActions` | function | The administrative writes, and the first-admin bootstrap. |
| `renderAuthPage(…)` | function | Resolves a page name against your `views` override and wraps it in your `layout`. |
| `resolveAuthView(c, options, request)` | function | One page's props and node for a page you own, or the refusal forge's own loader would have answered with. |
| `AUTH_VIEW_GUARDS` | const | Per page name, the guards its data assumes have run — the value a host passes as `guarded`. |
| `AUTH_VIEWS` | const | Forge's own markup per page name, so a page cannot be rendered by another page's view. |
| `authSigninSchema()`, `authSignupSchema()`, `authVerifySchema()`, `authEmailChangeSchema()`, `authPasskeyLabelSchema()`, `authTotpEnrolSchema()`, `authAdminUserSchema()`, `authAdminSearchSchema()`, `authAdminElevateSchema()` | function | The form schema each submission parses against. `authTotpEnrolSchema` admits 6–8 digits, which is `createTotpAppFactor`'s own ceiling — a wider field would take a code the factor refuses and report it as a wrong code rather than as a field that is too long. |
| `SigninView`, `SignupView`, `VerifyView`, `PasskeyEnrolView` | component | The four entry-flow pages. |
| `PasskeyListView`, `PasskeyEditView`, `TotpEnrolView`, `EmailChangeView` | component | The four self-service pages. |
| `AdminUsersView`, `AdminUserEditView`, `AdminElevateView` | component | The user list, the edit page, and the elevation bootstrap. |
| `AuthFactorsView`, `AuthFactorsTrigger` | component | One account's sign-in methods, and the button that fetches the panel in its own place. |
| `AuthWebOptions`, `AuthWebPaths`, `AuthRequestServices`, `AuthPasskeyCeremonyOptions`, `AuthIconName`, `AuthPageState` | types | What every loader and action needs, the three href maps, this request's services, the ceremony parameters, the sprite names, and one render's refusal copy. |
| `AuthPathMap`, `AuthEntryPaths`, `AuthAccountPaths`, `AuthAdminPaths` | types | What `authPaths` returns, and the three maps it is read through. |
| `AuthRouteGroup`, `AuthGuardName`, `AuthMedium` | types | One entry of the group table, the six guard names, and the body a group answers with. |
| `AuthGuardChainOptions`, `AuthGuardOptions`, `AuthEnrolmentGuardOptions`, `AuthRouteMaps` | types | What `createAuthGuards` and the primitives take — the step-up freshness window and `AuthGuardOptions.now` included. |
| `AuthGuardResolver` | type | `(c) => T \| Promise<T>` — how a guard's user store and factor registry are built, per request, from the bindings that request carries. |
| `AuthIdentity` | type | What `authCtx` carries — the user id, address, admin flag and step-up time. |
| `AuthViews`, `AuthViewName`, `AuthViewProps`, `AuthPageOptions` | types | The override map, its page names, the props each name's view receives, and what one page render takes. `AuthViewName` is `keyof AuthViewProps`, so the two cannot drift. |
| `AuthViewResolved`, `AuthViewRequest` | types | What `resolveAuthView` answers with, and what it is asked for — the name, the optional state, and the `guarded` claim. |
| `AuthViewChrome` | type | The `class` and `level` every view accepts so a host page can place it. |
| `AuthPasskeyContract` | type | Everything the browser controller reads off a ceremony's scope root. |
| `SigninViewProps`, `SignupViewProps`, `VerifyViewProps`, `PasskeyEnrolViewProps`, `PasskeyListViewProps`, `PasskeyRow`, `PasskeyEditViewProps`, `TotpEnrolViewProps`, `TotpEnrolState`, `EmailChangeViewProps`, `AdminUsersViewProps`, `AdminUserEditViewProps`, `AdminElevateViewProps`, `AuthFactorsViewProps`, `AuthFactorsTriggerProps`, `AuthFactorRow`, `AuthFactorState` | types | The props of each shipped view — the contract an override is held to. |

---

## `@y-core/forge/auth/client` — the passkey controller

> Import path: `@y-core/forge/auth/client` → `src/auth/client/mod.ts`
> **Browser-only, side-effect import.** esbuild entry points only. No exports.

```ts
import "@y-core/forge/auth/client"; // side-effect: registers the `passkey` scope
import { resume } from "@y-core/forge/ui/client";

resume();
```

**Without this import the ceremony buttons render correctly and do nothing.** The scope is `eager`,
because the markup carries no `data-on-*` action of its own: a lazy scope would have nothing to
resume it, and an unsupported browser must be told before the button is pressed rather than after.

| Scope | Contract |
| --- | --- |
| `passkey` | `eager: true`. Reads the `PASSKEY_*` contract off the scope root and checks WebAuthn support **at mount**, revealing the fallback line and disabling the trigger when it is absent. On press it asks the options endpoint with that endpoint's token, runs `navigator.credentials.create` or `.get`, posts the result to the verification endpoint with the _other_ token, and navigates to the redirect target. However it ends, it writes the status region and dispatches `PASSKEY_OUTCOME_EVENT` on the root. |

The redirect target is passed through `safeRedirectPath` client-side, because an attribute is not a
trust boundary the controller may skip. The scope root is hand-rendered rather than wrapped in
`Resumable` — [`UI_CLIENT_RUNTIME.md`](../../docs/UI_CLIENT_RUNTIME.md) §2a.

---

## See also

- [`AUTH_MOUNTING.md`](../../docs/AUTH_MOUNTING.md) — mounting the capability: the builders, the
  guard table, the seams you supply, and embedding one view in a page of your own.
- [`AUTH_FLOWS.md`](../../docs/AUTH_FLOWS.md) — every flow end to end, and the limits this release
  carries.
- [`NAMESPACES.md`](../../docs/NAMESPACES.md) §5h — the rule that binds all three subpaths, and §5a
  for what `security` routes here.
- [`ERROR_HANDLING.md`](../../docs/ERROR_HANDLING.md) §5e — why resolution throws and operations
  return a `Result`.
- [`src/crypto/README.md`](../crypto/README.md) — the sealed primitives this namespace builds on.
