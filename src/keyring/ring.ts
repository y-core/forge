import { base64urlEncode, concatBytes, hexToBytes, sha256, utf8Encode } from "../crypto/mod";
import type { KeyRing, KeyRingDomain } from "./types";

/** Characters in a key id — the base64url spelling of the kid bytes a frame begins with. @internal */
export const KEYRING_KEY_ID_LENGTH = 8;

/** Bytes of key id every at-rest frame begins with. @internal */
export const KEYRING_KID_BYTES = 6;

/** Shortest root secret a key ring will accept — the HKDF input keying material for every subkey. @internal */
export const KEYRING_MIN_KEY_BYTES = 32;

const MINIMUM_KEY_ENTROPY_BYTES = 8;

/** The labels `importKeyRing`, `sealAtRest` and `openAtRest` work under. @internal */
export const KEYRING_DOMAIN: KeyRingDomain = { keyIdLabel: "y-core/forge/keyring/kid", subkeyLabel: "y-core/forge/keyring/v1" };

function assertKeyEntropy(operation: string, key: Uint8Array<ArrayBuffer>): void {
  const distinct = new Set(key).size;
  if (distinct === 1) {
    throw new Error(`${operation}: a secret whose bytes are all the same value is not a secret — generate one with a CSPRNG`);
  }
  if (distinct < MINIMUM_KEY_ENTROPY_BYTES) {
    throw new Error(
      `${operation}: a secret carrying only ${distinct} distinct byte values is not one a CSPRNG produced — at least ${MINIMUM_KEY_ENTROPY_BYTES} are required`,
    );
  }
}

// `Object.hasOwn` and not `ring.keys[kid]`: an attacker-supplied kid of `constructor` resolves to a
// function through a bare property read, which turns a key lookup into a type confusion.
/** Reads one key out of a ring by id, resolving only ids the ring actually declares. @internal */
export function lookupKeyRingKey(ring: KeyRing, kid: string): Uint8Array<ArrayBuffer> | undefined {
  return Object.hasOwn(ring.keys, kid) ? ring.keys[kid] : undefined;
}

/** Derives the id a key is known by under one domain — a fingerprint, so a consumer never types one. @internal */
export async function keyRingKeyId(domain: KeyRingDomain, key: Uint8Array<ArrayBuffer>): Promise<string> {
  return base64urlEncode(await sha256(concatBytes(utf8Encode(domain.keyIdLabel), key))).slice(0, KEYRING_KEY_ID_LENGTH);
}

/** Builds a key ring under one domain from hex-encoded root secrets, naming `operation` in every refusal. @internal */
export async function importKeyRingUnder(operation: string, domain: KeyRingDomain, secrets: readonly string[]): Promise<KeyRing> {
  const keys: Record<string, Uint8Array<ArrayBuffer>> = {};
  let activeKeyId: string | undefined;
  for (const hex of secrets) {
    if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) throw new Error(`${operation}: each secret must be an even-length hex string`);
    const key = hexToBytes(hex);
    if (key.byteLength < KEYRING_MIN_KEY_BYTES) {
      throw new Error(`${operation}: each secret must be at least ${KEYRING_MIN_KEY_BYTES} bytes (${KEYRING_MIN_KEY_BYTES * 2} hex characters)`);
    }
    assertKeyEntropy(operation, key);
    const kid = await keyRingKeyId(domain, key);
    keys[kid] = key;
    activeKeyId ??= kid;
  }
  if (!activeKeyId) throw new Error(`${operation}: at least one secret is required`);
  return { activeKeyId, keys };
}

/** Builds a key ring from hex-encoded root secrets, the first becoming the active key. @public */
export function importKeyRing(secrets: [string, ...string[]]): Promise<KeyRing> {
  return importKeyRingUnder("importKeyRing", KEYRING_DOMAIN, secrets);
}
