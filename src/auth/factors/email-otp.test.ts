import { describe, expect, it } from "bun:test";

import { uuidv7 } from "../../crypto/mod";
import { ok } from "../../result/result";
import { fakeKV } from "../../testing/fakes";
import { AuthStoreError } from "../errors";
import { importAuthKeyRing } from "../keys/ring";
import { createNonceStore } from "../stores/nonces";
import type { AuthMessage, AuthNotifier, OtpState, OtpStateStore } from "../types";
import { createEmailOtpFactor } from "./email-otp";

const SECRET = "c3".repeat(32);
const USER_ID = uuidv7();
const NOW = 1_760_000_000_000;
const TTL_MS = 600_000;
const COOLDOWN_MS = 60_000;

function recordingNotifier(): AuthNotifier & { sent: AuthMessage[] } {
  const sent: AuthMessage[] = [];
  return { sent, send: (message) => Promise.resolve(sent.push(message)).then(() => ({ ok: true as const, data: undefined })) };
}

// The contract as the adapter's statements answer it: every method decides in one uninterrupted
// step, with no `await` between reading a counter and writing it. A store that resolved a promise
// mid-decision would let two callers past the same count, which is the thing under test here.
function memoryOtpState(): OtpStateStore {
  const rows = new Map<string, OtpState>();
  return {
    issue(userId, state, cooldownMs) {
      const row = rows.get(userId);
      if (row && row.issuedAt > state.issuedAt - cooldownMs) return Promise.resolve(ok(false));
      rows.set(userId, state);
      return Promise.resolve(ok(true));
    },
    countAttempt(userId, maxAttempts, at) {
      const row = rows.get(userId);
      if (!row || row.expiresAt <= at || row.attempts >= maxAttempts) return Promise.resolve(ok(null));
      const spent = { ...row, attempts: row.attempts + 1 };
      rows.set(userId, spent);
      return Promise.resolve(ok(spent));
    },
    read(userId, at) {
      const row = rows.get(userId);
      return Promise.resolve(ok(row && row.expiresAt > at ? row : null));
    },
    clear(userId) {
      rows.delete(userId);
      return Promise.resolve(ok());
    },
  };
}

async function harness(overrides: Partial<Parameters<typeof createEmailOtpFactor>[0]> = {}) {
  const keys = await importAuthKeyRing([SECRET]);
  const state = memoryOtpState();
  const nonces = createNonceStore(fakeKV());
  const notifier = recordingNotifier();
  const factor = createEmailOtpFactor({ keys, state, nonces, notifier, address: () => "aurora@example.test", ...overrides });
  return { factor, keys, state, nonces, notifier };
}

/** The code the notifier was handed — the only place it exists in the clear. */
function lastCode(notifier: { sent: AuthMessage[] }): string {
  const message = notifier.sent.at(-1);
  if (!message?.code) throw new Error("no code was sent");
  return message.code;
}

describe("createEmailOtpFactor — the contract", () => {
  it("declares itself implicit, primary and step-up capable", async () => {
    const { factor } = await harness();
    expect(factor.kind).toBe("email-otp");
    expect(factor.enrolment).toBe("implicit");
    expect(factor.capabilities).toEqual({ primary: true, stepUp: true });
  });

  it("lists no enrolments, because a verified address is the enrolment", async () => {
    const { factor } = await harness();
    expect(await factor.listEnrolments(USER_ID)).toEqual({ ok: true, data: [] });
  });
});

