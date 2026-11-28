---
title: Upgrading Forge
description: "The checklist for moving an app from forge 0.7.7 to the next release: each break in the order to take it, and each consuming app's own list."
audience: consumer
---

# Upgrading Forge

> Owns the upgrade checklist from forge 0.7.7 to the next release: the order an app takes the breaks in, the edit each one asks for, the
> symptom that names it, and each consuming app's own list.
>
> Owns no rule. Each step links the section that rules on what it asks, and `CHANGELOG.md`'s `[Unreleased]` entries record what changed.
>
> Defers to: [`FORGE_CONSUMPTION.md`][fc-4c] §4c for how an upgrade is committed; [`ROUTING_AND_MIDDLEWARE.md`][ram-3e] §3e for the chain and
> its guard policy; [`SECURITY_HARDENING.md`][sh-4e] §4e for rate limits; [`FORGE_ERRORS.md`][eh-3e] §3e for refusals;
> [`AUTH_MOUNTING.md`][am-1] §1 for the auth mount.

---

## 0. Quick Reference

- §1 Taking the Upgrade: one commit, the order below, and the registration throws that name most breaks
- §2 Regenerating the Generated Modules: the env schema and its `RATELIMITS`, then the row types
- §2a The Env Schema and `RATELIMITS`: `forge cf gen env` first, and one `period` across environments
- §2b The Row Types: `forge db types` again
- §3 Resolvers Take the Bindings: rings and the session KV take `env`, the wrapper comes off, and the parameter is named `bindings`
- §4 The Session Slot and Its Cookie: what the slot accepts, `subject: "session"`, the cookie's `maxAge`, the KV `prefix`, and sign-out
- §5 One CSRF Policy on the Chain Root: `csrfProtection` and contribution policies move to the root `csrf`, and what each path class needs
- §6 Guard Groups and the Refusal Hook: route guards into groups, rate limits by binding name, one `onRefuse`, and the order
- §6a Moving a Route's Guards Into a Group: `methods`, shape guards under `forMethod`, what leaves `shape`, and what stays on the route
- §6b Rate Limits Name Their Binding: `binding:`, the declaration, trust on the chain, and `keySuffix`
- §6c Every Refusal Goes Through `onRefuse`: the hooks to rename, declining a refusal, which group answers a CSRF refusal, and the logs
- §6d The Guard Order and the Specs It Flips: origin, then limit, then CSRF
- §7 Auth: the guards, services and approval as contributions, the limit keys, the statuses, the logs and `authNav`
- §7a Guards, Services and the Approval: `createAuthGuards` returns a contribution, `services:`, `approval.contribution`, sign-out recovery
- §7b Auth Rate-Limit Keys: inheritance keyed per route, against explicit keys sharing one budget
- §7c Auth Statuses and Logs: the step-up `429`, the ceremony's problem+json, and the flows' logger
- §7d `authNav` Takes No Ring: the sign-out control, `csrfMinter`'s replacement, and the default `paths`
- §8 Composition Lists: `createPrimaryNav`'s list, and the slots and health checks to adopt
- §9 Markup, Stylesheets, the Service Worker and the Rest: the dialog trigger, `sources.css`, old caches, and the remaining breaks
- §10 Tests and Logs: `sql`'s import, injected log channels, `Unhandled error`, node bundles, the markup readers, and the specs that flip
- §11 Each App's Checklist: the items above that each consuming app takes
- §11a cad-forge: a group per limiter binding, the route shape moved under `forMethod`, its kept `503`s, and the specs that flip
- §11b cornellaw: one root policy, the covered confirmation page, the staff refusal hook, its rings and injected channels
- §11c crucible: the session slot and its one-time sign-out, the root policy, the notes split, its refusal page, and the auth limits
- §11d starter: the root policy, the auth contributions, groups, and its refusal hooks
- §11e task-forge: the chain in place of its stack, one window, and the dialog trigger

---

## 1. Taking the Upgrade

**Take the upgrade as its own commit, with nothing else in it** ([`FORGE_CONSUMPTION.md`][fc-4c] §4c). Before the release is cut, an app works
through this list against forge's working tree with `bun run dev:forge`, and `bun i` restores the pinned release afterwards.

**Work in the order of the sections.** §2 regenerates what the gate compares against, so the later failures are the app's own. §3 to §9 are
grouped by concern; §10 is what the app's specs meet; §11 lists which items each consuming app takes.

**Most breaks fail loudly, and the message is the instruction.** A removed option is a type error, and a wiring mistake throws when
`applyMiddlewareChain` registers, naming the option, the group's paths or both values compared. A stale ring becomes a compile error: a
`ring` reads only the bindings it is typed over, and under the default bindings each one is `unknown`, so a 0.7.7
`(c) => configStore.get(c.env)` ring fails `bun check` rather than answering `500` on its first request. Name the app's bindings where the ring is
passed, `applyMiddlewareChain<Env>(app, …)`, `authRequestServices<Env>(…)`, `defineApproval<Env>(…)` or `AuthOptions<Env>`, and write
`(bindings) => configStore.get(bindings)`. A ring cast past its type still throws on its first request, naming the rewrite. Read the
message before reaching for a cast: a cast turns the signal into a runtime failure later ([`FORGE_CONSUMPTION.md`][fc-4c] §4c).

**Code samples name the resolver parameter `bindings`.** `oxlint.base.json` turns on `eslint/no-shadow`, so `(env) => …` fails lint in any
module that imports `env` from `@y-core/forge/config`.

---

## 2. Regenerating the Generated Modules

### 2a. The Env Schema and `RATELIMITS`

**Run `forge cf gen env` first** — the app's `bun run gen:env`. It emits `RATELIMITS`, `{ NAME: { limit, period } }`, from `wrangler.jsonc`'s
`ratelimits`, beside `EnvSchema`. Until it runs, `validate-env-schema` fails in the unit tier, because the committed module lacks the table.

