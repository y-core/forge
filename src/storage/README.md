---
title: Cloudflare Storage Clients
description: "Typed, codec-aware, injection-safe clients for D1, Workers KV and R2, each returning a Result and resolving its binding the same way."
---

# `@y-core/forge/storage`

Typed, codec-aware clients for the three Cloudflare Workers storage services: **D1** (SQL database),
**Workers KV** (key-value store), and **R2** (object storage). Each namespace wraps the raw platform
binding with an opinionated, injection-safe, `Result`-returning API plus a consistent
binding-resolution and validation pattern.

> **There is no top-level `@y-core/forge/storage` barrel.** Import from one of the three sub-paths
> instead. Each is a self-contained namespace with its own factory, codecs/helpers, binding
> resolvers, and types.

| Sub-path | Service | Entry factory |
| --- | --- | --- |
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

> Import path: `@y-core/forge/storage/db` → `src/storage/db/mod.ts`

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
| --- | --- | --- |
| `db` | `D1Database` | The D1 binding, typically `c.env.DB` |
| `options` | `D1ClientOptions` _(optional)_ | `{ logger?: Logger }` — logs each prepared query at `debug` level |

The returned `D1Client` has four methods. Each accepts a `SqlFragment` (or array of fragments for
`batch`) and resolves to a `Result`:

| Method | Signature | Returns (on `ok`) |
| --- | --- | --- |
| `query` | `query<T>(fragment)` | `T[]` — all matching rows |
| `queryOne` | `queryOne<T>(fragment)` | `T \| null` — first row or `null` |
| `execute` | `execute(fragment)` | `{ rowsWritten: number; lastRowId?: number \| null }` |
| `batch` | `batch<T>(fragments)` | `D1Result<T>[]` — one result per statement |

```ts
const created = await db.execute(sql`INSERT INTO users (email) VALUES (${email})`);
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
| --- | --- |
| `sql` | Tagged template that produces a `SqlFragment` |
| `isSqlFragment(value)` | Type guard — a **provenance** check, not a shape check. Only a fragment `sql` minted passes; use it in generic helpers that must reject raw strings and look-alike objects |
| `SQL_PLACEHOLDER` | The placeholder string (`"?"`) emitted for each bind param |

#### `uuidv7()` — time-ordered record identifiers

`uuidv7()` returns a canonical UUIDv7 string for a primary key: unique and non-sequential, yet
lexicographically sortable by creation time.

```ts
import { sql, uuidv7 } from "@y-core/forge/storage/db";

await db.execute(sql`INSERT INTO orders (id, customer_id) VALUES (${uuidv7()}, ${customerId})`);
```

Store it in a `TEXT` column, and `ORDER BY id` doubles as creation order — keyset pagination needs
no separate timestamp index:

```sql
CREATE TABLE orders (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL);
-- page forward with no OFFSET scan
SELECT * FROM orders WHERE id > ?1 ORDER BY id LIMIT 50;
```

What that ordering buys against the B-tree, the monotonic counter it depends on under the Workers
frozen clock, and the rule that a UUIDv7 is **never** a secret are
[`STORAGE_BINDINGS.md`](../../docs/STORAGE_BINDINGS.md) §1e's.

##### Storing the bytes instead — `uuidv7Bytes()`

`uuidv7Bytes()` mints the **same value** as `uuidv7()`, from the same generator, as its raw 16
octets. SQLite compares a `BLOB` with `memcmp` and the bytes are most-significant first, so ordering
is identical to the `TEXT` form — this is purely a density trade, and one to take per table rather
than as a schema-wide default. The measured footprint, the intra-request ordering guarantee, and why
`WITHOUT ROWID` is the wrong lever are
[`STORAGE_BINDINGS.md`](../../docs/STORAGE_BINDINGS.md) §1e's.

```ts
import { sql, uuidFromBytes, uuidToBytes, uuidv7Bytes } from "@y-core/forge/storage/db";