describe("createEmailOtpFactor — issuing", () => {
  it("sends a code of the configured length to the resolved address, with the expiry", async () => {
    const { factor, notifier } = await harness();
    const issued = await factor.createChallenge(USER_ID, NOW);
    expect(issued).toEqual({ ok: true, data: { kind: "email-otp", expiresAt: NOW + TTL_MS } });
    expect(notifier.sent).toEqual([{ to: "aurora@example.test", kind: "otp", code: lastCode(notifier), expiresAt: NOW + TTL_MS }]);
    expect(lastCode(notifier)).toMatch(/^\d{6}$/);
  });

  it("honours a configured digit count", async () => {
    const { factor, notifier } = await harness({ digits: 8 });
    await factor.createChallenge(USER_ID, NOW);
    expect(lastCode(notifier)).toMatch(/^\d{8}$/);
  });

  it("does not store the code in the clear — only the sealed token", async () => {
    const { factor, state, notifier } = await harness();
    await factor.createChallenge(USER_ID, NOW);
    const stored = await state.read(USER_ID, NOW);
    expect(stored.ok && stored.data?.token).toBeTruthy();
    expect(JSON.stringify(stored)).not.toContain(lastCode(notifier));
  });

  it("spaces issues by the cooldown and lets the next one through the moment it lapses", async () => {
    const { factor } = await harness({ cooldownMs: COOLDOWN_MS });
    expect((await factor.createChallenge(USER_ID, NOW)).ok).toBe(true);
    expect(await factor.createChallenge(USER_ID, NOW + COOLDOWN_MS - 1)).toEqual({ ok: false, error: "too-soon" });
    expect((await factor.createChallenge(USER_ID, NOW + COOLDOWN_MS)).ok).toBe(true);
  });

  // The defect this replaces: three unauthenticated posts naming an address spent that identity's
  // whole daily budget, and where email-OTP is the primary factor that is a day without an account.
  it("never leaves an identity without a code for longer than the cooldown, however many were requested", async () => {
    const { factor, notifier } = await harness({ cooldownMs: COOLDOWN_MS });
    for (const attacker of [NOW, NOW + COOLDOWN_MS, NOW + 2 * COOLDOWN_MS]) await factor.createChallenge(USER_ID, attacker);
    expect(notifier.sent).toHaveLength(3);

    const victim = await factor.createChallenge(USER_ID, NOW + 3 * COOLDOWN_MS);
    expect(victim).toEqual({ ok: true, data: { kind: "email-otp", expiresAt: NOW + 3 * COOLDOWN_MS + TTL_MS } });
  });

  it("sends one mail between parallel requests for one identity, not one each", async () => {
    const { factor, notifier } = await harness({ cooldownMs: COOLDOWN_MS });
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => factor.createChallenge(USER_ID, NOW)));
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(notifier.sent).toHaveLength(1);
  });

  it("spaces per identity, so one user's issue does not delay another's", async () => {
    const { factor } = await harness({ cooldownMs: COOLDOWN_MS });
    const other = uuidv7();
    await factor.createChallenge(USER_ID, NOW);
    expect(await factor.createChallenge(USER_ID, NOW)).toEqual({ ok: false, error: "too-soon" });
    expect((await factor.createChallenge(other, NOW)).ok).toBe(true);
  });

  // The cooldown is claimed before the mail, so a failed send costs the identity one cooldown. That
  // is the deliberate half of the trade: what is bounded is what is *sent*, not what is recorded.
  it("reports a failed delivery as unavailable, having already claimed the cooldown", async () => {
    const failing: AuthNotifier = { send: () => Promise.resolve({ ok: false, error: new AuthStoreError("unavailable", "notify.send") }) };
    const { factor, state } = await harness({ notifier: failing, cooldownMs: COOLDOWN_MS });
    expect(await factor.createChallenge(USER_ID, NOW)).toEqual({ ok: false, error: "unavailable" });
    expect((await state.read(USER_ID, NOW)).ok).toBe(true);
    expect(await factor.createChallenge(USER_ID, NOW)).toEqual({ ok: false, error: "too-soon" });
  });
});

