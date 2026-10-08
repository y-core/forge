---
title: Cryptography
description: "Sign, seal and derive values under the app's own root secret — every cryptographic capability an app imports lives under `crypto`."
audience: consumer
---

# `@y-core/forge/crypto`

Cryptography for the app lives under `crypto`. **There is no top-level `crypto` barrel.** Import from the subpath:

- `@y-core/forge/crypto/keyring` — the app's root secrets as a key ring: seal a stored secret and open it again, derive a keyed pseudonym for an
  id, and rotate or retire a key. CSRF tokens, signed cookies and R2 signed URLs sign under the same ring.

`crypto/primitives` is the other child, and it is sealed: it has no import path, and the namespaces you import build on it for you. When none of
them exposes what you need, the answer is a new export on the namespace that owns the concern.

---

## See also

- [`src/crypto/keyring/README.md`][keyring-readme] — the key ring, sealing, pseudonyms, rotation and retirement
- [`docs/NAMESPACES.md`][namespaces-5k] §5k — what belongs under `crypto`, and why `primitives` is sealed

[keyring-readme]: ./keyring/README.md
[namespaces-5k]: ../../docs/NAMESPACES.md#5k-cryptokeyring--values-signed-or-sealed-under-the-apps-own-root-secret
