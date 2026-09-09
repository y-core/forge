import { beforeAll, describe, expect, it } from "bun:test";

import { bytesToHex, base32Decode, hotpCode, totpCounter, uuidv7 } from "../../crypto/mod";
import { err, ok } from "../../result/result";
import { AuthStoreError } from "../errors";
import { importAuthKeyRing } from "../keys/ring";
import type { AuthFactor, AuthFactorInput, AuthKeyRing, FactorStore } from "../types";
import { createTotpAppFactor } from "./totp-app";

const USER_ID = uuidv7();
const PERIOD = 30;
const AT = 1_700_000_010_000;
const CURRENT = totpCounter(Math.floor(AT / 1000), { period: PERIOD });

let ring: AuthKeyRing;

beforeAll(async () => {
  ring = await importAuthKeyRing(["ab".repeat(32)]);
});

interface StoreSpy {
  store: FactorStore;
  rows: AuthFactor[];
  advances: { id: string; counter: number }[];
  removals: string[];
  spent: Map<string, number>;
}

function fakeFactors(seed: AuthFactor | null = null): StoreSpy {
  const rows: AuthFactor[] = seed ? [seed] : [];
  const advances: { id: string; counter: number }[] = [];
  const removals: string[] = [];
  const spent = new Map<string, number>();

  const store: FactorStore = {
    listByUser: (userId) => Promise.resolve(ok(rows.filter((row) => row.userId === userId))),
    find: (userId, kind) => Promise.resolve(ok(rows.find((row) => row.userId === userId && row.kind === kind) ?? null)),
    findEnrolled: (userId, kinds) => Promise.resolve(ok(rows.filter((row) => row.userId === userId && kinds.includes(row.kind)))),
    enrol: (input: AuthFactorInput, at) => {
      const row: AuthFactor = {
        id: uuidv7(),
        userId: input.userId,
        kind: input.kind,
        secret: input.secret ?? null,
        lastCounter: null,
        confirmedAt: input.confirmedAt ?? null,
        createdAt: at,
        updatedAt: at,
      };
      rows.push(row);
      return Promise.resolve(ok(row));
    },
    // The one statement the D1 adapter writes: it spends the guess and reports whether the budget
    // admitted it, so a wrong code costs the same whether or not it was ever compared.
    countAttempt: (id, _userId, maxAttempts) => {
      const used = spent.get(id) ?? 0;
      if (used >= maxAttempts) return Promise.resolve(ok(false));
      spent.set(id, used + 1);
      return Promise.resolve(ok(true));
    },
    confirm: (id, _userId, at) => {
      const index = rows.findIndex((row) => row.id === id);
      const row = rows[index];
      if (index < 0 || !row) return Promise.resolve(ok(false));
      rows[index] = { ...row, confirmedAt: at, updatedAt: at };
      return Promise.resolve(ok(true));
    },
    // The conditional advance the D1 adapter writes as one statement: it takes only a counter above
    // the last accepted one, which is what stops a code being replayed inside its own step.
    advanceCounter: (id, _userId, counter, at) => {
      advances.push({ id, counter });
      const index = rows.findIndex((row) => row.id === id);
      const row = rows[index];
      if (index < 0 || !row) return Promise.resolve(ok(false));
      if (row.lastCounter !== null && row.lastCounter >= counter) return Promise.resolve(ok(false));
      rows[index] = { ...row, lastCounter: counter, updatedAt: at };
      spent.set(id, 0);
      return Promise.resolve(ok(true));
    },
    remove: (id) => {
      removals.push(id);
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) return Promise.resolve(ok(false));
      rows.splice(index, 1);
      return Promise.resolve(ok(true));
    },
  };
  return { store, rows, advances, removals, spent };
}

function factor(spy: StoreSpy): AuthFactor {
  const row = spy.rows[0];
  if (!row) throw new Error("no factor row");
  return row;
}

function build(spy: StoreSpy, maxAttempts?: number) {
  return createTotpAppFactor({
    keys: ring,
    factors: spy.store,
    issuer: "Forge Demo",
    account: () => "person@example.com",
    period: PERIOD,
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
  });
}

/** A code no step in the drift window would accept, found rather than assumed. */
async function wrongCode(secret: Uint8Array<ArrayBuffer>): Promise<string> {
  const live = await Promise.all([CURRENT - 1, CURRENT, CURRENT + 1].map((counter) => hotpCode(secret, counter)));
  for (let candidate = 0; ; candidate++) {
    const digits = String(candidate).padStart(6, "0");
    if (!live.includes(digits)) return digits;
  }
}

