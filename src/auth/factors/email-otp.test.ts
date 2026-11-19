import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { bytesToHex, sha256 } from "../../crypto/primitives/mod";
import { createLogger } from "../../logging/logger";
import { serializeError } from "../../logging/serialize-error";
import type { LogRecord } from "../../logging/types";
import { err, ok } from "../../result/result";
import { uuidv7 } from "../../storage/db/uuid";
import { AuthStoreError } from "../errors";
import { redactSigninReason } from "../flows/signin";
import { importAuthKeyRing } from "../keys/ring";
import type { AuthMessage, AuthNotifier, NonceStore, OtpState, OtpStateStore } from "../types";
import { createEmailOtpFactor } from "./email-otp";
import { fakeFactorCaller, installTimingProbe } from "./factors.fixture";
import type { TimingProbeHandle } from "./types";

const SECRET = "17bd3b2b6521b7cfde60fad521de43d2860704680c51641152e6e05aa786d162";
const USER_ID = uuidv7();
const NOW = 1_760_000_000_000;
import { AUTH_OTP_GUESS_WINDOW_MS, AUTH_OTP_MAX_ATTEMPTS, AUTH_OTP_TTL_MS } from "../config";

const TTL_MS = AUTH_OTP_TTL_MS;
const COOLDOWN_MS = 60_000;
const BINDING_A = await sha256("browser-a");

function recordingNotifier(): AuthNotifier & { sent: AuthMessage[] } {
  const sent: AuthMessage[] = [];
  return { sent, send: (message) => Promise.resolve(sent.push(message)).then(() => ({ ok: true as const, data: undefined })) };
}

function memoryNonces(): NonceStore {
  const seen = new Set<string>();
  return {
    markConsumed(key) {
      const fresh = !seen.has(key);
      seen.add(key);
      return Promise.resolve(ok(fresh));
    },
  };
}

/** Decides as the SQL adapter does: a reissue keeps the guess count and moves the binding, and the window opens at the first guess after the last one lapsed. */
function memoryOtpState(): OtpStateStore {
  const rows = new Map<string, OtpState & { readonly windowStartedAt: number | null; readonly binding: string }>();
  const stateOf = (row: OtpState): OtpState => ({ token: row.token, attempts: row.attempts, issuedAt: row.issuedAt, expiresAt: row.expiresAt });
  const bound = (userId: string, at: number, binding: Uint8Array) => {
    const row = rows.get(userId);
    return row && row.expiresAt > at && row.binding === bytesToHex(binding) ? row : undefined;
  };
  return {
    issue(userId, state, cooldownMs, binding) {
      const row = rows.get(userId);
      if (row && row.issuedAt > state.issuedAt - cooldownMs) return Promise.resolve(ok(false));
      rows.set(userId, { ...state, attempts: row?.attempts ?? 0, windowStartedAt: row?.windowStartedAt ?? null, binding: bytesToHex(binding) });
      return Promise.resolve(ok(true));
    },
    countAttempt(userId, maxAttempts, at, windowMs, binding) {
      const row = bound(userId, at, binding);
      if (!row) return Promise.resolve(ok(null));
      const open = row.windowStartedAt !== null && row.windowStartedAt > at - windowMs;
      if (open && row.attempts >= maxAttempts) return Promise.resolve(ok(null));
      const spent = open ? { ...row, attempts: row.attempts + 1 } : { ...row, attempts: 1, windowStartedAt: at };
      rows.set(userId, spent);
      return Promise.resolve(ok(stateOf(spent)));
    },
    read(userId, at, binding) {
      const row = bound(userId, at, binding);
      return Promise.resolve(ok(row ? stateOf(row) : null));
    },
    discard(userId, token) {
      const row = rows.get(userId);
      if (row?.token === token) rows.set(userId, { ...row, issuedAt: 0, expiresAt: 0 });
      return Promise.resolve(ok());
    },
    clear(userId) {
      rows.delete(userId);
      return Promise.resolve(ok());
    },
  };
}

function capturingLogger() {
  const records: { level: string; message: string; data: Record<string, unknown> | undefined }[] = [];
  const logger = createLogger("auth/factors", {
    channels: [{ write: (record: LogRecord) => void records.push({ level: record.level, message: record.message, data: record.data }) }],
  });
  return { logger, records };
}

async function harness(overrides: Partial<Parameters<typeof createEmailOtpFactor>[0]> = {}) {
  const keys = await importAuthKeyRing([SECRET]);
  const state = memoryOtpState();
  const nonces = memoryNonces();
  const notifier = recordingNotifier();
  const { logger, records } = capturingLogger();
  const factor = createEmailOtpFactor({ keys, state, nonces, notifier, address: () => ok("aurora@example.test"), logger, ...overrides });
  return { factor, keys, state, nonces, notifier, records };
}

function lastCode(notifier: { sent: AuthMessage[] }): string {
  const message = notifier.sent.at(-1);
  if (message?.kind !== "otp") throw new Error("no code was sent");
  return message.code;
}

describe("createEmailOtpFactor — the contract", () => {
  it("declares itself implicit and step-up capable", async () => {
    const { factor } = await harness();
    expect(factor.kind).toBe("email-otp");
    expect(factor.enrolment).toBe("implicit");
    expect(factor.capabilities).toEqual({ stepUp: true });
  });

  it("lists no enrolments, because a verified address is the enrolment", async () => {
    const { factor } = await harness();
    expect(await factor.listEnrolments(USER_ID)).toEqual({ ok: true, data: [] });
  });
});

