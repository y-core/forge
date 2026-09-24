import { afterEach, beforeAll, describe, expect, it } from "bun:test";

import { base64urlEncode, bytesToHex, base32Decode, hotpCode, totpCounter, uuidv7 } from "../../crypto/mod";
import { err, ok } from "../../result/result";
import { AuthStoreError } from "../errors";
import { importAuthKeyRing } from "../keys/ring";
import type { AuthFactor, AuthFactorInput, AuthKeyRing, FactorStore } from "../types";
import { installTimingProbe } from "./factors.fixture";
import { createTotpAppFactor } from "./totp-app";
import type { TimingProbeHandle } from "./types";

const USER_ID = uuidv7();
const PERIOD = 30;
const AT = 1_700_000_010_000;
const CURRENT = totpCounter(Math.floor(AT / 1000), { period: PERIOD });

const ROOT_OLD = "2c83943e16eb5c3741d74260b4751de91afeab397689cfd139f7263b21aec037";
const ROOT_NEW = "9d1f4b6a0c27e8531fa4d90b6e2c7148ab35f0d962741ec8530b9af62d418c75";

let ring: AuthKeyRing;
/** The same key demoted behind a newer one, so anything sealed under `ring` opens here as stale. */
let rotated: AuthKeyRing;

beforeAll(async () => {
  ring = await importAuthKeyRing([ROOT_OLD]);
  rotated = await importAuthKeyRing([ROOT_NEW, ROOT_OLD]);
});

interface StoreSpy {
  store: FactorStore;
  rows: AuthFactor[];
  advances: { id: string; counter: number; resealed: boolean }[];
  removals: string[];
  spent: Map<string, number>;
}

function fakeFactors(seed: AuthFactor | null = null): StoreSpy {
  const rows: AuthFactor[] = seed ? [seed] : [];
  const advances: { id: string; counter: number; resealed: boolean }[] = [];
  const removals: string[] = [];
  const spent = new Map<string, number>();
  const lastSpentAt = new Map<string, number>();

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
        failedAttempts: 0,
        lastVerifiedAt: null,
        confirmedAt: input.confirmedAt ?? null,
        createdAt: at,
        updatedAt: at,
      };
      rows.push(row);
      return Promise.resolve(ok(row));
    },
    // The one statement the D1 adapter writes: it spends the guess and hands back the row it was
    // spent against, so a wrong code costs the same whether or not it was ever compared.
    countAttempt: (userId, kind, maxAttempts, at, lockoutMs) => {
      const row = rows.find((held) => held.userId === userId && held.kind === kind);
      if (!row) return Promise.resolve(ok(null));
      const used = spent.get(row.id) ?? 0;
      const lastSpent = lastSpentAt.get(row.id) ?? 0;
      if (used >= maxAttempts && lastSpent > at - lockoutMs) return Promise.resolve(ok(null));
      spent.set(row.id, used >= maxAttempts ? 1 : used + 1);
      lastSpentAt.set(row.id, at);
      return Promise.resolve(ok({ ...row, failedAttempts: spent.get(row.id) ?? 0, updatedAt: at }));
    },
    confirm: (id, _userId, at) => {
      const index = rows.findIndex((row) => row.id === id);
      const row = rows[index];
      if (index < 0 || !row) return Promise.resolve(ok(false));
      rows[index] = { ...row, confirmedAt: at, updatedAt: at };
      return Promise.resolve(ok(true));
    },
    // The D1 adapter clears `failed_attempts` on the same statement, so the fixture hands the spend
    // back too — a factor unenrolled this way must not lock the re-enrolment behind its own budget.
    unconfirm: (id, _userId, at) => {
      const index = rows.findIndex((row) => row.id === id);
      const row = rows[index];
      if (index < 0 || !row) return Promise.resolve(ok(false));
      rows[index] = { ...row, confirmedAt: null, failedAttempts: 0, updatedAt: at };
      spent.set(id, 0);
      return Promise.resolve(ok(true));
    },
    // The conditional advance the D1 adapter writes as one statement: it takes only a counter above
    // the last accepted one, so a replay writes neither the counter nor the secret riding with it.
    recordVerification: (id, _userId, counter, at, secret) => {
      advances.push({ id, counter, resealed: secret !== undefined });
      const index = rows.findIndex((row) => row.id === id);
      const row = rows[index];
      if (index < 0 || !row) return Promise.resolve(ok(false));
      if (row.lastCounter !== null && row.lastCounter >= counter) return Promise.resolve(ok(false));
      rows[index] = { ...row, lastCounter: counter, lastVerifiedAt: at, updatedAt: at, ...(secret === undefined ? {} : { secret }) };
      spent.set(id, 0);
      return Promise.resolve(ok(true));
    },
    countSecretsNotUnder: (kind, kid) =>
      Promise.resolve(
        ok(rows.filter((row) => row.kind === kind && row.secret !== null && base64urlEncode(row.secret.subarray(0, 6)) !== kid).length),
      ),
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