// CREATE TABLE events (id BLOB PRIMARY KEY, kind TEXT NOT NULL);
await db.execute(sql`INSERT INTO events (id, kind) VALUES (${uuidv7Bytes()}, ${kind})`);

// D1 has no binary JSON type, so a BLOB column comes back as number[].
const row = await db.queryOne<{ id: number[]; kind: string }>(sql`SELECT id, kind FROM events LIMIT 1`);
if (row.ok && row.data) console.log(uuidFromBytes(row.data.id)); // "0192f8a1-b2c3-7d4e-…"

// Bind a string ID from a request against the BLOB column.
await db.queryOne(sql`SELECT * FROM events WHERE id = ${uuidToBytes(id)}`);
```

Concretely, the legibility §1e prices means byte arrays in every `wrangler d1 execute` result,
dashboard query, log line and error message; `x'0192…'` literals in hand-written SQL; no `LIKE` or
prefix matching on the id; and a `json_object('id', id)` that no longer produces anything sendable
to a client.

| Export | Description |
| --- | --- |
| `uuidv7()` | Generates a canonical lowercase UUIDv7 from a shared monotonic generator |
| `uuidv7Bytes()` | The same value as its raw 16 octets, for a `BLOB` column — shares the generator with `uuidv7()`, so both forms stay ordered against each other |
| `uuidFromBytes(value)` | Renders 16 octets as the canonical string; accepts the `number[]` D1 returns for a `BLOB`, plus `Uint8Array` and `ArrayBuffer`. Throws unless the value is exactly 16 bytes |
| `uuidToBytes(id)` | Parses a canonical 36-character UUID (either case) to its 16 octets, for binding against a `BLOB` column. An **encoder, not a validator** — validate a request-supplied ID at the boundary with `v.pipe(v.string(), v.uuid())` first |
| `createUuidv7(options?)` | Factory returning an independent string generator; pass `options.now` to inject a clock in tests |
| `createUuidv7Bytes(options?)` | The byte-emitting factory — the core generator the other three build on |
| `Uuidv7Options`, `UuidByteInput` | The options and accepted-byte-encoding types |

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
| --- | --- |
| `resolveD1Client(c, opts)` | Reads the binding via `opts.binding(c)` and builds a `D1Client`. Throws when absent unless `opts.required === false` (then returns `null`). Accepts an optional `opts.client: D1ClientOptions`. |
| `validateD1Binding(name)` | Returns a `Middleware`; on first request asserts `c.env[name]` is an object whose `prepare` is a function, rejecting a stray string/number bound to the name. |

### Security

- **Never build SQL by string concatenation.** Always use ``sql`…` ``. The `D1Client` surface only
  accepts `SqlFragment`, so any attempt to pass a raw string is a type error — keep it that way and
  do not coerce around the type with `as`.
- `isSqlFragment` is the runtime guard for code paths that receive `unknown` and must reject
  non-fragments before reaching the client. It checks **provenance, not shape**: `SqlFragment`
  carries a `unique symbol` brand that only `sql` sets and that is not re-exported from `mod.ts`,
  so a hand-built `{text, params}` literal no longer satisfies it. This is what closes the
  injection path — `JSON.parse` output can never carry a symbol key, so attacker-controlled JSON
  shaped like a fragment is bound as a **parameter** instead of being concatenated into the
  statement text. The brand is non-enumerable in practice: ``JSON.stringify(sql`…`)`` round-trips
  to a value `isSqlFragment` rejects.

### Exports

| Export | Kind | Description |
| --- | --- | --- |
| `createD1Client(db, options?)` | function | Wraps a `D1Database` binding with a typed, `Result`-returning `D1Client`. |
| `resolveD1Client(c, opts)` | function | Builds a `D1Client` from the request context; `null` instead of a throw when `required: false`. |
| `validateD1Binding(name)` | function | `Middleware` asserting `c.env[name]` is an object whose `prepare` is a function. |
| `sql` | function | Tagged template producing a `SqlFragment` — the only value `D1Client` accepts. |
| `isSqlFragment(value)` | function | Provenance guard: only a fragment `sql` minted passes. |
| `SQL_PLACEHOLDER` | const | The placeholder (`"?"`) emitted for each bind parameter. |
| `uuidv7()`, `uuidv7Bytes()` | function | A canonical UUIDv7 string, and the same value as its raw 16 octets, from one shared generator. |
| `uuidFromBytes(value)`, `uuidToBytes(id)` | function | Renders 16 octets as the canonical string, and parses a canonical UUID back to its octets. |
| `createUuidv7(options?)`, `createUuidv7Bytes(options?)` | function | Independent string and byte generators; pass `options.now` to inject a clock in tests. |
| `Uuidv7Options`, `UuidByteInput` | types | The generator options, and the accepted byte encodings for `uuidFromBytes`. |
| `D1Client`, `D1ClientOptions` | types | The four-method client `createD1Client` returns, and its `{ logger? }` options. |
| `D1Database`, `D1DatabaseLike` | types | Forge's neutral D1 binding, and the structural supertype resolvers constrain to. |
| `D1PreparedStatement` | type | The prepared-statement surface `D1Database.prepare` returns. |
| `D1Result` | type | One statement's result — what `batch` resolves to, one entry per statement. |
| `SqlFragment` | type | Branded `{ text, params }`. |
| `D1BindingOptions` | type | `{ binding, required?, client? }` for `resolveD1Client`. |

The six UUID functions and their two types are re-exported from the sealed-internal `crypto` namespace, which has no
subpath of its own — `storage/db` is where they are published.

---

## `@y-core/forge/storage/kv` — Workers KV store

> Import path: `@y-core/forge/storage/kv` → `src/storage/kv/mod.ts`

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
| --- | --- | --- | --- |
| `codec` | `KvCodec<T>` | `jsonCodec()` | Encode/decode pair for stored values |
| `prefix` | `string` | _(none)_ | Key namespace applied on write, stripped on read. Omit it for an unprefixed store; an empty string is refused, since it silently becomes one |
| `defaultTtl` | `number` | _(none)_ | Fallback `expirationTtl` (seconds) when a write omits one |
| `logger` | `Logger` | scoped default | Logs decode errors and cache misses |

> Keys must not contain the reserved separator `||`; the store throws on such keys (it uses `||` to
> join the prefix).

The returned `KVStore<T>` exposes:

| Method | Signature | Returns (on `ok`) |
| --- | --- | --- |
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
const config = await sessions.getOrSet("feature-flags", async () => fetchFlagsFromOrigin(), { ttl: 300 });
```

