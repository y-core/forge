# `@y-core/forge` — `crypto` (Internal)

> **Internal module — NOT a public namespace.**
> This directory is not exported from `package.json`. There is no `@y-core/forge/crypto`
> import path. Do not import from it directly.
>
> **Sealed refers to the path, not to every symbol.** Almost everything here is `@internal`
> plumbing, but a capability may live here and be surfaced publicly through the barrel of the
> namespace that owns its concern — see [UUIDv7](#uuidv7) below.

## Purpose

`crypto/` provides shared cryptographic primitives consumed internally by other forge
namespaces. It exists to avoid duplicating low-level encoding and signing logic across
the namespaces that need it — it is plumbing, not a stable surface.

It is used internally by:

- `@y-core/forge/form`
- `@y-core/forge/session`
- `@y-core/forge/security`

## What it provides

The module groups a small set of stateless primitives (all `@internal`):

- **UTF-8 encoding / decoding** — string ⇆ bytes via shared encoder/decoder singletons
- **Hex encoding / decoding** — bytes ⇆ lowercase hex strings
- **base64url encoding / decoding** — bytes ⇆ unpadded base64url
- **HMAC-SHA-256 sign / verify** — key import (raw bytes or validated hex secret) plus
  signing and verification
- **SHA-256 digest** — hash a string or byte array to raw bytes
- **Random bytes** — cryptographically secure random byte generation
- **Timing-safe comparison** — constant-time byte and string equality (Cloudflare
  Workers `crypto.subtle.timingSafeEqual`)

These are documented here only to describe the module's scope; none of them are part of
the public API.

## UUIDv7

`uuid.ts` is the exception to the `@internal` pattern above. It implements UUIDv7 (RFC 9562 §5.7)
with the §6.2 Method 1 monotonic counter, plus the byte codec for storing one in a `BLOB` column.
Its exported symbols — `uuidv7`, `uuidv7Bytes`, `uuidFromBytes`, `uuidToBytes`, `createUuidv7`,
`createUuidv7Bytes`, and the `Uuidv7Options` / `UuidByteInput` types — are all `@public`.

They live here rather than in `storage/db` so that `storage/kv`, a future `auth`, or anything else
needing a sortable identifier can consume them without a cross-namespace import. Consumers reach
them through **`@y-core/forge/storage/db`**, the namespace whose primary keys they exist for. There
is still no importable `crypto` path.

The design rationale — the frozen Workers clock, the counter, the module-level-state carve-out, and
the "not a secret" caveat — lives in `.decisions/implementation/STORAGE_BINDINGS.md` §1e.

**Anything `@public` added here must be added by hand to a surfacing barrel.** `validate-exports`
scans only the source files owned by an exported namespace, so its source → barrel pass does not
see this directory.

## Using these capabilities

Consume the public namespaces that build on these primitives rather than this module:

- **Form signing / CSRF** → `@y-core/forge/form`
- **Session cookies / tokens** → `@y-core/forge/session`
- **Security headers / capability gating** → `@y-core/forge/security`
- **UUIDv7 record identifiers** → `@y-core/forge/storage/db`
