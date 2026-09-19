---
title: Cloudflare Storage Clients
description: "Typed, codec-aware, injection-safe clients for D1, Workers KV and R2, each returning a Result and resolving its binding the same way."
audience: consumer
---

# `@y-core/forge/storage`

D1, Workers KV and R2, each behind a typed client that answers with a `Result` instead of throwing, and each reached from the request context by the
same pair of functions. Reach for it whenever a Worker has to read or write something that outlives the request.

**There is no top-level `storage` barrel.** Import from the subpath for the service you are using:

- `@y-core/forge/storage/db` — the D1 SQL database, queried through `sql` fragments and nothing else
- `@y-core/forge/storage/kv` — a Workers KV namespace, through a codec you choose
- `@y-core/forge/storage/r2` — an R2 bucket, through a swappable object-storage backend

---

## Getting started

The same beats for D1, KV and R2: register a binding check once at app level, resolve a client inside the handler, branch on `result.ok`.

```ts
import { resolveD1Client, sql, validateD1Binding } from "@y-core/forge/storage/db";

app.use("*", validateD1Binding("DB")); // once, ahead of every route

// Inside a handler:
const db = resolveD1Client(c, { binding: (c) => c.env.DB })!;
const found = await db.queryOne<{ id: string; email: string }>(sql`SELECT id, email FROM users WHERE id = ${userId}`);

if (!found.ok) return new Response("Storage unavailable", { status: 503 });
if (found.data === null) return new Response("Not found", { status: 404 });
return Response.json(found.data);
```

The `| null` in a resolver's return type belongs to `required: false` alone; under the default the resolver **throws** when the binding is
absent, so the non-null assertion is the honest spelling at a call site that did not ask for the `null`. Resolution throws and operations return
`Result` because a missing binding is a deployment defect while a failed read is not — [`FORGE_ERRORS.md`][eh-5e] §5e owns that split, and
[`STORAGE_BINDINGS.md`][sb-4a] §4a owns the lifecycle and the fact that `validateXBinding` is a shape check, not a presence check.

KV and R2 take the same two steps, with the store's own options passed through:

```ts
import { jsonCodec, resolveKVStore, validateKVBinding } from "@y-core/forge/storage/kv";
import { resolveObjectStore, validateR2Binding } from "@y-core/forge/storage/r2";

app.use("*", validateKVBinding("SESSIONS_KV"));
app.use("*", validateR2Binding("ASSETS"));

const sessions = resolveKVStore<Bindings, Session>(c, {
  binding: (c) => c.env.SESSIONS_KV,
  store: { codec: jsonCodec<Session>() },
})!;
const assets = resolveObjectStore(c, { binding: (c) => c.env.ASSETS, store: { prefix: "uploads" } })!;
```

---

## Querying D1

Every read and write takes a fragment built by the `sql` tag and resolves to a `Result`.

```ts
const rows = await db.query<User>(sql`SELECT id, email FROM users WHERE status = ${status} LIMIT ${limit}`);
const one = await db.queryOne<User>(sql`SELECT id, email FROM users WHERE id = ${id}`); // User | null
const written = await db.execute(sql`INSERT INTO users (id, email) VALUES (${id}, ${email})`); // { rowsWritten, lastRowId? }
```

Every interpolated value becomes a `?` bind parameter, and a fragment interpolated into another fragment merges its text and concatenates its
params — so a filter can be built once and reused:

```ts
const active = sql`status = ${"active"}`;
const page = await db.query<User>(sql`SELECT * FROM users WHERE ${active} ORDER BY created_at DESC`);
```

Because the client accepts a `SqlFragment` and nothing else, a concatenated string is a compile error rather than an injection. What the fragment's
brand does and does not cover — notably an identifier such as a column name, which no bind parameter can carry — is [`STORAGE_BINDINGS.md`][sb-1b]
§1b's. In a generic helper that receives `unknown` and must reject look-alikes, `isSqlFragment(value)` is the runtime guard.

Query logging is off by default: pass `{ logger }` as `createD1Client`'s second argument, or as `resolveD1Client`'s `client` option, to log every
statement at `debug` — and read [`STORAGE_BINDINGS.md`][sb-1a] §1a before you do, because the text and every bound value land on whatever channel
that logger writes to.

