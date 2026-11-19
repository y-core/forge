import { afterEach, beforeAll, describe, expect, it } from "bun:test";

import type { KeyRing } from "../../crypto/keyring/types";
import { base64urlEncode, bytesToHex, base32Decode, hotpCode, totpCounter } from "../../crypto/primitives/mod";
import { err, ok } from "../../result/result";
import { uuidv7 } from "../../storage/db/uuid";
import { AuthStoreError } from "../errors";
import { importAuthKeyRing } from "../keys/ring";
import type { AuthChallenge, AuthFactor, AuthFactorInput, ChallengeStore, FactorStore } from "../types";
import { fakeFactorCaller, installTimingProbe } from "./factors.fixture";
import { createFactorRegistry } from "./registry";
import { createTotpAppFactor } from "./totp-app";
import type { AuthSecondFactorRequirement, ImplicitFactorService, RecoveryCodeFactorService, TimingProbeHandle } from "./types";

const USER_ID = uuidv7();
const PERIOD = 30;
const AT = 1_700_000_010_000;
const CURRENT = totpCounter(Math.floor(AT / 1000), { period: PERIOD });

const ROOT_OLD = "2c83943e16eb5c3741d74260b4751de91afeab397689cfd139f7263b21aec037";
const ROOT_NEW = "9d1f4b6a0c27e8531fa4d90b6e2c7148ab35f0d962741ec8530b9af62d418c75";

let ring: KeyRing;
/** The same key demoted behind a newer one, so anything sealed under `ring` opens here as stale. */
let rotated: KeyRing;

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
  origins: [string, Uint8Array | null][];
  challenges: ChallengeStore;
  /** What the challenge store holds, by key — a take removes the entry, as the D1 adapter's does. */
  pending: Map<string, AuthChallenge>;
}

function fakeFactors(seed: AuthFactor | null = null): StoreSpy {
  const rows: AuthFactor[] = seed ? [seed] : [];
  const advances: { id: string; counter: number; resealed: boolean }[] = [];
  const removals: string[] = [];
  const origins: [string, Uint8Array | null][] = [];
  const spent = new Map<string, number>();
  const lastSpentAt = new Map<string, number>();
  const pending = new Map<string, AuthChallenge>();
  const challenges: ChallengeStore = {
    put: (key, challenge) => Promise.resolve(ok(void pending.set(key, challenge))),
    take: (key) => {
      const taken = pending.get(key) ?? null;
      pending.delete(key);
      return Promise.resolve(ok(taken));
    },
  };

  const store: FactorStore = {
    listByUser: (userId) => Promise.resolve(ok(rows.filter((row) => row.userId === userId))),
    find: (userId, kind) => Promise.resolve(ok(rows.find((row) => row.userId === userId && row.kind === kind) ?? null)),
    listConfirmedKinds: (userId, kinds) =>
      Promise.resolve(
        ok(rows.filter((row) => row.userId === userId && kinds.includes(row.kind) && row.confirmedAt !== null).map((row) => row.kind)),
      ),
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
    confirm: (id, _userId, at, origin) => {
      origins.push(["confirm", origin.keep]);
      const index = rows.findIndex((row) => row.id === id);
      const row = rows[index];
      if (index < 0 || !row) return Promise.resolve(ok(false));
      rows[index] = { ...row, confirmedAt: at, updatedAt: at };
      return Promise.resolve(ok(true));
    },
    // The adapter's conditional advance: a replay, or a code from a replaced secret, writes nothing.
    // The frame is compared as hex so the timing probe sees only the factor's own comparisons.
    recordVerification: (id, _userId, counter, at, frame, resealed) => {
      advances.push({ id, counter, resealed: resealed !== undefined });
      const index = rows.findIndex((row) => row.id === id);
      const row = rows[index];
      if (index < 0 || !row || row.secret === null || bytesToHex(row.secret) !== bytesToHex(frame)) return Promise.resolve(ok(false));
      if (row.lastCounter !== null && row.lastCounter >= counter) return Promise.resolve(ok(false));
      rows[index] = { ...row, lastCounter: counter, lastVerifiedAt: at, updatedAt: at, ...(resealed === undefined ? {} : { secret: resealed }) };
      spent.set(id, 0);
      return Promise.resolve(ok(true));
    },
    replaceSecret: (id, userId, secret, counter, at, origin) => {
      origins.push(["replace", origin.keep]);
      const index = rows.findIndex((row) => row.id === id && row.userId === userId && row.kind === "totp-app" && row.confirmedAt !== null);
      const row = rows[index];
      if (index < 0 || !row) return Promise.resolve(ok(false));
      rows[index] = { ...row, secret, lastCounter: counter, lastVerifiedAt: at, updatedAt: at };
      spent.set(id, 0);
      return Promise.resolve(ok(true));
    },
    countSecretsNotUnder: (kind, kid) =>
      Promise.resolve(
        ok(rows.filter((row) => row.kind === kind && row.secret !== null && base64urlEncode(row.secret.subarray(0, 6)) !== kid).length),
      ),
    remove: (id, _userId, _at, origin) => {
      removals.push(id);
      origins.push(["remove", origin.keep]);
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) return Promise.resolve(ok("not-found" as const));
      rows.splice(index, 1);
      return Promise.resolve(ok("changed" as const));
    },
  };
  return { store, rows, advances, removals, spent, origins, challenges, pending };
}

