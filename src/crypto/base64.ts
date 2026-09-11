/** Reads a `btoa`/`atob` binary string — one character per byte — back into bytes. */
function bytesFromBinary(binary: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** base64-encodes raw bytes with the standard `+`/`/` alphabet, padding retained. @internal */
export function base64Encode(data: Uint8Array | ArrayBuffer): string {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Decodes a standard-alphabet base64 string, answering `null` rather than throwing. @internal */
export function base64DecodeOrNull(str: string): Uint8Array<ArrayBuffer> | null {
  // Strict on purpose, and never via `base64urlDecode`: that one remaps `-`/`_` and re-pads, so a
  // string this must reject would decode to different bytes — on the cookie path, a live session
  // verifying wrong. Only the byte loop is shared with it; none of the alphabet handling is.
  try {
    return bytesFromBinary(atob(str));
  } catch {
    return null;
  }
}

/** base64url-encodes raw bytes without padding. @internal */
export function base64urlEncode(data: Uint8Array | ArrayBuffer): string {
  return base64Encode(data).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** Decodes a base64url string (with or without padding) to bytes. @internal */
export function base64urlDecode(str: string): Uint8Array<ArrayBuffer> {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = padded.length % 4;
  return bytesFromBinary(atob(remainder ? padded + "=".repeat(4 - remainder) : padded));
}

/** Decodes a base64url string, answering `null` rather than throwing when it is not base64url. @internal */
export function base64urlDecodeOrNull(str: string): Uint8Array<ArrayBuffer> | null {
  try {
    return base64urlDecode(str);
  } catch {
    return null;
  }
}
