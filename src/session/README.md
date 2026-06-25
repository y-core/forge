# `@y-core/forge/session`

Session management and cookie primitives for Cloudflare Workers. This namespace combines a curated re-export of the `@remix-run/cookie` and `@remix-run/session` surface with two forge-specific additions: `sessionMiddleware` (a request/response session lifecycle middleware that avoids cache-defeating cookie writes) and `createSignedCookie` (a hardened cookie constructor that enforces `httpOnly`, `secure`, and HMAC signing).

```typescript
import {
  sessionMiddleware,
  sessionCtx,
  createSignedCookie,
  createCookieSessionStorage,
  createCookie,
} from "@y-core/forge/session";
```

---

## Features

- **Cookie-backed sessions** with a single middleware that reads on the way in and persists on the way out.
- **Cache-friendly persistence** — `sessionMiddleware` emits a `Set-Cookie` **only** when the session is modified or destroyed. Unchanged requests stay cacheable.
- **Typed session accessor** — `sessionCtx.get(context)` returns the current `Session` with no stringly-keyed context lookups.
- **Hardened signed cookies** — `createSignedCookie` always sets `httpOnly` and `secure`, HMAC-signs the value, and rejects weak secrets at construction time.
- **General-purpose cookies** — `createCookie`/`Cookie` for non-sensitive values (theme, locale) with parse/serialize support.
- **Pluggable storage** — cookie-backed storage for stateless production sessions, in-memory storage for local development.
- **Flash messages** — `session.flash(key, value)` for one-request-only values.

> Most symbols in this namespace are re-exported from `@remix-run/cookie` and `@remix-run/session`. This document covers the curated forge surface and the forge-specific additions. For exhaustive upstream behaviour, consult the `@remix-run/session` and `@remix-run/cookie` documentation.

---

## Usage

A production session setup uses a signed cookie plus cookie-backed storage, registered once as app-level middleware.

```typescript
import {
  sessionMiddleware,
  sessionCtx,
  createSignedCookie,
  createCookieSessionStorage,
} from "@y-core/forge/session";

// 1. Define a hardened, HMAC-signed session cookie.
const sessionCookie = createSignedCookie("__session", {
  secrets: [env.SESSION_SECRET],     // at least 32 characters
  maxAge: 60 * 60 * 24 * 7,          // 7 days
  sameSite: "Lax",
});

// 2. Choose a storage backend. Cookie storage keeps all session data in the cookie itself.
const storage = createCookieSessionStorage();

// 3. Register the middleware. It reads the session in and persists it out.
app.use("*", sessionMiddleware(storage, sessionCookie));
```

Inside a handler, read the session through its typed accessor and mutate it. Any mutation marks the session dirty, which triggers a `Set-Cookie` after the handler returns.

```typescript
import { sessionCtx } from "@y-core/forge/session";

function loginHandler(context) {
  const session = sessionCtx.get(context);

  session.set("userId", user.id);    // marks the session dirty → Set-Cookie written after the handler
  const userId = session.get("userId");

  if (!session.has("userId")) {
    // not logged in
  }

  session.unset("cart");             // remove a value
  session.destroy();                 // clears the session and queues cookie removal
}
```

A plain, unsigned cookie for a non-sensitive value:

```typescript
import { createCookie } from "@y-core/forge/session";

const themeCookie = createCookie("theme", {
  maxAge: 60 * 60 * 24 * 365,        // 1 year
  sameSite: "Lax",
});

const theme = await themeCookie.parse(context.request.headers.get("cookie"));
const setCookie = await themeCookie.serialize("dark");
```

---

## Core Components & APIs

### `sessionMiddleware(storage, cookie)`

Forge-specific. Returns a middleware that reads the session cookie on the way in, exposes the resulting `Session` via `sessionCtx`, and persists it on the way out.

| Parameter | Type | Description |
|---|---|---|
| `storage` | `SessionStorage` | The storage backend that reads/saves session data. |
| `cookie` | `Cookie` | The cookie used to parse the incoming session and serialize the outgoing one. Use `createSignedCookie` in production. |