describe("createEmailOtpFactor — issuing", () => {
  it("sends a code of the configured length to the resolved address, with the expiry", async () => {
    const { factor, notifier } = await harness();
    const issued = await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    expect(issued).toEqual({ ok: true, data: { kind: "email-otp", expiresAt: NOW + TTL_MS } });
    expect(notifier.sent).toEqual([{ to: "aurora@example.test", kind: "otp", code: lastCode(notifier), expiresAt: NOW + TTL_MS }]);
    expect(lastCode(notifier)).toMatch(/^\d{6}$/);
  });

  it("honours a configured digit count", async () => {
    const { factor, notifier } = await harness({ digits: 8 });
    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    expect(lastCode(notifier)).toMatch(/^\d{8}$/);
  });

  it("does not store the code in the clear — only the sealed token", async () => {
    const { factor, state, notifier } = await harness();
    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    const stored = await state.read(USER_ID, NOW, BINDING_A);
    expect(stored.ok && stored.data?.token).toBeTruthy();
    expect(JSON.stringify(stored)).not.toContain(lastCode(notifier));
  });

  it("spaces issues by the cooldown and lets the next one through the moment it lapses", async () => {
    const { factor } = await harness({ cooldownMs: COOLDOWN_MS });
    expect((await factor.createChallenge(USER_ID, NOW, fakeFactorCaller())).ok).toBe(true);
    expect(await factor.createChallenge(USER_ID, NOW + COOLDOWN_MS - 1, fakeFactorCaller())).toEqual({ ok: false, error: "too-soon" });
    expect((await factor.createChallenge(USER_ID, NOW + COOLDOWN_MS, fakeFactorCaller())).ok).toBe(true);
  });

  it("never leaves an identity without a code for longer than the cooldown, however many were requested", async () => {
    const { factor, notifier } = await harness({ cooldownMs: COOLDOWN_MS });
    for (const attacker of [NOW, NOW + COOLDOWN_MS, NOW + 2 * COOLDOWN_MS]) await factor.createChallenge(USER_ID, attacker, fakeFactorCaller());
    expect(notifier.sent).toHaveLength(3);

    const victim = await factor.createChallenge(USER_ID, NOW + 3 * COOLDOWN_MS, fakeFactorCaller());
    expect(victim).toEqual({ ok: true, data: { kind: "email-otp", expiresAt: NOW + 3 * COOLDOWN_MS + TTL_MS } });
  });

  it("sends one mail between parallel requests for one identity, not one each", async () => {
    const { factor, notifier } = await harness({ cooldownMs: COOLDOWN_MS });
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => factor.createChallenge(USER_ID, NOW, fakeFactorCaller())));
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(notifier.sent).toHaveLength(1);
  });

  it("spaces per identity, so one user's issue does not delay another's", async () => {
    const { factor } = await harness({ cooldownMs: COOLDOWN_MS });
    const other = uuidv7();
    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    expect(await factor.createChallenge(USER_ID, NOW, fakeFactorCaller())).toEqual({ ok: false, error: "too-soon" });
    expect((await factor.createChallenge(other, NOW, fakeFactorCaller())).ok).toBe(true);
  });

  it("gives the cooldown back when delivery fails, so a second issue is not refused as too-soon", async () => {
    const failing: AuthNotifier = { send: () => Promise.resolve({ ok: false, error: new AuthStoreError("unavailable", "notify.send") }) };
    const { factor, state } = await harness({ notifier: failing, cooldownMs: COOLDOWN_MS });
    expect(await factor.createChallenge(USER_ID, NOW, fakeFactorCaller())).toEqual({ ok: false, error: "unavailable" });
    expect(await state.read(USER_ID, NOW, BINDING_A)).toEqual({ ok: true, data: null });
    expect(await factor.createChallenge(USER_ID, NOW, fakeFactorCaller())).toEqual({ ok: false, error: "unavailable" });
  });

  it("hands the notifier a live abort signal with the code", async () => {
    const signals: AbortSignal[] = [];
    const notifier: AuthNotifier = {
      send: (_message, signal) => {
        signals.push(signal);
        return Promise.resolve(ok());
      },
    };
    const { factor } = await harness({ notifier });
    expect((await factor.createChallenge(USER_ID, NOW, fakeFactorCaller())).ok).toBe(true);
    expect(signals.map((signal) => [signal instanceof AbortSignal, signal.aborted])).toEqual([[true, false]]);
  });

  it("answers unavailable and gives the cooldown back when the notifier rejects", async () => {
    let sends = 0;
    const flaky: AuthNotifier = {
      send: () => {
        sends += 1;
        return sends === 1 ? Promise.reject(new Error("SMTP relay timed out")) : Promise.resolve(ok());
      },
    };
    const { factor, state } = await harness({ notifier: flaky, cooldownMs: COOLDOWN_MS });
    expect(await factor.createChallenge(USER_ID, NOW, fakeFactorCaller())).toEqual({ ok: false, error: "unavailable" });
    expect(await state.read(USER_ID, NOW, BINDING_A)).toEqual({ ok: true, data: null });
    expect(await factor.createChallenge(USER_ID, NOW, fakeFactorCaller())).toEqual({
      ok: true,
      data: { kind: "email-otp", expiresAt: NOW + TTL_MS },
    });
  });

  it("rolls the failed issue back by its own token, never with an unconditional clear", async () => {
    const inner = memoryOtpState();
    const calls: string[] = [];
    const state: OtpStateStore = {
      ...inner,
      discard: (userId, token) => {
        calls.push(`discard:${token}`);
        return inner.discard(userId, token);
      },
      clear: (userId) => {
        calls.push("clear");
        return inner.clear(userId);
      },
    };
    const failing: AuthNotifier = { send: () => Promise.resolve({ ok: false, error: new AuthStoreError("unavailable", "notify.send") }) };
    const { factor } = await harness({ notifier: failing, state });

    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    const issued = await inner.read(USER_ID, NOW, BINDING_A);
    expect(issued.ok && issued.data).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toStartWith("discard:");
  });
});

