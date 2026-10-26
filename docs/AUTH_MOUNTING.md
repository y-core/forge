---
title: Auth Mounting
description: "What a consumer mounts to get forge's identity capability: the route groups and their guards, the middleware order, the seams forge does not ship, the bill, and when the key ring must be rotated."
audience: consumer
---

# Auth Mounting

> Owns what a consumer does to stand forge's identity capability up: the route builders and the order they go up in, the guard table every
> group is cut from, the seams forge deliberately ships no implementation for, what mounting costs, how to place a single auth view inside a
> page you own, the standing obligation to rotate the key ring, and the Turnstile challenge on the anonymous forms.
>
> Owns the mount, not the flows. What each flow does once mounted is [`AUTH_FLOWS.md`][af], which also owns the limits this release carries.
>
> Defers to: [`NAMESPACES.md`][namespaces-5h] §5h for the `auth` / `auth/web` / `auth/client` split and the one-way edge;
> [`src/auth/README.md`][auth-readme] for how each of these is called, task by task; [`FORGE_ERRORS.md`][eh-5e] §5e for why resolution throws and
> operations return a `Result`; [`UI_CLIENT_RUNTIME.md`][ucr-3c] §3c for `resume()` and scope registration; and
> [`INPUT_VALIDATION.md`][iv-4a] §4a for Turnstile verification itself.

---

## 0. Quick Reference

- §1 The Mount, in Order: the builders, the one order that works, and the test that holds the mount itself
- §2 The Route Groups and Their Guards: where the group table lives, and why each group is guarded as it is
- §3 What Forge Does Not Ship: the mailer, the deferral, the confirm route, and the bindings
- §4 Why Guards Are Wired Separately from Routes: one table, two readers
- §5 What Mounting Costs You: the bindings, the fixtures they break, and the pre-release caveat
- §6 Embedding an Auth View in Your Own Page: `resolveAuthView`, the `guarded` claim, and the chrome props
- §7 Rotating the Key Ring: the per-key seal bound, what crossing it costs, the cadence, and what dropping a retired secret early costs
- §8 Turnstile on the Anonymous Forms: which forms it covers, why it is an `AuthWebOptions` field, who names the actions, what a refusal answers,
  and why the forms submit over htmx

---

## 1. The Mount, in Order

Every builder is optional: omit a capability by not calling its builder. `authRoutes` carries sign-in, sign-up, verification and the enrolment a
sign-in owes; `accountRoutes` carries the signed-in self-service pages, adding a passkey among them; `adminRoutes` carries user management and the
elevation bootstrap.
`authPaths` turns a built map into href builders, so no path literal is written twice — every loader, action and view reads its targets off that
map.

**The mount is [`src/auth/web/mount.test.ts`](../src/auth/web/mount.test.ts), and this page holds no copy of it.** It is the whole mount with every
name defined, and it is a test: it compiles against the real signatures and drives signup → code → enrolment → step-up → a guarded page, once per
step-up factor. Copy the wiring from there. This section rules on the order it follows.

**Order is load-bearing, and one order works: the session, then `globals`, then the guard groups, then the routes.** `applyMiddlewareChain` takes
the first three and produces the chain order [`ROUTING_AND_MIDDLEWARE.md`][ram-3e] §3e states. `registerAuth`, `registerAccount` and
`registerAdmin` mount the routes after it.

**`csrfProtection` goes in `globals`, never ahead of the session.** Its subject resolver runs before `next()`, so mounted ahead of the session it
reads nothing and every token binds to nobody.

**Every store handed to `createAuthGuards` is a resolver, not a value.** On a Worker a store needs `c.env`, which exists only per request. The
factor registry is the same: the test's `factorRegistryFor` builds a `createFactorRegistry` over this request's factor store.

**A deployment offering no passkey factor must name a `settledPath` of its own — both of them.** The mount test gives the guard chain
`accountRoutes`' `passkeys` page, and `AuthWebOptions.settledPath` defaults to that same page when it is omitted. That page answers **404**
wherever the factor registry offers no passkey factor, so on such a deployment a completed sign-in, and a settled visitor bounced off an enrolment
page, both land on a 404. Name a path the deployment actually serves — the account root is the usual choice — and set it in both places, because the
two are read independently: this one is where a completed sign-in lands, the guard's is where a visitor owing nothing is sent off an enrolment page.

