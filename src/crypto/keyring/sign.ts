import { hmacSign, hmacVerify } from "../primitives/mod";
import { assertAppKeyRing, HMAC_DOMAIN } from "./ring";
import { resolveKeyRingKey } from "./subkey";
import type { KeyRing, KeyRingDomain, KeyRingSignature, KeyRingVerdict } from "./types";

/** Signs `data` under the ring's active key and one purpose's HMAC subkey in `domain`, refusing a ring `importKeyRing` did not build. @internal */
export async function hmacUnderKeyRing(
  operation: string,
  ring: KeyRing,
  domain: KeyRingDomain,
  purpose: string,
  data: string | Uint8Array<ArrayBuffer>,
): Promise<KeyRingSignature> {
  await assertAppKeyRing(operation, ring);
  const kid = ring.activeKeyId;
  const key = resolveKeyRingKey(ring, { domain, kid, purpose }, "hmac");
  if (!key) throw new Error(`${operation}: the key ring has no key for its active key id "${kid}"`);
  return { kid, mac: await hmacSign(await key, data) };
}

/** Signs `data` under the ring's active key and the HMAC subkey for `purpose`. @internal */
export function signWithKeyRing(
  operation: string,
  ring: KeyRing,
  purpose: string,
  data: string | Uint8Array<ArrayBuffer>,
): Promise<KeyRingSignature> {
  return hmacUnderKeyRing(operation, ring, HMAC_DOMAIN, purpose, data);
}

/** Checks `mac` over `data` under the key `kid` names and the HMAC subkey for `purpose`; a `null` mac, one that did not decode, is forged. @internal */
export async function verifyWithKeyRing(
  operation: string,
  ring: KeyRing,
  purpose: string,
  kid: string,
  data: string | Uint8Array<ArrayBuffer>,
  mac: Uint8Array<ArrayBuffer> | null,
): Promise<KeyRingVerdict> {
  await assertAppKeyRing(operation, ring);
  const key = resolveKeyRingKey(ring, { domain: HMAC_DOMAIN, kid, purpose }, "hmac");
  if (!key) return "no-key";
  if (mac === null) return "forged";
  return (await hmacVerify(await key, data, mac)) ? "verified" : "forged";
}
