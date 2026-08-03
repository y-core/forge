---
title: Storage Bindings
description: "The D1, KV, and R2 namespaces: typed clients, codecs, object serving, the resolve/validate binding pattern, and dev degradation."
---

# Storage Bindings

> Owns forge's three storage namespaces — D1, KV, and R2 — their typed clients, the binding
> resolve/validate pattern, and the absent-binding policy. Owns the functional-shape check (§4a).
>
> Defers to: [`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §4b and §5e for the throw-vs-`Result`
> boundary and the `serveObject` exception; [`STRUCTURED_LOGGING.md`](./STRUCTURED_LOGGING.md)
> §2d for the KV channel-selection pattern; `src/storage/README.md` for the structural-contract
> rationale and worked usage.

---

## 0. Quick Reference

- §1 storage/db — D1 Database Client: typed queries over a D1 binding
- §1a createD1Client Factory: wrapping the raw binding
- §1b sql Tagged Template for Queries: the only injection-safe query form
- §1c resolveD1Client — From the Request Context: binding selector at request time
- §1d validateD1Binding — Binding Validation Middleware: first-request shape check
- §1e uuidv7 — Time-Ordered Primary Keys: the monotonic counter, the frozen Workers clock, and the TEXT-versus-BLOB trade
- §2 storage/kv — KV Store: codec-aware key-value access
- §2a createKVStore Factory: the required codec option
- §2b Codecs — jsonCodec, textCodec, bytesCodec: selection rules
- §2c KVStore Operations: the async surface and TTL floor
- §2d resolveKVStore and validateKVBinding: the KV form of the pattern
- §3 storage/r2 — Object Store: object storage and HTTP serving
- §3a createObjectStore Factory: backend in, typed store out
- §3b serveObject — Direct Response from a Backend: statuses and Content-Disposition
- §3c Signed URLs for Secure Object Access: length-prefixed HMAC and verification order
- §3d r2Backend — Storage Backend Adapter: the testable seam
- §3e Binding Validation for R2: the R2 form of the pattern
- §4 Binding Resolve/Validate Pattern: the shared lifecycle contract
- §4a Two-Function Pattern: validate as middleware, resolve at request time
- §4b Registering Binding Checks: where the middleware goes
- §4c Structural Contracts — Cast-Free Platform Bindings: why the `*Like` supertypes exist
- §5 Dev Degradation: absent bindings in local development
- §5a Absent Bindings in Local Dev: the permitted guard patterns
- §5b Never Degrade Security: what must fail closed

---

## 1. storage/db — D1 Database Client

### 1a. createD1Client Factory

`createD1Client(binding, options?)` wraps a raw `D1Database` with a typed client. Pass the
binding directly from `c.env`. The only option is `logQueries` (default `false`).

```typescript
const db = createD1Client(c.env.DB, { logQueries: debug })
```

### 1b. `sql` Tagged Template for Queries

The `sql` tag produces a `SqlFragment` — the parameterized query string plus its bound values.

**This is the only safe way to build a D1 query. Never use string concatenation.**
`D1Client.query` / `queryOne` / `execute` / `batch` accept a `SqlFragment` only.

```typescript
const rows = await db.query(sql`SELECT * FROM users WHERE id = ${userId}`)
```

`isSqlFragment(value)` is the type guard for generic helpers that must reject raw strings. It is a
**provenance** check, not a structural one: `SqlFragment` carries a `unique symbol` brand that only
`sql` sets and that `mod.ts` does not re-export, so a hand-built `{text, params}` literal — notably
anything `JSON.parse` returns — is rejected and gets bound as a parameter rather than spliced into
the statement text. Duck-typing this guard was a SQL-injection path.

### 1c. resolveD1Client — From the Request Context

`resolveD1Client(c, { binding })` reads the binding out of the request context via a selector
and builds the typed client, so callers need not thread the binding reference through.

**It throws when the binding is absent** (§4a); pass `required: false` to receive `null`.

### 1d. validateD1Binding — Binding Validation Middleware

`validateD1Binding(name)` returns a `Middleware` that shape-checks the named binding on the
first request. **Register it with `app.use("*", …)`** so the check runs before any handler.

The check is functional, not merely presence-based — §4a owns the rule.

### 1e. uuidv7 — Time-Ordered Primary Keys

`uuidv7()` returns a canonical UUIDv7 string for use as a row identifier: unique and
non-guessable-as-a-sequence, yet lexicographically sortable by creation time. Sequential keys
append to the right edge of the primary-key B-tree instead of scattering inserts across it, and
`ORDER BY id` becomes a free cursor. `createUuidv7(options?)` is the factory form, taking an
injected clock.

**The 12-bit `rand_a` field carries a monotonic counter, not randomness** (RFC 9562 Method 1,
Section 6.2), and on Workers that is load-bearing rather than an optimisation. `Date.now()` does not
advance during synchronous execution — it is frozen at the time of the last I/O as a timing-attack
mitigation — so *every* ID minted between two awaits reads the same millisecond. A textbook
UUIDv7 with a random `rand_a` therefore emits a batch in random order, losing the single property
it was chosen for. The counter reseeds to a random 10-bit value on each clock advance, leaving
≥3072 increments of headroom; on overflow the generator borrows the next millisecond and repays it
when the wall clock catches up. A backwards clock step is absorbed the same way.

**The module-level default generator is a deliberate exception to
[`PRODUCTION_TS_RULES.md`](./PRODUCTION_TS_RULES.md) §1a.** That rule prohibits *request-scoped*
data in module scope, and its rationale is bleed between recycled isolates. The retained state is
a timestamp and a counter — nothing request-derived — and the cross-request bleed is exactly what
stops two requests sharing an isolate from colliding inside one frozen millisecond. Code needing
isolated or clock-injected state calls `createUuidv7` instead.

**A UUIDv7 is not a secret.** It discloses its creation time and its mint rate by construction.
It is a primary key, never a session token or an unguessable URL component.

**`TEXT` is the default; `BLOB` is a per-table density trade.** `uuidv7Bytes()` mints the same
value as its raw 16 octets, most-significant first, which is the order SQLite's `memcmp` sorts a
`BLOB` by — so ordering is identical either way. Storing bytes costs roughly a quarter of the
combined table-and-index footprint, and costs readable output in every console query, log line,
`wrangler d1 execute` result and `json_object()` projection. Take it on tables you do not hand-
query, not as a schema-wide default. `uuidFromBytes` renders a value read back — including the
`number[]` D1 returns for a `BLOB` column, since its JSON transport has no binary type — and
`uuidToBytes` parses a string ID for binding against one. Both forms come from **one shared
generator**, so an application mixing them still gets a single global ordering.

**Do not reach for `WITHOUT ROWID` to shrink a UUID key.** In an ordinary rowid table every
secondary index entry carries the implicit integer rowid, not the primary key, so a 36-character
id costs two fixed copies per row regardless of how many indexes the table has. `WITHOUT ROWID`
makes the id the table key, which appends it to *every* secondary index entry — past one index it
is a net loss.

**It is implemented in the sealed-internal `crypto` module and surfaced here** — see
[`NAMESPACE_DESIGN.md`](./NAMESPACE_DESIGN.md) §3b for why, and for the manual barrel discipline
that placement costs.

---

## 2. storage/kv — KV Store

### 2a. createKVStore Factory

`createKVStore(binding, options)` wraps a raw `KVNamespace` with a typed, codec-aware store. The
generic `T` flows through every get/put/list operation.

**The `codec` option is required** — select the codec matching the format already stored in the
namespace, or the format you intend to write.

### 2b. Codecs — jsonCodec, textCodec, bytesCodec

A codec is an `{ encode, decode }` pair mapping between KV's wire format and the application
type.

- **`jsonCodec<T>()`** — structured records, arrays, any typed data. The common case.
- **`textCodec()`** — plain strings: tokens, slugs, flags.
- **`bytesCodec()`** — binary blobs that must remain unmodified.

### 2c. KVStore Operations

All operations are async: `get(key)` → `T | null`, `put(key, value, options?)`, `delete(key)`,
`list(options?)` → `KVListResult<T>`.

**`expirationTtl` is in seconds, and the platform enforces a 60-second minimum** — shorter TTLs
are rejected by KV itself.

### 2d. resolveKVStore and validateKVBinding

These mirror the D1 pair (§1c, §1d). `resolveKVStore(c, opts)` takes both a `binding` selector
and `store` codec options so the returned store is immediately typed.

```typescript
app.use("*", validateKVBinding("LOGS_KV"))

const store = resolveKVStore(c, {
    binding: (c) => c.env.LOGS_KV,
    store: { codec: jsonCodec() },
})
```

---

## 3. storage/r2 — Object Store

### 3a. createObjectStore Factory

`createObjectStore(backend, options?)` wraps an `ObjectStorageBackend` — **not a raw
`R2Bucket`**. Adapt a bucket with `r2Backend(bucket)` first (§3d). The options are just
`{ prefix? }`.

**There is no `logger` option.** The R2 store performs no per-operation logging; to observe
object access, log at the call site or through a logging channel.

### 3b. serveObject — Direct Response from a Backend

`serveObject(backend, request, key, options?)` retrieves an object and returns a fully-formed
`Response` ready to return from a handler: `200` with the body, `206` for a satisfied `Range`,
`304` for a matching `If-None-Match`, `404` when absent, `416` for an unsatisfiable range. It
sets `Content-Type`, `ETag`, `Accept-Ranges`, `Content-Length`, and `Cache-Control`.

**No `null` check is needed** — a missing object yields a `404` `Response`, never an unhandled
rejection.

`ServeOptions` accepts `cacheControl` and `contentDisposition` (`"inline" | "attachment"`).

**When a disposition is set, `Content-Disposition` carries an RFC 5987 `filename*=UTF-8''…`
parameter with the exact name plus an ASCII `filename="…"` fallback** for clients that ignore it.
The fallback is an approximation, never a strip: accents fold to their base letter, every other run
of non-printable-ASCII collapses to a single `_` — which keeps the extension and guarantees a
non-empty fallback for a wholly non-ASCII name — and quotes and backslashes are emitted as
quoted-pairs, so a crafted object key cannot break out of the quoted string. A non-Latin-1 character
must never reach the `filename=` parameter: `Headers.set` throws on it, turning a legitimate
download into a 500.

`ObjectStore` exposes the same behaviour bound: `store.serveObject(c.request, key, options?)`.

### 3c. Signed URLs for Secure Object Access

`createSignedObjectUrl(signingKey, baseUrl, objectKey, options?)` produces an HMAC-SHA-256-signed
URL expiring after `expiresInSeconds` (default `3600`), appending `?key=`, `?exp=`, and `?sig=`.
Import the key once with `importSigningKey`.

**The HMAC covers a length-prefixed payload — `${key.length}:${key}|${exp}`** — so the key/exp
boundary stays unambiguous even when the object key itself contains the `|` delimiter.

`verifySignedObjectUrl(signingKey, url)` **checks expiry first, then compares signatures in
constant time**, returning `{ ok: true, key }` or `{ ok: false, reason }` (`"expired"`,
`"invalid-signature"`, `"invalid-format"`).

**`hexSecret` must come from a secret binding, never from source code. Never serve an object
from a signed-URL path without verifying the signature first.**

### 3d. r2Backend — Storage Backend Adapter

`r2Backend(bucket)` adapts a Cloudflare `R2Bucket` into the `ObjectStorageBackend` every R2
helper consumes. **Both `createObjectStore` and `serveObject` take a backend rather than a raw
bucket, which is what keeps the storage layer testable against an in-memory backend.**

### 3e. Binding Validation for R2

`validateR2Binding(name)` and `resolveObjectStore(c, opts)` follow the same pattern as D1 (§1c,
§1d) and KV (§2d). The resolver wraps the bucket with `r2Backend` for you.

---

## 4. Binding Resolve/Validate Pattern

### 4a. Two-Function Pattern

Every storage namespace provides two functions with distinct lifecycle roles:

| Function | Role |
|---|---|
| `validateXBinding(name)` | Returns a `Middleware`; register via `app.use` to shape-check the binding on first request |
| `resolveX(c, opts)` | Request time: read the binding off `c` via a `binding` selector and build the typed client |

**The validation is a functional-shape check, not a presence check.** KV and R2 require
`typeof binding.get` and `typeof binding.put` to be `"function"`; D1 requires `typeof
binding.prepare`. **A string or number mistakenly bound to the name is rejected at the boundary**,
rather than failing deep inside a handler. Every `validate*` and `resolve*` in §1–§3 uses this
one rule.

**Resolver error policy — throw, never `Result`.** A missing binding is a deployment defect, so
`resolve*` **throws**. Once resolved, store and client *operations* return `Result<T, E>`,
because runtime storage failures are expected errors.

**The boundary is: resolution throws (fail closed); operations return `Result`.** The
`required: false` escape hatch produces `null` instead of a throw, and is for
non-security-critical features only (§5b, [`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §4b, §5e).

