import { describe, expect, it } from "bun:test";

import { createD1Client } from "../../storage/db/client";
import type { D1Client, D1Database } from "../../storage/db/types";
import { uuidToBytes, uuidv7 } from "../../storage/db/uuid";
import { nullLogger } from "../../testing/context";
import { fakeD1 } from "../../testing/fakes";
import type { FakeD1Options } from "../../testing/types";
import { createCredentialStore } from "./credentials";
import { eventParams, securityEventText, squashSql } from "./events.fixture";
import { ACTING_SESSION, seededSessions } from "./sessions.fixture";

const USER_ID = uuidv7();
const OTHER_ID = uuidv7();
const KEEP = new Uint8Array(32).fill(7);
const ORIGIN = { keep: KEEP };
const HELD = "EXISTS (SELECT 1 FROM auth_credentials WHERE id = ? AND user_id = ?)";
const COUNTED = "user_id = ? AND confirmed_at IS NOT NULL AND kind IN (SELECT value FROM json_each(?))";
const LAST_PASSKEY = "kind = ? AND NOT EXISTS (SELECT 1 FROM auth_credentials WHERE user_id = ? AND id != ?)";
const REMAINS = `NOT EXISTS (SELECT 1 FROM auth_factors WHERE ${COUNTED} AND (${LAST_PASSKEY}))`;
const HOLDS_RECOVERABLE =
  "EXISTS (SELECT 1 FROM auth_factors WHERE user_id = ? AND kind IN (SELECT value FROM json_each(?)) AND confirmed_at IS NOT NULL)";

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

function sameBytes(value: unknown, expected: Uint8Array): boolean {
  return value instanceof Uint8Array && value.length === expected.length && value.every((byte, i) => byte === expected[i]);
}

describe("createCredentialStore", () => {
  it("stores transports as JSON and reads an absent list back as empty", async () => {
    const [client, db] = clientOf();
    await createCredentialStore(client).create(
      {
        userId: USER_ID,
        credentialId: "Y3JlZA",
        publicKey: new Uint8Array([4, 5]),
        algorithm: -7,
        signCount: 0,
        transports: ["internal", "hybrid"],
      },
      7_000,
      ORIGIN,
    );
    expect(db.calls[0]?.params).toContain('["internal","hybrid"]');

    const [reader] = clientOf(() => [
      {
        id: uuidToBytes(OTHER_ID),
        user_id: uuidToBytes(USER_ID),
        credential_id: "Y3JlZA",
        public_key: [4, 5],
        algorithm: -7,
        sign_count: 3,
        transports: null,
        backup_eligible: 1,
        backed_up: 0,
        label: null,
        last_used_at: null,
        created_at: 1,
        updated_at: 2,
      },
    ]);
    const found = await createCredentialStore(reader).findByCredentialId("Y3JlZA");
    expect(found.ok && found.data).toEqual({
      id: OTHER_ID,
      userId: USER_ID,
      credentialId: "Y3JlZA",
      publicKey: new Uint8Array([4, 5]),
      algorithm: -7,
      signCount: 3,
      transports: [],
      backupEligible: true,
      backedUp: false,
      label: null,
      lastUsedAt: null,
      createdAt: 1,
      updatedAt: 2,
    });
  });

  it("looks a credential up by the base64url id the browser reports, with no decode step", async () => {
    const [client, db] = clientOf(() => []);
    await createCredentialStore(client).findByCredentialId("Y3JlZA");
    expect(db.calls[0]?.params).toEqual(["Y3JlZA"]);
  });

  it("records a use with the new sign count, the backup flag and the timestamp", async () => {
    const [client, db] = writerOf(() => 1);
    expect(await createCredentialStore(client).recordUse(OTHER_ID, 12, true, 8_000)).toEqual({ ok: true, data: true });
    expect(db.calls[0]?.params).toEqual([12, 1, 8_000, 8_000, uuidToBytes(OTHER_ID), 12, 12]);
  });

  it("reports a use recorded against a missing credential, rather than returning success", async () => {
    const [client] = writerOf(() => 0);
    expect(await createCredentialStore(client).recordUse(OTHER_ID, 12, true, 8_000)).toEqual({ ok: true, data: false });
  });

  it("carries the sign-count rule in the statement, so the database and not the caller refuses a repeat", async () => {
    const [client, db] = writerOf(() => 1);
    await createCredentialStore(client).recordUse(OTHER_ID, 12, true, 8_000);
    expect(db.calls[0]?.sql.replace(/\s+/g, " ")).toBe(
      "UPDATE auth_credentials SET sign_count = ?, backed_up = ?, last_used_at = ?, updated_at = ? WHERE id = ? AND (sign_count < ? OR (sign_count = 0 AND ? = 0))",
    );
  });
});