describe("createEmailOtpFactor — verifying", () => {
  it("accepts the right code once, then has nothing left to verify it against", async () => {
    const { factor, notifier } = await harness();
    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    const code = lastCode(notifier);
    expect(await factor.verifyChallenge(USER_ID, code, NOW, fakeFactorCaller())).toEqual({
      ok: true,
      data: { kind: "email-otp", userId: USER_ID, verifiedAt: NOW },
    });
    expect(await factor.verifyChallenge(USER_ID, code, NOW, fakeFactorCaller())).toEqual({ ok: false, error: "expired" });
  });

  it("refuses a code the nonce store has already seen, even with its state row intact", async () => {
    const spent: NonceStore = { markConsumed: () => Promise.resolve(ok(false)) };
    const { factor, notifier, state } = await harness({ nonces: spent });
    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    expect(await factor.verifyChallenge(USER_ID, lastCode(notifier), NOW, fakeFactorCaller())).toEqual({ ok: false, error: "consumed" });
    expect(await state.read(USER_ID, NOW, BINDING_A)).toMatchObject({ ok: true, data: { attempts: 1 } });
  });

  it("refuses a code issued for one identity when presented for another", async () => {
    const { factor, notifier, state } = await harness();
    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    const stolen = await state.read(USER_ID, NOW, BINDING_A);
    const other = uuidv7();
    if (!stolen.ok || !stolen.data) throw new Error("no state");
    await state.issue(other, stolen.data, 0, BINDING_A);
    expect(await factor.verifyChallenge(other, lastCode(notifier), NOW, fakeFactorCaller())).toEqual({ ok: false, error: "unrecognised" });
  });

  it("refuses once the code's own lifetime has passed, and not the instant before", async () => {
    const { factor, notifier } = await harness();
    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    expect(await factor.verifyChallenge(USER_ID, lastCode(notifier), NOW + TTL_MS, fakeFactorCaller())).toEqual({ ok: false, error: "expired" });

    const { factor: second, notifier: sent } = await harness();
    await second.createChallenge(USER_ID, NOW, fakeFactorCaller());
    expect(await second.verifyChallenge(USER_ID, lastCode(sent), NOW + TTL_MS - 1, fakeFactorCaller())).toMatchObject({ ok: true });
  });

  it("refuses when nothing was ever issued", async () => {
    const { factor } = await harness();
    expect(await factor.verifyChallenge(USER_ID, "000000", NOW, fakeFactorCaller())).toEqual({ ok: false, error: "expired" });
  });

  it("refuses at exactly the attempt after the limit, and not before", async () => {
    const { factor, notifier } = await harness({ maxAttempts: 3 });
    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    const wrong = lastCode(notifier) === "000000" ? "111111" : "000000";
    const outcomes: string[] = [];
    for (let ordinal = 1; ordinal <= 4; ordinal++) {
      const attempt = await factor.verifyChallenge(USER_ID, wrong, NOW, fakeFactorCaller());
      outcomes.push(`${ordinal}: ${attempt.ok ? "accepted" : attempt.error}`);
    }
    expect(outcomes).toEqual(["1: unrecognised", "2: unrecognised", "3: unrecognised", "4: too-many-attempts"]);
  });

  it("spends exactly the attempt budget under parallel guesses, however many arrive at once", async () => {
    const { factor, notifier } = await harness({ maxAttempts: 3 });
    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    const wrong = lastCode(notifier) === "000000" ? "111111" : "000000";

    const outcomes = await Promise.all(Array.from({ length: 12 }, () => factor.verifyChallenge(USER_ID, wrong, NOW, fakeFactorCaller())));
    const reasons = outcomes.map((outcome) => (outcome.ok ? "accepted" : outcome.error));
    expect(reasons.filter((reason) => reason === "unrecognised")).toHaveLength(3);
    expect(reasons.filter((reason) => reason === "too-many-attempts")).toHaveLength(9);
  });

  it("refuses the right code once the attempt budget is spent", async () => {
    const { factor, notifier } = await harness({ maxAttempts: 2 });
    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    const code = lastCode(notifier);
    const wrong = code === "000000" ? "111111" : "000000";
    await factor.verifyChallenge(USER_ID, wrong, NOW, fakeFactorCaller());
    await factor.verifyChallenge(USER_ID, wrong, NOW, fakeFactorCaller());
    expect(await factor.verifyChallenge(USER_ID, code, NOW, fakeFactorCaller())).toEqual({ ok: false, error: "too-many-attempts" });
  });

  it("keeps a spent budget across a reissue, refusing the right new code without spending it", async () => {
    const consumed: string[] = [];
    const nonces: NonceStore = { markConsumed: (key) => (consumed.push(key), Promise.resolve(ok(true))) };
    const { factor, notifier } = await harness({ maxAttempts: 3, nonces });
    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    const wrong = lastCode(notifier) === "000000" ? "111111" : "000000";
    for (let ordinal = 1; ordinal <= 3; ordinal++) await factor.verifyChallenge(USER_ID, wrong, NOW, fakeFactorCaller());

    expect((await factor.createChallenge(USER_ID, NOW + COOLDOWN_MS, fakeFactorCaller())).ok).toBe(true);
    expect(await factor.verifyChallenge(USER_ID, lastCode(notifier), NOW + COOLDOWN_MS, fakeFactorCaller())).toEqual({
      ok: false,
      error: "too-many-attempts",
    });
    expect(consumed).toEqual([]);
  });

  it("reopens a spent budget only once the guess window has run from the first guess, not the instant before", async () => {
    const { factor, notifier } = await harness({ maxAttempts: 3, guessWindowMs: AUTH_OTP_GUESS_WINDOW_MS });
    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    const wrong = lastCode(notifier) === "000000" ? "111111" : "000000";
    for (let ordinal = 1; ordinal <= 3; ordinal++) await factor.verifyChallenge(USER_ID, wrong, NOW, fakeFactorCaller());

    const reissuedAt = NOW + AUTH_OTP_GUESS_WINDOW_MS - COOLDOWN_MS;
    expect((await factor.createChallenge(USER_ID, reissuedAt, fakeFactorCaller())).ok).toBe(true);
    const code = lastCode(notifier);
    const before = await factor.verifyChallenge(USER_ID, code, NOW + AUTH_OTP_GUESS_WINDOW_MS - 1, fakeFactorCaller());
    const lapsed = await factor.verifyChallenge(USER_ID, code, NOW + AUTH_OTP_GUESS_WINDOW_MS, fakeFactorCaller());
    expect({ before, lapsed }).toEqual({
      before: { ok: false, error: "too-many-attempts" },
      lapsed: { ok: true, data: { kind: "email-otp", userId: USER_ID, verifiedAt: NOW + AUTH_OTP_GUESS_WINDOW_MS } },
    });
  });

  it("runs the guess window fifteen minutes from the first guess when none is configured", async () => {
    const { factor, notifier } = await harness({ maxAttempts: 3 });
    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    const wrong = lastCode(notifier) === "000000" ? "111111" : "000000";
    for (let ordinal = 1; ordinal <= 3; ordinal++) await factor.verifyChallenge(USER_ID, wrong, NOW, fakeFactorCaller());

    await factor.createChallenge(USER_ID, NOW + 900_000 - COOLDOWN_MS, fakeFactorCaller());
    const code = lastCode(notifier);
    const before = await factor.verifyChallenge(USER_ID, code, NOW + 900_000 - 1, fakeFactorCaller());
    const lapsed = await factor.verifyChallenge(USER_ID, code, NOW + 900_000, fakeFactorCaller());
    expect({ before, lapsed }).toEqual({
      before: { ok: false, error: "too-many-attempts" },
      lapsed: { ok: true, data: { kind: "email-otp", userId: USER_ID, verifiedAt: NOW + 900_000 } },
    });
  });

  it("counts guesses spent on an earlier code against the next one, so a reissue mid-budget buys no guesses", async () => {
    const { factor, notifier } = await harness({ maxAttempts: 3 });
    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    const first = lastCode(notifier);
    await factor.verifyChallenge(USER_ID, first === "000000" ? "111111" : "000000", NOW, fakeFactorCaller());

    await factor.createChallenge(USER_ID, NOW + COOLDOWN_MS, fakeFactorCaller());
    const second = lastCode(notifier);
    const wrong = second === "000000" ? "111111" : "000000";
    const outcomes = [];
    for (const presented of [wrong, wrong, second]) {
      const outcome = await factor.verifyChallenge(USER_ID, presented, NOW + COOLDOWN_MS, fakeFactorCaller());
      outcomes.push(outcome.ok ? "accepted" : outcome.error);
    }
    expect(outcomes).toEqual(["unrecognised", "unrecognised", "too-many-attempts"]);
  });

  it("keeps a spent budget through an undelivered reissue and the redelivery after it", async () => {
    const recorded = recordingNotifier();
    let sends = 0;
    const flaky: AuthNotifier = {
      send: (message, signal) => {
        sends += 1;
        return sends === 2
          ? Promise.resolve({ ok: false, error: new AuthStoreError("unavailable", "notify.send") })
          : recorded.send(message, signal);
      },
    };
    const { factor } = await harness({ maxAttempts: 3, notifier: flaky });
    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    const wrong = lastCode(recorded) === "000000" ? "111111" : "000000";
    for (let ordinal = 1; ordinal <= 3; ordinal++) await factor.verifyChallenge(USER_ID, wrong, NOW, fakeFactorCaller());

    const undelivered = await factor.createChallenge(USER_ID, NOW + COOLDOWN_MS, fakeFactorCaller());
    const redelivered = await factor.createChallenge(USER_ID, NOW + COOLDOWN_MS, fakeFactorCaller());
    const guessed = await factor.verifyChallenge(USER_ID, lastCode(recorded), NOW + COOLDOWN_MS, fakeFactorCaller());
    expect({ undelivered, redelivered: redelivered.ok, guessed, mailed: recorded.sent.length }).toEqual({
      undelivered: { ok: false, error: "unavailable" },
      redelivered: true,
      guessed: { ok: false, error: "too-many-attempts" },
      mailed: 2,
    });
  });

  it("admits one of two guesses racing for the last attempt of the budget and refuses the other without consuming the code", async () => {
    const consumed: string[] = [];
    const nonces: NonceStore = { markConsumed: (key) => (consumed.push(key), Promise.resolve(ok(true))) };
    const { factor, notifier } = await harness({ maxAttempts: 3, nonces });
    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    const code = lastCode(notifier);
    const wrong = code === "000000" ? "111111" : "000000";
    await factor.verifyChallenge(USER_ID, wrong, NOW, fakeFactorCaller());
    await factor.verifyChallenge(USER_ID, wrong, NOW, fakeFactorCaller());

    const raced = await Promise.all([
      factor.verifyChallenge(USER_ID, code, NOW, fakeFactorCaller()),
      factor.verifyChallenge(USER_ID, code, NOW, fakeFactorCaller()),
    ]);
    expect({ outcomes: raced.map((outcome) => (outcome.ok ? "accepted" : outcome.error)).sort(), consumed: consumed.length }).toEqual({
      outcomes: ["accepted", "too-many-attempts"],
      consumed: 1,
    });
  });

  it("clears the code on a success, so the next one starts on a full guess budget", async () => {
    const { factor, notifier, state } = await harness({ maxAttempts: 3 });
    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    const wrong = lastCode(notifier) === "000000" ? "111111" : "000000";
    await factor.verifyChallenge(USER_ID, wrong, NOW, fakeFactorCaller());
    expect(await factor.verifyChallenge(USER_ID, lastCode(notifier), NOW, fakeFactorCaller())).toMatchObject({ ok: true });
    expect(await state.read(USER_ID, NOW, BINDING_A)).toEqual({ ok: true, data: null });
    expect((await factor.createChallenge(USER_ID, NOW, fakeFactorCaller())).ok).toBe(true);
    const second = lastCode(notifier);
    const otherWrong = second === "000000" ? "111111" : "000000";
    for (let ordinal = 1; ordinal <= 3; ordinal++) {
      expect(`${ordinal}: ${(await factor.verifyChallenge(USER_ID, otherWrong, NOW, fakeFactorCaller())).ok}`).toBe(`${ordinal}: false`);
    }
  });

  it("separates an expired code from a wrong one at the store layer", async () => {
    const { factor, notifier } = await harness();
    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    const code = lastCode(notifier);
    const wrong = code === "000000" ? "111111" : "000000";
    const expired = await factor.verifyChallenge(USER_ID, code, NOW + TTL_MS, fakeFactorCaller());
    const { factor: second } = await harness();
    await second.createChallenge(USER_ID, NOW, fakeFactorCaller());
    const incorrect = await second.verifyChallenge(USER_ID, wrong, NOW, fakeFactorCaller());
    expect(expired.ok === false && expired.error).toBe("expired");
    expect(incorrect.ok === false && incorrect.error).toBe("unrecognised");
    expect(expired).not.toEqual(incorrect);
  });
});

