import { randomBytes, timingSafeEqual } from "../../crypto/primitives/mod";
import { err, ok } from "../../result/result";
import type { Result } from "../../result/types";
import { AUTH_NOTIFY_TIMEOUT_MS, AUTH_OTP_COOLDOWN_MS, AUTH_OTP_DIGITS, AUTH_OTP_MAX_ATTEMPTS, AUTH_OTP_TTL_MS } from "../config";
import { authNonceKey, authNonceTtlSeconds, authStandInToken, decodeAuthToken, encodeAuthToken } from "../keys/token";
import { authLimit } from "../limits";
import type { AuthStoreResult } from "../types";
import type { AuthFactorChallenge, AuthFactorReason, AuthFactorVerified, ImplicitFactorService } from "./types";
import type { EmailOtpOptions } from "./types";

const MIN_DIGITS = 6;
const MAX_DIGITS = 8;
const MIN_TTL_MS = 60_000;
const MAX_TTL_MS = 600_000;
const MIN_MAX_ATTEMPTS = 1;
const MAX_MAX_ATTEMPTS = 10;
const MIN_COOLDOWN_MS = 1_000;
const MAX_COOLDOWN_MS = 3_600_000;

const PAYLOAD_SEPARATOR = "\0";

function randomCode(digits: number): string {
  const ceiling = 10 ** digits;
  // Rejection sampling: a plain modulo of a 32-bit draw would make the low codes more likely.
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

  async function deliverCode(to: string, code: string, expiresAt: number): Promise<boolean> {
    try {
      const sent = await options.notifier.send({ to, kind: "otp", code, expiresAt }, AbortSignal.timeout(AUTH_NOTIFY_TIMEOUT_MS));
      return sent.ok;
    } catch {
      return false;
    }
  }

  async function createChallenge(userId: string, at: number): Promise<Result<AuthFactorChallenge, AuthFactorReason>> {
    const code = randomCode(digits);
    const token = await encodeAuthToken(options.keys, "verify", `${userId}${PAYLOAD_SEPARATOR}${code}`, ttlMs, { now: at });
    const expiresAt = at + ttlMs;

    const claimed = await options.state.issue(userId, { token, attempts: 0, issuedAt: at, expiresAt }, cooldownMs);
    if (!claimed.ok) return err("unavailable");
    if (!claimed.data) return err("too-soon");

    const to = await options.address(userId);
    if (!(await deliverCode(to, code, expiresAt))) {
      await options.state.discard(userId, token);
      return err("unavailable");
    }
    return ok({ kind: "email-otp", expiresAt });
  }

  async function verifyChallenge(userId: string, presented: string, at: number): Promise<Result<AuthFactorVerified, AuthFactorReason>> {
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
    listEnrolments: (): Promise<AuthStoreResult<readonly never[]>> => Promise.resolve(ok([])),
  };
}
