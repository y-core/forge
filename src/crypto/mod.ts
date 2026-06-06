type CfSubtleCrypto = SubtleCrypto & { timingSafeEqual?: (a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView) => boolean };
const subtle = crypto.subtle as CfSubtleCrypto;

/** Shared module-level codec singletons — stateless, safe to reuse across all operations. @internal */
export const TEXT_ENCODER = new TextEncoder();
/** @internal */
export const TEXT_DECODER = new TextDecoder();

/** Encodes a string to UTF-8 bytes. @internal */
export function utf8Encode(s: string): Uint8Array<ArrayBuffer> {
  return TEXT_ENCODER.encode(s);
}

/** Decodes UTF-8 bytes to a string. @internal */
export function utf8Decode(bytes: Uint8Array): string {
  return TEXT_DECODER.decode(bytes);
}

/** Encodes bytes to a lowercase hex string. @internal */
export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/** Decodes a hex string to bytes. Assumes valid even-length hex input. @internal */
export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const pairs = hex.match(/.{2}/g) ?? [];
  return new Uint8Array(pairs.map((h) => Number.parseInt(h, 16)));
}

/** Returns `n` cryptographically random bytes. @internal */
export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** Computes SHA-256 of a string or byte array, returns raw bytes. @internal */
export async function sha256(data: string | Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = typeof data === "string" ? utf8Encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

/** Imports raw bytes as an HMAC-SHA-256 CryptoKey for sign + verify. @internal */
export function importHmacKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/**
 * Validates a hex secret and imports it as an HMAC-SHA-256 key.
 * Async so validation errors always surface as rejections. @internal
 */
export async function importHmacKeyFromHex(hexSecret: string, label = "secret"): Promise<CryptoKey> {
  if (hexSecret.length % 2 !== 0) throw new Error(`${label} must have an even number of hex characters`);
  if (!/^[0-9a-fA-F]+$/.test(hexSecret)) throw new Error(`${label} must contain only hexadecimal characters (0-9, a-f, A-F)`);
  const pairs = hexSecret.match(/.{2}/g);
  if (!pairs || pairs.length < 16) throw new Error(`${label} must be at least 32 hex characters (16 bytes)`);
  return importHmacKey(hexToBytes(hexSecret));
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

/** base64url-encodes raw bytes without padding. @internal */
export function base64urlEncode(data: Uint8Array | ArrayBuffer): string {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** Decodes a base64url string (with or without padding) to bytes. @internal */
export function base64urlDecode(str: string): Uint8Array<ArrayBuffer> {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = padded.length % 4;
  const padded2 = remainder ? padded + "=".repeat(4 - remainder) : padded;
  const binary = atob(padded2);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Constant-time byte array comparison via Cloudflare Workers crypto. @internal */
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (typeof subtle.timingSafeEqual !== "function") {
    throw new Error("crypto.subtle.timingSafeEqual is not available in this runtime");
  }

  if (a.byteLength !== b.byteLength) {
    subtle.timingSafeEqual(a, a);
    return false;
  }
  return subtle.timingSafeEqual(a, b);
}

/** Constant-time string comparison (UTF-8 encoded). @internal */
export function timingSafeEqual(a: string, b: string): boolean {
  return timingSafeEqualBytes(TEXT_ENCODER.encode(a), TEXT_ENCODER.encode(b));
}
