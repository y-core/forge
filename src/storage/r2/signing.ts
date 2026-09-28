import { base64urlDecodeOrNull, base64urlEncode, hmacSign, importHmacKeyRing, lookupHmacKey, timingSafeEqualBytes } from "../../crypto/mod";
import type { HmacKeyRing } from "../../crypto/mod";
import { err, ok } from "../../result/result";
import type { SignedUrlOptions, SignedUrlVerdict } from "./types";

/** Longest lifetime, in seconds, that `createSignedObjectUrl` will sign. @public */
export const MAX_SIGNED_URL_LIFETIME = 604_800;

/** Imports hex-encoded secrets into a signed-URL key ring, the first becoming the active signing key. @public */
export function importSignedUrlKeyRing(secrets: [string, ...string[]]): Promise<HmacKeyRing> {
  return importHmacKeyRing(secrets, "Signed URL secret");
}

function signingPayload(parts: { kid: string; objectKey: string; exp: number }): string {
  return `${parts.kid.length}:${parts.kid}|${parts.objectKey.length}:${parts.objectKey}|${parts.exp}`;
}

/** Creates a signed URL for GET access to an object. @public */
export async function createSignedObjectUrl(ring: HmacKeyRing, baseUrl: string, objectKey: string, options?: SignedUrlOptions): Promise<string> {
  const expiresIn = options?.expiresInSeconds ?? 3600;
  if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > MAX_SIGNED_URL_LIFETIME) {
    throw new RangeError(`createSignedObjectUrl: expiresInSeconds must be an integer in 1…${MAX_SIGNED_URL_LIFETIME}, got ${expiresIn}`);
  }
  const kid = ring.activeKeyId;
  const key = lookupHmacKey(ring, kid);
  if (!key) throw new Error(`createSignedObjectUrl: key ring has no key for active key id "${kid}"`);
  const exp = Math.floor(Date.now() / 1000) + expiresIn;
  const sig = base64urlEncode(await hmacSign(key, signingPayload({ kid, objectKey, exp })));
  const url = new URL(baseUrl);
  url.searchParams.set("key", objectKey);
  url.searchParams.set("exp", String(exp));
  url.searchParams.set("kid", kid);
  url.searchParams.set("sig", sig);
  return url.toString();
}

/** Verifies a signed object URL, checking expiry and key id then comparing the HMAC in constant time. @public */
export async function verifySignedObjectUrl(ring: HmacKeyRing, url: string): Promise<SignedUrlVerdict> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return err("invalid-format");
  }

  const objectKey = parsed.searchParams.get("key");
  const expStr = parsed.searchParams.get("exp");
  const kid = parsed.searchParams.get("kid");
  const sig = parsed.searchParams.get("sig");

  if (!objectKey || !expStr || !kid || !sig) return err("invalid-format");

  if (!/^\d+$/.test(expStr)) return err("invalid-format");
  const exp = Number(expStr);

  if (Math.floor(Date.now() / 1000) > exp) return err("expired");

  const key = lookupHmacKey(ring, kid);
  if (!key) return err("unknown-key");

  const actual = base64urlDecodeOrNull(sig);
  if (!actual) return err("invalid-signature");

  const expected = await hmacSign(key, signingPayload({ kid, objectKey, exp }));
  if (!timingSafeEqualBytes(expected, actual)) return err("invalid-signature");

  return ok(objectKey);
}