The middleware skips persistence entirely when the session was **neither modified nor destroyed**, so a `Set-Cookie` header is written only when needed. The serialized cookie is queued on the per-request pending-header channel and flushed by the app's single `applyHeaders` pass, not by rebuilding the response in this middleware.

> **Sliding expiry:** because unchanged sessions are not re-saved, callers that rely on a sliding session window must touch the session each request (e.g. `session.set(...)`) to mark it dirty and force a refreshed `Set-Cookie`.

```typescript
app.use("*", sessionMiddleware(storage, sessionCookie));
```

### `sessionCtx`

Forge-specific. A typed context accessor (`contextVar<Session>`) for the session set by `sessionMiddleware`.

```typescript
const session = sessionCtx.get(context);          // throws if sessionMiddleware did not run
const maybe = sessionCtx.getOptional(context);    // Session | undefined
```

Register `sessionMiddleware` before any handler that calls `sessionCtx.get` — the accessor throws if the session was never set.

### `createSignedCookie(name, options)`

Forge-specific. Creates a `Cookie` that always enforces `httpOnly: true` and `secure: true`, HMAC-signs the value with the provided secrets, and defaults `sameSite` to `"Lax"`. Use this for any sensitive cookie — sessions, auth tokens.

| Parameter | Type | Description |
|---|---|---|
| `name` | `string` | The cookie name (e.g. `"__session"`). |
| `options.secrets` | `[string, ...string[]]` | One or more signing secrets, **each at least 32 characters**. The first signs new cookies; the rest verify older ones (rotation). |
| `options.sameSite` | `"Strict" \| "Lax"` | Optional. `SameSite` policy. Defaults to `"Lax"`. `"None"` is not allowed. |
| `options.maxAge`, `options.path`, `options.domain`, `options.expires`, … | `CookieOptions` | Standard cookie options, except `httpOnly`, `secure`, and `secrets` handling is fixed by this factory. |

```typescript
const sessionCookie = createSignedCookie("__session", {
  secrets: [env.SESSION_SECRET_CURRENT, env.SESSION_SECRET_PREVIOUS],
  maxAge: 60 * 60 * 24 * 7,
});
```

`createSignedCookie` **throws** if any secret is shorter than 32 characters — weak secrets are rejected at construction, not silently accepted.

### `createCookieSessionStorage()`

Re-export from `@remix-run/session`. Creates a `SessionStorage` that serializes all session data into the session cookie itself — no server-side state. Suitable for production Workers. Session data is bounded by the browser cookie size limit (typically ~4 KB), so keep stored data small.