**Why that registry is per request, and whether it is the same one `resolveServices` holds.** §3 says the email-OTP and passkey factors are built
per request because their seams read a `UserStore`; the passkey factor also takes **this request's session id**, which is what the WebAuthn
challenge is bound to, so a registry built once at bootstrap issues challenges bound to nobody. `requireEnrolment` and `requireFreshStepUp` read
only `resolve`, which means their registry and `resolveServices`'s **need not be the same object**. What they must share is `offered`: the roles and
requirements it declares are what decide what is owed, so two registries configured differently leave `requireEnrolment` refusing a page the flow
believes settled. Building one registry per request and handing it to both is the cheapest way to make that true by construction.

**Use `createAnonymousSession`, not `sessionMiddleware`, on a Worker.** `sessionMiddleware(storage, cookie)` takes both eagerly, and
`createKVSessionStorage` needs a KV binding that exists only per request; `createAnonymousSession` resolves the secret and the binding from the
request and caches the middleware on `env` identity — see [`src/session/README.md`][session-readme] section “Anonymous sessions”. Reach for
`sessionMiddleware` only where you already hold a `SessionStorage`.

**Building the storage yourself per request is not that case.** A middleware that constructs a `createKVSessionStorage` and a `createSignedCookie`
off `c.env` on every request and then calls `sessionMiddleware` is `createAnonymousSession` written out by hand, minus the per-env caching — and
`cookieName`, `prefix` and `ttlSeconds` are all options, so the switch can keep byte-identical keying. Switch deliberately rather than blind: the
cookie name is part of the keying, and a `__Host-` prefix additionally constrains `Secure`, `Path=/` and the absence of `Domain`. Any mismatch
re-keys every live session silently — every signed-in visitor is anonymous on the next request, with no error anywhere. Change it where you can
verify a live session survives, not as a tidy-up.

`applyMiddlewareChain` encodes the order inside a group — origin, then rate limit, then the guards — so a consumer never writes it, and
`buildGuardChain` is that same expansion exported for anyone mounting a group by hand. `origin` and `rateLimit` on a group are **policy data the
chain expands into middleware**: a consumer who spreads `group.guards` alone mounts neither, and on a guard-less group mounts nothing at all.

**`origin` is required, and omitting it throws.** `createAuthGuards` refuses to return at all once any group it is wiring answers a state-changing
method with no allowlist behind it — the throw names the group, and it happens inside `app.use(…)`, which is isolate startup on a Worker. Forge
cannot pick your origins and an absent allowlist is not an opt-out, so the alternative would be mounting the sign-in, sign-up and sign-out POSTs
with no cross-origin defence at all and telling nobody. `admin` never reaches this check, because it is never emitted (§2).

**`rateLimit` is keyed by the group's own dotted path** — the `path.join(".")` of each `AUTH_ROUTE_GROUPS` entry. Forge picks no numbers and ships
no binding, since a window right for the sign-in POST is wrong for the admin console. A group nothing is named for gets no limit, and a guard-less
group named for one is emitted for the limit alone. Do not instead match the returned array by path and mutate it: that is the second
copy of the group table this design exists to prevent.

**`Forge` builds its dispatching router once, lazily, on the first request**, so an `app.use` after that request is silently ignored — everything
above happens at bootstrap.

---

## 2. The Route Groups and Their Guards

**The groups, their guards and their media are read in `src/auth/web/routes.ts`, and nowhere else.** `AUTH_ROUTE_GROUPS` there is the
authoritative table: one entry per middleware group, each with the guards it carries and the medium it answers in. A group's `path` is a key path
into the maps `authRoutes`, `accountRoutes` and `adminRoutes` build — `["auth", "verify", "ceremony"]` is the `verify.ceremony` branch of
`authRoutes` — so the routes a group answers are the ones its builder declares under that key. This section rules on why the groups are shaped as
they are.

