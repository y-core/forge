---
title: Sessions and Cookies
description: "Forge's own cookie implementation and session lifecycle middleware over a curated re-export of the `@remix-run/session` surface."
audience: consumer
---

# `@y-core/forge/session`

A session on Workers is a cookie you have to sign, a store you have to choose, and a `Set-Cookie` you must not emit on every response or the edge
stops caching anything. This namespace does all three: forge's own hardened cookies, and a middleware that reads the session in and persists it out
without writing a cookie it did not need to.

Reach for it whenever something must be remembered between requests — logged in or not.

```ts
import { createAnonymousSession, createSignedCookie, sessionCtx, sessionMiddleware } from "@y-core/forge/session";
```

The session symbols are a curated re-export of `@remix-run/session`; the cookies and the middleware are forge's own. For exhaustive upstream session
behaviour, consult the `@remix-run/session` documentation.

---

## Getting started

Registered once at app level: `createAnonymousSession` builds the hardened cookie and the storage from `env` and joins them, so the same mount
serves a visitor who never signs in and one who does.

```ts
import { importKeyRing, parseKeyRingSecrets } from "@y-core/forge/crypto/keyring";
import { createAnonymousSession } from "@y-core/forge/session";

app.use(
  "*",
  createAnonymousSession<AppEnv>({
    ring: (env) => importKeyRing(parseKeyRingSecrets(env.SESSION_SECRET)), // a weak secret throws — see Security
    storage: "cookie",
  }),
);
```

