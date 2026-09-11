import { base32Encode, hotpCode, randomBytes, timingSafeEqual, totpCounter } from "../../crypto/mod";
import { err, ok } from "../../result/result";
import type { Result } from "../../result/types";
import { AUTH_TOTP_LOCKOUT_MS } from "../config";
import { authLimit } from "../limits";
import type { AuthFactor, AuthStoreResult } from "../types";
import { openTotpSecret, sealTotpSecret } from "./totp-secret";
import type { AuthFactorChallenge, AuthFactorReason, AuthFactorVerified, EnrollableFactorService } from "./types";
import type { TotpAppEnrolment, TotpAppFactorOptions } from "./types";

const DEFAULT_SECRET_BYTES = 20;
const MIN_SECRET_BYTES = 16;
const DEFAULT_DIGITS = 6;
const MIN_DIGITS = 6;
const MAX_DIGITS = 8;
const DEFAULT_PERIOD = 30;
const MIN_PERIOD_SECONDS = 15;
const MAX_PERIOD_SECONDS = 120;
const DEFAULT_MAX_ATTEMPTS = 5;
const MIN_MAX_ATTEMPTS = 1;
const MAX_MAX_ATTEMPTS = 20;
const MIN_LOCKOUT_MS = 60_000;
const MAX_LOCKOUT_MS = 86_400_000;

// One step either side and no more: every extra step multiplies the guess space an attacker gets
// against a six-digit code, and buys nothing a correctly set clock needs.
const DRIFT_STEPS = 1;