#### Codecs

```ts
import { jsonCodec, textCodec, bytesCodec } from "@y-core/forge/storage/kv";

jsonCodec<T>(); // JSON.stringify / JSON.parse — structured records, the default
textCodec(); // identity — plain string values (tokens, slugs, flags)
bytesCodec(); // Uint8Array <-> ArrayBuffer — binary blobs
```

| Codec | `KvValueType` | Application type | Use for |
| --- | --- | --- | --- |
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
const sessions = resolveKVStore<typeof c.env, Session>(c, { binding: (c) => c.env.SESSIONS_KV, store: { codec: jsonCodec<Session>() } });
```

| Function | Purpose |
| --- | --- |
| `resolveKVStore(c, opts)` | Reads the binding via `opts.binding(c)` and builds a `KVStore<T>` from `opts.store`. Throws when absent unless `opts.required === false`. |
| `validateKVBinding(name)` | Returns a `Middleware`; asserts `c.env[name]` is an object whose `get` and `put` are functions. |

### Security

- KV is **eventually consistent and globally cached** — never use it as the source of truth for
  values that must be strongly consistent (use D1 for those).
- The `prefix` option isolates logical stores within one namespace but is **not** an access-control
  boundary; gate sensitive reads/writes in the handler.
- Treat decoded values as untrusted input — a malformed entry surfaces as `{ ok: false, error }` from
  `get`; branch on it rather than assuming `data` is well-formed.

### Exports

| Export | Kind | Description |
| --- | --- | --- |
| `createKVStore(kv, options?)` | function | Wraps a `KVNamespace` with a typed, codec-aware `KVStore<T>`. |
| `resolveKVStore(c, opts)` | function | Builds a `KVStore<T>` from the request context and `opts.store`. |
| `validateKVBinding(name)` | function | `Middleware` asserting `c.env[name]` is an object whose `get` and `put` are functions. |
| `jsonCodec()`, `textCodec()`, `bytesCodec()` | function | The built-in codecs: JSON records, raw strings, and binary via `ArrayBuffer`. |
| `KVStore`, `KVStoreOptions` | types | The typed store, and `{ codec?, prefix?, defaultTtl?, logger? }`. |
| `KVSetOptions` | type | `{ ttl?, expiration?, metadata? }` for `set` / `getOrSet`. |
| `KVPutOptions` | type | The raw put options passed through to the binding. |
| `KVEntry` | type | `{ value, metadata }` — what `getWithMeta` resolves to. |
| `KVListOptions`, `KVListResult`, `KVListEntry` | types | `{ prefix?, limit?, cursor? }`, the page it returns, and one key in that page. |
| `KvCodec`, `KvValueType` | types | `{ type, encode, decode }`, and the `"text" \| "arrayBuffer"` wire selector. |
| `KVNamespace`, `KVNamespaceLike` | types | Forge's neutral KV binding, and the structural supertype. |
| `KVBindingOptions` | type | `{ binding, required?, store? }` for `resolveKVStore`. |

---

## `@y-core/forge/storage/r2` — R2 object store

> Import path: `@y-core/forge/storage/r2` → `src/storage/r2/mod.ts`

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

const assets = createObjectStore(r2Backend(c.env.ASSETS_BUCKET), { prefix: "uploads" });

const put = await assets.put("avatars/42.png", imageBytes, { contentType: "image/png" });
if (!put.ok) {
  return new Response(put.error.message, { status: 500 });
}

// Stream it straight back to the client with range + ETag support:
const served = await assets.serveObject(c.request, "avatars/42.png", { cacheControl: "public, max-age=3600" });
return served.ok ? served.data : new Response(served.error.message, { status: 500 });
```

