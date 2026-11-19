import { describe, expect, it } from "bun:test";

import { applyLogRedaction, DEFAULT_LOG_REDACTION } from "../../logging/redact";
import { createD1Client } from "../../storage/db/client";
import type { D1Client, D1Database, D1DatabaseLike, D1Result } from "../../storage/db/types";
import { nullLogger } from "../../testing/context";
import { fakeD1 } from "../../testing/fakes";
import type { FakeD1Options } from "../../testing/types";
import { AUTH_SECURITY_EVENT_TTL_MS, AUTH_UNVERIFIED_USER_TTL_MS } from "../config";
import { AuthStoreError } from "../errors";
import { purgeAuthEphemera } from "./ephemera";

const AT = 1_700_000_000_000;

type FakeDb = ReturnType<typeof fakeD1>;

function clientOf(returned: (sql: string, params: unknown[]) => number = () => 0, options?: FakeD1Options): [D1Client, FakeDb] {
  const db = fakeD1((sql, params) => Array.from({ length: returned(sql, params) }, (_, index) => ({ rowid: index + 1 })), options);
  return [createD1Client(db as unknown as D1Database, { logger: nullLogger }), db];
}

function normalized(sql: string | undefined): string {
  return (sql ?? "").replace(/\s+/g, " ").trim();
}

const CHALLENGES =
  "DELETE FROM auth_challenges WHERE rowid IN (SELECT rowid FROM auth_challenges WHERE expires_at <= ? ORDER BY expires_at LIMIT ?) RETURNING rowid";
const NONCES =
  "DELETE FROM auth_nonces WHERE rowid IN (SELECT rowid FROM auth_nonces WHERE expires_at <= ? ORDER BY expires_at LIMIT ?) RETURNING rowid";
const SESSIONS =
  "DELETE FROM auth_sessions WHERE rowid IN (SELECT rowid FROM auth_sessions WHERE expires_at <= ? ORDER BY expires_at LIMIT ?) RETURNING rowid";
const USERS =
  "DELETE FROM auth_users WHERE rowid IN (SELECT rowid FROM auth_users WHERE email_verified_at IS NULL AND created_at <= ? ORDER BY created_at LIMIT ?) RETURNING rowid";
const EVENTS =
  "DELETE FROM auth_security_events WHERE rowid IN (SELECT rowid FROM auth_security_events WHERE at <= ? ORDER BY at LIMIT ?) RETURNING rowid";

const NONE = { challenges: 0, nonces: 0, signIns: 0, users: 0, securityEvents: 0 };

