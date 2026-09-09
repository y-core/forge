const HASH_LENGTH = 32;

function importHkdfHmac(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

/** RFC 5869 HKDF-Extract over SHA-256: input keying material plus a salt to one 32-byte pseudorandom key. @internal */
export async function hkdfExtract(ikm: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const saltKey = await importHkdfHmac(salt.byteLength > 0 ? salt : new Uint8Array(HASH_LENGTH));
  return new Uint8Array(await crypto.subtle.sign("HMAC", saltKey, ikm));
}

/** RFC 5869 HKDF-Expand over SHA-256: one pseudorandom key plus a purpose label to `length` output bytes. @internal */
export async function hkdfExpand(prk: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number): Promise<Uint8Array<ArrayBuffer>> {
  if (length < 1 || length > HASH_LENGTH * 255) throw new Error(`hkdfExpand: length must be between 1 and ${HASH_LENGTH * 255}`);
  const prkKey = await importHkdfHmac(prk);
  const okm = new Uint8Array(length);
  let block = new Uint8Array(0);
  for (let counter = 1, written = 0; written < length; counter++) {
    const input = new Uint8Array(block.byteLength + info.byteLength + 1);
    input.set(block, 0);
    input.set(info, block.byteLength);
    input[input.length - 1] = counter;
    block = new Uint8Array(await crypto.subtle.sign("HMAC", prkKey, input));
    okm.set(block.subarray(0, Math.min(block.byteLength, length - written)), written);
    written += block.byteLength;
  }
  return okm;
}
