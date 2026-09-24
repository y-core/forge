import { hexToBytes, utf8Encode } from "./bytes";

/** Imports raw bytes as an HMAC-SHA-256 CryptoKey for sign + verify. @internal */
export function importHmacKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** Validates a hex secret and imports it as an HMAC-SHA-256 key. @internal */
export async function importHmacKeyFromHex(hexSecret: string, label = "secret"): Promise<CryptoKey> {
  if (hexSecret.length % 2 !== 0) throw new Error(`${label} must have an even number of hex characters`);
  if (!/^[0-9a-fA-F]+$/.test(hexSecret)) throw new Error(`${label} must contain only hexadecimal characters (0-9, a-f, A-F)`);
  const pairs = hexSecret.match(/.{2}/g);
  if (!pairs || pairs.length < 16) throw new Error(`${label} must be at least 32 hex characters (16 bytes)`);
  return importHmacKey(hexToBytes(hexSecret));
}

/** Signs data with an HMAC-SHA-256 key, encoding strings as UTF-8. @internal */
export async function hmacSign(key: CryptoKey, data: string | Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = typeof data === "string" ? utf8Encode(data) : data;
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes));
}

/** Verifies an HMAC-SHA-256 signature, encoding strings as UTF-8. @internal */
export async function hmacVerify(key: CryptoKey, data: string | Uint8Array<ArrayBuffer>, sig: Uint8Array<ArrayBuffer>): Promise<boolean> {
  const bytes = typeof data === "string" ? utf8Encode(data) : data;
  return crypto.subtle.verify("HMAC", key, sig, bytes);
}