describe("purgeAuthEphemera", () => {
  it("deletes the dead challenge, nonce and session rows, the unverified accounts and the security events past their lifetimes, one bounded statement per table outside any batch", async () => {
    const [client, db] = clientOf();
    const batch = db.batch;
    let batched = 0;
    db.batch = (statements) => {
      batched += 1;
      return batch(statements);
    };
    expect(await purgeAuthEphemera(client, AT)).toEqual({ ok: true, data: { deleted: NONE, complete: true, blocked: [] } });
    expect(batched).toBe(0);
    expect(db.calls.map((call) => normalized(call.sql))).toEqual([CHALLENGES, NONCES, SESSIONS, EVENTS, USERS]);
    expect(db.calls.map((call) => call.params)).toEqual([
      [AT, 1000],
      [AT, 1000],
      [AT, 1000],
      [AT - AUTH_SECURITY_EVENT_TTL_MS, 1000],
      [AT - AUTH_UNVERIFIED_USER_TTL_MS, 100],
    ]);
  });

  it("measures an unverified account's lifetime by the configured knob", async () => {
    const [client, db] = clientOf();
    await purgeAuthEphemera(client, AT, { unverifiedUserTtlMs: 3_600_000 });
    expect(db.calls.at(-1)?.params).toEqual([AT - 3_600_000, 100]);
  });

  it("deletes a security event a year old when no lifetime is configured, and keeps one a moment newer", async () => {
    const YEAR_MS = 365 * 86_400_000;
    const events = [
      { name: "expired", at: AT - YEAR_MS },
      { name: "kept", at: AT - YEAR_MS + 1 },
    ];
    let held = [...events];
    const [client] = clientOf((sql, params) => {
      if (normalized(sql) !== EVENTS) return 0;
      const kept = held.filter((event) => event.at > Number(params[0]));
      const removed = held.length - kept.length;
      held = kept;
      return removed;
    });
    const outcome = await purgeAuthEphemera(client, AT);
    expect(held.map((event) => event.name)).toEqual(["kept"]);
    expect(outcome.ok && outcome.data.deleted.securityEvents).toBe(1);
  });

  it("measures a security event's lifetime by the configured knob, and refuses one under thirty days before any statement", async () => {
    const [client, db] = clientOf();
    await purgeAuthEphemera(client, AT, { securityEventTtlMs: 2_592_000_000 });
    expect(db.calls.at(-2)?.params).toEqual([AT - 2_592_000_000, 1000]);
    const [refusing, untouched] = clientOf();
    await expect(purgeAuthEphemera(refusing, AT, { securityEventTtlMs: 2_591_999_999 })).rejects.toThrow(
      "purgeAuthEphemera: securityEventTtlMs is 2591999999, below the 2592000000-millisecond floor — a record kept under thirty days is gone before most account holders notice a change they did not make.",
    );
    expect(untouched.calls).toEqual([]);
  });

  it("deletes an unverified account past its lifetime, and keeps one inside it and every verified account", async () => {
    const accounts = [
      { name: "stale-unverified", emailVerifiedAt: null, createdAt: AT - AUTH_UNVERIFIED_USER_TTL_MS },
      { name: "young-unverified", emailVerifiedAt: null, createdAt: AT - AUTH_UNVERIFIED_USER_TTL_MS + 1 },
      { name: "stale-verified", emailVerifiedAt: 1, createdAt: 1 },
    ];
    let held = [...accounts];
    const [client] = clientOf((sql, params) => {
      if (normalized(sql) !== USERS) return 0;
      const kept = held.filter((account) => account.emailVerifiedAt !== null || account.createdAt > Number(params[0]));
      const removed = held.length - kept.length;
      held = kept;
      return removed;
    });
    await purgeAuthEphemera(client, AT);
    expect(held.map((account) => account.name)).toEqual(["young-unverified", "stale-verified"]);
  });

  it("purges a backlog larger than one step in further steps of the same bound, until a step comes back short", async () => {
    let backlog = 2_500;
    const [client, db] = clientOf((sql, params) => {
      if (normalized(sql) !== SESSIONS) return 0;
      const removed = Math.min(backlog, Number(params[1]));
      backlog -= removed;
      return removed;
    });
    expect(await purgeAuthEphemera(client, AT)).toEqual({ ok: true, data: { deleted: { ...NONE, signIns: 2_500 }, complete: true, blocked: [] } });
    expect(backlog).toBe(0);
    expect(db.calls.filter((call) => normalized(call.sql) === SESSIONS).map((call) => call.params[1])).toEqual([1000, 1000, 1000]);
  });

  it("logs every count in its report as a number under the default redaction policy", async () => {
    const [client] = clientOf(() => 1);
    const purged = await purgeAuthEphemera(client, AT);
    const report = purged.ok ? purged.data : null;
    expect(report && applyLogRedaction({ ...report }, DEFAULT_LOG_REDACTION).deleted).toEqual({
      challenges: 1,
      nonces: 1,
      signIns: 1,
      users: 1,
      securityEvents: 1,
    });
  });

  it("counts each account the users step returns rather than a change count its cascade inflates, and stops on that count", async () => {
    let backlog = 50;
    const [, db] = clientOf((sql, params) => {
      if (normalized(sql) !== USERS) return 0;
      const removed = Math.min(backlog, Number(params[1]));
      backlog -= removed;
      return removed;
    });
    const inflated = (answer: D1Result<unknown>): D1Result<unknown> => ({
      ...answer,
      meta: { ...answer.meta, changes: answer.results.length * 3, rows_written: answer.results.length * 3 },
    });
    const cascading: D1DatabaseLike = {
      ...db,
      prepare: (text) => {
        const statement = db.prepare(text);
        return {
          ...statement,
          bind: (...values) => {
            const bound = statement.bind(...values);
            return { ...bound, run: async () => inflated(await bound.run()), all: async <T>() => inflated(await bound.all<T>()) as D1Result<T> };
          },
        };
      },
    };
    expect(await purgeAuthEphemera(createD1Client(cascading as unknown as D1Database, { logger: nullLogger }), AT)).toEqual({
      ok: true,
      data: { deleted: { ...NONE, users: 50 }, complete: true, blocked: [] },
    });
    expect(db.calls.filter((call) => normalized(call.sql) === USERS)).toHaveLength(1);
  });

  const backlogs = [
    { table: "challenges", statement: CHALLENGES, backlog: 2_000, steps: [1000, 1000, 1000], expected: 2_000 },
    { table: "nonces", statement: NONCES, backlog: 1_001, steps: [1000, 1000], expected: 1_001 },
    { table: "signIns", statement: SESSIONS, backlog: 999, steps: [1000], expected: 999 },
    { table: "users", statement: USERS, backlog: 250, steps: [100, 100, 100], expected: 250 },
    { table: "securityEvents", statement: EVENTS, backlog: 0, steps: [1000], expected: 0 },
  ] as const;

  for (const { table, statement, backlog, steps, expected } of backlogs) {
    it(`counts a ${backlog}-row backlog of ${table} under its own key, in ${steps.length} step(s) of ${steps[0]}`, async () => {
      let left: number = backlog;
      const [client, db] = clientOf((sql, params) => {
        if (normalized(sql) !== statement) return 0;
        const removed = Math.min(left, Number(params[1]));
        left -= removed;
        return removed;
      });
      expect(await purgeAuthEphemera(client, AT)).toEqual({
        ok: true,
        data: { deleted: { ...NONE, [table]: expected }, complete: true, blocked: [] },
      });
      expect(db.calls.filter((call) => normalized(call.sql) === statement).map((call) => call.params[1])).toEqual([...steps]);
    });
  }

  it("reports the purge incomplete when one table alone hits its step ceiling, though every table after it finishes", async () => {
    const [client, db] = clientOf((sql, params) => (normalized(sql) === NONCES ? Number(params[1]) : 0));
    expect(await purgeAuthEphemera(client, AT)).toEqual({ ok: true, data: { deleted: { ...NONE, nonces: 8_000 }, complete: false, blocked: [] } });
    expect(db.calls.map((call) => normalized(call.sql))).toEqual([CHALLENGES, ...Array<string>(8).fill(NONCES), SESSIONS, EVENTS, USERS]);
  });

  it("keeps the accounts a reference-refused step's earlier steps deleted, and issues no further step for that table", async () => {
    let userSteps = 0;
    const [client, db] = clientOf((sql, params) => (normalized(sql) === USERS ? Number(params[1]) : 0), {
      failOn: (sql) => {
        if (normalized(sql) !== USERS) return null;
        userSteps += 1;
        return userSteps === 2 ? new Error("D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT") : null;
      },
    });
    expect(await purgeAuthEphemera(client, AT)).toEqual({
      ok: true,
      data: { deleted: { ...NONE, users: 100 }, complete: false, blocked: ["users"] },
    });
    expect(db.calls.map((call) => normalized(call.sql))).toEqual([CHALLENGES, NONCES, SESSIONS, EVENTS, USERS, USERS]);
  });

  it("refuses an unverified-account lifetime under its floor before a security-event lifetime under its own", async () => {
    const [client, db] = clientOf();
    await expect(purgeAuthEphemera(client, AT, { unverifiedUserTtlMs: 3_599_999, securityEventTtlMs: 2_591_999_999 })).rejects.toThrow(
      "purgeAuthEphemera: unverifiedUserTtlMs is 3599999, below the 3600000-millisecond floor — an account deleted inside an hour can lose the sign-up whose code is still on its way.",
    );
    expect(db.calls).toEqual([]);
  });

  it("stops each table at eight full steps, so a purge never issues more than forty statements, and reports the rows left behind", async () => {
    const [client, db] = clientOf((_sql, params) => Number(params[1]));
    expect(await purgeAuthEphemera(client, AT)).toEqual({
      ok: true,
      data: { deleted: { challenges: 8_000, nonces: 8_000, signIns: 8_000, users: 800, securityEvents: 8_000 }, complete: false, blocked: [] },
    });
    expect(db.calls).toHaveLength(40);
  });

  it("names users blocked when a foreign key refuses its first step, reports the purge incomplete, and still purges every other table", async () => {
    const [client, db] = clientOf((sql) => (normalized(sql) === USERS ? 0 : 3), {
      failOn: (sql) => (normalized(sql) === USERS ? new Error("D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT") : null),
    });
    expect(await purgeAuthEphemera(client, AT)).toEqual({
      ok: true,
      data: { deleted: { ...NONE, challenges: 3, nonces: 3, signIns: 3, securityEvents: 3 }, complete: false, blocked: ["users"] },
    });
    expect(db.calls.map((call) => normalized(call.sql))).toEqual([CHALLENGES, NONCES, SESSIONS, EVENTS, USERS]);
  });

  const refusals = [
    { rule: "NOT NULL", error: "D1_ERROR: NOT NULL constraint failed: app_devices.sid: SQLITE_CONSTRAINT" },
    { rule: "CHECK", error: "D1_ERROR: CHECK constraint failed: length(sid) = 16: SQLITE_CONSTRAINT" },
  ];

  for (const { rule, error } of refusals) {
    it(`names signIns blocked when a ${rule} constraint an app key's action raises refuses its step, and purges the events and accounts after it`, async () => {
      const [client, db] = clientOf((sql) => (normalized(sql) === SESSIONS ? 0 : 1), {
        failOn: (sql) => (normalized(sql) === SESSIONS ? new Error(error) : null),
      });
      expect(await purgeAuthEphemera(client, AT)).toEqual({
        ok: true,
        data: { deleted: { ...NONE, challenges: 1, nonces: 1, securityEvents: 1, users: 1 }, complete: false, blocked: ["signIns"] },
      });
      expect(db.calls.map((call) => normalized(call.sql))).toEqual([CHALLENGES, NONCES, SESSIONS, EVENTS, USERS]);
    });
  }

  it("errs on a UNIQUE refusal or an outage on the `signIns` step rather than reading either as a block", async () => {
    const failures = ["D1_ERROR: UNIQUE constraint failed: auth_sessions.id: SQLITE_CONSTRAINT", "D1_ERROR: Network connection lost."];
    const outcomes = await Promise.all(
      failures.map(async (failure) => {
        const [client] = clientOf(undefined, { failOn: (sql) => (normalized(sql) === SESSIONS ? new Error(failure) : null) });
        const outcome = await purgeAuthEphemera(client, AT);
        return outcome.ok ? null : outcome.error.operation;
      }),
    );
    expect(outcomes).toEqual(["ephemera.purge.signIns", "ephemera.purge.signIns"]);
  });

  it("names two blocked tables in the order they ran, and purges the tables between and around them", async () => {
    const refused = new Set([SESSIONS, USERS]);
    const [client, db] = clientOf(() => 2, {
      failOn: (sql) => (refused.has(normalized(sql)) ? new Error("D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT") : null),
    });
    expect(await purgeAuthEphemera(client, AT)).toEqual({
      ok: true,
      data: { deleted: { ...NONE, challenges: 2, nonces: 2, securityEvents: 2 }, complete: false, blocked: ["signIns", "users"] },
    });
    expect(db.calls.map((call) => normalized(call.sql))).toEqual([CHALLENGES, NONCES, SESSIONS, EVENTS, USERS]);
  });

  it("refuses a lifetime short enough to delete a sign-up whose code is still on its way", async () => {
    const [client] = clientOf();
    await expect(purgeAuthEphemera(client, AT, { unverifiedUserTtlMs: 60_000 })).rejects.toThrow(
      "purgeAuthEphemera: unverifiedUserTtlMs is 60000, below the 3600000-millisecond floor — an account deleted inside an hour can lose the sign-up whose code is still on its way.",
    );
  });

  it("refuses a lifetime a millisecond under the hour before issuing any statement", async () => {
    const [client, db] = clientOf();
    await expect(purgeAuthEphemera(client, AT, { unverifiedUserTtlMs: 3_599_999 })).rejects.toThrow(
      "purgeAuthEphemera: unverifiedUserTtlMs is 3599999, below the 3600000-millisecond floor — an account deleted inside an hour can lose the sign-up whose code is still on its way.",
    );
    expect(db.calls).toEqual([]);
  });

  it("sets no ceiling on the lifetime, so a deployment may keep unverified accounts for a year", async () => {
    const [client, db] = clientOf();
    expect((await purgeAuthEphemera(client, AT, { unverifiedUserTtlMs: 31_536_000_000 })).ok).toBe(true);
    expect(db.calls.at(-1)?.params).toEqual([AT - 31_536_000_000, 100]);
  });

  it("purges unverified accounts a week old when no lifetime is configured", async () => {
    const [client, db] = clientOf();
    await purgeAuthEphemera(client, AT);
    expect(db.calls.at(-1)?.params).toEqual([AT - 604_800_000, 100]);
  });

  it("surfaces a failure as an AuthStoreError naming the table, rather than throwing into a scheduled handler", async () => {
    const [client] = clientOf(undefined, { failOn: () => new Error("D1_ERROR: database unreachable") });
    const outcome = await purgeAuthEphemera(client, AT);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.error).toBeInstanceOf(AuthStoreError);
    expect(outcome.ok === false && [outcome.error.code, outcome.error.operation]).toEqual(["unavailable", "ephemera.purge.challenges"]);
  });

  it("stops at a failure other than a reference, issuing nothing for the tables after it", async () => {
    const [client, db] = clientOf(undefined, {
      failOn: (sql) => (normalized(sql) === NONCES ? new Error("D1_ERROR: database unreachable") : null),
    });
    const outcome = await purgeAuthEphemera(client, AT);
    expect(outcome.ok === false && [outcome.error.code, outcome.error.operation]).toEqual(["unavailable", "ephemera.purge.nonces"]);
    expect(db.calls.map((call) => normalized(call.sql))).toEqual([CHALLENGES, NONCES]);
  });
});