**A rate limit's `period` is one value across every environment.** Generation fails, naming the binding and the environment, where an
`env.<name>` sets a different `period`, or a `period` other than 10 or 60. An environment may set a different `limit`; `RATELIMITS` carries
the top-level one, and only the `period` is read at runtime, as the `Retry-After` a `429` sends. Choose one window per binding in
`wrangler.jsonc` and keep per-environment differences to `limit` ([`SECURITY_HARDENING.md`][sh-4e] §4e).

### 2b. The Row Types

**Run `forge db types` again.** For a schema that declares no tables it writes `export interface Tables extends Record<never, never> {}`, which
the preset's `typescript/no-empty-object-type` accepts; a copy curated down to no tables fails `lint` until it does.

---

## 3. Resolvers Take the Bindings

**Every `ring`, and `createAnonymousSession`'s `kv`, takes the `env` rather than the request context**, because forge caches the result per
`env` object:

```ts
import { importKeyRing } from "@y-core/forge/crypto/keyring";
import { createAnonymousSession } from "@y-core/forge/session";

const session = createAnonymousSession<Env>({
  ring: (bindings) => importKeyRing([bindings.SESSION_SECRET]),
  kv: (bindings) => bindings.SESSION_KV,
});
```

- **Rewrite `(c) => …c.env.X…` as `(bindings) => …bindings.X…`**, and drop a `getAppContext(c).env` inside one. That covers the chain's `csrf`
  policy, `csrfMintStage`, `createAnonymousSession`, `createFlash`, `defineApproval`, `signedObjectLink`, `resolveAuthServices`, and an auth `ring`.
  A secret that differs per host cannot live in a ring; resolve it per request outside one.
- **Drop the `createKeyRingResolver(…)` wrapper around a `ring` option** and pass the function itself. The option refuses it. Keep the wrapper only
  for a ring a handler resolves for itself.
- **Delete any memoisation of your own around a ring.** Forge resolves every `ring` once per `env` through
  `memoizePerEnv` (`@y-core/forge/context`), which an app may use for its own per-`env` values.
- **Replace a per-request `cors({ origins: … })` wrapper with an origins resolver.** `cors({ origins: (bindings) => … })` resolves once per
  `env` and reuses its matcher, so a middleware that rebuilt `cors` on every request to read config goes.

---

## 4. The Session Slot and Its Cookie

**The chain's `session` slot takes only what `createAnonymousSession` or `sessionMiddleware` returns** ([`ROUTING_AND_MIDDLEWARE.md`][ram-3h]
§3h). A hand-written `Middleware` that built a session per request does not compile there; replace it with `createAnonymousSession`, which
takes the storage choice and caches per `env` ([`AUTH_MOUNTING.md`][am-1] §1). A request the slot leaves without a session throws, naming the
slot.

- **Bind the CSRF token to the session with `subject: "session"`**, in place of `subject: (c) => sessionCtx.getOptional(c)?.id`.
- **With auth mounted, give the session cookie a `maxAge` of at least the auth session's absolute lifetime** — `604800` seconds for the
  default 7 days, `AUTH_SESSION_MAX_MS / 1000`. The chain throws at registration, naming both values, where the cookie's `maxAge` is shorter
  or unset. `createAnonymousSession`'s default passes.
- **Adding a `maxAge`, `createAnonymousSession`'s default included, logs every visitor out once, at deploy.** With a `maxAge` set, a value
  carrying no expiry reads as absent, so every visitor holding one from 0.7.7 starts afresh. A spec fixture that builds the value by hand
  passes the same `maxAge`, or no signed-in spec authenticates.
- **Restate the KV `prefix` when `createAnonymousSession` replaces a hand-built KV store.** Its default is `"session"`, and under any other
  prefix the stored records go unread: every visitor starts afresh.
- **Sign-out destroys the session**, visitor data with it. Move visitor data that must outlive a sign-out into the browser, or pass
  `signOut: { keepVisitorData: true }` to the auth options. A caller of `clearAuthSession` that writes to the session afterwards writes first
  or passes the same option.
- **Import `createUnsignedCookie`, `UnsignedCookie`, `UnsignedCookieOptions` and `CookieAttributes` from `@y-core/forge/http`.**
- **A hand-built object typed `SignedCookie` adds `maxAge`.**

---

## 5. One CSRF Policy on the Chain Root

**An app has one CSRF policy: `applyMiddlewareChain`'s `csrf` option** ([`ROUTING_AND_MIDDLEWARE.md`][ram-3f] §3f). `csrfProtection` is
removed from `@y-core/forge/form`, and a contribution carrying `csrf` fails to compile, or throws at registration naming the root option.

- **Move every policy into the root `csrf`**, beside `session`. Where several sources each carried one, merge them: the root's `paths` and
  `exclude` cover what each did. Rename `CsrfProtectionOptions` to `CsrfPolicyOptions`.
- **Sort the app's mutating paths into the policy's path classes.** A target a visitor posts with no session, such as a contact form, goes on
  `unboundPaths`. An endpoint a server or a tool calls, such as an MCP endpoint, a webhook or a CSP report receiver, sends no token: it goes on the
  policy's `exclude`, or outside its `paths`, and its guard group takes `origin: { …, missing: "allow" }`, since such a caller sends no `Origin`
  either. Everything else stays bound. Never exclude the auth mount or the approval prompt; a policy that misses either throws at registration
  (§7a).
- **Keep `paths: ["*"]`, the default, when the app renders `authNav`.** A mutation to a URL no route matches then answers `403` before the
  `404`, which is deliberate ([`ROUTING_AND_MIDDLEWARE.md`][ram-1e] §1e): a spec expecting `404` for an unrouted `POST` reads `403`.
- **A token verifies for 24 hours by default.** `maxAgeMs` on the policy sets another value; below 20 hours the app owes the visitor a warning
  and a way to extend.