---

## Writing several statements atomically

`batch` is the transaction boundary. A later statement's failure undoes every earlier write in the same call, and each entry of the resolved array
carries its statement's rows plus the same `rowsWritten` that `execute` reports.

```ts
import { requireRowsWritten, sql } from "@y-core/forge/storage/db";

const outcome = await db.batch([
  sql`UPDATE accounts SET balance = balance - ${amount} WHERE id = ${from} AND balance >= ${amount}`,
  requireRowsWritten(),
  sql`UPDATE accounts SET balance = balance + ${amount} WHERE id = ${to}`,
]);
```

A guarded write that matches no row still commits as a success — the trap `requireRowsWritten()` exists for, appended directly after the write it
protects. That, the ban on writing `BEGIN`/`COMMIT` at runtime, and where a repository's fragments should stop and a use case's batch should start
are [`STORAGE_BINDINGS.md`][sb-1g] §1g's.

---

## Minting record identifiers

`uuidv7()` gives a primary key that is unique, non-sequential and still lexicographically ordered by creation time, so `ORDER BY id` doubles as
creation order and keyset paging needs no separate timestamp index.

```ts
import { sql, uuidv7 } from "@y-core/forge/storage/db";

await db.execute(sql`INSERT INTO orders (id, customer_id) VALUES (${uuidv7()}, ${customerId})`);
```

```sql
-- Page forward with no OFFSET scan.
SELECT * FROM orders WHERE id > ?1 ORDER BY id LIMIT 50;
```

**`TEXT` is the default.** `uuidv7Bytes()` mints the same value from the same generator as raw octets for a `BLOB` column, ordered identically, and
what you are trading — a smaller footprint against legible output everywhere the database is read by hand — is
[`STORAGE_BINDINGS.md`][sb-1e] §1e's, along with the rule that a UUIDv7 is never a secret. Take it per table, not schema-wide.

```ts
import { sql, uuidFromBytes, uuidToBytes, uuidv7Bytes } from "@y-core/forge/storage/db";

await db.execute(sql`INSERT INTO events (id, kind) VALUES (${uuidv7Bytes()}, ${kind})`);

// D1's JSON transport has no binary type, so a BLOB column reads back as number[].
const row = await db.queryOne<{ id: number[]; kind: string }>(sql`SELECT id, kind FROM events LIMIT 1`);
if (row.ok && row.data) console.log(uuidFromBytes(row.data.id)); // "0192f8a1-b2c3-7d4e-…"

// Bind a string id from a request against the BLOB column.
await db.queryOne(sql`SELECT * FROM events WHERE id = ${uuidToBytes(id)}`);
```

`uuidToBytes` is an **encoder, not a validator**: it throws on anything that is not a canonical 36-character UUID, which is a 500 unless a
request-supplied id was already validated at the boundary with `v.pipe(v.string(), v.uuid())`. For a deterministic clock in a test, build a private
generator with `createUuidv7({ now })` — or `createUuidv7Bytes({ now })` for the byte form — instead of the shared default.

`compareCodePoints(a, b)` orders two strings the way SQLite's `BINARY` collation does, by code point rather than by UTF-16 code unit. Reach for it
when JavaScript has to reproduce an `ORDER BY` it did not run.

---

## Reporting schema drift from a Worker

A Worker can read whether the schema it serves is the one `forge db migrate` certified, and say so. `checkSchemaHealth(db)` is the raw read,
resolving to `{ state, recorded, actual }`; the surfaces below build on it.

```ts
import { healthCheck } from "@y-core/forge/app";
import { schemaHealthCheck, schemaHealthMonitor } from "@y-core/forge/storage/db";

// Once per isolate: one `d1.schema.health` record; always calls next().
app.use("*", schemaHealthMonitor({ binding: (c) => c.env.DB }));

// A named predicate for a health route, mounted like any other handler.
const health = healthCheck<Bindings>({ schema: schemaHealthCheck((c) => c.env.DB) });
```

