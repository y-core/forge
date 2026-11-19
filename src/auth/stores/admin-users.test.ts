import { describe, expect, it } from "bun:test";

import { createD1Client } from "../../storage/db/client";
import type { D1Client, D1Database } from "../../storage/db/types";
import { uuidToBytes, uuidv7 } from "../../storage/db/uuid";
import { nullLogger } from "../../testing/context";
import { fakeD1 } from "../../testing/fakes";
import type { FakeD1Options } from "../../testing/types";
import { createAdminUserStore } from "./admin-users";
import { eventParams, securityEventText, squashSql } from "./events.fixture";

const USER_ID = uuidv7();
const OTHER_ID = uuidv7();
const ADMIN_ID = uuidv7();
const GUARD = "(is_admin = 0 OR deactivated_at IS NOT NULL OR (SELECT COUNT(*) FROM auth_users WHERE is_admin = 1 AND deactivated_at IS NULL) > 1)";

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

/** Every batch `db` runs, as its whitespace-squashed statements. */
function batchesOf(db: FakeDb): string[][] {
  const batches: string[][] = [];
  const batch = db.batch;
  db.batch = (statements) => {
    batches.push(statements.map((statement) => squashSql((statement as unknown as { sql: string }).sql)));
    return batch(statements);
  };
  return batches;
}

/** A client whose delete batch finds the user deletable and whose final `DELETE` reports `deleted` rows. */
function removerOf(deleted: number): [D1Client, FakeDb] {
  return clientOf((sql) => (sql.includes("AS present") ? [{ present: 1, deletable: 1 }] : []), {
    rowsWritten: (sql) => (sql.includes("DELETE FROM auth_users") ? deleted : 0),
  });
}

function userRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: uuidToBytes(USER_ID),
    email: "Aurora@Example.test",
    email_key: "aurora@example.test",
    email_verified_at: null,
    webauthn_id: null,
    is_admin: 0,
    deactivated_at: null,
    created_at: 1_000,
    updated_at: 2_000,
    ...overrides,
  };
}