### 4b. Registering Binding Checks

**Register every `validateXBinding` with `app.use("*", …)` before `app.map(routes, controller)`**,
so the checks sit ahead of route handlers in the chain and the worker never serves a request with
a broken binding.

```typescript
app.use("*", validateD1Binding("DB"))
app.use("*", validateKVBinding("LOGS_KV"))
app.use("*", validateR2Binding("ASSETS_BUCKET"))
```

**Each middleware caches the validated env reference**, so the shape check runs once per env,
not per request.

For arbitrary non-storage env fields, `validateBindings(schema)` builds a `Middleware` from any
valibot schema — the storage helpers are thin wrappers over it. Its canonical home is
`@y-core/forge/context`.

---

### 4c. Structural Contracts — Cast-Free Platform Bindings

Each storage namespace publishes *neutral* interfaces (`R2Bucket`, `KVNamespace`, `D1Database`)
so consumers do not couple to `@cloudflare/workers-types`. But pinning a binding selector to the
exact neutral type conflates what the resolver **accepts** (the platform binding off `c.env.X`)
with what the adapter **exposes**, which forced an `as unknown as R2Bucket` cast at every R2 call
site.

**The fix is a structural contract typed to exactly the consumed surface, paired with a generic
resolver constrained to it:**

| Backend | Contract | Generic resolver |
|---|---|---|
| R2 | `R2BucketLike` (+ `R2ObjectLike` / `R2ObjectBodyLike` / `R2ListLike` / `R2PutLike`) | `resolveObjectStore<Bindings, B extends R2BucketLike>` |
| KV | `KVNamespaceLike` | `resolveKVStore<Bindings, T, NS extends KVNamespaceLike>` |
| D1 | `D1DatabaseLike` | `resolveD1Client<Bindings, DB extends D1DatabaseLike>` |