- **`maxBytes` is the policy's alone.** Raise the policy's to the largest body any covered route takes, and keep a tighter per-route cap as
  `defineAction`'s own `maxBytes` ([`INPUT_VALIDATION.md`][iv-2c] §2c). Forge's own auth and approval forms keep a 100 KiB cap
  (`FORM_MAX_BYTES_DEFAULT`) whatever the policy's: a larger body answers `413`, though the policy still reads up to its own cap first.
- **A body the policy cannot parse answers `400` `unreadable-body`**, and one over `maxBytes` `413` `too-large`, both through the refusal hook.
- **An app wiring `app.use` by hand mounts `csrfMintStage(options)`** where it mounted `csrfProtection`; forge's router verifies anything
  still armed.

---

## 6. Guard Groups and the Refusal Hook

### 6a. Moving a Route's Guards Into a Group

**An origin check and an address-keyed rate limit inline on a route move into a guard group on the chain**, which runs them before the CSRF
verify ([`ROUTING_AND_MIDDLEWARE.md`][ram-3e] §3e). A route's own `middleware` keeps identity, membership and any limit keyed by them.

- **Set `methods: ["POST"]` on a limit moved from a `POST` route.** A group's `rateLimit` counts every method on its paths by default, so the
  same limit in a group also counts the `GET`s of the page the form sits on. An absent optional binding answers `503` only for the methods
  its limit counts, so a `GET` under `methods: ["POST"]` passes without it.
- **Wrap a guard moved into a group's `shape` in `forMethod` with its route's verb**, as `forMethod("POST", requireFormContentType())`, with
  `forMethod` from `@y-core/forge/router` and an array where the paths serve several verbs. `shape` runs on every method of the group's
  paths, and passing safe methods is not enough: unwrapped, `requireFormContentType` answers `415` to a `PUT` or `DELETE` on a `POST`-only
  path that the router answers `404`.
- **Register `cors(...)` with `app.use("/api/*", …)` after `applyMiddlewareChain`, not in a group's `shape`**
  ([`SECURITY_HARDENING.md`][sh-3a] §3a). The CSRF policy never arms a preflight, though a group's rate limit and `guards` still run on one.
  In `shape` it still answers, but ahead of that group's origin check and limit.
- **A limit keyed by identity or a route param stays at the route**, as `defineAction`'s or `definePage`'s `rateLimit`, which runs after the
  CSRF verify with `c.params` resolved ([`SECURITY_HARDENING.md`][sh-4e] §4e). A route with param-scoped membership splits the same way: the
  group holds origin, the address limit and the verify, and the route holds identity, membership and the keyed limit.
- **Skip a subtree with `exclude`, never a path test inside a middleware.** A guard group takes `exclude`, and a `globals` entry takes
  `{ middleware, exclude }`.
- **Move a group mounted through `buildGuardChain` to the chain's `guards`**; `@y-core/forge/app` does not export it.

### 6b. Rate Limits Name Their Binding

**Replace `limiter: (c) => c.env.X` with `binding: "X"`**, and the type `RateLimitBinding` with `RateLimit`
([`SECURITY_HARDENING.md`][sh-4e] §4e):

```ts
import type { RateLimitOptions } from "@y-core/forge/security";

const contactLimit: RateLimitOptions = { binding: "RATE_LIMITER", methods: ["POST"] };
```

- **Pass the generated `RATELIMITS` to `applyMiddlewareChain` as `rateLimits`** (§2a).
- **Declare each group's binding** in the chain's `bindings` schema, or as a contribution's `BindingSpec`. Required fails every path when the
  binding is absent; optional answers `503` on its own paths only, and there only for the methods its limit counts
  ([`SECURITY_HARDENING.md`][sh-4b] §4b). A `bindings` that is not a valibot
  object schema, such as a `v.intersect`, moves the binding to a contribution's `BindingSpec`.
- **A group's `rateLimit` takes an array**, run in order, where an app stacked limits.
- **Set `trustCfHeaders: true` once, on `applyMiddlewareChain`, and delete it from every `rateLimit`**, an approval's included. A group's
  limit with no `key` under a chain without it throws at registration. Off Cloudflare, pass a custom `key`.
- **Extend the client-IP key with `keySuffix`, not a custom `key`.** A custom `key` replaces the address whatever the trust; `keySuffix` keys
  `<ip>:<suffix>` and still answers `503` when the address is absent. `routeKeySuffix` (`@y-core/forge/security`) keys per route pattern.
- **A `429` carries `Retry-After`**, the binding's `period` in seconds, unless the hook sets its own.

### 6c. Every Refusal Goes Through `onRefuse`

**One hook, `onRefuse(c, refusal)`, answers every guard's refusal** ([`FORGE_ERRORS.md`][eh-3e] §3e). `refusal.reason` carries what the
old hook received as its argument, and `refusal.guard` narrows it.

- **Rename the hooks:** the CSRF policy's `onForbidden` becomes `applyMiddlewareChain`'s `onRefuse`, or the `onRefuse` of the group whose paths it
  served; `rateLimit`'s `onLimit` becomes `onRefuse`; `requireAdmin`'s and `createAuthGuards`' `onForbidden` become `onRefuse`.
- **Pick the medium per group:** `refuseAsFragment({ target, render })` for an htmx form, `refuseAsProblem()` for a JSON endpoint, both from
  `@y-core/forge/app`, or forge's plain text by passing none.
- **Return `undefined` from a hook for every refusal it does not render** ([`FORGE_ERRORS.md`][eh-3e] §3e). The next hook out answers it,
  forge's default where none does, and a `429` keeps its `Retry-After`. A hook that copied forge's plain-text bodies to cover the rest
  declines them instead.
- **A CSRF refusal is answered by the last-registered matching group that verifies and declares `onRefuse`**, outside its `exclude`, whichever
  group's verify ran the check. A slice's narrow group, such as a contact form's with `refuseAsFragment`, answers its own refusal under a
  broader root group such as `/api/*`; the chain's hook answers where no such group matches. A group that verifies nothing takes none.