describe("createCredentialStore — ownership-scoped writes", () => {
  /** Answers a write the way the database would: the last bound parameter is the owner the statement demands. */
  function ownedBy(userId: string): [D1Client, FakeDb] {
    const owner = uuidToBytes(userId);
    return writerOf((_sql, params) => (sameBytes(params.at(-1), owner) ? 1 : 0));
  }

  const FLOOR = ["totp-app", "passkey"] as const;
  const PROBE = "SELECT (SELECT COUNT(*) FROM auth_credentials WHERE id = ? AND user_id = ?) AS present";

  /** A store whose probe answers `present` and `removable`, and whose writes report `written` for each statement. */
  function probed(present: number, removable: number, written: (sql: string) => number): [D1Client, FakeDb] {
    return clientOf((sql) => (squashSql(sql).startsWith(PROBE) ? [{ present, removable }] : []), { rowsWritten: written });
  }

  it("deletes the owner's credential and reports `not-found` for another user's", async () => {
    const owner = uuidToBytes(USER_ID);
    const [client] = clientOf(
      (sql, params) => (squashSql(sql).startsWith(PROBE) ? [{ present: Number(sameBytes(params[1], owner)), removable: 1 }] : []),
      { rowsWritten: (sql, params) => (sql.startsWith("DELETE FROM auth_credentials") && sameBytes(params[1], owner) ? 1 : 0) },
    );
    const credentials = createCredentialStore(client);
    expect(await credentials.removeForUser(OTHER_ID, USER_ID, 8_000, ORIGIN, [])).toEqual({ ok: true, data: "changed" });
    expect(await credentials.removeForUser(OTHER_ID, OTHER_ID, 8_000, ORIGIN, [])).toEqual({ ok: true, data: "not-found" });
  });

  it("probes, then revokes the owner's other sessions and records the removal only where the floor still holds, deletes the credential under the same guard, then drops the passkey factor and the recovery codes once nothing is left to hold them", async () => {
    const [client, db] = probed(1, 1, (sql) => Number(sql.startsWith("DELETE FROM auth_credentials")));
    expect(await createCredentialStore(client).removeForUser(OTHER_ID, USER_ID, 8_000, ORIGIN, FLOOR)).toEqual({ ok: true, data: "changed" });
    const owner = uuidToBytes(USER_ID);
    const credential = uuidToBytes(OTHER_ID);
    const floor = '["totp-app","passkey"]';
    const remains = [owner, floor, "passkey", owner, credential];
    const held = [credential, owner, ...remains];
    expect(db.calls.map((call, index) => [squashSql(call.sql), index === 2 ? eventParams(call.params, 6) : call.params])).toEqual([
      [`${PROBE}, ${REMAINS} AS removable`, [credential, owner, ...remains]],
      [`DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ? AND ${HELD} AND ${REMAINS}`, [owner, KEEP, ...held]],
      [
        securityEventText({ session: true, guard: `${HELD} AND ${REMAINS}` }),
        ["event-id", owner, "factor-removed", "passkey", KEEP, null, "now", ...held],
      ],
      [`DELETE FROM auth_credentials WHERE id = ? AND user_id = ? AND ${REMAINS}`, [credential, owner, ...remains]],
      [
        "DELETE FROM auth_factors WHERE user_id = ? AND kind = ? AND NOT EXISTS (SELECT 1 FROM auth_credentials WHERE user_id = ?)",
        [owner, "passkey", owner],
      ],
      [`DELETE FROM auth_recovery_codes WHERE user_id = ? AND NOT ${HOLDS_RECOVERABLE}`, [owner, owner, '["totp-app","passkey"]']],
      [
        `DELETE FROM auth_factors WHERE user_id = ? AND kind = ? AND NOT ${HOLDS_RECOVERABLE}`,
        [owner, "recovery-code", owner, '["totp-app","passkey"]'],
      ],
    ]);
  });

  it("drops the spared-session term when no session is kept, rather than binding a NULL that would spare every one", async () => {
    const [client, db] = probed(1, 1, () => 1);
    await createCredentialStore(client).removeForUser(OTHER_ID, USER_ID, 8_000, { keep: null }, []);
    expect(db.calls.map((call) => squashSql(call.sql)).slice(1, 3)).toEqual([
      `DELETE FROM auth_sessions WHERE user_id = ? AND ${HELD} AND 1`,
      securityEventText({ guard: `${HELD} AND 1` }),
    ]);
  });

  it("answers `changed`, `not-found` and `second-factor-required` from the probe and the delete", async () => {
    const outcome = async (present: number, removable: number) => {
      const [client] = probed(present, removable, (sql) => (sql.startsWith("DELETE FROM auth_credentials") ? present * removable : 0));
      const removed = await createCredentialStore(client).removeForUser(OTHER_ID, USER_ID, 8_000, ORIGIN, FLOOR);
      return removed.ok ? removed.data : removed.error.code;
    };
    expect([await outcome(1, 1), await outcome(0, 1), await outcome(1, 0)]).toEqual(["changed", "not-found", "second-factor-required"]);
  });

  it("registers a credential, records `factor-added` from the acting session and revokes every other session, in one batch", async () => {
    const [client, db] = writerOf(() => 1);
    const batches: number[] = [];
    const batch = db.batch;
    db.batch = (statements) => (batches.push(statements.length), batch(statements));
    const created = await createCredentialStore(client).create(
      { userId: USER_ID, credentialId: "Y3JlZA", publicKey: new Uint8Array([4]), algorithm: -7, signCount: 0 },
      7_000,
      ORIGIN,
    );
    expect({
      ok: created.ok,
      batches,
      event: [squashSql(db.calls[1]?.sql ?? ""), db.calls[1]?.params.slice(1)],
      revocation: [squashSql(db.calls[2]?.sql ?? ""), db.calls[2]?.params],
    }).toEqual({
      ok: true,
      batches: [3],
      event: [securityEventText({ session: true }), [uuidToBytes(USER_ID), "factor-added", "passkey", KEEP, null, 7_000]],
      revocation: ["DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ?", [uuidToBytes(USER_ID), KEEP]],
    });
  });

  it("signs every other session out once a passkey is registered, keeping the acting one", async () => {
    const seeded = await seededSessions(USER_ID, (sql) => (sql.startsWith("INSERT INTO auth_credentials") ? 1 : null));
    await createCredentialStore(seeded.client).create(
      { userId: USER_ID, credentialId: "Y3JlZA", publicKey: new Uint8Array([4]), algorithm: -7, signCount: 0 },
      7_000,
      { keep: ACTING_SESSION },
    );
    expect(await seeded.live()).toEqual([true, false]);
  });

  it("surfaces a failed registration batch as unavailable, naming the operation", async () => {
    const [client] = clientOf(() => [], { failOn: (sql) => (sql.includes("auth_security_events") ? new Error("D1_ERROR: network") : null) });
    const outcome = await createCredentialStore(client).create(
      { userId: USER_ID, credentialId: "Y3JlZA", publicKey: new Uint8Array([4]), algorithm: -7, signCount: 0 },
      7_000,
      ORIGIN,
    );
    expect(outcome.ok === false && [outcome.error.code, outcome.error.operation]).toEqual(["unavailable", "credentials.create"]);
  });

  it("answers by the credential's own deletion, so an owner holding no other session still sees it removed", async () => {
    const [client] = probed(1, 1, (sql) => (sql.includes("DELETE FROM auth_credentials") ? 1 : 0));
    expect(await createCredentialStore(client).removeForUser(OTHER_ID, USER_ID, 8_000, ORIGIN, FLOOR)).toEqual({ ok: true, data: "changed" });
  });

  it("reports a probe that allowed the removal but a delete that removed nothing as unavailable, not as a change", async () => {
    const [client] = probed(1, 1, (sql) => (sql.includes("DELETE FROM auth_credentials") ? 0 : 1));
    const outcome = await createCredentialStore(client).removeForUser(OTHER_ID, USER_ID, 8_000, ORIGIN, FLOOR);
    expect(outcome.ok === false && [outcome.error.code, outcome.error.operation]).toEqual(["unavailable", "credentials.removeForUser"]);
  });

  it("answers `not-found` for a credential that is gone, however many sessions the batch would have reached", async () => {
    const [client] = probed(0, 1, (sql) => (sql.includes("DELETE FROM auth_sessions") ? 4 : 0));
    expect(await createCredentialStore(client).removeForUser(OTHER_ID, USER_ID, 8_000, ORIGIN, FLOOR)).toEqual({ ok: true, data: "not-found" });
  });

  it("surfaces a failed batch as unavailable, naming the operation", async () => {
    const [client] = clientOf(() => [], { failOn: () => new Error("D1_ERROR: network") });
    const outcome = await createCredentialStore(client).removeForUser(OTHER_ID, USER_ID, 8_000, ORIGIN, FLOOR);
    expect(outcome.ok === false && [outcome.error.code, outcome.error.operation]).toEqual(["unavailable", "credentials.removeForUser"]);
  });

  it("relabels the owner's credential and reports false for another user's", async () => {
    const [client, db] = ownedBy(USER_ID);
    const credentials = createCredentialStore(client);
    expect(await credentials.relabel(OTHER_ID, USER_ID, "Work laptop", 8_000)).toEqual({ ok: true, data: true });
    expect(await credentials.relabel(OTHER_ID, OTHER_ID, "Work laptop", 8_000)).toEqual({ ok: true, data: false });
    expect(db.calls[0]?.params).toEqual(["Work laptop", 8_000, uuidToBytes(OTHER_ID), uuidToBytes(USER_ID)]);
    expect(db.calls[0]?.sql.replace(/\s+/g, " ")).toContain("WHERE id = ? AND user_id = ?");
  });

  it("clears a label when asked for one, rather than refusing null", async () => {
    const [client, db] = ownedBy(USER_ID);
    expect(await createCredentialStore(client).relabel(OTHER_ID, USER_ID, null, 8_000)).toEqual({ ok: true, data: true });
    expect(db.calls[0]?.params[0]).toBeNull();
  });

  it("has no unscoped delete left to reach for", () => {
    const [client] = clientOf();
    expect("remove" in createCredentialStore(client)).toBe(false);
  });
});
