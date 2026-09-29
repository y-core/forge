import { base32Encode, randomBytes, sha256 } from "../../crypto/mod";
import { err, ok } from "../../result/result";
import type { Result } from "../../result/types";
import { AUTH_RECOVERY_CODE_BYTES, AUTH_RECOVERY_CODE_COUNT, AUTH_TOTP_LOCKOUT_MS } from "../config";
import { authLimit } from "../limits";
import type { AuthFactor, AuthStoreResult } from "../types";
import type { AuthFactorChallenge, AuthFactorReason, AuthFactorVerified } from "./types";
import type { RecoveryCodeFactorOptions, RecoveryCodeFactorService } from "./types";

const CODE_LENGTH = Math.ceil((AUTH_RECOVERY_CODE_BYTES * 8) / 5);
const GROUP_LENGTH = 4;
const BASE32_CODE = /^[A-Z2-7]+$/;
const DEFAULT_MAX_ATTEMPTS = 5;
const MIN_MAX_ATTEMPTS = 1;
const MAX_MAX_ATTEMPTS = 20;
const MIN_LOCKOUT_MS = 60_000;
const MAX_LOCKOUT_MS = 86_400_000;

/** A presented code with its separators and case folded away, or `null` when it cannot be a recovery code. @internal */
export function normaliseRecoveryCode(presented: string): string | null {
  const folded = presented.replace(/[\s-]/g, "").toUpperCase();
  return folded.length === CODE_LENGTH && BASE32_CODE.test(folded) ? folded : null;
}

function mintRecoveryCode(): string {
  const raw = base32Encode(randomBytes(AUTH_RECOVERY_CODE_BYTES));
  return (raw.match(new RegExp(`.{1,${GROUP_LENGTH}}`, "g")) ?? []).join("-");
}

/** Verifies a single-use recovery code, issued as a set the user confirms before it replaces the last. @public */
export function createRecoveryCodeFactor(options: RecoveryCodeFactorOptions): RecoveryCodeFactorService {
  const maxAttempts = authLimit("createRecoveryCodeFactor", "maxAttempts", options.maxAttempts, {
    fallback: DEFAULT_MAX_ATTEMPTS,
    min: MIN_MAX_ATTEMPTS,
    max: MAX_MAX_ATTEMPTS,
    unit: "attempt",
    floor: "a single mistyped character would otherwise lock the factor out",
    ceiling: "beyond it a spent budget stops slowing anyone who is guessing",
  });
  const lockoutMs = authLimit("createRecoveryCodeFactor", "lockoutMs", options.lockoutMs, {
    fallback: AUTH_TOTP_LOCKOUT_MS,
    min: MIN_LOCKOUT_MS,
    max: MAX_LOCKOUT_MS,
    unit: "millisecond",
    floor: "a shorter window hands the spent budget back before an attacker has to slow down",
    ceiling: "a window past a day is the permanent lock this exists to prevent",
  });

  /** Spends one guess against the user's row, answering the row or why no guess could be spent. */
  async function spendAttempt(userId: string, at: number): Promise<Result<AuthFactor, AuthFactorReason>> {
    const spent = await options.factors.countAttempt(userId, "recovery-code", maxAttempts, at, lockoutMs);
    if (!spent.ok) return err("unavailable");
    if (spent.data) return ok(spent.data);
    const found = await options.factors.find(userId, "recovery-code");
    if (!found.ok) return err("unavailable");
    return err(found.data ? "too-many-attempts" : "not-enrolled");
  }

  async function createChallenge(userId: string, at: number): Promise<Result<AuthFactorChallenge, AuthFactorReason>> {
    const found = await options.factors.find(userId, "recovery-code");
    if (!found.ok) return err("unavailable");
    if (!found.data || found.data.confirmedAt === null) return err("not-enrolled");
    return ok({ kind: "recovery-code", expiresAt: at + lockoutMs });
  }

  async function verifyChallenge(userId: string, presented: string, at: number): Promise<Result<AuthFactorVerified, AuthFactorReason>> {
    const spent = await spendAttempt(userId, at);
    if (!spent.ok) return err(spent.error);
    if (spent.data.confirmedAt === null) return err("not-enrolled");
    const code = normaliseRecoveryCode(presented);
    if (code === null) return err("unrecognised");
    const consumed = await options.codes.consume(userId, spent.data.id, await sha256(code), at);
    if (!consumed.ok) return err("unavailable");
    if (!consumed.data) return err("unrecognised");
    return ok({ kind: "recovery-code", userId, verifiedAt: at });
  }

  async function beginEnrolment(userId: string, at: number): Promise<Result<AuthFactorChallenge, AuthFactorReason>> {
    const found = await options.factors.find(userId, "recovery-code");
    if (!found.ok) return err("unavailable");
    if (!found.data) {
      const enrolled = await options.factors.enrol({ userId, kind: "recovery-code", confirmedAt: null }, at);
      if (!enrolled.ok && enrolled.error.code !== "conflict") return err("unavailable");
    }
    const codes = Array.from({ length: AUTH_RECOVERY_CODE_COUNT }, mintRecoveryCode);
    const hashes = await Promise.all(codes.map((code) => sha256(code.replaceAll("-", ""))));
    const staged = await options.codes.stage(userId, hashes, at);
    if (!staged.ok) return err("unavailable");
    return ok({ kind: "recovery-code", expiresAt: at + lockoutMs, options: { codes } });
  }

  async function completeEnrolment(userId: string, presented: string, at: number): Promise<Result<AuthFactor, AuthFactorReason>> {
    const spent = await spendAttempt(userId, at);
    if (!spent.ok) return err(spent.error);
    const code = normaliseRecoveryCode(presented);
    if (code === null) return err("unrecognised");
    const held = await options.codes.holdsStaged(userId, await sha256(code));
    if (!held.ok) return err("unavailable");
    if (!held.data) return err("unrecognised");
    const committed = await options.codes.commit(userId, spent.data.id, at);
    if (!committed.ok) return err("unavailable");
    return ok({ ...spent.data, failedAttempts: 0, confirmedAt: spent.data.confirmedAt ?? at, updatedAt: at });
  }

  async function listEnrolments(userId: string): Promise<AuthStoreResult<readonly AuthFactor[]>> {
    const found = await options.factors.find(userId, "recovery-code");
    return found.ok ? ok(found.data ? [found.data] : []) : err(found.error);
  }

  return {
    kind: "recovery-code",
    enrolment: "explicit",
    capabilities: { stepUp: true },
    challengeTtlMs: lockoutMs,
    codeDigits: null,
    codePeriodSeconds: null,
    reissueAfterMs: null,
    createChallenge,
    verifyChallenge,
    beginEnrolment,
    completeEnrolment,
    listEnrolments,
    remaining: (userId) => options.codes.remaining(userId),
  };
}