describe("createAdminUserStore", () => {
  it("pages newest-first off the time-ordered primary key, with no created_at index", async () => {
    const [client, db] = clientOf(() => []);
    await createAdminUserStore(client).list({ limit: 10, after: OTHER_ID });
    expect(db.calls[0]?.sql).toContain("ORDER BY id DESC");
    expect(db.calls[0]?.sql).not.toContain("created_at");
    expect(db.calls[0]?.params).toEqual([uuidToBytes(OTHER_ID), 10]);
  });

  it("counts admins in one statement", async () => {
    const [client, db] = clientOf(() => [{ total: 2 }]);
    expect(await createAdminUserStore(client).countAdmins()).toEqual({ ok: true, data: 2 });
    expect(db.calls).toHaveLength(1);
  });

  it("counts only admins who could still sign in, so it agrees with the guard behind the writes", async () => {
    const [client, db] = clientOf(() => [{ total: 1 }]);
    await createAdminUserStore(client).countAdmins();
    expect(db.calls[0]?.sql).toContain("is_admin = 1 AND deactivated_at IS NULL");
  });

  it("reports zero admins when the count query returns no row", async () => {
    const [client] = clientOf(() => []);
    expect(await createAdminUserStore(client).countAdmins()).toEqual({ ok: true, data: 0 });
  });

  it("deletes only the user in one batch beside its probe, leaving the children to the schema's cascade", async () => {
    const [client, db] = removerOf(1);
    const batches = batchesOf(db);
    expect(await createAdminUserStore(client).remove(USER_ID)).toEqual({ ok: true, data: "changed" });
    expect(batches.map((batch) => batch.map((statement) => /^(SELECT|DELETE FROM \w+)/.exec(statement)?.[1]))).toEqual([
      ["SELECT", "DELETE FROM auth_users"],
    ]);
  });

  it("searches on the normalized key, so one mixed-case spelling of a mailbox matches", async () => {
    const [client, db] = clientOf(() => [userRow()]);
    const found = await createAdminUserStore(client).search("  AURORA@Example.TEST ");
    expect(found.ok && found.data.map((user) => user.emailKey)).toEqual(["aurora@example.test"]);
    expect(db.calls[0]?.sql).toContain("email_key >= ? AND email_key < ?");
    expect(db.calls[0]?.params).toEqual(["aurora@example.test", "aurora@example.tesu", 50]);
  });

  it("bounds the search to keys starting with the term, so a mid-address substring is outside the range", async () => {
    const [client, db] = clientOf(() => []);
    await createAdminUserStore(client).search("aurora");
    expect(db.calls[0]?.params).toEqual(["aurora", "aurorb", 50]);
  });

  it("treats `%` and `_` as literal characters", async () => {
    const [client, db] = clientOf(() => []);
    await createAdminUserStore(client).search("100%_a");
    expect(db.calls[0]?.params).toEqual(["100%_a", "100%_b", 50]);
    expect(db.calls[0]?.sql).not.toContain("LIKE");
  });

  it("carries past U+10FFFF into the code point before it", async () => {
    const [client, db] = clientOf(() => []);
    await createAdminUserStore(client).search("a\u{10FFFF}");
    expect(db.calls[0]?.params).toEqual(["a\u{10FFFF}", "b", 50]);
  });

  it("steps over the surrogate gap from U+D7FF to U+E000", async () => {
    const [client, db] = clientOf(() => []);
    await createAdminUserStore(client).search("\u{D7FF}");
    expect(db.calls[0]?.params).toEqual(["\u{D7FF}", "\u{E000}", 50]);
  });

  it("drops the upper bound for an empty term, which every key starts with", async () => {
    const [client, db] = clientOf(() => []);
    await createAdminUserStore(client).search("");
    expect(db.calls[0]?.sql).toContain("WHERE email_key >= ? ORDER BY");
    expect(db.calls[0]?.params).toEqual(["", 50]);
  });

  it("keeps the range under a cursor, paging below it", async () => {
    const [client, db] = clientOf(() => []);
    await createAdminUserStore(client).search("ada", { after: OTHER_ID });
    expect(db.calls[0]?.sql).toContain("email_key >= ? AND email_key < ? AND id < ?");
    expect(db.calls[0]?.params).toEqual(["ada", "adb", uuidToBytes(OTHER_ID), 50]);
  });
});

describe("createAdminUserStore — resetFactors", () => {
  const flat = (sql: string) => sql.replace(/\s+/g, " ").trim();

  function resetterOf(present: number): [D1Client, FakeDb] {
    return clientOf((sql) => (sql.includes("AS present") ? [{ present }] : []), { rowsWritten: () => 1 });
  }

  it("probes, records the reset under the acting admin, deletes every credential, factor and recovery code, revokes the access tokens, and deletes the sessions, in one batch", async () => {
    const [client, db] = resetterOf(1);
    expect(await createAdminUserStore(client).resetFactors(USER_ID, 9_000, ADMIN_ID)).toEqual({ ok: true, data: "changed" });
    const key = uuidToBytes(USER_ID);
    expect(db.calls.map((call, index) => ({ sql: flat(call.sql), params: index === 1 ? eventParams(call.params) : call.params }))).toEqual([
      { sql: "SELECT COUNT(*) AS present FROM auth_users WHERE id = ?", params: [key] },
      {
        sql: securityEventText({ guard: "EXISTS (SELECT 1 FROM auth_users WHERE id = ?)" }),
        params: ["event-id", key, "factors-reset", null, uuidToBytes(ADMIN_ID), 9_000, key],
      },
      { sql: "DELETE FROM auth_credentials WHERE user_id = ?", params: [key] },
      { sql: "DELETE FROM auth_factors WHERE user_id = ?", params: [key] },
      { sql: "DELETE FROM auth_recovery_codes WHERE user_id = ?", params: [key] },
      { sql: "UPDATE auth_access_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", params: [9_000, key] },
      { sql: "DELETE FROM auth_sessions WHERE user_id = ?", params: [key] },
    ]);
  });

  it("leaves the identity links and one-time codes alone", async () => {
    const [client, db] = resetterOf(1);
    await createAdminUserStore(client).resetFactors(USER_ID, 9_000, ADMIN_ID);
    const touched = db.calls.map((call) => /(?:FROM|UPDATE) (auth_\w+)/.exec(call.sql)?.[1]);
    expect(touched.filter((table) => ["auth_identity_links", "auth_otp_state"].includes(table ?? ""))).toEqual([]);
  });

  it("answers `not-found` when the probe finds no such user", async () => {
    const [client] = resetterOf(0);
    expect(await createAdminUserStore(client).resetFactors(USER_ID, 9_000, ADMIN_ID)).toEqual({ ok: true, data: "not-found" });
  });

  it("answers `not-found` for an id that is not a UUID, without a statement", async () => {
    const [client, db] = resetterOf(1);
    expect({ outcome: await createAdminUserStore(client).resetFactors("nope", 9_000, ADMIN_ID), calls: db.calls.length }).toEqual({
      outcome: { ok: true, data: "not-found" },
      calls: 0,
    });
  });

  it("reports a failing batch as `unavailable` under its own operation name", async () => {
    const [client] = clientOf(() => [], { failOn: () => new Error("D1_ERROR: network lost") });
    const outcome = await createAdminUserStore(client).resetFactors(USER_ID, 9_000, ADMIN_ID);
    expect(outcome.ok === false && `${outcome.error.code} ${outcome.error.operation}`).toBe("unavailable adminUsers.resetFactors");
  });
});

