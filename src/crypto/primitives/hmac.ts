import { utf8Encode } from "./bytes";

/** Imports raw bytes as an HMAC-SHA-256 CryptoKey for sign + verify. @internal */
export function importHmacKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
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