### Core components and APIs

#### `createObjectStore(backend, options?)`

Wraps an `ObjectStorageBackend` with a typed `ObjectStore`.

| Option | Type | Purpose |
| --- | --- | --- |
| `prefix` | `string` | Key namespace applied on write, stripped on read |

**There is no `logger` option.** A store reports a fault through the `Result` it returns; the caller
logs it with whatever logger it already holds.

The returned `ObjectStore`:

| Method | Signature | Returns (on `ok`) |
| --- | --- | --- |
| `get` | `get(key, options?)` | `ObjectBody \| null` — metadata plus a streamable body |
| `head` | `head(key)` | `StoredObject \| null` — metadata only |
| `put` | `put(key, value, options?)` | `StoredObject` — content type inferred from the key when omitted |
| `delete` | `delete(key)` | `void` — `key` may be a single string or an array |
| `list` | `list(options?)` | `ListObjectsResult` |
| `serveObject` | `serveObject(request, key, options?)` | `Response` — a rendered `200`/`206`/`304`/`404`/`416` |

`StorePutOptions` carries `contentType`, `contentEncoding`, `contentDisposition`, `contentLanguage`,
`cacheControl`, and a `metadata` record. `StoreGetOptions` accepts a byte `range`. `StoreListOptions`
accepts `prefix`, `limit`, `cursor`, and `delimiter`.

#### `serveObject(backend, request, key, options?)`

