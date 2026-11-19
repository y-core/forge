import { describe, expect, it } from "bun:test";

import { createD1Client } from "../../storage/db/client";
import { sql } from "../../storage/db/sql";
import type { D1Client, D1Database } from "../../storage/db/types";
import { uuidToBytes, uuidv7 } from "../../storage/db/uuid";
import { nullLogger } from "../../testing/context";
import { fakeD1 } from "../../testing/fakes";
import type { FakeD1Options } from "../../testing/types";
import { authSecurityEventStatement, createSecurityEventStore } from "./events";
import { eventParams, securityEventText, squashSql } from "./events.fixture";

const USER_ID = uuidv7();
const ADMIN_ID = uuidv7();
const SESSION_ID = uuidv7();
const KEEP = new Uint8Array(32).fill(7);

type FakeDb = ReturnType<typeof fakeD1>;

function clientOf(rows: (sql: string, params: unknown[]) => unknown[] = () => [], options?: FakeD1Options): [D1Client, FakeDb] {
  const db = fakeD1(rows, options);
  return [createD1Client(db as unknown as D1Database, { logger: nullLogger }), db];
}

function sameBytes(left: unknown, right: unknown): boolean {
  return left instanceof Uint8Array && right instanceof Uint8Array && left.length === right.length && left.every((byte, i) => byte === right[i]);
}

function eventRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: uuidToBytes(uuidv7()),
    user_id: uuidToBytes(USER_ID),
    type: "factor-added",
    factor_kind: "passkey",
    session_id: uuidToBytes(SESSION_ID),
    admin_id: null,
    at: 9_000,
    ...overrides,
  };
}

describe("authSecurityEventStatement", () => {
  it("writes exactly the id, owner, type, factor kind, public session id, admin id and time — nothing a client sent and no secret", () => {
    const statement = authSecurityEventStatement({
      userKey: uuidToBytes(USER_ID),
      type: "signed-in",
      factorKind: "email-otp",
      keep: KEEP,
      adminKey: null,
      at: 9_000,
    });
    const columns = /^INSERT INTO auth_security_events \(([^)]*)\)/.exec(squashSql(statement.text))?.[1]?.split(", ");
    expect(columns).toEqual(["id", "user_id", "type", "factor_kind", "session_id", "admin_id", "at"]);
  });

  it("names the acting session by its public id through the token hash, never binding the hash into a column of its own", () => {
    const statement = authSecurityEventStatement({
      userKey: uuidToBytes(USER_ID),
      type: "signed-in",
      factorKind: "email-otp",
      keep: KEEP,
      adminKey: null,
      at: 9_000,
    });
    expect([squashSql(statement.text), eventParams(statement.params)]).toEqual([
      securityEventText({ session: true }),
      ["event-id", uuidToBytes(USER_ID), "signed-in", "email-otp", KEEP, null, 9_000],
    ]);
  });

  it("names no session, binding none, where no session acted", () => {
    const statement = authSecurityEventStatement({
      userKey: uuidToBytes(USER_ID),
      type: "admin-granted",
      factorKind: null,
      keep: null,
      adminKey: uuidToBytes(ADMIN_ID),
      at: 9_000,
    });
    expect([squashSql(statement.text), eventParams(statement.params)]).toEqual([
      securityEventText(),
      ["event-id", uuidToBytes(USER_ID), "admin-granted", null, uuidToBytes(ADMIN_ID), 9_000],
    ]);
  });

  it("embeds a fragment owner or factor kind where only the statement knows it, and inserts only where the guard holds", () => {
    const statement = authSecurityEventStatement(
      {
        userKey: sql`(SELECT user_id FROM auth_sessions WHERE token_hash = ${KEEP})`,
        type: "factor-removed",
        factorKind: sql`(SELECT kind FROM auth_factors WHERE id = ${1})`,
        keep: null,
        adminKey: null,
        at: 9_000,
      },
      sql`changes() > 0`,
    );
    expect([squashSql(statement.text), eventParams(statement.params)]).toEqual([
      securityEventText({
        user: "(SELECT user_id FROM auth_sessions WHERE token_hash = ?)",
        kind: "(SELECT kind FROM auth_factors WHERE id = ?)",
        guard: "changes() > 0",
      }),
      ["event-id", KEEP, "factor-removed", 1, null, 9_000],
    ]);
  });

  it("mints a fresh time-ordered id for every event", () => {
    const write = { userKey: uuidToBytes(USER_ID), type: "signed-in", factorKind: null, keep: null, adminKey: null, at: 1 } as const;
    const [first, second] = [authSecurityEventStatement(write).params[0], authSecurityEventStatement(write).params[0]];
    expect({ length: (first as Uint8Array).length, repeated: sameBytes(first, second) }).toEqual({ length: 16, repeated: false });
  });
});

describe("createSecurityEventStore — listByUser", () => {
  it("pages one account's events newest first off the time-ordered key, under the default limit", async () => {
    const [client, db] = clientOf(() => []);
    const cursor = uuidv7();
    const events = createSecurityEventStore(client);
    await events.listByUser(USER_ID);
    await events.listByUser(USER_ID, { after: cursor, limit: 10 });
    expect(db.calls.map((call) => [squashSql(call.sql), call.params])).toEqual([
      ["SELECT * FROM auth_security_events WHERE user_id = ? ORDER BY id DESC LIMIT ?", [uuidToBytes(USER_ID), 50]],
      ["SELECT * FROM auth_security_events WHERE user_id = ? AND id < ? ORDER BY id DESC LIMIT ?", [uuidToBytes(USER_ID), uuidToBytes(cursor), 10]],
    ]);
  });

  it("reads each row back with its ids as UUIDs and an absent session or admin as null", async () => {
    const id = uuidv7();
    const [client] = clientOf(() => [
      eventRow({ id: uuidToBytes(id) }),
      eventRow({ id: uuidToBytes(id), type: "admin-revoked", factor_kind: null, session_id: null, admin_id: uuidToBytes(ADMIN_ID) }),
    ]);
    expect(await createSecurityEventStore(client).listByUser(USER_ID)).toEqual({
      ok: true,
      data: [
        { id, userId: USER_ID, type: "factor-added", factorKind: "passkey", sessionId: SESSION_ID, adminId: null, at: 9_000 },
        { id, userId: USER_ID, type: "admin-revoked", factorKind: null, sessionId: null, adminId: ADMIN_ID, at: 9_000 },
      ],
    });
  });

  it("answers no events, binding nothing, for an owner or cursor that is not a UUID", async () => {
    const [client, db] = clientOf(() => [eventRow()]);
    const events = createSecurityEventStore(client);
    expect({ outcomes: [await events.listByUser("u9"), await events.listByUser(USER_ID, { after: "u9" })], calls: db.calls }).toEqual({
      outcomes: [
        { ok: true, data: [] },
        { ok: true, data: [] },
      ],
      calls: [],
    });
  });

  it("reports a failing read and a row that will not decode as `unavailable`, naming the operation", async () => {
    const [failing] = clientOf(() => [], { failOn: () => new Error("D1_ERROR: network lost") });
    const [corrupt] = clientOf(() => [eventRow({ id: "not-bytes" })]);
    const outcomes = [await createSecurityEventStore(failing).listByUser(USER_ID), await createSecurityEventStore(corrupt).listByUser(USER_ID)];
    expect(outcomes.map((outcome) => outcome.ok === false && `${outcome.error.code} ${outcome.error.operation}`)).toEqual([
      "unavailable securityEvents.listByUser",
      "unavailable securityEvents.listByUser",
    ]);
  });
});