describe("createAdminUserStore — the sessions a deactivation ends", () => {
  it("records the deactivation under the acting admin directly after the state change, then deletes the user's sessions, in one batch", async () => {
    const [client, db] = writerOf(() => 1);
    const batches = batchesOf(db);
    expect(await createAdminUserStore(client).setDeactivated(USER_ID, true, 9_000, ADMIN_ID)).toEqual({ ok: true, data: "changed" });
    const key = uuidToBytes(USER_ID);
    expect({ batches, event: eventParams(db.calls[1]?.params), deleted: db.calls[2]?.params }).toEqual({
      batches: [
        [
          `UPDATE auth_users SET deactivated_at = ?, updated_at = ? WHERE id = ? AND deactivated_at IS NULL AND ${GUARD}`,
          securityEventText({ guard: "changes() > 0" }),
          "DELETE FROM auth_sessions WHERE user_id = ? AND user_id IN (SELECT id FROM auth_users WHERE id = ? AND deactivated_at IS NOT NULL)",
        ],
      ],
      event: ["event-id", key, "account-deactivated", null, uuidToBytes(ADMIN_ID), 9_000],
      deleted: [key, key],
    });
  });

  it("records the reactivation under the acting admin directly after the state change, in one batch that ends no session", async () => {
    const [client, db] = writerOf(() => 1);
    const batches = batchesOf(db);
    expect(await createAdminUserStore(client).setDeactivated(USER_ID, false, 9_000, ADMIN_ID)).toEqual({ ok: true, data: "changed" });
    expect({ batches, event: eventParams(db.calls[1]?.params) }).toEqual({
      batches: [
        [
          "UPDATE auth_users SET deactivated_at = NULL, updated_at = ? WHERE id = ? AND deactivated_at IS NOT NULL",
          securityEventText({ guard: "changes() > 0" }),
        ],
      ],
      event: ["event-id", uuidToBytes(USER_ID), "account-reactivated", null, uuidToBytes(ADMIN_ID), 9_000],
    });
  });

  it("matches only an account not already in the asked-for state, so a no-op changes no row, records no event and answers `unchanged`", async () => {
    // The fake answers `changes() > 0` from the write before it, as SQLite does.
    let changed = 0;
    let recorded = 0;
    const [client, db] = writerOf(
      (sql) => {
        if (!sql.includes("auth_security_events")) return (changed = 0);
        const lands = Number(!sql.includes("changes() > 0") || changed > 0);
        recorded += lands;
        return lands;
      },
      (sql) => (sql.includes("AS held") ? [{ held: 1 }] : []),
    );
    const admins = createAdminUserStore(client);
    expect({
      outcomes: [
        await admins.setDeactivated(USER_ID, true, 9_000, ADMIN_ID),
        await admins.setDeactivated(USER_ID, false, 9_000, ADMIN_ID),
        await admins.setAdmin(USER_ID, true, 9_000, ADMIN_ID),
        await admins.setAdmin(USER_ID, false, 9_000, ADMIN_ID),
      ].map((outcome) => outcome.ok && outcome.data),
      recorded,
    }).toEqual({ outcomes: ["unchanged", "unchanged", "unchanged", "unchanged"], recorded: 0 });
    expect(db.calls.filter((call) => call.sql.startsWith("UPDATE auth_users")).map((call) => squashSql(call.sql))).toEqual([
      `UPDATE auth_users SET deactivated_at = ?, updated_at = ? WHERE id = ? AND deactivated_at IS NULL AND ${GUARD}`,
      "UPDATE auth_users SET deactivated_at = NULL, updated_at = ? WHERE id = ? AND deactivated_at IS NOT NULL",
      "UPDATE auth_users SET is_admin = 1, updated_at = ? WHERE id = ? AND is_admin = 0",
      `UPDATE auth_users SET is_admin = 0, updated_at = ? WHERE id = ? AND is_admin = 1 AND ${GUARD}`,
    ]);
  });

  it("reads whether a declined write found the state already held, asking the question its own direction asks", async () => {
    const [client, db] = writerOf(
      () => 0,
      () => [{ held: 0 }],
    );
    const admins = createAdminUserStore(client);
    await admins.setDeactivated(USER_ID, true, 1, ADMIN_ID);
    await admins.setDeactivated(USER_ID, false, 1, ADMIN_ID);
    await admins.setAdmin(USER_ID, true, 1, ADMIN_ID);
    await admins.setAdmin(USER_ID, false, 1, ADMIN_ID);
    expect(db.calls.filter((call) => call.sql.startsWith("SELECT")).map((call) => squashSql(call.sql))).toEqual([
      "SELECT (deactivated_at IS NOT NULL) AS held FROM auth_users WHERE id = ? LIMIT 1",
      "SELECT (deactivated_at IS NULL) AS held FROM auth_users WHERE id = ? LIMIT 1",
      "SELECT (is_admin = 1) AS held FROM auth_users WHERE id = ? LIMIT 1",
      "SELECT (is_admin = 0) AS held FROM auth_users WHERE id = ? LIMIT 1",
    ]);
  });

  it("tells a refused deactivation from one already in place, reading the row only once the guarded write has declined", async () => {
    const outcomeWith = async (row: Record<string, unknown> | null) => {
      const [client] = writerOf(
        () => 0,
        () => (row === null ? [] : [row]),
      );
      return createAdminUserStore(client).setDeactivated(USER_ID, true, 9_000, ADMIN_ID);
    };
    expect([await outcomeWith({ held: 0 }), await outcomeWith({ held: 1 }), await outcomeWith(null)]).toEqual([
      { ok: true, data: "last-admin-deactivate" },
      { ok: true, data: "unchanged" },
      { ok: true, data: "not-found" },
    ]);
  });

  it("reads the outcome off the deactivating statement, not off how many sessions went", async () => {
    const [none] = writerOf((sql) => (sql.startsWith("UPDATE") ? 1 : 0));
    const [refused] = writerOf(
      (sql) => (sql.startsWith("DELETE") ? 3 : 0),
      () => [{ held: 0 }],
    );
    expect([
      await createAdminUserStore(none).setDeactivated(USER_ID, true, 9_000, ADMIN_ID),
      await createAdminUserStore(refused).setDeactivated(USER_ID, true, 9_000, ADMIN_ID),
    ]).toEqual([
      { ok: true, data: "changed" },
      { ok: true, data: "last-admin-deactivate" },
    ]);
  });

  it("issues no session statement on reactivation, so nothing a deactivation ended comes back", async () => {
    const [client, db] = writerOf(() => 1);
    await createAdminUserStore(client).setDeactivated(USER_ID, false, 9_000, ADMIN_ID);
    expect(db.calls.filter((call) => call.sql.includes("auth_sessions"))).toEqual([]);
  });

  it("reports a failing deactivation batch as `unavailable` under its own operation name", async () => {
    const [client] = clientOf(undefined, { failOn: () => new Error("D1_ERROR: network connection lost") });
    const outcome = await createAdminUserStore(client).setDeactivated(USER_ID, true, 9_000, ADMIN_ID);
    expect(!outcome.ok && [outcome.error.code, outcome.error.operation]).toEqual(["unavailable", "adminUsers.setDeactivated"]);
  });
});