Which states a schema report can be in, which of them fail the health check, what the monitor logs and at which level, and why the report never
repairs anything are [`STORAGE_BINDINGS.md`][sb-1f] §1f's. The repair is `forge db migrate` on the CLI ([`DATABASE_MANAGEMENT.md`][dm]).

---

## Caching values in KV

```ts
import { createKVStore, jsonCodec } from "@y-core/forge/storage/kv";

const cache = createKVStore<Flags>(c.env.CACHE, { codec: jsonCodec<Flags>(), prefix: "flags", defaultTtl: 3600 });

// Read-through: returns the cached value, or computes it, writes it, and returns it.
const flags = await cache.getOrSet("v1", () => fetchFlagsFromOrigin(), { ttl: 300 });
if (flags.ok) render(flags.data);

await cache.set("v1", next, { metadata: { source: "admin" } });
const entry = await cache.getWithMeta<{ source: string }>("v1"); // { value, metadata }
const page = await cache.list({ limit: 100 }); // { keys, cursor?, complete }
```

Each option shaping the store is a decision rather than a default to copy. **`prefix`** is what lets one namespace host several logical
stores: it is added on write and stripped from every read and every key `list` returns, so the keys you see are the keys you wrote. **`defaultTtl`**
is the fallback for a write that names no `ttl`; a per-write `ttl` wins. **`logger`** takes the decode-error and cache-miss records, which are the
only things the store logs. TTLs are seconds and the platform enforces a floor — [`STORAGE_BINDINGS.md`][sb-2c] §2c.

---

## Storing something other than JSON in KV

The codec is the one choice `createKVStore` makes you think about: it selects both the KV `get` overload the store calls and the type that flows
through every operation.

```ts
import { bytesCodec, createKVStore, textCodec } from "@y-core/forge/storage/kv";

const tokens = createKVStore<string>(c.env.TOKENS, { codec: textCodec() }); // strings on the wire, unchanged
const blobs = createKVStore<Uint8Array>(c.env.BLOBS, { codec: bytesCodec() }); // Uint8Array here, ArrayBuffer there
```

`jsonCodec<T>()` is the default and the answer for records and arrays; `textCodec()` is for a value that is already a string; `bytesCodec()` is for
bytes that must survive unmodified. Which to pick for a given namespace is [`STORAGE_BINDINGS.md`][sb-2b] §2b's, and it must match the format
already stored there — a codec is not a migration.

A custom codec is `{ type, encode, decode }`. Its `type` must name the wire form `decode` expects (`"text"` or `"arrayBuffer"`), because that is
what the store dispatches the read on.

---

## Storing and serving files from R2

`createObjectStore` takes an `ObjectStorageBackend`, not a bucket; `r2Backend` adapts one. Serving is built in, so a download route is two calls.

```ts
import { createObjectStore, r2Backend } from "@y-core/forge/storage/r2";

const assets = createObjectStore(r2Backend(c.env.ASSETS), { prefix: "uploads" });

const put = await assets.put("avatars/42.png", imageBytes, { contentType: "image/png" });
if (!put.ok) return new Response("Upload failed", { status: 503 });

const served = await assets.serveObject(c.request, "avatars/42.png", { cacheControl: "public, max-age=3600" });
return served.ok ? served.data : new Response("Unavailable", { status: 503 });
```

A key that starts with `/` or carries a `.` or `..` segment is rejected, and reaches the caller as `{ ok: false, error }` like any other failure —
so an untrusted key goes to the store, never straight to the backend.

**When `contentType` is omitted, `put` infers it from the key's extension** (`inferContentType`, falling back to `CONTENT_TYPE_DEFAULT`) — **except
for the extensions a browser would execute**: `html`, `htm`, `svg`, `xml`, `js` and `mjs` all infer `application/octet-stream`, because a key is
routinely a filename someone else chose. Pass an explicit `contentType` for an asset you trust, and it is used unchanged.

**A stored active type is neutralised on the way out too.** `serveObject` serves any object whose stored `Content-Type` is active as
`Content-Disposition: attachment` under `Content-Security-Policy: sandbox`, unless you passed a `contentDisposition` of your own — so an app that
deliberately stored `image/svg+xml` still cannot have it rendered as a document on its own origin by a direct navigation. The rest of that posture,
and the statuses and headers `serveObject` produces, are [`STORAGE_BINDINGS.md`][sb-3b] §3b's.

