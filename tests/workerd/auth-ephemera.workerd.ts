import { expect, test } from "@playwright/test";

import { purgeAuthEphemera } from "../../src/auth/stores/ephemera";
import { createD1Client } from "../../src/storage/db/client";
import type { SqlFragment } from "../../src/storage/db/types";
import { uuidToBytes, uuidv7 } from "../../src/storage/db/uuid";
import { explainPlan, scansTable, type TestD1, usesIndex } from "../../src/testing/d1/mod";
import { insertSession, openAuthD1, signedUp, tokenHash } from "./auth-d1.fixture";

const PURGE_AT = 4_000_000_000;
const UNVERIFIED_TTL_MS = 3_600_000;
const EVENT_TTL_MS = 2_592_000_000;
const STALE = PURGE_AT - UNVERIFIED_TTL_MS;
const LIVE = PURGE_AT + 1;
const OPTIONS = { unverifiedUserTtlMs: UNVERIFIED_TTL_MS, securityEventTtlMs: EVENT_TTL_MS };
const NOTHING = { challenges: 0, nonces: 0, signIns: 0, users: 0, securityEvents: 0 };

let db: TestD1;

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.beforeAll(async () => {
  db = await openAuthD1();
});

test.afterAll(async () => {
  await db?.dispose();
});

test.beforeEach(() => db.reset());

function purge() {
  return purgeAuthEphemera(createD1Client(db.binding), PURGE_AT, OPTIONS);
}

async function count(table: string, where = "1"): Promise<number> {
  const [row] = await db.rows<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`);
  return row?.n ?? -1;
}

async function rowPresent(table: string, column: string, id: string): Promise<boolean> {
  return (await count(table, `${column} = X'${id.replaceAll("-", "")}'`)) === 1;
}

function run(statement: string, ...params: unknown[]): Promise<unknown> {
  return db.binding
    .prepare(statement)
    .bind(...params)
    .run();
}

function insertEvent(userId: string, at: number): Promise<unknown> {
  return run(
    "INSERT INTO auth_security_events (id, user_id, type, at) VALUES (?, ?, 'signed-in', ?)",
    uuidToBytes(uuidv7()),
    uuidToBytes(userId),
    at,
  );
}

/** `n` rows of `table`, written in one statement, with `columns` drawn from the counter `i`. */
function seeded(table: string, n: number, columns: string, values: string): Promise<unknown> {
  return db.binding
    .prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${n}) INSERT INTO ${table} (${columns}) SELECT ${values} FROM n`,
    )
    .run();
}

test.describe("a stale unverified account an app table's plain key references", () => {
  async function arranged() {
    await run("CREATE TABLE app_profiles (user_id BLOB NOT NULL REFERENCES auth_users (id)) STRICT");
    const held = await signedUp(db, STALE - 1);
    await run("INSERT INTO app_profiles (user_id) VALUES (?)", uuidToBytes(held));
    const other = await signedUp(db, STALE);
    const verified = await signedUp(db, STALE, { verifiedAt: STALE });
    await insertSession(db, { tokenHash: tokenHash(), userId: verified, signedInAt: STALE - 1, expiresAt: PURGE_AT });
    await insertSession(db, { tokenHash: tokenHash(), userId: verified, signedInAt: STALE - 1, expiresAt: LIVE });
    await run("INSERT INTO auth_challenges (key, value, expires_at) VALUES ('dead', 'v', ?), ('live', 'v', ?)", PURGE_AT, LIVE);
    await run("INSERT INTO auth_nonces (key, expires_at) VALUES ('dead', ?), ('live', ?)", PURGE_AT, LIVE);
    await insertEvent(verified, PURGE_AT - EVENT_TTL_MS);
    await insertEvent(verified, PURGE_AT - EVENT_TTL_MS + 1);
    return { held, other };
  }

  test("blocks the users step on every run and reports the purge incomplete, while the other four tables still purge", async () => {
    const { held, other } = await arranged();
    const blocked = { ok: true, data: { deleted: NOTHING, complete: false, blocked: ["users"] } };
    expect({
      first: await purge(),
      next: await purge(),
      accounts: [await rowPresent("auth_users", "id", held), await rowPresent("auth_users", "id", other)],
      left: {
        challenges: await count("auth_challenges"),
        nonces: await count("auth_nonces"),
        sessions: await count("auth_sessions"),
        events: await count("auth_security_events"),
      },
    }).toEqual({
      first: { ...blocked, data: { ...blocked.data, deleted: { ...NOTHING, challenges: 1, nonces: 1, signIns: 1, securityEvents: 1 } } },
      next: blocked,
      accounts: [true, true],
      left: { challenges: 1, nonces: 1, sessions: 1, events: 1 },
    });
  });

  test("goes on the next run once the app row is cleared, and that run completes", async () => {
    const { held } = await arranged();
    await purge();
    await run("DELETE FROM app_profiles WHERE user_id = ?", uuidToBytes(held));
    expect(await purge()).toEqual({ ok: true, data: { deleted: { ...NOTHING, users: 2 }, complete: true, blocked: [] } });
    expect(await count("auth_users", "email_verified_at IS NULL")).toBe(0);
  });
});