const refuse = () => Promise.resolve(err("unavailable" as const));

const EMAIL_OTP: ImplicitFactorService<"email-otp"> = {
  kind: "email-otp",
  enrolment: "implicit",
  capabilities: { stepUp: true },
  challengeTtlMs: 600_000,
  codeDigits: 6,
  codePeriodSeconds: null,
  reissueAfterMs: null,
  createChallenge: refuse,
  verifyChallenge: refuse,
  listEnrolments: () => Promise.resolve(ok([])),
};

const RECOVERY_CODE: RecoveryCodeFactorService = {
  ...EMAIL_OTP,
  kind: "recovery-code",
  enrolment: "explicit",
  codeDigits: null,
  beginEnrolment: refuse,
  completeEnrolment: refuse,
  remaining: () => Promise.resolve(ok(0)),
};

function resolveOver(spy: StoreSpy, requirement: AuthSecondFactorRequirement) {
  return createFactorRegistry(spy.store, {
    primary: EMAIL_OTP,
    second: { offered: [{ service: build(spy), requirement }], recovery: RECOVERY_CODE },
  }).resolve(USER_ID);
}

function factor(spy: StoreSpy): AuthFactor {
  const row = spy.rows[0];
  if (!row) throw new Error("no factor row");
  return row;
}

