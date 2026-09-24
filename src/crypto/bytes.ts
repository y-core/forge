/** @internal */
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

/** Joins byte arrays into one new array, in the order given. @internal */
export function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  let total = 0;
  for (const part of parts) total += part.byteLength;
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined;
}
