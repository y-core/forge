import {
  base32Encode,
  base64urlDecodeOrNull,
  base64urlEncode,
  hotpCode,
  randomBytes,
  timingSafeEqual,
  totpCounter,
} from "../../crypto/primitives/mod";
import { err, ok } from "../../result/result";
import type { Result } from "../../result/types";
import { AUTH_TOTP_LOCKOUT_MS } from "../config";
import { authLimit } from "../limits";
import type { AuthChallenge, AuthFactor, AuthStoreResult } from "../types";
import { openTotpSecret, sealTotpSecret } from "./totp-secret";
import type { AuthFactorCaller, AuthFactorChallenge, AuthFactorReason, AuthFactorVerified } from "./types";
import type { TotpAppEnrolment, TotpAppFactorOptions, TotpReplaceableFactorService, TotpSecretOpened } from "./types";

const DEFAULT_SECRET_BYTES = 20;
const MIN_SECRET_BYTES = 16;
const MAX_SECRET_BYTES = 64;
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
const UNCONFIRMED_SECRET_REUSE_MS = 15 * 60_000;
const REPLACEMENT_KEY_PREFIX = "totp-replace:";

/** A replacement secret waiting on a code from it: sealed for its user, and the guesses already spent against it. */
interface PendingReplacement {
  readonly sealed: Uint8Array<ArrayBuffer>;
  readonly attempts: number;
  readonly expiresAt: number;
}

function replacementKey(keep: Uint8Array<ArrayBuffer>): string {
  return `${REPLACEMENT_KEY_PREFIX}${base64urlEncode(keep)}`;
}

// The challenge row carries one string, so the expiry and the spent guesses ride in front of the frame.
function pendingRecord(userId: string, keep: Uint8Array<ArrayBuffer>, pending: PendingReplacement): AuthChallenge {
  return { challenge: `${pending.expiresAt}.${pending.attempts}.${base64urlEncode(pending.sealed)}`, sessionId: base64urlEncode(keep), userId };
}

/** The pending replacement `record` holds for `userId`, or `null` for one held for anybody else or not in this shape. */
function readPending(record: AuthChallenge, userId: string): PendingReplacement | null {
  if (record.userId !== userId) return null;
  const [expiresAt, attempts, frame, ...rest] = record.challenge.split(".");
  const sealed = frame === undefined ? null : base64urlDecodeOrNull(frame);
  if (rest.length > 0 || sealed === null) return null;
  const pending = { sealed, attempts: Number(attempts), expiresAt: Number(expiresAt) };
  return Number.isSafeInteger(pending.attempts) && Number.isSafeInteger(pending.expiresAt) ? pending : null;
}