```typescript
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
|---|---|---|
| `get` | `get(key): value \| undefined` | Read a value (checks both regular and flash data). |
| `set` | `set(key, value): void` | Write a value; marks the session dirty. Passing `null`/`undefined` removes the key. |
| `unset` | `unset(key): void` | Remove a value; marks the session dirty. |
| `has` | `has(key): boolean` | Whether a value is stored for the key. |
| `flash` | `flash(key, value): void` | Store a value available only on the **next** request, then cleared. |
| `destroy` | `destroy(): void` | Mark the session destroyed; blocks further mutation and queues cookie removal. |
| `data` | `SessionData` | Raw `[values, flash]` tuple for storage. Use `get` for normal reads. |
| `id` | `string` | The session identifier. |
| `dirty` | `boolean` | Whether the session was modified. |
| `destroyed` | `boolean` | Whether the session was destroyed. |

```typescript
const session = sessionCtx.get(context);
session.flash("notice", "Saved!");   // shown once, on the next request
const notice = session.get("notice");
```

### `Cookie` / `createCookie(name, options)`

Re-exports from `@remix-run/cookie`. The general-purpose cookie type and its factory, with `parse` and `serialize` support and optional signing via `secrets`.

```typescript
const cookie = createCookie("locale", { maxAge: 60 * 60 * 24 * 365 });
const value = await cookie.parse(context.request.headers.get("cookie")); // string | null
const header = await cookie.serialize("en-GB");                          // Set-Cookie value
```

Use `createCookie` for non-sensitive values. For sensitive cookies, use `createSignedCookie`, which enforces the secure defaults `createCookie` leaves optional.

### Additional re-exports

| Export | Source | Purpose |
|---|---|---|
| `createSession` | `@remix-run/session` | Construct a `Session` directly (advanced/test use). |
| `createSessionId` | `@remix-run/session` | Generate a cryptographically secure session ID (`crypto.randomUUID`). |
| `SessionStorage` (type) | `@remix-run/session` | The `{ read, save }` storage interface — implement to back sessions with a custom store. |
| `CookieOptions` (type) | `@remix-run/cookie` | Options accepted by `createCookie`. |

---

## Security

This namespace handles cookies and session state. Session and cookie management is deliberately **out of scope for `@y-core/forge/security`**, which covers transport-layer hardening only — these primitives live here instead.

### Always sign and harden session cookies

Use `createSignedCookie` for the session cookie, never a plain `createCookie`. `createSignedCookie` guarantees three properties that protect the session:

| Property | Effect |
|---|---|
| `httpOnly: true` | The cookie is not readable from JavaScript, mitigating session theft via XSS. |
| `secure: true` | The cookie is only sent over HTTPS, preventing interception in transit. |
| HMAC signature | The cookie value is signed with the configured secrets, so a tampered value is rejected on parse. |

### Strong, rotatable secrets

Each secret passed to `createSignedCookie` must be at least 32 characters — the factory throws otherwise. Source secrets from Worker bindings (`env.SESSION_SECRET`), never hardcode them. To rotate, prepend the new secret; older secrets remain in the array so existing cookies still verify:

```typescript
createSignedCookie("__session", {
  secrets: [env.SESSION_SECRET_NEW, env.SESSION_SECRET_OLD],
});
```

### `SameSite` and CSRF

`createSignedCookie` defaults `sameSite` to `"Lax"` and accepts only `"Strict"` or `"Lax"` — `"None"` is rejected by the type, so a session cookie cannot be sent on cross-site requests. `SameSite` is a defense-in-depth layer, not a complete CSRF defense: pair it with CSRF token verification from `@y-core/forge/form` (`csrfProtection`) on state-changing routes.

### Privilege changes

After a login or other privilege escalation, regenerate the session ID (`session.regenerateId()`) to prevent session fixation. Regeneration marks the session dirty, so a fresh `Set-Cookie` is written by `sessionMiddleware`.

### Cookie-storage payload size

`createCookieSessionStorage()` serializes the full session into the cookie. Keep stored data minimal — store an opaque user ID, not user objects — both to stay under the ~4 KB cookie limit and to avoid placing sensitive data on the client even when signed (signing prevents tampering, not reading once `httpOnly` is bypassed by a non-browser client).

---

## Advanced

### Cache-safe persistence model

`sessionMiddleware` writes a `Set-Cookie` header only when `session.dirty || session.destroyed`. A request that reads the session but never mutates it returns with no `Set-Cookie`, so downstream and edge caches are not defeated by a per-request cookie write. This is the intended behaviour for read-only pages.

The trade-off is sliding expiry: an idle session is not re-saved, so its `maxAge` is not refreshed on read-only requests. To implement sliding expiry, touch the session on each request you want to extend (for example `session.set("lastSeen", Date.now())`), which marks it dirty and forces a refreshed cookie.

### Custom storage backends

Any object implementing `SessionStorage` can back `sessionMiddleware`. `read(cookie)` returns a `Session` for the incoming cookie value (or a fresh session when `cookie` is `null`); `save(session)` returns the cookie value to serialize, or `null` to write no cookie. Use this to back sessions with KV or D1 instead of the cookie itself:

```typescript
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