Retrieves an object and returns a ready-to-return `Response`. It always resolves to a `Response`:

| Status | Condition |
| --- | --- |
| `200` | Full object body |
| `206` | Satisfied `Range` request (sets `Content-Range`) |
| `304` | `If-None-Match` matches the object's `ETag` |
| `404` | Object absent |
| `416` | Unsatisfiable / malformed `Range` |

It sets `Content-Type`, `Content-Encoding`, `Content-Language`, `ETag`, `Accept-Ranges`, `Content-Length`, `Cache-Control` and `X-Content-Type-Options: nosniff`. With no `contentDisposition` option it falls back to the object's stored `Content-Disposition`, dropping one that carries a non-ASCII byte rather than throwing from `Headers.set`.

A satisfiable ranged read is **one round trip**, and a backend that cannot satisfy a range signals it by throwing `UnsatisfiableRangeError`. The round-trip guarantee, the bounds a `Range` is held to before it reaches the backend, and why `nosniff` is set unconditionally are [`STORAGE_BINDINGS.md`](../../docs/STORAGE_BINDINGS.md) §3b's.

```ts
import { serveObject, r2Backend } from "@y-core/forge/storage/r2";

const backend = r2Backend(c.env.ASSETS_BUCKET);
return serveObject(backend, c.request, key, { cacheControl: "public, max-age=3600", contentDisposition: "attachment" });
```

`ServeOptions`:

| Option | Type | Purpose |
| --- | --- | --- |
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

> **Security — uploads whose key a caller chooses.** `put` infers the content type from the key's
> extension, so a caller who names their upload `x.html` has it stored as `text/html`. What that
> risks and the three ways out are [`STORAGE_BINDINGS.md`](../../docs/STORAGE_BINDINGS.md) §3b's;
> the third, unnamed there, is to pass an explicit `contentType` on `put` rather than letting the
> key decide.

#### Content-type helpers

```ts
import { inferContentType, CONTENT_TYPE_DEFAULT } from "@y-core/forge/storage/r2";

inferContentType("photo.png"); // "image/png"
inferContentType("file.bin"); // CONTENT_TYPE_DEFAULT === "application/octet-stream"
```

### Integration guide

```ts
import { resolveObjectStore, validateR2Binding } from "@y-core/forge/storage/r2";

app.use("*", validateR2Binding("ASSETS_BUCKET"));

// Inside a handler — the resolver wraps the bucket with `r2Backend` for you:
const store = resolveObjectStore(c, { binding: (c) => c.env.ASSETS_BUCKET });
```

| Function | Purpose |
| --- | --- |
| `resolveObjectStore(c, opts)` | Reads the bucket via `opts.binding(c)`, wraps it with `r2Backend`, and builds an `ObjectStore`. Throws when absent unless `opts.required === false`. |
| `validateR2Binding(name)` | Returns a `Middleware`; asserts `c.env[name]` is an object whose `get` and `put` are functions. |

### Advanced — signed URLs

`createSignedObjectUrl` issues an HMAC-SHA-256-signed, time-limited URL for delegated GET access
without exposing the bucket. The receiving route verifies it with `verifySignedObjectUrl` before
serving.

```ts
import { importSigningKey, createSignedObjectUrl, verifySignedObjectUrl, serveObject, r2Backend } from "@y-core/forge/storage/r2";

// Import the secret once (hex-encoded, from a secret binding).
const signingKey = await importSigningKey(c.env.SIGNING_SECRET);

// Issue a URL that expires in 10 minutes:
const url = await createSignedObjectUrl(signingKey, c.request.url, "avatars/42.png", { expiresInSeconds: 600 });

// On the receiving route:
const verdict = await verifySignedObjectUrl(signingKey, c.request.url);
if (!verdict.ok) {
  // verdict.error is "expired" | "invalid-signature" | "invalid-format" — for your logs, not the
  // client: echoing which check failed tells an attacker what to change next (ERROR_HANDLING §1c).
  return new Response("Forbidden", { status: 403 });
}
return serveObject(r2Backend(c.env.ASSETS_BUCKET), c.request, verdict.data);
```