The free `serveObject(backend, request, key, options?)` is the same machinery without the `Result` wrapper — a bare `Response`, already a `200`,
`206`, `304`, `404` or `416`:

```ts
import { r2Backend, serveObject } from "@y-core/forge/storage/r2";

return serveObject(r2Backend(c.env.ASSETS), c.request, key, { contentDisposition: "attachment" });
```

---

## Handing out a temporary download link

A signed URL delegates GET access to one object for a fixed window without exposing the bucket.

```ts
import { createSignedObjectUrl, importSigningKey, r2Backend, serveObject, verifySignedObjectUrl } from "@y-core/forge/storage/r2";

const signingKey = await importSigningKey(c.env.SIGNING_SECRET); // hex, from a secret binding — never a literal

const url = await createSignedObjectUrl(signingKey, c.request.url, "avatars/42.png", { expiresInSeconds: 600 });

// On the receiving route:
const verdict = await verifySignedObjectUrl(signingKey, c.request.url);
if (!verdict.ok) return new Response("Forbidden", { status: 403 }); // log verdict.error; do not echo it
return serveObject(r2Backend(c.env.ASSETS), c.request, verdict.data);
```

`expiresInSeconds` defaults to `3600`. What the HMAC covers, the order the checks run in, and why the refusal reason belongs in your logs rather
than in the response are [`STORAGE_BINDINGS.md`][sb-3c] §3c's.

---

## Swapping the binding for a fake in tests

Every client is written against a structural contract — `D1DatabaseLike`, `KVNamespaceLike`, `R2BucketLike` — that describes only the surface forge
actually calls, so a stub implementing that much is accepted with no cast and no `@cloudflare/workers-types` value in the test
([`STORAGE_BINDINGS.md`][sb-4c] §4c). `@y-core/forge/testing` ships one fake per service.

```ts
import { createD1Client } from "@y-core/forge/storage/db";
import { createKVStore, jsonCodec } from "@y-core/forge/storage/kv";
import { createObjectStore, r2Backend } from "@y-core/forge/storage/r2";
import { fakeD1, fakeKV, fakeR2 } from "@y-core/forge/testing";

const db = createD1Client(fakeD1((text, params) => [{ id: params[0] }]));
const kv = createKVStore<Session>(fakeKV({ "sess||abc": JSON.stringify(session) }), { codec: jsonCodec<Session>(), prefix: "sess" });
const store = createObjectStore(r2Backend(fakeR2({ "uploads/a.txt": "hello" })));
```

A fake is seeded in the **stored** key space, not the store's: `fakeKV` keys carry the `prefix||` join and `fakeR2` keys carry the `prefix/` join,
because that is what the store writes. `fakeD1` also records every statement it was handed on `.calls`, which is how a test asserts that a value was
bound rather than concatenated. The fakes themselves are [`TEST_RUNNERS.md`][tr-7b] §7b's.

---

## Running without a binding in development

`required: false` turns an absent binding into `null` instead of a throw, for a feature the app can serve without:

```ts
const logStore = resolveKVStore(c, {
  binding: (c) => c.env.LOGS_KV,
  required: false, // null when absent — drop the KV log channel locally
  store: { codec: jsonCodec() },
});
```

Declare the same binding `optional: true` in the env schema so the registered check states what the code already does
([`STORAGE_BINDINGS.md`][sb-4b] §4b). Which features may degrade this way, and which must keep `required` at its default and fail closed, are
[§5a][sb-5a] and [§5b][sb-5b].

---

## Gotchas

**No client here accepts an `AbortSignal`, because no binding forge wraps does.** `StoreGetOptions` carries a `range` and nothing else; KV's and
D1's methods take no such option at all. A cancelled request therefore does not stop storage I/O already in flight — the platform decides when that
work ends — and **no storage client retries**, because how many attempts a call is worth is the consumer's decision, not this layer's. What is left
is the failure answer: catch it, log it, fail closed as a `503` ([`FORGE_ERRORS.md`][eh-5c] §5c), Cloudflare's `Network connection lost` included.

