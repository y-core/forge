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

Registered once at app level: a hardened cookie, a storage backend, and the middleware that joins them.

```ts
import { createCookieSessionStorage, createSignedCookie, sessionMiddleware } from "@y-core/forge/session";

const sessionCookie = createSignedCookie("__session", {
  secrets: [env.SESSION_SECRET], // at least 32 characters, or the factory throws
  maxAge: 60 * 60 * 24 * 7,
  sameSite: "Lax",
});

app.use("*", sessionMiddleware(createCookieSessionStorage(), sessionCookie));
```

Inside a handler, read the session through its typed accessor. Any mutation marks it dirty, which is what triggers a `Set-Cookie` after the handler
returns.

```ts
const session = sessionCtx.get(c); // throws if sessionMiddleware did not run

session.set("userId", user.id); // dirty → Set-Cookie written after the handler
session.get("userId");
session.unset("cart");
session.destroy(); // clears the session and queues cookie removal
```

`sessionCtx.getOptional(c)` returns `Session | undefined` where the middleware may not have run. Register `sessionMiddleware` before any handler
that calls `sessionCtx.get`.

---

## Remembering a visitor without an account

For settings, drafts and preferences with no login, `createAnonymousSession` is the whole story. The cookie carries **only an opaque signed session
id**; the data lives server-side in KV under that id with a sliding TTL.

```ts
app.use(
  "*",
  createAnonymousSession<AppEnv>({
    cookieName: "app_session",
    secret: (c) => c.env.SESSION_SECRET, // ≥ 32 chars, enforced
    kv: (c) => c.env.SESSIONS_KV,
  }),
);

// In a handler — this is the entire persistence story:
const session = sessionCtx.get(c);
session.set("settings", validated.settings); // dirty → saved to KV, Set-Cookie (id only)
```

There is no manual id bookkeeping, no hand-rolled KV keying, and no per-isolate caching to invent — the factory caches internally, keyed on the
`env` object's identity.

The cookie is signed, `httpOnly`, `Secure` and `SameSite=Lax` in every configuration, with no option to relax any of them.

---

## Choosing a storage backend

|  | KV storage (`kv` given) | Cookie storage (`kv` omitted) |
| --- | --- | --- |
| Data location | Server-side (Workers KV) | Serialized into the cookie |
| Size limit | KV value limits (MBs) | ~4 KB total cookie budget |
| Client data exposure | None — opaque id only | Data rides on every request |
| Revocation | Delete the KV key | Impossible until cookie expiry |
| Extra infrastructure | One KV namespace | None |

**Prefer KV for anything beyond a couple of tiny values.** Cookie storage signs the payload, which prevents tampering but not reading — store an
opaque user id rather than a user object.

`createKVSessionStorage(kv, { prefix?, ttlSeconds? })` is also exported standalone for use with `sessionMiddleware` directly. `prefix` defaults to
`session`, and an empty string is refused because it would key every session under a bare `:id`.

`createMemorySessionStorage()` is **development only**: Workers are stateless and run across many isolates, so in-memory sessions do not survive in
production.

---

## Rotating a signing secret

A rotation is two deploys, and the upgrade in between happens on its own.

**1. Prepend the new secret.** The first element signs; the rest only verify, so existing cookies keep working. Nothing else is set — the cookie
reports `rotating` from its own array.

```ts
const cookie = createSignedCookie("__session", { secrets: [env.SESSION_SECRET_NEW, env.SESSION_SECRET_OLD] });
```

From here `sessionMiddleware` re-signs each still-old cookie on the next request that carries it. A session never used again is never upgraded, so
leave this deploy in place for at least the cookie's `maxAge`.

**2. Drop the old secret.** Any cookie still carrying the old signature now fails to parse and its holder starts fresh — after a full `maxAge`, only
a client inactive for the whole window.

```ts
const cookie = createSignedCookie("__session", { secrets: [env.SESSION_SECRET_NEW] });
```

`createAnonymousSession` takes the same array from its `secret` resolver, and each element is length-checked individually.

**Suppressing the re-signing is the deliberate act, not enabling it.** `{ rotating: false }` makes the middleware compare payloads only, which
cannot see a signature at all — old cookies keep verifying and are never upgraded, so step 2 would sign every remaining holder out. Pass it only to
stop paying for a retired secret you are keeping in the array long-term.

---

## Repairing attribute drift

A browser echoes only `name=value`; it never says which attributes the cookie it holds was set with. Tightening `sameSite`, adding `Secure`, or
changing `Path`/`maxAge` therefore reaches only clients whose session changes. This is not detectable, only declarable:

```ts
app.use("*", sessionMiddleware(storage, sessionCookie, { reissue: true }));
```

Every request carrying a parseable, non-empty session cookie then gets a fresh `Set-Cookie`, so the new attributes land. It also re-arms `Max-Age`
and makes every such response uncacheable — **set it for the deploy window that pushes the change, then take it back out.** A request carrying no
session cookie still emits nothing.

---

## Backing sessions with your own store

Any object implementing `SessionStorage` can back `sessionMiddleware`. The contract is two methods: `read(cookie)` returns a `Session` for the
incoming value, or a fresh one when `cookie` is `null`; `save(session)` returns the cookie value to serialize, `""` when destroyed, or `null` to
write no cookie.

