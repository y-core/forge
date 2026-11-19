import { describe, expect, it } from "bun:test";

import type { KeyRing } from "../../crypto/keyring/types";
import { base64urlDecode } from "../../crypto/primitives/mod";
import { createD1Client } from "../../storage/db/client";
import type { D1Client, D1Database } from "../../storage/db/types";
import { uuidToBytes, uuidv7 } from "../../storage/db/uuid";
import { nullLogger } from "../../testing/context";
import { fakeD1 } from "../../testing/fakes";
import type { FakeD1Options } from "../../testing/types";
import type { AuthSecondFactorKind } from "../factors/types";
import type { AuthFactor, AuthStoreResult } from "../types";
import { eventParams, securityEventText, squashSql } from "./events.fixture";
import { createFactorStore, purgeStaleTotpSecrets } from "./factors";
import { ACTING_SESSION, seededSessions } from "./sessions.fixture";
import type { TotpSecretPurgeOptions } from "./types";

const DAY = 86_400_000;

/** The purge takes the ring, so the key it keeps is the one the deployment actually seals under. */
const RING: KeyRing = { activeKeyId: "AAAAAAAA", keys: {} };

/** A deployment making the authenticator app mandatory, the only one the purge runs under, with an optional passkey beside it. */
const REQUIRED_TOTP: TotpSecretPurgeOptions["factors"] = { offered: ["totp-app", "passkey"], mandatory: ["totp-app"] };

const USER_ID = uuidv7();
const OTHER_ID = uuidv7();
const KEEP = new Uint8Array(32).fill(7);
/** The sealed secret a verification opened, which its write requires the row still to hold. */
const FRAME = new Uint8Array([9, 8, 7]);
const KIND_OF = "(SELECT kind FROM auth_factors WHERE id = ? AND user_id = ?)";

type FakeDb = ReturnType<typeof fakeD1>;

function clientOf(rows: (sql: string, params: unknown[]) => unknown[] = () => [], options?: FakeD1Options): [D1Client, FakeDb] {
  const db = fakeD1(rows, options);
  return [createD1Client(db as unknown as D1Database, { logger: nullLogger }), db];
}

function writerOf(
  rowsWritten: (sql: string, params: unknown[]) => number,
  rows?: (sql: string, params: unknown[]) => unknown[],
): [D1Client, FakeDb] {
  return clientOf(rows, { rowsWritten });
}