- **Re-key log queries on `security.<guard>.refused`**, logged at `warn` for a 4xx and `error` for a 5xx: `form.refused` reads
  `security.csrf.refused`, and the `rate-limit` source's key and binding failure lines read `security.rate-limit.refused`. Every refusal is
  logged, so a wrapper an app kept only to log refusals goes. `security.origin.refused` carries the reason and not the request's headers; an
  app wanting `Origin` or `Referer` logs them from its origin `onRefuse`.
- **A rate-limit `503` answers `Service Unavailable` by default**; a spec matching the body exactly reads that spelling.

### 6d. The Guard Order and the Specs It Flips

**Every matching group's `shape`, origin check and rate limit run before the CSRF verify, and every group's `guards` after it**
([`ROUTING_AND_MIDDLEWARE.md`][ram-3e] §3e). A spec written against another order flips:

- a tokenless `POST` past its quota answers `429`, not `403`;
- a request refused by origin is logged as `security.origin.refused` before any `403` record a lookup by status would take first;
- a rate-limit `key` cannot read what a group's `guards` set, so identity comes from `globals`, such as `resolveAuth`.

---

## 7. Auth

### 7a. Guards, Services and the Approval

**`createAuthGuards` returns a contribution**, `{ guards, sessionMaxAgeAtLeastMs }`, and the guards resolve sessions through the
services resolver ([`AUTH_MOUNTING.md`][am-1] §1):

```ts
import { applyMiddlewareChain } from "@y-core/forge/app";
import { createAuthGuards, registerApproval } from "@y-core/forge/auth/web";

applyMiddlewareChain(app, {
  securityHeaders,
  trustCfHeaders: true,
  rateLimits: RATELIMITS,
  session,
  csrf,
  contributions: [createAuthGuards(chain), approval.contribution],
});
registerApproval(app, approval);
```

- **Move `guards: createAuthGuards({ … })`, or a spread of it, to `contributions`**, and read `.guards` where the result was used as an array.
- **Pass `services: resolveServices` to `requireAuth`, `resolveAuth` and `createAuthGuards`' `auth`**, in place of a `sessions` resolver, where
  `resolveServices` is what `authRequestServices` returns. Set the session bounds once, as `authRequestServices`' `sessionOptions`, and delete any
  second session store built for the guards. A hand-built `AuthRequestServicesResolver` adds `absoluteLifetimeMs`, or is replaced by
  `authRequestServices` (§7c). Moving to `authRequestServices`, pass `prefixes: { challenge, nonce }` with the prefixes the hand-built challenge and
  nonce stores used: under forge's defaults, `auth:challenge` and `auth:nonce`, a ceremony in flight fails once and a single-use token spent just
  before the deploy can be spent once more within its lifetime. A prefix holding `||` or ending in `|` is refused, here and by
  `createChallengeStore` and `createNonceStore` built by hand.
- **Add `approval.contribution` to `contributions`, and call `registerApproval(app, approval)` with no options.** Without the contribution
  the approval prompt answers `500`. Delete `trustCfHeaders` from `defineApproval`'s `rateLimit`.
- **Cover every auth route and the approval prompt with the root `csrf` policy.** Every group `createAuthGuards` returns lists every auth route as
  its `csrfCovers`, so a group spread into another contribution keeps them, and `approval.contribution` lists its prompt. The chain throws
  at registration where there is no `csrf` policy, its `paths` miss one, or an `exclude` entry matches one, naming the route, the
  contribution or guard group listing it, and the entry. Narrow such an entry, as `/members/*` over a mount at `/members`, to the paths
  beside the mount.
- **Delete `authCsrfRefusal(paths.auth)` wherever it answers a refusal**, the CSRF policy's `onForbidden` and a hook composing it included.
  `createAuthGuards` sends a sign-out refused for a stale token to the sign-out confirm page itself, so its `onRefuse` holds only what the
  app renders, such as an admin page, and returns `undefined` for the rest (§6c).
- **Write `secondFactors["totp-app"].issuer` without `:`, and neither it nor `secondFactors.passkey.rpName` as an empty string.**
  `authRequestServices` throws at the call on such a literal, naming the field, and a resolver that returns one rejects `await resolve(c)`.
  An issuer holding `:` was already filed wrongly: an authenticator reads the label up to the first colon as the issuer.

### 7b. Auth Rate-Limit Keys

**A keyless auth group inherits its nearest keyed ancestor's limit, keyed per route**, and a group holding routes with no keyed ancestor
throws ([`AUTH_MOUNTING.md`][am-1] §1). Remove a key that names no group, or that no group holds or inherits; the error names it.

- **Choose between per-route and shared budgets deliberately.** Inheritance gives every route its own budget. Explicit keys on several
  `auth.*` groups that pass one options object keep one budget shared across those ceremonies; drop them for inheritance only where a budget
  per route is what the app wants.
- **A parent keyed `keySuffix: routeKeySuffix` is inherited as it is**, keying `<ip>:<pattern>` once. The test is identity: a function of the
  app's own that wraps `routeKeySuffix` is extended again, and keys the pattern twice.
- **`false` mounts a group and every keyless group under it with no limit.**

### 7c. Auth Statuses and Logs

- **A step-up refused for a spent attempt budget answers `429`**, with `Retry-After` from the factor's `attemptWindowMs`. The primary sign-in
  keeps `422` for a throttle.
- **The `ceremony` and `passkeyCeremony` groups answer every origin, rate-limit and CSRF refusal in problem+json**, a forged passkey-ceremony
  token included, under an app group covering `/account/*` as well. A client of those endpoints reads `application/problem+json`.
- **`authRequestServices` logs its flows through the request logger**: the email-code factor, sign-in, sign-up, email change and the security
  notices. `logger: (c) => Logger` among its options chooses another. A spec that captured `console.log` to see an auth record captures the
  app's channel instead (§10).

### 7d. `authNav` Takes No Ring