function build(spy: StoreSpy, maxAttempts?: number, lockoutMs?: number, keys: AuthKeyRing = ring) {
  return createTotpAppFactor({
    keys,
    factors: spy.store,
    issuer: "Forge Demo",
    account: () => "person@example.com",
    period: PERIOD,
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(lockoutMs === undefined ? {} : { lockoutMs }),
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
    expect(service.capabilities).toEqual({ stepUp: true });
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

  it("re-offers the unconfirmed row's own secret, so a re-render does not rotate it", async () => {
    const spy = fakeFactors();
    const first = await enrolled(spy);
    const second = await enrolled(spy);
    expect(bytesToHex(second)).toBe(bytesToHex(first));
    expect(spy.removals).toHaveLength(0);
    expect(spy.rows).toHaveLength(1);
  });

  it("re-offers the same provisioning URI too, so the QR code a page renders does not change either", async () => {
    const spy = fakeFactors();
    const service = build(spy);
    const first = await service.beginEnrolment(USER_ID, AT);
    const second = await service.beginEnrolment(USER_ID, AT);
    expect(first.ok && second.ok && second.data.options).toEqual(first.ok ? first.data.options : null);
  });

  // The one case that still rebuilds: the stored secret will not open, which is a rotated key and
  // not an abandoned ceremony. Without it the user could never enrol again.
  it("replaces a row whose sealed secret no longer opens, rather than locking the user out of enrolling", async () => {
    const spy = fakeFactors();
    const first = await enrolled(spy);
    spy.rows[0] = { ...(spy.rows[0] as AuthFactor), secret: new Uint8Array([1, 2, 3]) as Uint8Array<ArrayBuffer> };
    const second = await enrolled(spy);
    expect(spy.removals).toHaveLength(1);
    expect(spy.rows).toHaveLength(1);
    expect(bytesToHex(second)).not.toBe(bytesToHex(first));
  });

  it("reports a lost enrolment race as `already-enrolled`, the same reason the non-racing case gives", async () => {
    const spy = fakeFactors();
    spy.store.enrol = () => Promise.resolve(err(new AuthStoreError("conflict", "factors.enrol")));
    expect(await build(spy).beginEnrolment(USER_ID, AT)).toEqual({ ok: false, error: "already-enrolled" });
  });

  it("still reports a store outage on that same write as `unavailable`", async () => {
    const spy = fakeFactors();
    spy.store.enrol = () => Promise.resolve(err(new AuthStoreError("unavailable", "factors.enrol")));
    expect(await build(spy).beginEnrolment(USER_ID, AT)).toEqual({ ok: false, error: "unavailable" });
  });

  it("refuses to re-enrol over a confirmed factor, which would disable a working one", async () => {
    const spy = fakeFactors();
    const secret = await enrolled(spy);
    await build(spy).completeEnrolment(USER_ID, await hotpCode(secret, CURRENT), AT);
    expect(await build(spy).beginEnrolment(USER_ID, AT)).toEqual({ ok: false, error: "already-enrolled" });
  });
});

describe("createTotpAppFactor — the attempt ceiling", () => {
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

  // The lock is a window and not a state: past it the next guess reopens the budget, so a user who
  // mistyped five times is slowed down rather than locked out of their own account for good.
  it("lets the lockout expire, so a correct code after the window succeeds", async () => {
    const spy = fakeFactors();
    const secret = await confirmed(spy);
    const service = build(spy, 2, 60_000);
    const wrong = await wrongCode(secret);

    await service.verifyChallenge(USER_ID, wrong, AT);
    await service.verifyChallenge(USER_ID, wrong, AT + 1);
    expect(await service.verifyChallenge(USER_ID, await hotpCode(secret, CURRENT), AT + 59_000)).toEqual({ ok: false, error: "too-many-attempts" });
    const later = AT + 61_001;
    const code = await hotpCode(secret, totpCounter(Math.floor(later / 1000), { period: PERIOD }));
    expect((await service.verifyChallenge(USER_ID, code, later)).ok).toBe(true);
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

// Together these turn "never safe to drop a `totpWrap` secret" into a condition a deployment can
// test: the population under a retired key shrinks on its own, and reaching zero is observable.
describe("createTotpAppFactor — re-sealing a secret under the ring's active key", () => {
  /** The key id the row's sealed secret currently names. */
  function sealedUnder(spy: StoreSpy): string {
    return base64urlEncode((factor(spy).secret as Uint8Array<ArrayBuffer>).subarray(0, 6));
  }

  it("re-seals on an accepted code whose frame is under a retired key", async () => {
    const spy = fakeFactors();
    const secret = await confirmed(spy);
    expect(sealedUnder(spy)).toBe(ring.activeKeyId);
    expect((await build(spy, undefined, undefined, rotated).verifyChallenge(USER_ID, await hotpCode(secret, CURRENT), AT)).ok).toBe(true);
    expect(sealedUnder(spy)).toBe(rotated.activeKeyId);
    expect(spy.advances.at(-1)?.resealed).toBe(true);
  });

  it("leaves a frame already under the active key alone, so a verification spends no `totpWrap` nonce", async () => {
    const spy = fakeFactors();
    const secret = await confirmed(spy);
    const before = bytesToHex(factor(spy).secret as Uint8Array<ArrayBuffer>);
    expect((await build(spy).verifyChallenge(USER_ID, await hotpCode(secret, CURRENT), AT)).ok).toBe(true);
    expect(bytesToHex(factor(spy).secret as Uint8Array<ArrayBuffer>)).toBe(before);
    expect(spy.advances.at(-1)?.resealed).toBe(false);
  });

  it("re-seals to a secret that still opens, and still answers the same codes", async () => {
    const spy = fakeFactors();
    const secret = await confirmed(spy);
    const service = build(spy, undefined, undefined, rotated);
    await service.verifyChallenge(USER_ID, await hotpCode(secret, CURRENT), AT);
    const later = AT + PERIOD * 1000;
    const code = await hotpCode(secret, totpCounter(Math.floor(later / 1000), { period: PERIOD }));
    expect((await service.verifyChallenge(USER_ID, code, later)).ok).toBe(true);
  });

  // It rides the write that carries the replay guard, so the guard covers the re-seal for free.
  it("re-seals nothing on a replayed code, because the write it rides is the one the replay refuses", async () => {
    const spy = fakeFactors();
    const secret = await confirmed(spy);
    const service = build(spy, undefined, undefined, rotated);
    const code = await hotpCode(secret, CURRENT);
    expect((await service.verifyChallenge(USER_ID, code, AT)).ok).toBe(true);
    const resealedTo = bytesToHex(factor(spy).secret as Uint8Array<ArrayBuffer>);
    expect(await service.verifyChallenge(USER_ID, code, AT)).toEqual({ ok: false, error: "consumed" });
    expect(bytesToHex(factor(spy).secret as Uint8Array<ArrayBuffer>)).toBe(resealedTo);
  });

  it("counts the rows a retiring key still holds, and stops counting the one it just re-sealed", async () => {
    const spy = fakeFactors();
    const secret = await confirmed(spy);
    expect(await spy.store.countSecretsNotUnder("totp-app", rotated.activeKeyId)).toEqual({ ok: true, data: 1 });
    await build(spy, undefined, undefined, rotated).verifyChallenge(USER_ID, await hotpCode(secret, CURRENT), AT);
    expect(await spy.store.countSecretsNotUnder("totp-app", rotated.activeKeyId)).toEqual({ ok: true, data: 0 });
  });
});

// The lockout this closes: left confirmed, the row resolves `step-up-required` forever, and every
// page that could remove it sits behind the step-up its own secret can no longer answer.
describe("createTotpAppFactor — a secret that will never open again", () => {
  /** A confirmed row whose sealed secret was replaced by bytes the ring cannot open. */
  async function stranded(spy: StoreSpy): Promise<void> {
    await confirmed(spy);
    spy.rows[0] = { ...(spy.rows[0] as AuthFactor), secret: new Uint8Array([1, 2, 3]) as Uint8Array<ArrayBuffer> };
  }

  it("takes the row back to owing an enrolment, which is what routes the visitor to a page that works", async () => {
    const spy = fakeFactors();
    await stranded(spy);
    await build(spy).verifyChallenge(USER_ID, "000000", AT);
    expect(factor(spy).confirmedAt).toBeNull();
  });

  it("refuses as `not-enrolled` rather than `unavailable`, so nothing tells the visitor the servers are down", async () => {
    const spy = fakeFactors();
    await stranded(spy);
    expect(await build(spy).verifyChallenge(USER_ID, "000000", AT)).toEqual({ ok: false, error: "not-enrolled" });
  });

  it("hands the guess back, since the code was never checked against anything", async () => {
    const spy = fakeFactors();
    await stranded(spy);
    await build(spy, 2).verifyChallenge(USER_ID, "000000", AT);
    expect(spy.spent.get(factor(spy).id)).toBe(0);
  });

  // One presentation ends it, which is what bounds the spend: from here the row is unenrolled, so
  // no later code is ever checked against a secret that cannot open.
  it("unenrols on the first code presented, rather than on the one that exhausts the budget", async () => {
    const spy = fakeFactors();
    await stranded(spy);
    await build(spy, 2).verifyChallenge(USER_ID, "000000", AT);
    expect(factor(spy).confirmedAt).toBeNull();
    expect(spy.spent.get(factor(spy).id)).toBe(0);
  });

  it("lets `beginEnrolment` re-enrol them on the very next request, on a fresh secret", async () => {
    const spy = fakeFactors();
    await stranded(spy);
    await build(spy).verifyChallenge(USER_ID, "000000", AT);
    const begun = await build(spy).beginEnrolment(USER_ID, AT);
    expect(begun.ok).toBe(true);
    expect(spy.removals).toHaveLength(1);
    expect(factor(spy).confirmedAt).toBeNull();
  });

  // The bytes are left in the row rather than dropped, so this is recovery and not just a reset.
  it("re-offers the secret their app already holds when the key is restored before they re-enrol", async () => {
    const spy = fakeFactors();
    const secret = await confirmed(spy);
    const held = spy.rows[0] as AuthFactor;
    spy.rows[0] = { ...held, secret: new Uint8Array([1, 2, 3]) as Uint8Array<ArrayBuffer> };
    await build(spy).verifyChallenge(USER_ID, "000000", AT);
    spy.rows[0] = { ...(spy.rows[0] as AuthFactor), secret: held.secret };
    const begun = await build(spy).beginEnrolment(USER_ID, AT);
    expect(begun.ok && base32Decode((begun.data.options as { secret: string }).secret)).toEqual(secret);
    expect(spy.removals).toHaveLength(0);
  });

  it("still reports a store outage on the write that unenrols as `unavailable`", async () => {
    const spy = fakeFactors();
    await stranded(spy);
    spy.store.unconfirm = () => Promise.resolve(err(new AuthStoreError("unavailable", "factors.unconfirm")));
    expect(await build(spy).verifyChallenge(USER_ID, "000000", AT)).toEqual({ ok: false, error: "unavailable" });
  });
});

// A key dropped from the ring before `authKeysRetirable` said so is an operator's mistake and an
// undoing one, where clearing `confirmed_at` on it is neither: re-adding the key restores nothing.
describe("createTotpAppFactor — a sealing key merely absent from the ring", () => {
  /** A ring holding a different root entirely, so nothing sealed under `ring` resolves a key here. */
  let strangers: AuthKeyRing;

  beforeAll(async () => {
    strangers = await importAuthKeyRing([ROOT_NEW]);
  });

  it("leaves the factor confirmed, and answers the server-side reason rather than `not-enrolled`", async () => {
    const spy = fakeFactors();
    await confirmed(spy);

    const refused = await build(spy, undefined, undefined, strangers).verifyChallenge(USER_ID, "000000", AT);

    expect({ refused, confirmed: factor(spy).confirmedAt !== null }).toEqual({ refused: { ok: false, error: "unavailable" }, confirmed: true });
  });

  it("keeps the sealed bytes on `beginEnrolment` too, which would otherwise destroy what the key still opens", async () => {
    const spy = fakeFactors();
    await enrolled(spy);
    const held = factor(spy).secret;

    const begun = await build(spy, undefined, undefined, strangers).beginEnrolment(USER_ID, AT);

    expect({ begun, removals: spy.removals.length, secret: factor(spy).secret }).toEqual({
      begun: { ok: false, error: "unavailable" },
      removals: 0,
      secret: held,
    });
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

  it("accepts both ends of the secret range themselves", () => {
    expect(factory({ secretBytes: 16 })).not.toThrow();
    expect(factory({ secretBytes: 64 })).not.toThrow();
  });

  it("refuses a secret past the 64-byte ceiling, which HMAC would hash back down anyway", () => {
    expect(factory({ secretBytes: 65 })).toThrow(
      "createTotpAppFactor: secretBytes is 65, above the 64-byte ceiling — HMAC hashes a longer key down to its block size, so the extra bytes carry no entropy.",
    );
    expect(factory({ secretBytes: 4096 })).toThrow("above the 64-byte ceiling");
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

  it("refuses a lockout window shorter than a minute, and one past a day", () => {
    expect(factory({ lockoutMs: 59_999 })).toThrow(
      "createTotpAppFactor: lockoutMs is 59999, below the 60000-millisecond floor — a shorter window hands the spent budget back before an attacker has to slow down.",
    );
    expect(factory({ lockoutMs: 86_400_001 })).toThrow(
      "createTotpAppFactor: lockoutMs is 86400001, above the 86400000-millisecond ceiling — a window past a day is the permanent lock this exists to prevent.",
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
  // is what `recordVerification` reporting rows-affected buys over a read-then-write.
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

// A code comparison that `===` would satisfy too cannot be witnessed by accept/reject alone. The
// probe installs a real constant-time primitive after enrolment, so only the verify is counted.
describe("createTotpAppFactor — the code comparison is constant-time", () => {
  let handle: TimingProbeHandle | null = null;

  afterEach(() => {
    handle?.restore();
    handle = null;
  });

  it("asks the constant-time primitive once per drift step, and is told no by every one", async () => {
    const spy = fakeFactors();
    const secret = await confirmed(spy);
    const wrong = await wrongCode(secret);
    handle = installTimingProbe();
    const outcome = await build(spy).verifyChallenge(USER_ID, wrong, AT);
    expect({ compared: handle.probe.compared, outcome }).toEqual({
      compared: [false, false, false],
      outcome: { ok: false, error: "unrecognised" },
    });
  });

  it("stops at the step it is told yes by, so the current code is answered by the primitive", async () => {
    const spy = fakeFactors();
    const secret = await confirmed(spy);
    const code = await hotpCode(secret, CURRENT);
    handle = installTimingProbe();
    const outcome = await build(spy).verifyChallenge(USER_ID, code, AT);
    expect({ compared: handle.probe.compared, accepted: outcome.ok }).toEqual({ compared: [false, true], accepted: true });
  });
});