describe("createAdminUserStore — the last-admin guard", () => {
  it("carries the guard in the demoting statement's own WHERE, never in a read before it", async () => {
    const [client, db] = clientOf(() => [userRow({ is_admin: 1 })]);
    expect(await createAdminUserStore(client).setAdmin(USER_ID, false, 9_000, ADMIN_ID)).toEqual({ ok: true, data: "last-admin-demote" });
    expect(db.calls[0]?.sql.replace(/\s+/g, " ")).toBe(
      `UPDATE auth_users SET is_admin = 0, updated_at = ? WHERE id = ? AND is_admin = 1 AND ${GUARD}`,
    );
  });

  it("refuses the second of two concurrent demotions, so exactly one succeeds", async () => {
    // The fake answers the guard the way the database would: the count is read by the statement
    // that writes, so the loser sees one admin left and changes nothing.
    let activeAdmins = 2;
    const [client] = writerOf(
      (sql) => {
        if (!sql.includes("SET is_admin = 0")) return 0;
        if (activeAdmins <= 1) return 0;
        activeAdmins -= 1;
        return 1;
      },
      () => [userRow({ is_admin: 1 })],
    );
    const admins = createAdminUserStore(client);
    const outcomes = await Promise.all([admins.setAdmin(USER_ID, false, 1, ADMIN_ID), admins.setAdmin(OTHER_ID, false, 1, ADMIN_ID)]);
    expect(outcomes.map((outcome) => outcome.ok && outcome.data).sort()).toEqual(["changed", "last-admin-demote"]);
    expect(activeAdmins).toBe(1);
  });

  it("refuses to deactivate the last admin, under a reason of its own", async () => {
    const [client, db] = clientOf(() => [userRow({ is_admin: 1 })]);
    expect(await createAdminUserStore(client).setDeactivated(USER_ID, true, 9_000, ADMIN_ID)).toEqual({ ok: true, data: "last-admin-deactivate" });
    expect(db.calls[0]?.sql.replace(/\s+/g, " ")).toBe(
      `UPDATE auth_users SET deactivated_at = ?, updated_at = ? WHERE id = ? AND deactivated_at IS NULL AND ${GUARD}`,
    );
  });

  it("reactivates without the guard, because restoring an admin cannot leave a deployment with none", async () => {
    const [client, db] = writerOf(() => 1);
    expect(await createAdminUserStore(client).setDeactivated(USER_ID, false, 9_000, ADMIN_ID)).toEqual({ ok: true, data: "changed" });
    expect(db.calls[0]?.sql).toContain("deactivated_at = NULL");
    expect(db.calls[0]?.sql).not.toContain("COUNT(*)");
  });

  it("exempts a deactivated admin from every guarded write, since one who cannot sign in cannot be the last standing", async () => {
    // Only the SQL is provable against a fake; `tests/workerd/auth-schema.workerd.ts` runs the same
    // clause against real D1 with a deactivated admin in the table.
    const [client, db] = writerOf(() => 1);
    const admins = createAdminUserStore(client);
    await admins.setAdmin(USER_ID, false, 1, ADMIN_ID);
    await admins.setDeactivated(USER_ID, true, 1, ADMIN_ID);
    const writes = db.calls.filter((call) => call.sql.startsWith("UPDATE auth_users"));
    expect(writes).toHaveLength(2);
    for (const call of writes) expect(call.sql.replace(/\s+/g, " ")).toContain(GUARD);
  });

  it("refuses to delete the last admin, under a third reason, through the one guarded delete", async () => {
    const [client, db] = clientOf((sql) => (sql.includes("AS present") ? [{ present: 1, deletable: 0 }] : []));
    expect(await createAdminUserStore(client).remove(USER_ID)).toEqual({ ok: true, data: "last-admin-delete" });
    const deletes = db.calls.filter((call) => call.sql.includes("DELETE FROM"));
    expect(deletes.map((call) => /DELETE FROM (\w+)/.exec(call.sql)?.[1])).toEqual(["auth_users"]);
    expect(deletes[0]?.sql.replace(/\s+/g, " ")).toContain(GUARD);
  });

  it("decides a delete on the DELETE's own rows-affected, not on the probe that named the refusal", async () => {
    const [client] = removerOf(0);
    const outcome = await createAdminUserStore(client).remove(USER_ID);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.error.code).toBe("unavailable");
    expect(outcome.ok === false && outcome.error.operation).toBe("adminUsers.remove");
  });

  const appKeyRefusals = [
    { rule: "foreign key", error: "D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT" },
    { rule: "NOT NULL", error: "D1_ERROR: NOT NULL constraint failed: app_devices.sid: SQLITE_CONSTRAINT" },
    { rule: "CHECK", error: "D1_ERROR: CHECK constraint failed: owner IS NOT NULL: SQLITE_CONSTRAINT" },
  ];

  for (const { rule, error } of appKeyRefusals) {
    it(`answers referenced, not an error, when a ${rule} constraint an app key's action raises refuses the user row`, async () => {
      const [client] = clientOf((sql) => (sql.includes("AS present") ? [{ present: 1, deletable: 1 }] : []), {
        failOn: (sql) => (sql.includes("DELETE FROM auth_users") ? new Error(error) : null),
      });
      expect(await createAdminUserStore(client).remove(USER_ID)).toEqual({ ok: true, data: "referenced" });
    });
  }

  it("reports a UNIQUE refusal of the delete batch as an AuthStoreError, not as referenced", async () => {
    const [client] = clientOf((sql) => (sql.includes("AS present") ? [{ present: 1, deletable: 1 }] : []), {
      failOn: (sql) =>
        sql.includes("DELETE FROM auth_users") ? new Error("D1_ERROR: UNIQUE constraint failed: app_archive.id: SQLITE_CONSTRAINT") : null,
    });
    const outcome = await createAdminUserStore(client).remove(USER_ID);
    expect(outcome.ok === false && `${outcome.error.code} ${outcome.error.operation}`).toBe("conflict adminUsers.remove");
  });

  it("reports any other failure of the delete batch as unavailable", async () => {
    const [client] = clientOf((sql) => (sql.includes("AS present") ? [{ present: 1, deletable: 1 }] : []), {
      failOn: (sql) => (sql.includes("DELETE FROM auth_users") ? new Error("D1_ERROR: network lost") : null),
    });
    const outcome = await createAdminUserStore(client).remove(USER_ID);
    expect(outcome.ok === false && `${outcome.error.code} ${outcome.error.operation}`).toBe("unavailable adminUsers.remove");
  });

  it("carries the first-admin guard in the claiming statement's own WHERE, never in a read before it", async () => {
    const [client, db] = clientOf(() => [userRow()]);
    expect(await createAdminUserStore(client).claimFirstAdmin(USER_ID, 9_000)).toEqual({ ok: true, data: "admin-exists" });
    expect(db.calls[0]?.sql.replace(/\s+/g, " ")).toBe(
      "UPDATE auth_users SET is_admin = 1, updated_at = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM auth_users WHERE is_admin = 1 AND deactivated_at IS NULL)",
    );
  });

  it("records the grant, then moves the claimant's session onto the new token, in the claim's own batch, each only after the one before it landed", async () => {
    const [client, db] = writerOf(() => 1);
    const rotation = { replaces: new Uint8Array(32).fill(1), tokenHash: new Uint8Array(32).fill(2) };
    expect(await createAdminUserStore(client).claimFirstAdmin(USER_ID, 9_000, rotation)).toEqual({ ok: true, data: "changed" });
    const key = uuidToBytes(USER_ID);
    expect(db.calls.map((call, index) => [squashSql(call.sql), index === 1 ? eventParams(call.params) : call.params])).toEqual([
      [
        "UPDATE auth_users SET is_admin = 1, updated_at = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM auth_users WHERE is_admin = 1 AND deactivated_at IS NULL)",
        [9_000, key],
      ],
      [securityEventText({ session: true, guard: "changes() > 0" }), ["event-id", key, "admin-granted", null, rotation.replaces, key, 9_000]],
      ["UPDATE auth_sessions SET token_hash = ? WHERE token_hash = ? AND changes() > 0", [rotation.tokenHash, rotation.replaces]],
    ]);
  });

  it("gives a second claimer neither an event nor a rotation, since each guard reads a write that changed nothing", async () => {
    // Each statement answers `changes() > 0` from the write before it, as SQLite does.
    let changed = 0;
    let rotated = 0;
    const [client] = writerOf(
      (sql) => {
        const written = sql.includes("SET is_admin = 1") ? 0 : sql.includes("changes() > 0") ? Number(changed > 0) : 0;
        if (sql.startsWith("UPDATE auth_sessions")) rotated += written;
        changed = written;
        return written;
      },
      () => [userRow()],
    );
    const rotation = { replaces: new Uint8Array(32).fill(1), tokenHash: new Uint8Array(32).fill(2) };
    expect({ outcome: await createAdminUserStore(client).claimFirstAdmin(USER_ID, 9_000, rotation), rotated }).toEqual({
      outcome: { ok: true, data: "admin-exists" },
      rotated: 0,
    });
  });

  it("names no session on a claim made without a rotation", async () => {
    const [client, db] = writerOf(() => 1);
    await createAdminUserStore(client).claimFirstAdmin(USER_ID, 9_000);
    expect(db.calls.map((call) => squashSql(call.sql))[1]).toBe(securityEventText({ guard: "changes() > 0" }));
  });

  it("records a grant or a revocation under the acting admin directly after the role change, in one batch", async () => {
    const [client, db] = writerOf(() => 1);
    const batches = batchesOf(db);
    const admins = createAdminUserStore(client);
    await admins.setAdmin(USER_ID, true, 9_000, ADMIN_ID);
    await admins.setAdmin(USER_ID, false, 9_000, ADMIN_ID);
    const events = db.calls.filter((call) => call.sql.includes("auth_security_events")).map((call) => eventParams(call.params));
    expect({ batches: batches.map((batch) => batch[1]), events }).toEqual({
      batches: [securityEventText({ guard: "changes() > 0" }), securityEventText({ guard: "changes() > 0" })],
      events: [
        ["event-id", uuidToBytes(USER_ID), "admin-granted", null, uuidToBytes(ADMIN_ID), 9_000],
        ["event-id", uuidToBytes(USER_ID), "admin-revoked", null, uuidToBytes(ADMIN_ID), 9_000],
      ],
    });
  });

  it("refuses an acting admin id that is not a UUID without a statement, on every write that records one", async () => {
    const [client, db] = writerOf(() => 1);
    const admins = createAdminUserStore(client);
    const outcomes = [
      await admins.setAdmin(USER_ID, true, 1, "nope"),
      await admins.setDeactivated(USER_ID, true, 1, "nope"),
      await admins.resetFactors(USER_ID, 1, "nope"),
    ];
    expect({ outcomes: outcomes.map((outcome) => outcome.ok && outcome.data), calls: db.calls.length }).toEqual({
      outcomes: ["not-found", "not-found", "not-found"],
      calls: 0,
    });
  });

  it("reports a failing role-change batch as `unavailable`, issuing no refusal read after it", async () => {
    const [client, db] = clientOf(() => [], {
      failOn: (sql) => (sql.includes("auth_security_events") ? new Error("D1_ERROR: network lost") : null),
    });
    const outcome = await createAdminUserStore(client).setAdmin(USER_ID, false, 9_000, ADMIN_ID);
    expect({ failure: outcome.ok === false && outcome.error.operation, reads: db.calls.filter((call) => call.sql.startsWith("SELECT")) }).toEqual({
      failure: "adminUsers.setAdmin",
      reads: [],
    });
  });

  it("answers by the claim's own write, so a rotation statement reporting a row cannot turn a refused claim into a landed one", async () => {
    const [client] = writerOf(
      (sql) => (sql.includes("SET is_admin = 1") ? 0 : 1),
      () => [userRow()],
    );
    const rotation = { replaces: new Uint8Array(32).fill(1), tokenHash: new Uint8Array(32).fill(2) };
    expect(await createAdminUserStore(client).claimFirstAdmin(USER_ID, 9_000, rotation)).toEqual({ ok: true, data: "admin-exists" });
  });

  it("surfaces a failed rotation as the claim's own failure, never as a landed claim", async () => {
    const [client] = clientOf(() => [userRow()], {
      failOn: (sql) => (sql.includes("UPDATE auth_sessions") ? new Error("D1_ERROR: network lost") : null),
    });
    const rotation = { replaces: new Uint8Array(32).fill(1), tokenHash: new Uint8Array(32).fill(2) };
    const outcome = await createAdminUserStore(client).claimFirstAdmin(USER_ID, 9_000, rotation);
    expect(outcome.ok === false && `${outcome.error.code} ${outcome.error.operation}`).toBe("unavailable adminUsers.claimFirstAdmin");
  });

  it("refuses the second of two concurrent first-admin claims, so exactly one succeeds", async () => {
    let activeAdmins = 0;
    const [client] = writerOf(
      (sql) => {
        if (!sql.includes("SET is_admin = 1")) return 0;
        if (activeAdmins >= 1) return 0;
        activeAdmins += 1;
        return 1;
      },
      () => [userRow()],
    );
    const admins = createAdminUserStore(client);
    const outcomes = await Promise.all([admins.claimFirstAdmin(USER_ID, 1), admins.claimFirstAdmin(OTHER_ID, 1)]);
    expect(outcomes.map((outcome) => outcome.ok && outcome.data).sort()).toEqual(["admin-exists", "changed"]);
    expect(activeAdmins).toBe(1);
  });

  it("tells a refused claim from a row that is gone, rather than reporting both as one", async () => {
    const [client] = writerOf(
      () => 0,
      () => [],
    );
    expect(await createAdminUserStore(client).claimFirstAdmin(USER_ID, 1)).toEqual({ ok: true, data: "not-found" });
  });

  it("elevates without the guard, and reports a missing id on every write rather than success", async () => {
    const [client] = writerOf(() => 0);
    const admins = createAdminUserStore(client);
    expect(await admins.setAdmin(USER_ID, true, 1, ADMIN_ID)).toEqual({ ok: true, data: "not-found" });
    expect(await admins.setAdmin(USER_ID, false, 1, ADMIN_ID)).toEqual({ ok: true, data: "not-found" });
    expect(await admins.setDeactivated(USER_ID, true, 1, ADMIN_ID)).toEqual({ ok: true, data: "not-found" });
    expect(await admins.setDeactivated(USER_ID, false, 1, ADMIN_ID)).toEqual({ ok: true, data: "not-found" });
    expect(await admins.remove(USER_ID)).toEqual({ ok: true, data: "not-found" });
  });

  it("promotes a second admin through `setAdmin`, which the first-admin guard must not reach", async () => {
    const [client, db] = writerOf(() => 1);
    expect(await createAdminUserStore(client).setAdmin(OTHER_ID, true, 1, ADMIN_ID)).toEqual({ ok: true, data: "changed" });
    expect(db.calls[0]?.sql).not.toContain("NOT EXISTS");
  });

  it("changes what it was asked to change when the guard is satisfied", async () => {
    const [client] = writerOf(() => 1);
    const admins = createAdminUserStore(client);
    expect(await admins.setAdmin(USER_ID, false, 1, ADMIN_ID)).toEqual({ ok: true, data: "changed" });
    expect(await admins.setDeactivated(USER_ID, true, 1, ADMIN_ID)).toEqual({ ok: true, data: "changed" });
  });
});