async function enrolled(spy: StoreSpy): Promise<Uint8Array<ArrayBuffer>> {
  const service = build(spy);
  const begun = await service.beginEnrolment(USER_ID, AT);
  if (!begun.ok) throw new Error(`enrolment refused: ${begun.error}`);
  return base32Decode((begun.data.options as { secret: string }).secret);
}

/** Enrols, confirms, then clears the counter the confirming code advanced, so each test sets its own start. */
async function confirmed(spy: StoreSpy): Promise<Uint8Array<ArrayBuffer>> {
  const secret = await enrolled(spy);
  const completed = await build(spy).completeEnrolment(USER_ID, await hotpCode(secret, CURRENT), AT);
  if (!completed.ok) throw new Error(`confirmation refused: ${completed.error}`);
  spy.rows[0] = { ...factor(spy), lastCounter: null };
  return secret;
}

describe("createTotpAppFactor — the capability matrix", () => {
  it("offers step-up only, because an authenticator app proves possession and does not identify", () => {
    const service = build(fakeFactors());
    expect(service.capabilities).toEqual({ primary: false, stepUp: true });
    expect(service.enrolment).toBe("explicit");
    expect(service.kind).toBe("totp-app");
  });
});

describe("createTotpAppFactor — enrolment", () => {
  it("emits the base32 secret and an otpauth URI carrying the same bytes", async () => {
    const spy = fakeFactors();
    const begun = await build(spy).beginEnrolment(USER_ID, AT);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    const emitted = begun.data.options as { secret: string; uri: string };
    expect(emitted.uri).toBe(
      `otpauth://totp/Forge%20Demo:person%40example.com?secret=${emitted.secret}&issuer=Forge%20Demo&algorithm=SHA1&digits=6&period=30`,
    );
  });

  // The falsifiable criterion for the sealed secret: a database read must not mint valid codes.
  it("stores no plaintext secret in the row it writes", async () => {
    const spy = fakeFactors();
    const secret = await enrolled(spy);
    const stored = factor(spy).secret;
    expect(stored).not.toBeNull();
    expect(bytesToHex(stored ?? new Uint8Array())).not.toContain(bytesToHex(secret));
  });

  it("leaves the row unconfirmed until a first correct code, so a half-finished ceremony grants nothing", async () => {
    const spy = fakeFactors();
    const secret = await enrolled(spy);
    expect(factor(spy).confirmedAt).toBeNull();
    expect(await build(spy).createChallenge(USER_ID, AT)).toEqual({ ok: false, error: "not-enrolled" });
    expect(await build(spy).verifyChallenge(USER_ID, await hotpCode(secret, CURRENT), AT)).toEqual({ ok: false, error: "not-enrolled" });

    const completed = await build(spy).completeEnrolment(USER_ID, await hotpCode(secret, CURRENT), AT);
    expect(completed.ok && completed.data.confirmedAt).toBe(AT);
    expect(factor(spy).confirmedAt).toBe(AT);
  });

  it("refuses a wrong code at completion, leaving the row unconfirmed", async () => {
    const spy = fakeFactors();
    await enrolled(spy);
    expect(await build(spy).completeEnrolment(USER_ID, "000000", AT)).toEqual({ ok: false, error: "unrecognised" });
    expect(factor(spy).confirmedAt).toBeNull();
  });

  it("replaces an abandoned unconfirmed enrolment rather than locking the user out of enrolling again", async () => {
    const spy = fakeFactors();
    const first = await enrolled(spy);
    const second = await enrolled(spy);
    expect(spy.removals).toHaveLength(1);
    expect(spy.rows).toHaveLength(1);
    expect(bytesToHex(first)).not.toBe(bytesToHex(second));
  });

  it("refuses to re-enrol over a confirmed factor, which would disable a working one", async () => {
    const spy = fakeFactors();
    const secret = await enrolled(spy);
    await build(spy).completeEnrolment(USER_ID, await hotpCode(secret, CURRENT), AT);
    expect(await build(spy).beginEnrolment(USER_ID, AT)).toEqual({ ok: false, error: "already-enrolled" });
  });
});

