// Generated from src/testing/totp.ts by `bun run gen:bundles` — do not edit.

// src/crypto/base32.ts
var BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
var BASE32_VALUES = Object.fromEntries([...BASE32_ALPHABET].map((ch, i) => [ch, i]));
var BASE32_PADDING = [0, void 0, 6, void 0, 4, 3, void 0, 1];
function base32Decode(text) {
  const upper = text.toUpperCase();
  const body = upper.replace(/=+$/, "");
  const padding = BASE32_PADDING[body.length % 8];
  if (padding === void 0) throw new Error(`base32Decode: ${body.length} characters cannot encode whole bytes`);
  const padded = upper.length - body.length;
  if (padded !== 0 && padded !== padding) throw new Error(`base32Decode: ${padded} padding characters do not close the block`);
  const out = new Uint8Array(Math.floor(body.length * 5 / 8));
  let buffer = 0;
  let bits = 0;
  let written = 0;
  for (const ch of body) {
    const value = Object.hasOwn(BASE32_VALUES, ch) ? BASE32_VALUES[ch] : void 0;
    if (value === void 0) throw new Error(`base32Decode: "${ch}" is not a base32 character`);
    buffer = buffer << 5 | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[written++] = buffer >> bits & 255;
    }
  }
  if ((buffer & (1 << bits) - 1) !== 0) throw new Error("base32Decode: trailing bits are not zero");
  return out;
}

// src/crypto/hotp.ts
var DEFAULT_DIGITS = 6;
var DEFAULT_HASH = "SHA-1";
var DEFAULT_PERIOD = 30;
function counterBytes(counter) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, counter, false);
  return bytes;
}
async function hotpCode(secret, counter, options = {}) {
  const digits = options.digits ?? DEFAULT_DIGITS;
  if (!Number.isInteger(digits) || digits < 6 || digits > 10) throw new Error("hotpCode: digits must be an integer between 6 and 10");
  const value = BigInt(counter);
  if (value < 0n) throw new Error("hotpCode: counter must not be negative");
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: options.hash ?? DEFAULT_HASH }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBytes(value)));
  const offset = mac[mac.length - 1] & 15;
  const truncated = (mac[offset] & 127) << 24 | mac[offset + 1] << 16 | mac[offset + 2] << 8 | mac[offset + 3];
  return (truncated % 10 ** digits).toString().padStart(digits, "0");
}
async function totpCode(secret, seconds, options = {}) {
  const period = options.period ?? DEFAULT_PERIOD;
  if (!Number.isInteger(period) || period < 1) throw new Error("totpCode: period must be a positive whole number of seconds");
  const elapsed = Math.floor(seconds) - (options.epoch ?? 0);
  if (elapsed < 0) throw new Error("totpCode: seconds must not precede the epoch");
  return hotpCode(secret, Math.floor(elapsed / period), options);
}

// src/testing/totp.ts
var HASHES = { SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" };
async function totpCodes(uri, at) {
  const params = new URL(uri).searchParams;
  const algorithm = params.get("algorithm") ?? "SHA1";
  const hash = HASHES[algorithm];
  if (hash === void 0) throw new Error(`totpCodes: unsupported algorithm ${algorithm}`);
  const secret = base32Decode(params.get("secret") ?? "");
  const options = { hash, period: Number(params.get("period") ?? "30"), digits: Number(params.get("digits") ?? "6") };
  const seconds = at / 1e3;
  return { previous: await totpCode(secret, seconds - options.period, options), current: await totpCode(secret, seconds, options) };
}
export {
  totpCodes
};