describe("createEmailOtpFactor — verifying", () => {
  it("accepts the right code once, then refuses it as consumed", async () => {
    const { factor, notifier } = await harness();
    await factor.createChallenge(USER_ID, NOW);
    const code = lastCode(notifier);
    expect(await factor.verifyChallenge(USER_ID, code, NOW)).toEqual({ ok: true, data: { kind: "email-otp", userId: USER_ID, verifiedAt: NOW } });
    expect(await factor.verifyChallenge(USER_ID, code, NOW)).toEqual({ ok: false, error: "expired" });
  });

  it("refuses a code issued for one identity when presented for another", async () => {
    const { factor, notifier, state } = await harness();
    await factor.createChallenge(USER_ID, NOW);
    const stolen = await state.read(USER_ID, NOW);
    const other = uuidv7();
    if (!stolen.ok || !stolen.data) throw new Error("no state");
    await state.issue(other, stolen.data, 0);
    expect(await factor.verifyChallenge(other, lastCode(notifier), NOW)).toEqual({ ok: false, error: "unrecognised" });
  });

  it("refuses once the code's own lifetime has passed", async () => {
    const { factor, notifier } = await harness();
    await factor.createChallenge(USER_ID, NOW);
    expect(await factor.verifyChallenge(USER_ID, lastCode(notifier), NOW + TTL_MS)).toEqual({ ok: false, error: "expired" });
  });

  it("refuses when nothing was ever issued", async () => {
    const { factor } = await harness();
    expect(await factor.verifyChallenge(USER_ID, "000000", NOW)).toEqual({ ok: false, error: "expired" });
  });

  it("refuses at exactly the attempt after the limit, and not before", async () => {
    const { factor, notifier } = await harness({ maxAttempts: 3 });
    await factor.createChallenge(USER_ID, NOW);
    const wrong = lastCode(notifier) === "000000" ? "111111" : "000000";
    const outcomes: string[] = [];
    for (let ordinal = 1; ordinal <= 4; ordinal++) {
      const attempt = await factor.verifyChallenge(USER_ID, wrong, NOW);
      outcomes.push(`${ordinal}: ${attempt.ok ? "accepted" : attempt.error}`);
    }
    expect(outcomes).toEqual(["1: unrecognised", "2: unrecognised", "3: unrecognised", "4: too-many-attempts"]);
  });

  // The defect this proves closed: the count was read, compared and written back, so every guess
  // arriving inside one another's round trip compared against the same zero.
  it("spends exactly the attempt budget under parallel guesses, however many arrive at once", async () => {
    const { factor, notifier } = await harness({ maxAttempts: 3 });
    await factor.createChallenge(USER_ID, NOW);
    const wrong = lastCode(notifier) === "000000" ? "111111" : "000000";

    const outcomes = await Promise.all(Array.from({ length: 12 }, () => factor.verifyChallenge(USER_ID, wrong, NOW)));
    const reasons = outcomes.map((outcome) => (outcome.ok ? "accepted" : outcome.error));
    expect(reasons.filter((reason) => reason === "unrecognised")).toHaveLength(3);
    expect(reasons.filter((reason) => reason === "too-many-attempts")).toHaveLength(9);
  });

  it("refuses the right code once the attempt budget is spent", async () => {
    const { factor, notifier } = await harness({ maxAttempts: 2 });
    await factor.createChallenge(USER_ID, NOW);
    const code = lastCode(notifier);
    const wrong = code === "000000" ? "111111" : "000000";
    await factor.verifyChallenge(USER_ID, wrong, NOW);
    await factor.verifyChallenge(USER_ID, wrong, NOW);
    expect(await factor.verifyChallenge(USER_ID, code, NOW)).toEqual({ ok: false, error: "too-many-attempts" });
  });

  it("clears the code on a success, so the next one starts on a full guess budget", async () => {
    const { factor, notifier, state } = await harness({ maxAttempts: 3 });
    await factor.createChallenge(USER_ID, NOW);
    const wrong = lastCode(notifier) === "000000" ? "111111" : "000000";
    await factor.verifyChallenge(USER_ID, wrong, NOW);
    expect(await factor.verifyChallenge(USER_ID, lastCode(notifier), NOW)).toMatchObject({ ok: true });
    expect(await state.read(USER_ID, NOW)).toEqual({ ok: true, data: null });
    // The budget is whole again: a second code issues, and gets its full three guesses.
    expect((await factor.createChallenge(USER_ID, NOW)).ok).toBe(true);
    const second = lastCode(notifier);
    const otherWrong = second === "000000" ? "111111" : "000000";
    for (let ordinal = 1; ordinal <= 3; ordinal++) {
      expect(`${ordinal}: ${(await factor.verifyChallenge(USER_ID, otherWrong, NOW)).ok}`).toBe(`${ordinal}: false`);
    }
  });

  it("separates an expired code from a wrong one at the store layer", async () => {
    const { factor, notifier } = await harness();
    await factor.createChallenge(USER_ID, NOW);
    const code = lastCode(notifier);
    const wrong = code === "000000" ? "111111" : "000000";
    const expired = await factor.verifyChallenge(USER_ID, code, NOW + TTL_MS);
    const { factor: second } = await harness();
    await second.createChallenge(USER_ID, NOW);
    const incorrect = await second.verifyChallenge(USER_ID, wrong, NOW);
    expect(expired.ok === false && expired.error).toBe("expired");
    expect(incorrect.ok === false && incorrect.error).toBe("unrecognised");
    expect(expired).not.toEqual(incorrect);
  });
});