- **Drop `ring` from `authNav({ … })`.** Its sign-out control takes the policy's ring and subject.
- **Replace `csrfMinter` with `mintCsrf` from `@y-core/forge/form`** (`src/form/README.md`), and move a target `csrfMinter` served with
  `subject: false` to `unboundPaths`.
- **Keep the policy's default `paths`** (§5): on a page the policy does not cover, `authNav` gives a signed-in viewer a link to the
  sign-out confirm page in place of the one-step sign-out form.
- **Replace the type `AuthNav` with `NavState` from `@y-core/forge/ui/chrome`**, and check `typeof slot === "function"` before calling a slot
  yourself.

---

## 8. Composition Lists

**`createPrimaryNav` takes the app's contributions as a list** ([`ROUTING_AND_MIDDLEWARE.md`][ram-3g] §3g). Replace each `nav.contribute(x)`
with `export const x: NavContribution<…> = …` in the slice, and pass the list from the app root.

- **Give every bar-level menu and megamenu a `key`**, the same key on menus meant to merge. Menus sharing a key with different labels throw.
- **A dev-only entry becomes a list value** the root includes in development, in place of a `mount(app, nav)` that called `contribute`.
- **Build a new definition rather than writing into one**: the stored bar and footer are frozen.

**`createContributionSlots` and `createHealthChecks` are new, and adopting them is optional.** A slice exports its home-page sections or its
health checks as a plain object, and the root passes the list, as it does for the nav.

---

## 9. Markup, Stylesheets, the Service Worker and the Rest

- **`asyncDialogTrigger` emits `command="show-modal"` and `commandfor`**, not `data-dialog-open`. Re-key the app's CSS, client code and spec
  lookups on `commandfor`.
- **Each forge namespace whose markup the app imports needs its `sources.css`.** With `assetConfig` set, `validate-consumer-css-sources`
  follows each value import through forge's own modules and fails until a `css[].input` reaches `@import "@y-core/forge/<ns>/sources.css"`
  for every namespace whose markup that reaches; the failure names the namespace and the importing line ([`FORGE_STRUCTURE.md`][fs-3d]
  §3d). `@y-core/forge/app` and `auth/web` reach `render/htmx` as well as their own; `logging` and `auth` alone reach none.
- **Prune a previous hand-rolled service worker's caches yourself.** `attachPrecache` (`@y-core/forge/assets/client`) drops only its own
  older `forge-precache` caches, so the app's worker deletes the caches its previous worker named, once, in its own `activate`:

```ts
import { attachPrecache } from "@y-core/forge/assets/client";
import type { ServiceWorkerScope } from "@y-core/forge/assets/client";
import { PRECACHE_URLS, PRECACHE_VERSION } from "@y-core/forge/assets/precache";

declare const self: ServiceWorkerScope;

attachPrecache(self, { urls: PRECACHE_URLS, version: PRECACHE_VERSION, fallback: "/offline" });

const isPreviousWorkerCache = (name: string): boolean => /^[0-9a-f]{16,}$/.test(name);

self.addEventListener("activate", (event) => {
  event.waitUntil(
    self.caches.keys().then((names) => Promise.all(names.filter(isPreviousWorkerCache).map((name) => self.caches.delete(name)))),
  );
});
```

The predicate matches whatever names the previous worker used, a bare digest in this sample; it never matches a `forge-precache` name.

- **Rebuild the service worker before a test reads it.** An app with a `js.serviceWorker` runs `bun run build:assets` once after
  upgrading: `validate-service-worker` fails every tier above `static` until a build has written `.forge/sw.inputs.json`, and fails every
  tier once a file the worker's bundle read, the app's `tsconfig.json`, an imported package or the worker's build options change after that
  build ([`ASSET_PIPELINE.md`][ap-4d] §4d).
- **Worker source may not name `Bun`, `Buffer` or `process`, or import `node:process`, `process`, `node:buffer` or `buffer`.** Use
  `Uint8Array` and the env binding, import `Bun`'s functions from `"bun"` in a spec, or move the code into build-time tooling.
- **Run the zone sync again** where the app keeps a zone allow-list: a `:param` matches within one segment, so a deeper route the list let
  through needs its own entry in `paths`.
- **Collect `readPdfFontPack`'s and `readPdfEmbeddedFonts`' `PdfResult`s**, and drop the cast on the parsed `packs.json`.
- **Stop announcing a `defineAction` failure yourself.** `renderError`'s and `renderValidationErrors`' banners carry `ANNOUNCE_FAILURE_ATTR`,
  so forge's client runtime speaks the `422`, `413`, `400` and `500` fragments once on the `failure` channel ([`FORGE_ERRORS.md`][eh-2a]
  §2a). App code that speaks every swap now says a failure twice; leave it the success swaps. An exact-body spec of a banner reads the
  attribute.
- **A `503` panel from `refuseAsFragment` and `defineAction`'s `500` fragment now swap.** Both carry `FAILURE_FRAGMENT_HEADER`, so forge's client
  runtime swaps them as it swaps a 4xx and speaks each once ([`UI_CLIENT_RUNTIME.md`][ucr-4a] §4a). Delete client code and reserved targets that
  explained a 5xx the target never showed. An element's `hx-status:5xx` now applies to a 5xx, where htmx ignored it; any other 5xx still leaves the
  target as it was.
- **Move a `context.url` rewrite out of middleware.** Forge now answers `500` to a request whose middleware changes `context.url` or assigns
  it a new `URL`, and logs `Unhandled error` naming both paths ([`ROUTING_AND_MIDDLEWARE.md`][ram-3a] §3a). Strip a prefix or mount a
  subpath in the Worker's `fetch` export instead, and pass `app.fetch` a `Request` rebuilt on the rewritten URL.

---

## 10. Tests and Logs

- **Import `sql` from `@y-core/forge/storage/db`**; `@y-core/forge/testing/d1` does not re-export it. Rewrite `explainPlan(db, fragment)` as
  `explainPlan(db, fragment.text, fragment.params)`.
