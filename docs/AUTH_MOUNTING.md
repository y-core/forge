---
title: Auth Mounting
description: "What a consumer mounts to get forge's identity capability: the three route groups and their guards, the order the middleware goes up in, the seams forge does not ship, and the bill."
audience: consumer
---

# Auth Mounting

> Owns what a consumer does to stand forge's identity capability up: the three route builders and
> the order they go up in, the guard table every group is cut from, the seams forge deliberately
> ships no implementation for, what mounting costs, and how to place a single auth view inside a
> page you own.
>
> Owns the mount, not the flows. What each flow does once mounted is
> [`AUTH_FLOWS.md`](./AUTH_FLOWS.md), which also owns the limits this release carries.
>
> Defers to: [`NAMESPACES.md`](./NAMESPACES.md) §5h for the `auth` / `auth/web` / `auth/client`
> split and the one-way edge; [`src/auth/README.md`](../src/auth/README.md) for every signature,
> option shape and export; [`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §5e for why resolution throws
> and operations return a `Result`; [`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §3c for
> `resume()` and scope registration.

---

## 0. Quick Reference

- §1 The Mount, in Order: the three builders, the one order that works, and the compiled copy of it
- §2 The Three Route Groups and Their Guards: which paths each builder registers and what admits a visitor
- §3 What Forge Does Not Ship: the mailer, the deferral, the confirm route, and the bindings
- §4 Why Guards Are Wired Separately from Routes: one table, two readers
- §5 What Mounting Costs You: the bindings, the fixtures they break, and the pre-release caveat
- §6 Embedding an Auth View in Your Own Page: `resolveAuthView`, the `guarded` claim, and the chrome props

---

## 1. The Mount, in Order

Three builders, each optional: omit a capability by not calling its builder. `authRoutes(base)`
carries sign-in, sign-up, verification and passkey enrolment; `accountRoutes(base)` carries the
signed-in self-service pages; `adminRoutes(base)` carries user management and the elevation
bootstrap. `authPaths(routeMap)` turns a built map into href builders, so no path literal is written
twice — every loader, action and view reads its targets off that map.

Order is load-bearing, and one order works. Every import below is a published subpath:

```ts
import { applyMiddlewareChain } from "@y-core/forge/app";
import {
  accountRoutes,
  adminRoutes,
  authEnrolmentPaths,
  authPaths,
  authRoutes,
  createAuthGuards,
  registerAccount,
  registerAdmin,
  registerAuth,
} from "@y-core/forge/auth/web";
import { csrfProtection } from "@y-core/forge/form";
import { createAnonymousSession, sessionCtx } from "@y-core/forge/session";
import { createD1Client } from "@y-core/forge/storage/db";

const authMap = authRoutes("/auth");
const accountMap = accountRoutes("/account");
const adminMap = adminRoutes("/admin");

// `AuthWebOptions.paths` wants all three maps under one object; `authPaths` builds one at a time.
const paths = { auth: authPaths(authMap), account: authPaths(accountMap), admin: authPaths(adminMap) };

applyMiddlewareChain(app, {                  // session first, then each group's origin check and guards
  securityHeaders,
  session: createAnonymousSession({ secret: (c) => c.env.SESSION_SECRET, kv: (c) => c.env.KV }),
  guards: createAuthGuards({
    routes: { auth: authMap, account: accountMap, admin: adminMap },
    // Both are resolvers: on a Worker a store needs `c.env`, which exists only per request.
    auth: { users: (c) => createUserStore(createD1Client(c.env.DB)), signinPath: paths.auth.signin() },
    enrolment: {
      factors: (c) => factorRegistryFor(c),
      // One page per kind a user enrols in deliberately: a passkey page cannot clear an owed
      // authenticator-app enrolment, and `authEnrolmentPaths` covers both so neither can be missed.
      enrolmentPaths: authEnrolmentPaths(paths.auth),
      stepUpPath: paths.auth.verify.show(),
      settledPath: paths.account.passkeys(),
      freshStepUpMaxAgeMs: 900_000,        // optional; defaults to 15 minutes, `null` to opt out
    },
    origin: { allowedOrigins },
    rateLimit: { auth: signinLimit, "auth.verify": verifyLimit },
  }),
});
// Session first, csrfProtection second: the subject resolver runs before `next()`, so a resolver
// registered ahead of the session middleware reads nothing and the token binds to nobody.
app.use("*", csrfProtection({ secret, subject: (c) => sessionCtx.getOptional(c)?.id }));
registerAuth(app, authMap, options);         // then the routes themselves
registerAccount(app, accountMap, options);
registerAdmin(app, adminMap, options);
```

**This snippet is compiled.** [`src/auth/web/mount.test.ts`](../src/auth/web/mount.test.ts) is the same
mount with every free name given a definition, and it is a test — so a signature that drifts ahead of
this page fails the gate. It also drives signup → code → enrolment → step-up → a guarded page, once
per step-up factor. Read it when a shape here is ambiguous; it is the copy that cannot be wrong.
`factorRegistryFor` is defined there: it builds a `createFactorRegistry` over this request's factor
store, the way `requestStores` builds every other store from `c.env`.

**Why that registry is per request, and whether it is the same one `resolveServices` holds.** §3 says
the email-OTP and passkey factors are built per request because two of their seams read a `UserStore`;
the passkey factor also takes **this request's session id**, which is what the WebAuthn challenge is
bound to, so a registry built once at bootstrap issues challenges bound to nobody. `requireEnrolment`
and `requireFreshStepUp` read only `resolve` and `stepUp` — no ceremony, so no session id of their
own — which means their registry and `resolveServices`'s **need not be the same object**. What they
must share is `offered`, `primary` and `policy`: the policy is what decides what is owed, so two
registries configured differently leave `requireEnrolment` refusing a page the flow believes settled.
Building one registry per request and handing it to both, as the starter does, is the cheapest way to
make that true by construction.

**Use `createAnonymousSession`, not `sessionMiddleware`, on a Worker.** `sessionMiddleware(storage,
cookie)` takes both eagerly, and `createKVSessionStorage` needs a KV binding that exists only per
request; `createAnonymousSession` resolves the secret and the binding from the request and caches the
middleware on `env` identity — see [`src/session/README.md`](../src/session/README.md) section
“Anonymous sessions”. Reach for `sessionMiddleware` only where you already hold a `SessionStorage`.

**Building the storage yourself per request is not that case.** A middleware that constructs a
`createKVSessionStorage` and a `createSignedCookie` off `c.env` on every request and then calls
`sessionMiddleware` is `createAnonymousSession` written out by hand, minus the per-env caching — and
`cookieName`, `prefix` and `ttlSeconds` are all options, so the switch can keep byte-identical keying.
Switch deliberately rather than blind: the cookie name is part of the keying, and a `__Host-` prefix
additionally constrains `Secure`, `Path=/` and the absence of `Domain`. Any mismatch re-keys every
live session silently — every signed-in visitor is anonymous on the next request, with no error
anywhere. Change it where you can verify a live session survives, not as a tidy-up.

`applyMiddlewareChain` encodes the order inside a group — origin, then rate limit, then the guards —
so a consumer never writes it. **Pass `origin` or nothing is mounted on the guard-less groups**:
`["auth"]` and `["auth","passkey"]` declare no guards and are emitted only for the origin check, which
is the sole cross-origin defence this layer gives the sign-in, sign-out and passkey-authentication
POSTs.

**`rateLimit` is keyed by the group's own dotted path** — the `path.join(".")` of each
`AUTH_ROUTE_GROUPS` entry. Forge picks no numbers and ships no binding, since a window right for the
sign-in POST is wrong for the admin console. A group nothing is named for is emitted as before, and a
guard-less group named for one is emitted for the limit alone. Do not instead match the returned array
by path and mutate it: that is the second copy of the group table this design exists to prevent.

**`Forge` builds its dispatching router once, lazily, on the first request**, so an `app.use` after
that request is silently ignored — everything above happens at bootstrap.

---

## 2. The Three Route Groups and Their Guards

`AUTH_ROUTE_GROUPS` is the authoritative table: one entry per middleware group, each with the guards
it carries and the medium it answers in. **A nested group exists only where its guards or its medium
differ from its parent's** — that is what turns "these two routes answer JSON" and "these two are
deliberately not admin-gated" into structure rather than a comment.

| Group | Guards | Medium | Routes |
| --- | --- | --- | --- |
| `auth` | none | HTML | `GET`/`POST /signin`, `GET`/`POST /signup`, `POST /signout` |
| `auth.passkey` | none | JSON | `POST /passkey/authenticate/begin`, `POST /passkey/authenticate/finish` |
| `auth.verify` | `resolve-auth` | HTML | `GET`/`POST /verify`, `POST /verify/resend` |
| `auth.verify.ceremony` | `require-auth` | JSON | `POST /verify/passkey/begin`, `POST /verify/passkey/finish` |
| `auth.enrol` | `require-auth`, `require-pending-enrolment` | HTML | `GET /enrol/passkey`, `GET`/`POST /enrol/totp` |
| `auth.enrol.ceremony` | `require-auth`, `require-pending-enrolment` | JSON | `POST /enrol/passkey/register/begin`, `POST /enrol/passkey/register/finish` |
| `account` | `require-auth`, `require-enrolment`, `require-fresh-step-up` | HTML | `GET /passkeys`, `GET /passkeys/:id`, `GET /passkeys/:id/edit`, `PATCH`/`DELETE /passkeys/:id`, `GET`/`POST`/`DELETE /totp`, `GET`/`POST /email-change` |
| `admin.users` | `require-auth`, `require-enrolment`, `require-admin`, `require-fresh-step-up` | HTML | `GET /users`, `GET /users/:id`, `GET /users/:id/edit`, `PATCH`/`DELETE /users/:id` |
| `admin.elevate` | `require-auth`, `require-enrolment`, `require-fresh-step-up` | HTML | `GET`/`POST /elevate` |

**The medium is not documentation — the guards refuse in it.** `createAuthGuards` hands each group's
`medium` to the guards it wires, so an expired session posting to `auth.enrol.ceremony` gets
`401 {"error": "Not signed in."}` rather than an HTML redirect the controller would parse as a
ceremony response. On a JSON group `requireAuth` answers 401 and the enrolment guards 403.

**The elevation pair carries no `require-admin`, and that is the point** — it is the first-admin
bootstrap, and re-reads the count at write time rather than trusting the page.
**The sign-in ceremony endpoints are unguarded because a discoverable sign-in has no identity yet** —
the authenticator names the user, and the server learns who from the assertion.
**`auth.verify` admits an anonymous visitor and a signed-in one alike**, which is why it carries
`resolve-auth` rather than `require-auth`. The page serves two ceremonies that look the same — the
second half of a sign-in, and a step-up a live session owes — and only the identity tells them apart;
`resolve-auth` establishes it when the session carries one and admits an anonymous request unchanged.
Without it every request there reads as a sign-in, `markAuthStepUp` never runs, and a `second-factor`
policy loops between the enrolment guard and the page meant to satisfy it.

**`auth.verify.ceremony` is a step-up of its own, not the discoverable sign-in pair**, which calls
`establishAuthSession` and so clears the very mark a step-up writes. **`auth.enrol` carries a page per
enrollable kind**, because `enrolmentPaths` sends an owed enrolment to the kind it actually owes and
`require-enrolment` refuses the `account` group while that enrolment is outstanding.

**`require-fresh-step-up` gates only what changes something, and it is on unless you turn it off.**
Every `POST`, `PATCH` or `DELETE` in those three groups needs a step-up inside the window — what
stands between a long-lived session and stripping the second factor, removing a passkey, moving the
address, or changing somebody's role. A `GET` is always admitted: reading the page that offers an
action is not the action. Omit `freshStepUpMaxAgeMs` and the window is `AUTH_FRESH_STEP_UP_MS`,
fifteen minutes; pass `null`, which is the only opt-out, and the guard demands nothing.

**It asks the policy per user, so a deployment with no second factor is not locked out of its own
admin pages.** The guard resolves the same factor policy `require-enrolment` does and demands a mark
only where the answer is `step-up-required` — so `{mode:"single"}`, and a `when-enrolled` user with
nothing enrolled, are admitted rather than sent to a page that could never clear the demand. Both
guards read one resolution per request through a context variable, so mounting them together costs no
second registry query. An unreadable factor registry answers **503**, the same as the other enrolment
guards, because an unknown demand has no remedy page to redirect to.

**`auth` and `auth.passkey` carry no guards and are still emitted, once you pass `origin` or name a
rate limit.** Every mutating leaf of a group gets the allowlist check, and these two are exactly the
mutations with no identity to check — so a group with an empty `guards` array is dropped only when
neither was configured. `admin` never appears: its own level has no direct leaf, `users` and `elevate`
registering their own.

---

## 3. What Forge Does Not Ship

Every item here is a seam with a contract and no implementation, and each is required before the
matching flow works at all.

| You supply | Because |
| --- | --- |
| An `AuthNotifier` | Forge ships the delivery contract and no mailer. Nothing is emailed until you implement `send`. |
| An `AuthDeferral` — `executionCtx.waitUntil` in a Worker | Both signup and sign-in return before the credential is issued. Doing the work inline reopens the timing oracle the decoy exists to close. |
| The email-change **confirm route** | Forge mounts no route that calls `AuthEmailChangeFlow.confirm`; see [`AUTH_FLOWS.md`](./AUTH_FLOWS.md) §5. |
| A D1 binding and the applied `schema.sql` | Every auth store — the durable ones and the ephemeral ceremony pair, challenges and one-shot nonces. The file ships in the package and is applied with `wrangler d1 execute --file`. |
| A scheduled call to `purgeAuthEphemera(db, Date.now())` | SQLite keeps an expired row; KV did not. Every read holds a row against the clock, so a dead one is already inert — a deployment that never purges is slower, not wrong. |
| A KV binding | Session storage. The cookie carries only the session id, and the auth keys live server-side. |
| A key ring | Hex root secrets, newest first, each at least 32 bytes, held as a Worker secret. |
| `EmailOtpOptions.address` — `(userId) => string \| Promise<string>` | The address a code is sent to. It is a `UserStore` read, so build the factor per request alongside the stores. |
| `PasskeyFactorOptions.subject` — `(userId) => { name, displayName }` | How the account is shown in the authenticator's own picker. Also a `UserStore` read, and also per request. |
| Session middleware — `createAnonymousSession` from [`@y-core/forge/session`](../src/session/README.md) | An action with no session throws by design rather than writing an identity nothing can read back. Back it with **KV**: the cookie carries only the session id, and the three auth keys live server-side. `createCookieSessionStorage` works for the auth keys alone, since all three are scalars, but leaves nothing for anything larger. |
| `csrfProtection` from [`@y-core/forge/form`](../src/form/README.md) | `mintCsrf` has no minter without it, so every rendered form carries no token. Mount it before the guard chain. |
| `import "@y-core/forge/auth/client"` before `resume()` | Nothing registers the passkey scope otherwise, and every ceremony button renders correctly and does nothing. |
| An `@source` line covering the installed package's `src/auth/` directory | `forge.css` does not scan the auth views, so their utility classes are not generated in your build. The exact directive is in [`src/auth/README.md`](../src/auth/README.md). |
| A `ForgeIcon<AuthIconName>` covering `alert`, `chevron-right`, `key`, `mail` | The views draw from **your** sprite, not a bundled one — forge's own ships only `chevron-right`, so three of the four have to come from somewhere else. Build it with `createIcon`, documented at [`src/ui/README.md`](../src/ui/README.md) section “Icons”. Lucide covers all four, but names one differently: its file is `triangle-alert.svg`, so map it to `alert` when you assemble the sprite. |

**This table owns the `AuthIconName` membership.** The type is the machine-checked source; this row is
the only prose that spells the four names, and [`src/auth/README.md`](../src/auth/README.md) points
here rather than repeating them — two copies of a glyph list drift, and a drifted one is a page with a
missing icon and no error.

---

## 4. Why Guards Are Wired Separately from Routes

`registerAuth` / `registerAccount` / `registerAdmin` mount handlers and **wire no guards.** The
middleware stacks come from `createAuthGuards`, which reads the same `AUTH_ROUTE_GROUPS` table the
`register*` functions cut their `app.map` calls along. Two copies of that table would drift, and a
drifted copy is an unguarded admin page that looks guarded. `createAuthGuards` refuses a group that
lists an identity-reading guard before `require-auth`.

**Mounting the session middleware is yours, and nothing checks it at bootstrap.** `createAuthGuards`
takes no `session` option: an option can only be checked for presence, and a middleware other than the
one actually mounted satisfies that check while protecting nothing. The check that holds runs per
request — `requireAuth` throws when the request carries no session, naming what to mount. So: session
middleware first, then the guard chain, the order `applyMiddlewareChain` produces from both.

---

## 5. What Mounting Costs You

None of this is a defect; it is the bill, and it is easier to pay knowingly.

**Two new non-optional bindings, and a wider config.** The D1 and KV bindings in §3 are required, and
your app config grows the secrets that go with them. Every test fixture that builds an env or a config
**object literal** stops compiling the moment they are added — not because anything broke, but because
a literal must now name fields it did not before. Expect to touch every such fixture in one pass; in
the starter mount that was six. Building fixtures through a factory with defaults rather than as bare
literals is what makes the next binding cost one line instead of six.

**Every signed-in visitor signs in again within seven days.** `AUTH_SESSION_MAX_MS` is an absolute
lifetime measured from the moment the session was established, not a window activity extends: a
session an attacker took is otherwise one they can keep alive forever. A session carrying no
established-at stamp — one issued before this field existed — is over rather than unbounded, so the
mount that adds this signs its live population out once.

**A stylesheet rebuild.** The `@source` line in §3 changes what Tailwind scans, so your CSS build
depends on the installed package's contents as well as on your lockfile.

**A browser bundle entry.** `import "@y-core/forge/auth/client"` has to reach the browser before
`resume()`, which for most apps means a new entry point or an addition to an existing one.

**The namespace is pre-release, and its signatures move.** During a single day of the starter mount,
`AuthGuardChainOptions` gained a type parameter and an `origin` option, `ownPaths` became `ownRoutes`,
and the guard stores became per-request resolvers. Two things follow. Pin the version rather than
tracking a branch; and when this page and a signature disagree, **the signature wins** — check it
against [`src/auth/web/mount.test.ts`](../src/auth/web/mount.test.ts), which compiles, rather than
against prose, which does not. That file exists precisely so this section's warning has a remedy.

---

## 6. Embedding an Auth View in Your Own Page

`resolveAuthView` gives you one auth page's data, and the node built from it, inside a page you own.
It is the same resolution forge's own loaders run, so what you place is what `/auth/signin` serves —
the same paths, the same path-bound CSRF token, the same refusals.

```tsx
const view = await resolveAuthView(c, authWebOptions, { name: "signin" });
if (!view.ok) return view.error;
return renderPage(<MyPage ctx={ctx}>{view.data.node}</MyPage>, { status: view.data.status ?? 200 });
```

**It returns a `Result`, and the failure channel is a `Response`.** Eight of the thirteen pages can
answer a redirect, a 404 or a 503 instead of props — a credential store that is down has no passkey
list to render, and a function that could only return a node would have nowhere to put the 503.
Return `view.error` as it stands; it is already the refusal forge's own route would have given.

`view.data` carries four things: `name`, the resolved `props` (the escape hatch, when you are
composing your own markup), `node` (`props` applied to your `views` override or forge's own view),
and `status` — `undefined` for an ordinary 200.

**A guarded page needs `guarded`, and the field is a claim you are making.** Ten of the thirteen
pages render data that only a guard establishes; `AUTH_VIEW_GUARDS` names, per page, which guards
that is. Passing `guarded: AUTH_VIEW_GUARDS.adminUsers` says _this route runs those guards_:

```ts
const view = await resolveAuthView(c, authWebOptions, { name: "adminUsers", guarded: AUTH_VIEW_GUARDS.adminUsers });
```

The compiler holds you to the exact list, in order, because `AUTH_VIEW_GUARDS` is `as const`. A
guarded name with no `guarded` **throws** — a wiring mistake, not a request to refuse, so it 500s
rather than rendering. An unguarded name types as `readonly []`, so the field stays inert there.

**Two of the four guards are re-checked here and are not taken on trust.** `require-auth` reads the
identity off `authCtx` and nowhere else, so a route that never ran the guard resolves nobody and gets
the sign-in redirect. `require-admin` re-reads `isAdmin` off that identity and answers the same 403
`requireAdmin` does. The two enrolment guards need a factor-registry round trip that would cost one
per render, so for those `guarded` is the whole check — which is why it is a claim a reviewer can
check, and why a lie about it is a lie about your own route.

**Your route needs the same CSRF configuration the path the form posts to is verified with.** The
token a rendered auth form carries is minted for the action path — `/auth/signin` for the sign-in
view — and `csrfProtection` binds a token to its subject as well as its path. So a route embedding an
auth view has to sit behind the same `csrfProtection` the auth prefixes do, not a second one
configured differently: mint under a subject-less guard and the guarded path refuses the token,
mint under none at all and `mintCsrf` throws before anything renders. Extending the path list of the
guard you already mount is the whole fix.

**Placing the view in your layout is `class` and `level`.** Every view accepts both. `class` is
composed onto the root after the view's own classes, so your width or margin wins; `level` sets the
heading tag from the view's place in _your_ document, never from its size. Both default to what forge
renders on its own routes, so an embed that passes neither is byte-identical to one.

```tsx
<Signin {...view.data.props} class='max-w-none' level={2} />
```

There is no way to suppress the heading: the views use it as the accessible name of the surface they
render. A page with its own heading passes `level={2}`. To replace a page's markup outright, use the
`views` option on `AuthWebOptions` — `resolveAuthView` builds `node` off your entry when there is one.