describe("createEmailOtpFactor — store failures", () => {
  function brokenState(failing: keyof OtpStateStore): OtpStateStore {
    const inner = memoryOtpState();
    const refuse = (): Promise<never> =>
      Promise.resolve({ ok: false, error: new AuthStoreError("unavailable", `otpState.${failing}`) }) as Promise<never>;
    return { ...inner, [failing]: refuse } as OtpStateStore;
  }

  it("reports a failure to spend the guess as unavailable rather than as a wrong code", async () => {
    const { factor } = await harness({ state: brokenState("countAttempt") });
    expect(await factor.verifyChallenge(USER_ID, "000000", NOW)).toEqual({ ok: false, error: "unavailable" });
  });

  it("reports a failure to claim the cooldown as unavailable, and sends nothing", async () => {
    const { factor, notifier } = await harness({ state: brokenState("issue") });
    expect(await factor.createChallenge(USER_ID, NOW)).toEqual({ ok: false, error: "unavailable" });
    expect(notifier.sent).toEqual([]);
  });

  // The refused guess is classified by a read, so a read that fails must not name a reason it has
  // not established — an expired code and a spent budget are different answers to the caller.
  it("reports a failure to classify a refused guess as unavailable, not as expired", async () => {
    const inner = memoryOtpState();
    const state: OtpStateStore = {
      ...inner,
      read: () => Promise.resolve({ ok: false as const, error: new AuthStoreError("unavailable", "otpState.read") }),
    };
    const { factor } = await harness({ state });
    expect(await factor.verifyChallenge(USER_ID, "000000", NOW)).toEqual({ ok: false, error: "unavailable" });
  });

  it("reports a failure to clear on success as unavailable, rather than reporting a success it did not record", async () => {
    const { factor, notifier } = await harness({ state: brokenState("clear") });
    await factor.createChallenge(USER_ID, NOW);
    expect(await factor.verifyChallenge(USER_ID, lastCode(notifier), NOW)).toEqual({ ok: false, error: "unavailable" });
  });
});

describe("createEmailOtpFactor — the ranges it holds at construction", () => {
  async function factory(overrides: Partial<Parameters<typeof createEmailOtpFactor>[0]>) {
    const keys = await importAuthKeyRing([SECRET]);
    return () =>
      createEmailOtpFactor({
        keys,
        state: memoryOtpState(),
        nonces: createNonceStore(fakeKV()),
        notifier: recordingNotifier(),
        address: () => "aurora@example.test",
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

  it("refuses a fraction", async () => {
    expect(await factory({ ttlMs: 60_000.5 })).toThrow("createEmailOtpFactor: ttlMs is 60000.5, which is not a whole number.");
  });

  it("accepts every knob omitted", async () => {
    expect(await factory({})).not.toThrow();
  });
});
