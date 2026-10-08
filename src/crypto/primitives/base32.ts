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

/** Padding a body of each length modulo 8 needs; `undefined` marks a length no byte count can produce. */
const BASE32_PADDING: readonly (number | undefined)[] = [0, undefined, 6, undefined, 4, 3, undefined, 1];

/** Decodes unpadded or padded RFC 4648 base32, rejecting any encoding no byte sequence produces. @internal */
export function base32Decode(text: string): Uint8Array<ArrayBuffer> {
  const upper = text.toUpperCase();
  const body = upper.replace(/=+$/, "");
  const padding = BASE32_PADDING[body.length % 8];
  // Without the length check `base32Decode("M")` returns an empty array: five bits are too few to
  // write a byte, so a secret truncated to one character decodes to "no secret" rather than failing.
  if (padding === undefined) throw new Error(`base32Decode: ${body.length} characters cannot encode whole bytes`);
  const padded = upper.length - body.length;
  if (padded !== 0 && padded !== padding) throw new Error(`base32Decode: ${padded} padding characters do not close the block`);
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
  // The encoder zero-fills the leftover bits, so a non-zero remainder came from somewhere else:
  // `MZXW6YQ` and `MZXW6YR` would otherwise both decode to `foob`, giving one secret two spellings.
  if ((buffer & ((1 << bits) - 1)) !== 0) throw new Error("base32Decode: trailing bits are not zero");
  return out;
}