**A nested group exists only where its guards or its medium differ from its parent's** — that is what turns "these routes answer JSON" and "these
are deliberately not admin-gated" into structure rather than a comment.

**The medium is not documentation — the guards refuse in it.** `createAuthGuards` hands each group's `medium` to the guards it wires, so an expired
session posting to `auth.enrol.ceremony` gets `401 {"error": "Not signed in."}` rather than an HTML redirect the controller would parse as a
ceremony response. On a JSON group `requireAuth` answers 401 and the enrolment guards 403.

**The elevation pair carries no `require-admin`, and that is the point** — it is the first-admin bootstrap, and re-reads the count at write time
rather than trusting the page. **It ends with `require-approval` instead**, so the claim belongs to whoever holds the administrator code rather than
to whoever posts first. That guard reads the session, not the identity, so `createAuthGuards` accepts it in a group with no `require-auth` before
it. **`auth.verify` admits an anonymous visitor and a signed-in one alike**, which is why it carries `resolve-auth`
rather than `require-auth`. The page serves two ceremonies that look the same — the second half of a sign-in, and a step-up a live session owes —
and only the identity tells them apart; `resolve-auth` establishes it when the session carries one and admits an anonymous request unchanged.
Without it every request there reads as a sign-in, `markAuthStepUp` never runs, and a deployment offering a second
factor loops between the enrolment guard and the page meant to satisfy it.

**`auth.verify.ceremony` runs every passkey step-up, including the second half of a sign-in** — no passkey ceremony establishes a session, so none
clears the mark a step-up writes. **`auth.enrol` carries a page per enrollable kind**, because `enrolmentPaths` sends an owed enrolment to the kind
it actually owes and `require-enrolment` refuses the `account` group while that enrolment is outstanding.

**`account.passkeyCeremony` is the settled user's passkey enrolment, nested under `account` for its JSON medium alone.** A nested group inherits
nothing from its parent, so it names every `account` guard again, and its POSTs get the origin check like every mutating leaf. Its
rate-limit key is `account.passkeyCeremony`, apart from `account`'s, so a limit set for the account pages does not reach the ceremony. Where its
`require-fresh-step-up` refusal sits in the flow is [`AUTH_FLOWS.md`][af-3a] §3a.

**`require-fresh-step-up` gates only what changes something, and it is on unless you turn it off.** Every `POST`, `PATCH` or `DELETE` in a group
that carries it needs a step-up inside the window — what stands between a long-lived session and stripping the second factor, removing a passkey,
moving the address, or changing somebody's role. A `GET` is always admitted: reading the page that offers an action is not the action. Omit
`freshStepUpMaxAgeMs` and the window is `AUTH_FRESH_STEP_UP_MS`; pass `null`, which is the only opt-out, and the guard demands
nothing.

**It asks per user, so a deployment with no second factor is not locked out of its own admin pages.** The guard resolves the same offered factors
`require-enrolment` does and demands a mark only where the answer is `step-up-required` — so an offering with no `second` entry, and an
all-`optional` one nobody has enrolled against, are admitted rather than sent to a page that could never clear the demand. Both guards read one
resolution per request through a context variable, so mounting them together costs no second registry query. An unreadable factor registry answers
**503**, the same as the other enrolment guards, because an unknown demand has no remedy page to redirect to.

**`auth` carries no guards and is still emitted**, because `origin` is required and every mutating leaf of a group gets the allowlist check — its
sign-in and sign-up POSTs are exactly the mutations with no identity to check. A group with an empty `guards` array is dropped only where it has no
mutating leaf and no rate limit was named for it. `admin` never appears: its own level has no direct leaf, `users` and `elevate` registering their
own.

---

## 3. What Forge Does Not Ship

Every item here is a seam with a contract and no implementation, and each is required before the matching flow works at all.

