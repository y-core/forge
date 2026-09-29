---
title: At-Rest Sealing
description: "How to seal a secret your app stores under a key ring of its own, re-seal it after a rotation, and retire an old root secret safely."
audience: consumer
---

# `@y-core/forge/keyring`

A value your app has to store and read back later — a webhook signing secret, a third-party API token — is sealed here under a root secret that
belongs to your app alone. Each frame is AES-256-GCM under a subkey derived for the purpose you name, bound to the row it is stored in.

```ts
import { atRestKeyId, importKeyRing, keyRingSecrets, openAtRest, sealAtRest, type AtRestBinding, type KeyRing } from "@y-core/forge/keyring";
```

---

## Getting started

Give the ring a variable of its own, such as `APP_SEAL_KEY_RING`, holding 32 random bytes of hex — the shape `openssl rand -hex 32` produces.
**Never reuse the auth secret** — see [Gotchas](#gotchas). `keyRingSecrets` splits the variable into the list `importKeyRing` takes:

```ts
const ring = await importKeyRing(keyRingSecrets(c.env.APP_SEAL_KEY_RING));
```

Seal the value and store the frame as a blob:

```ts
const binding = { purpose: "webhook-secret", context: new TextEncoder().encode(`webhooks ${webhookId}`) };
const frame = await sealAtRest(ring, binding, new TextEncoder().encode(secret));
await db.execute(sql`UPDATE webhooks SET secret = ${frame} WHERE id = ${webhookId}`);
```

Open it with the same binding. A refusal is a `Result`, never a throw:

```ts
const opened = await openAtRest(ring, binding, row.secret);
if (!opened.ok) return refuse(opened.error); // "no-key" or "unopenable"
const secret = new TextDecoder().decode(opened.data.plaintext);
```

---

## Choosing a purpose and a context

**The purpose is a name your app chooses**, and each one gets its own subkey. Give every kind of stored value its own purpose: a webhook secret and
an API token sealed under one purpose share a key they have no reason to share.

**The context is mandatory, and it is what binds a frame to its row.** It is authenticated with the ciphertext without being stored in it, so
build it from what identifies the row — the table and the primary key. A frame copied into another row does not open there, which is what stops a
database write from moving a working secret between accounts. `sealAtRest` and `openAtRest` throw on an empty purpose or an empty context.

---

## What a frame is

A frame is `kid(6) ‖ nonce(12) ‖ ciphertext‖tag(16)`, so an empty plaintext still seals to 34 bytes, and anything shorter is damaged. Store it as a
blob.

**The frame carries no version byte, and it never will.** A version byte would be a second frame format for every reader to accept. A new
derivation arrives as a new domain string inside forge instead, so a frame you store today opens under every later release. `auth` keeps its own
domain, `y-core/forge/auth/v1`, which is why a TOTP secret sealed before this namespace existed still opens.

---

## Re-sealing on open

`openAtRest` answers the key id the frame was sealed under. Compare it with the ring's active key id, and when they differ, seal the plaintext
again and write the new frame back:

```ts
if (opened.data.kid !== ring.activeKeyId) {
  const resealed = await sealAtRest(ring, binding, opened.data.plaintext);
  await db.execute(sql`UPDATE webhooks SET secret = ${resealed} WHERE id = ${webhookId}`);
}
```

That write is how rows migrate to a new secret: every row read after a rotation moves itself.

---

## Rotating the root secret

**A rotation is prepending a secret, never replacing one.** The ring variable holds hex root secrets comma-joined, newest first; the first seals,
and every one opens:

```bash
APP_SEAL_KEY_RING=9c1e…,ab3f…
```

`keyRingSecrets` trims each entry and throws on an empty value or an empty entry. Replacing the secret instead makes every stored row unopenable,
so **mark the ring `# forge:ring`** in `.dev.vars`: `forge cf sync --commit --local --rotate APP_SEAL_KEY_RING` then prepends a new key there
and keeps the old ones. The deployed ring is rotated by hand, never pushed from `.dev.vars`. The mechanism for both is
[`src/tooling/cf/README.md`][cf-readme-rotate]'s "Rotating a key ring".

**Rotate on a schedule, not only on suspicion.** Every seal spends the random-nonce budget of its `(key, purpose)` subkey. The bound, the
cadence it sets and why forge counts nothing are [`AUTH_MOUNTING.md`][am-7] §7's, and they hold for this ring unchanged.

---

## Retiring an old secret

An old secret can leave the ring once no row is sealed under it. `atRestKeyId(frame)` reads the key id off a frame without a ring, so you can
count the rows whose frame names a key other than `ring.activeKeyId`. Drop the secret only when that count is zero.

**Re-sealing on open only moves the rows somebody reads.** A row nobody opens keeps the old key id forever, and the count never reaches zero. A
sweep that finishes the job is yours to write and to schedule, the same way `auth` leaves `purgeStaleTotpSecrets` to you. Open every row still
under an old key and write it back sealed under the active one. Build the binding with the same function your app reads the row with, so the
sweep cannot open under a binding the app never uses:

```ts
const webhookBinding = (id: string) => ({ purpose: "webhook-secret", context: new TextEncoder().encode(`webhooks ${id}`) });

const unopenable: string[] = [];
for (const row of await db.all(sql`SELECT id, secret FROM webhooks WHERE secret IS NOT NULL`)) {
  if (atRestKeyId(row.secret) === ring.activeKeyId) continue;
  const opened = await openAtRest(ring, webhookBinding(row.id), row.secret);
  if (opened.ok) {
    const secret = await sealAtRest(ring, webhookBinding(row.id), opened.data.plaintext);
    await db.execute(sql`UPDATE webhooks SET secret = ${secret} WHERE id = ${row.id}`);
  } else if (opened.error === "no-key") {
    throw new Error(`webhooks ${row.id}: its key is off the ring — put the secret back first`);
  } else {
    unopenable.push(row.id);
  }
}
```

**The sweep never clears a row.** It re-seals what opens, stops on `no-key` so you can put the old secret back and run it again, and reports the
rows that answer `unopenable`. Clearing those is a separate decision: first confirm the binding by opening a row the app reads successfully. If
every row is unopenable, suspect the binding, not the data. Drop the old secret only once a run finishes with nothing left under it.

The refusals tell you which mistake you made:

- **`no-key`** — the frame names a key the ring does not hold. Put the secret back and the row opens again.
- **`unopenable`** — the frame did not authenticate under this binding: a wrong purpose or context, or damaged bytes. Under the binding your app
  reads with, the row is lost; under a mistyped one, it is not.

---

## Gotchas

**One ring per root secret: never seal under the auth key ring or its secret.** `authKeysRetirable` counts only TOTP factors, so it answers true
while your rows are still sealed under the auth secret — and retiring that secret on its word destroys them. `sealAtRest` refuses a ring
`importKeyRing` did not build, so passing it the auth key ring throws. It cannot tell that the hex you gave `importKeyRing` is the auth secret, so
keeping the two secrets apart is still yours.

**Never use `encodeAuthToken` with a long TTL as an at-rest cipher.** A token is built to expire, and its key is retired on the auth schedule, not
on yours.

**`atRestKeyId` is unauthenticated.** It reads the frame's first bytes and trusts nothing else; use it to count rows, never to decide whether one
is genuine.

---

## See also

- [`docs/NAMESPACES.md`][namespaces-5k] §5k — what belongs here rather than in `auth` or `crypto`
- [`src/auth/README.md`][auth-readme] — the auth key ring, which this namespace never shares a secret with
- [`src/crypto/README.md`][crypto-readme] — the primitives a frame is built from

[am-7]: ../../docs/AUTH_MOUNTING.md#7-rotating-the-key-ring
[auth-readme]: ../auth/README.md
[cf-readme-rotate]: ../tooling/cf/README.md#rotating-a-key-ring
[crypto-readme]: ../crypto/README.md
[namespaces-5k]: ../../docs/NAMESPACES.md#5k-keyring--at-rest-sealing-under-the-apps-own-root-secret
