const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Reverse alphabet: index is the character code, value is the 5-bit group or `undefined`. */
const BASE32_VALUES: Record<string, number> = Object.fromEntries([...BASE32_ALPHABET].map((ch, i) => [ch, i]));

/** Encodes bytes as unpadded RFC 4648 base32. @internal */
export function base32Encode(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(buffer >> bits) & 31];
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

/** Decodes unpadded or padded RFC 4648 base32, rejecting any character outside the alphabet. @internal */
export function base32Decode(text: string): Uint8Array<ArrayBuffer> {
  const body = text.replace(/=+$/, "").toUpperCase();
  const out = new Uint8Array(Math.floor((body.length * 5) / 8));
  let buffer = 0;
  let bits = 0;
  let written = 0;
  for (const ch of body) {
    const value = Object.hasOwn(BASE32_VALUES, ch) ? BASE32_VALUES[ch] : undefined;
    // Skipping an unknown character would make `MZXW6!` and `MZXW6` decode alike, so a shared
    // secret typed with one stray keystroke would silently authenticate.
    if (value === undefined) throw new Error(`base32Decode: "${ch}" is not a base32 character`);
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[written++] = (buffer >> bits) & 0xff;
    }
  }
  return out;
}