**KV is eventually consistent and globally cached.** A write is not immediately visible everywhere it can be read. Anything that must be read back
correctly the moment it is written belongs in D1.

**A KV `prefix` is a namespace, not a permission.** It keeps two logical stores from colliding inside one namespace; it does nothing to stop a
handler reading another prefix. Gate a sensitive read in the handler.

**`getOrSet` is not a lock.** Two concurrent misses both run the factory and both write — fine for a cache, wrong for anything that must run once.

**`rowsWritten` is D1's `changes`, not its `rows_written`** — the number of rows the statement matched, which is the signal a guard rests on, rather
than an IO counter that also counts index rows.

**Some inputs throw rather than returning a `Result`, because each is a programming error, not a storage failure**: a KV key containing the
reserved `||` separator, an empty-string `prefix` on `createKVStore` (it would silently mean "no prefix"), and an R2 key with a leading `/` or a
`.`/`..` segment — the last surfaces through the store's `Result`, since the store catches it for you.

---

## See also

- [`docs/STORAGE_BINDINGS.md`][sb] — the rulings behind every section here: the fragment brand (§1b), the batch boundary (§1g), the UUIDv7 trade
  (§1e), serving (§3b), signed URLs (§3c), the resolve/validate lifecycle (§4) and dev degradation (§5)
- [`docs/FORGE_ERRORS.md`][eh] — the `Result` every operation returns, and why resolving a binding throws instead
- [`docs/DATABASE_MANAGEMENT.md`][dm] — migrations, the schema fingerprint, and the `forge db` verbs the health report points at
- [`docs/TEST_RUNNERS.md`][tr-7b] §7b — `fakeD1`, `fakeKV` and `fakeR2`
- [`src/tooling/lint/README.md`][lint-readme] — `forge/sql-explicit-transaction`, the rule that refuses a runtime `BEGIN`

[dm]: ../../docs/DATABASE_MANAGEMENT.md
[eh]: ../../docs/FORGE_ERRORS.md
[eh-5c]: ../../docs/FORGE_ERRORS.md#5c-infrastructure-errors--log-and-fail-closed
[eh-5e]: ../../docs/FORGE_ERRORS.md#5e-startup-invariants--env-validation-and-binding-resolvers-throw
[lint-readme]: ../tooling/lint/README.md
[sb]: ../../docs/STORAGE_BINDINGS.md
[sb-1a]: ../../docs/STORAGE_BINDINGS.md#1a-created1client-factory
[sb-1b]: ../../docs/STORAGE_BINDINGS.md#1b-sql-tagged-template-for-queries
[sb-1e]: ../../docs/STORAGE_BINDINGS.md#1e-uuidv7--time-ordered-primary-keys
[sb-1f]: ../../docs/STORAGE_BINDINGS.md#1f-schema-health
[sb-1g]: ../../docs/STORAGE_BINDINGS.md#1g-transactions--batch-is-the-boundary
[sb-2b]: ../../docs/STORAGE_BINDINGS.md#2b-codecs--jsoncodec-textcodec-bytescodec
[sb-2c]: ../../docs/STORAGE_BINDINGS.md#2c-kvstore-operations
[sb-3b]: ../../docs/STORAGE_BINDINGS.md#3b-serveobject--direct-response-from-a-backend
[sb-3c]: ../../docs/STORAGE_BINDINGS.md#3c-signed-urls-for-secure-object-access
[sb-4a]: ../../docs/STORAGE_BINDINGS.md#4a-two-function-pattern
[sb-4b]: ../../docs/STORAGE_BINDINGS.md#4b-registering-binding-checks
[sb-4c]: ../../docs/STORAGE_BINDINGS.md#4c-structural-contracts--cast-free-platform-bindings
[sb-5a]: ../../docs/STORAGE_BINDINGS.md#5a-absent-bindings-in-local-dev
[sb-5b]: ../../docs/STORAGE_BINDINGS.md#5b-never-degrade-security
[tr-7b]: ../../docs/TEST_RUNNERS.md#7b-in-memory-storage-fakes--fakekv-faked1-faker2
