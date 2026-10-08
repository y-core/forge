import { randomBytes, timingSafeEqual } from "../../crypto/primitives/mod";
import { err, ok } from "../../result/result";
import type { Result } from "../../result/types";
import { AUTH_OTP_COOLDOWN_MS, AUTH_OTP_DIGITS, AUTH_OTP_MAX_ATTEMPTS, AUTH_OTP_TTL_MS } from "../config";
import { authNonceKey, authNonceTtlSeconds, authStandInToken, decodeAuthToken, encodeAuthToken } from "../keys/token";
import { authLimit } from "../limits";
import type { AuthStoreResult } from "../types";
import type { AuthFactorChallenge, AuthFactorReason, AuthFactorVerified, ImplicitFactorService } from "./types";
import type { EmailOtpOptions } from "./types";

const MIN_DIGITS = 6;
// Above nine, `10 ** digits` passes `2 ** 32` and `randomCode` samples from an empty range for good.
const MAX_DIGITS = 8;
const MIN_TTL_MS = 60_000;
const MAX_TTL_MS = 600_000;
const MIN_MAX_ATTEMPTS = 1;
const MAX_MAX_ATTEMPTS = 10;
const MIN_COOLDOWN_MS = 1_000;
const MAX_COOLDOWN_MS = 3_600_000;

const PAYLOAD_SEPARATOR = "\0";

/** Rejection-sampled so every code is equally likely — a plain modulo biases the low digits. */
function randomCode(digits: number): string {
  const ceiling = 10 ** digits;
  const limit = Math.floor(0x1_0000_0000 / ceiling) * ceiling;
  for (;;) {
    const value = new DataView(randomBytes(4).buffer).getUint32(0, false);
    if (value < limit) return (value % ceiling).toString().padStart(digits, "0");
  }
}

/** Issues, delivers and verifies an emailed one-time code. Enrolment is implicit — a verified address is it. @public */
export function createEmailOtpFactor(options: EmailOtpOptions): ImplicitFactorService<"email-otp"> {
  const digits = authLimit("createEmailOtpFactor", "digits", options.digits, {
    fallback: AUTH_OTP_DIGITS,
    min: MIN_DIGITS,
    max: MAX_DIGITS,
    unit: "digit",
    floor: "the shortest code that is not trivially guessable",
    ceiling: "the widest code the one-time-code field renders, which is also where the authenticator app's own range ends",
  });
  const ttlMs = authLimit("createEmailOtpFactor", "ttlMs", options.ttlMs, {
    fallback: AUTH_OTP_TTL_MS,
    min: MIN_TTL_MS,
    max: MAX_TTL_MS,
    unit: "millisecond",
    floor: "the shortest expiration the nonce store accepts, below which a code outlives its own replay guard",
    ceiling: "the ten minutes NIST SP 800-63B §5.1.3.2 allows an out-of-band secret",
  });
  const maxAttempts = authLimit("createEmailOtpFactor", "maxAttempts", options.maxAttempts, {
    fallback: AUTH_OTP_MAX_ATTEMPTS,
    min: MIN_MAX_ATTEMPTS,
    max: MAX_MAX_ATTEMPTS,
    unit: "attempt",
    floor: "a factor that admits no guess refuses the right code too",
    ceiling: "every further guess is one an attacker spends against a six-digit code",
  });
  const cooldownMs = authLimit("createEmailOtpFactor", "cooldownMs", options.cooldownMs, {
    fallback: AUTH_OTP_COOLDOWN_MS,
    min: MIN_COOLDOWN_MS,
    max: MAX_COOLDOWN_MS,
    unit: "millisecond",
    floor: "the cooldown is the only bound on how much mail one address can be sent",
    ceiling: "a wait longer than an hour locks a user out of their own sign-in",
  });

  async function createChallenge(userId: string, at: number): Promise<Result<AuthFactorChallenge, AuthFactorReason>> {
    const code = randomCode(digits);
    const token = await encodeAuthToken(options.keys, "verify", `${userId}${PAYLOAD_SEPARATOR}${code}`, ttlMs, { now: at });
    const expiresAt = at + ttlMs;

    // Claimed before the mail goes out, so the cooldown bounds what is sent rather than what is
    // recorded — and given back below, so a broken mailer leaves no identity holding a spent one.
    const claimed = await options.state.issue(userId, { token, attempts: 0, issuedAt: at, expiresAt }, cooldownMs);
    if (!claimed.ok) return err("unavailable");
    if (!claimed.data) return err("too-soon");

    const sent = await options.notifier.send({ to: await options.address(userId), kind: "otp", code, expiresAt });
    if (!sent.ok) {
      // Give the cooldown back: the identity spent one and holds a code nobody can read. Named by
      // token and not `clear`, so a second issue that raced this one and *did* send is left alone.
      await options.state.discard(userId, token);
      return err("unavailable");
    }
    return ok({ kind: "email-otp", expiresAt });
  }

  async function verifyChallenge(userId: string, presented: string, at: number): Promise<Result<AuthFactorVerified, AuthFactorReason>> {
    // The guess is spent and admitted by one statement, so the ceiling holds against parallel
    // guesses. Nothing distinguishes the refusals it collapses, so a second read classifies them.
    const counted = await options.state.countAttempt(userId, maxAttempts, at);
    if (!counted.ok) return err("unavailable");

    // Read and opened on every outcome, not only where the answer needs them: a refusal that
    // short-circuited past either told an attacker, by its cost, which refusal it was.
    const live = await options.state.read(userId, at);
    if (!live.ok) return err("unavailable");
    const token = counted.data === null ? await authStandInToken(options.keys, "verify") : counted.data.token;
    const decoded = await decodeAuthToken(options.keys, "verify", token, { now: at });
    if (counted.data === null) return err(live.data === null ? "expired" : "too-many-attempts");
    if (!decoded.ok) return err(decoded.error === "expired" ? "expired" : "unrecognised");

    const [subject, code] = decoded.data.payload.split(PAYLOAD_SEPARATOR);
    if (subject !== userId || code === undefined || !timingSafeEqual(code, presented)) return err("unrecognised");

    // Consumed through the nonce store, so a code that was already spent cannot be replayed even
    // inside its own lifetime.
    const nonce = await authNonceKey(options.keys, counted.data.token);
    if (!nonce.ok) return err("unrecognised");
    const fresh = await options.nonces.markConsumed(nonce.data, authNonceTtlSeconds(ttlMs));
    if (!fresh.ok) return err("unavailable");
    if (!fresh.data) return err("consumed");

    const cleared = await options.state.clear(userId);
    if (!cleared.ok) return err("unavailable");
    return ok({ kind: "email-otp", userId, verifiedAt: at });
  }

  return {
    kind: "email-otp",
    enrolment: "implicit",
    capabilities: { stepUp: true },
    challengeTtlMs: ttlMs,
    codeDigits: digits,
    codePeriodSeconds: null,
    reissueAfterMs: cooldownMs,
    createChallenge,
    verifyChallenge,
    // A verified address *is* the enrolment, so there is no factor row to list.
    listEnrolments: (): Promise<AuthStoreResult<readonly never[]>> => Promise.resolve(ok([])),
  };
}