function build(spy: StoreSpy, maxAttempts?: number, lockoutMs?: number, keys: KeyRing = ring) {
  return createTotpAppFactor({
    keys,
    factors: spy.store,
    challenges: spy.challenges,
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

async function enrolled(spy: StoreSpy, at: number = AT): Promise<Uint8Array<ArrayBuffer>> {
  const service = build(spy);
  const begun = await service.beginEnrolment(USER_ID, at);
  if (!begun.ok) throw new Error(`enrolment refused: ${begun.error}`);
  return base32Decode((begun.data.options as { secret: string }).secret);
}

/** Enrols, confirms, then clears the counter the confirming code advanced, so each test sets its own start. */
async function confirmed(spy: StoreSpy): Promise<Uint8Array<ArrayBuffer>> {
  const secret = await enrolled(spy);
  const completed = await build(spy).completeEnrolment(USER_ID, await hotpCode(secret, CURRENT), AT, fakeFactorCaller());
  if (!completed.ok) throw new Error(`confirmation refused: ${completed.error}`);
  spy.rows[0] = { ...factor(spy), lastCounter: null };
  return secret;
}

describe("createTotpAppFactor — the session an enrolment change names", () => {
  it("hands the store the acting session's hash on the confirming write, and none on dropping an unfinished row", async () => {
    const keep = new Uint8Array(32).fill(5);
    const spy = fakeFactors({
      id: uuidv7(),
      userId: USER_ID,
      kind: "totp-app",
      secret: null,
      lastCounter: null,
      failedAttempts: 0,
      lastVerifiedAt: null,
      confirmedAt: null,
      createdAt: 1,
      updatedAt: 1,
    });
    const secret = await enrolled(spy);
    await build(spy).completeEnrolment(USER_ID, await hotpCode(secret, CURRENT), AT, fakeFactorCaller("browser-a", keep));
    expect(spy.origins).toEqual([
      ["remove", null],
      ["confirm", keep],
    ]);
  });
});

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
    expect(await build(spy).createChallenge(USER_ID, AT, fakeFactorCaller())).toEqual({ ok: false, error: "not-enrolled" });
    expect(await build(spy).verifyChallenge(USER_ID, await hotpCode(secret, CURRENT), AT, fakeFactorCaller())).toEqual({
      ok: false,
      error: "not-enrolled",
    });

    const completed = await build(spy).completeEnrolment(USER_ID, await hotpCode(secret, CURRENT), AT, fakeFactorCaller());
    expect(completed.ok && completed.data.confirmedAt).toBe(AT);
    expect(factor(spy).confirmedAt).toBe(AT);
  });

  it("refuses a wrong code at completion, leaving the row unconfirmed", async () => {
    const spy = fakeFactors();
    await enrolled(spy);
    expect(await build(spy).completeEnrolment(USER_ID, "000000", AT, fakeFactorCaller())).toEqual({ ok: false, error: "unrecognised" });
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

  it("re-offers the unconfirmed row's secret up to a moment before 15 minutes from its creation", async () => {
    const spy = fakeFactors();
    const first = await enrolled(spy);
    const second = await enrolled(spy, AT + 15 * 60_000 - 1);
    expect({ same: bytesToHex(second) === bytesToHex(first), removals: spy.removals.length, rows: spy.rows.length }).toEqual({
      same: true,
      removals: 0,
      rows: 1,
    });
  });

  it("replaces an unconfirmed row 15 minutes old with a new secret, so whoever began that enrolment does not know the one confirmed", async () => {
    const spy = fakeFactors();
    const first = await enrolled(spy);
    const second = await enrolled(spy, AT + 15 * 60_000);
    expect({ same: bytesToHex(second) === bytesToHex(first), removals: spy.removals.length, rows: spy.rows.length }).toEqual({
      same: false,
      removals: 1,
      rows: 1,
    });
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
    await build(spy).completeEnrolment(USER_ID, await hotpCode(secret, CURRENT), AT, fakeFactorCaller());
    expect(await build(spy).beginEnrolment(USER_ID, AT)).toEqual({ ok: false, error: "already-enrolled" });
  });
});

describe("createTotpAppFactor — the attempt ceiling", () => {
  it("spends a guess on every wrong code, and refuses the correct one once the budget is gone", async () => {
    const spy = fakeFactors();
    const secret = await confirmed(spy);
    const service = build(spy, 2);
    const wrong = await wrongCode(secret);

    expect(await service.verifyChallenge(USER_ID, wrong, AT, fakeFactorCaller())).toEqual({ ok: false, error: "unrecognised" });
    expect(await service.verifyChallenge(USER_ID, wrong, AT, fakeFactorCaller())).toEqual({ ok: false, error: "unrecognised" });
    // The third never reaches the comparison at all, which is why the *correct* code is refused too.
    expect(await service.verifyChallenge(USER_ID, await hotpCode(secret, CURRENT), AT, fakeFactorCaller())).toEqual({
      ok: false,
      error: "too-many-attempts",
    });
  });

  it("clears the spent guesses on an accepted code, so a mistyped digit is not cumulative", async () => {
    const spy = fakeFactors();
    const secret = await confirmed(spy);
    const service = build(spy, 2);

    await service.verifyChallenge(USER_ID, await wrongCode(secret), AT, fakeFactorCaller());
    expect((await service.verifyChallenge(USER_ID, await hotpCode(secret, CURRENT), AT, fakeFactorCaller())).ok).toBe(true);
    expect(spy.spent.get(factor(spy).id)).toBe(0);
  });

  // The lock is a window and not a state: past it the next guess reopens the budget, so a user who
  // mistyped five times is slowed down rather than locked out of their own account for good.
  it("lets the lockout expire, so a correct code after the window succeeds", async () => {
    const spy = fakeFactors();
    const secret = await confirmed(spy);
    const service = build(spy, 2, 60_000);
    const wrong = await wrongCode(secret);

    await service.verifyChallenge(USER_ID, wrong, AT, fakeFactorCaller());
    await service.verifyChallenge(USER_ID, wrong, AT + 1, fakeFactorCaller());
    expect(await service.verifyChallenge(USER_ID, await hotpCode(secret, CURRENT), AT + 59_000, fakeFactorCaller())).toEqual({
      ok: false,
      error: "too-many-attempts",
    });
    const later = AT + 61_001;
    const code = await hotpCode(secret, totpCounter(Math.floor(later / 1000), { period: PERIOD }));
    expect((await service.verifyChallenge(USER_ID, code, later, fakeFactorCaller())).ok).toBe(true);
  });

  it("holds the ceiling against the enrolment ceremony too, since that is a code the same secret answers", async () => {
    const spy = fakeFactors();
    const secret = await enrolled(spy);
    const service = build(spy, 1);

    expect(await service.completeEnrolment(USER_ID, await wrongCode(secret), AT, fakeFactorCaller())).toEqual({ ok: false, error: "unrecognised" });
    expect(await service.completeEnrolment(USER_ID, await hotpCode(secret, CURRENT), AT, fakeFactorCaller())).toEqual({
      ok: false,
      error: "too-many-attempts",
    });
    expect(factor(spy).confirmedAt).toBeNull();
  });
});

// Together these turn "never safe to drop a `totpWrap` secret" into a condition a deployment can
// test: the population under a retired key shrinks on its own, and reaching zero is observable.
describe("createTotpAppFactor — the row a guess is spent on", () => {
  function spendLandsOnAnotherRow(spy: StoreSpy): void {
    spy.store.countAttempt = () => Promise.resolve(ok({ ...factor(spy), id: uuidv7() }));
  }

  it("answers `unavailable` to a step-up, comparing nothing and advancing no counter", async () => {
    const spy = fakeFactors();
    const secret = await confirmed(spy);
    const advancedBefore = spy.advances.length;
    spendLandsOnAnotherRow(spy);
    const outcome = await build(spy).verifyChallenge(USER_ID, await hotpCode(secret, CURRENT), AT, fakeFactorCaller());
    expect({ outcome, advanced: spy.advances.length - advancedBefore }).toEqual({ outcome: { ok: false, error: "unavailable" }, advanced: 0 });
  });

  it("answers `unavailable` to a confirming code, leaving the row unconfirmed", async () => {
    const spy = fakeFactors();
    const secret = await enrolled(spy);
    spendLandsOnAnotherRow(spy);
    const outcome = await build(spy).completeEnrolment(USER_ID, await hotpCode(secret, CURRENT), AT, fakeFactorCaller());
    expect({ outcome, confirmed: factor(spy).confirmedAt }).toEqual({ outcome: { ok: false, error: "unavailable" }, confirmed: null });
  });
});

describe("createTotpAppFactor — re-sealing a secret under the ring's active key", () => {
  /** The key id the row's sealed secret currently names. */
  function sealedUnder(spy: StoreSpy): string {
    return base64urlEncode((factor(spy).secret as Uint8Array<ArrayBuffer>).subarray(0, 6));
  }

  it("re-seals on an accepted code whose frame is under a retired key", async () => {
    const spy = fakeFactors();
    const secret = await confirmed(spy);
    expect(sealedUnder(spy)).toBe(ring.activeKeyId);
    expect(
      (await build(spy, undefined, undefined, rotated).verifyChallenge(USER_ID, await hotpCode(secret, CURRENT), AT, fakeFactorCaller())).ok,
    ).toBe(true);
    expect(sealedUnder(spy)).toBe(rotated.activeKeyId);
    expect(spy.advances.at(-1)?.resealed).toBe(true);
  });

  it("leaves a frame already under the active key alone, so a verification spends no `totpWrap` nonce", async () => {
    const spy = fakeFactors();
    const secret = await confirmed(spy);
    const before = bytesToHex(factor(spy).secret as Uint8Array<ArrayBuffer>);
    expect((await build(spy).verifyChallenge(USER_ID, await hotpCode(secret, CURRENT), AT, fakeFactorCaller())).ok).toBe(true);
    expect(bytesToHex(factor(spy).secret as Uint8Array<ArrayBuffer>)).toBe(before);
    expect(spy.advances.at(-1)?.resealed).toBe(false);
  });

  it("re-seals to a secret that still opens, and still answers the same codes", async () => {
    const spy = fakeFactors();
    const secret = await confirmed(spy);
    const service = build(spy, undefined, undefined, rotated);
    await service.verifyChallenge(USER_ID, await hotpCode(secret, CURRENT), AT, fakeFactorCaller());
    const later = AT + PERIOD * 1000;
    const code = await hotpCode(secret, totpCounter(Math.floor(later / 1000), { period: PERIOD }));
    expect((await service.verifyChallenge(USER_ID, code, later, fakeFactorCaller())).ok).toBe(true);
  });

  // It rides the write that carries the replay guard, so the guard covers the re-seal for free.
  it("re-seals nothing on a replayed code, because the write it rides is the one the replay refuses", async () => {
    const spy = fakeFactors();
    const secret = await confirmed(spy);
    const service = build(spy, undefined, undefined, rotated);
    const code = await hotpCode(secret, CURRENT);
    expect((await service.verifyChallenge(USER_ID, code, AT, fakeFactorCaller())).ok).toBe(true);
    const resealedTo = bytesToHex(factor(spy).secret as Uint8Array<ArrayBuffer>);
    expect(await service.verifyChallenge(USER_ID, code, AT, fakeFactorCaller())).toEqual({ ok: false, error: "consumed" });
    expect(bytesToHex(factor(spy).secret as Uint8Array<ArrayBuffer>)).toBe(resealedTo);
  });

  it("counts the rows a retiring key still holds, and stops counting the one it just re-sealed", async () => {
    const spy = fakeFactors();
    const secret = await confirmed(spy);
    expect(await spy.store.countSecretsNotUnder("totp-app", rotated.activeKeyId)).toEqual({ ok: true, data: 1 });
    await build(spy, undefined, undefined, rotated).verifyChallenge(USER_ID, await hotpCode(secret, CURRENT), AT, fakeFactorCaller());
    expect(await spy.store.countSecretsNotUnder("totp-app", rotated.activeKeyId)).toEqual({ ok: true, data: 0 });
  });
});

describe("createTotpAppFactor — a secret that will never open again", () => {
  /** A confirmed row whose sealed secret was replaced by bytes the ring cannot open. */
  async function stranded(spy: StoreSpy): Promise<void> {
    await confirmed(spy);
    spy.rows[0] = { ...factor(spy), secret: new Uint8Array([1, 2, 3]) as Uint8Array<ArrayBuffer> };
  }

  it("answers `unusable` and leaves the row confirmed with its bytes intact", async () => {
    const spy = fakeFactors();
    await stranded(spy);
    const refused = await build(spy).verifyChallenge(USER_ID, "000000", AT, fakeFactorCaller());
    expect({ refused, confirmed: factor(spy).confirmedAt !== null, secret: factor(spy).secret }).toEqual({
      refused: { ok: false, error: "unusable" },
      confirmed: true,
      secret: new Uint8Array([1, 2, 3]) as Uint8Array<ArrayBuffer>,
    });
  });

  it("spends no guess, since the code was never checked against anything", async () => {
    const spy = fakeFactors();
    await stranded(spy);
    await build(spy, 2).verifyChallenge(USER_ID, "000000", AT, fakeFactorCaller());
    expect(spy.spent.get(factor(spy).id) ?? 0).toBe(0);
  });

  it("verifies the same row again once the sealed bytes are restored", async () => {
    const spy = fakeFactors();
    const held = await confirmed(spy);
    const sealed = factor(spy).secret;
    spy.rows[0] = { ...factor(spy), secret: new Uint8Array([1, 2, 3]) as Uint8Array<ArrayBuffer> };
    await build(spy).verifyChallenge(USER_ID, "000000", AT, fakeFactorCaller());
    spy.rows[0] = { ...factor(spy), secret: sealed };
    expect(await build(spy).verifyChallenge(USER_ID, await hotpCode(held, CURRENT), AT, fakeFactorCaller())).toEqual({
      ok: true,
      data: { kind: "totp-app", userId: USER_ID, verifiedAt: AT },
    });
  });

  it("answers `already-enrolled` to `beginEnrolment` on the confirmed row, removing nothing", async () => {
    const spy = fakeFactors();
    await stranded(spy);
    expect({ begun: await build(spy).beginEnrolment(USER_ID, AT), removals: spy.removals.length }).toEqual({
      begun: { ok: false, error: "already-enrolled" },
      removals: 0,
    });
  });

  it("keeps demanding a step-up, and never answers `satisfied`, however often the unusable code is presented", async () => {
    const outcomes: Record<string, unknown> = {};
    for (const requirement of ["optional", "mandatory"] as const) {
      const spy = fakeFactors();
      await stranded(spy);
      for (let presented = 0; presented < 3; presented++)
        await build(spy, 2).verifyChallenge(USER_ID, "000000", AT + presented, fakeFactorCaller());
      outcomes[requirement] = await resolveOver(spy, requirement);
    }
    expect(outcomes).toEqual({
      optional: { ok: true, data: { status: "step-up-required", kinds: ["totp-app"] } },
      mandatory: { ok: true, data: { status: "step-up-required", kinds: ["totp-app"] } },
    });
  });

  it("replaces an unconfirmed row whose secret will not open with a fresh enrolment", async () => {
    const spy = fakeFactors();
    await enrolled(spy);
    spy.rows[0] = { ...factor(spy), secret: new Uint8Array([1, 2, 3]) as Uint8Array<ArrayBuffer> };
    const begun = await build(spy).beginEnrolment(USER_ID, AT);
    expect({ ok: begun.ok, removals: spy.removals.length, confirmed: factor(spy).confirmedAt }).toEqual({ ok: true, removals: 1, confirmed: null });
  });
});

describe("createTotpAppFactor — a sealing key merely absent from the ring", () => {
  /** A ring holding a different root entirely, so nothing sealed under `ring` resolves a key here. */
  let strangers: KeyRing;

  beforeAll(async () => {
    strangers = await importAuthKeyRing([ROOT_NEW]);
  });

  it("leaves the factor confirmed and answers `unusable`, spending no guess", async () => {
    const spy = fakeFactors();
    await confirmed(spy);

    const refused = await build(spy, undefined, undefined, strangers).verifyChallenge(USER_ID, "000000", AT, fakeFactorCaller());

    expect({ refused, confirmed: factor(spy).confirmedAt !== null, spent: spy.spent.get(factor(spy).id) ?? 0 }).toEqual({
      refused: { ok: false, error: "unusable" },
      confirmed: true,
      spent: 0,
    });
  });

  it("still resolves `step-up-required`, since the row it could not open stays confirmed", async () => {
    const spy = fakeFactors();
    await confirmed(spy);
    await build(spy, undefined, undefined, strangers).verifyChallenge(USER_ID, "000000", AT, fakeFactorCaller());
    expect(await resolveOver(spy, "optional")).toEqual({ ok: true, data: { status: "step-up-required", kinds: ["totp-app"] } });
  });

  it("verifies the same row again once the key is back on the ring", async () => {
    const spy = fakeFactors();
    const secret = await confirmed(spy);
    await build(spy, undefined, undefined, strangers).verifyChallenge(USER_ID, "000000", AT, fakeFactorCaller());
    expect(await build(spy).verifyChallenge(USER_ID, await hotpCode(secret, CURRENT), AT, fakeFactorCaller())).toEqual({
      ok: true,
      data: { kind: "totp-app", userId: USER_ID, verifiedAt: AT },
    });
  });

  it("replaces an unconfirmed row on `beginEnrolment`, since its ceremony was never finished", async () => {
    const spy = fakeFactors();
    await enrolled(spy);

    const begun = await build(spy, undefined, undefined, strangers).beginEnrolment(USER_ID, AT);

    expect({ ok: begun.ok, removals: spy.removals.length }).toEqual({ ok: true, removals: 1 });
  });
});

describe("createTotpAppFactor — the ranges it holds at construction", () => {
  function factory(overrides: Partial<Parameters<typeof createTotpAppFactor>[0]>) {
    return () =>
      createTotpAppFactor({
        keys: ring,
        factors: fakeFactors().store,
        challenges: fakeFactors().challenges,
        issuer: "Forge Demo",
        account: () => "person@example.com",
        ...overrides,
      });
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
      const outcome = await build(spy).verifyChallenge(USER_ID, await hotpCode(secret, CURRENT + step), AT, fakeFactorCaller());
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
    expect((await build(spy).verifyChallenge(USER_ID, code, AT, fakeFactorCaller())).ok).toBe(true);
    expect(await build(spy).verifyChallenge(USER_ID, code, AT, fakeFactorCaller())).toEqual({ ok: false, error: "consumed" });
    expect(factor(spy).lastCounter).toBe(CURRENT);
  });

  it("refuses the previous step's code once the current one has been accepted", async () => {
    const spy = fakeFactors();
    const secret = await confirmed(spy);
    await build(spy).verifyChallenge(USER_ID, await hotpCode(secret, CURRENT), AT, fakeFactorCaller());
    expect(await build(spy).verifyChallenge(USER_ID, await hotpCode(secret, CURRENT - 1), AT, fakeFactorCaller())).toEqual({
      ok: false,
      error: "consumed",
    });
  });

  it("refuses the confirming code itself as a step-up, because confirmation already spent that step", async () => {
    const spy = fakeFactors();
    const secret = await enrolled(spy);
    const code = await hotpCode(secret, CURRENT);
    expect((await build(spy).completeEnrolment(USER_ID, code, AT, fakeFactorCaller())).ok).toBe(true);
    expect(await build(spy).verifyChallenge(USER_ID, code, AT, fakeFactorCaller())).toEqual({ ok: false, error: "consumed" });
  });
});

