---
title: The App Key Ring
description: "How to hold your app's root secrets as one key ring — seal a stored secret, derive a keyed stand-in for an id, sign what forge signs, and rotate and retire the secrets safely."
audience: consumer
---

# `@y-core/forge/crypto/keyring`

Your app's root secrets live here as one key ring. From it you seal a value your app stores and reads back later — a webhook signing secret, a
third-party API token — and derive a pseudonym, a keyed stand-in for an id that nobody without the secret can reverse. Forge's CSRF tokens, signed
cookies and R2 signed URLs sign under the same ring, each with a subkey of its own.

```ts
import {
  atRestKeyId,
  derivePseudonym,
  importKeyRing,
  openAtRest,
  parseKeyRingSecrets,
  sealAtRest,
  type AtRestBinding,
  type KeyRing,
  type PseudonymRequest,
} from "@y-core/forge/crypto/keyring";
```

---

## Getting started

Give the ring a variable of its own, such as `APP_SEAL_KEY_RING`, holding 32 random bytes of hex — the shape `openssl rand -hex 32` produces.
**Never reuse the auth secret** — see [Gotchas](#gotchas). `parseKeyRingSecrets` splits the variable into the list `importKeyRing` takes:

```ts
const ring = await importKeyRing(parseKeyRingSecrets(c.env.APP_SEAL_KEY_RING));
```

Import the ring once per `env` and hand the same one to everything below.

---

## Sealing a stored secret

Seal the value and store the frame as a blob. Each frame is AES-256-GCM under a subkey derived for the purpose you name, bound to the row it is
stored in:

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

### Choosing a purpose and a context

**The purpose is a name your app chooses**, and each one gets its own subkey. Give every kind of stored value its own purpose: a webhook secret and
an API token sealed under one purpose share a key they have no reason to share.

**The context is mandatory, and it is what binds a frame to its row.** It is authenticated with the ciphertext without being stored in it, so
build it from what identifies the row — the table and the primary key. A frame copied into another row does not open there, which is what stops a
database write from moving a working secret between accounts. `sealAtRest` and `openAtRest` throw on an empty purpose or an empty context.

### What a frame is

A frame is `kid(6) ‖ nonce(12) ‖ ciphertext‖tag(16)`, so an empty plaintext still seals to 34 bytes, and anything shorter is damaged. Store it as a
blob.

**The frame carries no version byte, and it never will.** A version byte would be a second frame format for every reader to accept. A new
derivation arrives as a new domain string inside forge instead, so a frame you store today opens under every later release. `auth` keeps its own
domain, `y-core/forge/auth/v1`, which is why a TOTP secret sealed before this namespace existed still opens.

### Re-sealing on open

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

## Deriving a pseudonym

When an id has to appear somewhere you do not trust with the id itself — a browser storage name, an analytics key, a log field — derive a
pseudonym for it instead:

```ts
const storeName = `notes-v1:${await derivePseudonym(ring, { purpose: "notes-store", value: userId })}`;
```

The answer is 64 characters of lowercase hex: HMAC-SHA-256 of the value under a subkey derived for the purpose. The same ring, purpose and value
always answer the same pseudonym, so it works as a lookup key, and nobody without the root secret can compute one or reverse one. A string value
is keyed as its UTF-8 bytes, and a `Uint8Array` as given.

**Give every use its own purpose**, as with sealing: two purposes answer unrelated pseudonyms for one id, so a store name cannot be joined against
an analytics key. Pseudonyms are derived under subkeys of their own, so a purpose name you also seal under shares nothing with it. `derivePseudonym`
throws on an empty purpose, and refuses a ring `importKeyRing` did not build.

---

## What else signs under this ring

**CSRF tokens, signed cookies and R2 signed URLs take this ring too.** Pass the same `KeyRing` to `csrfProtection`, `createSignedCookie` and
`createSignedObjectUrl`: each derives an HMAC subkey for a purpose of its own, so none of them shares a key with a sealed frame, a pseudonym or
each other. Each carries the ring's key id on the wire, so a rotation keeps what was signed before it verifying until the old secret leaves the
ring. Each refuses the auth key ring, as `sealAtRest` and `derivePseudonym` do.

How each is wired is its own document's: [`INPUT_VALIDATION.md`][iv-3b] §3b for CSRF, [`src/session/README.md`][session-readme] for signed
cookies, and [`STORAGE_BINDINGS.md`][sb-3c] §3c for signed URLs.

---

## Rotating the root secret

**A rotation is prepending a secret, never replacing one.** The ring variable holds hex root secrets comma-joined, newest first; the first seals,
and every one opens:

```bash
APP_SEAL_KEY_RING=9c1e…,ab3f…
```

`parseKeyRingSecrets` trims each entry and throws on an empty value or an empty entry. Replacing the secret instead makes every stored row
unopenable, so **mark the ring `# forge:ring`** in `.dev.vars`: `forge cf sync --commit --local --rotate APP_SEAL_KEY_RING` then prepends a new key
there and keeps the old ones. The deployed ring is rotated by hand, never pushed from `.dev.vars`. The mechanism for both is
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

**Rotating the ring changes every pseudonym.** A pseudonym is derived under the active key, so prepending a secret gives every id a new one, and
a lookup by the old pseudonym finds nothing. To keep the old value, derive it with the active key pinned to the old one:
`derivePseudonym({ ...ring, activeKeyId: oldKeyId }, request)`. Keep that pin until you have moved what the old pseudonym names, and only then
drop it.

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

- [`docs/NAMESPACES.md`][namespaces-5k] §5k — what belongs here rather than in `auth`
- [`src/auth/README.md`][auth-readme] — the auth key ring, which this namespace never shares a secret with
- [`src/crypto/README.md`][crypto-readme] — the `crypto` container this namespace sits in

[am-7]: ../../../docs/AUTH_MOUNTING.md#7-rotating-the-key-ring
[auth-readme]: ../../auth/README.md
[cf-readme-rotate]: ../../tooling/cf/README.md#rotating-a-key-ring
[crypto-readme]: ../README.md
[iv-3b]: ../../../docs/INPUT_VALIDATION.md#3b-the-csrf-key-ring--import-and-rotation
[namespaces-5k]: ../../../docs/NAMESPACES.md#5k-cryptokeyring--values-signed-or-sealed-under-the-apps-own-root-secret
[sb-3c]: ../../../docs/STORAGE_BINDINGS.md#3c-signed-urls-for-secure-object-access
[session-readme]: ../../session/README.md
