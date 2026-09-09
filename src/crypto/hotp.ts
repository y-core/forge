/** The SHA family an authenticator app may be provisioned with, per RFC 6238 §1.2. @internal */
export type HotpHash = "SHA-1" | "SHA-256" | "SHA-512";

/** @internal */
export interface HotpOptions {
  digits?: number;
  hash?: HotpHash;
}

/** @internal */
export interface TotpOptions extends HotpOptions {
  period?: number;
  epoch?: number;
}

const DEFAULT_DIGITS = 6;
const DEFAULT_HASH: HotpHash = "SHA-1";
const DEFAULT_PERIOD = 30;

function counterBytes(counter: bigint): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, counter, false);
  return bytes;
}

/** RFC 4226 §5.3 HOTP: the counter-based one-time password, zero-padded to `digits`. @internal */
export async function hotpCode(secret: Uint8Array<ArrayBuffer>, counter: number | bigint, options: HotpOptions = {}): Promise<string> {
  const digits = options.digits ?? DEFAULT_DIGITS;
  if (!Number.isInteger(digits) || digits < 6 || digits > 10) throw new Error("hotpCode: digits must be an integer between 6 and 10");
  const value = BigInt(counter);
  if (value < 0n) throw new Error("hotpCode: counter must not be negative");

  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: options.hash ?? DEFAULT_HASH }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBytes(value)));
  // oxlint-disable-next-line typescript/no-non-null-assertion -- an HMAC digest is never shorter than 20 bytes, so every index below is in range
  const offset = mac[mac.length - 1]! & 0x0f;
  // oxlint-disable-next-line typescript/no-non-null-assertion -- the offset is at most 15 and the digest at least 20 bytes long
  const truncated = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return (truncated % 10 ** digits).toString().padStart(digits, "0");
}

/** RFC 6238 TOTP: HOTP over a counter derived from an explicit clock reading in seconds. @internal */
export async function totpCode(secret: Uint8Array<ArrayBuffer>, seconds: number, options: TotpOptions = {}): Promise<string> {
  const period = options.period ?? DEFAULT_PERIOD;
  if (!Number.isInteger(period) || period < 1) throw new Error("totpCode: period must be a positive whole number of seconds");
  const elapsed = Math.floor(seconds) - (options.epoch ?? 0);
  if (elapsed < 0) throw new Error("totpCode: seconds must not precede the epoch");
  return hotpCode(secret, Math.floor(elapsed / period), options);
}

/** The RFC 6238 counter a clock reading falls in — what a caller steps to search a verification window. @internal */
export function totpCounter(seconds: number, options: Pick<TotpOptions, "epoch" | "period"> = {}): number {
  return Math.floor((Math.floor(seconds) - (options.epoch ?? 0)) / (options.period ?? DEFAULT_PERIOD));
}