describe("createTotpAppFactor — the attempt ceiling", () => {
  // The defect this closes: a wrong code cost nothing, so a six-digit space was brute-forceable at
  // the speed of the network while the account's other factor stood by.
  it("spends a guess on every wrong code, and refuses the correct one once the budget is gone", async () => {
    const spy = fakeFactors();
    const secret = await confirmed(spy);
    const service = build(spy, 2);
    const wrong = await wrongCode(secret);

    expect(await service.verifyChallenge(USER_ID, wrong, AT)).toEqual({ ok: false, error: "unrecognised" });
    expect(await service.verifyChallenge(USER_ID, wrong, AT)).toEqual({ ok: false, error: "unrecognised" });
    // The third never reaches the comparison at all, which is why the *correct* code is refused too.
    expect(await service.verifyChallenge(USER_ID, await hotpCode(secret, CURRENT), AT)).toEqual({ ok: false, error: "too-many-attempts" });
  });

  it("clears the spent guesses on an accepted code, so a mistyped digit is not cumulative", async () => {
    const spy = fakeFactors();
    const secret = await confirmed(spy);
    const service = build(spy, 2);

    await service.verifyChallenge(USER_ID, await wrongCode(secret), AT);
    expect((await service.verifyChallenge(USER_ID, await hotpCode(secret, CURRENT), AT)).ok).toBe(true);
    expect(spy.spent.get(factor(spy).id)).toBe(0);
  });

  it("holds the ceiling against the enrolment ceremony too, since that is a code the same secret answers", async () => {
    const spy = fakeFactors();
    const secret = await enrolled(spy);
    const service = build(spy, 1);

    expect(await service.completeEnrolment(USER_ID, await wrongCode(secret), AT)).toEqual({ ok: false, error: "unrecognised" });
    expect(await service.completeEnrolment(USER_ID, await hotpCode(secret, CURRENT), AT)).toEqual({ ok: false, error: "too-many-attempts" });
    expect(factor(spy).confirmedAt).toBeNull();
  });
});

describe("createTotpAppFactor — the ranges it holds at construction", () => {
  function factory(overrides: Partial<Parameters<typeof createTotpAppFactor>[0]>) {
    return () =>
      createTotpAppFactor({ keys: ring, factors: fakeFactors().store, issuer: "Forge Demo", account: () => "person@example.com", ...overrides });
  }

  it("refuses a secret below the 16-byte floor at construction, not at the first enrolment", () => {
    expect(factory({ secretBytes: 4 })).toThrow(
      "createTotpAppFactor: secretBytes is 4, below the 16-byte floor — the 128 bits RFC 4226 §4 R6 states for a shared secret.",
    );
  });

  it("accepts the secret floor itself, and any length above it", () => {
    expect(factory({ secretBytes: 16 })).not.toThrow();
    expect(factory({ secretBytes: 64 })).not.toThrow();
  });

  it("refuses a code narrower than RFC 4226 allows", () => {
    expect(factory({ digits: 5 })).toThrow("createTotpAppFactor: digits is 5, below the 6-digit floor — the shortest code RFC 4226 §5.3 allows.");
  });

  it("refuses a code wider than dynamic truncation fills uniformly", () => {
    expect(factory({ digits: 9 })).toThrow(
      "createTotpAppFactor: digits is 9, above the 8-digit ceiling — the widest code dynamic truncation fills uniformly from its 31 bits.",
    );
  });

  it("accepts both code widths themselves", () => {
    expect(factory({ digits: 6 })).not.toThrow();
    expect(factory({ digits: 8 })).not.toThrow();
  });

  it("refuses a step shorter than the drift window can carry", () => {
    expect(factory({ period: 14 })).toThrow(
      "createTotpAppFactor: period is 14, below the 15-second floor — below it the drift window is the only thing keeping a code answerable.",
    );
  });

  it("refuses a step that would keep one code live for longer than six minutes", () => {
    expect(factory({ period: 121 })).toThrow(
      "createTotpAppFactor: period is 121, above the 120-second ceiling — one step either side of it already keeps a code live for six minutes.",
    );
  });

  it("accepts both step bounds themselves", () => {
    expect(factory({ period: 15 })).not.toThrow();
    expect(factory({ period: 120 })).not.toThrow();
  });

  it("refuses a fraction, which the counter arithmetic would otherwise carry silently", () => {
    expect(factory({ period: 30.5 })).toThrow("createTotpAppFactor: period is 30.5, which is not a whole number.");
  });

  it("refuses a ceiling no mistyped digit could survive, and one wide enough to be none", () => {
    expect(factory({ maxAttempts: 0 })).toThrow(
      "createTotpAppFactor: maxAttempts is 0, below the 1-attempt floor — a single mistyped digit would otherwise lock the factor out.",
    );
    expect(factory({ maxAttempts: 21 })).toThrow(
      "createTotpAppFactor: maxAttempts is 21, above the 20-attempt ceiling — beyond it the drift window hands an attacker more of a six-digit space than it withholds.",
    );
  });

  it("accepts every knob omitted", () => {
    expect(factory({})).not.toThrow();
  });
});