| Function | Signature | Notes |
| --- | --- | --- |
| `importSigningKey(hexSecret)` | `Promise<CryptoKey>` | Imports a hex secret as a Web Crypto HMAC-SHA256 key |
| `createSignedObjectUrl(key, baseUrl, objectKey, options?)` | `Promise<string>` | Appends `?key=`, `?exp=`, `?sig=`; `expiresInSeconds` defaults to `3600` |
| `verifySignedObjectUrl(key, url)` | `Promise<SignedUrlVerdict>` | `Result<string, SignedUrlFailure>`: the object key, or why it was refused |

The HMAC is computed over a length-prefixed payload (`${key.length}:${key}|${exp}`) so the `key`/`exp`
boundary stays unambiguous even when the object key contains the `|` delimiter.

### Security

- **Reject untrusted keys at the store, not after.** `ObjectStore` already throws on keys starting
  with `/` or containing `.` / `..` segments. Do not bypass the store and call the backend directly
  with user-supplied keys.
- **Signing secrets come from a secret binding** (`c.env.SIGNING_SECRET`), never source code. Always
  call `verifySignedObjectUrl` before serving from a signed-URL route — a missing or invalid
  signature must fail closed (`403`).
- **`Content-Disposition` is sanitized** — an RFC 5987 `filename*=UTF-8''…` parameter carrying the
  exact name plus an ASCII `filename="…"` fallback, so a crafted object key cannot break out of the
  quoted string. The fallback's exact folding rules are
  [`STORAGE_BINDINGS.md`](../../docs/STORAGE_BINDINGS.md) §3b's.

### Exports

| Export | Kind | Description |
| --- | --- | --- |
| `createObjectStore(backend, options?)` | function | Wraps an `ObjectStorageBackend` with a typed, `Result`-returning `ObjectStore`. |
| `resolveObjectStore(c, opts)` | function | Reads the bucket off the context, wraps it with `r2Backend`, and builds an `ObjectStore`. |
| `validateR2Binding(name)` | function | `Middleware` asserting `c.env[name]` is an object whose `get` and `put` are functions. |
| `r2Backend(bucket)` | function | Adapts a Cloudflare `R2Bucket` into the `ObjectStorageBackend` every R2 helper consumes. |
| `serveObject(backend, request, key, options?)` | function | Retrieves an object as a ready-to-return `Response` — `ETag`, `If-None-Match`, `Range`, and `Content-Disposition` handled. |
| `inferContentType(key)` | function | Maps the key's file extension to a MIME type from a fixed table, falling back to `CONTENT_TYPE_DEFAULT`. |
| `CONTENT_TYPE_DEFAULT` | const | The MIME type used when no extension matches: `"application/octet-stream"`. |
| `UnsatisfiableRangeError` | class | Thrown by a backend for a `Range` wholly outside the object; carries `key`, optional `size`, and the platform error as `cause`. |
| `importSigningKey(hexSecret)` | function | Imports a hex secret as a Web Crypto HMAC-SHA256 key. |
| `createSignedObjectUrl(key, baseUrl, objectKey, options?)` | function | Issues a time-limited signed GET URL; `expiresInSeconds` defaults to `3600`. |
| `verifySignedObjectUrl(key, url)` | function | Constant-time verification returning the object key, or why it was refused. |
| `ObjectStore`, `ObjectStoreOptions` | types | The typed store, and `{ prefix? }` for `createObjectStore` — there is no `logger` option. |
| `ObjectStorageBackend` | type | The adapter surface every R2 helper consumes; `r2Backend` produces one. |
| `StoredObject`, `ObjectBody` | types | Metadata only, and metadata plus a streamable body. |
| `StorePutOptions` | type | `contentType`, `contentEncoding`, `contentDisposition`, `contentLanguage`, `cacheControl`, `metadata`. |
| `StoreGetOptions` | type | `{ range? }`. |
| `StoreListOptions`, `ListObjectsResult` | types | `{ prefix?, limit?, cursor?, delimiter? }`, and the page it returns. |
| `ServeOptions` | type | `{ cacheControl?, contentDisposition? }` for `serveObject`. |
| `SignedUrlOptions` | type | `{ expiresInSeconds? }` for `createSignedObjectUrl`. |
| `SignedUrlVerdict`, `SignedUrlFailure` | types | `Result<string, SignedUrlFailure>`, and the three refusal reasons. |
| `R2Bucket`, `R2BucketLike` | types | Forge's neutral bucket, and the structural supertype. |
| `R2Object`, `R2ObjectBody`, `R2ObjectLike`, `R2ObjectBodyLike` | types | Object metadata and body, neutral and structural forms. |
| `R2GetOptions`, `R2PutOptions`, `R2PutLike` | types | Pass-through get and put options, and the put shape the adapter constructs. |
| `R2ListOptions`, `R2ListResult`, `R2ListLike` | types | List options, its result, and the structural list surface. |
| `R2HttpMetadata` | type | The HTTP header fields stored alongside an object. |
| `R2BindingOptions` | type | `{ binding, required?, store? }` for `resolveObjectStore`. |

