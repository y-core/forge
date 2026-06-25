# `@y-core/forge` — `crypto` (Internal)

> **Internal module — NOT a public namespace.**
> This directory is not exported from `package.json`. There is no `@y-core/forge/crypto`
> import path, and every symbol here is tagged `@internal`. Do not import from it directly.

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

## Using these capabilities

Consume the public namespaces that build on these primitives rather than this module:

- **Form signing / CSRF** → `@y-core/forge/form`
- **Session cookies / tokens** → `@y-core/forge/session`
- **Security headers / capability gating** → `@y-core/forge/security`