describe("createFactorStore", () => {
  it("lists the confirmed kinds of every offered kind in one statement selecting `kind` alone", async () => {
    const [client, db] = clientOf(() => [{ kind: "passkey", secret: new Uint8Array([1]) }]);
    const listed = await createFactorStore(client).listConfirmedKinds(USER_ID, ["email-otp", "passkey", "totp-app"]);
    expect({ listed, calls: db.calls.map((call) => [squashSql(call.sql), call.params]) }).toEqual({
      listed: { ok: true, data: ["passkey"] },
      calls: [
        [
          "SELECT kind FROM auth_factors WHERE user_id = ? AND kind IN (SELECT value FROM json_each(?)) AND confirmed_at IS NOT NULL",
          [uuidToBytes(USER_ID), '["email-otp","passkey","totp-app"]'],
        ],
      ],
    });
  });

  it("issues no statement at all for an empty kind list", async () => {
    const [client, db] = clientOf(() => []);
    expect(await createFactorStore(client).listConfirmedKinds(USER_ID, [])).toEqual({ ok: true, data: [] });
    expect(db.calls).toHaveLength(0);
  });

  it("returns the enrolled factor it wrote, sealed secret included", async () => {
    const [client] = clientOf();
    const secret = new Uint8Array([1, 2, 3]);
    const enrolled = await createFactorStore(client).enrol({ userId: USER_ID, kind: "totp-app", secret }, 5_000);
    expect(enrolled.ok && enrolled.data).toEqual({
      id: enrolled.ok ? enrolled.data.id : "",
      userId: USER_ID,
      kind: "totp-app",
      secret,
      lastCounter: null,
      failedAttempts: 0,
      lastVerifiedAt: null,
      confirmedAt: null,
      createdAt: 5_000,
      updatedAt: 5_000,
    });
  });

  it("reads a factor row back with its secret as bytes and its kind narrowed", async () => {
    const [client] = clientOf(() => [
      {
        id: uuidToBytes(OTHER_ID),
        user_id: uuidToBytes(USER_ID),
        kind: "totp-app",
        secret: [9, 8, 7],
        last_counter: 41,
        failed_attempts: 0,
        confirmed_at: 6_000,
        created_at: 1,
        updated_at: 2,
      },
    ]);
    const found = await createFactorStore(client).find(USER_ID, "totp-app");
    expect(found.ok && found.data).toEqual({
      id: OTHER_ID,
      userId: USER_ID,
      kind: "totp-app",
      secret: new Uint8Array([9, 8, 7]),
      lastCounter: 41,
      failedAttempts: 0,
      confirmedAt: 6_000,
      createdAt: 1,
      updatedAt: 2,
    });
  });

  it("reads a null secret as null rather than as empty bytes", async () => {
    const [client] = clientOf(() => [
      {
        id: uuidToBytes(OTHER_ID),
        user_id: uuidToBytes(USER_ID),
        kind: "email-otp",
        secret: null,
        last_counter: null,
        failed_attempts: 0,
        confirmed_at: null,
        created_at: 1,
        updated_at: 2,
      },
    ]);
    const found = await createFactorStore(client).find(USER_ID, "email-otp");
    expect(found.ok && found.data?.secret).toBeNull();
    expect(found.ok && found.data?.lastCounter).toBeNull();
  });

  it("reports the rows its delete wrote as purged and the rows its count found as kept, from one batch", async () => {
    const [client, db] = writerOf(
      (text) => (text.startsWith("DELETE") ? 4 : 0),
      (text) => (text.startsWith("SELECT COUNT(*) AS kept") ? [{ kept: 2 }] : []),
    );
    const purged = await purgeStaleTotpSecrets(client, 1_000_000_000, { keys: RING, idleForMs: DAY, factors: REQUIRED_TOTP });
    expect(purged).toEqual({ ok: true, data: { purged: 4, kept: 2 } });
    expect(db.calls.map((call) => squashSql(call.sql).split(" WHERE ")[0])).toEqual([
      "SELECT COUNT(*) AS kept FROM auth_factors AS stale",
      "DELETE FROM auth_factors",
    ]);
    for (const call of db.calls) {
      expect(call.sql).toContain("substr(stale.secret, 1, ?) != ?");
      expect(call.params.slice(0, 4)).toEqual(["totp-app", 6, base64urlDecode("AAAAAAAA"), 1_000_000_000 - DAY]);
    }
  });

  // Dropping the row of a user with nothing else to step up with would let them re-enrol on their
  // mailbox alone, so the delete is gated per owner and the count is its exact complement.
  it("keeps a TOTP row whose owner holds no other confirmed offered second factor and no unused recovery code", async () => {
    const [client, db] = writerOf(() => 0);
    await purgeStaleTotpSecrets(client, 5 * DAY, { keys: RING, idleForMs: DAY, factors: REQUIRED_TOTP });
    const [count, purge] = db.calls.map((call) => squashSql(call.sql));
    const ownerHolds =
      "(stale.confirmed_at IS NULL" +
      " OR EXISTS (SELECT 1 FROM auth_factors WHERE user_id = stale.user_id AND confirmed_at IS NOT NULL AND kind IN (SELECT value FROM json_each(?)))" +
      " OR EXISTS (SELECT 1 FROM auth_recovery_codes WHERE user_id = stale.user_id AND staged = 0 AND used_at IS NULL))";
    expect(count).toEndWith(`AND NOT ${ownerHolds}`);
    expect(purge).toEndWith(`AND ${ownerHolds})`);
    expect(db.calls[1]?.params.slice(4)).toEqual(['["passkey"]']);
  });

  it("counts a passkey toward the purge only through the deployment's offered kinds, so an unoffered one keeps the row", async () => {
    const [client, db] = writerOf(() => 0);
    await purgeStaleTotpSecrets(client, 5 * DAY, { keys: RING, idleForMs: DAY, factors: { offered: ["totp-app"], mandatory: ["totp-app"] } });
    expect(db.calls[1]?.params.slice(4)).toEqual(["[]"]);
  });

  // The window is measured back from the caller's own instant, so a scheduled run names the clock.
  it("measures the window back from the caller's own instant", async () => {
    const [client, db] = writerOf(() => 0);
    await purgeStaleTotpSecrets(client, 5 * DAY, { keys: RING, idleForMs: 2 * DAY, factors: REQUIRED_TOTP });
    expect(db.calls.map((call) => call.params[3])).toEqual([3 * DAY, 3 * DAY]);
  });

  // `updated_at` moves on a spent guess too, so a user whose app drifted and who keeps trying wrong
  // codes would hold their own row outside the window forever — the population the purge exists for.
  it("reads the accepted-code clock and not the last-touched one, so a wrong code does not defer the drop", async () => {
    const [client, db] = writerOf(() => 0);
    await purgeStaleTotpSecrets(client, 5 * DAY, { keys: RING, idleForMs: DAY, factors: REQUIRED_TOTP });
    for (const call of db.calls) {
      expect(call.sql).toContain("COALESCE(stale.last_verified_at, stale.created_at) <= ?");
      expect(call.sql).not.toContain("updated_at <=");
    }
  });

  it("answers a failed batch as a store error and reports nothing purged", async () => {
    const [client] = clientOf(() => [], { failOn: () => new Error("D1_ERROR: database is locked") });
    const purged = await purgeStaleTotpSecrets(client, 5 * DAY, { keys: RING, idleForMs: DAY, factors: REQUIRED_TOTP });
    expect(purged.ok).toBe(false);
  });

  it("stamps that clock only on the statement that accepts a code, never on the one that spends a guess", async () => {
    const [client, db] = writerOf(() => 1);
    const factors = createFactorStore(client);
    await factors.recordVerification(OTHER_ID, USER_ID, 57, 4, FRAME);
    await factors.countAttempt(USER_ID, "totp-app", 5, 9, 60_000);
    expect(db.calls[0]?.sql).toContain("last_verified_at = ?");
    expect(db.calls[1]?.sql).not.toContain("last_verified_at");
  });

  // The kid is the complement of what the DELETE keeps, so a malformed one matches no row's prefix
  // and the statement would take every idle enrolment in the deployment.
  it("refuses a ring whose active key id is not the shape importAuthKeyRing derives, before any statement runs", async () => {
    const [client, db] = writerOf(() => 0);
    for (const activeKeyId of ["", "AAAA", "AAAAAAAAA", "AAAA/AAA"]) {
      const purge = () => purgeStaleTotpSecrets(client, DAY, { keys: { activeKeyId, keys: {} }, idleForMs: DAY, factors: REQUIRED_TOTP });
      expect(purge).toThrow("use importAuthKeyRing to derive one");
    }
    expect(db.calls).toHaveLength(0);
  });

  it("refuses a window shorter than a day, or longer than a year, naming the bound it broke", async () => {
    const [client] = writerOf(() => 0);
    const purge = (idleForMs: number) => purgeStaleTotpSecrets(client, DAY, { keys: RING, idleForMs, factors: REQUIRED_TOTP });
    expect(() => purge(DAY - 1)).toThrow("below the 86400000-millisecond floor");
    expect(() => purge(366 * DAY)).toThrow("above the 31536000000-millisecond ceiling");
  });

  // Dropping the row is graceful only because the user is then routed to re-enrol, and only a
  // mandatory authenticator app routes anyone back to it. Optional, it is a silent downgrade.
  it("refuses a deployment that does not make the authenticator app mandatory, or does not offer it", async () => {
    const [client, db] = writerOf(() => 0);
    const purge = (offered: readonly AuthSecondFactorKind[], mandatory: readonly AuthSecondFactorKind[]) => () =>
      purgeStaleTotpSecrets(client, DAY, { keys: RING, idleForMs: DAY, factors: { offered, mandatory } });
    expect(purge(["totp-app"], [])).toThrow('offers "totp-app" as optional');
    expect(purge(["totp-app", "passkey"], ["passkey"])).toThrow('offers "totp-app" as optional');
    expect(purge(["passkey"], ["passkey"])).toThrow('does not offer "totp-app" as a second factor');
    expect(purge([], [])).toThrow('does not offer "totp-app" as a second factor');
    expect(db.calls).toHaveLength(0);
  });

  it("refuses an offered kind listed twice, or one that is not a second factor, before any statement runs", async () => {
    const [client, db] = writerOf(() => 0);
    const purge = (kinds: readonly string[]) => () =>
      purgeStaleTotpSecrets(client, DAY, {
        keys: RING,
        idleForMs: DAY,
        factors: { offered: kinds as AuthSecondFactorKind[], mandatory: ["totp-app"] },
      });
    expect(purge(["totp-app", "passkey", "totp-app"])).toThrow('"totp-app" is offered twice');
    expect(purge(["totp-app", "email-otp"])).toThrow('"email-otp" is not a second factor');
    expect(db.calls).toHaveLength(0);
  });

  it("re-seals on the same statement that advances the counter, so the replay guard covers both", async () => {
    const [client, db] = writerOf(() => 1);
    const secret = new Uint8Array([7, 7, 7]) as Uint8Array<ArrayBuffer>;
    await createFactorStore(client).recordVerification(OTHER_ID, USER_ID, 57, 4, FRAME, secret);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]?.sql).toContain(", secret = ?");
    expect(db.calls[0]?.sql).toContain("last_counter < ?");
    expect(db.calls[0]?.params).toContain(secret);
  });

  // A replacement can commit between the read a code was checked against and this write. The frame
  // in the guard is what stops that code stepping up on, or re-sealing back, the secret it replaced.
  it("writes only to the row still holding the frame the code was checked against", async () => {
    let held: Uint8Array = FRAME;
    const [client, db] = writerOf((_sql, params) => (params.some((param) => sameBytes(param, held)) ? 1 : 0));
    const factors = createFactorStore(client);
    const resealed = new Uint8Array([7, 7, 7]) as Uint8Array<ArrayBuffer>;
    expect(await factors.recordVerification(OTHER_ID, USER_ID, 57, 1, FRAME, resealed)).toEqual({ ok: true, data: true });
    held = new Uint8Array([4, 4, 4]);
    expect(await factors.recordVerification(OTHER_ID, USER_ID, 58, 2, FRAME, resealed)).toEqual({ ok: true, data: false });
    expect(squashSql(db.calls[0]?.sql ?? "")).toEndWith(
      "WHERE id = ? AND user_id = ? AND secret = ? AND (last_counter IS NULL OR last_counter < ?)",
    );
    expect(db.calls[0]?.params.slice(-4)).toEqual([uuidToBytes(OTHER_ID), uuidToBytes(USER_ID), FRAME, 57]);
  });

  it("writes no secret at all when none is handed to it, rather than writing null over one", async () => {
    const [client, db] = writerOf(() => 1);
    await createFactorStore(client).recordVerification(OTHER_ID, USER_ID, 57, 4, FRAME);
    expect(db.calls[0]?.sql).not.toContain(", secret = ?");
  });

  it("counts by the key id in the secret's own first bytes, so no second column can disagree", async () => {
    const [client, db] = clientOf(() => [{ held: 3 }]);
    expect(await createFactorStore(client).countSecretsNotUnder("totp-app", "AAAAAAAA")).toEqual({ ok: true, data: 3 });
    expect(db.calls[0]?.sql).toContain("substr(secret, 1, ?) != ?");
    expect(db.calls[0]?.params).toEqual(["totp-app", 6, base64urlDecode("AAAAAAAA")]);
  });

  it("advances the counter once, and reports no change on a replay at the same or a lower step", async () => {
    let accepted: number | null = null;
    const [client, db] = writerOf((sql, params) => {
      if (!sql.includes("SET last_counter = ?")) return 0;
      const counter = params[0] as number;
      if (accepted !== null && accepted >= counter) return 0;
      accepted = counter;
      return 1;
    });
    const factors = createFactorStore(client);
    expect(await factors.recordVerification(OTHER_ID, USER_ID, 57, 1, FRAME)).toEqual({ ok: true, data: true });
    expect(await factors.recordVerification(OTHER_ID, USER_ID, 57, 2, FRAME)).toEqual({ ok: true, data: false });
    expect(await factors.recordVerification(OTHER_ID, USER_ID, 56, 3, FRAME)).toEqual({ ok: true, data: false });
    expect(await factors.recordVerification(OTHER_ID, USER_ID, 58, 4, FRAME)).toEqual({ ok: true, data: true });
    expect(db.calls[0]?.sql.replace(/\s+/g, " ")).toContain(
      "WHERE id = ? AND user_id = ? AND secret = ? AND (last_counter IS NULL OR last_counter < ?)",
    );
  });

  // The budget is spent by the statement that admits the guess, so N parallel guesses spend N of it
  // rather than each comparing against a count none of them has written.
  it("spends a guess and admits it in one statement, and clears the count on an accepted step", async () => {
    const [client, db] = writerOf(...spendingRow());
    const factors = createFactorStore(client);

    expect(await admits(factors.countAttempt(USER_ID, "totp-app", 2, 1, LOCKOUT))).toBe(true);
    expect(await admits(factors.countAttempt(USER_ID, "totp-app", 2, 2, LOCKOUT))).toBe(true);
    expect(await admits(factors.countAttempt(USER_ID, "totp-app", 2, 3, LOCKOUT))).toBe(false);
    await factors.recordVerification(OTHER_ID, USER_ID, 57, 4, FRAME);
    expect(await admits(factors.countAttempt(USER_ID, "totp-app", 2, 5, LOCKOUT))).toBe(true);

    expect(db.calls[0]?.sql.replace(/\s+/g, " ")).toContain("WHERE user_id = ? AND kind = ? AND (failed_attempts < ? OR updated_at <= ?)");
    expect(db.calls[0]?.params).toEqual([2, 1 - LOCKOUT, 1, uuidToBytes(USER_ID), "totp-app", 2, 1 - LOCKOUT]);
    expect(db.calls[3]?.sql.replace(/\s+/g, " ")).toContain("SET last_counter = ?, failed_attempts = 0");
  });

  // One statement, not a `find` and then a spend: the row the guess was compared against is the row
  // the guess was spent on, and the sealed secret rides out of the same write.
  it("returns the factor the guess was spent against, through RETURNING", async () => {
    const [client, db] = writerOf(...spendingRow());
    const spent = await createFactorStore(client).countAttempt(USER_ID, "totp-app", 2, 1, LOCKOUT);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]?.sql.replace(/\s+/g, " ")).toContain("RETURNING *");
    expect(spent.ok && spent.data).toEqual({
      id: OTHER_ID,
      userId: USER_ID,
      kind: "totp-app",
      secret: new Uint8Array([9, 8, 7]),
      lastCounter: 41,
      failedAttempts: 1,
      confirmedAt: 6_000,
      createdAt: 1,
      updatedAt: 1,
    });
  });

  // The defect this closes: a spent budget stayed spent until a correct code, and a user who could
  // not produce one was locked out of the factor for good.
  it("refuses a guess inside the lockout window and admits one after it, with the count reset to 1", async () => {
    const [client] = writerOf(...spendingRow());
    const factors = createFactorStore(client);

    expect(await admits(factors.countAttempt(USER_ID, "totp-app", 2, 1, LOCKOUT))).toBe(true);
    expect(await admits(factors.countAttempt(USER_ID, "totp-app", 2, 2, LOCKOUT))).toBe(true);
    expect(await admits(factors.countAttempt(USER_ID, "totp-app", 2, 2 + LOCKOUT - 1, LOCKOUT))).toBe(false);
    expect(await admits(factors.countAttempt(USER_ID, "totp-app", 2, 2 + LOCKOUT, LOCKOUT))).toBe(true);
    expect(await admits(factors.countAttempt(USER_ID, "totp-app", 2, 3 + LOCKOUT, LOCKOUT))).toBe(true);
    expect(await admits(factors.countAttempt(USER_ID, "totp-app", 2, 4 + LOCKOUT, LOCKOUT))).toBe(false);
  });
});

