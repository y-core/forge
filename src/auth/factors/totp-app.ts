import { base32Encode, hotpCode, randomBytes, timingSafeEqual, totpCounter } from "../../crypto/mod";
import { type Result, err, ok } from "../../result/result";
import { authLimit } from "../limits";
import type { AuthFactor, AuthKeyRing, AuthStoreResult, FactorStore } from "../types";
import type { AuthFactorChallenge, AuthFactorReason, AuthFactorVerified, EnrollableFactorService } from "./registry";
import { openTotpSecret, sealTotpSecret } from "./totp-secret";

/** @public */
export interface TotpAppFactorOptions {
  keys: AuthKeyRing;
  factors: FactorStore;
  issuer: string;
  /** The account label a provisioning URI shows for the identity it enrols. */
  account: (userId: string) => string | Promise<string>;
  digits?: number;
  period?: number;
  secretBytes?: number;
  /** Wrong codes this enrolment admits before it refuses every one, until an accepted code clears them. */
  maxAttempts?: number;
}

/** What an enrolment shows once and never again — the base32 secret and the `otpauth://` URI carrying it. @public */
export type TotpAppEnrolment = { readonly secret: string; readonly uri: string };

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

  function currentCounter(at: number): number {
    return totpCounter(Math.floor(at / 1000), { period });
  }

  function stepEndsAt(at: number): number {
    return (currentCounter(at) + 1) * period * 1000;
  }

  async function readEnrolment(userId: string): Promise<Result<{ factor: AuthFactor; secret: Uint8Array<ArrayBuffer> }, AuthFactorReason>> {
    const found = await options.factors.find(userId, "totp-app");
    if (!found.ok) return err("unavailable");
    if (!found.data || found.data.secret === null) return err("not-enrolled");
    const secret = await openTotpSecret(options.keys, userId, found.data.secret);
    if (!secret) return err("unavailable");
    return ok({ factor: found.data, secret });
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
  // It is also what clears the spent guesses, so only a correct code buys the budget back.
  async function acceptCode(
    factor: AuthFactor,
    secret: Uint8Array<ArrayBuffer>,
    presented: string,
    at: number,
  ): Promise<Result<number, AuthFactorReason>> {
    // Spent before the comparison, never after: a guess that costs nothing until it is wrong is a
    // guess an attacker can make as fast as the network allows.
    const spent = await options.factors.countAttempt(factor.id, factor.userId, maxAttempts, at);
    if (!spent.ok) return err("unavailable");
    if (!spent.data) return err("too-many-attempts");

    const counter = await matchingCounter(secret, presented, at);
    if (counter === null) return err("unrecognised");
    const advanced = await options.factors.advanceCounter(factor.id, factor.userId, counter, at);
    if (!advanced.ok) return err("unavailable");
    if (!advanced.data) return err("consumed");
    return ok(counter);
  }

  async function createChallenge(userId: string, at: number): Promise<Result<AuthFactorChallenge, AuthFactorReason>> {
    const found = await options.factors.find(userId, "totp-app");
    if (!found.ok) return err("unavailable");
    if (!found.data || found.data.confirmedAt === null) return err("not-enrolled");
    return ok({ kind: "totp-app", expiresAt: stepEndsAt(at) });
  }

  async function verifyChallenge(userId: string, presented: string, at: number): Promise<Result<AuthFactorVerified, AuthFactorReason>> {
    const held = await readEnrolment(userId);
    if (!held.ok) return err(held.error);
    if (held.data.factor.confirmedAt === null) return err("not-enrolled");
    const accepted = await acceptCode(held.data.factor, held.data.secret, presented, at);
    if (!accepted.ok) return err(accepted.error);
    return ok({ kind: "totp-app", userId, verifiedAt: at });
  }

  async function beginEnrolment(userId: string, at: number): Promise<Result<AuthFactorChallenge, AuthFactorReason>> {
    const existing = await options.factors.find(userId, "totp-app");
    if (!existing.ok) return err("unavailable");
    if (existing.data?.confirmedAt != null) return err("already-enrolled");
    if (existing.data) {
      // An abandoned ceremony left a row holding a secret nobody has; without this a user could
      // never enrol again, which is the lockout an unconfirmed enrolment must not be able to cause.
      const removed = await options.factors.remove(existing.data.id, userId);
      if (!removed.ok) return err("unavailable");
    }

    const secret = randomBytes(secretBytes);
    const sealed = await sealTotpSecret(options.keys, userId, secret);
    const enrolled = await options.factors.enrol({ userId, kind: "totp-app", secret: sealed, confirmedAt: null }, at);
    if (!enrolled.ok) return err("unavailable");

    const enrolment: TotpAppEnrolment = {
      secret: base32Encode(secret),
      uri: provisioningUri(options.issuer, await options.account(userId), base32Encode(secret), digits, period),
    };
    return ok({ kind: "totp-app", expiresAt: stepEndsAt(at), options: enrolment });
  }

  async function completeEnrolment(userId: string, presented: string, at: number): Promise<Result<AuthFactor, AuthFactorReason>> {
    const held = await readEnrolment(userId);
    if (!held.ok) return err(held.error);
    const accepted = await acceptCode(held.data.factor, held.data.secret, presented, at);
    if (!accepted.ok) return err(accepted.error);
    // Confirmed only after the code checks out: a row that could step up before then would let a
    // half-finished ceremony stand between a user and their own account.
    const confirmed = await options.factors.confirm(held.data.factor.id, userId, at);
    if (!confirmed.ok) return err("unavailable");
    if (!confirmed.data) return err("not-enrolled");
    return ok({ ...held.data.factor, lastCounter: accepted.data, confirmedAt: at, updatedAt: at });
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
    reissueAfterMs: null,
    createChallenge,
    verifyChallenge,
    beginEnrolment,
    completeEnrolment,
    listEnrolments,
  };
}
