---
title: Storage Bindings
description: "Cloudflare Workers bindings, D1 database, KV namespace, R2 object storage, createD1Client, sql tagged template, createKVStore, jsonCodec, textCodec, createObjectStore, serveObject, signed URLs, binding validation, resolveD1Client, validateD1Binding, graceful dev degradation"
weight: 28
---

# Storage Bindings

> Authoritative source for forge's three storage namespaces: D1 (SQL database),
> KV (key-value store), and R2 (object storage). Covers binding resolution, typed
> clients, and graceful development degradation.
>
> Complements [LIBRARY_ARCHITECTURE.md](./LIBRARY_ARCHITECTURE.md) (runtime model),
> [PRODUCTION_TS_RULES.md](./PRODUCTION_TS_RULES.md) (factory patterns).

---

## 0. Quick Reference

- §1 storage/db: createD1Client, sql tagged template, resolveD1Client, validateD1Binding
- §2 storage/kv: createKVStore, codecs (json/text/bytes), resolveKVStore, validateKVBinding
- §3 storage/r2: createObjectStore, serveObject, signed URLs, r2Backend
- §4 Binding resolve/validate pattern: validateXBinding middleware vs resolveX resolver
- §5 Dev degradation: handling absent bindings in local dev

---

## 1. storage/db — D1 Database Client

### 1a. createD1Client Factory

`createD1Client` wraps a raw `D1Database` binding with a typed, opinionated client.
Pass the binding directly from `c.env` and an optional options object.

```typescript
import { createD1Client, type D1ClientOptions } from "@y-core/forge/storage/db"

const db = createD1Client(c.env.DB, { logQueries: debug })
// db: D1Client — typed wrapper around Cloudflare D1Database
```

`D1ClientOptions`:

| Option | Type | Default | Purpose |
|---|---|---|---|
| `logQueries` | `boolean` | `false` | Log every prepared query |

### 1b. sql Tagged Template for Queries

The `sql` tag produces a `SqlFragment`: an object holding the parameterized query
string and its bound values. This is the only safe way to build D1 queries — never
use string concatenation.

```typescript
import { sql, isSqlFragment } from "@y-core/forge/storage/db"

const query = sql`SELECT * FROM users WHERE id = ${userId}`
// sql returns a SqlFragment — parameterized, injection-safe
const rows = await db.query(query)   // D1Client.query/queryOne/execute/batch accept SqlFragment only
```

`isSqlFragment(value)` is a type-guard that confirms a value is a `SqlFragment`,
useful when writing generic query helpers that must reject raw strings.

### 1c. resolveD1Client — From the Request Context

`resolveD1Client` reads the binding out of the current request context inside a
handler or middleware rather than requiring the caller to pass the binding
reference directly. Provide a `binding` selector that picks the binding off
`c.env`; the resolver builds the typed `D1Client` for you.

```typescript
import { resolveD1Client } from "@y-core/forge/storage/db"

const db = resolveD1Client(c, { binding: (c) => c.env.DB })  // resolves from context
```

By default the resolver throws a descriptive error when the binding is absent so
misconfiguration surfaces immediately at request time rather than as a
null-dereference later. Pass `required: false` to receive `null` instead when the
binding is optional in development.

### 1d. validateD1Binding — Binding Validation Middleware

`validateD1Binding(name)` returns a `Middleware` that validates the named binding
on the first request (and again whenever the env reference changes). It performs
a functional shape check — not mere presence — confirming the bound value is an
object whose `prepare` is a function, so a stray string or number bound to the
name is rejected. On failure it throws a descriptive error; otherwise it calls
`next()`.

```typescript
import { validateD1Binding } from "@y-core/forge/storage/db"

app.use("*", validateD1Binding("DB"))  // shape-validates env.DB before handlers run
```

Register it with `app.use(...)` so the check runs once per env before any route
handler executes and fails fast on a missing or mis-shaped binding. See §4b for
composing checks across several namespaces.

---

## 2. storage/kv — KV Store

### 2a. createKVStore Factory

`createKVStore` wraps a raw `KVNamespace` with a typed, codec-aware store.
The generic parameter `T` flows through all get/put/list operations.

```typescript
import { createKVStore, jsonCodec } from "@y-core/forge/storage/kv"

const store = createKVStore(c.env.LOGS_KV, { codec: jsonCodec<LogRecord>() })
// store: KVStore<LogRecord> — typed, codec-aware
```

The `codec` option is required — select the codec that matches the value format
already stored in the namespace (or the format you intend to write).