describe("createFactorStore — confirm", () => {
  const flat = (sql: string) => sql.replace(/\s+/g, " ").trim();

  it("confirms only an unconfirmed row, then records `factor-added` from the acting session and revokes every other session chained behind it, in one batch", async () => {
    const [client, db] = writerOf(() => 1);
    expect(await createFactorStore(client).confirm(OTHER_ID, USER_ID, 9_000, { keep: KEEP })).toEqual({ ok: true, data: true });
    const owner = uuidToBytes(USER_ID);
    const factor = uuidToBytes(OTHER_ID);
    expect(db.calls.map((call, index) => ({ sql: flat(call.sql), params: index === 1 ? eventParams(call.params) : call.params }))).toEqual([
      {
        sql: "UPDATE auth_factors SET confirmed_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND confirmed_at IS NULL",
        params: [9_000, 9_000, factor, owner],
      },
      {
        sql: securityEventText({ kind: KIND_OF, session: true, guard: `changes() > 0 AND ${KIND_OF} != ?` }),
        params: ["event-id", owner, "factor-added", factor, owner, KEEP, null, 9_000, factor, owner, "passkey"],
      },
      { sql: "DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ? AND changes() > 0", params: [owner, KEEP] },
    ]);
  });

  it("answers from the confirming UPDATE, so an already-confirmed row answers false", async () => {
    const [landed] = writerOf((sql) => (flat(sql).startsWith("UPDATE") ? 1 : 0));
    const [confirmedAlready] = writerOf((sql) => (flat(sql).startsWith("UPDATE") ? 0 : 1));
    expect([
      await createFactorStore(landed).confirm(OTHER_ID, USER_ID, 9_000, { keep: null }),
      await createFactorStore(confirmedAlready).confirm(OTHER_ID, USER_ID, 9_000, { keep: null }),
    ]).toEqual([
      { ok: true, data: true },
      { ok: true, data: false },
    ]);
  });

  /** Evaluates the confirm batch against one row of `kind` and two other sessions, answering `changes()` from the write before it, as SQLite does. */
  async function landedOnConfirm(kind: string, unconfirmed: boolean): Promise<{ recorded: number; revoked: number }> {
    let changed = 0;
    const landed = { recorded: 0, revoked: 0 };
    const [client] = writerOf((sql, params) => {
      if (flat(sql).startsWith("UPDATE")) return (changed = Number(unconfirmed));
      if (flat(sql).startsWith("DELETE FROM auth_sessions")) {
        landed.revoked += changed > 0 ? 2 : 0;
        return (changed = changed > 0 ? 2 : 0);
      }
      const excluded = flat(sql).includes(`AND ${KIND_OF} != ?`) && params.at(-1) === kind;
      changed = Number(changed > 0 && !excluded);
      landed.recorded += changed;
      return changed;
    });
    await createFactorStore(client).confirm(OTHER_ID, USER_ID, 9_000, { keep: KEEP });
    return landed;
  }

  it("records and revokes for a confirmed authenticator app once, and neither for a row that was already confirmed", async () => {
    expect([await landedOnConfirm("totp-app", true), await landedOnConfirm("totp-app", false)]).toEqual([
      { recorded: 1, revoked: 2 },
      { recorded: 0, revoked: 0 },
    ]);
  });

  it("records and revokes nothing when it confirms a passkey row, whose credential insert does both", async () => {
    expect(await landedOnConfirm("passkey", true)).toEqual({ recorded: 0, revoked: 0 });
  });

  it("signs every other session out once an authenticator app is confirmed, keeping the acting one, and none when the confirmation is refused", async () => {
    const confirmedWith = async (unconfirmed: number) => {
      const seeded = await seededSessions(USER_ID, (sql) =>
        sql.startsWith("UPDATE auth_factors") || sql.startsWith("INSERT INTO auth_security_events") ? unconfirmed : null,
      );
      await createFactorStore(seeded.client).confirm(OTHER_ID, USER_ID, 9_000, { keep: ACTING_SESSION });
      return seeded.live();
    };
    expect([await confirmedWith(1), await confirmedWith(0)]).toEqual([
      [true, false],
      [true, true],
    ]);
  });

  it("names no session on the event when none acted", async () => {
    const [client, db] = writerOf(() => 1);
    await createFactorStore(client).confirm(OTHER_ID, USER_ID, 9_000, { keep: null });
    expect(flat(db.calls[1]?.sql ?? "")).toContain(", NULL, ?, ? WHERE changes() > 0");
  });

  it("reports a failing batch as `unavailable` under its own operation name", async () => {
    const [client] = clientOf(() => [], { failOn: () => new Error("D1_ERROR: network lost") });
    const confirmed = await createFactorStore(client).confirm(OTHER_ID, USER_ID, 9_000, { keep: KEEP });
    expect(confirmed.ok === false && `${confirmed.error.code} ${confirmed.error.operation}`).toBe("unavailable factors.confirm");
  });
});

