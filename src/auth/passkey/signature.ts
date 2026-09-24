import { base64urlEncode, unwrapEcdsaSignature } from "../../crypto/mod";
import type { CosePublicKey } from "../../crypto/mod";

function importPasskeyKey(key: CosePublicKey): Promise<CryptoKey> {
  if (key.algorithm === -7) return crypto.subtle.importKey("raw", key.point, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  if (key.algorithm === -8) return crypto.subtle.importKey("raw", key.point, { name: "Ed25519" }, false, ["verify"]);
  // JWK and not SPKI: COSE carries the modulus and exponent raw, and JWK is the only import format
  // WebCrypto accepts them through without an ASN.1 encoder standing in between.
  return crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n: base64urlEncode(key.modulus), e: base64urlEncode(key.exponent), alg: "RS256", ext: false },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

/** Whether WebCrypto accepts a decoded COSE key at all, so registration can refuse what no sign-in could use. @internal */
export async function passkeyKeyImportable(key: CosePublicKey): Promise<boolean> {
  try {
    await importPasskeyKey(key);
    return true;
  } catch {
    return false;
  }
}

/** Verifies one ceremony's signature under the COSE key its credential was registered with. @internal */
export async function verifyPasskeySignature(
  key: CosePublicKey,
  signature: Uint8Array<ArrayBuffer>,
  signed: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  try {
    const imported = await importPasskeyKey(key);
    if (key.algorithm === -7) {
      return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, imported, unwrapEcdsaSignature(signature), signed);
    }
    if (key.algorithm === -8) return await crypto.subtle.verify({ name: "Ed25519" }, imported, signature, signed);
    return await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, imported, signature, signed);
  } catch {
    // The signature bytes are the attacker's, so one that will not even parse is a refusal here
    // rather than a thrown error the caller would have to treat as an outage.
    return false;
  }
}