function provisioningUri(issuer: string, account: string, secret: string, digits: number, period: number): string {
  // Percent-encoded, not `URLSearchParams`: form encoding emits `+` for a space, and an
  // authenticator showing `Forge+Demo` is showing the encoding rather than the issuer.
  const query = [`secret=${secret}`, `issuer=${encodeURIComponent(issuer)}`, "algorithm=SHA1", `digits=${digits}`, `period=${period}`];
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?${query.join("&")}`;
}

/** Verifies a code from an authenticator app. Step-up only — possession proves nothing about who is present. @public */
export function createTotpAppFactor(options: TotpAppFactorOptions): TotpReplaceableFactorService {
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
    max: MAX_SECRET_BYTES,
    unit: "byte",
    floor: "the 128 bits RFC 4226 §4 R6 states for a shared secret",
    ceiling: "HMAC hashes a longer key down to its block size, so the extra bytes carry no entropy",
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

  /** The sealed secret on `factor`, opened beside the frame it came from, or the reason it cannot stand in for an enrolment. */
  async function openSecret(
    userId: string,
    factor: AuthFactor | null,
  ): Promise<Result<TotpSecretOpened & { readonly frame: Uint8Array<ArrayBuffer> }, AuthFactorReason>> {
    if (!factor || factor.secret === null) return err("not-enrolled");
    const opened = await openTotpSecret(options.keys, userId, factor.secret);
    return opened.ok ? ok({ ...opened.data, frame: factor.secret }) : err("unusable");
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

  // The advance is the replay guard: `recordVerification` writes only above the last accepted step,
  // so one code presented twice inside its own window changes no row and is refused the second time.
  async function acceptCode(
    userId: string,
    presented: string,
    at: number,
    admits: (factor: AuthFactor) => boolean,
  ): Promise<Result<{ factor: AuthFactor; counter: number }, AuthFactorReason>> {
    const found = await options.factors.find(userId, "totp-app");
    if (!found.ok) return err("unavailable");
    // Opened before the guess is spent: whether the secret opens depends on nothing the visitor sent,
    // so refusing here reveals nothing, and an unusable factor must not burn the budget of a usable one.
    const opened = await openSecret(userId, found.data);
    if (!opened.ok) return err(opened.error);

    // One statement finds the row and spends the guess against it, so the guess is spent before the
    // comparison: a guess that costs nothing until it is wrong can be made as fast as the network.
    const spent = await options.factors.countAttempt(userId, "totp-app", maxAttempts, at, lockoutMs);
    if (!spent.ok) return err("unavailable");
    // The one statement collapses "no such factor" into "budget spent", so a second read tells them
    // apart — and only once the write has already been refused, which costs an attacker the guess.
    if (!spent.data) {
      const still = await options.factors.find(userId, "totp-app");
      if (!still.ok) return err("unavailable");
      return err(still.data ? "too-many-attempts" : "not-enrolled");
    }
    const factor = spent.data;
    if (factor.id !== found.data?.id) return err("unavailable");
    // Judged before the code is compared and before any counter moves: a row this caller may not use
    // must not have its step spent, or a refused verification would consume the confirming code.
    if (!admits(factor)) return err("not-enrolled");

    const counter = await matchingCounter(opened.data.secret, presented, at);
    if (counter === null) return err("unrecognised");
    // Conditional, because re-sealing on every verification would spend a `totpWrap` nonce each
    // time against the 2^32 per-(kid, purpose) bound. It rides the write under the replay guard.
    const resealed = opened.data.stale ? await sealTotpSecret(options.keys, userId, opened.data.secret) : undefined;
    const recorded = await options.factors.recordVerification(factor.id, userId, counter, at, opened.data.frame, resealed);
    if (!recorded.ok) return err("unavailable");
    if (!recorded.data) return err("consumed");
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

    if (existing.data?.secret && at - existing.data.createdAt < UNCONFIRMED_SECRET_REUSE_MS) {
      const held = await openTotpSecret(options.keys, userId, existing.data.secret);
      if (held.ok) return enrolmentOf(userId, held.data.secret, at);
    }

    if (existing.data) {
      const removed = await options.factors.remove(existing.data.id, userId, at, { keep: null }, []);
      if (!removed.ok) return err("unavailable");
    }

    const secret = randomBytes(secretBytes);
    const sealed = await sealTotpSecret(options.keys, userId, secret);
    const enrolled = await options.factors.enrol({ userId, kind: "totp-app", secret: sealed, confirmedAt: null }, at);
    // The same race the `find` above cannot close: the loser hits the unique index, and that is this
    // account enrolling twice rather than the store being down.
    if (!enrolled.ok) return err(enrolled.error.code === "conflict" ? "already-enrolled" : "unavailable");
    return enrolmentOf(userId, secret, at);
  }

  async function completeEnrolment(
    userId: string,
    presented: string,
    at: number,
    caller: AuthFactorCaller,
  ): Promise<Result<AuthFactor, AuthFactorReason>> {
    const accepted = await acceptCode(userId, presented, at, () => true);
    if (!accepted.ok) return err(accepted.error);
    // Confirmed only after the code checks out: a row that could step up before then would let a
    // half-finished ceremony stand between a user and their own account.
    const confirmed = await options.factors.confirm(accepted.data.factor.id, userId, at, { keep: caller.keep });
    if (!confirmed.ok) return err("unavailable");
    if (!confirmed.data) return err("not-enrolled");
    return ok({ ...accepted.data.factor, lastCounter: accepted.data.counter, confirmedAt: at, updatedAt: at });
  }

  /** Holds `pending` for this session until it expires; the store's TTL is the ceiling, the stamp inside is what `at` is judged by. */
  async function holdPending(userId: string, keep: Uint8Array<ArrayBuffer>, pending: PendingReplacement, at: number): Promise<boolean> {
    const ttlSeconds = Math.max(1, Math.ceil((pending.expiresAt - at) / 1000));
    const held = await options.challenges.put(replacementKey(keep), pendingRecord(userId, keep, pending), ttlSeconds);
    return held.ok;
  }

  /** Takes this session's pending replacement out of the store, so no other request can spend a guess against it meanwhile. */
  async function takePending(
    userId: string,
    keep: Uint8Array<ArrayBuffer>,
    at: number,
  ): Promise<Result<PendingReplacement | null, AuthFactorReason>> {
    const taken = await options.challenges.take(replacementKey(keep));
    if (!taken.ok) return err("unavailable");
    const pending = taken.data === null ? null : readPending(taken.data, userId);
    return ok(pending !== null && at < pending.expiresAt ? pending : null);
  }

  // The live row is not touched until the swap commits, so an abandoned replacement leaves the
  // working app working, and the pending secret simply lapses.
  async function beginReplacement(userId: string, at: number, caller: AuthFactorCaller): Promise<Result<AuthFactorChallenge, AuthFactorReason>> {
    if (caller.keep === null) return err("unavailable");
    const found = await options.factors.find(userId, "totp-app");
    if (!found.ok) return err("unavailable");
    if (found.data?.confirmedAt == null) return err("not-enrolled");

    const resumed = await takePending(userId, caller.keep, at);
    if (!resumed.ok) return err(resumed.error);
    const held = resumed.data === null ? null : await openTotpSecret(options.keys, userId, resumed.data.sealed);
    if (resumed.data !== null && held?.ok) {
      if (!(await holdPending(userId, caller.keep, resumed.data, at))) return err("unavailable");
      return enrolmentOf(userId, held.data.secret, at);
    }

    const secret = randomBytes(secretBytes);
    const pending = { sealed: await sealTotpSecret(options.keys, userId, secret), attempts: 0, expiresAt: at + UNCONFIRMED_SECRET_REUSE_MS };
    if (!(await holdPending(userId, caller.keep, pending, at))) return err("unavailable");
    return enrolmentOf(userId, secret, at);
  }

  // The guesses are counted on the pending entry, taken out of the store for the comparison: two
  // confirms racing cannot both hold it, and a bad new code never spends the live row's budget.
  async function completeReplacement(
    userId: string,
    presented: string,
    at: number,
    caller: AuthFactorCaller,
  ): Promise<Result<AuthFactor, AuthFactorReason>> {
    if (caller.keep === null) return err("unavailable");
    const taken = await takePending(userId, caller.keep, at);
    if (!taken.ok) return err(taken.error);
    const pending = taken.data;
    if (pending === null) return err("expired");
    const opened = await openTotpSecret(options.keys, userId, pending.sealed);
    if (!opened.ok) return err("expired");

    const found = await options.factors.find(userId, "totp-app");
    if (!found.ok) {
      await holdPending(userId, caller.keep, pending, at);
      return err("unavailable");
    }
    const live = found.data;
    if (live?.confirmedAt == null) return err("not-enrolled");

    const counter = await matchingCounter(opened.data.secret, presented, at);
    if (counter === null) {
      const attempts = pending.attempts + 1;
      if (attempts >= maxAttempts) return err("too-many-attempts");
      return (await holdPending(userId, caller.keep, { ...pending, attempts }, at)) ? err("unrecognised") : err("unavailable");
    }

    const secret = opened.data.stale ? await sealTotpSecret(options.keys, userId, opened.data.secret) : pending.sealed;
    const replaced = await options.factors.replaceSecret(live.id, userId, secret, counter, at, { keep: caller.keep });
    if (!replaced.ok) {
      await holdPending(userId, caller.keep, pending, at);
      return err("unavailable");
    }
    // No row matched: a removal or an admin reset committed first, and there is nothing left to replace.
    if (!replaced.data) return err("not-enrolled");
    return ok({ ...live, secret, lastCounter: counter, failedAttempts: 0, lastVerifiedAt: at, updatedAt: at });
  }

  async function listEnrolments(userId: string): Promise<AuthStoreResult<readonly AuthFactor[]>> {
    const found = await options.factors.find(userId, "totp-app");
    return found.ok ? ok(found.data ? [found.data] : []) : err(found.error);
  }

  return {
    kind: "totp-app",
    enrolment: "explicit",
    capabilities: { stepUp: true },
    // The ceiling, not the exact life: a code issued mid-step expires when that step ends.
    challengeTtlMs: period * 1000,
    codeDigits: digits,
    codePeriodSeconds: period,
    reissueAfterMs: null,
    createChallenge,
    verifyChallenge,
    beginEnrolment,
    completeEnrolment,
    beginReplacement,
    completeReplacement,
    listEnrolments,
  };
}