**Mount `createAnonymousSession`, not `sessionMiddleware`, on a Worker.** A secret and a KV binding exist only on a request's `env`, and
`sessionMiddleware(storage, cookie)` takes both already built. `createAnonymousSession` resolves them from `env` on the first request and reuses
the middleware it built for every later request with the same `env`. Reach for `sessionMiddleware` only with a `SessionStorage` you already hold
([Backing sessions with your own store](#backing-sessions-with-your-own-store)).

Inside a handler, read the session through its typed accessor. Any mutation marks it dirty, which is what triggers a `Set-Cookie` after the handler
returns.

```ts
import { sessionCtx } from "@y-core/forge/session";

const session = sessionCtx.get(c); // throws if no session middleware ran

session.set("userId", user.id); // dirty → Set-Cookie written after the handler
session.get("userId");
session.unset("cart");
session.destroy(); // clears the session and queues cookie removal
```

`sessionCtx.getOptional(c)` returns `Session | undefined` where the middleware may not have run. Register the session middleware before any
handler that calls `sessionCtx.get`.

**The chain's `session` slot takes only what `createAnonymousSession` or `sessionMiddleware` returns**, and throws on the first request where the
slot set no session ([`ROUTING_AND_MIDDLEWARE.md`][ram-3h] §3h). Both return a `SessionMiddleware`, which carries the cookie's `maxAge`.

**Mount one session middleware per request.** A second `sessionMiddleware` or `createAnonymousSession` whose path also matches — one at `*` and
another at `/admin/*`, say — throws on every request both match, rather than silently replacing the first one's session. So does a handler that
puts a different session into `sessionCtx`: the middleware refuses to save a session it did not set, and the request answers through the error
boundary with nothing persisted. Keep two kinds of state apart as two keys of the one session, or mount the middlewares on paths no request
shares.

---

## Keeping visitor state too large for a cookie

Give `createAnonymousSession` a `kv` resolver in place of `storage: "cookie"`. The cookie then carries **only an opaque signed session id**; the
data lives server-side in KV under that id with a sliding TTL. A visit that sets nothing writes no KV record, so the signed cookie's
expiry, not the KV TTL, limits how long such an id lives.

```ts
import { importKeyRing, parseKeyRingSecrets } from "@y-core/forge/crypto/keyring";
import { createAnonymousSession, sessionCtx } from "@y-core/forge/session";

app.use(
  "*",
  createAnonymousSession<AppEnv>({
    ring: (env) => importKeyRing(parseKeyRingSecrets(env.SESSION_SECRET)), // a weak secret throws — see Security
    kv: (env) => env.SESSIONS_KV,
  }),
);

// In a handler — this is the entire persistence story:
const session = sessionCtx.get(c);
session.set("settings", validated.settings); // dirty → saved to KV, Set-Cookie (id only)
```

The cookie is signed, `httpOnly`, `Secure` and `SameSite=Lax` in every configuration, with no option to relax any of them. It is named
`__Host-session` unless `cookieName` says otherwise; keep the `__Host-` prefix on a name of your own, because it is what makes the browser refuse a
cookie of that name planted by a sibling subdomain.

---

## Choosing a storage backend

|  | KV storage (`kv` given) | Cookie storage (`storage: "cookie"`) |
| --- | --- | --- |
| Data location | Server-side (Workers KV) | Serialized into the cookie |
| Size limit | KV value limits (MBs) | 4096 bytes, enforced — see below |
| Client data exposure | None — opaque id only | Data rides on every request |
| Revocation | Delete the KV key | Impossible until the cookie expires |
| Extra infrastructure | One KV namespace | None |

**Exactly one of `kv` and `storage` must be given, and `createAnonymousSession` throws at mount time otherwise.** Naming `storage: "cookie"` is the
only way to reach cookie storage: a developer who forgot their KV binding gets the throw rather than the weaker backend in silence.

**Use cookie storage for identity and small visitor state, and KV only for visitor state too large for a cookie.** An auth session's identity is
its D1 row, and the cookie holds only the token naming it, so revoking a sign-in never depends on the cookie. KV costs a read on every request and
a write on every change, under a per-key write limit and a small daily write allowance on the free plan, and a delete reaches other locations up
to a minute late (below). Cookie storage signs the payload, which prevents tampering but not reading — store an opaque id rather than a user
object, and nothing a visitor must not read.

**A `Set-Cookie` over 4096 bytes throws where it is built.** RFC 6265 §6.1 measures name, value and attributes together, and a browser over that
discards the whole header without a word: the client silently loses its session, and the next mutation answers 403 from the CSRF policy with
nothing in the logs to connect the two. `serialize` refuses instead, naming the cookie and the size it measured. The failure lands at the write.

`createKVSessionStorage(kv, { prefix?, ttlSeconds? })` is also exported standalone for use with `sessionMiddleware` directly. `prefix` defaults to
`session`, and an empty string is refused because it would key every session under a bare `:id`. A `ttlSeconds` below 60 throws at
construction, here and in `createAnonymousSession`, because Workers KV refuses a shorter `expirationTtl` and every save would fail.

**A validly signed id with no KV record is adopted, not replaced.** KV storage restores it as an empty session under the same id, so a client
holding a signed id from an expired or deleted record keeps that id. The signature is what stops a forged one.

**A KV logout is not instant everywhere.** KV is eventually consistent, so for up to about 60 seconds after `destroy()` or `regenerateId(true)`
deletes a record, another edge location can still read it and serve the old session to a cookie that still names it. Where a sign-out must hold at
once, record the revocation somewhere strongly consistent and check it.

`createMemorySessionStorage()` is **development only** ([`STORAGE_BINDINGS.md`][sb-5a] §5a).

---

## Rotating a signing secret

**The secret is a key ring: hex root secrets comma-joined, newest first.** The first is the active key and signs; every key on the ring verifies,
so existing cookies keep working. A cookie value names the key that signed it, as `value.kid.signature`, and the cookie reports `rotating` whenever
the ring holds more than one key.

```ts
import { createKeyRingResolver, importKeyRing, parseKeyRingSecrets } from "@y-core/forge/crypto/keyring";
import { createSignedCookie } from "@y-core/forge/session";

const sessionRing = createKeyRingResolver<Env>((env) => importKeyRing(parseKeyRingSecrets(env.SESSION_SECRET)));

// inside a handler
const cookie = createSignedCookie("__Host-session", { ring: await sessionRing(c) });
```

Build the resolver at module scope, so the ring and the keys derived from it are imported once per `env`, not on every request.

A rotation is two deploys, and the upgrade in between happens on its own.

**1. Prepend the new secret.** Nothing else is set — the ring is the whole configuration.

```bash
SESSION_SECRET=9c1e…,ab3f…
```

From here the session middleware re-signs each cookie still naming the old key on the next request that carries it. A session never used again
is never upgraded, so leave this deploy in place for at least the cookie's `maxAge`.

**2. Drop the old secret.** Any cookie still naming the old key now fails to verify and its holder starts fresh — after a full `maxAge`, only a
client inactive for the whole window.

```bash
SESSION_SECRET=9c1e…
```

`createAnonymousSession` takes its ring from the `ring` resolver, so the same variable rotates it. Generate each new secret as
[Security](#security) describes.

**Each cookie name signs under a subkey of its own.** `createSignedCookie` derives a `signed-cookie/<name>` subkey from the ring, so a value minted
for one cookie never verifies as another, nor as a CSRF token signed under the same ring. It refuses the auth key ring, which `importKeyRing` did
not build.

**Suppressing the re-issue is the deliberate act, not enabling it.** `{ rotating: false }` makes the middleware decide on the payload alone — old
cookies keep verifying and are never upgraded, so step 2 would sign every remaining holder out. Pass it only to stop re-issuing for a retired key
you are keeping on the ring long-term.

---

## Repairing attribute drift

A browser echoes only `name=value`; it never says which attributes the cookie it holds was set with. Tightening `sameSite`, adding `Secure`, or
changing `Path`/`maxAge` therefore reaches only clients whose session changes. This is not detectable, only declarable:

```ts
import { importKeyRing, parseKeyRingSecrets } from "@y-core/forge/crypto/keyring";
import { createAnonymousSession } from "@y-core/forge/session";

app.use(
  "*",
  createAnonymousSession<AppEnv>({
    ring: (env) => importKeyRing(parseKeyRingSecrets(env.SESSION_SECRET)),
    storage: "cookie",
    reissue: true,
  }),
);
```

Every request carrying a parseable, non-empty session cookie then gets a fresh `Set-Cookie`, so the new attributes land. It also re-arms `Max-Age`
and takes every such response out of shared caches, because the app rewrites `Cache-Control: public` to `private` on any response carrying a
`Set-Cookie` — **set it for the deploy window that pushes the change, then take it back out.** A request carrying no session cookie still emits
nothing.

---

## Backing sessions with your own store

Any object implementing `SessionStorage` can back `sessionMiddleware`. The contract is two methods: `read(cookie)` returns a `Session` for the
incoming value, or a fresh one when `cookie` is `null`; `save(session)` deletes the record `session.deleteId` names, if any, and returns the
cookie value to serialize, `""` when destroyed, or `null` to write no cookie.

```ts
import { createSession, type SessionStorage } from "@y-core/forge/session";
import type { KVNamespace } from "@y-core/forge/storage/kv";

function createKvSessionStorage(kv: KVNamespace): SessionStorage {
  return {
    async read(id) {
      if (!id) return createSession();
      const raw = await kv.get(id, { type: "text" });
      return createSession(id, raw === null ? undefined : JSON.parse(raw));
    },
    async save(session) {
      if (session.deleteId) await kv.delete(session.deleteId); // the id regenerateId(true) replaced
      if (session.destroyed) {
        await kv.delete(session.id);
        return "";
      }
      if (!session.dirty) return null;
      await kv.put(session.id, JSON.stringify(session.data));
      return session.id;
    },
  };
}
```

**Delete the `deleteId` record in `save`.** `session.regenerateId(true)` gives the session a new id and leaves the old one in `deleteId`;
`auth`'s sign-in and sign-out both call it. A store that skips the delete leaves the pre-sign-in record readable by anyone still holding the old
cookie, and a store that loses the new id breaks sign-in.

---

## Storing a non-sensitive value

`createUnsignedCookie` lives in [`@y-core/forge/http`][http-readme], with the shared cookie attribute defaults `createSignedCookie` is built on
([`ROUTING_AND_MIDDLEWARE.md`][ram-3h] §3h). Use it for a theme or a locale — never for anything a client must not forge.
`sessionMiddleware` will not take an unsigned cookie: it accepts a `SignedCookie`, so that mistake is a compile error rather than a review note.

---

## Showing a message once

`session.flash(key, value)` stores a value readable on the next request and then cleared — the standard pattern for a notice across a redirect.
Flashing marks the session dirty, so the value is persisted, surfaced once, and removed on the following save.

**Use `session.flash` when a session store is mounted, and `createFlash` from `@y-core/forge/ui/server` when none is.** Under
`sessionMiddleware` or `createAnonymousSession` the message rides the session the request already saves, so it costs no second cookie. Without
either, `createFlash` keeps messages in a signed cookie of their own, cleared on the request that reads them: queue one with
`flasher.success(c, text)` or its `info`, `warning` and `error` siblings, and read them back with `flasher.get(c)`.

---

## Security

Session and cookie management is deliberately **out of scope for `@y-core/forge/security`**, which covers transport-layer hardening only. The split
is [`NAMESPACES.md`][namespaces-5a] §5a's, and the boundary behind it [`BOUNDARIES.md`][boundaries-2] §2's.

**The session cookie is signed, and that is enforced rather than advised.** `sessionMiddleware` accepts a `SignedCookie` and nothing else.
`createSignedCookie` guarantees three things `createUnsignedCookie` does not: `httpOnly` (not readable from JavaScript, mitigating theft via XSS),
`secure` (HTTPS only), and an HMAC signature (a tampered value is rejected on parse). `httpOnly`, `secure` and `sameSite: "None"` are none of them a
construction option, and `SignedCookieAttributes` keeps all three off `serialize` too, so a caller that tries to relax one gets a compile error
rather than a line that is accepted and quietly discarded. The signed `serialize` still re-forces `httpOnly` and `secure` at runtime, which is what
catches an `as any` or a decorating wrapper the type never saw.

**A `__Host-` name is held to the scope the prefix promises.** The browser stores a `__Host-` cookie only when it is `Secure`, has `Path=/` and
carries no `Domain`, and in return refuses one planted from a sibling subdomain. Both cookie factories throw on a `__Host-` name given a `domain` or
a `path` other than `/`, at construction and on a per-call override to `serialize`, so the cookie cannot be written in a shape the browser would
silently drop. A `__Secure-` or `__Host-` name is `Secure` by default under `createUnsignedCookie` too, and `secure: false` on one throws.

**`Secure` is not configurable** ([`SECURITY_HARDENING.md`][sh-3f] §3f). A cookie that loses it fails silently — no test goes red, and anyone on
the path replays the session — and development is https at every hop ([`WORKERS_PLATFORM.md`][wp-4e] §4e), so a local server that cannot hold a
session needs its transport fixed.

**A configured lifetime is enforced by the signature, not announced by `Max-Age`.** Where `createSignedCookie` is given `maxAge` or `expires`, the
expiry is embedded in the value and covered by the HMAC, so a captured cookie stops verifying on the server at the instant its header claimed —
`Max-Age` alone is a request a client may ignore, and a cookie lifted out of a proxy log or a browser profile ignores it by construction. There is
no clock-skew grace and no legacy format: a value carrying no expiry where one is configured is not a value of that cookie, and `parse` answers
`null` — the same answer a tampered value gets. This is what makes cookie storage's revocation story finite rather than "never". A lifetime that
would bind nothing throws instead of quietly minting an unbounded value: an already-elapsed `expires` at construction, and, on a cookie that carries
a lifetime, a per-call override that zeroes it for a non-empty value. Clearing the cookie — `serialize("", { maxAge: 0 })` — is unaffected.

**The enforced expiry is absolute from the last emit, not from login.** It is re-armed on exactly the events that re-arm `Max-Age` — a session write
or `reissue: true` — so an active visitor is never signed out mid-session. Bounding a session from the moment it was created is a different
guarantee, and this is not it: store the login instant in the session and check it yourself if you need one.

**Regenerate the id after any privilege change.** `session.regenerateId()` after a login prevents session fixation, and marks the session dirty so a
fresh `Set-Cookie` is written. Under cookie storage it cannot delete the old record, because there is no record — the enforced expiry is what bounds
the old value, so keep `maxAge` short there.

**`SameSite` is defence in depth, not a CSRF defence.** `createSignedCookie` defaults to `"Lax"` and rejects `"None"` at construction and per call
alike, so a session cookie cannot ride a cross-site request. Pair it with the app's CSRF policy, the chain's `csrf`, on state-changing routes,
binding the token to the session id so one minted in one browser cannot be replayed from another — the wiring is
[`src/form/README.md`][form-readme]'s.

**Source secrets from bindings, and generate each one** ([`SECURITY_HARDENING.md`][sh-8] §8): `env.SESSION_SECRET`, holding the output of
`openssl rand -hex 32`.
`importKeyRing` decodes each secret from hex and throws on one that fails the strength rule in [`SECURITY_HARDENING.md`][sh-8] §8, so no session,
anonymous-session or flash cookie is built on a weak one.

---

## Gotchas

**The payload decides whether a cookie is written, except under rotation, where the signing key does.** An unchanged payload means the client
already holds what would be written. Under rotation the cookie reports whether the ring's active key signed the incoming value, so one still naming
an older key is re-issued on any request it makes, under either storage, including one that touches nothing — no re-signing and no byte comparison,
which an embedded expiry would make useless anyway. A cookie that fails to parse — tampered, expired, or signed under a key the ring does not hold —
is never re-signed back into validity.

**A sliding window needs a change each request.** Neither reading `session.id` nor re-serializing an unchanged session emits a cookie on its own, so
nothing re-arms `Max-Age` — and since the expiry is inside the signature, nothing re-arms the server's copy of it either. Use `session.set(…)` or
`reissue: true`.

**Reading `session.id` can itself mark the session dirty** — when the value the client presented would not reproduce that id, as on a first visit.
Without that, a CSRF policy given `subject: "session"` would mint a token under a throwaway id no cookie carried forward, and every
anonymous mutation would answer 403. Over KV, a dirty session holding no data writes no record but its id is still issued as the cookie, and a
signed id with no record is restored under the same id, so neither the first view nor the next one writes. Under the CSRF policy, a `GET` reads
the id only when the handler mints a token.

**`createAnonymousSession` caches on the `env` object's identity, not on the cookie name and ring.** That is load-bearing: the cached middleware
closes over the KV namespace `options.kv(env)` returned for the env that built it, so two tenants sharing a cookie name, secure flag and ring
would hash to one slot and share **one KV namespace** — tenant B reading and writing tenant A's sessions.

**The `ring` resolver is called once per `env` object, not per request.** The middleware it feeds is cached on that object's identity, as above,
so a rotated secret takes effect when a request arrives with a new `env` — after the deploy that changed it — not mid-life. Where `env` is not an
object there is nothing to cache on, and the resolver runs on every request.

---

## See also

- [`src/form/README.md`][form-readme] — the CSRF policy, and binding a token to the session id
- [`docs/NAMESPACES.md`][namespaces-5a] §5a — why sessions are not `security`'s
- [`docs/SOURCE_OF_TRUTH.md`][sot-2f] §2f — why this README, and not a `docs/` document, owns the rulings above

[boundaries-2]: ../../warden/canon/libs/BOUNDARIES.md#2-transport-versus-application-security-layer
[form-readme]: ../form/README.md
[http-readme]: ../http/README.md
[namespaces-5a]: ../../docs/NAMESPACES.md#5a-security--transport-layer-hardening-only
[ram-3h]: ../../docs/ROUTING_AND_MIDDLEWARE.md#3h-the-session-is-a-typed-chain-slot
[sb-5a]: ../../docs/STORAGE_BINDINGS.md#5a-absent-bindings-in-local-dev
[sh-3f]: ../../docs/SECURITY_HARDENING.md#3f-deriving-allowedorigins-in-dev
[sh-8]: ../../docs/SECURITY_HARDENING.md#8-secret-strength--one-rule-for-every-secret
[sot-2f]: ../../docs/SOURCE_OF_TRUTH.md#2f-the-prose-rows
[wp-4e]: ../../warden/canon/apps/WORKERS_PLATFORM.md#4e-development-transport-posture
