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
- §4 Binding resolve/validate pattern: validateXBinding vs resolveXClient
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
const stmt = db.prepare(query)
```

`isSqlFragment(value)` is a type-guard that confirms a value is a `SqlFragment`,
useful when writing generic query helpers that must reject raw strings.

### 1c. resolveD1Client — From Bindings Object

`resolveD1Client` looks up a binding by name at runtime rather than requiring the
caller to pass the binding reference directly. Prefer this in middleware and
request handlers where `c.env` is the only available surface.

```typescript
import { resolveD1Client } from "@y-core/forge/storage/db"

const db = resolveD1Client(c.env, "DB")  // resolves binding by name
```

Throws a descriptive error when the named binding is absent so misconfiguration
surfaces immediately at request time rather than as a null-dereference later.

### 1d. validateD1Binding — Startup Validation

`validateD1Binding` returns an error string when the named binding is missing from
`env`, or `null` when present. Collect the results and throw before the app begins
serving requests.

```typescript
import { validateD1Binding } from "@y-core/forge/storage/db"

const error = validateD1Binding(c.env, "DB")
if (error) throw new Error(`Missing D1 binding: ${error}`)
```

Use inside `validateBindings()` at app startup to fail fast on missing bindings.
See §4b for the recommended composition pattern.

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

Mirror the D1 pattern (§1c, §1d) for KV bindings. Pass codec options to
`resolveKVStore` so the returned store is immediately typed.

```typescript
import { resolveKVStore, validateKVBinding } from "@y-core/forge/storage/kv"

const store = resolveKVStore(c.env, "LOGS_KV", { codec: jsonCodec() })
const error = validateKVBinding(c.env, "LOGS_KV")
```

---

## 3. storage/r2 — Object Store

### 3a. createObjectStore Factory

`createObjectStore` wraps a raw `R2Bucket` binding. The returned `ObjectStore`
exposes a consistent interface for get/put/delete operations with typed metadata.

```typescript
import { createObjectStore } from "@y-core/forge/storage/r2"

const store = createObjectStore(c.env.ASSETS_BUCKET)
// store: ObjectStore — typed wrapper around R2Bucket
```

### 3b. serveObject — Direct Response from R2

`serveObject` retrieves an R2 object and returns a fully-formed `Response` ready
to return from a Hono handler, including correct `Content-Type` and caching
headers. Returns `null` when the object does not exist.

```typescript
import { serveObject } from "@y-core/forge/storage/r2"

const response = await serveObject(c.env.ASSETS_BUCKET, key, {
    contentType: "image/png",
})
if (!response) return c.notFound()
return response
```

Always check for `null` — a missing object must produce a 404, not an unhandled
rejection.

### 3c. Signed URLs for Secure Object Access

`createSignedObjectUrl` produces an HMAC-signed URL that expires after
`expiresIn` seconds. Import the signing key once (per worker startup or request)
using `importSigningKey`.

```typescript
import { createSignedObjectUrl, importSigningKey } from "@y-core/forge/storage/r2"

const key = await importSigningKey(hexSecret)
const signedUrl = await createSignedObjectUrl(objectKey, key, { expiresIn: 3600 })
```

`hexSecret` must come from a secret binding (`c.env.SIGNING_SECRET`), never from
source code. Signed URLs are validated on the receiving route — do not serve
objects from a signed URL path without verifying the signature first.

### 3d. r2Backend — Storage Backend Adapter

`r2Backend(bucket)` creates an `ObjectStoreOptions`-compatible backend from an
`R2Bucket`. Use it to wire R2 into higher-level object store operations or
adapters that accept a backend parameter rather than a raw bucket.

```typescript
import { r2Backend, createObjectStore } from "@y-core/forge/storage/r2"

const store = createObjectStore(c.env.ASSETS_BUCKET, {
    backend: r2Backend(c.env.ASSETS_BUCKET),
})
```

### 3e. Binding Validation for R2

`validateR2Binding` and `resolveObjectStore` follow the same pattern as D1 (§1c,
§1d) and KV (§2d).

```typescript
import { validateR2Binding, resolveObjectStore } from "@y-core/forge/storage/r2"

const error = validateR2Binding(c.env, "ASSETS_BUCKET")
const store = resolveObjectStore(c.env, "ASSETS_BUCKET")
```

---

## 4. Binding Resolve/Validate Pattern

### 4a. Two-Function Pattern

Every storage namespace provides two initialization functions that serve distinct
lifecycle roles:

| Function | When to use |
|---|---|
| `validateXBinding(env, name)` | Startup: check binding present, return error string or null |
| `resolveXClient(env, name)` | Request time: get or create typed client from bindings |

`validate*` functions are synchronous and return `string | null` — they never
throw directly. Collect results and throw once after checking all bindings.

`resolve*` functions are synchronous when the binding is present; they throw a
descriptive `Error` when the binding is absent so misconfiguration is visible
immediately.

### 4b. validateBindings at Startup

Compose all binding checks using `validateBindings` from `@y-core/forge/app`.
The callback receives `env` and must return an array of `string | null` — one
entry per binding check. Any non-null entry causes the worker to throw before
it begins handling requests.

```typescript
import { validateBindings } from "@y-core/forge/app"
import { validateD1Binding } from "@y-core/forge/storage/db"
import { validateKVBinding } from "@y-core/forge/storage/kv"
import { validateR2Binding } from "@y-core/forge/storage/r2"

validateBindings(app, (env) => [
    validateD1Binding(env, "DB"),
    validateKVBinding(env, "LOGS_KV"),
    validateR2Binding(env, "ASSETS_BUCKET"),
])
```

Place this call immediately after `createWorker` returns, before any routes are
registered, so the worker never reaches a serving state with missing bindings.

---

## 5. Dev Degradation

### 5a. Absent Bindings in Local Dev

Running `bun test` or `wrangler dev` without a full `wrangler.toml` binding
configuration means storage bindings are `undefined` at runtime. Each storage
namespace must be handled explicitly for non-critical features.

Recommended guard patterns:

- **KV logging**: check `c.env.LOGS_KV` before calling `createKVStore` or
  constructing a `kvLogChannel`. Already implemented in the starter's
  `src/worker.ts`.
- **Rate limiting**: pass `required: false` to `rateLimit()` so the middleware
  becomes a no-op when the `RATE_LIMITER` binding is absent.
- **D1**: provide in-memory or stub implementations for unit tests rather than
  conditionally skipping database logic in production code paths.

```typescript
// Guard pattern for optional KV binding
const logChannel = c.env.LOGS_KV
    ? kvLogChannel(createKVStore(c.env.LOGS_KV, { codec: jsonCodec() }))
    : nullLogChannel()
```

### 5b. Never Mock in Production Code

Graceful degradation (absent binding → no-op) is only acceptable for features
that are non-critical to correctness and security:

| Feature | Absent binding strategy |
|---|---|
| Structured logging | Fall back to `nullLogChannel` |
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
