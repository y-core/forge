import { AEAD_NONCE_BYTES, AEAD_TAG_BYTES, aeadNonce, aeadOpen, aeadSeal, base64urlDecode, base64urlEncode, concatBytes } from "../crypto/mod";
import { err, ok } from "../result/result";
import type { Result } from "../result/types";
import { KEYRING_DOMAIN, KEYRING_KID_BYTES, keyRingKeyId, lookupKeyRingKey } from "./ring";
import { resolveKeyRingKey } from "./subkey";
import type { AtRestBinding, AtRestOpened, AtRestRefusal, KeyRing, KeyRingDomain } from "./types";

const HEADER_BYTES = KEYRING_KID_BYTES + AEAD_NONCE_BYTES;
const DERIVED_KEY_ID = /^[A-Za-z0-9_-]{8}$/;

const keyringDomainVerdicts = new WeakMap<KeyRing, Promise<boolean>>();

function isKeyringDomainRing(ring: KeyRing): Promise<boolean> {
  const held = keyringDomainVerdicts.get(ring);
  if (held) return held;
  const key = lookupKeyRingKey(ring, ring.activeKeyId);
  const verdict = key ? keyRingKeyId(KEYRING_DOMAIN, key).then((kid) => kid === ring.activeKeyId) : Promise.resolve(false);
  keyringDomainVerdicts.set(ring, verdict);
  return verdict;
}

function assertAtRestBinding(operation: string, binding: AtRestBinding): void {
  if (typeof binding.purpose !== "string" || binding.purpose.length === 0) throw new Error(`${operation}: purpose must be a non-empty string`);
  if (binding.context.byteLength === 0) {
    throw new Error(`${operation}: context must be non-empty — bind the frame to the row it is stored in`);
  }
}

/** Seals bytes under one domain as `kid(6) ‖ nonce(12) ‖ ciphertext‖tag`, binding `context` as associated data. @internal */
export async function sealAtRestUnder(
  ring: KeyRing,
  domain: KeyRingDomain,
  binding: AtRestBinding,
  plaintext: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  assertAtRestBinding("sealAtRest", binding);
  const kid = ring.activeKeyId;
  if (!DERIVED_KEY_ID.test(kid)) throw new Error(`sealAtRest: active key id "${kid}" is not one a key ring derives`);
  const key = resolveKeyRingKey(ring, { domain, kid, purpose: binding.purpose }, "aead");
  if (!key) throw new Error(`sealAtRest: the key ring has no key for its active key id "${kid}"`);
  const nonce = aeadNonce();
  return concatBytes(base64urlDecode(kid), nonce, await aeadSeal(await key, nonce, plaintext, binding.context));
}

/** Opens a frame `sealAtRestUnder` wrote under the same domain, refusing with `no-key` when the ring cannot resolve its key id. @internal */
export async function openAtRestUnder(
  ring: KeyRing,
  domain: KeyRingDomain,
  binding: AtRestBinding,
  frame: Uint8Array<ArrayBuffer>,
): Promise<Result<AtRestOpened, AtRestRefusal>> {
  assertAtRestBinding("openAtRest", binding);
  const kid = atRestKeyId(frame);
  if (kid === undefined) return err("unopenable");
  const key = resolveKeyRingKey(ring, { domain, kid, purpose: binding.purpose }, "aead");
  if (!key) return err("no-key");
  const plaintext = await aeadOpen(await key, frame.slice(KEYRING_KID_BYTES, HEADER_BYTES), frame.slice(HEADER_BYTES), binding.context);
  return plaintext ? ok({ plaintext, kid }) : err("unopenable");
}

/** Reads the key id a frame names without a ring, trusting nothing else about it. @public */
export function atRestKeyId(frame: Uint8Array<ArrayBuffer>): string | undefined {
  return frame.byteLength < HEADER_BYTES + AEAD_TAG_BYTES ? undefined : base64urlEncode(frame.subarray(0, KEYRING_KID_BYTES));
}

/** Seals bytes for storage under the ring's active key, bound to one purpose and to the row it is stored in. @public */
export async function sealAtRest(ring: KeyRing, binding: AtRestBinding, plaintext: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (!(await isKeyringDomainRing(ring))) {
    throw new Error(
      `sealAtRest: active key id "${ring.activeKeyId}" is not one importKeyRing derives — seal only under a ring importKeyRing built, never the auth key ring`,
    );
  }
  return sealAtRestUnder(ring, KEYRING_DOMAIN, binding, plaintext);
}

/** Opens a frame `sealAtRest` wrote, answering the key id it was sealed under so a caller can re-seal. @public */
export function openAtRest(ring: KeyRing, binding: AtRestBinding, frame: Uint8Array<ArrayBuffer>): Promise<Result<AtRestOpened, AtRestRefusal>> {
  return openAtRestUnder(ring, KEYRING_DOMAIN, binding, frame);
}
