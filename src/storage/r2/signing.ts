import { base64urlDecode, base64urlEncode, hmacSign, importHmacKeyFromHex, timingSafeEqualBytes } from "../../crypto/mod";
import type { SignedUrlError, SignedUrlOk, SignedUrlOptions } from "./types";

/** Imports a hex-encoded secret as a Web Crypto HMAC-SHA256 key for signing operations. @public */
export function importSigningKey(hexSecret: string): Promise<CryptoKey> {
  return importHmacKeyFromHex(hexSecret, "Signing secret");
}

/** Length-prefixes the key so the `key`/`exp` boundary is unambiguous (defense-in-depth against
 *  a key crafted to contain the `|` delimiter). Both signing and verification use this form. */
function signingPayload(objectKey: string, exp: number): string {
  return `${objectKey.length}:${objectKey}|${exp}`;
}

/**
 * Creates a signed URL for GET access to an object.
 * HMAC-SHA-256 over `${key.length}:${key}|${exp}`.
 * Appends `?key=`, `?exp=`, and `?sig=` to `baseUrl`. @public
 */
export async function createSignedObjectUrl(
  signingKey: CryptoKey,
  baseUrl: string,
  objectKey: string,
  options?: SignedUrlOptions,
): Promise<string> {
  const expiresIn = options?.expiresInSeconds ?? 3600;
  const exp = Math.floor(Date.now() / 1000) + expiresIn;
  const payload = signingPayload(objectKey, exp);
  const sig = base64urlEncode(await hmacSign(signingKey, payload));
  const url = new URL(baseUrl);
  url.searchParams.set("key", objectKey);
  url.searchParams.set("exp", String(exp));
  url.searchParams.set("sig", sig);
  return url.toString();
}

/**
 * Verifies a signed object URL.
 * Checks expiry first, then constant-time HMAC comparison. @public
 */
export async function verifySignedObjectUrl(signingKey: CryptoKey, url: string): Promise<SignedUrlOk | SignedUrlError> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "invalid-format" };
  }

  const objectKey = parsed.searchParams.get("key");
  const expStr = parsed.searchParams.get("exp");
  const sig = parsed.searchParams.get("sig");

  if (!objectKey || !expStr || !sig) return { ok: false, reason: "invalid-format" };

  const exp = parseInt(expStr, 10);
  if (!Number.isInteger(exp)) return { ok: false, reason: "invalid-format" };

  if (Math.floor(Date.now() / 1000) > exp) return { ok: false, reason: "expired" };

  const payload = signingPayload(objectKey, exp);
  const expected = await hmacSign(signingKey, payload);

  let actual: Uint8Array;
  try {
    actual = base64urlDecode(sig);
  } catch {
    return { ok: false, reason: "invalid-signature" };
  }

  const match = timingSafeEqualBytes(expected, actual);
  if (!match) return { ok: false, reason: "invalid-signature" };

  return { ok: true, key: objectKey };
}
