import { base64urlDecodeOrNull, base64urlEncode } from "../primitives/mod";
import { assertAppKeyRing, KEY_RING_DOMAIN } from "./ring";
import { hmacUnderKeyRing, hmacVerifyUnderKeyRing } from "./sign";
import type { KeyRing, KeyRingDomain, KeyRingSigningRequest, KeyRingVerdict } from "./types";

/** The labels the public signatures work under — the ring's key ids, and subkeys no forge-internal HMAC purpose can reach. @internal */
export const SIGNATURE_DOMAIN: KeyRingDomain = { keyIdLabel: KEY_RING_DOMAIN.keyIdLabel, subkeyLabel: "y-core/forge/keyring/signature/v1" };

function assertPurpose(operation: string, purpose: string): void {
  if (typeof purpose !== "string" || purpose.length === 0) throw new Error(`${operation}: purpose must be a non-empty string`);
}

/** Signs a value under the ring's active key and one purpose, as `<kid>.<base64url HMAC-SHA-256>`. @public */
export async function signKeyRingValue(ring: KeyRing, request: KeyRingSigningRequest): Promise<string> {
  assertPurpose("signKeyRingValue", request.purpose);
  const { kid, mac } = await hmacUnderKeyRing("signKeyRingValue", ring, SIGNATURE_DOMAIN, request.purpose, request.value);
  return `${kid}.${base64urlEncode(mac)}`;
}

/** Checks a `signKeyRingValue` signature over a value under the key it names, a malformed signature answering forged. @public */
export async function verifyKeyRingValue(ring: KeyRing, request: KeyRingSigningRequest, signature: string): Promise<KeyRingVerdict> {
  assertPurpose("verifyKeyRingValue", request.purpose);
  const dot = signature.indexOf(".");
  if (dot <= 0) {
    await assertAppKeyRing("verifyKeyRingValue", ring);
    return "forged";
  }
  const signed = { kid: signature.slice(0, dot), data: request.value, mac: base64urlDecodeOrNull(signature.slice(dot + 1)) };
  return hmacVerifyUnderKeyRing("verifyKeyRingValue", ring, SIGNATURE_DOMAIN, request.purpose, signed);
}
