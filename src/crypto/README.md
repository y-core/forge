---
title: Internal Cryptographic Primitives
description: "A sealed internal module — not an import path. Its capabilities surface through the barrel of whichever namespace owns the concern."
audience: internal
---

# `@y-core/forge` — `crypto` (Internal)

**There is no `@y-core/forge/crypto` import path.** This directory is not exported from `package.json`, and nothing outside forge can reach it. It
holds the low-level encoding, signing, derivation and one-time-code primitives the namespaces below share — plumbing, not a surface.

---

## Reaching these capabilities

Import the namespace that owns the concern. Each already builds on what is here.

| You want | Import |
| --- | --- |
| Credentials, tokens, one-time codes | `@y-core/forge/auth` |
| Form signing and CSRF | `@y-core/forge/form` |
| Session cookies and tokens | `@y-core/forge/session` |
| Security headers and capability gating | `@y-core/forge/security` |
| UUIDv7 record identifiers | `@y-core/forge/storage/db` |

If none of them exposes what you need, the answer is a new export on the namespace that owns the concern — never a direct import of this directory.

---

## Gotchas

**Sealed refers to the path, not to every symbol.** Almost everything here is `@internal`, but a capability may live here and still be `@public`,
surfaced through the barrel of the namespace that owns its concern. `uuid.ts` is the standing example: UUIDv7 and its `BLOB` byte codec live here,
and consumers reach them through `@y-core/forge/storage/db`.

**Anything `@public` added here must be added by hand to a surfacing barrel.** `validate-exports` scans only the source files owned by an exported
namespace, so its source → barrel pass does not see this directory. A `@public` symbol left unexported here is invisible to the gate and to every
consumer.

---

## See also

- [`docs/STORAGE_BINDINGS.md`][sb-1e] §1e — the UUIDv7 design rationale: the frozen Workers clock, the counter, the module-level-state carve-out,
  and the "not a secret" caveat
- [`docs/NAMESPACES.md`][namespaces] — which namespace a new capability belongs to

[namespaces]: ../../docs/NAMESPACES.md
[sb-1e]: ../../docs/STORAGE_BINDINGS.md#1e-uuidv7--time-ordered-primary-keys