- **Inject the app's log channels, and drop a preload that wraps `console.log`.** Forge has no process-wide channel to swap
  ([`STRUCTURED_LOGGING.md`][sl-3d] §3d). The composition root takes its channels as a parameter; a spec passes `quietChannel()` from
  `@y-core/forge/testing` to drop every record, or `captureLogs().channel` to assert on them. `src/testing/README.md` shows the wiring.
- **Drop `createApp({ logger })` if it existed only to route `Unhandled error` into the chain's channels.** With logging configured, the
  error boundary writes `onError override threw` and one `Unhandled error` (`source: "app"`, with whatever `logging.bindings` adds, such as
  the `requestId`) through the request
  logger, so channels built from `env` receive them too. `createApp`'s `logger` takes only an error thrown where no request logger runs:
  before `requestLogger`, or in an app with no logging configured. A query or matcher on lowercase `unhandled error` reads `Unhandled error`.
- **Drop an `Unhandled error` line from your `createApp` `onError` override.** The error boundary now writes that record before it calls the
  override, so an override that also logs the error records it twice. An override that only builds the `Response`, such as
  `createErrorPage(...)`, needs no change, and the error it renders is now recorded where it was not before ([`FORGE_ERRORS.md`][eh-5b] §5b).
- **Read a captured record's fields under `data`.** A `LogRecord` carries `level`, `prefix`, `message` and `timestamp` at the top and the
  bindings and fields under `data`, where a parsed console line had them flat: `line.status` becomes `record.data?.["status"]`.
- **Assert on a log record through a captured channel, not through `console`.** Forge's own records, auth's flows included (§7c), reach the
  request logger once logging is configured.
- **A workerd spec may import a real service that returns a `Result` or parses with a forge schema**: `@y-core/forge/result` and
  `@y-core/forge/validation` load under node, as `@y-core/forge/storage/db` does.
- **Add `.node` to a path that names a forge node bundle file directly**: each is `<stem>.node.mjs`, such as
  `src/validation/mod.node.mjs` ([`BUILD_TOOLING.md`][bt-2n] §2n). An import through a `@y-core/forge/<subpath>` needs nothing.
- **`tagsOf`, `attrValuesOf`, `attrOf`, `innerOf` and `tagOf` see camelCase tag names**, such as SVG's `linearGradient`. An absence assertion
  over inline SVG may start failing, correctly; an assertion written as a substring check for that reason can use `attrValuesOf`.
- **A `createD1Client` built by hand or a KV store given no `logger` writes `warn` and above to the console**, and `elementOf` reads an
  element through nested children of the same name to its own closing tag. A spec asserting a silent console passes such a client or store a
  `logger`; one written around the cut-short element reads the whole one. A module-level `defineD1Binding` needs nothing: given no `logger`,
  its schema monitor and client write to the request logger, so the injected channels take their records.
- **Re-read the flipped statuses and bodies:** `429` for a tokenless `POST` past quota (§6d), `403` for an unrouted mutation (§5), `400` for
  an unreadable CSRF body (§5), `429` for a step-up budget (§7c), `Service Unavailable` for a rate-limit `503` (§6c), and
  `security.<guard>.refused` for a log lookup (§6c).

---

## 11. Each App's Checklist

Every app takes §2, §3's wrapper and parameter items, §6b's binding declaration and §6c's renames where it has the option. The lines below name
what else each app holds, found in its own source.

### 11a. cad-forge

- §2a: regenerate; its limiters keep one `period`.
- §6a: none of its limits is keyed by identity or a route param, so every origin check and limit inline on a route moves into a group,
  one per limiter binding:
  - import: a group per import route, each with its own request cap — `requireFormContentType` and the length guard in `shape`, then the
    origin, then `IMPORT_RATE_LIMITER`;
  - publish: the chunk (`PUT`) and manifest (`POST`) routes in the core contribution, and both source routes (`POST`) in the kernel slice's
    — each route's media-type and length guards in `shape`, then the origin, then `PUBLISH_RATE_LIMITER`;
  - source: both source routes stack `SOURCE_RATE_LIMITER` behind the publish limit, as `rateLimit: [publish, source]`.
- §6a: every guard moved into `shape` is wrapped in `forMethod` with its route's verb, `requireFormContentType` included, and each limit
  takes `methods` with that same verb.
- §6a: the route keeps the bundle-id guard, a route param, then the store and the publish key, which is identity. Collaboration's origin
  check stays behind its relay gate on the route, so a closed relay still answers `503`.
- §6b: `limiter:` becomes `binding:`; `trustCfHeaders` moves to the chain, which also takes `rateLimits: RATELIMITS`. Each limiter is an
  optional contribution `BindingSpec`, declared once — the kernel's source group names `PUBLISH_RATE_LIMITER` without declaring it again,
  since a second declaration throws — and keeps its `503` on its own paths for the verb its limit counts, as the app's own ruling on
  absent capabilities keeps them.
- §6d: the content type and length still answer `415`, `411` and `413` before the origin is judged. These specs flip: a foreign origin
  with a malformed bundle id answers `403`, not `400`; a malformed bundle id from an allowed origin spends the address's budget; and a
  limiter bound to something without `limit` answers `500` on every path once it is a declared `BindingSpec`.
- §9: `render/htmx/sources.css` joins `app`'s, whose error page renders its fragment markup; `logging/sources.css` goes, since its
  `logging` imports reach no markup.
- §10: its `onError` is `createErrorPage` alone, so nothing changes; an unexpected `500` now writes one `Unhandled error` record.

### 11b. cornellaw

- §5: its `csrfProtection` policies merge into one root `csrf` with `subject: "session"` and only `/api/contact` on `unboundPaths`.
  `/` needs no entry: it is `GET`-only, and the token it mints is for `/api/contact`. The policy's `maxBytes` rises to the FICA form's
  body, and the FICA form action keeps its own `defineAction` `maxBytes`. Tokenless `POST`s to a `GET`-only page or an unrouted path read
  `403`.