describe("createTotpAppFactor — the challenge and the enrolment list", () => {
  it("names the step boundary the code the user is about to read stops working at", async () => {
    const spy = fakeFactors();
    const secret = await enrolled(spy);
    await build(spy).completeEnrolment(USER_ID, await hotpCode(secret, CURRENT), AT, fakeFactorCaller());
    const challenge = await build(spy).createChallenge(USER_ID, AT, fakeFactorCaller());
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
    const service = createTotpAppFactor({
      keys: ring,
      factors: broken,
      challenges: failing.challenges,
      issuer: "Forge Demo",
      account: () => "person@example.com",
    });
    expect(await service.verifyChallenge(USER_ID, "000000", AT, fakeFactorCaller())).toEqual({ ok: false, error: "unavailable" });
    expect(await service.createChallenge(USER_ID, AT, fakeFactorCaller())).toEqual({ ok: false, error: "unavailable" });
  });

  it("reports `not-enrolled` for a user who has no row at all", async () => {
    const spy = fakeFactors();
    expect(await build(spy).verifyChallenge(USER_ID, "000000", AT, fakeFactorCaller())).toEqual({ ok: false, error: "not-enrolled" });
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
    const outcome = await build(spy).verifyChallenge(USER_ID, wrong, AT, fakeFactorCaller());
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
    const outcome = await build(spy).verifyChallenge(USER_ID, code, AT, fakeFactorCaller());
    expect({ compared: handle.probe.compared, accepted: outcome.ok }).toEqual({ compared: [false, true], accepted: true });
  });
});