---

## Binding resolution and validation

All three namespaces follow the same two-function lifecycle pattern.

| Phase | Function | Role |
| --- | --- | --- |
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
and R2's object and list satellites — and each resolver is generic and constrained to the matching
one. The compiler therefore **infers** the concrete binding type from your selector and **proves**
it satisfies the contract, so no call site needs `as unknown as`:

```ts
// `B` is inferred as Cloudflare's R2Bucket and proven to satisfy R2BucketLike.
const store = resolveObjectStore(c, { binding: (c) => c.env.DOCUMENTS });
```

The same contracts are what let an in-memory stub implementing only the consumed surface be handed
to `r2Backend`, `createKVStore` or `createD1Client` in a test. Why the supertype is written to the
consumed surface rather than mirroring the platform's is
[`STORAGE_BINDINGS.md`](../../docs/STORAGE_BINDINGS.md) §4c's.

### Local-dev degradation

Pass `required: false` to a resolver to receive `null` instead of a throw when a binding is absent:

```ts
const logStore = resolveKVStore(c, {
  binding: (c) => c.env.LOGS_KV,
  required: false, // null when absent — drop the KV log channel in dev
  store: { codec: jsonCodec() },
});
```

Which features may degrade and which must fail closed is
[`STORAGE_BINDINGS.md`](../../docs/STORAGE_BINDINGS.md) §5a/§5b's — a
security-critical binding keeps `required` at its default.

### Cancellation is not threadable here

**No storage binding forge wraps accepts an `AbortSignal`, so no client here takes one.** R2's `get`
accepts `{ onlyIf, range }` and nothing else, and KV's and D1's methods accept no options at all.
There is no signal to pass and none to honour, so a cancelled request does not stop storage I/O
already in flight — the platform decides when that work ends.

What this leaves is the failure answer, not a retry: a binding fault is caught, logged, and failed
closed as a `503` ([`ERROR_HANDLING.md`](../../docs/ERROR_HANDLING.md) §5c). That includes
Cloudflare's `Network connection lost`. **No storage client retries**, because how many attempts a
given call is worth is the consumer's decision, not this layer's.

---

## See also

- [`STORAGE_BINDINGS.md`](../../docs/STORAGE_BINDINGS.md) — the three clients,
  the resolve/validate lifecycle (§4), the structural contracts (§4c), and the degradation policy
  (§5).
- [`ERROR_HANDLING.md`](../../docs/ERROR_HANDLING.md) — the `Result` primitive
  every operation here returns, and the free `serveObject`'s exception to it.
