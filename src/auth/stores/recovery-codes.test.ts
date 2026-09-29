import { describe, expect, it } from "bun:test";

import { uuidToBytes, uuidv7 } from "../../crypto/mod";
import { createD1Client } from "../../storage/db/client";
import type { D1Client, D1Database } from "../../storage/db/types";
import { nullLogger } from "../../testing/context";
import { fakeD1 } from "../../testing/fakes";
import type { FakeD1Options } from "../../testing/types";
import { createRecoveryCodeStore } from "./recovery-codes";

const USER_ID = uuidv7();
const FACTOR_ID = uuidv7();
const HASH = new Uint8Array(32).fill(7);

type FakeDb = ReturnType<typeof fakeD1>;

function clientOf(rows: (sql: string, params: unknown[]) => unknown[] = () => [], options?: FakeD1Options): [D1Client, FakeDb] {
  const db = fakeD1(rows, options);
  return [createD1Client(db as unknown as D1Database, { logger: nullLogger }), db];
}

describe("createRecoveryCodeStore — stage", () => {
  it("drops the staged set and inserts every new hash as staged, in one batch that leaves the live set alone", async () => {
    const [client, db] = clientOf();
    const hashes = [new Uint8Array(32).fill(1), new Uint8Array(32).fill(2)];
    expect(await createRecoveryCodeStore(client).stage(USER_ID, hashes, 5_000)).toEqual({ ok: true, data: undefined });
    expect(db.calls.map((call) => call.sql.split("\n")[0]?.trim())).toEqual([
      "DELETE FROM auth_recovery_codes WHERE user_id = ? AND staged = 1",
      "INSERT INTO auth_recovery_codes (id, user_id, code_hash, staged, used_at, created_at)",
      "INSERT INTO auth_recovery_codes (id, user_id, code_hash, staged, used_at, created_at)",
    ]);
    expect(db.calls.slice(1).map((call) => call.params.slice(1))).toEqual([
      [uuidToBytes(USER_ID), hashes[0], null, 5_000],
      [uuidToBytes(USER_ID), hashes[1], null, 5_000],
    ]);
    expect(db.calls.every((call) => !call.sql.includes("staged = 0"))).toBe(true);
  });

  it("refuses an owner id that is not a UUID without issuing a statement", async () => {
    const [client, db] = clientOf();
    const staged = await createRecoveryCodeStore(client).stage("not-a-uuid", [HASH], 5_000);
    expect({ ok: staged.ok, calls: db.calls.length }).toEqual({ ok: false, calls: 0 });
  });
});

describe("createRecoveryCodeStore — holdsStaged", () => {
  it("matches only a staged row of the same owner", async () => {
    const [client, db] = clientOf((sql) => (sql.includes("staged = 1") ? [{ held: 1 }] : []));
    expect(await createRecoveryCodeStore(client).holdsStaged(USER_ID, HASH)).toEqual({ ok: true, data: true });
    expect(db.calls[0]?.params).toEqual([uuidToBytes(USER_ID), HASH]);
  });

  it("answers `false` when no staged row carries the hash", async () => {
    const [client] = clientOf(() => []);
    expect(await createRecoveryCodeStore(client).holdsStaged(USER_ID, HASH)).toEqual({ ok: true, data: false });
  });
});

describe("createRecoveryCodeStore — commit", () => {
  it("replaces the live set only where a staged one exists, and confirms the factor with its guesses cleared", async () => {
    const [client, db] = clientOf();
    expect(await createRecoveryCodeStore(client).commit(USER_ID, FACTOR_ID, 6_000)).toEqual({ ok: true, data: undefined });
    const [dropLive, promote, confirm] = db.calls.map((call) => call.sql.replace(/\s+/g, " "));
    expect(dropLive).toContain("DELETE FROM auth_recovery_codes WHERE user_id = ? AND staged = 0 AND EXISTS");
    expect(promote).toContain("UPDATE auth_recovery_codes SET staged = 0 WHERE user_id = ? AND staged = 1");
    expect(confirm).toContain("confirmed_at = COALESCE(confirmed_at, ?), failed_attempts = 0");
    expect(db.calls[2]?.params).toEqual([6_000, 6_000, uuidToBytes(FACTOR_ID), uuidToBytes(USER_ID)]);
  });
});

describe("createRecoveryCodeStore — commit, statement by statement", () => {
  const flat = (sql: string | undefined) => sql?.replace(/\s+/g, " ").trim();

  it("drops the live set only when the same owner holds a staged set, before promoting it", async () => {
    const [client, db] = clientOf();
    await createRecoveryCodeStore(client).commit(USER_ID, FACTOR_ID, 6_000);
    expect(db.calls.slice(0, 2).map((call) => ({ sql: flat(call.sql), params: call.params }))).toEqual([
      {
        sql: "DELETE FROM auth_recovery_codes WHERE user_id = ? AND staged = 0 AND EXISTS (SELECT 1 FROM auth_recovery_codes WHERE user_id = ? AND staged = 1)",
        params: [uuidToBytes(USER_ID), uuidToBytes(USER_ID)],
      },
      { sql: "UPDATE auth_recovery_codes SET staged = 0 WHERE user_id = ? AND staged = 1", params: [uuidToBytes(USER_ID)] },
    ]);
  });

  it("confirms only a factor row the same user owns", async () => {
    const [client, db] = clientOf();
    await createRecoveryCodeStore(client).commit(USER_ID, FACTOR_ID, 6_000);
    expect(flat(db.calls[2]?.sql)).toEndWith("WHERE id = ? AND user_id = ?");
  });

  it("refuses an owner or factor id that is not a UUID without issuing a statement", async () => {
    const [client, db] = clientOf();
    const store = createRecoveryCodeStore(client);
    const outcomes = [await store.commit("nope", FACTOR_ID, 6_000), await store.commit(USER_ID, "nope", 6_000)];
    expect({ refused: outcomes.map((outcome) => outcome.ok === false && outcome.error.operation), calls: db.calls.length }).toEqual({
      refused: ["recoveryCodes.commit", "recoveryCodes.commit"],
      calls: 0,
    });
  });
});