### 2b. Codecs — jsonCodec, textCodec, bytesCodec

A codec is a `{ encode, decode }` pair that maps between the wire format KV
stores (string or `ArrayBuffer`) and the application's TypeScript type.

```typescript
import { jsonCodec, textCodec, bytesCodec } from "@y-core/forge/storage/kv"

jsonCodec<T>()   // serializes/deserializes JSON — most common
textCodec()      // raw string values
bytesCodec()     // Uint8Array values for binary data
```

Codec selection rules:

- Use `jsonCodec` for structured records, arrays, or any typed data.
- Use `textCodec` for plain strings (tokens, slugs, flags).
- Use `bytesCodec` when writing binary blobs that must remain unmodified.

### 2c. KVStore Operations

All operations are `async` and return `Promise`-wrapped values. The type
parameter propagates through `get` and `list` results.

```typescript
await store.get(key)                     // returns T | null
await store.put(key, value, options?)    // options: { expirationTtl?: number }
await store.delete(key)
await store.list(options?)               // returns KVListResult<T>
```

`expirationTtl` is in seconds. KV enforces a minimum TTL of 60 seconds — values
with shorter TTLs are rejected by the platform.

### 2d. resolveKVStore and validateKVBinding

Mirror the D1 pattern (§1c, §1d) for KV bindings. `resolveKVStore(c, opts)` reads
the binding from the request context via a `binding` selector; pass `store` codec
options so the returned store is immediately typed. `validateKVBinding(name)`
returns a `Middleware` that shape-validates the binding (the bound value must be
an object whose `get` and `put` are functions) on the first request.

```typescript
import { resolveKVStore, validateKVBinding } from "@y-core/forge/storage/kv"

app.use("*", validateKVBinding("LOGS_KV"))  // shape check: typeof binding.get/put === "function"

// inside a handler:
const store = resolveKVStore(c, {
    binding: (c) => c.env.LOGS_KV,
    store: { codec: jsonCodec() },
})
```

---

## 3. storage/r2 — Object Store

### 3a. createObjectStore Factory

`createObjectStore` wraps an `ObjectStorageBackend` (not a raw `R2Bucket`). Adapt
an R2 bucket with `r2Backend(bucket)` first (see §3d). The returned `ObjectStore`
exposes a consistent interface for get/put/head/list/delete operations with typed
metadata, plus a bound `serveObject` convenience.

```typescript
import { createObjectStore, r2Backend } from "@y-core/forge/storage/r2"

const store = createObjectStore(r2Backend(c.env.ASSETS_BUCKET))
// store: ObjectStore — typed wrapper around an ObjectStorageBackend
```

### 3b. serveObject — Direct Response from a Backend

`serveObject(backend, request, key, options?)` retrieves an object from an
`ObjectStorageBackend` and returns a fully-formed `Response` ready to return from
a handler. It always returns a `Response`: 200 with the body, 206 for a satisfied
`Range`, 304 for a matching `If-None-Match`, 404 when the object is absent, or 416
for an unsatisfiable range. It sets `Content-Type`, `ETag`, `Accept-Ranges`,
`Content-Length`, and `Cache-Control`.

```typescript
import { serveObject, r2Backend } from "@y-core/forge/storage/r2"

const backend = r2Backend(c.env.ASSETS_BUCKET)
return serveObject(backend, c.request, key, {
    cacheControl: "public, max-age=3600",
    contentDisposition: "attachment",
})
```