describe("createEmailOtpFactor — the requesting browser", () => {
  const ISSUER = fakeFactorCaller("browser-a");
  const STRANGER = fakeFactorCaller("browser-b");

  it("refuses another browser's guesses without spending any of the issuing browser's budget", async () => {
    const { factor, notifier } = await harness();
    await factor.createChallenge(USER_ID, NOW, ISSUER);
    const code = lastCode(notifier);
    const wrong = code === "000000" ? "111111" : "000000";

    const foreign: string[] = [];
    for (let ordinal = 0; ordinal <= AUTH_OTP_MAX_ATTEMPTS; ordinal++) {
      const outcome = await factor.verifyChallenge(USER_ID, code, NOW, STRANGER);
      foreign.push(outcome.ok ? "accepted" : redactSigninReason(outcome.error));
    }
    const own: string[] = [];
    for (let ordinal = 1; ordinal < AUTH_OTP_MAX_ATTEMPTS; ordinal++) {
      const outcome = await factor.verifyChallenge(USER_ID, wrong, NOW, ISSUER);
      own.push(outcome.ok ? "accepted" : outcome.error);
    }
    const right = await factor.verifyChallenge(USER_ID, code, NOW, ISSUER);

    expect({ foreign, own, right }).toEqual({
      foreign: Array.from({ length: AUTH_OTP_MAX_ATTEMPTS + 1 }, () => "unrecognised"),
      own: Array.from({ length: AUTH_OTP_MAX_ATTEMPTS - 1 }, () => "unrecognised"),
      right: { ok: true, data: { kind: "email-otp", userId: USER_ID, verifiedAt: NOW } },
    });
  });

  it("issues nothing and verifies nothing for a caller with no binding", async () => {
    const inner = memoryOtpState();
    const touched: string[] = [];
    const state: OtpStateStore = {
      ...inner,
      issue: (...args) => (touched.push("issue"), inner.issue(...args)),
      countAttempt: (...args) => (touched.push("countAttempt"), inner.countAttempt(...args)),
      read: (...args) => (touched.push("read"), inner.read(...args)),
    };
    const { factor, notifier } = await harness({ state });
    const issued = await factor.createChallenge(USER_ID, NOW, fakeFactorCaller(null));
    const verified = await factor.verifyChallenge(USER_ID, "000000", NOW, fakeFactorCaller(null));
    expect({ issued, verified, touched, sent: notifier.sent }).toEqual({
      issued: { ok: false, error: "unavailable" },
      verified: { ok: false, error: "unavailable" },
      touched: [],
      sent: [],
    });
  });

  it("moves the code to the browser that asked for it again, so the first browser's code is gone", async () => {
    const { factor, notifier } = await harness({ cooldownMs: COOLDOWN_MS });
    await factor.createChallenge(USER_ID, NOW, ISSUER);
    const first = lastCode(notifier);
    await factor.createChallenge(USER_ID, NOW + COOLDOWN_MS, STRANGER);
    const second = lastCode(notifier);

    const stale = await factor.verifyChallenge(USER_ID, first, NOW + COOLDOWN_MS, ISSUER);
    const moved = await factor.verifyChallenge(USER_ID, second, NOW + COOLDOWN_MS, STRANGER);
    expect({ stale, moved: moved.ok }).toEqual({ stale: { ok: false, error: "expired" }, moved: true });
  });

  it("keeps a spent budget across a reissue to another browser, which gets no budget of its own", async () => {
    const { factor, notifier } = await harness({ cooldownMs: COOLDOWN_MS });
    await factor.createChallenge(USER_ID, NOW, ISSUER);
    const wrong = lastCode(notifier) === "000000" ? "111111" : "000000";
    for (let ordinal = 1; ordinal <= AUTH_OTP_MAX_ATTEMPTS; ordinal++) await factor.verifyChallenge(USER_ID, wrong, NOW, ISSUER);

    expect((await factor.createChallenge(USER_ID, NOW + COOLDOWN_MS, STRANGER)).ok).toBe(true);
    expect(await factor.verifyChallenge(USER_ID, lastCode(notifier), NOW + COOLDOWN_MS, STRANGER)).toEqual({
      ok: false,
      error: "too-many-attempts",
    });
  });
});

