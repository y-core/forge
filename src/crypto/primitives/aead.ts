/** Byte length of an AES-GCM nonce — 96 bits, the only size WebCrypto accelerates. @internal */
export const AEAD_NONCE_BYTES = 12;

/** Byte length of the authentication tag AES-GCM appends to the ciphertext. @internal */
export const AEAD_TAG_BYTES = 16;

/** Imports 32 raw bytes as an AES-256-GCM key for seal and open. @internal */
export function importAeadKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  if (raw.byteLength !== 32) throw new Error("importAeadKey: AES-256-GCM requires a 32-byte key");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Returns a fresh 12-byte AES-GCM nonce. @internal */
export function aeadNonce(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(AEAD_NONCE_BYTES));
}

/** Seals plaintext under an AES-256-GCM key, returning ciphertext with the tag appended. @internal */
export async function aeadSeal(
  key: CryptoKey,
  nonce: Uint8Array<ArrayBuffer>,
  plaintext: Uint8Array<ArrayBuffer>,
  additionalData?: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const algorithm: AesGcmParams = { name: "AES-GCM", iv: nonce, ...(additionalData ? { additionalData } : {}) };
  return new Uint8Array(await crypto.subtle.encrypt(algorithm, key, plaintext));
}

/** Opens an AES-256-GCM ciphertext, returning `null` when the tag, key, nonce or associated data does not match. @internal */
export async function aeadOpen(
  key: CryptoKey,
  nonce: Uint8Array<ArrayBuffer>,
  sealed: Uint8Array<ArrayBuffer>,
  additionalData?: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (sealed.byteLength < AEAD_TAG_BYTES) return null;
  const algorithm: AesGcmParams = { name: "AES-GCM", iv: nonce, ...(additionalData ? { additionalData } : {}) };
  try {
    return new Uint8Array(await crypto.subtle.decrypt(algorithm, key, sealed));
  } catch {
    // A forged tag and a wrong key are the same answer to a caller: the bytes are not authentic.
    return null;
  }
}