`ServeOptions` accepts `cacheControl` (overrides the object's stored value) and
`contentDisposition` (`"inline" | "attachment"`). When a disposition is set, the
`Content-Disposition` header carries an RFC 5987 `filename*=UTF-8''…` parameter
for the UTF-8 name plus a sanitized ASCII `filename="…"` fallback — the fallback
strips quotes, backslashes, and control characters so the filename cannot break
out of the quoted string. No `null` check is needed: a missing object yields a
404 `Response`, never an unhandled rejection. `ObjectStore` exposes the same
behavior as a bound method: `store.serveObject(c.request, key, options?)`.

### 3c. Signed URLs for Secure Object Access

`createSignedObjectUrl(signingKey, baseUrl, objectKey, options?)` produces an
HMAC-SHA-256-signed URL that expires after `expiresInSeconds` (default `3600`).
It appends `?key=`, `?exp=`, and `?sig=` to `baseUrl`. Import the signing key once
(per worker startup or request) using `importSigningKey`.

```typescript
import { createSignedObjectUrl, importSigningKey, verifySignedObjectUrl } from "@y-core/forge/storage/r2"

const signingKey = await importSigningKey(hexSecret)
const signedUrl = await createSignedObjectUrl(signingKey, baseUrl, objectKey, {
    expiresInSeconds: 3600,
})
```

The HMAC is computed over a length-prefixed payload — `${key.length}:${key}|${exp}` —
so the `key`/`exp` boundary stays unambiguous even when the object key itself
contains the `|` delimiter (defense-in-depth against a crafted key). The receiving
route verifies with `verifySignedObjectUrl(signingKey, url)`, which checks expiry
first and then performs a constant-time HMAC comparison, returning
`{ ok: true, key }` or `{ ok: false, reason }` (`"expired" | "invalid-signature" | "invalid-format"`).

`hexSecret` must come from a secret binding (`c.env.SIGNING_SECRET`), never from
source code. Do not serve objects from a signed URL path without verifying the
signature first.

### 3d. r2Backend — Storage Backend Adapter

`r2Backend(bucket)` adapts a Cloudflare `R2Bucket` into an `ObjectStorageBackend`
— the abstraction every R2 helper consumes. Pass the result as the first argument
to `createObjectStore` or `serveObject`; both accept a backend rather than a raw
bucket, which keeps the storage layer testable against an in-memory backend.

```typescript
import { r2Backend, createObjectStore } from "@y-core/forge/storage/r2"

const store = createObjectStore(r2Backend(c.env.ASSETS_BUCKET), {
    prefix: "uploads",
})
```

### 3e. Binding Validation for R2

`validateR2Binding(name)` (a `Middleware`) and `resolveObjectStore(c, opts)`
follow the same pattern as D1 (§1c, §1d) and KV (§2d). The validation middleware
shape-checks the binding (the bound value must be an object whose `get` and `put`
are functions); the resolver wraps the bucket with `r2Backend` for you.

```typescript
import { validateR2Binding, resolveObjectStore } from "@y-core/forge/storage/r2"

app.use("*", validateR2Binding("ASSETS_BUCKET"))  // shape check: typeof binding.get/put === "function"

// inside a handler:
const store = resolveObjectStore(c, { binding: (c) => c.env.ASSETS_BUCKET })
```

---

## 4. Binding Resolve/Validate Pattern

### 4a. Two-Function Pattern

Every storage namespace provides two functions that serve distinct lifecycle
roles:

| Function | When to use |
|---|---|
| `validateXBinding(name)` | Returns a `Middleware`; register via `app.use` to shape-check the binding on first request |
| `resolveX(c, opts)` | Request time: read the binding off `c` via a `binding` selector and build the typed client/store |

`validate*` functions take only the Wrangler binding name and return a
`Middleware`. On the first request (and whenever the env reference changes) the
middleware runs a functional shape check — KV/R2 require `typeof binding.get` and
`typeof binding.put` to be `"function"`; D1 requires `typeof binding.prepare` to
be `"function"` — and throws a descriptive error on failure. A bare string or
number bound to the name is rejected, not just an absent binding.

`resolve*` functions (`resolveD1Client`, `resolveKVStore`, `resolveObjectStore`)
take the request context and an options object with a `binding: (c) => …`
selector. They build the typed client/store, throwing a descriptive `Error` when
the binding is absent; pass `required: false` to receive `null` instead.

### 4c. Structural Contracts — Cast-Free Platform Bindings

Each storage namespace publishes *neutral* interfaces (`R2Bucket`, `KVNamespace`,
`D1Database`) so consumers don't couple to `@cloudflare/workers-types`. But a
binding selector pinned to the *exact* neutral type conflates two boundaries: what
the resolver **accepts** (the platform binding off `c.env.X` — Cloudflare's runtime
type) versus what the adapter **exposes** (the neutral store it produces). The
adapter only ever **consumes a small structural surface** — for R2, five methods
plus ~8 read fields — yet the neutral type demands the consumer's binding *equal*
the full type. For KV that happens to be assignable; for R2 it is not (Cloudflare's
abstract-class `R2Object` with extra members, overloaded `put`/`get`, and a
discriminated-union `list` return), which forced an `as unknown as R2Bucket` cast
at every R2 call site.

The fix is a **structural contract typed to exactly the consumed surface**, paired
with a **generic resolver constrained to it**:

| Backend | Contract (consumed surface) | Generic resolver |
|---|---|---|
| R2 | `R2BucketLike` (+ `R2ObjectLike` / `R2ObjectBodyLike` / `R2ListLike` / `R2PutLike`) | `resolveObjectStore<Bindings, B extends R2BucketLike>` |
| KV | `KVNamespaceLike` | `resolveKVStore<Bindings, T, NS extends KVNamespaceLike>` |
| D1 | `D1DatabaseLike` | `resolveD1Client<Bindings, DB extends D1DatabaseLike>` |

The `*Like` interfaces are a structural **supertype** of both forge's own neutral
type *and* the platform's runtime type — `get`/`list` options are `unknown` (the
adapter passes them straight through), sidestepping the divergent branded option
and range types. Because the binding return is constrained to the contract
(`B extends R2BucketLike`) rather than pinned to the neutral type, the compiler
**infers** `B` from the selector and **proves** the concrete platform binding meets
the contract — at every call site, no cast:

```typescript
// Cast-free: B is inferred as Cloudflare's R2Bucket and proven to satisfy R2BucketLike.
const store = resolveObjectStore(c, { binding: (c) => c.env.DOCUMENTS })
```

`r2Backend(bucket: R2BucketLike)` is likewise widened to the contract — the
neutral `R2Bucket`, the platform bucket, and an in-memory test stub all satisfy it.
Where a platform *brand* genuinely forces a cast (e.g. a divergent stream type read
*through* the adapter), localise it **once inside the adapter**, never in a resolver
or any consumer.

### 4b. Registering Binding Checks

Each `validateXBinding(name)` is a `Middleware`; register them with `app.use("*", …)`
so every request first verifies its bindings before reaching a handler. The first
mis-shaped binding throws, so the worker never serves a request with a broken
binding.

```typescript
import { validateD1Binding } from "@y-core/forge/storage/db"
import { validateKVBinding } from "@y-core/forge/storage/kv"
import { validateR2Binding } from "@y-core/forge/storage/r2"

app.use("*", validateD1Binding("DB"))
app.use("*", validateKVBinding("LOGS_KV"))
app.use("*", validateR2Binding("ASSETS_BUCKET"))
```

Each middleware caches the validated env reference, so the shape check runs once
per env, not on every request. For checking arbitrary (non-storage) env fields,
`validateBindings(schema)` from `@y-core/forge/app` returns a `Middleware` from
any valibot schema — the storage helpers are thin wrappers over it. Register these
before `app.map(routes, controller)` so the checks sit ahead of route handlers in
the middleware chain.

---

## 5. Dev Degradation

### 5a. Absent Bindings in Local Dev

Running `bun test` or `wrangler dev` without a full `wrangler.toml` binding
configuration means storage bindings are `undefined` at runtime. Each storage
namespace must be handled explicitly for non-critical features.

Recommended guard patterns:

- **KV logging**: check `c.env.LOGS_KV` before constructing a `kvLogChannel`, and
  fall back to just the console channel when it is absent. Already implemented in
  the starter's `src/app/middleware.ts`.
- **Rate limiting**: pass `required: false` to `rateLimit()` so the middleware
  becomes a no-op when the `RATE_LIMITER` binding is absent.
- **D1**: provide in-memory or stub implementations for unit tests rather than
  conditionally skipping database logic in production code paths.
- **Optional resolvers**: pass `required: false` to `resolveKVStore` /
  `resolveObjectStore` / `resolveD1Client` to receive `null` instead of a throw
  when the binding is absent.

```typescript
// Guard pattern for optional KV log channel (mirrors the starter)
const channels = c.env.LOGS_KV
    ? [consoleChannel(), kvLogChannel(c.env.LOGS_KV)]
    : [consoleChannel()]
```

### 5b. Never Mock in Production Code

Graceful degradation (absent binding → no-op) is only acceptable for features
that are non-critical to correctness and security:

| Feature | Absent binding strategy |
|---|---|
| Structured logging | Fall back to `consoleChannel` only (drop the KV channel) |
| Rate limiting | No-op middleware (`required: false`) |
| Analytics KV | Skip write, continue request |

Security-critical features must fail closed when bindings are missing:

| Feature | Absent binding strategy |
|---|---|
| CSRF token store | Throw — do not serve the form |
| Auth session KV | Throw — do not authenticate |
| D1 for user data | Throw — do not expose routes |

Never introduce a conditional that silently skips security enforcement because a
binding is absent. Use `validateBindings` (§4b) to guarantee these bindings
exist before the worker reaches a serving state.
