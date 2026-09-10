import { cborDecodeFirst } from "./cbor";
import type { CborValue } from "./types";
import type { CosePublicKey } from "./types";

const LABEL_KTY = 1;
const LABEL_ALG = 3;
const LABEL_CRV = -1;
const LABEL_X = -2;
const LABEL_Y = -3;

const KTY_OKP = 1;
const KTY_EC2 = 2;
const KTY_RSA = 3;

const CRV_P256 = 1;
const CRV_ED25519 = 6;

/** RSASSA-PKCS1-v1_5 at 2048 bits is the floor WebAuthn deployments use; the ceiling bounds what a key costs to verify. */
const RSA_MODULUS_MIN_BYTES = 256;
const RSA_MODULUS_MAX_BYTES = 1024;
const RSA_EXPONENT_MAX_BYTES = 8;

function integerAt(key: Map<CborValue, CborValue>, label: number): number {
  const value = key.get(label);
  if (typeof value !== "number") throw new Error(`decodeCoseKey: label ${label} is missing or not an integer`);
  return value;
}

function bytesAt(key: Map<CborValue, CborValue>, label: number, expectedLength?: number): Uint8Array<ArrayBuffer> {
  const value = key.get(label);
  if (!(value instanceof Uint8Array)) throw new Error(`decodeCoseKey: label ${label} is missing or not a byte string`);
  if (expectedLength !== undefined && value.byteLength !== expectedLength) {
    throw new Error(`decodeCoseKey: label ${label} must be ${expectedLength} bytes, got ${value.byteLength}`);
  }
  return value;
}

/** The shortest unsigned big-endian form, which is what a JWK integer is and what a bound must be read against. */
function significant(value: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  let start = 0;
  while (start < value.byteLength - 1 && value[start] === 0) start++;
  return value.slice(start);
}

/** Reads a decoded COSE_Key map into the algorithm and public-key material a verifier imports. @internal */
export function decodeCoseKey(key: Map<CborValue, CborValue>): CosePublicKey {
  const kty = integerAt(key, LABEL_KTY);
  const algorithm = integerAt(key, LABEL_ALG);

  if (algorithm === -7) {
    if (kty !== KTY_EC2) throw new Error("decodeCoseKey: algorithm -7 requires an EC2 key");
    if (integerAt(key, LABEL_CRV) !== CRV_P256) throw new Error("decodeCoseKey: algorithm -7 requires curve P-256");
    const x = bytesAt(key, LABEL_X, 32);
    const y = bytesAt(key, LABEL_Y, 32);
    // The uncompressed SEC1 point WebCrypto's "raw" ECDSA import expects — `0x04` then x then y.
    const point = new Uint8Array(65);
    point[0] = 0x04;
    point.set(x, 1);
    point.set(y, 33);
    return { algorithm: -7, curve: "P-256", point };
  }

  if (algorithm === -8) {
    if (kty !== KTY_OKP) throw new Error("decodeCoseKey: algorithm -8 requires an OKP key");
    if (integerAt(key, LABEL_CRV) !== CRV_ED25519) throw new Error("decodeCoseKey: algorithm -8 requires curve Ed25519");
    return { algorithm: -8, curve: "Ed25519", point: bytesAt(key, LABEL_X, 32) };
  }

  if (algorithm === -257) {
    if (kty !== KTY_RSA) throw new Error("decodeCoseKey: algorithm -257 requires an RSA key");
    // Bounded here rather than at import: WebCrypto accepts an eight-byte modulus and an exponent of
    // one, so a key no signature could ever be trusted under otherwise decodes and enrols cleanly.
    const modulus = significant(bytesAt(key, LABEL_CRV));
    if (modulus.byteLength < RSA_MODULUS_MIN_BYTES || modulus.byteLength > RSA_MODULUS_MAX_BYTES) {
      throw new Error(
        `decodeCoseKey: an RSA modulus must be ${RSA_MODULUS_MIN_BYTES} to ${RSA_MODULUS_MAX_BYTES} bytes, got ${modulus.byteLength}`,
      );
    }
    const exponent = significant(bytesAt(key, LABEL_X));
    const last = exponent[exponent.byteLength - 1] ?? 0;
    if (exponent.byteLength > RSA_EXPONENT_MAX_BYTES || last % 2 === 0 || (exponent.byteLength === 1 && last <= 1)) {
      throw new Error("decodeCoseKey: an RSA exponent must be an odd integer above one, of at most eight bytes");
    }
    return { algorithm: -257, modulus, exponent };
  }

  throw new Error(`decodeCoseKey: unsupported COSE algorithm ${algorithm}`);
}

/** Decodes a COSE_Key from CBOR bytes, reporting where the key ended so trailing bytes stay reachable. @internal */
export function decodeCosePublicKey(bytes: Uint8Array<ArrayBuffer>): { readonly key: CosePublicKey; readonly bytesRead: number } {
  const { value, bytesRead } = cborDecodeFirst(bytes);
  if (!(value instanceof Map)) throw new Error("decodeCosePublicKey: a COSE_Key must be a CBOR map");
  return { key: decodeCoseKey(value), bytesRead };
}
