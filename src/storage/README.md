# `@y-core/forge/storage`

Typed, codec-aware clients for the three Cloudflare Workers storage services: **D1** (SQL database),
**Workers KV** (key-value store), and **R2** (object storage). Each namespace wraps the raw platform
binding with an opinionated, injection-safe, `Result`-returning API plus a consistent
binding-resolution and validation pattern.

> **There is no top-level `@y-core/forge/storage` barrel.** Import from one of the three sub-paths
> instead. Each is a self-contained namespace with its own factory, codecs/helpers, binding
> resolvers, and types.

| Sub-path | Service | Entry factory |
|---|---|---|
| `@y-core/forge/storage/db` | Cloudflare **D1** SQL database | `createD1Client` |
| `@y-core/forge/storage/kv` | Cloudflare **Workers KV** | `createKVStore` |
| `@y-core/forge/storage/r2` | Cloudflare **R2** object storage | `createObjectStore` |

All three share two cross-cutting conventions:

- **`Result`-wrapped operations.** Every async operation returns `Promise<Result<T>>` — the
  discriminated union `{ ok: true; data: T } | { ok: false; error: Error }` — so you handle failure
  by branching on `result.ok` instead of wrapping every call in `try`/`catch`.
- **Resolve / validate pair.** Each namespace exports `resolveX(c, opts)` (builds a typed client from
  the request context) and `validateXBinding(name)` (a `Middleware` that shape-checks the binding on
  the first request). See [Binding resolution and validation](#binding-resolution-and-validation).

---

## `@y-core/forge/storage/db` — D1 database client

### Features

- **Injection-safe by construction.** The client accepts only `SqlFragment` values built by the `sql`
  tagged template — raw query strings are rejected by the type system.
- **Parameterized everything.** Every interpolated value becomes a bind parameter (`?`); fragments
  compose by nesting and flatten automatically.
- **Four operations:** `query` (rows), `queryOne` (single row or `null`), `execute` (writes), and
  `batch` (multiple statements in one round trip).
- **`Result`-wrapped.** No exceptions leak from the client surface; you branch on `result.ok`.

### Usage

```ts
import { createD1Client, sql } from "@y-core/forge/storage/db";

interface User {
  id: number;
  email: string;
}

const db = createD1Client(c.env.DB);

const userId = 42;
const found = await db.queryOne<User>(sql`SELECT id, email FROM users WHERE id = ${userId}`);

if (!found.ok) {
  return new Response(found.error.message, { status: 500 });
}
if (found.data === null) {
  return new Response("Not found", { status: 404 });
}
return Response.json(found.data);
```

### Core components and APIs

#### `createD1Client(db, options?)`

Wraps a raw `D1Database` binding with a typed `D1Client`.

| Parameter | Type | Description |
|---|---|---|
| `db` | `D1Database` | The D1 binding, typically `c.env.DB` |
| `options` | `D1ClientOptions` _(optional)_ | `{ logger?: Logger }` — logs each prepared query at `debug` level |

The returned `D1Client` has four methods. Each accepts a `SqlFragment` (or array of fragments for
`batch`) and resolves to a `Result`:

| Method | Signature | Returns (on `ok`) |
|---|---|---|
| `query` | `query<T>(fragment)` | `T[]` — all matching rows |
| `queryOne` | `queryOne<T>(fragment)` | `T \| null` — first row or `null` |
| `execute` | `execute(fragment)` | `{ rowsWritten: number; lastRowId?: number \| null }` |
| `batch` | `batch<T>(fragments)` | `D1Result<T>[]` — one result per statement |

```ts
const created = await db.execute(
  sql`INSERT INTO users (email) VALUES (${email})`,
);
if (created.ok) {
  console.log("new row id", created.data.lastRowId);
}
```

#### `sql` — the tagged template

`sql` builds a `SqlFragment`: `{ readonly text: string; readonly params: readonly unknown[] }`. Each
interpolated value becomes a `?` placeholder bound to `params`; this is the **only** safe way to build
a D1 query.

```ts
import { sql } from "@y-core/forge/storage/db";

const status = "active";
const limit = 20;
const frag = sql`SELECT * FROM users WHERE status = ${status} LIMIT ${limit}`;
// frag.text   === "SELECT * FROM users WHERE status = ? LIMIT ?"
// frag.params === ["active", 20]
```

Fragments **compose** — interpolating a `SqlFragment` into another fragment merges the text and
concatenates the params, so you can build a query from reusable pieces:

```ts
const whereActive = sql`status = ${"active"}`;
const query = sql`SELECT * FROM users WHERE ${whereActive} ORDER BY created_at DESC`;
```

| Export | Description |
|---|---|
| `sql` | Tagged template that produces a `SqlFragment` |
| `isSqlFragment(value)` | Type guard — confirms a value is a `SqlFragment`; use it in generic helpers that must reject raw strings |
| `SQL_PLACEHOLDER` | The placeholder string (`"?"`) emitted for each bind param |

### Integration guide

Resolve the client from request context and validate the binding with middleware:

```ts
import { resolveD1Client, validateD1Binding } from "@y-core/forge/storage/db";

// Register once — shape-checks env.DB on the first request.
app.use("*", validateD1Binding("DB"));

// Inside a handler:
const db = resolveD1Client(c, { binding: (c) => c.env.DB });
```

| Function | Purpose |
|---|---|
| `resolveD1Client(c, opts)` | Reads the binding via `opts.binding(c)` and builds a `D1Client`. Throws when absent unless `opts.required === false` (then returns `null`). Accepts an optional `opts.client: D1ClientOptions`. |
| `validateD1Binding(name)` | Returns a `Middleware`; on first request asserts `c.env[name]` is an object whose `prepare` is a function, rejecting a stray string/number bound to the name. |

### Security

- **Never build SQL by string concatenation.** Always use `sql\`…\``. The `D1Client` surface only
  accepts `SqlFragment`, so any attempt to pass a raw string is a type error — keep it that way and
  do not coerce around the type with `as`.
- `isSqlFragment` is the runtime guard for code paths that receive `unknown` and must reject
  non-fragments before reaching the client.

---

## `@y-core/forge/storage/kv` — Workers KV store

### Features

- **Codec-aware.** A pluggable `{ encode, decode }` codec maps between the wire format (string or
  `ArrayBuffer`) and your TypeScript type. Built-ins: `jsonCodec`, `textCodec`, `bytesCodec`.
- **Typed end-to-end.** The generic `T` flows through `get`, `set`, `getWithMeta`, `getOrSet`, and
  `list`.
- **Key namespacing.** An optional `prefix` is applied on write and stripped on read, so a single
  namespace can host several logical stores.
- **Metadata + TTL support.** Attach arbitrary metadata, set per-entry TTL, or a store-wide
  `defaultTtl`.
- **`Result`-wrapped** like every storage namespace.

### Usage

```ts
import { createKVStore, jsonCodec } from "@y-core/forge/storage/kv";

interface Session {
  userId: number;
  createdAt: number;
}

const sessions = createKVStore<Session>(c.env.SESSIONS_KV, {
  codec: jsonCodec<Session>(),
  defaultTtl: 3600, // seconds
});

await sessions.set("sess_abc", { userId: 42, createdAt: Date.now() });

const got = await sessions.get("sess_abc");
if (got.ok && got.data) {
  console.log("session for user", got.data.userId);
}
```

### Core components and APIs

#### `createKVStore(kv, options?)`

Wraps a raw `KVNamespace` with a typed `KVStore<T>`.

| Option | Type | Default | Purpose |
|---|---|---|---|
| `codec` | `KvCodec<T>` | `jsonCodec()` | Encode/decode pair for stored values |
| `prefix` | `string` | _(none)_ | Key namespace applied on write, stripped on read |
| `defaultTtl` | `number` | _(none)_ | Fallback `expirationTtl` (seconds) when a write omits one |
| `logger` | `Logger` | scoped default | Logs decode errors and cache misses |

> Keys must not contain the reserved separator `||`; the store throws on such keys (it uses `||` to
> join the prefix).

The returned `KVStore<T>` exposes:

| Method | Signature | Returns (on `ok`) |
|---|---|---|
| `get` | `get(key)` | `T \| null` |
| `getWithMeta` | `getWithMeta<M>(key)` | `KVEntry<T, M>` — `{ value: T \| null; metadata: M \| null }` |
| `set` | `set(key, value, options?)` | `void` |
| `getOrSet` | `getOrSet(key, factory, options?)` | `T` — returns the cached value, or computes via `factory`, writes it, and returns it |
| `delete` | `delete(key)` | `void` |
| `list` | `list<M>(options?)` | `{ keys: KVListEntry<M>[]; cursor?: string; complete: boolean }` |

`KVSetOptions` controls writes: `{ ttl?: number; expiration?: number; metadata?: unknown }`.
`ttl` is in seconds (KV enforces a 60-second platform minimum). `KVListOptions` is
`{ prefix?: string; limit?: number; cursor?: string }`.

```ts
// Read-through cache: compute on miss, cache for 5 minutes.
const config = await sessions.getOrSet(
  "feature-flags",
  async () => fetchFlagsFromOrigin(),
  { ttl: 300 },
);
```

#### Codecs

```ts
import { jsonCodec, textCodec, bytesCodec } from "@y-core/forge/storage/kv";

jsonCodec<T>();  // JSON.stringify / JSON.parse — structured records, the default
textCodec();     // identity — plain string values (tokens, slugs, flags)
bytesCodec();    // Uint8Array <-> ArrayBuffer — binary blobs
```

| Codec | `KvValueType` | Application type | Use for |
|---|---|---|---|
| `jsonCodec<T>()` | `"text"` | `T` | Records, arrays, any typed data |
| `textCodec()` | `"text"` | `string` | Raw strings |
| `bytesCodec()` | `"arrayBuffer"` | `Uint8Array` | Binary data |

A codec is `{ readonly type: KvValueType; encode(value): string | ArrayBuffer; decode(raw): T }`. The
`type` selects which KV `get` overload the store calls, so a custom codec must declare it correctly.

### Integration guide

```ts
import { resolveKVStore, validateKVBinding, jsonCodec } from "@y-core/forge/storage/kv";

app.use("*", validateKVBinding("SESSIONS_KV"));

// Inside a handler — pass `store` codec options so the result is typed immediately:
const sessions = resolveKVStore<typeof c.env, Session>(c, {
  binding: (c) => c.env.SESSIONS_KV,
  store: { codec: jsonCodec<Session>() },
});
```

| Function | Purpose |
|---|---|
| `resolveKVStore(c, opts)` | Reads the binding via `opts.binding(c)` and builds a `KVStore<T>` from `opts.store`. Throws when absent unless `opts.required === false`. |
| `validateKVBinding(name)` | Returns a `Middleware`; asserts `c.env[name]` is an object whose `get` and `put` are functions. |

### Security

- KV is **eventually consistent and globally cached** — never use it as the source of truth for
  values that must be strongly consistent (use D1 for those).
- The `prefix` option isolates logical stores within one namespace but is **not** an access-control
  boundary; gate sensitive reads/writes in the handler.
- Treat decoded values as untrusted input — a malformed entry surfaces as `{ ok: false, error }` from
  `get`; branch on it rather than assuming `data` is well-formed.

---

## `@y-core/forge/storage/r2` — R2 object store

### Features

- **Backend abstraction.** `ObjectStore` consumes an `ObjectStorageBackend`, not a raw bucket. Adapt
  R2 with `r2Backend(bucket)`; the same store API works against an in-memory test backend.
- **HTTP-ready serving.** `serveObject` returns a fully-formed `Response` with `ETag`,
  `If-None-Match` (304), `Range`/`Content-Range` (206/416), content-type inference, and
  `Content-Disposition` handling.
- **Path-traversal safe.** `ObjectStore` rejects keys that start with `/` or contain `.` / `..`
  segments.
- **Signed URLs.** HMAC-SHA-256, time-limited, constant-time verified — for temporary delegated
  access.
- **Content-type inference** from the key's file extension.
- **`Result`-wrapped** store operations.

### Usage

```ts
import { createObjectStore, r2Backend } from "@y-core/forge/storage/r2";

const assets = createObjectStore(r2Backend(c.env.ASSETS_BUCKET), {
  prefix: "uploads",
});

const put = await assets.put("avatars/42.png", imageBytes, {
  contentType: "image/png",
});
if (!put.ok) {
  return new Response(put.error.message, { status: 500 });
}

// Stream it straight back to the client with range + ETag support:
return assets.serveObject(c.request, "avatars/42.png", {
  cacheControl: "public, max-age=3600",
});
```

### Core components and APIs

#### `createObjectStore(backend, options?)`

Wraps an `ObjectStorageBackend` with a typed `ObjectStore`.

| Option | Type | Purpose |
|---|---|---|
| `prefix` | `string` | Key namespace applied on write, stripped on read |
| `logger` | `Logger` | Scoped logger |

The returned `ObjectStore`:

| Method | Signature | Returns (on `ok`) |
|---|---|---|
| `get` | `get(key, options?)` | `ObjectBody \| null` — metadata plus a streamable body |
| `head` | `head(key)` | `StoredObject \| null` — metadata only |
| `put` | `put(key, value, options?)` | `StoredObject` — content type inferred from the key when omitted |
| `delete` | `delete(key)` | `void` — `key` may be a single string or an array |
| `list` | `list(options?)` | `ListObjectsResult` |
| `serveObject` | `serveObject(request, key, options?)` | `Promise<Response>` (not `Result`-wrapped — always a `Response`) |

`StorePutOptions` carries `contentType`, `contentEncoding`, `contentDisposition`, `contentLanguage`,
`cacheControl`, and a `metadata` record. `StoreGetOptions` accepts a byte `range`. `StoreListOptions`
accepts `prefix`, `limit`, `cursor`, and `delimiter`.

#### `serveObject(backend, request, key, options?)`

Retrieves an object and returns a ready-to-return `Response`. It always resolves to a `Response`:

| Status | Condition |
|---|---|
| `200` | Full object body |
| `206` | Satisfied `Range` request (sets `Content-Range`) |
| `304` | `If-None-Match` matches the object's `ETag` |
| `404` | Object absent |
| `416` | Unsatisfiable / malformed `Range` |

It sets `Content-Type`, `ETag`, `Accept-Ranges`, `Content-Length`, and `Cache-Control`.

```ts
import { serveObject, r2Backend } from "@y-core/forge/storage/r2";

const backend = r2Backend(c.env.ASSETS_BUCKET);
return serveObject(backend, c.request, key, {
  cacheControl: "public, max-age=3600",
  contentDisposition: "attachment",
});
```

`ServeOptions`:

| Option | Type | Purpose |
|---|---|---|
| `cacheControl` | `string` | Overrides the object's stored `Cache-Control` |
| `contentDisposition` | `"inline" \| "attachment"` | Emits a `Content-Disposition` header (see Security) |

#### `r2Backend(bucket)` and the backend interface

`r2Backend(bucket)` adapts a Cloudflare `R2Bucket` into an `ObjectStorageBackend` — the abstraction
every R2 helper consumes. Pass its result to `createObjectStore` or `serveObject`. The backend is
swappable: any value implementing `ObjectStorageBackend` (e.g. an in-memory test stub) works
identically.

```ts
import { r2Backend, createObjectStore } from "@y-core/forge/storage/r2";

const store = createObjectStore(r2Backend(c.env.ASSETS_BUCKET), { prefix: "uploads" });
```

#### Content-type helpers

```ts
import { inferContentType, CONTENT_TYPE_DEFAULT } from "@y-core/forge/storage/r2";

inferContentType("photo.png");  // "image/png"
inferContentType("file.bin");   // CONTENT_TYPE_DEFAULT === "application/octet-stream"
```

### Integration guide

```ts
import { resolveObjectStore, validateR2Binding } from "@y-core/forge/storage/r2";

app.use("*", validateR2Binding("ASSETS_BUCKET"));

// Inside a handler — the resolver wraps the bucket with `r2Backend` for you:
const store = resolveObjectStore(c, { binding: (c) => c.env.ASSETS_BUCKET });
```

| Function | Purpose |
|---|---|
| `resolveObjectStore(c, opts)` | Reads the bucket via `opts.binding(c)`, wraps it with `r2Backend`, and builds an `ObjectStore`. Throws when absent unless `opts.required === false`. |
| `validateR2Binding(name)` | Returns a `Middleware`; asserts `c.env[name]` is an object whose `get` and `put` are functions. |

### Advanced — signed URLs

`createSignedObjectUrl` issues an HMAC-SHA-256-signed, time-limited URL for delegated GET access
without exposing the bucket. The receiving route verifies it with `verifySignedObjectUrl` before
serving.

```ts
import {
  importSigningKey,
  createSignedObjectUrl,
  verifySignedObjectUrl,
  serveObject,
  r2Backend,
} from "@y-core/forge/storage/r2";

// Import the secret once (hex-encoded, from a secret binding).
const signingKey = await importSigningKey(c.env.SIGNING_SECRET);

// Issue a URL that expires in 10 minutes:
const url = await createSignedObjectUrl(signingKey, c.request.url, "avatars/42.png", {
  expiresInSeconds: 600,
});

// On the receiving route:
const verdict = await verifySignedObjectUrl(signingKey, c.request.url);
if (!verdict.ok) {
  // verdict.reason: "expired" | "invalid-signature" | "invalid-format"
  return new Response(verdict.reason, { status: 403 });
}
return serveObject(r2Backend(c.env.ASSETS_BUCKET), c.request, verdict.key);
```

| Function | Signature | Notes |
|---|---|---|
| `importSigningKey(hexSecret)` | `Promise<CryptoKey>` | Imports a hex secret as a Web Crypto HMAC-SHA256 key |
| `createSignedObjectUrl(key, baseUrl, objectKey, options?)` | `Promise<string>` | Appends `?key=`, `?exp=`, `?sig=`; `expiresInSeconds` defaults to `3600` |
| `verifySignedObjectUrl(key, url)` | `Promise<{ ok: true; key } \| { ok: false; reason }>` | Checks expiry first, then constant-time HMAC compare |

The HMAC is computed over a length-prefixed payload (`${key.length}:${key}|${exp}`) so the `key`/`exp`
boundary stays unambiguous even when the object key contains the `|` delimiter.

### Security

- **Reject untrusted keys at the store, not after.** `ObjectStore` already throws on keys starting
  with `/` or containing `.` / `..` segments. Do not bypass the store and call the backend directly
  with user-supplied keys.
- **Signing secrets come from a secret binding** (`c.env.SIGNING_SECRET`), never source code. Always
  call `verifySignedObjectUrl` before serving from a signed-URL route — a missing or invalid
  signature must fail closed (`403`).
- **`Content-Disposition` is sanitized.** When you set `contentDisposition`, `serveObject` emits both
  an RFC 5987 `filename*=UTF-8''…` parameter and a sanitized ASCII `filename="…"` fallback that strips
  quotes, backslashes, and control characters, so a crafted filename cannot break out of the quoted
  string.

---

## Binding resolution and validation

All three namespaces follow the same two-function lifecycle pattern.

| Phase | Function | Role |
|---|---|---|
| Startup / first request | `validateXBinding(name)` | A `Middleware` (register via `app.use("*", …)`) that runs a **functional shape check** on first request — D1 requires `prepare` to be a function; KV and R2 require `get` and `put`. A string or number bound to the name is rejected, not just an absent binding. The validated env reference is cached, so the check runs once per env. |
| Request time | `resolveX(c, opts)` | Reads the binding off the context via `opts.binding: (c) => …` and builds the typed client/store. Throws a descriptive `Error` when the binding is absent; pass `opts.required === false` to receive `null` instead (for optional features in local dev). |

```ts
import { validateD1Binding } from "@y-core/forge/storage/db";
import { validateKVBinding } from "@y-core/forge/storage/kv";
import { validateR2Binding } from "@y-core/forge/storage/r2";

app.use("*", validateD1Binding("DB"));
app.use("*", validateKVBinding("SESSIONS_KV"));
app.use("*", validateR2Binding("ASSETS_BUCKET"));
```

### Cast-free platform bindings

Each namespace publishes a structural contract — `D1DatabaseLike`, `KVNamespaceLike`, `R2BucketLike`
— that is a **supertype** of both forge's neutral interface and Cloudflare's runtime binding type.
The resolvers are generic and constrained to these contracts (`resolveObjectStore<Bindings, B extends
R2BucketLike>`, and likewise for KV and D1), so the compiler **infers** the concrete binding type
from your selector and **proves** it satisfies the contract — no `as unknown as` cast at the call
site:

```ts
// `B` is inferred as Cloudflare's R2Bucket and proven to satisfy R2BucketLike.
const store = resolveObjectStore(c, { binding: (c) => c.env.DOCUMENTS });
```

The `*Like` interfaces also enable **testing without real Cloudflare bindings** — an in-memory stub
that implements the consumed surface satisfies the contract and can be passed to `r2Backend`,
`createKVStore`, or `createD1Client` directly.

### Local-dev degradation

Running `bun test` or `wrangler dev` without a full binding configuration leaves bindings
`undefined`. For **non-critical** features, pass `required: false` to a resolver to receive `null`
and fall back gracefully:

```ts
const logStore = resolveKVStore(c, {
  binding: (c) => c.env.LOGS_KV,
  required: false, // null when absent — drop the KV log channel in dev
  store: { codec: jsonCodec() },
});
```

**Security-critical** features (auth sessions, CSRF token stores, user-data D1) must **fail closed** —
keep `required` at its default so a missing binding throws rather than silently disabling enforcement.

---

## Related documentation

- [`.decisions/STORAGE_BINDINGS.md`](../../.decisions/STORAGE_BINDINGS.md) — architecture and rationale
  for the three storage namespaces, the resolve/validate pattern, cast-free structural contracts, and
  dev-degradation policy.