function provisioningUri(issuer: string, account: string, secret: string, digits: number, period: number): string {
  // Percent-encoded, not `URLSearchParams`: form encoding emits `+` for a space, and an
  // authenticator showing `Forge+Demo` is showing the encoding rather than the issuer.
  const query = [`secret=${secret}`, `issuer=${encodeURIComponent(issuer)}`, "algorithm=SHA1", `digits=${digits}`, `period=${period}`];
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?${query.join("&")}`;
}

/** Verifies a code from an authenticator app. Step-up only — possession proves nothing about who is present. @public */
export function createTotpAppFactor(options: TotpAppFactorOptions): EnrollableFactorService {
  const digits = authLimit("createTotpAppFactor", "digits", options.digits, {
    fallback: DEFAULT_DIGITS,
    min: MIN_DIGITS,
    max: MAX_DIGITS,
    unit: "digit",
    floor: "the shortest code RFC 4226 §5.3 allows",
    ceiling: "the widest code dynamic truncation fills uniformly from its 31 bits",
  });
  const period = authLimit("createTotpAppFactor", "period", options.period, {
    fallback: DEFAULT_PERIOD,
    min: MIN_PERIOD_SECONDS,
    max: MAX_PERIOD_SECONDS,
    unit: "second",
    floor: "below it the drift window is the only thing keeping a code answerable",
    ceiling: "one step either side of it already keeps a code live for six minutes",
  });
  const secretBytes = authLimit("createTotpAppFactor", "secretBytes", options.secretBytes, {
    fallback: DEFAULT_SECRET_BYTES,
    min: MIN_SECRET_BYTES,
    unit: "byte",
    floor: "the 128 bits RFC 4226 §4 R6 states for a shared secret",
  });
  const maxAttempts = authLimit("createTotpAppFactor", "maxAttempts", options.maxAttempts, {
    fallback: DEFAULT_MAX_ATTEMPTS,
    min: MIN_MAX_ATTEMPTS,
    max: MAX_MAX_ATTEMPTS,
    unit: "attempt",
    floor: "a single mistyped digit would otherwise lock the factor out",
    ceiling: "beyond it the drift window hands an attacker more of a six-digit space than it withholds",
  });
  const lockoutMs = authLimit("createTotpAppFactor", "lockoutMs", options.lockoutMs, {
    fallback: AUTH_TOTP_LOCKOUT_MS,
    min: MIN_LOCKOUT_MS,
    max: MAX_LOCKOUT_MS,
    unit: "millisecond",
    floor: "a shorter window hands the spent budget back before an attacker has to slow down",
    ceiling: "a window past a day is the permanent lock this exists to prevent",
  });

  function currentCounter(at: number): number {
    return totpCounter(Math.floor(at / 1000), { period });
  }

  function stepEndsAt(at: number): number {
    return (currentCounter(at) + 1) * period * 1000;
  }

  /** The sealed secret on `factor`, opened, or the reason it cannot stand in for an enrolment. */
  async function openSecret(userId: string, factor: AuthFactor | null): Promise<Result<Uint8Array<ArrayBuffer>, AuthFactorReason>> {
    if (!factor || factor.secret === null) return err("not-enrolled");
    const secret = await openTotpSecret(options.keys, userId, factor.secret);
    return secret ? ok(secret) : err("unavailable");
  }

  async function matchingCounter(secret: Uint8Array<ArrayBuffer>, presented: string, at: number): Promise<number | null> {
    const current = currentCounter(at);
    for (let step = -DRIFT_STEPS; step <= DRIFT_STEPS; step++) {
      const counter = current + step;
      if (counter < 0) continue;
      if (timingSafeEqual(await hotpCode(secret, counter, { digits }), presented)) return counter;
    }
    return null;
  }

  // The advance is the replay guard: `advanceCounter` writes only above the last accepted step, so
  // presenting one code twice inside its own window changes no row and is refused the second time.
  // It is also what clears the spent guesses outright; short of that only the lockout window
  // elapsing reopens the budget, and then at a count of one.
  async function acceptCode(
    userId: string,
    presented: string,
    at: number,
    admits: (factor: AuthFactor) => boolean,
  ): Promise<Result<{ factor: AuthFactor; counter: number }, AuthFactorReason>> {
    // One statement finds the row and spends the guess against it, so no read sits between the two
    // and the guess is spent before the comparison, never after: a guess that costs nothing until it
    // is wrong is a guess an attacker can make as fast as the network allows.
    const spent = await options.factors.countAttempt(userId, "totp-app", maxAttempts, at, lockoutMs);
    if (!spent.ok) return err("unavailable");
    // The one statement collapses "no such factor" into "budget spent", so a second read tells them
    // apart — and only once the write has already been refused, which costs an attacker the guess.
    if (!spent.data) {
      const found = await options.factors.find(userId, "totp-app");
      if (!found.ok) return err("unavailable");
      return err(found.data ? "too-many-attempts" : "not-enrolled");
    }
    const factor = spent.data;
    // Judged before the code is compared and before any counter moves: a row this caller may not use
    // must not have its step spent, or a refused verification would consume the confirming code.
    if (!admits(factor)) return err("not-enrolled");

    const secret = await openSecret(userId, factor);
    if (!secret.ok) return err(secret.error);
    const counter = await matchingCounter(secret.data, presented, at);
    if (counter === null) return err("unrecognised");
    const advanced = await options.factors.advanceCounter(factor.id, userId, counter, at);
    if (!advanced.ok) return err("unavailable");
    if (!advanced.data) return err("consumed");
    return ok({ factor, counter });
  }

  async function createChallenge(userId: string, at: number): Promise<Result<AuthFactorChallenge, AuthFactorReason>> {
    const found = await options.factors.find(userId, "totp-app");
    if (!found.ok) return err("unavailable");
    if (!found.data || found.data.confirmedAt === null) return err("not-enrolled");
    return ok({ kind: "totp-app", expiresAt: stepEndsAt(at) });
  }

  async function verifyChallenge(userId: string, presented: string, at: number): Promise<Result<AuthFactorVerified, AuthFactorReason>> {
    // An unconfirmed row is a ceremony nobody finished, and it must not step anybody up. The guess
    // is spent either way, so a confirmed factor and an unfinished one cost the same.
    const accepted = await acceptCode(userId, presented, at, (factor) => factor.confirmedAt !== null);
    if (!accepted.ok) return err(accepted.error);
    return ok({ kind: "totp-app", userId, verifiedAt: at });
  }

  /** The challenge a ceremony hands the page: the shared secret, in both the forms an app accepts. */
  async function enrolmentOf(userId: string, secret: Uint8Array<ArrayBuffer>, at: number): Promise<Result<AuthFactorChallenge, AuthFactorReason>> {
    const base32 = base32Encode(secret);
    const enrolment: TotpAppEnrolment = {
      secret: base32,
      uri: provisioningUri(options.issuer, await options.account(userId), base32, digits, period),
    };
    return ok({ kind: "totp-app", expiresAt: stepEndsAt(at), options: enrolment });
  }

  async function beginEnrolment(userId: string, at: number): Promise<Result<AuthFactorChallenge, AuthFactorReason>> {
    const existing = await options.factors.find(userId, "totp-app");
    if (!existing.ok) return err("unavailable");
    if (existing.data?.confirmedAt != null) return err("already-enrolled");

    // The defect this closes: this rebuilt the row unconditionally, so re-rendering the enrol page —
    // which a mistyped code does — handed back a *different* secret from the one the visitor had
    // just stored in their authenticator, and the ceremony could never be finished.
    if (existing.data?.secret) {
      const held = await openTotpSecret(options.keys, userId, existing.data.secret);
      if (held) return enrolmentOf(userId, held, at);
    }

    if (existing.data) {
      // Only reached when the stored secret will not open, which is a rotated key and not an
      // abandoned ceremony: without this a user could never enrol again, which is the lockout an
      // unconfirmed enrolment must not be able to cause.
      const removed = await options.factors.remove(existing.data.id, userId);
      if (!removed.ok) return err("unavailable");
    }

    const secret = randomBytes(secretBytes);
    const sealed = await sealTotpSecret(options.keys, userId, secret);
    const enrolled = await options.factors.enrol({ userId, kind: "totp-app", secret: sealed, confirmedAt: null }, at);
    if (!enrolled.ok) return err("unavailable");
    return enrolmentOf(userId, secret, at);
  }

  async function completeEnrolment(userId: string, presented: string, at: number): Promise<Result<AuthFactor, AuthFactorReason>> {
    const accepted = await acceptCode(userId, presented, at, () => true);
    if (!accepted.ok) return err(accepted.error);
    // Confirmed only after the code checks out: a row that could step up before then would let a
    // half-finished ceremony stand between a user and their own account.
    const confirmed = await options.factors.confirm(accepted.data.factor.id, userId, at);
    if (!confirmed.ok) return err("unavailable");
    if (!confirmed.data) return err("not-enrolled");
    return ok({ ...accepted.data.factor, lastCounter: accepted.data.counter, confirmedAt: at, updatedAt: at });
  }

  async function listEnrolments(userId: string): Promise<AuthStoreResult<readonly AuthFactor[]>> {
    const found = await options.factors.find(userId, "totp-app");
    return found.ok ? ok(found.data ? [found.data] : []) : err(found.error);
  }

  return {
    kind: "totp-app",
    enrolment: "explicit",
    capabilities: { primary: false, stepUp: true },
    // The ceiling, not the exact life: a code issued mid-step expires when that step ends.
    challengeTtlMs: period * 1000,
    codeDigits: digits,
    codePeriodSeconds: period,
    reissueAfterMs: null,
    createChallenge,
    verifyChallenge,
    beginEnrolment,
    completeEnrolment,
    listEnrolments,
  };
}
