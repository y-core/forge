import { signWithKeyRing, verifyWithKeyRing } from "../../crypto/keyring/sign";
import type { KeyRing } from "../../crypto/keyring/types";
import { base64urlDecodeOrNull, base64urlEncode } from "../../crypto/primitives/mod";
import { err, ok } from "../../result/result";
import type { SignedUrlOptions, SignedUrlVerdict } from "./types";

/** Longest lifetime, in seconds, that `createSignedObjectUrl` will sign. @public */
export const MAX_SIGNED_URL_LIFETIME = 604_800;

const SIGNED_URL_PURPOSE = "signed-url";

function signingPayload(parts: { kid: string; objectKey: string; exp: number }): string {
  return `${parts.kid.length}:${parts.kid}|${parts.objectKey.length}:${parts.objectKey}|${parts.exp}`;
}

/** Creates a signed URL for GET access to an object. @public */
export async function createSignedObjectUrl(ring: KeyRing, baseUrl: string, objectKey: string, options?: SignedUrlOptions): Promise<string> {
  const expiresIn = options?.expiresInSeconds ?? 3600;
  if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > MAX_SIGNED_URL_LIFETIME) {
    throw new RangeError(`createSignedObjectUrl: expiresInSeconds must be an integer in 1…${MAX_SIGNED_URL_LIFETIME}, got ${expiresIn}`);
  }
  const kid = ring.activeKeyId;
  const exp = Math.floor(Date.now() / 1000) + expiresIn;
  const { mac } = await signWithKeyRing("createSignedObjectUrl", ring, SIGNED_URL_PURPOSE, signingPayload({ kid, objectKey, exp }));
  const sig = base64urlEncode(mac);
  const url = new URL(baseUrl);
  url.searchParams.set("key", objectKey);
  url.searchParams.set("exp", String(exp));
  url.searchParams.set("kid", kid);
  url.searchParams.set("sig", sig);
  return url.toString();
}

/** Verifies a signed object URL, checking expiry and key id then comparing the HMAC in constant time. @public */
export async function verifySignedObjectUrl(ring: KeyRing, url: string): Promise<SignedUrlVerdict> {
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

  const payload = signingPayload({ kid, objectKey, exp });
  const verdict = await verifyWithKeyRing("verifySignedObjectUrl", ring, SIGNED_URL_PURPOSE, kid, payload, base64urlDecodeOrNull(sig));
  if (verdict === "no-key") return err("unknown-key");
  if (verdict === "forged") return err("invalid-signature");

  return ok(objectKey);
}