| You supply | Because |
| --- | --- |
| An `AuthNotifier` | Forge ships the delivery contract and no mailer. Nothing is emailed until you implement `send`. |
| An `AuthDeferral` — `executionCtx.waitUntil` in a Worker | Both signup and sign-in return before the credential is issued. Doing the work inline reopens the timing oracle the decoy exists to close. |
| The email-change **confirm route** | Forge mounts no route that calls `AuthEmailChangeFlow.confirm`; see [`AUTH_FLOWS.md`][af-5] §5. |
| A D1 binding and the applied auth schema | Every auth store — the durable ones and the ephemeral ceremony pair, challenges and one-shot nonces. The package publishes `src/auth/schema.sql` and no SQL that runs: the app names that file by path in its own `forge db` host config, composes it into a migration of its own with `forge db migrate compose`, then applies it with `forge db migrate`. How that database is migrated, backed up and seeded is [`DATABASE_MANAGEMENT.md`][dm]. |
| A scheduled call to `purgeAuthEphemera` | SQLite keeps an expired row until something deletes it. Every read holds a row against the clock, so a dead one is already inert — a deployment that never purges is slower, not wrong. |
| A KV binding | Session storage. The cookie carries only the session id, and the auth keys live server-side. |
| A key ring | Hex root secrets, newest first, each held to [`SECURITY_HARDENING.md`][sh-8] §8's strength rule, held as a Worker secret. Rotating it is an ongoing obligation, not a one-off (§7). |
| An `Approval` passed to `createAuthGuards` as `approval`, and mounted with `registerApproval`, if this deployment claims its first admin through the page | The claim grants the administrator role, so it fails closed: with no approval passed, both routes under `adminRoutes`' `elevate` send an anonymous visitor to sign-in and answer a signed-in one with **404** rather than offering an open endpoint — as they do when the approval's `code` reads `undefined` or `""`. Read the code off `c.env` per request, because a Worker has no secret until a request carries bindings. |
| `EmailOtpOptions.address` | The address a code is sent to. It is a `UserStore` read, so build the factor per request alongside the stores. |
| `PasskeyFactorOptions.subject` | How the account is shown in the authenticator's own picker. Also a `UserStore` read, and also per request. |
| Session middleware — `createAnonymousSession` from [`@y-core/forge/session`][session-readme] | An action with no session throws by design rather than writing an identity nothing can read back. Back it with **KV**. `storage: "cookie"` works for the auth keys alone, since each is a scalar, but leaves nothing for anything larger — and it is stated rather than reached by leaving `kv` off, which throws. |
| `csrfProtection` from [`@y-core/forge/form`][form-readme] | `mintCsrf` has no minter without it, so every rendered form carries no token. Mount it before the guard chain. |
| `import "@y-core/forge/auth/client"` before `resume()` | Nothing registers the passkey scope otherwise, and every ceremony button renders correctly and does nothing. |
| With `AuthWebOptions.turnstile` set: `import "@y-core/forge/ui/client/htmx"` before `resume()`, the `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` bindings, and a CSP that admits Cloudflare's challenge | Without that import nothing mounts the widget or holds the press, so no token reaches the server and every guarded form is refused (§8). Without either binding every guarded page answers 500 naming it. The CSP takes either `NONCE` with `'strict-dynamic'` in `scriptSrc`, or `TURNSTILE_CSP` there, and `TURNSTILE_CSP` in `frameSrc` and `connectSrc` either way — [`src/security/README.md`][security-readme] section “Widening the policy for a third-party origin”. Where Trusted Types are enforced, the `trusted-types` directive lists `TURNSTILE_TRUSTED_TYPES_POLICY` beside `HTMX_TRUSTED_TYPES_POLICY` ([`SECURITY_HARDENING.md`][sh-2g] §2g). |
| `@import "@y-core/forge/auth/sources.css";` in your stylesheet | `forge.css` does not scan the auth views, so their utility classes are not generated in your build. The file carries the `@source` lines for `src/auth/`; [`src/auth/README.md`][auth-readme] has the detail. |
| A `ForgeIcon<AuthIconName>` covering every name in that union | The views draw from **your** sprite, not a bundled one. Build it with `createIcon`, documented at [`src/ui/README.md`][ui-readme] section “Bind the icon sprite once”. Lucide covers the whole union, but names one glyph differently: its file is `triangle-alert.svg`, so map it to `alert` when you assemble the sprite. |