describe("createFactorStore — remove", () => {
  const flat = (sql: string) => sql.replace(/\s+/g, " ").trim();
  const HOLDS_ANOTHER =
    "EXISTS (SELECT 1 FROM auth_factors WHERE user_id = ? AND kind IN (SELECT value FROM json_each(?)) AND confirmed_at IS NOT NULL)";
  const FLOOR = ["totp-app", "passkey"] as const;
  const REMAINS =
    "NOT EXISTS (SELECT 1 FROM auth_factors WHERE user_id = ? AND confirmed_at IS NOT NULL AND kind IN (SELECT value FROM json_each(?)) AND (id = ?))";
  const TARGET = "id = ? AND user_id = ?";
  const PROBE = "SELECT (SELECT COUNT(*) FROM auth_factors WHERE id = ? AND user_id = ?) AS present";

  /** A store whose probe answers `present` and `removable`, and whose factor delete writes a row only where both hold. */
  function probed(present: number, removable: number): [D1Client, FakeDb] {
    return clientOf((sql) => (flat(sql).startsWith(PROBE) ? [{ present, removable }] : []), {
      rowsWritten: (sql) => (flat(sql).startsWith("DELETE FROM auth_factors WHERE id = ?") ? present * removable : 0),
    });
  }

  it("probes, then records the removal of a confirmed factor and revokes every other session only where the floor still holds, deletes it under the same guard, then the codes and the recovery-code row only where no confirmed totp-app or passkey remains, in one batch", async () => {
    const [client, db] = probed(1, 1);
    expect(await createFactorStore(client).remove(OTHER_ID, USER_ID, 8_000, { keep: KEEP }, FLOOR)).toEqual({ ok: true, data: "changed" });
    const owner = uuidToBytes(USER_ID);
    const factor = uuidToBytes(OTHER_ID);
    const floor = '["totp-app","passkey"]';
    const remains = [owner, floor, factor];
    expect(db.calls.map((call, index) => ({ sql: flat(call.sql), params: index === 1 ? eventParams(call.params, 7) : call.params }))).toEqual([
      { sql: `${PROBE}, ${REMAINS} AS removable`, params: [factor, owner, ...remains] },
      {
        sql: securityEventText({
          kind: KIND_OF,
          session: true,
          guard: `EXISTS (SELECT 1 FROM auth_factors WHERE ${TARGET} AND confirmed_at IS NOT NULL) AND ${REMAINS}`,
        }),
        params: ["event-id", owner, "factor-removed", factor, owner, KEEP, null, "now", factor, owner, ...remains],
      },
      { sql: "DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ? AND changes() > 0", params: [owner, KEEP] },
      { sql: `DELETE FROM auth_factors WHERE ${TARGET} AND ${REMAINS}`, params: [factor, owner, ...remains] },
      { sql: `DELETE FROM auth_recovery_codes WHERE user_id = ? AND NOT ${HOLDS_ANOTHER}`, params: [owner, owner, '["totp-app","passkey"]'] },
      {
        sql: `DELETE FROM auth_factors WHERE user_id = ? AND kind = ? AND NOT ${HOLDS_ANOTHER}`,
        params: [owner, "recovery-code", owner, '["totp-app","passkey"]'],
      },
    ]);
  });

  it("guards nothing under an empty floor, so a user whose second factors are all optional may remove their last", async () => {
    const [client, db] = probed(1, 1);
    await createFactorStore(client).remove(OTHER_ID, USER_ID, 8_000, { keep: KEEP }, []);
    expect([flat(db.calls[0]?.sql ?? ""), flat(db.calls[3]?.sql ?? "")]).toEqual([
      `${PROBE}, 1 AS removable`,
      `DELETE FROM auth_factors WHERE ${TARGET} AND 1`,
    ]);
  });

  it("answers `changed`, `not-found` and `second-factor-required` from the probe and the delete", async () => {
    const outcome = async (present: number, removable: number) => {
      const removed = await createFactorStore(probed(present, removable)[0]).remove(OTHER_ID, USER_ID, 8_000, { keep: KEEP }, FLOOR);
      return removed.ok ? removed.data : removed.error.code;
    };
    expect([await outcome(1, 1), await outcome(0, 1), await outcome(1, 0)]).toEqual(["changed", "not-found", "second-factor-required"]);
  });

  it("answers from the factor's own delete, not from the codes it may have cleared", async () => {
    const [client] = clientOf((sql) => (flat(sql).startsWith(PROBE) ? [{ present: 1, removable: 1 }] : []), {
      rowsWritten: (sql) => (flat(sql).startsWith("DELETE FROM auth_factors WHERE id = ?") ? 0 : 10),
    });
    const removed = await createFactorStore(client).remove(OTHER_ID, USER_ID, 8_000, { keep: KEEP }, FLOOR);
    expect(removed.ok === false && `${removed.error.code} ${removed.error.operation}`).toBe("unavailable factors.remove");
  });

  it("keeps every session when the floor refuses the removal, and signs the others out when it lets one through", async () => {
    const removedWith = async (removable: number) => {
      const seeded = await seededSessions(USER_ID, (sql) => (sql.startsWith("INSERT INTO auth_security_events") ? removable : null));
      await createFactorStore(seeded.client).remove(OTHER_ID, USER_ID, 9_000, { keep: ACTING_SESSION }, FLOOR);
      return seeded.live();
    };
    expect([await removedWith(0), await removedWith(1)]).toEqual([
      [true, true],
      [true, false],
    ]);
  });

  it("answers `not-found` for an id or owner that is not a UUID, without a statement", async () => {
    const [client, db] = writerOf(() => 1);
    const factors = createFactorStore(client);
    const outcomes = [
      await factors.remove("nope", USER_ID, 8_000, { keep: KEEP }, FLOOR),
      await factors.remove(OTHER_ID, "nope", 8_000, { keep: KEEP }, FLOOR),
    ];
    expect({ outcomes, calls: db.calls.length }).toEqual({
      outcomes: [
        { ok: true, data: "not-found" },
        { ok: true, data: "not-found" },
      ],
      calls: 0,
    });
  });

  it("reports a failing batch as `unavailable` under its own operation name", async () => {
    const [client] = clientOf(() => [], { failOn: () => new Error("D1_ERROR: network lost") });
    const removed = await createFactorStore(client).remove(OTHER_ID, USER_ID, 8_000, { keep: KEEP }, FLOOR);
    expect(removed.ok === false && `${removed.error.code} ${removed.error.operation}`).toBe("unavailable factors.remove");
  });
});

