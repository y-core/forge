import { base64urlDecode, base64urlEncode, hmacSign, importHmacKeyFromHex, timingSafeEqualBytes } from "../../crypto/mod";
import { err, ok } from "../../result/result";
import type { SignedUrlOptions, SignedUrlVerdict } from "./types";

/** Imports a hex-encoded secret as a Web Crypto HMAC-SHA256 key for signing operations. @public */
export function importSigningKey(hexSecret: string): Promise<CryptoKey> {
  return importHmacKeyFromHex(hexSecret, "Signing secret");
}

/** Length-prefixes the key so the `key`/`exp` boundary is unambiguous against a key crafted to contain the `|` delimiter. */
function signingPayload(objectKey: string, exp: number): string {
  return `${objectKey.length}:${objectKey}|${exp}`;
}

/** Creates a signed URL for GET access to an object. @public */
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

/** Verifies a signed object URL, checking expiry then comparing the HMAC in constant time. @public */
export async function verifySignedObjectUrl(signingKey: CryptoKey, url: string): Promise<SignedUrlVerdict> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return err("invalid-format");
  }

  const objectKey = parsed.searchParams.get("key");
  const expStr = parsed.searchParams.get("exp");
  const sig = parsed.searchParams.get("sig");

  if (!objectKey || !expStr || !sig) return err("invalid-format");

  const exp = parseInt(expStr, 10);
  if (!Number.isInteger(exp)) return err("invalid-format");

  if (Math.floor(Date.now() / 1000) > exp) return err("expired");

  const payload = signingPayload(objectKey, exp);
  const expected = await hmacSign(signingKey, payload);

  let actual: Uint8Array;
  try {
    actual = base64urlDecode(sig);
  } catch {
    return err("invalid-signature");
  }

  const match = timingSafeEqualBytes(expected, actual);
  if (!match) return err("invalid-signature");

  return ok(objectKey);
}