The `*Like` interfaces are a structural **supertype** of both forge's neutral type and the
platform's runtime type. Because the binding return is *constrained to* the contract rather than
*pinned to* the neutral type, the compiler infers the concrete type and proves it satisfies the
contract — **no cast at any call site.**

**Where a platform brand genuinely forces a cast, localise it once inside the adapter — never in
a resolver or a consumer.** The full rationale is in `src/storage/README.md`.

## 5. Dev Degradation

### 5a. Absent Bindings in Local Dev

Running tests or `wrangler dev` without a full binding configuration leaves storage bindings
`undefined`. **Each namespace must be handled explicitly for non-critical features:**

- **KV logging** — select channels per request and fall back to console-only
  ([`STRUCTURED_LOGGING.md`](./STRUCTURED_LOGGING.md) §2d).
- **Rate limiting** — pass `required: false` so the middleware no-ops.
- **D1** — provide in-memory fakes in tests rather than branching in production code paths.
- **Optional resolvers** — pass `required: false` to receive `null` instead of a throw.

### 5b. Never Degrade Security

**Graceful degradation is acceptable only for features that are non-critical to correctness and
security:** structured logging (drop the KV channel), rate limiting (no-op), analytics (skip the
write).

**Security-critical features must fail closed when a binding is missing:** a CSRF token store, an
auth session store, or the database backing user data must **throw** rather than serve.

**Never introduce a conditional that silently skips security enforcement because a binding is
absent.** Use `validateBindings` (§4b) to guarantee those bindings exist before the worker
reaches a serving state.