describe("createFactorStore — replaceSecret", () => {
  const SECRET = new Uint8Array([5, 5, 5]) as Uint8Array<ArrayBuffer>;
  const TARGET = "id = ? AND user_id = ? AND kind = ? AND confirmed_at IS NOT NULL";

  it("swaps the secret, records the confirming step, clears the guesses, then records `factor-replaced` and revokes every other session chained behind it, in one batch", async () => {
    const [client, db] = writerOf(() => 1);
    expect(await createFactorStore(client).replaceSecret(OTHER_ID, USER_ID, SECRET, 61, 9_000, { keep: KEEP })).toEqual({ ok: true, data: true });
    const owner = uuidToBytes(USER_ID);
    const factor = uuidToBytes(OTHER_ID);
    expect(db.calls.map((call, index) => ({ sql: squashSql(call.sql), params: index === 1 ? eventParams(call.params) : call.params }))).toEqual([
      {
        sql: `UPDATE auth_factors SET secret = ?, last_counter = ?, failed_attempts = 0, last_verified_at = ?, updated_at = ? WHERE ${TARGET}`,
        params: [SECRET, 61, 9_000, 9_000, factor, owner, "totp-app"],
      },
      {
        sql: securityEventText({ session: true, guard: "changes() > 0" }),
        params: ["event-id", owner, "factor-replaced", "totp-app", KEEP, null, 9_000],
      },
      { sql: "DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ? AND changes() > 0", params: [owner, KEEP] },
    ]);
  });

  /** Evaluates the replace batch against one row and two other sessions, answering `changes()` from the write before it, as SQLite does. */
  async function landedOnReplace(row: { readonly owner: string; readonly confirmed: boolean } | null, userId = USER_ID) {
    let changed = 0;
    const landed = { replaced: false, recorded: 0, revoked: 0 };
    const [client] = writerOf((sql, params) => {
      if (squashSql(sql).startsWith("UPDATE")) {
        const matches =
          row !== null && sameBytes(params[4], uuidToBytes(OTHER_ID)) && sameBytes(params[5], uuidToBytes(row.owner)) && row.confirmed;
        return (changed = Number(matches));
      }
      if (squashSql(sql).startsWith("DELETE FROM auth_sessions")) {
        landed.revoked += changed > 0 ? 2 : 0;
        return (changed = changed > 0 ? 2 : 0);
      }
      landed.recorded += changed;
      return changed;
    });
    const replaced = await createFactorStore(client).replaceSecret(OTHER_ID, userId, SECRET, 61, 9_000, { keep: KEEP });
    landed.replaced = replaced.ok && replaced.data;
    return landed;
  }

  it("records one event and revokes for a confirmed row of the user's, and answers false with neither for a missing, unconfirmed or other user's row", async () => {
    expect([
      await landedOnReplace({ owner: USER_ID, confirmed: true }),
      await landedOnReplace(null),
      await landedOnReplace({ owner: USER_ID, confirmed: false }),
      await landedOnReplace({ owner: USER_ID, confirmed: true }, uuidv7()),
    ]).toEqual([
      { replaced: true, recorded: 1, revoked: 2 },
      { replaced: false, recorded: 0, revoked: 0 },
      { replaced: false, recorded: 0, revoked: 0 },
      { replaced: false, recorded: 0, revoked: 0 },
    ]);
  });

  it("signs every other session out once the secret is replaced, keeping the acting one, and none when no row matched", async () => {
    const replacedWith = async (matched: number) => {
      const seeded = await seededSessions(USER_ID, (sql) =>
        sql.startsWith("UPDATE auth_factors") || sql.startsWith("INSERT INTO auth_security_events") ? matched : null,
      );
      await createFactorStore(seeded.client).replaceSecret(OTHER_ID, USER_ID, SECRET, 61, 9_000, { keep: ACTING_SESSION });
      return seeded.live();
    };
    expect([await replacedWith(1), await replacedWith(0)]).toEqual([
      [true, false],
      [true, true],
    ]);
  });

  it("answers false for an id or owner that is not a UUID, without a statement", async () => {
    const [client, db] = writerOf(() => 1);
    const factors = createFactorStore(client);
    expect([
      await factors.replaceSecret("nope", USER_ID, SECRET, 61, 9_000, { keep: KEEP }),
      await factors.replaceSecret(OTHER_ID, "nope", SECRET, 61, 9_000, { keep: KEEP }),
      db.calls.length,
    ]).toEqual([{ ok: true, data: false }, { ok: true, data: false }, 0]);
  });

  it("reports a failing batch as `unavailable` under its own operation name", async () => {
    const [client] = clientOf(() => [], { failOn: () => new Error("D1_ERROR: network lost") });
    const replaced = await createFactorStore(client).replaceSecret(OTHER_ID, USER_ID, SECRET, 61, 9_000, { keep: KEEP });
    expect(replaced.ok === false && `${replaced.error.code} ${replaced.error.operation}`).toBe("unavailable factors.replaceSecret");
  });
});

