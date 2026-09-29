import { describe, expect, it } from "bun:test";

import { bytesToHex, sha256, uuidv7 } from "../../crypto/mod";
import { err, ok } from "../../result/result";
import { AUTH_RECOVERY_CODE_COUNT, AUTH_TOTP_LOCKOUT_MS } from "../config";
import { AuthStoreError } from "../errors";
import type { AuthFactor, AuthFactorInput, FactorStore, RecoveryCodeStore } from "../types";
import { createRecoveryCodeFactor, normaliseRecoveryCode } from "./recovery-code";

const USER_ID = uuidv7();
const AT = 1_700_000_000_000;
const CODE_SHAPE = /^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){5}$/;

interface CodeRow {
  hash: string;
  staged: boolean;
  usedAt: number | null;
}

interface World {
  factors: FactorStore;
  codes: RecoveryCodeStore;
  rows: AuthFactor[];
  codeRows: CodeRow[];
  stagedHashes: Uint8Array[];
}

/** In-memory stores that decide as the SQL adapters do: attempts spent by `countAttempt`, cleared by `commit` and `consume`. */
function world(): World {
  const rows: AuthFactor[] = [];
  const codeRows: CodeRow[] = [];
  const stagedHashes: Uint8Array[] = [];
  const find = (kind: string) => rows.find((row) => row.userId === USER_ID && row.kind === kind) ?? null;
  const update = (id: string, patch: Partial<AuthFactor>) => {
    const index = rows.findIndex((row) => row.id === id);
    if (index >= 0) rows[index] = { ...(rows[index] as AuthFactor), ...patch };
  };

  const factors: FactorStore = {
    listByUser: async () => ok(rows),
    find: async (_userId, kind) => ok(find(kind)),
    findEnrolled: async (_userId, kinds) => ok(rows.filter((row) => kinds.includes(row.kind))),
    enrol: async (input: AuthFactorInput, at) => {
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
      return ok(row);
    },
    confirm: async () => ok(true),
    countAttempt: async (_userId, kind, maxAttempts, at, lockoutMs) => {
      const row = find(kind);
      if (!row) return ok(null);
      if (row.failedAttempts >= maxAttempts && row.updatedAt > at - lockoutMs) return ok(null);
      const failedAttempts = row.failedAttempts >= maxAttempts ? 1 : row.failedAttempts + 1;
      update(row.id, { failedAttempts, updatedAt: at });
      return ok({ ...row, failedAttempts, updatedAt: at });
    },
    recordVerification: async () => ok(true),
    countSecretsNotUnder: async () => ok(0),
    remove: async () => ok(true),
  };

  const codes: RecoveryCodeStore = {
    stage: async (_userId, hashes) => {
      for (let index = codeRows.length - 1; index >= 0; index--) if (codeRows[index]?.staged) codeRows.splice(index, 1);
      for (const hash of hashes) {
        stagedHashes.push(hash);
        codeRows.push({ hash: bytesToHex(hash), staged: true, usedAt: null });
      }
      return ok(undefined);
    },
    holdsStaged: async (_userId, hash) => ok(codeRows.some((row) => row.staged && row.hash === bytesToHex(hash))),
    commit: async (_userId, factorId, at) => {
      if (codeRows.some((row) => row.staged)) {
        for (let index = codeRows.length - 1; index >= 0; index--) if (!codeRows[index]?.staged) codeRows.splice(index, 1);
      }
      for (const row of codeRows) row.staged = false;
      const factor = rows.find((row) => row.id === factorId);
      update(factorId, { confirmedAt: factor?.confirmedAt ?? at, failedAttempts: 0, updatedAt: at });
      return ok(undefined);
    },
    consume: async (_userId, factorId, hash, at) => {
      const row = codeRows.find((held) => !held.staged && held.usedAt === null && held.hash === bytesToHex(hash));
      if (!row) return ok(false);
      row.usedAt = at;
      update(factorId, { failedAttempts: 0 });
      return ok(true);
    },
    remaining: async () => ok(codeRows.filter((row) => !row.staged && row.usedAt === null).length),
  };

  return { factors, codes, rows, codeRows, stagedHashes };
}

async function issued(held: World, at = AT): Promise<string[]> {
  const begun = await createRecoveryCodeFactor(held).beginEnrolment(USER_ID, at);
  if (!begun.ok) throw new Error(`beginEnrolment refused: ${begun.error}`);
  return (begun.data.options as { codes: string[] }).codes;
}