**`AuthIconName` owns its own membership.** The type in `src/auth/web/types.ts` is the machine-checked source and the register names it
([`SOURCE_OF_TRUTH.md`][sot-2d] §2d); read the union there rather than any prose, here or in [`src/auth/README.md`][auth-readme] — a second copy of
a glyph list drifts, and a drifted one is a page with a missing icon and no error.

---

## 4. Why Guards Are Wired Separately from Routes

`registerAuth` / `registerAccount` / `registerAdmin` mount handlers and **wire no guards.** The middleware stacks come from `createAuthGuards`,
which reads the same `AUTH_ROUTE_GROUPS` table the `register*` functions cut their `app.map` calls along. A second copy of that table would drift,
and a drifted copy is an unguarded admin page that looks guarded. `createAuthGuards` refuses a group that lists an identity-reading guard before
`require-auth`.

**`rateLimit` is keyed by the group's dotted path rather than declared on `AuthRouteGroup`** (§1), so the group table stays the one description of
what a group is and a consumer never restates it.

**Mounting the session middleware is yours, and nothing checks it at bootstrap.** `createAuthGuards` takes no `session` option: an option can only
be checked for presence, and a middleware other than the one actually mounted satisfies that check while protecting nothing. The check that holds
runs per request — `requireAuth` throws when the request carries no session, naming what to mount. So: session middleware first, then the guard
chain — a special case of the order [`ROUTING_AND_MIDDLEWARE.md`][ram-3e] §3e states, which `applyMiddlewareChain` produces from both.

---

## 5. What Mounting Costs You

None of this is a defect; it is the bill, and it is easier to pay knowingly.

**New non-optional bindings, and a wider config.** The D1 and KV bindings in §3 are required, and your app config grows the secrets that go with
them. Every test fixture that builds an env or a config **object literal** stops compiling the moment they are added — not because anything broke,
but because a literal must now name fields it did not before. Expect to touch every such fixture in one pass. Building fixtures through a factory
with defaults rather than as bare literals is what makes the next binding cost one line instead of one edit per fixture.

**Every signed-in visitor signs in again within `AUTH_SESSION_MAX_MS`.** It is an absolute lifetime measured from the moment the session was
established, not a window activity extends: a session an attacker took is otherwise one they can keep alive forever. A session carrying no
established-at stamp is over rather than unbounded.

**A stylesheet rebuild.** The `sources.css` import in §3 changes what Tailwind scans, so your CSS build depends on the installed package's contents
as well as on your lockfile.

**A browser bundle entry.** `import "@y-core/forge/auth/client"` has to reach the browser before `resume()`, which for most apps means a new entry
point or an addition to an existing one.

**The namespace is pre-release, and its signatures move.** Pin the version rather than tracking a branch; and when this page and a signature
disagree, **the signature wins** — check it against [`src/auth/web/mount.test.ts`](../src/auth/web/mount.test.ts), which compiles, rather than
against prose, which does not.

---

## 6. Embedding an Auth View in Your Own Page

`resolveAuthView` gives you one auth page's data, and the node built from it, inside a page you own. It is the same resolution forge's own loaders
run, so what you place is what forge's own sign-in page serves — the same paths, the same path-bound CSRF token, the same refusals.

**It returns a `Result`, and the failure channel is a `Response`.** Most pages can answer a redirect, a 404 or a 503 instead of props — a credential
store that is down has no passkey list to render, and a function that could only return a node would have nowhere to put the 503. Return
`view.error` as it stands; it is already the refusal forge's own route would have given.

