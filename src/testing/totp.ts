import { base32Decode } from "../crypto/primitives/base32";
import { totpCode } from "../crypto/primitives/hotp";
import type { HotpHash } from "../crypto/primitives/types";
import type { TotpCodes } from "./types";

const HASHES: Record<string, HotpHash> = { SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" };

// Both codes from one reading, so a step boundary cannot fall between them.
/** What an authenticator app enrolled from `uri` shows at `at` (epoch milliseconds) and one step earlier, by the URI's own algorithm, digits and period. @public */
export async function totpCodes(uri: string, at: number): Promise<TotpCodes> {
  const params = new URL(uri).searchParams;
  const algorithm = params.get("algorithm") ?? "SHA1";
  const hash = HASHES[algorithm];
  if (hash === undefined) throw new Error(`totpCodes: unsupported algorithm ${algorithm}`);
  const secret = base32Decode(params.get("secret") ?? "");
  const options = { hash, period: Number(params.get("period") ?? "30"), digits: Number(params.get("digits") ?? "6") };
  const seconds = at / 1000;
  return { previous: await totpCode(secret, seconds - options.period, options), current: await totpCode(secret, seconds, options) };
}