async function confirmedCodes(held: World): Promise<string[]> {
  const codes = await issued(held);
  const confirmed = await createRecoveryCodeFactor(held).completeEnrolment(USER_ID, codes[0] as string, AT);
  if (!confirmed.ok) throw new Error(`completeEnrolment refused: ${confirmed.error}`);
  return codes;
}

describe("createRecoveryCodeFactor — issuing a set", () => {
  it("issues the configured count of distinct 24-character codes in groups of four", async () => {
    const codes = await issued(world());
    expect(codes).toHaveLength(AUTH_RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(AUTH_RECOVERY_CODE_COUNT);
    expect(codes.filter((code) => !CODE_SHAPE.test(code))).toEqual([]);
  });

  it("hands the store only the SHA-256 of each code, never the code itself", async () => {
    const held = world();
    const codes = await issued(held);
    const expected = await Promise.all(codes.map(async (code) => bytesToHex(await sha256(code.replaceAll("-", "")))));
    expect(held.stagedHashes.map((hash) => bytesToHex(hash))).toEqual(expected);
    expect(held.codeRows.some((row) => codes.some((code) => row.hash.includes(code.replaceAll("-", ""))))).toBe(false);
  });

  it("leaves the row unconfirmed until one of the issued codes is typed back", async () => {
    const held = world();
    await issued(held);
    expect(held.rows.map((row) => row.confirmedAt)).toEqual([null]);
  });
});

describe("createRecoveryCodeFactor — confirming a set", () => {
  it("commits the staged set and confirms the row on a code from it", async () => {
    const held = world();
    await confirmedCodes(held);
    expect({ confirmed: held.rows[0]?.confirmedAt, remaining: await createRecoveryCodeFactor(held).remaining(USER_ID) }).toEqual({
      confirmed: AT,
      remaining: { ok: true, data: AUTH_RECOVERY_CODE_COUNT },
    });
  });

  it("refuses a code that is not in the staged set", async () => {
    const held = world();
    await issued(held);
    expect(await createRecoveryCodeFactor(held).completeEnrolment(USER_ID, "AAAA-AAAA-AAAA-AAAA-AAAA-AAAA", AT)).toEqual({
      ok: false,
      error: "unrecognised",
    });
  });

  it("keeps the live set usable after a regeneration until the new set is confirmed", async () => {
    const held = world();
    const live = await confirmedCodes(held);
    await issued(held, AT + 1);
    expect(await createRecoveryCodeFactor(held).verifyChallenge(USER_ID, live[1] as string, AT + 2)).toEqual({
      ok: true,
      data: { kind: "recovery-code", userId: USER_ID, verifiedAt: AT + 2 },
    });
  });

  it("retires the old set once the regenerated one is confirmed", async () => {
    const held = world();
    const live = await confirmedCodes(held);
    const fresh = await issued(held, AT + 1);
    await createRecoveryCodeFactor(held).completeEnrolment(USER_ID, fresh[0] as string, AT + 2);
    expect(await createRecoveryCodeFactor(held).verifyChallenge(USER_ID, live[1] as string, AT + 3)).toEqual({ ok: false, error: "unrecognised" });
  });
});

describe("createRecoveryCodeFactor — stepping up with a code", () => {
  it("accepts a live code once and refuses it the second time", async () => {
    const held = world();
    const codes = await confirmedCodes(held);
    const factor = createRecoveryCodeFactor(held);
    expect((await factor.verifyChallenge(USER_ID, codes[2] as string, AT + 1)).ok).toBe(true);
    expect(await factor.verifyChallenge(USER_ID, codes[2] as string, AT + 2)).toEqual({ ok: false, error: "unrecognised" });
  });

  it("accepts a code typed in lower case with spaces for separators", async () => {
    const held = world();
    const codes = await confirmedCodes(held);
    const typed = (codes[3] as string).toLowerCase().replaceAll("-", " ");
    expect((await createRecoveryCodeFactor(held).verifyChallenge(USER_ID, typed, AT + 1)).ok).toBe(true);
  });

  it("refuses a row nobody confirmed as `not-enrolled`", async () => {
    const held = world();
    const codes = await issued(held);
    expect(await createRecoveryCodeFactor(held).verifyChallenge(USER_ID, codes[0] as string, AT)).toEqual({ ok: false, error: "not-enrolled" });
  });

  it("spends a guess on malformed input, before it is ever compared", async () => {
    const held = world();
    await confirmedCodes(held);
    await createRecoveryCodeFactor(held).verifyChallenge(USER_ID, "not a code", AT + 1);
    expect(held.rows[0]?.failedAttempts).toBe(1);
  });

  it("never trips the lockout on successful uses, however many more there are than the budget", async () => {
    const held = world();
    const codes = await confirmedCodes(held);
    const factor = createRecoveryCodeFactor({ ...held, maxAttempts: 2 });
    const accepted = [];
    for (const code of codes.slice(1, 6)) accepted.push((await factor.verifyChallenge(USER_ID, code, AT + 1)).ok);
    expect({ accepted, failedAttempts: held.rows[0]?.failedAttempts }).toEqual({ accepted: [true, true, true, true, true], failedAttempts: 0 });
  });

  it("clears the guesses a mistyped code spent once a live code is accepted", async () => {
    const held = world();
    const codes = await confirmedCodes(held);
    const factor = createRecoveryCodeFactor({ ...held, maxAttempts: 2 });
    await factor.verifyChallenge(USER_ID, "wrong", AT + 1);
    await factor.verifyChallenge(USER_ID, codes[1] as string, AT + 2);
    await factor.verifyChallenge(USER_ID, "wrong", AT + 3);
    expect((await factor.verifyChallenge(USER_ID, codes[2] as string, AT + 4)).ok).toBe(true);
  });

  it("refuses even a live code once the budget is spent, and leaves that code unconsumed", async () => {
    const held = world();
    const codes = await confirmedCodes(held);
    const factor = createRecoveryCodeFactor({ ...held, maxAttempts: 2 });
    await factor.verifyChallenge(USER_ID, "wrong", AT + 1);
    await factor.verifyChallenge(USER_ID, "wrong", AT + 2);
    expect({ refused: await factor.verifyChallenge(USER_ID, codes[7] as string, AT + 3), remaining: await factor.remaining(USER_ID) }).toEqual({
      refused: { ok: false, error: "too-many-attempts" },
      remaining: { ok: true, data: AUTH_RECOVERY_CODE_COUNT },
    });
  });

  it("lets the lockout lapse after `lockoutMs`, so a live code is accepted again", async () => {
    const held = world();
    const codes = await confirmedCodes(held);
    const factor = createRecoveryCodeFactor({ ...held, maxAttempts: 1, lockoutMs: 60_000 });
    await factor.verifyChallenge(USER_ID, "wrong", AT + 1);
    const outcomes = [
      await factor.verifyChallenge(USER_ID, codes[1] as string, AT + 60_000),
      await factor.verifyChallenge(USER_ID, codes[1] as string, AT + 60_002),
    ];
    expect(outcomes).toEqual([
      { ok: false, error: "too-many-attempts" },
      { ok: true, data: { kind: "recovery-code", userId: USER_ID, verifiedAt: AT + 60_002 } },
    ]);
  });

  it("reports a store outage on the spend, the read after it or the consume as `unavailable`", async () => {
    const outage = () => Promise.resolve(err(new AuthStoreError("unavailable", "recoveryCodes")));
    const outcomes = [];
    for (const broken of ["countAttempt", "find", "consume"] as const) {
      const held = world();
      const codes = await confirmedCodes(held);
      if (broken === "consume") held.codes.consume = outage;
      else if (broken === "countAttempt") held.factors.countAttempt = outage;
      else {
        held.factors.countAttempt = () => Promise.resolve(ok(null));
        held.factors.find = outage;
      }
      outcomes.push(`${broken}: ${JSON.stringify(await createRecoveryCodeFactor(held).verifyChallenge(USER_ID, codes[1] as string, AT + 1))}`);
    }
    const unavailable = JSON.stringify({ ok: false, error: "unavailable" });
    expect(outcomes).toEqual([`countAttempt: ${unavailable}`, `find: ${unavailable}`, `consume: ${unavailable}`]);
  });

  it("answers `not-enrolled` when the user holds no recovery-code row at all", async () => {
    expect(await createRecoveryCodeFactor(world()).verifyChallenge(USER_ID, "AAAA-AAAA-AAAA-AAAA-AAAA-AAAA", AT)).toEqual({
      ok: false,
      error: "not-enrolled",
    });
  });
});

describe("createRecoveryCodeFactor — enrolment edges", () => {
  it("keeps one factor row across regenerations and never answers `already-enrolled` on a confirmed one", async () => {
    const held = world();
    await confirmedCodes(held);
    const regenerated = await createRecoveryCodeFactor(held).beginEnrolment(USER_ID, AT + 1);
    expect({ ok: regenerated.ok, rows: held.rows.length, confirmedAt: held.rows[0]?.confirmedAt }).toEqual({ ok: true, rows: 1, confirmedAt: AT });
  });

  it("treats a row a concurrent request enrolled first as present, and still stages a set", async () => {
    const held = world();
    held.factors.enrol = () => Promise.resolve(err(new AuthStoreError("conflict", "factors.enrol")));
    const begun = await createRecoveryCodeFactor(held).beginEnrolment(USER_ID, AT);
    expect({ ok: begun.ok, staged: held.codeRows.filter((row) => row.staged).length }).toEqual({ ok: true, staged: AUTH_RECOVERY_CODE_COUNT });
  });

  it("reports a store outage on the read, the enrol or the stage as `unavailable`", async () => {
    const outage = () => Promise.resolve(err(new AuthStoreError("unavailable", "recoveryCodes")));
    const outcomes = [];
    for (const broken of ["find", "enrol", "stage"] as const) {
      const held = world();
      if (broken === "stage") held.codes.stage = outage;
      else held.factors[broken] = outage;
      outcomes.push(`${broken}: ${JSON.stringify(await createRecoveryCodeFactor(held).beginEnrolment(USER_ID, AT))}`);
    }
    const unavailable = JSON.stringify({ ok: false, error: "unavailable" });
    expect(outcomes).toEqual([`find: ${unavailable}`, `enrol: ${unavailable}`, `stage: ${unavailable}`]);
  });

  it("answers `not-enrolled` to a confirming code when nothing was ever issued", async () => {
    expect(await createRecoveryCodeFactor(world()).completeEnrolment(USER_ID, "AAAA-AAAA-AAAA-AAAA-AAAA-AAAA", AT)).toEqual({
      ok: false,
      error: "not-enrolled",
    });
  });

  it("spends a guess on a malformed confirming code and leaves the staged set unconfirmed", async () => {
    const held = world();
    await issued(held);
    const outcome = await createRecoveryCodeFactor(held).completeEnrolment(USER_ID, "not a code", AT);
    expect({ outcome, failedAttempts: held.rows[0]?.failedAttempts, confirmedAt: held.rows[0]?.confirmedAt }).toEqual({
      outcome: { ok: false, error: "unrecognised" },
      failedAttempts: 1,
      confirmedAt: null,
    });
  });

  it("holds the attempt ceiling against the confirming code too", async () => {
    const held = world();
    const codes = await issued(held);
    const factor = createRecoveryCodeFactor({ ...held, maxAttempts: 1 });
    await factor.completeEnrolment(USER_ID, "AAAA-AAAA-AAAA-AAAA-AAAA-AAAA", AT);
    expect({ outcome: await factor.completeEnrolment(USER_ID, codes[0] as string, AT + 1), confirmedAt: held.rows[0]?.confirmedAt }).toEqual({
      outcome: { ok: false, error: "too-many-attempts" },
      confirmedAt: null,
    });
  });

  it("reports a store outage on the staged lookup or the commit as `unavailable`, leaving the row unconfirmed", async () => {
    const outage = () => Promise.resolve(err(new AuthStoreError("unavailable", "recoveryCodes")));
    const outcomes = [];
    for (const broken of ["holdsStaged", "commit"] as const) {
      const held = world();
      const codes = await issued(held);
      held.codes[broken] = outage;
      const outcome = await createRecoveryCodeFactor(held).completeEnrolment(USER_ID, codes[0] as string, AT);
      outcomes.push(`${broken}: ${JSON.stringify(outcome)} ${held.rows[0]?.confirmedAt}`);
    }
    const unavailable = JSON.stringify({ ok: false, error: "unavailable" });
    expect(outcomes).toEqual([`holdsStaged: ${unavailable} null`, `commit: ${unavailable} null`]);
  });
});

describe("createRecoveryCodeFactor — the challenge and the enrolment list", () => {
  it("issues a challenge only on a confirmed row, lasting the lockout window", async () => {
    const absent = world();
    const unconfirmed = world();
    await issued(unconfirmed);
    const confirmed = world();
    await confirmedCodes(confirmed);
    const factor = (held: World) => createRecoveryCodeFactor({ ...held, lockoutMs: 120_000 });
    expect([
      await factor(absent).createChallenge(USER_ID, AT),
      await factor(unconfirmed).createChallenge(USER_ID, AT),
      await factor(confirmed).createChallenge(USER_ID, AT),
    ]).toEqual([
      { ok: false, error: "not-enrolled" },
      { ok: false, error: "not-enrolled" },
      { ok: true, data: { kind: "recovery-code", expiresAt: AT + 120_000 } },
    ]);
  });

  it("reports a store outage on the challenge as `unavailable`", async () => {
    const held = world();
    held.factors.find = () => Promise.resolve(err(new AuthStoreError("unavailable", "factors.find")));
    expect(await createRecoveryCodeFactor(held).createChallenge(USER_ID, AT)).toEqual({ ok: false, error: "unavailable" });
  });

  it("lists the one row this factor owns, and nothing when there is none", async () => {
    const held = world();
    const before = await createRecoveryCodeFactor(held).listEnrolments(USER_ID);
    await issued(held);
    const after = await createRecoveryCodeFactor(held).listEnrolments(USER_ID);
    expect({ before, after: after.ok && after.data.map((row) => row.kind) }).toEqual({ before: { ok: true, data: [] }, after: ["recovery-code"] });
  });
});

describe("createRecoveryCodeFactor — its contract and the ranges it holds", () => {
  const factory = (overrides: { maxAttempts?: number; lockoutMs?: number }) => () => createRecoveryCodeFactor({ ...world(), ...overrides });

  it("steps up only, answers no numeric code, and lasts TOTP's lockout window by default", () => {
    const { kind, enrolment, capabilities, codeDigits, codePeriodSeconds, reissueAfterMs, challengeTtlMs } = factory({})();
    expect({ kind, enrolment, capabilities, codeDigits, codePeriodSeconds, reissueAfterMs, challengeTtlMs }).toEqual({
      kind: "recovery-code",
      enrolment: "explicit",
      capabilities: { stepUp: true },
      codeDigits: null,
      codePeriodSeconds: null,
      reissueAfterMs: null,
      challengeTtlMs: AUTH_TOTP_LOCKOUT_MS,
    });
  });

  it("refuses an attempt ceiling below one or above twenty, and accepts both ends", () => {
    expect(factory({ maxAttempts: 0 })).toThrow(
      "createRecoveryCodeFactor: maxAttempts is 0, below the 1-attempt floor — a single mistyped character would otherwise lock the factor out.",
    );
    expect(factory({ maxAttempts: 21 })).toThrow(
      "createRecoveryCodeFactor: maxAttempts is 21, above the 20-attempt ceiling — beyond it a spent budget stops slowing anyone who is guessing.",
    );
    expect(factory({ maxAttempts: 1 })).not.toThrow();
    expect(factory({ maxAttempts: 20 })).not.toThrow();
  });

  it("refuses a lockout window shorter than a minute or past a day, and accepts both ends", () => {
    expect(factory({ lockoutMs: 59_999 })).toThrow(
      "createRecoveryCodeFactor: lockoutMs is 59999, below the 60000-millisecond floor — a shorter window hands the spent budget back before an attacker has to slow down.",
    );
    expect(factory({ lockoutMs: 86_400_001 })).toThrow(
      "createRecoveryCodeFactor: lockoutMs is 86400001, above the 86400000-millisecond ceiling — a window past a day is the permanent lock this exists to prevent.",
    );
    expect(factory({ lockoutMs: 60_000 })).not.toThrow();
    expect(factory({ lockoutMs: 86_400_000 })).not.toThrow();
  });
});

describe("normaliseRecoveryCode", () => {
  it("folds case, spaces and hyphens away", () => {
    expect(normaliseRecoveryCode(" abcd-efgh ijkl-mnop-qrst-uvwx ")).toBe("ABCDEFGHIJKLMNOPQRSTUVWX");
  });

  it("refuses a code of the wrong length or outside the base32 alphabet", () => {
    expect([normaliseRecoveryCode("ABCD"), normaliseRecoveryCode("ABCD-EFGH-IJKL-MNOP-QRST-UVW1")]).toEqual([null, null]);
  });

  it("holds the length at exactly 24 characters and the alphabet at RFC 4648 base32", () => {
    const cases: readonly { input: string; expected: string | null }[] = [
      { input: "", expected: null },
      { input: "-- --", expected: null },
      { input: "ABCDEFGHIJKLMNOPQRSTUVW", expected: null },
      { input: "ABCDEFGHIJKLMNOPQRSTUVWXY", expected: null },
      { input: "ABCDEFGHIJKLMNOPQRSTUVW0", expected: null },
      { input: "ABCDEFGHIJKLMNOPQRSTUVW8", expected: null },
      { input: "ABCD_EFGH_IJKL_MNOP_QRST_UVWX", expected: null },
      { input: "abcd\tefgh\nijkl-mnop qrst--uvwx", expected: "ABCDEFGHIJKLMNOPQRSTUVWX" },
      { input: "2345-6723-4567-ABCD-EFGH-IJKL", expected: "234567234567ABCDEFGHIJKL" },
    ];
    expect(cases.map(({ input }) => normaliseRecoveryCode(input))).toEqual(cases.map(({ expected }) => expected));
  });
});