`view.data` carries `name`, the resolved `props` (the escape hatch, when you are composing your own markup), `node` (`props` applied to your `views`
override or forge's own view), and `status` — `undefined` for an ordinary 200.

**A guarded page needs `guarded`, and the field is a claim you are making.** Most pages render data that only a guard establishes;
`AUTH_VIEW_GUARDS` names, per page, which guards that is, and names none for a page that needs no guard. Passing
`guarded: AUTH_VIEW_GUARDS.adminUsers` says _this route runs those guards_.

The compiler holds you to the exact list, in order, because `AUTH_VIEW_GUARDS` is `as const`. A guarded name with no `guarded` **throws** — a wiring
mistake, not a request to refuse, so it 500s rather than rendering. An unguarded name types as `readonly []`, so the field stays inert there.

**`require-auth`, `require-admin` and `require-approval` are re-checked here and are not taken on trust.** `require-auth` reads the identity off
`authCtx` and nowhere else, so a route that never ran the guard resolves nobody and gets the sign-in redirect. `require-admin` re-reads `isAdmin`
off that identity and answers the same 403 `requireAdmin` does. `require-approval` reads `approvalCtx`, which only an admitting `requireApproval`
sets, so an `adminElevate` embed on a route that skips it answers 404 rather than showing the claim form to a visitor who never presented the code;
the claim's own handler refuses the same way. The rest — `resolve-auth`, `require-pending-enrolment`, `require-enrolment` and
`require-fresh-step-up` — need a factor-registry round trip that would cost one per render, so for those `guarded` is the whole check. That is why
it is a claim a reviewer can check, and why a lie about it is a lie about your own route.

**Your route needs the same CSRF configuration the path the form posts to is verified with.** The token a rendered auth form carries is minted for
the action path — `authRoutes`' `signinSubmit` for the sign-in view — and `csrfProtection` binds a token to its subject as well as its path. So a
route embedding an auth view has to sit behind the same `csrfProtection` the auth prefixes do, not a second one configured differently: mint under a
subject-less guard and the guarded path refuses the token, mint under none at all and `mintCsrf` throws before anything renders. Extending the path
list of the guard you already mount is the whole fix.

**Placing the view in your layout is `class` and `level`.** Every view accepts both. `class` is composed onto the root after the view's own classes,
so your width or margin wins; `level` sets the heading tag from the view's place in _your_ document, never from its size. Both default to what forge
renders on its own routes, so an embed that passes neither is byte-identical to one.

There is no way to suppress the heading: the views use it as the accessible name of the surface they render. A page with its own heading passes
`level={2}`. To replace a page's markup outright, use the `views` option on `AuthWebOptions` — `resolveAuthView` builds `node` off your entry when
there is one.

---

## 7. Rotating the Key Ring

**Every seal draws a fresh random 96-bit nonce, and that bounds how much one key may do.** NIST SP 800-38D, section 8.3, holds a key used with
random nonces to under 2^32 invocations, past which the chance of drawing a nonce twice stops being negligible. The budget is spent per
`(kid, purpose)` subkey rather than per secret: `identity`, `verify` and `totpWrap` each have their own, so a busy purpose consumes nobody else's.

**Crossing it is not a degradation, it is a collapse.** A nonce drawn twice under one key discloses the XOR of the two plaintexts, and — the worse
half — leaks the GCM authentication subkey. That subkey is what makes a tag unforgeable, so losing it forfeits forgery resistance for **every**
message ever sealed under that key, retroactively rather than from the collision onwards. This is what makes the cadence below a requirement and
not hygiene.

**Rotate at 2^32 seals under any one purpose, or annually, whichever comes first.** One emailed sign-in link is one seal, so roughly 4.3×10⁹ is
years of moderate volume away — distant, but reachable by a deployment that runs long enough. The calendar leg is the one that carries the
obligation in practice, because nothing counts the other one.

**A retired secret stays in the ring until nothing is sealed under it.** For a token purpose that means the longest TTL a token of yours carries:
drop the secret sooner and tokens still in flight stop opening. A wrapped TOTP secret carries **no TTL at all**, so a calendar is no answer for it —
it is sealed at enrolment and opened by the kid in its own frame, however old that kid is.

**A `totpWrap` secret is droppable once no factor is sealed under it, and that is a condition you can test.** A successful verification re-seals the
secret under the active kid when its frame names an older one, riding the write that already records the verification — so the population under a
retiring key shrinks as its holders sign in. `authKeysRetirable`, asked about `totp-app`, is true exactly when that population is empty;
`FactorStore.countSecretsNotUnder` is the same figure for a dashboard.

**Dropping the secret early costs each affected user a recovery code and a re-enrolment, not the account.** Their authenticator app stops being
checkable: the verify page says so, offers their other methods, and logs `auth.factor.unusable`. They step up with a passkey or a recovery code,
then remove the authenticator app and add it again. Put the secret back in the ring before they do, and every enrolment still under it works
again ([`AUTH_FLOWS.md`][af-8] §8).

**Bounding the wait is `purgeStaleTotpSecrets`, and it is yours to call.** A user who never signs in is never re-sealed, so the count can sit above
zero on somebody who may never return. The purge drops `totp-app` rows still under an older kid whose last _accepted_ code is older than a window
you name, from your own scheduled handler. Those users then owe an enrolment, which they reach only after stepping up with another second factor
or a recovery code ([`AUTH_FLOWS.md`][af-8b] §8b). That is why it is **refused unless your deployment offers `totp-app` as `mandatory`**: under any
other requirement nothing asks them to replace what was dropped. It takes the
ring rather than a key id, because it deletes the complement of the active key and a wrong id would take the live enrolments.

The mechanism of a rotation, and what `importAuthKeyRing` demands of each secret, is [`src/auth/README.md`][auth-readme] section “Rotating the
signing secret”.

**This is documented and not enforced, and that is a decision rather than an omission.** Forge holds no durable counter to enforce it with: a
Worker isolate is stateless and the ring is resolved per request, so any count forge kept would reset silently — and a counter that lies about how
much budget is left is worse than none at all. A deployment that wants the bound enforced counts seals in a store of its own, where the count
survives.

---

## 8. Turnstile on the Anonymous Forms

**`AuthWebOptions.turnstile` puts a Cloudflare Turnstile challenge on the forms an anonymous visitor posts, and leaving it out puts one on none.**
With the option omitted, no form renders a widget and no action verifies a token. How to set it is [`src/auth/README.md`][auth-readme] section
“Challenging bots on the sign-in and sign-up forms”; what the page around the forms must supply is §3.

**It covers sign-in, sign-up, and the verify page's code form and resend form — the members of `AuthTurnstileFlow`.** `flows` narrows the
challenge to the forms it names, and an omitted `flows` covers every member. The union in `src/auth/web/types.ts` is the list. Exempt, and not
nameable in `flows`:

- **Sign-out**, which issues no credential and sends no mail.
- **Every passkey JSON ceremony**, because WebAuthn's own user-presence check already proves a person at an authenticator.
- **Every page behind `require-auth`**, because only a signed-in session reaches one. `account.emailChangeSubmit`, which sends mail to an address
  the visitor types, sits behind `require-enrolment` and `require-fresh-step-up` as well (§2).

**The option is a field of `AuthWebOptions` because that one object reaches both halves of a guarded form.** The loader renders the widget with the
site key and the action verifies the token with the secret, and both read the same options, so they cannot disagree about which forms are guarded.
A view embedded through `resolveAuthView` (§6) resolves through those options too, and renders the widget wherever the forge route would. **It is
not middleware**, because a Turnstile token is a field of the form, and a guard that decides from the body is not expressible as middleware
([`INPUT_VALIDATION.md`][iv-1d] §1d). **It is not on the route builders**, because they declare paths and receive no options, so a flag there
would reach neither the loader nor the action.

**Forge names each form's Turnstile action and the token field, and the consumer names neither.** A widget's `action` and the server's
`expectedAction` work only as a pair, and set apart they let a token solved on one form verify at another ([`INPUT_VALIDATION.md`][iv-4a] §4a).
Forge renders the widget and runs the check, so it sets both halves of each pair itself: `AUTH_TURNSTILE_ACTIONS` in `src/auth/web/options.ts`
binds one action per flow, and the token is read from `TURNSTILE_FIELD_DEFAULT`. That is why `AuthTurnstileOptions.verify` leaves out
`tokenField`, `expectedAction` and `expectedCData`. The token field is dropped before the schema runs only on a request the check ran on, the rule
[`INPUT_VALIDATION.md`][iv-1d] §1d states for every guard.

**Forge reads the keys and pins the token too, so `turnstile: {}` is a complete configuration.** The keys come from `readTurnstileKey`, each read
only where it is used, the hostname from the request and the remote address from `CF-Connecting-IP` — the defaults [`INPUT_VALIDATION.md`][iv-4a]
§4a states for every Turnstile check, including when a testing secret is accepted. `keys` and `verify` are overrides for a deployment that differs,
and neither carries a relaxation. The approval prompt reads its `turnstile` the same way.

**A refused token is the flow's ordinary failure, and it never reaches the flow.** Sign-in, sign-up and the code form answer `422` naming the
schema's first declared field, the shape every guard refusal takes; the residual oracle that leaves is [`INPUT_VALIDATION.md`][iv-4b] §4b's. The
copy is "Verification failed. Please try again." rather than that field's own, because a visitor whose challenge fails has typed nothing wrong, and
telling them to fix the field sends them to correct what is already correct. So the words tell a refused challenge from a malformed field, which
that shape alone is built not to do; the status and the named field still match. A resend refused by the challenge answers `422` with the verify
page re-rendered under the same copy, a resend whose body cannot be read answers it under the submission copy, and neither issues a code. Only
the outcomes that depend on the account share the `resent` redirect, because a challenge's result depends on the client and tells nothing about the
address. The check runs before the flow is called, so a refusal spends no verification attempt and starts no cooldown. The reason is logged at
`warn` and is sent nowhere else.

**The covered forms always submit over htmx, whether or not `turnstile` is set.** The widget runs with `challenge="submit"`, which holds the press
at an htmx request and needs an htmx form to hold it on ([`UI_CLIENT_RUNTIME.md`][ucr-2c] §2c); making the submission depend on the option would
give each form two ways to post. Each form keeps its native `action`, so it still posts without JavaScript. A success answers `204` with
`HX-Redirect`, so htmx navigates rather than swapping the next page into the form. A refusal answers the re-rendered view as a fragment, which
replaces the card: each form targets its view's root, whose id is `AUTH_SIGNIN_ID`, `AUTH_SIGNUP_ID` or `AUTH_VERIFY_ID`, and a `422` of HTML
swaps by [`UI_CLIENT_RUNTIME.md`][ucr-4a] §4a.

[af]: ./AUTH_FLOWS.md
[af-3a]: ./AUTH_FLOWS.md#3a-enrolment
[af-5]: ./AUTH_FLOWS.md#5-email-change
[af-8]: ./AUTH_FLOWS.md#8-recovery--no-lost-value-locks-an-account-out-or-lets-it-in-on-less
[af-8b]: ./AUTH_FLOWS.md#8b-a-confirmed-second-factor-comes-before-any-enrolment
[auth-readme]: ../src/auth/README.md
[dm]: ./DATABASE_MANAGEMENT.md
[eh-5e]: ./FORGE_ERRORS.md#5e-startup-invariants--env-validation-and-binding-resolvers-throw
[form-readme]: ../src/form/README.md
[iv-1d]: ./INPUT_VALIDATION.md#1d-defineaction--the-schema-contract
[iv-4a]: ./INPUT_VALIDATION.md#4a-verifyturnstile--cloudflare-turnstile-captcha
[iv-4b]: ./INPUT_VALIDATION.md#4b-guard-refusal-shape-and-its-residual-oracle
[namespaces-5h]: ./NAMESPACES.md#5h-auth--identity-and-only-the-domain-of-it
[ram-3e]: ./ROUTING_AND_MIDDLEWARE.md#3e-applymiddlewarechain-canonical-chain-builder
[security-readme]: ../src/security/README.md
[session-readme]: ../src/session/README.md
[sh-2g]: ./SECURITY_HARDENING.md#2g-trusted-types-and-htmx--the-forge-htmx-policy
[sh-8]: ./SECURITY_HARDENING.md#8-secret-strength--one-rule-for-every-secret
[sot-2d]: ./SOURCE_OF_TRUTH.md#2d-ui-contracts-and-data-tables
[ucr-2c]: ./UI_CLIENT_RUNTIME.md#2c-the-turnstile-scope--captcha-controller
[ucr-3c]: ./UI_CLIENT_RUNTIME.md#3c-resumable-scopes
[ucr-4a]: ./UI_CLIENT_RUNTIME.md#4a-which-responses-swap-html-4xx-yes-5xx-no
[ui-readme]: ../src/ui/README.md