describe("createTotpAppFactor — the drift window", () => {
  it("accepts the current step and both neighbours, and refuses ±2", async () => {
    for (const step of [-2, -1, 0, 1, 2]) {
      const spy = fakeFactors();
      const secret = await confirmed(spy);
      const outcome = await build(spy).verifyChallenge(USER_ID, await hotpCode(secret, CURRENT + step), AT);
      expect(`${step}: ${outcome.ok ? "accepted" : outcome.error}`).toBe(`${step}: ${Math.abs(step) <= 1 ? "accepted" : "unrecognised"}`);
    }
  });
});

describe("createTotpAppFactor — replay inside one step", () => {
  // The falsifiable criterion: a code accepted once is refused for the rest of its own step, which
  // is what `advanceCounter` reporting rows-affected buys over a read-then-write.
  it("refuses a code presented a second time within its step", async () => {
    const spy = fakeFactors();
    const secret = await confirmed(spy);

    const code = await hotpCode(secret, CURRENT);
    expect((await build(spy).verifyChallenge(USER_ID, code, AT)).ok).toBe(true);
    expect(await build(spy).verifyChallenge(USER_ID, code, AT)).toEqual({ ok: false, error: "consumed" });
    expect(factor(spy).lastCounter).toBe(CURRENT);
  });

  it("refuses the previous step's code once the current one has been accepted", async () => {
    const spy = fakeFactors();
    const secret = await confirmed(spy);
    await build(spy).verifyChallenge(USER_ID, await hotpCode(secret, CURRENT), AT);
    expect(await build(spy).verifyChallenge(USER_ID, await hotpCode(secret, CURRENT - 1), AT)).toEqual({ ok: false, error: "consumed" });
  });

  it("refuses the confirming code itself as a step-up, because confirmation already spent that step", async () => {
    const spy = fakeFactors();
    const secret = await enrolled(spy);
    const code = await hotpCode(secret, CURRENT);
    expect((await build(spy).completeEnrolment(USER_ID, code, AT)).ok).toBe(true);
    expect(await build(spy).verifyChallenge(USER_ID, code, AT)).toEqual({ ok: false, error: "consumed" });
  });
});

describe("createTotpAppFactor — the challenge and the enrolment list", () => {
  it("names the step boundary the code the user is about to read stops working at", async () => {
    const spy = fakeFactors();
    const secret = await enrolled(spy);
    await build(spy).completeEnrolment(USER_ID, await hotpCode(secret, CURRENT), AT);
    const challenge = await build(spy).createChallenge(USER_ID, AT);
    expect(challenge).toEqual({ ok: true, data: { kind: "totp-app", expiresAt: (CURRENT + 1) * PERIOD * 1000 } });
  });

  it("lists the one row this factor owns, and nothing when there is none", async () => {
    const spy = fakeFactors();
    expect(await build(spy).listEnrolments(USER_ID)).toEqual({ ok: true, data: [] });
    await enrolled(spy);
    const listed = await build(spy).listEnrolments(USER_ID);
    expect(listed.ok && listed.data.map((row) => row.kind)).toEqual(["totp-app"]);
  });

  it("reports a store failure as `unavailable` rather than as a wrong code", async () => {
    const failing = fakeFactors();
    const broken: FactorStore = { ...failing.store, find: () => Promise.resolve(err(new AuthStoreError("unavailable", "factors.find"))) };
    const service = createTotpAppFactor({ keys: ring, factors: broken, issuer: "Forge Demo", account: () => "person@example.com" });
    expect(await service.verifyChallenge(USER_ID, "000000", AT)).toEqual({ ok: false, error: "unavailable" });
    expect(await service.createChallenge(USER_ID, AT)).toEqual({ ok: false, error: "unavailable" });
  });

  it("reports `not-enrolled` for a user who has no row at all", async () => {
    const spy = fakeFactors();
    expect(await build(spy).verifyChallenge(USER_ID, "000000", AT)).toEqual({ ok: false, error: "not-enrolled" });
  });
});