test("names `signIns` blocked when an app table's plain key holds an expired session, and the security events and accounts after it still purge", async () => {
  await run("CREATE TABLE app_audit (session_id BLOB REFERENCES auth_sessions (id)) STRICT");
  const verified = await signedUp(db, STALE, { verifiedAt: STALE });
  const audited = uuidv7();
  await insertSession(db, { tokenHash: tokenHash(), userId: verified, signedInAt: STALE - 1, expiresAt: PURGE_AT, id: audited });
  await insertSession(db, { tokenHash: tokenHash(), userId: verified, signedInAt: STALE - 1, expiresAt: PURGE_AT });
  await run("INSERT INTO app_audit (session_id) VALUES (?)", uuidToBytes(audited));
  await signedUp(db, STALE);
  await insertEvent(verified, PURGE_AT - EVENT_TTL_MS);
  await run("INSERT INTO auth_challenges (key, value, expires_at) VALUES ('dead', 'v', ?)", PURGE_AT);
  expect({
    purged: await purge(),
    sessions: await count("auth_sessions"),
    unverified: await count("auth_users", "email_verified_at IS NULL"),
    events: await count("auth_security_events"),
  }).toEqual({
    purged: { ok: true, data: { deleted: { ...NOTHING, challenges: 1, securityEvents: 1, users: 1 }, complete: false, blocked: ["signIns"] } },
    sessions: 2,
    unverified: 0,
    events: 0,
  });
});

test("keeps the hundred accounts a first step deleted when a foreign key refuses the second, and every later run deletes none while that row holds", async () => {
  await run("CREATE TABLE app_profiles (user_id BLOB NOT NULL REFERENCES auth_users (id)) STRICT");
  await seeded(
    "auth_users",
    150,
    "id, email, email_key, email_verified_at, created_at, updated_at",
    `randomblob(16), 'stale-' || i || '@example.com', 'stale-' || i || '@example.com', NULL, ${STALE - 200} + i, ${STALE}`,
  );
  await run("INSERT INTO app_profiles (user_id) SELECT id FROM auth_users WHERE email = 'stale-120@example.com'");
  const first = await purge();
  const afterFirst = await count("auth_users");
  expect({ first, afterFirst, next: await purge(), afterNext: await count("auth_users") }).toEqual({
    first: { ok: true, data: { deleted: { ...NOTHING, users: 100 }, complete: false, blocked: ["users"] } },
    afterFirst: 50,
    next: { ok: true, data: { deleted: NOTHING, complete: false, blocked: ["users"] } },
    afterNext: 50,
  });
});

test("reaches lapsed unverified accounts through auth_users_unverified_created_at, never scanning auth_users", async () => {
  await signedUp(db, STALE);
  const client = createD1Client(db.binding);
  const fragments: SqlFragment[] = [];
  await purgeAuthEphemera(
    {
      ...client,
      query(fragment) {
        fragments.push(fragment);
        return client.query(fragment);
      },
    },
    PURGE_AT,
    OPTIONS,
  );
  const users = fragments.filter((fragment) => fragment.text.startsWith("DELETE FROM auth_users "));
  const plans = await Promise.all(users.map((fragment) => explainPlan(db, fragment.text, fragment.params)));
  expect(plans.map((plan) => ({ index: usesIndex(plan, "auth_users_unverified_created_at"), scan: scansTable(plan, "auth_users") }))).toEqual([
    { index: true, scan: false },
  ]);
});

test.describe("an app key's ON DELETE SET NULL action a constraint refuses", () => {
  const refusals = [
    {
      title: "a STRICT primary key, which is NOT NULL",
      table: "CREATE TABLE app_devices (sid BLOB PRIMARY KEY REFERENCES auth_sessions (id) ON DELETE SET NULL) STRICT",
    },
    { title: "a CHECK", table: "CREATE TABLE app_devices (sid BLOB REFERENCES auth_sessions (id) ON DELETE SET NULL CHECK (sid IS NOT NULL))" },
  ];

  for (const { title, table } of refusals) {
    test(`over ${title} names signIns blocked, keeps the session, and still purges the security events and accounts after it`, async () => {
      await run(table);
      const verified = await signedUp(db, STALE, { verifiedAt: STALE });
      const session = uuidv7();
      await insertSession(db, { tokenHash: tokenHash(), userId: verified, signedInAt: STALE - 1, expiresAt: PURGE_AT, id: session });
      await run("INSERT INTO app_devices (sid) VALUES (?)", uuidToBytes(session));
      await insertEvent(verified, PURGE_AT - EVENT_TTL_MS);
      const stale = await signedUp(db, STALE);
      expect({
        purged: await purge(),
        session: await rowPresent("auth_sessions", "id", session),
        stale: await rowPresent("auth_users", "id", stale),
      }).toEqual({
        purged: { ok: true, data: { deleted: { ...NOTHING, securityEvents: 1, users: 1 }, complete: false, blocked: ["signIns"] } },
        session: true,
        stale: false,
      });
    });
  }
});

