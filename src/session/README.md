---
title: Sessions and Cookies
description: "Forge's own cookie implementation and session lifecycle middleware over a curated re-export of the `@remix-run/session` surface."
audience: consumer
---

# `@y-core/forge/session`

Session management and cookie primitives for Cloudflare Workers. The cookies are forge's own — `createSignedCookie` (HMAC-signed, `httpOnly`, key cached per secret) and `createUnsignedCookie` — alongside `sessionMiddleware`, a request/response session lifecycle middleware that avoids cache-defeating cookie writes, over a curated re-export of the `@remix-run/session` surface.

```ts
import { sessionMiddleware, sessionCtx, createSignedCookie, createUnsignedCookie, createCookieSessionStorage } from "@y-core/forge/session";
```

---

## Features

- **Cookie-backed sessions** with a single middleware that reads on the way in and persists on the way out.
- **Cache-friendly persistence** — `sessionMiddleware` emits a `Set-Cookie` **only** when the cookie it would write differs, byte for byte, from the one the request carried. A request carrying no session cookie at all — a crawler, an asset path — stays cacheable.
- **Rotation that completes on its own** — a signed cookie holding more than one secret reports `rotating`, so `sessionMiddleware` moves its comparison to the wire bytes with nothing to remember: a cookie still signed with a retired secret is re-signed with the current one on the next request it makes, under both storages, and the retired secret can actually be dropped. Off rotation an unchanged session costs no HMAC.
- **Declared attribute repair** — `sessionMiddleware(storage, cookie, { reissue: true })` pushes changed cookie attributes (`Secure`, `SameSite`, `Path`, `Max-Age`) to clients holding a valid session, which is otherwise unreachable: a browser echoes only `name=value`, never attributes.
- **Typed session accessor** — `sessionCtx.get(context)` returns the current `Session` with no stringly-keyed context lookups.
- **Hardened signed cookies** — `createSignedCookie` always sets `httpOnly` and `secure`, HMAC-signs the value, and rejects weak secrets at construction time. Neither flag is an option, so neither can be relaxed by a mistyped config. The signing key is imported once per secret and cached for the isolate's life.
- **General-purpose cookies** — `createUnsignedCookie` for non-sensitive values (theme, locale) with the same parse/serialize surface.
- **Pluggable storage** — cookie-backed storage for stateless production sessions, in-memory storage for local development.
- **Flash messages** — `session.flash(key, value)` for one-request-only values.

> The session symbols in this namespace are re-exported from `@remix-run/session`; the cookies are forge's own. For exhaustive upstream session behaviour, consult the `@remix-run/session` documentation.

---

## Usage

A production session setup uses a signed cookie plus cookie-backed storage, registered once as app-level middleware.

```ts
import { sessionMiddleware, sessionCtx, createSignedCookie, createCookieSessionStorage } from "@y-core/forge/session";

// 1. Define a hardened, HMAC-signed session cookie.
const sessionCookie = createSignedCookie("__session", {
  secrets: [env.SESSION_SECRET], // at least 32 characters
  maxAge: 60 * 60 * 24 * 7, // 7 days
  sameSite: "Lax",
});

// 2. Choose a storage backend. Cookie storage keeps all session data in the cookie itself.
const storage = createCookieSessionStorage();

// 3. Register the middleware. It reads the session in and persists it out.
app.use("*", sessionMiddleware(storage, sessionCookie));
```

Inside a handler, read the session through its typed accessor and mutate it. Any mutation marks the session dirty, which triggers a `Set-Cookie` after the handler returns.

```ts
import { sessionCtx } from "@y-core/forge/session";

function loginHandler(context) {
  const session = sessionCtx.get(context);

  session.set("userId", user.id); // marks the session dirty → Set-Cookie written after the handler
  const userId = session.get("userId");

  if (!session.has("userId")) {
    // not logged in
  }

  session.unset("cart"); // remove a value
  session.destroy(); // clears the session and queues cookie removal
}
```

A plain, unsigned cookie for a non-sensitive value:

```ts
import { createUnsignedCookie } from "@y-core/forge/session";

const themeCookie = createUnsignedCookie("theme", {
  maxAge: 60 * 60 * 24 * 365, // 1 year
  sameSite: "Lax",
});

const theme = await themeCookie.parse(context.request.headers.get("cookie"));
const setCookie = await themeCookie.serialize("dark");
```

---

## Anonymous sessions — the standard pattern

For per-visitor persistence without accounts (settings, drafts, preferences), use `createAnonymousSession` with a KV binding. The cookie carries **only an opaque session id** (signed, `httpOnly`, `SameSite=Lax`); all session data lives server-side in KV under that id with a sliding TTL. Handlers persist state with plain `session.set(...)` — there is no manual id bookkeeping, no hand-rolled KV keying, and no per-isolate middleware caching to invent (the factory caches internally in a `WeakMap` keyed on **the `env` object itself**, the same scheme `csrfProtection` uses — one build per environment for the isolate's lifetime, and entries are collectable).

> Keying on `env` identity rather than on `(cookieName, secure, secret)` is load-bearing, not cosmetic: the cached middleware closes over the KV namespace returned by `options.kv(c)` for the request that built it. Two tenants sharing a cookie name, secure flag and secret hashed to one cache slot and therefore shared **one KV namespace** — tenant B reading and writing tenant A's sessions.

```ts
import { createAnonymousSession, sessionCtx } from "@y-core/forge/session";

// One registration — secrets and bindings resolve from the request env:
app.use(
  "*",
  createAnonymousSession<AppEnv>({
    cookieName: "app_session",
    secret: (c) => c.env.SESSION_SECRET, // ≥ 32 chars, enforced
    kv: (c) => c.env.SESSIONS_KV, // server-side session store
  }),
);

// In a handler — this is the entire persistence story:
const session = sessionCtx.get(c);
session.set("settings", validated.settings); // dirty → saved to KV, Set-Cookie (id only)
const settings = session.get("settings"); // read back on any later request
```

### Choosing the storage backend

|  | KV storage (`kv` given) | Cookie storage (`kv` omitted) |
| --- | --- | --- |
| Data location | Server-side (Workers KV) | Serialized into the cookie |
| Size limit | KV value limits (MBs) | ~4 KB total cookie budget |
| Client data exposure | None — opaque id only | Data rides on every request |
| Revocation | Delete the KV key | Impossible until cookie expiry |
| Extra infrastructure | One KV namespace | None |

Prefer KV storage for anything beyond a couple of tiny values. `createKVSessionStorage(kv, { prefix?, ttlSeconds? })` — where `prefix` defaults to `session` and an empty string is refused, because it would key every session under a bare `:id` — is also exported standalone for use with `sessionMiddleware` directly — it is the durable sibling of `createMemorySessionStorage` and follows the same storage contract (`read` never throws; `save` returns the id when dirty, `""` when destroyed, `null` when unchanged).

> The cookie is signed + `httpOnly` + `Secure` + `SameSite=Lax` in every configuration, with no option to relax any of them — see [`Secure` is not configurable](#secure-is-not-configurable).

---

## Core Components & APIs

### `sessionMiddleware(storage, cookie, options?)`

Forge-specific. Returns a middleware that reads the session cookie on the way in, exposes the resulting `Session` via `sessionCtx`, and persists it on the way out.

| Parameter | Type | Description |
| --- | --- | --- |
| `storage` | `SessionStorage` | The storage backend that reads/saves session data. |
| `cookie` | `SignedCookie \| UnsignedCookie` | The cookie used to parse the incoming session and serialize the outgoing one. Use `createSignedCookie` in production. |
| `options.reissue` | `boolean` | Optional, default `false`. Re-issues the cookie on every request that carries one — see “Repairing attribute drift” below. |
| `options.rotating` | `boolean` | Optional. Defaults to the cookie's own `rotating`, i.e. whether it holds more than one secret — see “Strong, rotatable secrets” below. Pass `false` to suppress the re-signing while keeping a retired secret in the array. |

The middleware writes to storage only when the session was modified or destroyed. It then compares the value it would write — the saved one, or the value the request already carried — against the value the request carried, and emits nothing when they match. The serialized cookie is queued on the per-request pending-header channel and flushed by the app's single `applyHeaders` pass, not by rebuilding the response in this middleware.

> **The payload decides, except under rotation, where the wire bytes do.** HMAC is deterministic, so an unchanged payload re-signs to exactly the bytes the client already holds — unless the signing secret moved. The signature is therefore worth computing only to tell a current secret from a retired one, which cannot arise unless a rotation is in flight. Off rotation an unchanged session costs no HMAC at all; under rotation the middleware re-signs and compares the bytes, so a cookie still carrying the old signature is re-issued with the new one, on any request it makes, under either storage — including a request that touches nothing. A cookie that fails to parse — tampered, or signed with a secret no longer in the array — is never re-signed back into validity, with or without `rotating`.

> **An observed id is persisted, unless the cookie already carries it.** Reading `session.id` marks the session dirty when the value the client presented would not reproduce that id — a first visit, or a record the storage no longer holds. Without that, a CSRF subject bound to `sessionCtx.getOptional(c)?.id` would mint a token under a throwaway id that no cookie carried forward, and every anonymous mutation would answer 403. Where the cookie _is_ the id and the storage restored it, nothing needs writing, so a request that only reads the id emits no `Set-Cookie` and re-writes no record.

> **Sliding expiry:** callers that rely on a sliding session window must change the session each request — `session.set(...)`, or `reissue: true`. Neither reading `session.id` nor re-serializing an unchanged session emits a cookie on its own, so nothing re-arms `Max-Age`.

> **Cost:** the key is imported once per secret per isolate, so the steady state is one `verify`, from the incoming `parse` alone. A rotation adds one `sign` per request carrying an unchanged session — the work that completes the rotation, lasting only as long as the rotation does.

```ts
app.use("*", sessionMiddleware(storage, sessionCookie));
```

#### Repairing attribute drift

A browser echoes only `name=value`; it never tells the server which attributes the cookie it holds was set with. Tightening `sameSite`, adding `Secure`, or changing `Path`/`maxAge` therefore reaches only clients whose session changes — a client holding a valid, unchanged session keeps the old attributes until the cookie expires. This is not detectable, only declarable:

```ts
app.use("*", sessionMiddleware(storage, sessionCookie, { reissue: true }));
```

With `reissue`, every request that carries a parseable, non-empty session cookie gets a fresh `Set-Cookie`, so the new attributes land. It also re-arms `Max-Age` on every request, and it makes every such response uncacheable — set it for the deploy window that pushes the change, then take it back out. A request carrying no session cookie still emits nothing.

### `sessionCtx`

Forge-specific. A typed context accessor (`contextVar<Session>`) for the session set by `sessionMiddleware`.

```ts
const session = sessionCtx.get(context); // throws if sessionMiddleware did not run
const maybe = sessionCtx.getOptional(context); // Session | undefined
```

Register `sessionMiddleware` before any handler that calls `sessionCtx.get` — the accessor throws if the session was never set.

### `createSignedCookie(name, options)`

Forge-specific. Creates a `SignedCookie` that always enforces `httpOnly: true` and `secure: true`, HMAC-signs the value with the provided secrets, and defaults `sameSite` to `"Lax"`. Use this for any sensitive cookie — sessions, auth tokens.

| Parameter | Type | Description |
| --- | --- | --- |
| `name` | `string` | The cookie name (e.g. `"__session"`). |
| `options.secrets` | `[string, ...string[]]` | One or more signing secrets, **each at least 32 characters**. The first signs new cookies; the rest verify older ones (rotation). |
| `options.sameSite` | `"Strict" \| "Lax"` | Optional. `SameSite` policy. Defaults to `"Lax"`. `"None"` is not allowed. |
| `options.maxAge`, `options.path`, `options.domain`, `options.expires`, `options.partitioned` | `CookieAttributes` | Standard cookie attributes; `httpOnly` and `secure` are fixed by this factory. |

```ts
const sessionCookie = createSignedCookie("__session", {
  secrets: [env.SESSION_SECRET_CURRENT, env.SESSION_SECRET_PREVIOUS],
  maxAge: 60 * 60 * 24 * 7,
});
```

`createSignedCookie` **throws** if any secret is shorter than 32 characters — weak secrets are rejected at construction, not silently accepted.

### `createCookieSessionStorage()`

Re-export from `@remix-run/session`. Creates a `SessionStorage` that serializes all session data into the session cookie itself — no server-side state. Suitable for production Workers. Session data is bounded by the browser cookie size limit (typically ~4 KB), so keep stored data small.

```ts
const storage = createCookieSessionStorage();
app.use("*", sessionMiddleware(storage, sessionCookie));
```

> The cookie used to carry the data is the one you pass to `sessionMiddleware`. Pair `createCookieSessionStorage()` with `createSignedCookie` so the serialized session payload is HMAC-signed and tamper-evident.

### `createMemorySessionStorage()`

Re-export from `@remix-run/session`. Creates a `SessionStorage` that keeps session data in process memory.

> **Development only.** Cloudflare Workers are stateless and may run across many isolates, so in-memory sessions do not persist across requests or instances in production. Use `createCookieSessionStorage()` for deployed Workers.

### `Session`

Re-export from `@remix-run/session`. The per-user data container returned by `sessionCtx.get`.

| Member | Signature | Description |
| --- | --- | --- |
| `get` | `get(key): value \| undefined` | Read a value (checks both regular and flash data). |
| `set` | `set(key, value): void` | Write a value; marks the session dirty. Passing `null`/`undefined` removes the key. |
| `unset` | `unset(key): void` | Remove a value; marks the session dirty. |
| `has` | `has(key): boolean` | Whether a value is stored for the key. |
| `flash` | `flash(key, value): void` | Store a value available only on the **next** request, then cleared. |
| `destroy` | `destroy(): void` | Mark the session destroyed; blocks further mutation and queues cookie removal. |
| `regenerateId` | `regenerateId(keepData?: boolean): void` | Issue a fresh session id, marking the session dirty so a new `Set-Cookie` is written. Call it after any privilege escalation — see “Session fixation” below. `auth`'s `establishAuthSession` and `clearAuthSession` both call it, so a custom `SessionStorage` that omits it breaks sign-in. |
| `data` | `SessionData` | Raw `[values, flash]` tuple for storage. Use `get` for normal reads. |
| `id` | `string` | The session identifier. |
| `dirty` | `boolean` | Whether the session was modified. |
| `destroyed` | `boolean` | Whether the session was destroyed. |

```ts
const session = sessionCtx.get(context);
session.flash("notice", "Saved!"); // shown once, on the next request
const notice = session.get("notice");
```

### `createUnsignedCookie(name, options?)`

Forge-specific. Creates an `UnsignedCookie` — the same `parse` / `serialize` surface, with the value base64-encoded on the wire but carrying no authentication.

```ts
const cookie = createUnsignedCookie("locale", { maxAge: 60 * 60 * 24 * 365 });
const value = await cookie.parse(context.request.headers.get("cookie")); // string | null
const header = await cookie.serialize("en-GB"); // Set-Cookie value
```

Use it for non-sensitive values. For anything a client must not forge, use `createSignedCookie`.

`parse` never throws: a missing header, an absent name, malformed base64 and malformed UTF-8 all answer `null`. `serialize` throws only on a value containing a lone surrogate, which UTF-8 cannot represent and which would therefore not survive a round trip.

### Additional re-exports

| Export | Source | Purpose |
| --- | --- | --- |
| `createSession` | `@remix-run/session` | Construct a `Session` directly (advanced/test use). |
| `createSessionId` | `@remix-run/session` | Generate a cryptographically secure session ID (`crypto.randomUUID`). |

### Types

| Type | Shape / purpose |
| --- | --- |
| `SignedCookie` | `{ name, rotating, parse, serialize }` — `rotating` is true while more than one secret is held. |
| `UnsignedCookie` | `{ name, parse, serialize }` — what `SignedCookie` extends. |
| `CookieAttributes` | The `Set-Cookie` attributes — `domain?`, `expires?`, `httpOnly?`, `maxAge?`, `partitioned?`, `path?`, `sameSite?`, `secure?` — as construction defaults or as a per-call override on `serialize`. |
| `SignedCookieOptions` | `CookieAttributes` minus `httpOnly` and `secure`, plus a required `secrets: [string, ...string[]]` and a `sameSite?: "Strict" \| "Lax"`. |
| `UnsignedCookieOptions` | `CookieAttributes`, unchanged. |
| `SessionCookieOptions` | `sessionMiddleware`'s third argument — `{ reissue?, rotating? }`: the declared repair for cookie attribute drift, and an override for the rotation the cookie already reports. |
| `AnonymousSessionOptions` | `createAnonymousSession`'s options — `secret` (required resolver, a string or a rotation array), `cookieName?`, `kv?`, `maxAge?`, and everything `KVSessionStorageOptions` and `SessionCookieOptions` carry. |
| `KVSessionStorageOptions` | `{ prefix?, ttlSeconds? }` — the key prefix (`${prefix}:${session.id}`) and the sliding TTL refreshed on every save. |
| `SessionKVBinding` | The minimal structural KV surface the session store calls (`get` / `put` / `delete`); any Workers `KVNamespace` satisfies it. |
| `SessionStorage` | The `{ read, save }` storage interface — implement it to back sessions with a custom store. |

---

## Security

This namespace handles cookies and session state. Session and cookie management is deliberately **out of scope for `@y-core/forge/security`**, which covers transport-layer hardening only — the split is [`NAMESPACES.md`](../../docs/NAMESPACES.md) §5a's, and the boundary behind it [`BOUNDARIES.md`](../../warden/canon/libs/BOUNDARIES.md) §2's.

Bind CSRF tokens to the session id so a token minted in one browser cannot be replayed from another: wire `sessionCtx` into `csrfProtection`'s `subject` resolver, registering `sessionMiddleware` first. The pattern is [src/form/README.md](../form/README.md)'s.

### Always sign and harden session cookies

Use `createSignedCookie` for the session cookie, never `createUnsignedCookie`. `createSignedCookie` guarantees three properties that protect the session:

| Property | Effect |
| --- | --- |
| `httpOnly: true` | The cookie is not readable from JavaScript, mitigating session theft via XSS. |
| `secure: true` | Hardcoded; the cookie is only sent over HTTPS, preventing interception in transit. |
| HMAC signature | The cookie value is signed with the configured secrets, so a tampered value is rejected on parse. |

### `Secure` is not configurable

`createSignedCookie` hardcodes `Secure`, and `createAnonymousSession` takes no `secure` option.
There is nothing to set, so there is nothing to get wrong — which matters because a session cookie
that loses `Secure` fails silently in every way that would otherwise catch it: no test goes red,
nothing is logged, the header is one word shorter, and anyone on the path reads the cookie and
replays the session.

The option this replaced existed for plain-http development, and the posture it served is the one
[`WORKERS_PLATFORM.md`](../../warden/canon/apps/WORKERS_PLATFORM.md) §4e rules out:

> **`upgrade-insecure-requests`, HSTS, and `Secure` cookies stay hardcoded.** They are not made
> conditional on the environment, because under this posture they are correct in development by
> construction.

**Development is https at every hop** — the TLS-terminating proxy's origin in a container, or the
loopback https port for a browser suite. Under that posture `Secure` is already correct locally, and
an option to relax it buys nothing a correct dev transport does not already give. If a local server
cannot hold a session, the fix is its transport, not the cookie.

> An in-process test harness never needed the option either: `Secure` is enforced by a **browser**
> deciding whether to send a cookie back over http, and `app.request(...)` has no browser in it.

### Strong, rotatable secrets

Each secret passed to `createSignedCookie` must be at least 32 characters — the factory throws otherwise. Source secrets from Worker bindings (`env.SESSION_SECRET`), never hardcode them.

A rotation is two deploys, and the upgrade in between happens on its own:

1. **Prepend the new secret.** The first element signs; the rest only verify, so existing cookies keep working. There is nothing else to set: the cookie reports `rotating` from its own array.

   ```ts
   const cookie = createSignedCookie("__session", { secrets: [env.SESSION_SECRET_NEW, env.SESSION_SECRET_OLD] });
   app.use("*", sessionMiddleware(storage, cookie));
   ```

   From here on, `sessionMiddleware` re-signs each still-old cookie with the new secret on the next request that carries it, because its byte comparison sees the old signature. A session that is never used again is never upgraded, so leave this deploy in place for at least the cookie's `maxAge`.

   > **Suppressing it is the deliberate act, not enabling it.** `{ rotating: false }` makes the middleware compare payloads only, which cannot see a signature at all — the old cookies keep verifying and are never upgraded, so step 2 would sign every remaining holder out. Pass it only to stop paying the re-signing for a retired secret you are keeping in the array long-term.

2. **Drop the old secret.** Any cookie still carrying the old signature now fails to parse and its holder starts a fresh session — which after a full `maxAge` is only a client that was inactive for the whole window.

   ```ts
   const cookie = createSignedCookie("__session", { secrets: [env.SESSION_SECRET_NEW] });
   app.use("*", sessionMiddleware(storage, cookie));
   ```

`createAnonymousSession` takes the same array from its `secret` resolver — `secret: (c) => [c.env.SESSION_SECRET_NEW, c.env.SESSION_SECRET_OLD]` — and each element is length-checked individually.

> The resolver is called once per isolate, not per request: the built middleware is cached on the `env` object's identity. A secret change ships as a deploy, which starts fresh isolates, so this only means a rotation is picked up when the isolate is, not mid-life.

### `SameSite` and CSRF

`createSignedCookie` defaults `sameSite` to `"Lax"` and accepts only `"Strict"` or `"Lax"` — `"None"` is rejected by the type, so a session cookie cannot be sent on cross-site requests. `SameSite` is a defense-in-depth layer, not a complete CSRF defense: pair it with CSRF token verification from `@y-core/forge/form` (`csrfProtection`) on state-changing routes.

### Privilege changes

After a login or other privilege escalation, regenerate the session ID (`session.regenerateId()`) to prevent session fixation. Regeneration marks the session dirty, so a fresh `Set-Cookie` is written by `sessionMiddleware`.

### Cookie-storage payload size

`createCookieSessionStorage()` serializes the full session into the cookie, so signing prevents tampering but not reading. Store an opaque user id rather than a user object — or reach for `createKVSessionStorage`, where the cookie carries only the id and a session is revocable by deleting its record.

---

## Advanced

### Custom storage backends

Any object implementing `SessionStorage` can back `sessionMiddleware`. `read(cookie)` returns a `Session` for the incoming cookie value (or a fresh session when `cookie` is `null`); `save(session)` returns the cookie value to serialize, or `null` to write no cookie. Use this to back sessions with KV or D1 instead of the cookie itself:

```ts
import { type SessionStorage, createSession } from "@y-core/forge/session";

function createKvSessionStorage(kv: KVNamespace): SessionStorage {
  return {
    async read(id) {
      if (!id) return createSession();
      const data = await kv.get(id, "json");
      return createSession(id, data ?? undefined);
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

With a server-side store the cookie carries only the session ID, so it stays small and the session payload never leaves the server.

### Flash messages

`session.flash(key, value)` stores a value that is readable on the next request and then cleared automatically. It is the standard pattern for one-time notices across a redirect (e.g. "Profile saved"). Flashing marks the session dirty, so the value is persisted, surfaced once, and removed on the following save.