describe("createRecoveryCodeStore — consume, statement by statement", () => {
  const flat = (sql: string | undefined) => sql?.replace(/\s+/g, " ").trim();

  it("stamps only the owner's own live, unused code", async () => {
    const [client, db] = clientOf(() => [], { rowsWritten: () => 1 });
    await createRecoveryCodeStore(client).consume(USER_ID, FACTOR_ID, HASH, 7_000);
    expect({ sql: flat(db.calls[0]?.sql), params: db.calls[0]?.params }).toEqual({
      sql: "UPDATE auth_recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND staged = 0 AND used_at IS NULL",
      params: [7_000, uuidToBytes(USER_ID), HASH],
    });
  });

  it("clears guesses only on a factor row the same user owns, and only where this call stamped the code", async () => {
    const [client, db] = clientOf(() => [], { rowsWritten: () => 1 });
    await createRecoveryCodeStore(client).consume(USER_ID, FACTOR_ID, HASH, 7_000);
    expect(flat(db.calls[1]?.sql)).toBe(
      "UPDATE auth_factors SET failed_attempts = 0 WHERE id = ? AND user_id = ? AND EXISTS (SELECT 1 FROM auth_recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at = ?)",
    );
  });

  it("answers from the stamp alone, so a guess reset reported without one is not a use", async () => {
    const [client] = clientOf(() => [], { rowsWritten: (sql) => (sql.includes("SET used_at") ? 0 : 1) });
    expect(await createRecoveryCodeStore(client).consume(USER_ID, FACTOR_ID, HASH, 7_000)).toEqual({ ok: true, data: false });
  });

  it("answers `false` for an owner or factor id that is not a UUID, without a statement", async () => {
    const [client, db] = clientOf();
    const store = createRecoveryCodeStore(client);
    const outcomes = [await store.consume("nope", FACTOR_ID, HASH, 7_000), await store.consume(USER_ID, "nope", HASH, 7_000)];
    expect({ outcomes, calls: db.calls.length }).toEqual({
      outcomes: [
        { ok: true, data: false },
        { ok: true, data: false },
      ],
      calls: 0,
    });
  });
});

describe("createRecoveryCodeStore — a failing database", () => {
  it("reports every operation's failure as `unavailable`, naming the operation", async () => {
    const [client] = clientOf(() => [], { failOn: () => new Error("D1_ERROR: network lost") });
    const store = createRecoveryCodeStore(client);
    const outcomes = [
      await store.stage(USER_ID, [HASH], 1),
      await store.holdsStaged(USER_ID, HASH),
      await store.commit(USER_ID, FACTOR_ID, 1),
      await store.consume(USER_ID, FACTOR_ID, HASH, 1),
      await store.remaining(USER_ID),
    ];
    expect(outcomes.map((outcome) => outcome.ok === false && `${outcome.error.code} ${outcome.error.operation}`)).toEqual([
      "unavailable recoveryCodes.stage",
      "unavailable recoveryCodes.holdsStaged",
      "unavailable recoveryCodes.commit",
      "unavailable recoveryCodes.consume",
      "unavailable recoveryCodes.remaining",
    ]);
  });

  it("answers `false` from `holdsStaged` for an owner id that is not a UUID, without a statement", async () => {
    const [client, db] = clientOf();
    expect({ held: await createRecoveryCodeStore(client).holdsStaged("nope", HASH), calls: db.calls.length }).toEqual({
      held: { ok: true, data: false },
      calls: 0,
    });
  });
});

describe("createRecoveryCodeStore — consume", () => {
  it("answers `true` when the one live, unused code was stamped, and clears the guesses in the same batch", async () => {
    const [client, db] = clientOf(() => [], { rowsWritten: (sql) => (sql.includes("SET used_at") ? 1 : 0) });
    expect(await createRecoveryCodeStore(client).consume(USER_ID, FACTOR_ID, HASH, 7_000)).toEqual({ ok: true, data: true });
    expect(db.calls).toHaveLength(2);
    expect(db.calls[0]?.sql).toContain("staged = 0 AND used_at IS NULL");
    expect(db.calls[1]?.sql).toContain("SET failed_attempts = 0");
    expect(db.calls[1]?.params).toEqual([uuidToBytes(FACTOR_ID), uuidToBytes(USER_ID), uuidToBytes(USER_ID), HASH, 7_000]);
  });

  it("answers `false` for a code that was already used, staged, or another user's", async () => {
    const [client] = clientOf(() => [], { rowsWritten: () => 0 });
    expect(await createRecoveryCodeStore(client).consume(USER_ID, FACTOR_ID, HASH, 7_000)).toEqual({ ok: true, data: false });
  });
});

describe("createRecoveryCodeStore — remaining", () => {
  it("counts the live codes not yet used", async () => {
    const [client, db] = clientOf(() => [{ remaining: 4 }]);
    expect(await createRecoveryCodeStore(client).remaining(USER_ID)).toEqual({ ok: true, data: 4 });
    expect(db.calls[0]?.sql).toContain("staged = 0 AND used_at IS NULL");
  });

  it("answers zero for an owner id that is not a UUID, without a statement", async () => {
    const [client, db] = clientOf();
    expect(await createRecoveryCodeStore(client).remaining("nope")).toEqual({ ok: true, data: 0 });
    expect(db.calls).toHaveLength(0);
  });
});