describe("createEmailOtpFactor — store failures", () => {
  function brokenState(failing: keyof OtpStateStore): OtpStateStore {
    const inner = memoryOtpState();
    const refuse = (): Promise<never> =>
      Promise.resolve({ ok: false, error: new AuthStoreError("unavailable", `otpState.${failing}`) }) as Promise<never>;
    return { ...inner, [failing]: refuse } as OtpStateStore;
  }

  const failingAddresses = [
    { label: "synchronously", address: () => err(new AuthStoreError("unavailable", "users.findById")) },
    { label: "asynchronously", address: () => Promise.resolve(err(new AuthStoreError("unavailable", "users.findById"))) },
  ];

  for (const { label, address } of failingAddresses) {
    it(`answers an address lookup that fails ${label} as unavailable, sending nothing and storing no code`, async () => {
      const state = memoryOtpState();
      const { factor, notifier } = await harness({ state, address, cooldownMs: COOLDOWN_MS });
      expect(await factor.createChallenge(USER_ID, NOW, fakeFactorCaller())).toEqual({ ok: false, error: "unavailable" });
      expect(notifier.sent).toEqual([]);
      expect(await state.read(USER_ID, NOW, BINDING_A)).toEqual({ ok: true, data: null });
    });

    it(`claims no cooldown on an address lookup that fails ${label}, so an issue at the same instant goes through`, async () => {
      const state = memoryOtpState();
      const { factor: failing } = await harness({ state, address, cooldownMs: COOLDOWN_MS });
      await failing.createChallenge(USER_ID, NOW, fakeFactorCaller());
      const { factor: working, notifier } = await harness({ state, cooldownMs: COOLDOWN_MS });
      expect(await working.createChallenge(USER_ID, NOW, fakeFactorCaller())).toEqual({
        ok: true,
        data: { kind: "email-otp", expiresAt: NOW + TTL_MS },
      });
      expect(notifier.sent.map((message) => message.to)).toEqual(["aurora@example.test"]);
    });
  }

  it("reads the address before it claims the cooldown, so a failed lookup never reaches the state store", async () => {
    const inner = memoryOtpState();
    const issued: string[] = [];
    const state: OtpStateStore = {
      ...inner,
      issue: (userId, row, cooldownMs, binding) => {
        issued.push(userId);
        return inner.issue(userId, row, cooldownMs, binding);
      },
    };
    const { factor } = await harness({ state, address: () => err(new AuthStoreError("unavailable", "users.findById")) });
    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    expect(issued).toEqual([]);
  });

  it("rejects when the address resolver throws, without sending or claiming the cooldown", async () => {
    const state = memoryOtpState();
    const { factor, notifier } = await harness({ state, address: () => Promise.reject(new Error("users table offline")), cooldownMs: COOLDOWN_MS });
    await expect(factor.createChallenge(USER_ID, NOW, fakeFactorCaller())).rejects.toThrow("users table offline");
    expect(notifier.sent).toEqual([]);
    expect(await state.read(USER_ID, NOW, BINDING_A)).toEqual({ ok: true, data: null });
  });

  it("resolves the address for the identity the code is issued to", async () => {
    const asked: string[] = [];
    const { factor } = await harness({
      address: (userId) => {
        asked.push(userId);
        return ok("aurora@example.test");
      },
    });
    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    expect(asked).toEqual([USER_ID]);
  });

  it("reports a failure to spend the guess as unavailable rather than as a wrong code", async () => {
    const { factor } = await harness({ state: brokenState("countAttempt") });
    expect(await factor.verifyChallenge(USER_ID, "000000", NOW, fakeFactorCaller())).toEqual({ ok: false, error: "unavailable" });
  });

  it("reports a failure to claim the cooldown as unavailable, and sends nothing", async () => {
    const { factor, notifier } = await harness({ state: brokenState("issue") });
    expect(await factor.createChallenge(USER_ID, NOW, fakeFactorCaller())).toEqual({ ok: false, error: "unavailable" });
    expect(notifier.sent).toEqual([]);
  });

  it("reports a failure to classify a refused guess as unavailable, not as expired", async () => {
    const inner = memoryOtpState();
    const state: OtpStateStore = {
      ...inner,
      read: () => Promise.resolve({ ok: false as const, error: new AuthStoreError("unavailable", "otpState.read") }),
    };
    const { factor } = await harness({ state });
    expect(await factor.verifyChallenge(USER_ID, "000000", NOW, fakeFactorCaller())).toEqual({ ok: false, error: "unavailable" });
  });

  it("reports a failure to clear on success as unavailable, rather than reporting a success it did not record", async () => {
    const { factor, notifier } = await harness({ state: brokenState("clear") });
    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    expect(await factor.verifyChallenge(USER_ID, lastCode(notifier), NOW, fakeFactorCaller())).toEqual({ ok: false, error: "unavailable" });
  });
});

