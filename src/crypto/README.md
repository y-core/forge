---
title: Internal Cryptographic Primitives
description: "A sealed internal module — not an import path. Its capabilities surface through the barrel of whichever namespace owns the concern."
audience: internal
---

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

- `@y-core/forge/auth`
- `@y-core/forge/form`
- `@y-core/forge/session`
- `@y-core/forge/security`

## What it provides

The module groups a small set of stateless primitives (all `@internal`):

- **UTF-8 encoding / decoding** — string ⇆ bytes via shared encoder/decoder singletons
- **Hex encoding / decoding** — bytes ⇆ lowercase hex strings
- **base64 encoding / decoding** — bytes ⇆ standard-alphabet base64 with padding retained, the
  decoder strict: the base64url alphabet is rejected rather than remapped, because the wire formats
  that use this one must not accept a string the encoder could never have produced
- **base64url encoding / decoding** — bytes ⇆ unpadded base64url, the encoder defined as the base64
  one with `+`/`/`/`=` substituted, the decoder lenient about both alphabet and padding
- **base32 encoding / decoding** — bytes ⇆ RFC 4648 base32, unpadded, decoding a character
  outside the alphabet as a failure rather than skipping it
- **HMAC-SHA-256 sign / verify** — key import (raw bytes or validated hex secret) plus
  signing and verification
- **HKDF-SHA-256 extract / expand** — RFC 5869, split into the two steps so one root secret
  yields a pseudorandom key that many per-purpose subkeys expand from
- **AES-256-GCM seal / open** — authenticated encryption with a 12-byte nonce, where opening
  a forged, mis-keyed or mis-associated ciphertext returns `null`
- **HOTP / TOTP** — RFC 4226 counter codes and the RFC 6238 time construction over them, taking
  the clock reading as an argument so a caller decides the verification window
- **CBOR decoding** — the CTAP2 canonical subset, reporting the byte offset the first item ended
  at so a caller reaches the bytes that follow it without re-encoding to measure
- **COSE key decoding** — a COSE_Key map to the algorithm and the raw public-key material a
  verifier imports, for ES256, EdDSA and RS256
- **DER unwrapping** — an ASN.1 DER ECDSA signature to the right-aligned fixed-width `r‖s` pair
  WebCrypto verifies
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

They live here rather than in `storage/db` so that `storage/kv`, `auth`, or anything else
needing a sortable identifier can consume them without a cross-namespace import. Consumers reach
them through **`@y-core/forge/storage/db`**, the namespace whose primary keys they exist for. There
is still no importable `crypto` path.

The design rationale — the frozen Workers clock, the counter, the module-level-state carve-out, and
the "not a secret" caveat — lives in `docs/STORAGE_BINDINGS.md` §1e.

**Anything `@public` added here must be added by hand to a surfacing barrel.** `validate-exports`
scans only the source files owned by an exported namespace, so its source → barrel pass does not
see this directory.

## Using these capabilities

Consume the public namespaces that build on these primitives rather than this module:

- **Credentials, tokens and one-time codes** → `@y-core/forge/auth`
- **Form signing / CSRF** → `@y-core/forge/form`
- **Session cookies / tokens** → `@y-core/forge/session`
- **Security headers / capability gating** → `@y-core/forge/security`
- **UUIDv7 record identifiers** → `@y-core/forge/storage/db`