const LOCKOUT = 900_000;

/** Whether `value` is a byte array holding exactly `bytes`, as SQLite compares two blobs. */
function sameBytes(value: unknown, bytes: Uint8Array): boolean {
  return value instanceof Uint8Array && value.length === bytes.length && value.every((byte, index) => byte === bytes[index]);
}

/** Whether the budget admitted the guess — the row is what a spend now answers, `null` the refusal. */
async function admits(spent: Promise<AuthStoreResult<AuthFactor | null>>): Promise<boolean> {
  const outcome = await spent;
  return outcome.ok && outcome.data !== null;
}

/** A row double that evaluates the adapter's own statement: the budget, the window and the reset it writes. */
function spendingRow(): [(sql: string, params: unknown[]) => number, (sql: string, params: unknown[]) => unknown[]] {
  let failed = 0;
  let updatedAt = 0;
  return [
    (sql) => {
      if (!sql.includes("SET failed_attempts = CASE")) failed = 0;
      return 1;
    },
    (sql, params) => {
      if (!sql.includes("SET failed_attempts = CASE")) return [];
      const [maxAttempts, lockedUntil, at] = params as [number, number, number];
      if (!(failed < maxAttempts || updatedAt <= lockedUntil)) return [];
      failed = failed >= maxAttempts && updatedAt <= lockedUntil ? 1 : failed + 1;
      updatedAt = at;
      return [
        {
          id: uuidToBytes(OTHER_ID),
          user_id: uuidToBytes(USER_ID),
          kind: "totp-app",
          secret: [9, 8, 7],
          last_counter: 41,
          failed_attempts: failed,
          confirmed_at: 6_000,
          created_at: 1,
          updated_at: at,
        },
      ];
    },
  ];
}