- §5: the staff address-change confirmation stays covered by the policy, never on `exclude`, where it could not mint the token its `POST`
  carries. Its `GET` inspects the link and renders `EmailChangeConfirmView` with a token minted for the submit path, and the `POST` that
  commits carries it; the action's field is `token`.
- §6a: the route-inline origin and limit guards move into groups with `forMethod("POST", requireFormContentType())` in `shape`,
  `methods: ["POST"]` on each moved limit and `methods: ["GET"]` on the FICA page's browsing budget. The email-confirm and TFS admin
  groups serve `GET` and `POST`, and they take the same `forMethod("POST", …)` shape, as does the dev FICA preview's group. The `/api/*`
  `cors` leaves its group's `shape` for `app.use("/api/*", cors(...))` after the chain.
- §6c: the `/api/fica` group passes `refuseAsFragment({ target: "#fica-result", render })`, one message per status, which also answers that
  path's CSRF refusal. Its `503` panel now swaps into `#fica-result` and is spoken (§9), so a spec there reads the panel; an exact-body
  `503` spec on a path forge's default answers reads `Service Unavailable`.
- §7a: `createAuthGuards` moves into `contributions`, beside `approval.contribution` and the contribution carrying the staff identity's
  `globals`. Its `onRefuse` is the admin refusal page alone, returning `undefined` for every refusal but `admin` in place of an empty body
  at the status; `createAuthGuards` recovers a stale sign-out itself, so `authCsrfRefusal` goes. `authRequestServices` replaces
  the hand-built staff services and their second session store; `resolveAuth` and the guards take `services:`; `trustCfHeaders` leaves
  `defineApproval`, and its own staff CSRF guard goes.
- §7b: `auth` and `auth.verify` keep explicit keys on one staff limit, `keySuffix: () => "staff"`, so sign-in and step-up share a budget;
  `account` and `admin` take `false`.
- §3: the session ring is unwrapped; the FICA ring keeps `createKeyRingResolver`, because a handler resolves it; the `STAFF_KEYS` ring takes
  `bindings`, typed through `AuthOptions<Env>` so `bun check` sees each binding it reads (§1); the per-request `cors` wrapper becomes an
  origins resolver.
- §2a: its `env` limits of 1000 generate beside the top level's, with one `period`. §6b: `limiter:` and `onLimit` go.
- §7d: `authNav` drops its `ring`, and the staff nav state is a `NavState`. §8: `contribute` becomes the nav list, menus keyed.
- §9: `fica-form.ts`'s `speak()` leaves a failure swap to the banner, and its `explain()` and `FICA_TRANSPORT_MESSAGES` go, since the
  `503` panel now swaps. Exact-body specs of a `renderError` banner read the marker, and inside `refuseAsFragment`'s marked wrapper it
  appears twice; the announcer speaks the first. A browser stub that fakes the `503` panel sends `FAILURE_FRAGMENT_HEADER`, or the client
  withholds its swap. The zone sync runs again. No new `sources.css`: `app`, `auth` and `render/htmx` are already imported, and the
  `logging` it imports renders no markup.
- §10: `createWorker` and `createWorkerModule` take the log channels, feeding the chain and the cron handler's logger. `createApp`'s
  `logger` goes, since `Unhandled error` now logs through the request logger. A test helper builds both from `quietChannel()`, and the
  specs that read a record use `captureLogs().channel` in place of `spyOn(console, …)`. The `console` wrapper in `tests/setup.ts` goes.
  The browser helpers import the announcer slots, the failure marker and `FAILURE_FRAGMENT_HEADER` from `ui/contracts` in place of
  literals.

### 11c. crucible

- crucible have been discontinued and is excluded from this initiative

### 11d. starter

- §2a: regenerate `RATELIMITS` with `bun run gen:env` before anything else; `validate-env-schema` fails until then.
- §5: the contribution `csrf` moves to the root policy, with its sessionless targets on `unboundPaths`; unrouted-mutation specs read `403`.
- §6a: the inline contact and showcase guards move into groups, each limit with `methods: ["POST"]`. Every shape guard, `htmxOnlyGuard` and
  the email-confirm group's included, sits under `forMethod("POST", …)`; its spec sends a valid token, since the root policy refuses a
  token-less `PUT` with `403` before the router answers `404`. The `/api/*` `cors` leaves the chain's `guards` for
  `app.use("/api/*", cors(...))` after the chain.
- §6c: the contact group passes `refuseAsFragment`, which now answers its CSRF refusal under the root `/api/*` group, so the contact specs
  that read a plain `Forbidden` for a bad or missing token read the panel in `#contact-result`; exact-body `503` specs read
  `Service Unavailable`.
- §6b: `trustCfHeaders` leaves every policy and moves to the chain; `limiter:` becomes `binding:`.
- §7a: `createAuthGuards` returns a contribution in `contributions`; `resolveAuth({ sessions })` becomes `resolveAuth({ services })`; the
  approval's `approval.contribution` joins the chain and `registerApproval` loses `trustCfHeaders`. The hand-built
  `AuthRequestServicesResolver` becomes `authRequestServices` (§7c), logging through the request logger, on the default
  `auth:challenge` and `auth:nonce` prefixes, since nothing was live to carry over. Its auth hook answers `admin` refusals and returns
  `undefined` for the rest, and the `authCsrfRefusal` it composed goes. It re-wraps `createAuthGuards`' groups in its own contribution,
  and their `csrfCovers` travel with them, so nothing is forwarded by hand. `rpName` and `issuer` are
  resolvers reading the validated config per request.
- §7b: no auth limit key is repeated only to restate a parent's. `account.passkeyCeremony`'s explicit key only restated its parent's
  `routeKeySuffix` limit, which it now inherits with the pattern keyed once, so it goes; the shared `auth.*` ceremony keys stay.
- §7c: step-up specs read `429`. §7d: `authNav` drops its `ring`.
- §3: the object-link ring keeps `createKeyRingResolver`, because a handler resolves it; the auth ring is unwrapped, since only the
  hand-built resolver resolved it and `authRequestServices` refuses the wrapper; every other ring is unwrapped and takes `bindings`; the
  per-request `cors` wrapper becomes an origins resolver.
