import { describe, expect, it } from "bun:test";

import { uuidToBytes, uuidv7 } from "../../crypto/mod";
import { createD1Client } from "../../storage/db/client";
import type { D1Client, D1Database } from "../../storage/db/types";
import { nullLogger } from "../../testing/context";
import { fakeD1 } from "../../testing/fakes";
import type { FakeD1Options } from "../../testing/types";
import { createAdminUserStore } from "./admin-users";

const USER_ID = uuidv7();
const OTHER_ID = uuidv7();

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

  it("deletes every child row before the user, in one batch", async () => {
    const [client, db] = removerOf(1);
    expect(await createAdminUserStore(client).remove(USER_ID)).toEqual({ ok: true, data: "changed" });
    expect(db.calls.map((call) => /DELETE FROM (\w+)/.exec(call.sql)?.[1]).filter((table) => table !== undefined)).toEqual([
      "auth_credentials",
      "auth_factors",
      "auth_identity_links",
      "auth_otp_state",
      "auth_users",
    ]);
  });

  it("searches on the normalized key, so one mixed-case spelling of a mailbox matches", async () => {
    const [client, db] = clientOf(() => [userRow()]);
    const found = await createAdminUserStore(client).search("  AURORA@Example.TEST ");
    expect(found.ok && found.data.map((user) => user.emailKey)).toEqual(["aurora@example.test"]);
    expect(db.calls[0]?.sql).toContain("email_key LIKE ?");
    expect(db.calls[0]?.params).toEqual(["aurora@example.test%", 50]);
  });

  // Prefix-anchored so the unique index on `email_key` answers the search; a leading `%` made every
  // search a full scan. The product consequence: a substring mid-address no longer matches.
  it("anchors the pattern at the start, so the unique index on email_key can answer it", async () => {
    const [client, db] = clientOf(() => []);
    await createAdminUserStore(client).search("aurora");
    expect(db.calls[0]?.params[0]).toBe("aurora%");
    expect(String(db.calls[0]?.params[0]).startsWith("%")).toBe(false);
  });

  it("escapes the two LIKE wildcards a search term may itself carry", async () => {
    const [client, db] = clientOf(() => []);
    await createAdminUserStore(client).search("100%_a");
    expect(db.calls[0]?.params[0]).toBe("100\\%\\_a%");
    expect(db.calls[0]?.sql).toContain("ESCAPE '\\'");
  });
});

describe("createAdminUserStore — the last-admin guard", () => {
  const GUARD =
    "(is_admin = 0 OR deactivated_at IS NOT NULL OR (SELECT COUNT(*) FROM auth_users WHERE is_admin = 1 AND deactivated_at IS NULL) > 1)";

  it("carries the guard in the demoting statement's own WHERE, never in a read before it", async () => {
    const [client, db] = clientOf(() => [userRow({ is_admin: 1 })]);
    expect(await createAdminUserStore(client).setAdmin(USER_ID, false, 9_000)).toEqual({ ok: true, data: "last-admin-demote" });
    expect(db.calls[0]?.sql.replace(/\s+/g, " ")).toBe(`UPDATE auth_users SET is_admin = 0, updated_at = ? WHERE id = ? AND ${GUARD}`);
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
    const outcomes = await Promise.all([admins.setAdmin(USER_ID, false, 1), admins.setAdmin(OTHER_ID, false, 1)]);
    expect(outcomes.map((outcome) => outcome.ok && outcome.data).sort()).toEqual(["changed", "last-admin-demote"]);
    expect(activeAdmins).toBe(1);
  });

  it("refuses to deactivate the last admin, under a reason of its own", async () => {
    const [client, db] = clientOf(() => [userRow({ is_admin: 1 })]);
    expect(await createAdminUserStore(client).setDeactivated(USER_ID, true, 9_000)).toEqual({ ok: true, data: "last-admin-deactivate" });
    expect(db.calls[0]?.sql.replace(/\s+/g, " ")).toBe(`UPDATE auth_users SET deactivated_at = ?, updated_at = ? WHERE id = ? AND ${GUARD}`);
  });

  it("reactivates without the guard, because restoring an admin cannot leave a deployment with none", async () => {
    const [client, db] = writerOf(() => 1);
    expect(await createAdminUserStore(client).setDeactivated(USER_ID, false, 9_000)).toEqual({ ok: true, data: "changed" });
    expect(db.calls[0]?.sql).toContain("deactivated_at = NULL");
    expect(db.calls[0]?.sql).not.toContain("COUNT(*)");
  });

  it("exempts a deactivated admin from every guarded write, since one who cannot sign in cannot be the last standing", async () => {
    // Only the SQL is provable against a fake; `tests/workerd/auth-schema.test.ts` runs the same
    // clause against real D1 with a deactivated admin in the table.
    const [client, db] = writerOf(() => 1);
    const admins = createAdminUserStore(client);
    await admins.setAdmin(USER_ID, false, 1);
    await admins.setDeactivated(USER_ID, true, 1);
    for (const call of db.calls) expect(call.sql.replace(/\s+/g, " ")).toContain(GUARD);
  });

  it("refuses to delete the last admin, under a third reason, and leaves the children in place", async () => {
    const [client, db] = clientOf((sql) => (sql.includes("AS present") ? [{ present: 1, deletable: 0 }] : []));
    expect(await createAdminUserStore(client).remove(USER_ID)).toEqual({ ok: true, data: "last-admin-delete" });
    const deletes = db.calls.filter((call) => call.sql.includes("DELETE FROM"));
    expect(deletes).toHaveLength(5);
    for (const call of deletes) expect(call.sql.replace(/\s+/g, " ")).toContain(GUARD);
  });

  it("decides a delete on the DELETE's own rows-affected, not on the probe that named the refusal", async () => {
    const [client] = removerOf(0);
    const outcome = await createAdminUserStore(client).remove(USER_ID);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.error.code).toBe("unavailable");
    expect(outcome.ok === false && outcome.error.operation).toBe("adminUsers.remove");
  });

  it("elevates without the guard, and reports a missing id on every write rather than success", async () => {
    const [client] = writerOf(() => 0);
    const admins = createAdminUserStore(client);
    expect(await admins.setAdmin(USER_ID, true, 1)).toEqual({ ok: true, data: "not-found" });
    expect(await admins.setAdmin(USER_ID, false, 1)).toEqual({ ok: true, data: "not-found" });
    expect(await admins.setDeactivated(USER_ID, true, 1)).toEqual({ ok: true, data: "not-found" });
    expect(await admins.setDeactivated(USER_ID, false, 1)).toEqual({ ok: true, data: "not-found" });
    expect(await admins.remove(USER_ID)).toEqual({ ok: true, data: "not-found" });
  });

  it("changes what it was asked to change when the guard is satisfied", async () => {
    const [client] = writerOf(() => 1);
    const admins = createAdminUserStore(client);
    expect(await admins.setAdmin(USER_ID, false, 1)).toEqual({ ok: true, data: "changed" });
    expect(await admins.setDeactivated(USER_ID, true, 1)).toEqual({ ok: true, data: "changed" });
  });
});