describe("createTotpAppFactor — replacing a confirmed app", () => {
  const ACTING = new Uint8Array(32).fill(5);
  const ELSEWHERE = new Uint8Array(32).fill(6);
  const NEXT = AT + PERIOD * 1000;

  async function replacing(spy: StoreSpy, keep = ACTING, at = AT): Promise<Uint8Array<ArrayBuffer>> {
    const begun = await build(spy).beginReplacement(USER_ID, at, fakeFactorCaller("browser-a", keep));
    if (!begun.ok) throw new Error(`replacement refused: ${begun.error}`);
    return base32Decode((begun.data.options as { secret: string }).secret);
  }

  it("refuses to begin for a user with no row, or with only an unconfirmed one", async () => {
    const spy = fakeFactors();
    const begin = () => build(spy).beginReplacement(USER_ID, AT, fakeFactorCaller("browser-a", ACTING));
    const none = await begin();
    await enrolled(spy);
    expect([none, await begin(), spy.pending.size]).toEqual([{ ok: false, error: "not-enrolled" }, { ok: false, error: "not-enrolled" }, 0]);
  });

  it("resumes the same pending secret for the same session, and mints another for a different one", async () => {
    const spy = fakeFactors();
    const live = await confirmed(spy);
    const first = await replacing(spy);
    const again = await replacing(spy, ACTING, AT + 60_000);
    const elsewhere = await replacing(spy, ELSEWHERE);
    expect({ resumed: bytesToHex(again) === bytesToHex(first), elsewhere: bytesToHex(elsewhere) === bytesToHex(first) }).toEqual({
      resumed: true,
      elsewhere: false,
    });
    expect([bytesToHex(first), bytesToHex(elsewhere)]).not.toContain(bytesToHex(live));
  });

  it("leaves the live secret verifying until the replacement commits", async () => {
    const spy = fakeFactors();
    const live = await confirmed(spy);
    await replacing(spy);
    expect(await build(spy).verifyChallenge(USER_ID, await hotpCode(live, CURRENT), AT, fakeFactorCaller())).toMatchObject({ ok: true });
  });

  it("commits on a code from the new secret, after which the old one fails and the new one verifies", async () => {
    const spy = fakeFactors();
    const live = await confirmed(spy);
    const next = await replacing(spy);
    const replaced = await build(spy).completeReplacement(USER_ID, await hotpCode(next, CURRENT), AT, fakeFactorCaller("browser-a", ACTING));
    const caller = fakeFactorCaller();
    expect({
      replaced: replaced.ok && { lastCounter: replaced.data.lastCounter, lastVerifiedAt: replaced.data.lastVerifiedAt },
      origin: spy.origins.at(-1),
      held: spy.pending.size,
      old: await build(spy).verifyChallenge(USER_ID, await hotpCode(live, CURRENT + 1), NEXT, caller),
      fresh: (await build(spy).verifyChallenge(USER_ID, await hotpCode(next, CURRENT + 1), NEXT, caller)).ok,
    }).toEqual({
      replaced: { lastCounter: CURRENT, lastVerifiedAt: AT },
      origin: ["replace", ACTING],
      held: 0,
      old: { ok: false, error: "unrecognised" },
      fresh: true,
    });
  });

  it("drops the pending secret at `maxAttempts` wrong codes, and never spends the live row's budget", async () => {
    const spy = fakeFactors();
    await confirmed(spy);
    const next = await replacing(spy);
    const caller = fakeFactorCaller("browser-a", ACTING);
    const wrong = await wrongCode(next);
    const outcomes = [];
    for (let attempt = 0; attempt < 3; attempt++) outcomes.push(await build(spy, 3).completeReplacement(USER_ID, wrong, AT, caller));
    outcomes.push(await build(spy, 3).completeReplacement(USER_ID, await hotpCode(next, CURRENT), AT, caller));
    expect({ outcomes, spent: spy.spent.get(factor(spy).id) ?? 0, failedAttempts: factor(spy).failedAttempts }).toEqual({
      outcomes: [
        { ok: false, error: "unrecognised" },
        { ok: false, error: "unrecognised" },
        { ok: false, error: "too-many-attempts" },
        { ok: false, error: "expired" },
      ],
      spent: 0,
      failedAttempts: 0,
    });
  });

  it("refuses a pending secret past its lifetime, or one held for another user", async () => {
    const spy = fakeFactors();
    await confirmed(spy);
    const next = await replacing(spy);
    const later = AT + 15 * 60_000;
    const lapsed = await build(spy).completeReplacement(
      USER_ID,
      await hotpCode(next, totpCounter(Math.floor(later / 1000), { period: PERIOD })),
      later,
      fakeFactorCaller("browser-a", ACTING),
    );
    const foreign = await replacing(spy);
    const stranger = await build(spy).completeReplacement(uuidv7(), await hotpCode(foreign, CURRENT), AT, fakeFactorCaller("browser-a", ACTING));
    expect([lapsed, stranger]).toEqual([
      { ok: false, error: "expired" },
      { ok: false, error: "expired" },
    ]);
  });

  // The way back for a user whose ring lost the key their app was sealed under: the replacement reads the
  // live row's confirmation, never its secret, so a secret that will not open does not block it.
  it("replaces an app whose live secret no longer opens under the ring, after which the new one verifies", async () => {
    const spy = fakeFactors();
    const live = await confirmed(spy);
    const keyless = await importAuthKeyRing([ROOT_NEW]);
    const unopened = await build(spy, undefined, undefined, keyless).verifyChallenge(
      USER_ID,
      await hotpCode(live, CURRENT),
      AT,
      fakeFactorCaller(),
    );
    const begun = await build(spy, undefined, undefined, keyless).beginReplacement(USER_ID, AT, fakeFactorCaller("browser-a", ACTING));
    if (!begun.ok) throw new Error(`replacement refused: ${begun.error}`);
    const next = base32Decode((begun.data.options as { secret: string }).secret);
    const replaced = await build(spy, undefined, undefined, keyless).completeReplacement(
      USER_ID,
      await hotpCode(next, CURRENT),
      AT,
      fakeFactorCaller("browser-a", ACTING),
    );
    const fresh = await build(spy, undefined, undefined, keyless).verifyChallenge(
      USER_ID,
      await hotpCode(next, CURRENT + 1),
      NEXT,
      fakeFactorCaller(),
    );
    expect({ unopened, replaced: replaced.ok, fresh: fresh.ok }).toEqual({
      unopened: { ok: false, error: "unusable" },
      replaced: true,
      fresh: true,
    });
  });

  it("answers `not-enrolled` when the row was removed before the replacement committed", async () => {
    const spy = fakeFactors();
    await confirmed(spy);
    const next = await replacing(spy);
    spy.rows.splice(0, 1);
    expect(await build(spy).completeReplacement(USER_ID, await hotpCode(next, CURRENT), AT, fakeFactorCaller("browser-a", ACTING))).toEqual({
      ok: false,
      error: "not-enrolled",
    });
  });

  // The read a code is checked against and the write recording it are two statements, and a
  // replacement can land between them: the old code must then step nobody up.
  it("refuses a code from the old secret whose check raced the commit, as `consumed`", async () => {
    const spy = fakeFactors();
    const live = await confirmed(spy);
    const next = await replacing(spy);
    const racing: FactorStore = {
      ...spy.store,
      countAttempt: async (...args) => {
        const spent = await spy.store.countAttempt(...args);
        await build(spy).completeReplacement(USER_ID, await hotpCode(next, CURRENT - 1), AT, fakeFactorCaller("browser-a", ACTING));
        return spent;
      },
    };
    // Under a rotated ring the old frame opens stale, so an unguarded write would re-seal it back over the new one.
    const service = createTotpAppFactor({ keys: rotated, factors: racing, challenges: spy.challenges, issuer: "Forge Demo", account: () => "a" });
    const caller = fakeFactorCaller();
    expect({
      old: await service.verifyChallenge(USER_ID, await hotpCode(live, CURRENT), AT, caller),
      resealed: spy.advances.at(-1)?.resealed,
      fresh: (await build(spy).verifyChallenge(USER_ID, await hotpCode(next, CURRENT + 1), NEXT, caller)).ok,
    }).toEqual({ old: { ok: false, error: "consumed" }, resealed: true, fresh: true });
  });
});