```ts
import { createSession, type SessionStorage } from "@y-core/forge/session";

function createKvSessionStorage(kv: KVNamespace): SessionStorage {
  return {
    async read(id) {
      if (!id) return createSession();
      return createSession(id, (await kv.get(id, "json")) ?? undefined);
    },
    async save(session) {
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

**Implement `regenerateId`'s effect if you deviate from `createSession`.** `auth`'s `establishAuthSession` and `clearAuthSession` both call it, so a
custom storage that loses it breaks sign-in.

---

## Storing a non-sensitive value

`createUnsignedCookie` has the same `parse`/`serialize` surface, base64 on the wire and no authentication. Use it for a theme or a locale — never
for anything a client must not forge.

```ts
const themeCookie = createUnsignedCookie("theme", { maxAge: 60 * 60 * 24 * 365, sameSite: "Lax" });

const theme = await themeCookie.parse(c.request.headers.get("cookie")); // string | null
const header = await themeCookie.serialize("dark");
```

`parse` never throws: a missing header, an absent name, malformed base64 and malformed UTF-8 all answer `null`. `serialize` throws only on a lone
surrogate, which UTF-8 cannot represent and which would therefore not survive a round trip.

---

## Showing a message once

`session.flash(key, value)` stores a value readable on the next request and then cleared — the standard pattern for a notice across a redirect.
Flashing marks the session dirty, so the value is persisted, surfaced once, and removed on the following save.

---

## Security

Session and cookie management is deliberately **out of scope for `@y-core/forge/security`**, which covers transport-layer hardening only. The split
is [`NAMESPACES.md`][namespaces-5a] §5a's, and the boundary behind it [`BOUNDARIES.md`][boundaries-2] §2's.

**Sign the session cookie, always.** `createSignedCookie` guarantees three things `createUnsignedCookie` does not: `httpOnly` (not readable from
JavaScript, mitigating theft via XSS), `secure` (HTTPS only), and an HMAC signature (a tampered value is rejected on parse). Neither flag is an
option, so neither can be relaxed by a mistyped config.

**`Secure` is not configurable, and that is the point.** A session cookie that loses `Secure` fails silently in every way that would otherwise catch
it: no test goes red, nothing is logged, the header is one word shorter, and anyone on the path reads the cookie and replays the session. The option
this replaced existed for plain-http development, and the posture it served is the one [`WORKERS_PLATFORM.md`][wp-4e] §4e rules out — **development
is https at every hop**, so `Secure` is already correct locally and an option to relax it buys nothing a correct dev transport does not. If a local
server cannot hold a session, the fix is its transport. An in-process test harness never needed the option either: `Secure` is enforced by a
_browser_ deciding whether to send a cookie back over http, and `app.request(…)` has no browser in it.

**Regenerate the id after any privilege change.** `session.regenerateId()` after a login prevents session fixation, and marks the session dirty so a
fresh `Set-Cookie` is written.

**`SameSite` is defence in depth, not a CSRF defence.** `createSignedCookie` defaults to `"Lax"` and the type rejects `"None"`, so a session cookie
cannot ride a cross-site request. Pair it with `csrfProtection` from `@y-core/forge/form` on state-changing routes, binding the token to the session
id so one minted in one browser cannot be replayed from another — the wiring is [`src/form/README.md`][form-readme]'s.

**Source secrets from bindings.** `env.SESSION_SECRET`, never a literal; each must be at least 32 characters or the factory throws.

---

## Gotchas

**The payload decides whether a cookie is written, except under rotation, where the wire bytes do.** HMAC is deterministic, so an unchanged payload
re-signs to exactly the bytes the client already holds — unless the signing secret moved. Off rotation an unchanged session costs no HMAC at all;
under rotation the middleware re-signs and compares bytes, so a cookie carrying the old signature is re-issued on any request it makes, under either
storage, including one that touches nothing. A cookie that fails to parse — tampered, or signed with a secret the array does not carry — is never
re-signed back into validity.

**A sliding window needs a change each request.** Neither reading `session.id` nor re-serializing an unchanged session emits a cookie on its own, so
nothing re-arms `Max-Age`. Use `session.set(…)` or `reissue: true`.

**Reading `session.id` can itself mark the session dirty** — when the value the client presented would not reproduce that id, as on a first visit.
Without that, a CSRF subject bound to `sessionCtx.getOptional(c)?.id` would mint a token under a throwaway id no cookie carried forward, and every
anonymous mutation would answer 403. Where the cookie _is_ the id and storage restored it, nothing is written.

**`createAnonymousSession` caches on the `env` object's identity, not on the cookie name and secret.** That is load-bearing: the cached middleware
closes over the KV namespace `options.kv(c)` returned for the request that built it, so two tenants sharing a cookie name, secure flag and secret
would hash to one slot and share **one KV namespace** — tenant B reading and writing tenant A's sessions.

**The `secret` resolver is called once per isolate, not per request.** A secret change ships as a deploy, which starts fresh isolates, so a rotation
is picked up when the isolate is rather than mid-life.

**The serialized cookie is queued on the per-request pending-header channel**, flushed by the app's single `applyHeaders` pass — this middleware
does not rebuild the response.

---

## See also

- [`src/form/README.md`][form-readme] — `csrfProtection`, and binding a token to the session id
- [`docs/NAMESPACES.md`][namespaces-5a] §5a — why sessions are not `security`'s
- [`docs/SOURCE_OF_TRUTH.md`][sot-2f] §2f — why this README, and not a `docs/` document, owns the rulings above

[boundaries-2]: ../../warden/canon/libs/BOUNDARIES.md#2-transport-versus-application-security-layer
[form-readme]: ../form/README.md
[namespaces-5a]: ../../docs/NAMESPACES.md#5a-security--transport-layer-hardening-only
[sot-2f]: ../../docs/SOURCE_OF_TRUTH.md#2f-the-prose-rows
[wp-4e]: ../../warden/canon/apps/WORKERS_PLATFORM.md#4e-development-transport-posture