- §8: each slice exports its `NavContribution`, home sections and health checks as values, and the root passes feature-marked lists;
  `mount(app, nav)` becomes a `nav` value.
- §9: the hand-rolled service worker's caches are pruned in a second `activate` listener beside `attachPrecache`'s; one
  `bun run build:assets` writes the `.forge/sw.inputs.json` record `validate-service-worker` reads above `static`, and runs again after every
  `bun run dev:forge`, since the record covers forge's `package.json`; `warden sync` follows any sync that changes the corpus's synced
  `.claude/` files, which the `warden` step reports as drift. The contact client speaks only success swaps, leaving a marked failure
  banner to forge, and its browser spec reads the announcer's slots and settle time from `@y-core/forge/ui/contracts`. Exact-body banner
  specs read the marker, twice inside `refuseAsFragment`'s wrapper. §2b: a copy curated with no tables runs `forge db types`.
- §10: `sql` comes from `@y-core/forge/storage/db`; the `tests/setup.ts` console wrapper gives way to `quietChannel()` passed through the
  composition root, whose channels also reach the scheduled purges, their D1 clients and the console notifiers; specs that captured
  `console.log` read `captureLogs().channel`, the D1-budget spec reading its records under `data`, and no console capture remains; the
  unhandled-error spec reads one `Unhandled error` carrying the request id beside the `500` summary, which the boundary writes before
  `createErrorPage` renders as `onError`; the notes workerd spec calls the real service; the customise check uses `attrValuesOf`.

### 11e. task-forge

- §6: its hand-rolled `app.use` stack becomes `applyMiddlewareChain` — `csrf` with `subject: false` on its form paths, a group per family
  (browser pages with a strict origin, `/mcp/*` with `origin: { missing: "allow" }`, `/api/*`), each with
  `rateLimit: { binding: "RATE_LIMITER", key }`. `RATE_LIMITER` is an optional contribution `BindingSpec`, keeping its per-path `503`, and
  the database check is a `globals` entry with `exclude: ["/api/health"]`. The `/api/*` `cors` leaves that group's `shape` for
  `app.use("/api/*", cors(...))` after the chain (§6a), so the middleware unit test's `shape` assertion goes and a seam preflight on
  `/api/health` proves `cors` still answers. Its own origin detail line stays, logged from the origin `onRefuse`.
- §2a: one `period` across environments; the development `limit` of 1000 may differ from the top level's.
- §3: the `createFlash` ring drops `createKeyRingResolver` and takes `bindings`; the per-request `cors` wrapper becomes an origins resolver.
- §9: `asyncDialogTrigger`'s `commandfor` replaces `data-dialog-open` in its task-dialog client and the specs that read it;
  `sources.css` is imported for `app` and `render/htmx`, and `logging/sources.css` goes, since its `logging` imports reach no markup.
- §6d and §6c: the tokenless-`POST`-past-quota specs read `429`; the exact-body `503` spec reads `Service Unavailable`; a request-log lookup
  that took the first `403` record meets `security.origin.refused` first.
- §10: the `tests/setup.ts` console suppressor gives way to injected channels. `createWorker` takes the request channels, and its third
  parameter, `appLogger`, goes, since the request logger carries `Unhandled error`. A test helper builds the channels from `quietChannel()`,
  or from `captureLogs().channel` for the origin-guard and D1-binding specs that read records under `data`. The middleware unit test
  asserts the chain declaration, since the order is forge's; its KV-redaction cases run against the app's exported channels. The
  D1-binding spec reads two error records, `request.failed` and `Unhandled error`, where it read three.

[am-1]: ./AUTH_MOUNTING.md#1-the-mount-in-order
[ap-4d]: ./ASSET_PIPELINE.md#4d-the-service-workers-input-record
[bt-2n]: ./BUILD_TOOLING.md#2n-a-node-reached-export-is-declared-under-forgenode
[eh-2a]: ./FORGE_ERRORS.md#2a-rendererror--error-fragment
[eh-3e]: ./FORGE_ERRORS.md#3e-one-refusal-contract-for-every-guard
[eh-5b]: ./FORGE_ERRORS.md#5b-unexpected-errors--the-router-error-boundary
[fc-4c]: ../warden/canon/apps/FORGE_CONSUMPTION.md#4c-upgrading-the-library
[fs-3d]: ./FORGE_STRUCTURE.md#3d-css-source-scanning-stops-at-ui
[iv-2c]: ./INPUT_VALIDATION.md#2c-parseformdata--body-read-with-size-limit
[ram-1e]: ./ROUTING_AND_MIDDLEWARE.md#1e-the-unmatched-url
[ram-3a]: ./ROUTING_AND_MIDDLEWARE.md#3a-global-vs-route-level-middleware
[ram-3e]: ./ROUTING_AND_MIDDLEWARE.md#3e-applymiddlewarechain-canonical-chain-builder
[ram-3f]: ./ROUTING_AND_MIDDLEWARE.md#3f-one-csrf-policy-per-app-verified-once
[ram-3g]: ./ROUTING_AND_MIDDLEWARE.md#3g-a-slice-exports-its-contribution-as-data
[ram-3h]: ./ROUTING_AND_MIDDLEWARE.md#3h-the-session-is-a-typed-chain-slot
[sh-3a]: ./SECURITY_HARDENING.md#3a-cors-middleware-for-api-routes
[sh-4b]: ./SECURITY_HARDENING.md#4b-a-missing-binding-under-forge-cf-dev
[sh-4e]: ./SECURITY_HARDENING.md#4e-one-declaration-per-rate-limit
[sl-3d]: ./STRUCTURED_LOGGING.md#3d-forges-own-records-follow-the-request-logger
[ucr-4a]: ./UI_CLIENT_RUNTIME.md#4a-which-responses-swap-html-4xx-and-marked-5xx
