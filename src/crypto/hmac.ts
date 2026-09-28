import { base64urlEncode } from "./base64";
import { hexToBytes, utf8Encode } from "./bytes";
import { sha256 } from "./digest";
import type { HmacKeyRing } from "./types";

async function keyFingerprint(hexSecret: string): Promise<string> {
  return base64urlEncode(await sha256(hexSecret.toLowerCase())).slice(0, 12);
}

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

/** Imports hex-encoded secrets into a key ring, the first becoming the active signing key. @internal */
export async function importHmacKeyRing(secrets: [string, ...string[]], label: string): Promise<HmacKeyRing> {
  const entries = await Promise.all(
    secrets.map(async (hex) => {
      const kid = await keyFingerprint(hex);
      const key = await importHmacKeyFromHex(hex, label);
      return [kid, key] as const;
    }),
  );
  const first = entries[0];
  if (!first) throw new Error(`${label}: a key ring requires at least one secret`);
  const activeKeyId = first[0];
  const keys: Record<string, CryptoKey> = {};
  for (const [kid, key] of entries) {
    keys[kid] = key;
  }
  return { activeKeyId, keys };
}

/** Resolves a key id to its key in the ring, or undefined where the ring holds none. @internal */
// `Object.hasOwn` and not `ring.keys[kid]`: an attacker-supplied kid of `constructor` must not resolve.
export function lookupHmacKey(ring: HmacKeyRing, kid: string): CryptoKey | undefined {
  return Object.hasOwn(ring.keys, kid) ? ring.keys[kid] : undefined;
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
