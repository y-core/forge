import { bytesToHex } from "../primitives/mod";
import { KEY_RING_DOMAIN } from "./ring";
import { hmacUnderKeyRing } from "./sign";
import type { KeyRing, KeyRingDomain, PseudonymRequest } from "./types";

/** The labels `derivePseudonym` works under — the ring's key ids, and subkeys no `sealAtRest` purpose can reach. @internal */
export const PSEUDONYM_DOMAIN: KeyRingDomain = { keyIdLabel: KEY_RING_DOMAIN.keyIdLabel, subkeyLabel: "y-core/forge/keyring/pseudonym/v1" };

/** Derives a keyed, non-reversible lowercase-hex stand-in for a value under the ring's active key and one purpose. @public */
export async function derivePseudonym(ring: KeyRing, request: PseudonymRequest): Promise<string> {
  if (typeof request.purpose !== "string" || request.purpose.length === 0) throw new Error("derivePseudonym: purpose must be a non-empty string");
  const { mac } = await hmacUnderKeyRing("derivePseudonym", ring, PSEUDONYM_DOMAIN, request.purpose, request.value);
  return bytesToHex(mac);
}