describe("createEmailOtpFactor — failure logs", () => {
  const outage = new AuthStoreError("unavailable", "d1.query");

  function failingOtpState(failing: keyof OtpStateStore): OtpStateStore {
    return { ...memoryOtpState(), [failing]: () => Promise.resolve(err(outage)) } as OtpStateStore;
  }

  function logged(event: string, error: unknown) {
    return [{ level: "error", message: event, data: { error: serializeError(error) } }];
  }

  it("logs the store error when the address read fails", async () => {
    const { factor, records } = await harness({ address: () => err(outage) });
    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    expect(records).toEqual(logged("auth.email-otp.address.failed", outage));
  });

  it("logs the store error when claiming the cooldown fails", async () => {
    const { factor, records } = await harness({ state: failingOtpState("issue") });
    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    expect(records).toEqual(logged("auth.email-otp.issue.failed", outage));
  });

  it("logs the notifier's error when delivery is refused", async () => {
    const refused = new AuthStoreError("unavailable", "notify.send");
    const { factor, records } = await harness({ notifier: { send: () => Promise.resolve(err(refused)) } });
    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    expect(records).toEqual(logged("auth.email-otp.deliver.failed", refused));
  });

  it("logs the thrown error when the notifier rejects", async () => {
    const thrown = new Error("SMTP relay timed out");
    const { factor, records } = await harness({ notifier: { send: () => Promise.reject(thrown) } });
    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    expect(records).toEqual(logged("auth.email-otp.deliver.failed", thrown));
  });

  it("logs the delivery failure, then the store error, when rolling back an undelivered code fails", async () => {
    const refused = new AuthStoreError("unavailable", "notify.send");
    const { factor, records } = await harness({ notifier: { send: () => Promise.resolve(err(refused)) }, state: failingOtpState("discard") });
    expect(await factor.createChallenge(USER_ID, NOW, fakeFactorCaller())).toEqual({ ok: false, error: "unavailable" });
    expect(records).toEqual([...logged("auth.email-otp.deliver.failed", refused), ...logged("auth.email-otp.discard.failed", outage)]);
  });

  it("logs the store error when spending a guess fails", async () => {
    const { factor, records } = await harness({ state: failingOtpState("countAttempt") });
    await factor.verifyChallenge(USER_ID, "000000", NOW, fakeFactorCaller());
    expect(records).toEqual(logged("auth.email-otp.count.failed", outage));
  });

  it("logs the store error when reading the live code fails", async () => {
    const { factor, records } = await harness({ state: failingOtpState("read") });
    await factor.verifyChallenge(USER_ID, "000000", NOW, fakeFactorCaller());
    expect(records).toEqual(logged("auth.email-otp.read.failed", outage));
  });

  it("logs the store error when consuming the nonce fails", async () => {
    const { factor, notifier, records } = await harness({ nonces: { markConsumed: () => Promise.resolve(err(outage)) } });
    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    await factor.verifyChallenge(USER_ID, lastCode(notifier), NOW, fakeFactorCaller());
    expect(records).toEqual(logged("auth.email-otp.consume.failed", outage));
  });

  it("logs the store error when clearing a verified code fails", async () => {
    const { factor, notifier, records } = await harness({ state: failingOtpState("clear") });
    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    await factor.verifyChallenge(USER_ID, lastCode(notifier), NOW, fakeFactorCaller());
    expect(records).toEqual(logged("auth.email-otp.clear.failed", outage));
  });

  it("logs nothing on an issue and a verification that succeed", async () => {
    const { factor, notifier, records } = await harness();
    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    await factor.verifyChallenge(USER_ID, lastCode(notifier), NOW, fakeFactorCaller());
    expect(records).toEqual([]);
  });
});