test.describe("a trigger of the app's on a purged table", () => {
  async function arranged(trigger: readonly string[]) {
    for (const statement of trigger) await run(statement);
    await signedUp(db, STALE);
    await insertEvent(await signedUp(db, STALE, { verifiedAt: STALE }), PURGE_AT - EVENT_TTL_MS);
    await run("INSERT INTO auth_challenges (key, value, expires_at) VALUES ('dead', 'v', ?)", PURGE_AT);
  }

  test("that makes the users step fail on a foreign key leaves the accounts, names users blocked, and the other tables still purge", async () => {
    await arranged([
      "CREATE TABLE app_tombstones (user_id BLOB NOT NULL REFERENCES auth_users (id))",
      "CREATE TRIGGER app_tombstone AFTER DELETE ON auth_users BEGIN INSERT INTO app_tombstones (user_id) VALUES (old.id); END",
    ]);
    expect({
      purged: await purge(),
      unverified: await count("auth_users", "email_verified_at IS NULL"),
      events: await count("auth_security_events"),
      tombstones: await count("app_tombstones"),
    }).toEqual({
      purged: { ok: true, data: { deleted: { ...NOTHING, challenges: 1, securityEvents: 1 }, complete: false, blocked: ["users"] } },
      unverified: 1,
      events: 0,
      tombstones: 0,
    });
  });

  test("that aborts the users step any other way stops the run as ephemera.purge.users, after the tables before it purge", async () => {
    await arranged(["CREATE TRIGGER app_keep BEFORE DELETE ON auth_users BEGIN SELECT RAISE(ABORT, 'accounts are archived, not deleted'); END"]);
    const purged = await purge();
    expect({
      failure: purged.ok ? null : [purged.error.code, purged.error.operation],
      challenges: await count("auth_challenges"),
      unverified: await count("auth_users", "email_verified_at IS NULL"),
      events: await count("auth_security_events"),
    }).toEqual({ failure: ["unavailable", "ephemera.purge.users"], challenges: 0, unverified: 1, events: 0 });
  });
});

test("purges a 2,500-challenge and 250-account backlog, counting the accounts and not the session and event rows their deletion cascades to", async () => {
  await seeded("auth_challenges", 2_500, "key, value, expires_at", `'challenge-' || i, 'v', ${PURGE_AT}`);
  await seeded(
    "auth_users",
    250,
    "id, email, email_key, email_verified_at, created_at, updated_at",
    `randomblob(16), 'stale-' || i || '@example.com', 'stale-' || i || '@example.com', NULL, ${STALE}, ${STALE}`,
  );
  await db.binding
    .prepare(
      `INSERT INTO auth_sessions (token_hash, user_id, signed_in_at, expires_at, id, last_seen_at) SELECT randomblob(32), id, ${STALE}, ${LIVE}, randomblob(16), ${STALE} FROM auth_users`,
    )
    .run();
  await db.binding
    .prepare(`INSERT INTO auth_security_events (id, user_id, type, at) SELECT randomblob(16), id, 'signed-in', ${PURGE_AT} FROM auth_users`)
    .run();
  const first = await purge();
  const left = {
    challenges: await count("auth_challenges"),
    users: await count("auth_users"),
    sessions: await count("auth_sessions"),
    events: await count("auth_security_events"),
  };
  expect({ first, left, next: await purge() }).toEqual({
    first: { ok: true, data: { deleted: { ...NOTHING, challenges: 2_500, users: 250 }, complete: true, blocked: [] } },
    left: { challenges: 0, users: 0, sessions: 0, events: 0 },
    next: { ok: true, data: { deleted: NOTHING, complete: true, blocked: [] } },
  });
});

test("leaves 8,001 expired nonces incomplete after one run's eight steps, and the next run takes the last one and reports itself complete", async () => {
  await seeded("auth_nonces", 8_001, "key, expires_at", `'nonce-' || i, ${PURGE_AT}`);
  expect(await purge()).toEqual({ ok: true, data: { deleted: { ...NOTHING, nonces: 8_000 }, complete: false, blocked: [] } });
  expect(await count("auth_nonces")).toBe(1);
  expect(await purge()).toEqual({ ok: true, data: { deleted: { ...NOTHING, nonces: 1 }, complete: true, blocked: [] } });
  expect(await count("auth_nonces")).toBe(0);
});