describe("createEmailOtpFactor — the ranges it holds at construction", () => {
  async function factory(overrides: Partial<Parameters<typeof createEmailOtpFactor>[0]>) {
    const keys = await importAuthKeyRing([SECRET]);
    return () =>
      createEmailOtpFactor({
        keys,
        state: memoryOtpState(),
        nonces: memoryNonces(),
        notifier: recordingNotifier(),
        address: () => ok("aurora@example.test"),
        ...overrides,
      });
  }

  it("refuses ten digits at construction, which `randomCode` would otherwise loop on for ever", async () => {
    expect(await factory({ digits: 9 })).toThrow(
      "createEmailOtpFactor: digits is 9, above the 8-digit ceiling — the widest code the one-time-code field renders, which is also where the authenticator app's own range ends.",
    );
  });

  it("refuses a code narrower than six digits", async () => {
    expect(await factory({ digits: 5 })).toThrow(
      "createEmailOtpFactor: digits is 5, below the 6-digit floor — the shortest code that is not trivially guessable.",
    );
  });

  it("accepts both code widths themselves", async () => {
    expect(await factory({ digits: 6 })).not.toThrow();
    expect(await factory({ digits: 8 })).not.toThrow();
  });

  it("refuses a code lifetime below the nonce store's own floor", async () => {
    expect(await factory({ ttlMs: 1_000 })).toThrow(
      "createEmailOtpFactor: ttlMs is 1000, below the 60000-millisecond floor — the shortest expiration the nonce store accepts, below which a code outlives its own replay guard.",
    );
  });

  it("refuses a code lifetime longer than an out-of-band secret may have", async () => {
    expect(await factory({ ttlMs: 900_000 })).toThrow(
      "createEmailOtpFactor: ttlMs is 900000, above the 600000-millisecond ceiling — the ten minutes NIST SP 800-63B §5.1.3.2 allows an out-of-band secret.",
    );
  });

  it("accepts both lifetime bounds themselves", async () => {
    expect(await factory({ ttlMs: 60_000 })).not.toThrow();
    expect(await factory({ ttlMs: 600_000 })).not.toThrow();
  });

  it("refuses a budget of no guesses, which would refuse the right code too", async () => {
    expect(await factory({ maxAttempts: 0 })).toThrow(
      "createEmailOtpFactor: maxAttempts is 0, below the 1-attempt floor — a factor that admits no guess refuses the right code too.",
    );
  });

  it("refuses a budget wider than an attacker should be given", async () => {
    expect(await factory({ maxAttempts: 11 })).toThrow(
      "createEmailOtpFactor: maxAttempts is 11, above the 10-attempt ceiling — every further guess is one an attacker spends against a six-digit code.",
    );
  });

  it("accepts both budget bounds themselves", async () => {
    expect(await factory({ maxAttempts: 1 })).not.toThrow();
    expect(await factory({ maxAttempts: 10 })).not.toThrow();
  });

  it("refuses a cooldown that would leave mail volume per address unbounded", async () => {
    expect(await factory({ cooldownMs: 0 })).toThrow(
      "createEmailOtpFactor: cooldownMs is 0, below the 1000-millisecond floor — the cooldown is the only bound on how much mail one address can be sent.",
    );
  });

  it("refuses a cooldown that would lock a user out of their own sign-in", async () => {
    expect(await factory({ cooldownMs: 7_200_000 })).toThrow(
      "createEmailOtpFactor: cooldownMs is 7200000, above the 3600000-millisecond ceiling — a wait longer than an hour locks a user out of their own sign-in.",
    );
  });

  it("accepts both cooldown bounds themselves", async () => {
    expect(await factory({ cooldownMs: 1_000 })).not.toThrow();
    expect(await factory({ cooldownMs: 3_600_000 })).not.toThrow();
  });

  it("refuses a guess window a millisecond under a minute, which renews the budget faster than a code can be typed", async () => {
    expect(await factory({ guessWindowMs: 59_999 })).toThrow(
      "createEmailOtpFactor: guessWindowMs is 59999, below the 60000-millisecond floor — below a minute the window renews the budget faster than a person can type a code.",
    );
  });

  it("refuses a guess window a millisecond over a day, which hands an attacker a day-long lockout", async () => {
    expect(await factory({ guessWindowMs: 86_400_001 })).toThrow(
      "createEmailOtpFactor: guessWindowMs is 86400001, above the 86400000-millisecond ceiling — a spent budget is a lockout an attacker holds on the user's behalf for the whole window.",
    );
  });

  it("accepts both guess-window bounds themselves", async () => {
    expect(await factory({ guessWindowMs: 60_000 })).not.toThrow();
    expect(await factory({ guessWindowMs: 86_400_000 })).not.toThrow();
  });

  it("refuses a fraction", async () => {
    expect(await factory({ ttlMs: 60_000.5 })).toThrow("createEmailOtpFactor: ttlMs is 60000.5, which is not a whole number.");
  });

  it("accepts every knob omitted", async () => {
    expect(await factory({})).not.toThrow();
  });
});

describe("createEmailOtpFactor — the code comparison is constant-time", () => {
  let handle: TimingProbeHandle;

  beforeEach(() => {
    handle = installTimingProbe();
  });

  afterEach(() => {
    handle.restore();
  });

  it("asks the constant-time primitive, and is told no, for a wrong code", async () => {
    const { factor, notifier } = await harness();
    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    const wrong = lastCode(notifier) === "000000" ? "111111" : "000000";
    const outcome = await factor.verifyChallenge(USER_ID, wrong, NOW, fakeFactorCaller());
    expect({ compared: handle.probe.compared, outcome }).toEqual({ compared: [false], outcome: { ok: false, error: "unrecognised" } });
  });

  it("asks the constant-time primitive, and is told yes, for the right code", async () => {
    const { factor, notifier } = await harness();
    await factor.createChallenge(USER_ID, NOW, fakeFactorCaller());
    const outcome = await factor.verifyChallenge(USER_ID, lastCode(notifier), NOW, fakeFactorCaller());
    expect({ compared: handle.probe.compared, accepted: outcome.ok }).toEqual({ compared: [true], accepted: true });
  });
});
