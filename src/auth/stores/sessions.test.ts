import { describe, expect, it } from "bun:test";

import { createD1Client } from "../../storage/db/client";
import { sql as sqlFragment } from "../../storage/db/sql";
import type { D1Client, D1Database } from "../../storage/db/types";
import { uuidToBytes, uuidv7 } from "../../storage/db/uuid";
import { fakeAuthD1 } from "../../testing/auth-fakes";
import { nullLogger } from "../../testing/context";
import { fakeD1 } from "../../testing/fakes";
import type { FakeD1Options } from "../../testing/types";
import { AUTH_SESSION_IDLE_MS, AUTH_SESSION_MAX_MS } from "../config";
import { AuthStoreError } from "../errors";
import type { AuthSessionInput } from "../types";
import { createSecurityEventStore } from "./events";
import { eventParams, securityEventText } from "./events.fixture";
import { authSessionRevocation, createAuthSessionStore } from "./sessions";

const USER_ID = uuidv7();
const HASH = new Uint8Array(32).fill(7);
const PREVIOUS = new Uint8Array(32).fill(8);
const SESSION_ID = uuidv7();
const OTHER_USER = uuidv7();
const INPUT: AuthSessionInput = { tokenHash: HASH, userId: USER_ID, signedInAt: 1_000, signedInWith: "email-otp" };

const INSERT_SQL =
  "INSERT INTO auth_sessions (token_hash, user_id, signed_in_at, expires_at, step_up_at, id, step_up_kind, last_seen_at, device) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
const RESOLVE_SQL =
  "SELECT auth_users.id, auth_users.email, auth_users.is_admin, auth_sessions.id AS session_id, auth_sessions.signed_in_at, auth_sessions.expires_at, auth_sessions.step_up_at, auth_sessions.step_up_kind, auth_sessions.last_seen_at, auth_sessions.device FROM auth_sessions JOIN auth_users ON auth_users.id = auth_sessions.user_id WHERE auth_sessions.token_hash = ? AND auth_sessions.expires_at > ? AND auth_users.deactivated_at IS NULL";
const SIGNED_IN_SQL = securityEventText({ session: true });
const STEPPED_UP_SQL = securityEventText({
  user: "(SELECT user_id FROM auth_sessions WHERE token_hash = ?)",
  session: true,
  guard: "changes() > 0",
});
const LIST_SQL =
  "SELECT id AS session_id, signed_in_at, expires_at, step_up_at, step_up_kind, last_seen_at, device FROM auth_sessions WHERE user_id = ? AND expires_at > ? AND last_seen_at > ? ORDER BY signed_in_at DESC, id DESC LIMIT ?";
const REVOKED_SQL = securityEventText({ session: true, guard: "changes() > 0" });
const TOUCH_SQL = "UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ? AND last_seen_at <= ?";
const TOUCH_INTERVAL_MS = AUTH_SESSION_IDLE_MS / 12;

type FakeDb = ReturnType<typeof fakeD1>;

function clientOf(rows: (sql: string, params: unknown[]) => unknown[] = () => [], options?: FakeD1Options): [D1Client, FakeDb] {
  const db = fakeD1(rows, options);
  return [createD1Client(db as unknown as D1Database, { logger: nullLogger }), db];
}

function writerOf(rowsWritten: (sql: string, params: unknown[]) => number): [D1Client, FakeDb] {
  return clientOf(undefined, { rowsWritten });
}

/** Records each `batch` call as the statements it carried, which is what makes them one atomic write. */
function batchesOf(db: FakeDb): string[][] {
  const batches: string[][] = [];
  const batch = db.batch;
  db.batch = (statements) => {
    batches.push(statements.map((statement) => normalized((statement as unknown as { sql: string }).sql)));
    return batch(statements);
  };
  return batches;
}

function failing(): D1Client {
  return clientOf(undefined, { failOn: () => new Error("D1_ERROR: network connection lost") })[0];
}

function normalized(sql: string | undefined): string {
  return (sql ?? "").replace(/\s+/g, " ").trim();
}

function joinedRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: uuidToBytes(USER_ID),
    email: "Ada@Example.test",
    is_admin: 1,
    session_id: uuidToBytes(SESSION_ID),
    signed_in_at: 1_000,
    expires_at: 9_000,
    step_up_at: 4_000,
    step_up_kind: "totp-app",
    last_seen_at: 4_500,
    device: "Firefox on macOS",
    ...overrides,
  };
}

/** The ids of the sessions `userId` holds live at 2 000, as the store lists them. */
async function listed(store: ReturnType<typeof createAuthSessionStore>, userId: string): Promise<string[]> {
  const found = await store.listByUser(userId, 2_000);
  return found.ok ? found.data.map((session) => session.id) : [];
}

function failureOf(result: { ok: boolean; error?: unknown }): [boolean, string, string] | null {
  if (result.ok || !(result.error instanceof AuthStoreError)) return null;
  return [true, result.error.code, result.error.operation];
}

describe("createAuthSessionStore — create", () => {
  it("inserts the hash, the owner's id bytes, the sign-in as last seen, the default lifetime, a fresh 16-byte id, and no step-up or device where none is given", async () => {
    const [client, db] = writerOf(() => 1);
    expect(await createAuthSessionStore(client).create(INPUT, null)).toEqual({ ok: true, data: undefined });
    const params = db.calls[0]?.params ?? [];
    expect([db.calls.map((call) => normalized(call.sql)), params.slice(0, 5), params.slice(6), (params[5] as Uint8Array).length]).toEqual([
      [INSERT_SQL, SIGNED_IN_SQL],
      [HASH, uuidToBytes(USER_ID), 1_000, 1_000 + AUTH_SESSION_MAX_MS, null],
      [null, 1_000, null],
      16,
    ]);
  });

  it("expires a session the configured absolute lifetime after its sign-in", async () => {
    const [client, db] = writerOf(() => 1);
    await createAuthSessionStore(client, { absoluteLifetimeMs: 86_400_000 }).create(INPUT, null);
    expect(db.calls[0]?.params[3]).toBe(1_000 + 86_400_000);
  });

  it("records the step-up's time and kind where the sign-in counts as one", async () => {
    const [client, db] = writerOf(() => 1);
    await createAuthSessionStore(client).create({ ...INPUT, stepUp: { at: 1_000, kind: "email-otp" } }, null);
    expect([db.calls[0]?.params[4], db.calls[0]?.params[6]]).toEqual([1_000, "email-otp"]);
  });

  it("records the device label the sign-in was given", async () => {
    const [client, db] = writerOf(() => 1);
    await createAuthSessionStore(client).create({ ...INPUT, device: "Safari on iOS" }, null);
    expect(db.calls[0]?.params[8]).toBe("Safari on iOS");
  });

  it("mints a different id for every session", async () => {
    const [client, db] = writerOf(() => 1);
    const store = createAuthSessionStore(client);
    await store.create(INPUT, null);
    await store.create(INPUT, null);
    const [first, second] = db.calls.filter((call) => normalized(call.sql) === INSERT_SQL).map((call) => call.params[5]);
    expect(first).not.toEqual(second);
  });

  it("deletes the replaced row ahead of the insert, in the same batch", async () => {
    const [client, db] = writerOf(() => 1);
    const batches = batchesOf(db);
    await createAuthSessionStore(client).create(INPUT, PREVIOUS);
    expect({ batches, deleted: db.calls[0]?.params }).toEqual({
      batches: [["DELETE FROM auth_sessions WHERE token_hash = ?", INSERT_SQL, SIGNED_IN_SQL]],
      deleted: [PREVIOUS],
    });
  });

  it("records `signed-in` with the factor signed in with, naming the new session through its token's hash, in the insert's batch", async () => {
    const [client, db] = writerOf(() => 1);
    await createAuthSessionStore(client).create({ ...INPUT, signedInWith: "passkey" }, null);
    expect(eventParams(db.calls[1]?.params)).toEqual(["event-id", uuidToBytes(USER_ID), "signed-in", "passkey", HASH, null, 1_000]);
  });

  it("reports an owner id that is not a UUID as `reference`, and binds nothing", async () => {
    const [client, db] = writerOf(() => 1);
    const created = await createAuthSessionStore(client).create({ ...INPUT, userId: "u9" }, PREVIOUS);
    expect({ failure: failureOf(created), calls: db.calls }).toEqual({ failure: [true, "reference", "sessions.create"], calls: [] });
  });

  it("surfaces a D1 failure as one AuthStoreError naming the operation", async () => {
    expect(failureOf(await createAuthSessionStore(failing()).create(INPUT, PREVIOUS))).toEqual([true, "unavailable", "sessions.create"]);
  });
});

describe("createAuthSessionStore — resolve", () => {
  it("reads the row joined to its owner, live only past `at`, only while the owner is active and only when seen inside the idle bound", async () => {
    const [client, db] = clientOf(() => []);
    await createAuthSessionStore(client).resolve(HASH, 5_000);
    expect([normalized(db.calls[0]?.sql), db.calls[0]?.params]).toEqual([
      `${RESOLVE_SQL} AND auth_sessions.last_seen_at > ? LIMIT 1`,
      [HASH, 5_000, 5_000 - AUTH_SESSION_IDLE_MS],
    ]);
  });

  it("reads with no idle term when the idle bound is `null`", async () => {
    const [client, db] = clientOf(() => []);
    await createAuthSessionStore(client, { idleTimeoutMs: null }).resolve(HASH, 5_000);
    expect([normalized(db.calls[0]?.sql), db.calls[0]?.params]).toEqual([`${RESOLVE_SQL} LIMIT 1`, [HASH, 5_000]]);
  });

  it("maps every column of a live row onto the owner and the session", async () => {
    const [client] = clientOf(() => [joinedRow()]);
    expect(await createAuthSessionStore(client).resolve(HASH, 5_000)).toEqual({
      ok: true,
      data: {
        user: { id: USER_ID, email: "Ada@Example.test", isAdmin: true },
        session: {
          id: SESSION_ID,
          signedInAt: 1_000,
          expiresAt: 9_000,
          lastSeenAt: 4_500,
          stepUpAt: 4_000,
          stepUpKind: "totp-app",
          device: "Firefox on macOS",
        },
      },
    });
  });

  it("names the owner's columns rather than selecting them all, and carries no owner field past `id`, `email` and `isAdmin`", async () => {
    const [client, db] = clientOf(() => [joinedRow({ email_key: "ada@example.test", webauthn_id: new Uint8Array([1]), created_at: 100 })]);
    const found = await createAuthSessionStore(client).resolve(HASH, 5_000);
    expect({ star: db.calls[0]?.sql.includes("*"), keys: found.ok && Object.keys(found.data?.user ?? {}).sort() }).toEqual({
      star: false,
      keys: ["email", "id", "isAdmin"],
    });
  });

  it("carries a row never stepped up as `stepUpAt: null` and `stepUpKind: null`", async () => {
    const [client] = clientOf(() => [joinedRow({ step_up_at: null, step_up_kind: null })]);
    const found = await createAuthSessionStore(client).resolve(HASH, 5_000);
    expect(found.ok && [found.data?.session.stepUpAt, found.data?.session.stepUpKind]).toEqual([null, null]);
  });

  it("reports a row read back without a session id as `unavailable`, never as a session", async () => {
    const [client] = clientOf(() => [joinedRow({ session_id: null })]);
    expect(failureOf(await createAuthSessionStore(client).resolve(HASH, 5_000))).toEqual([true, "unavailable", "sessions.resolve"]);
  });

  it("answers `null` when the statement selects no row — expired, deactivated or unknown alike", async () => {
    const [client] = clientOf(() => []);
    expect(await createAuthSessionStore(client).resolve(HASH, 5_000)).toEqual({ ok: true, data: null });
  });

  it("reports a row whose owner id will not decode as `unavailable`, rather than throwing", async () => {
    const [client] = clientOf(() => [joinedRow({ id: new Uint8Array([1, 2]) })]);
    expect(failureOf(await createAuthSessionStore(client).resolve(HASH, 5_000))).toEqual([true, "unavailable", "sessions.resolve"]);
  });

  it("surfaces a D1 failure as one AuthStoreError naming the operation", async () => {
    expect(failureOf(await createAuthSessionStore(failing()).resolve(HASH, 5_000))).toEqual([true, "unavailable", "sessions.resolve"]);
  });
});

describe("createAuthSessionStore — idle timeout", () => {
  const SIGNED_IN = 1_000_000;

  async function signedInStore(options?: Parameters<typeof createAuthSessionStore>[1]) {
    const db = fakeAuthD1([{ id: USER_ID, email: "ada@example.test" }]);
    const store = createAuthSessionStore(createD1Client(db as unknown as D1Database, { logger: nullLogger }), options);
    await store.create({ ...INPUT, signedInAt: SIGNED_IN }, null);
    const touches = () => db.calls.filter((call) => normalized(call.sql) === TOUCH_SQL).length;
    return { store, db, touches };
  }

  const resolvedAt = async (store: ReturnType<typeof createAuthSessionStore>, at: number) => {
    const found = await store.resolve(HASH, at);
    return found.ok ? (found.data?.user.id ?? null) : "failed";
  };

  it("stops resolving a session unseen for 24 hours when no idle bound is configured, and resolves it a moment before", async () => {
    const { store } = await signedInStore();
    expect(await resolvedAt(store, SIGNED_IN + 86_400_000 - 1)).toBe(USER_ID);
    const { store: idle } = await signedInStore();
    expect(await resolvedAt(idle, SIGNED_IN + 86_400_000)).toBeNull();
  });

  it("keeps `last_seen_at` current with no idle bound, touching once every two hours", async () => {
    const { store, touches } = await signedInStore({ idleTimeoutMs: null });
    await resolvedAt(store, SIGNED_IN + 7_200_000 - 1);
    const inside = touches();
    await resolvedAt(store, SIGNED_IN + 7_200_000);
    expect([inside, touches()]).toEqual([0, 1]);
  });

  it("touches every twelfth of an idle bound a lifetime under a day has shortened, not every twelfth of a day", async () => {
    const { store, touches } = await signedInStore({ absoluteLifetimeMs: 3_600_000 });
    await resolvedAt(store, SIGNED_IN + 300_000 - 1);
    const inside = touches();
    await resolvedAt(store, SIGNED_IN + 300_000);
    expect([inside, touches()]).toEqual([0, 1]);
  });

  it("keeps resolving a session that is used, since each use inside the bound starts it over", async () => {
    const { store } = await signedInStore();
    expect(await resolvedAt(store, SIGNED_IN + AUTH_SESSION_IDLE_MS - 1)).toBe(USER_ID);
    expect(await resolvedAt(store, SIGNED_IN + 2 * AUTH_SESSION_IDLE_MS - 2)).toBe(USER_ID);
  });

  it("resolves a long-unused session until its absolute expiry when the idle bound is `null`", async () => {
    const { store } = await signedInStore({ idleTimeoutMs: null });
    expect(await resolvedAt(store, SIGNED_IN + AUTH_SESSION_MAX_MS - 1)).toBe(USER_ID);
    expect(await resolvedAt(store, SIGNED_IN + AUTH_SESSION_MAX_MS)).toBeNull();
  });

  it("writes no `last_seen_at` while the row shows it inside the touch interval, and exactly one past it", async () => {
    const { store, db, touches } = await signedInStore();
    await resolvedAt(store, SIGNED_IN + 1_000);
    await resolvedAt(store, SIGNED_IN + TOUCH_INTERVAL_MS - 1);
    const inside = touches();
    await resolvedAt(store, SIGNED_IN + TOUCH_INTERVAL_MS);
    await resolvedAt(store, SIGNED_IN + TOUCH_INTERVAL_MS + 1_000);
    const touch = db.calls.find((call) => normalized(call.sql) === TOUCH_SQL);
    expect({ inside, past: touches(), params: touch?.params }).toEqual({
      inside: 0,
      past: 1,
      params: [SIGNED_IN + TOUCH_INTERVAL_MS, HASH, SIGNED_IN],
    });
  });

  it("touches no more often than once a minute, however short the idle bound", async () => {
    const { store, touches } = await signedInStore({ idleTimeoutMs: 300_000 });
    await resolvedAt(store, SIGNED_IN + 59_999);
    const inside = touches();
    await resolvedAt(store, SIGNED_IN + 60_000);
    expect([inside, touches()]).toEqual([0, 1]);
  });

  it("still resolves the identity when the touch fails", async () => {
    const [client] = clientOf(() => [joinedRow({ last_seen_at: 0 })], {
      failOn: (sql) => (normalized(sql) === TOUCH_SQL ? new Error("D1_ERROR: network connection lost") : null),
    });
    const found = await createAuthSessionStore(client).resolve(HASH, 5_000_000);
    expect(found.ok && found.data?.user.id).toBe(USER_ID);
  });

  it("refuses an idle bound shorter than five minutes", () => {
    expect(() => createAuthSessionStore(clientOf()[0], { idleTimeoutMs: 299_999 })).toThrow(
      "createAuthSessionStore: idleTimeoutMs is 299999, below the 300000-millisecond floor — an idle bound shorter than reading one page signs a reader out mid-page.",
    );
  });

  it("refuses an idle bound past the default absolute lifetime", () => {
    expect(() => createAuthSessionStore(clientOf()[0], { idleTimeoutMs: AUTH_SESSION_MAX_MS + 1 })).toThrow(
      `createAuthSessionStore: idleTimeoutMs is ${AUTH_SESSION_MAX_MS + 1}, above the ${AUTH_SESSION_MAX_MS}-millisecond ceiling — past the absolute lifetime an idle bound bounds nothing, so pass \`null\`.`,
    );
  });

  it("accepts both ends of the idle range and `null`", () => {
    for (const idleTimeoutMs of [300_000, AUTH_SESSION_MAX_MS, null]) {
      expect(() => createAuthSessionStore(clientOf()[0], { idleTimeoutMs })).not.toThrow();
    }
  });
});

describe("createAuthSessionStore — absolute lifetime", () => {
  const SIGNED_IN = 1_000_000;
  const DAY_MS = 86_400_000;

  async function storeWith(options: Parameters<typeof createAuthSessionStore>[1]) {
    const store = createAuthSessionStore(
      createD1Client(fakeAuthD1([{ id: USER_ID, email: "ada@example.test" }]) as unknown as D1Database),
      options,
    );
    await store.create({ ...INPUT, signedInAt: SIGNED_IN }, null);
    return store;
  }

  const resolves = async (store: ReturnType<typeof createAuthSessionStore>, at: number) => {
    const found = await store.resolve(HASH, at);
    return found.ok && found.data !== null;
  };

  it("stops resolving a session configured to last a day just past the day, and resolves it just before", async () => {
    expect(await resolves(await storeWith({ absoluteLifetimeMs: DAY_MS }), SIGNED_IN + DAY_MS - 1)).toBe(true);
    expect(await resolves(await storeWith({ absoluteLifetimeMs: DAY_MS }), SIGNED_IN + DAY_MS)).toBe(false);
  });

  it("lasts seven days when no lifetime is configured", async () => {
    const found = await (await storeWith({ idleTimeoutMs: null })).resolve(HASH, SIGNED_IN);
    expect(found.ok && found.data?.session.expiresAt).toBe(SIGNED_IN + 7 * DAY_MS);
  });

  it("defaults the idle bound to a lifetime shorter than it, rather than refusing the pair", async () => {
    const [client, db] = clientOf(() => []);
    await createAuthSessionStore(client, { absoluteLifetimeMs: 3_600_000 }).resolve(HASH, 5_000_000);
    expect(db.calls[0]?.params[2]).toBe(5_000_000 - 3_600_000);
  });

  it("refuses a lifetime outside five minutes to seven days, or not a whole number", () => {
    const build = (absoluteLifetimeMs: number) => () => createAuthSessionStore(clientOf()[0], { absoluteLifetimeMs });
    expect(build(299_999)).toThrow(
      "createAuthSessionStore: absoluteLifetimeMs is 299999, below the 300000-millisecond floor — a session that ends inside five minutes signs a reader out mid-page.",
    );
    expect(build(AUTH_SESSION_MAX_MS + 1)).toThrow(
      `createAuthSessionStore: absoluteLifetimeMs is ${AUTH_SESSION_MAX_MS + 1}, above the ${AUTH_SESSION_MAX_MS}-millisecond ceiling — a session outliving a week gives a stolen token more than a week to be used.`,
    );
    expect(build(DAY_MS + 0.5)).toThrow("createAuthSessionStore: absoluteLifetimeMs is 86400000.5, which is not a whole number.");
    expect(build(300_000)).not.toThrow();
    expect(build(AUTH_SESSION_MAX_MS)).not.toThrow();
  });

  it("refuses an idle bound above the configured lifetime", () => {
    expect(() => createAuthSessionStore(clientOf()[0], { absoluteLifetimeMs: DAY_MS, idleTimeoutMs: DAY_MS + 1 })).toThrow(
      `createAuthSessionStore: idleTimeoutMs is ${DAY_MS + 1}, above the ${DAY_MS}-millisecond ceiling`,
    );
  });

  it("accepts an idle bound equal to the configured lifetime", () => {
    expect(() => createAuthSessionStore(clientOf()[0], { absoluteLifetimeMs: DAY_MS, idleTimeoutMs: DAY_MS })).not.toThrow();
  });

  it("signs out a session under the AAL2 settings once it goes an hour unused, and resolves it a moment before", async () => {
    const aal2 = { absoluteLifetimeMs: 86_400_000, idleTimeoutMs: 3_600_000 };
    expect(await resolves(await storeWith(aal2), SIGNED_IN + 3_600_000 - 1)).toBe(true);
    expect(await resolves(await storeWith(aal2), SIGNED_IN + 3_600_000)).toBe(false);
  });

  it("ends a session at its absolute lifetime however often it is used, and a step-up's rotation does not move the end", async () => {
    const store = await storeWith({ absoluteLifetimeMs: DAY_MS, idleTimeoutMs: 3_600_000 });
    const NEXT = new Uint8Array(32).fill(9);
    const HALF_HOUR = 1_800_000;
    let held = HASH;
    const used: boolean[] = [];
    for (let at = SIGNED_IN + HALF_HOUR; at < SIGNED_IN + DAY_MS; at += HALF_HOUR) {
      if (at === SIGNED_IN + DAY_MS / 2) {
        await store.rotate(held, NEXT, { at, kind: "passkey" });
        held = NEXT;
      }
      const found = await store.resolve(held, at);
      used.push(found.ok && found.data !== null);
    }
    const lastMoment = await store.resolve(held, SIGNED_IN + DAY_MS - 1);
    const atEnd = await store.resolve(held, SIGNED_IN + DAY_MS);
    expect({
      used: used.filter(Boolean).length,
      of: used.length,
      lastMoment: lastMoment.ok && lastMoment.data?.session.expiresAt,
      atEnd: atEnd.ok && atEnd.data,
    }).toEqual({ used: 47, of: 47, lastMoment: SIGNED_IN + DAY_MS, atEnd: null });
  });
});

describe("createAuthSessionStore — rotate", () => {
  const NEXT = new Uint8Array(32).fill(9);

  it("moves the row onto the new hash in one in-place update, recording the step-up's time and kind", async () => {
    const [client, db] = writerOf(() => 1);
    const batches = batchesOf(db);
    expect(await createAuthSessionStore(client).rotate(HASH, NEXT, { at: 4_000, kind: "passkey" })).toEqual({ ok: true, data: true });
    expect({ batches, params: db.calls.map((call) => eventParams(call.params)) }).toEqual({
      batches: [["UPDATE auth_sessions SET token_hash = ?, step_up_at = ?, step_up_kind = ? WHERE token_hash = ?", STEPPED_UP_SQL]],
      params: [
        [NEXT, 4_000, "passkey", HASH],
        ["event-id", NEXT, "stepped-up", "passkey", NEXT, null, 4_000],
      ],
    });
  });

  it("records `stepped-up` only where the rotation moved a row, reading it through the new hash", async () => {
    // The fake answers `changes() > 0` from the write before it, as SQLite does.
    let changed = 0;
    let recorded = 0;
    const [client] = writerOf((sql) => {
      if (!sql.includes("auth_security_events")) return (changed = 0);
      const lands = Number(!sql.includes("changes() > 0") || changed > 0);
      recorded += lands;
      return lands;
    });
    expect({ rotated: await createAuthSessionStore(client).rotate(HASH, NEXT, { at: 4_000, kind: "passkey" }), recorded }).toEqual({
      rotated: { ok: true, data: false },
      recorded: 0,
    });
  });

  it("writes only the hash when no step-up is given, so every other column stays as it was, and records no event", async () => {
    const [client, db] = writerOf(() => 1);
    expect(await createAuthSessionStore(client).rotate(HASH, NEXT)).toEqual({ ok: true, data: true });
    expect(db.calls.map((call) => [normalized(call.sql), call.params])).toEqual([
      ["UPDATE auth_sessions SET token_hash = ? WHERE token_hash = ?", [NEXT, HASH]],
    ]);
  });

  it("answers false when no row carries the hash", async () => {
    const [client] = writerOf(() => 0);
    expect(await createAuthSessionStore(client).rotate(HASH, NEXT, { at: 4_000, kind: "passkey" })).toEqual({ ok: true, data: false });
  });

  it("surfaces a D1 failure as one AuthStoreError naming the operation", async () => {
    expect(failureOf(await createAuthSessionStore(failing()).rotate(HASH, NEXT, { at: 4_000, kind: "passkey" }))).toEqual([
      true,
      "unavailable",
      "sessions.rotate",
    ]);
  });
});

describe("createAuthSessionStore — remove", () => {
  it("deletes the row the hash names", async () => {
    const [client, db] = writerOf(() => 1);
    expect(await createAuthSessionStore(client).remove(HASH)).toEqual({ ok: true, data: true });
    expect([normalized(db.calls[0]?.sql), db.calls[0]?.params]).toEqual(["DELETE FROM auth_sessions WHERE token_hash = ?", [HASH]]);
  });

  it("answers false when no row carries the hash", async () => {
    const [client] = writerOf(() => 0);
    expect(await createAuthSessionStore(client).remove(HASH)).toEqual({ ok: true, data: false });
  });

  it("surfaces a D1 failure as one AuthStoreError naming the operation", async () => {
    expect(failureOf(await createAuthSessionStore(failing()).remove(HASH))).toEqual([true, "unavailable", "sessions.remove"]);
  });
});

function sessionRow(id: string, signedInAt: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_id: uuidToBytes(id),
    signed_in_at: signedInAt,
    expires_at: 9_000,
    step_up_at: null,
    step_up_kind: null,
    last_seen_at: signedInAt,
    device: null,
    ...overrides,
  };
}

describe("createAuthSessionStore — listByUser", () => {
  it("reads the owner's sessions live at `at` under the idle bound, newest sign-in first, at most a page", async () => {
    const [client, db] = clientOf(() => []);
    await createAuthSessionStore(client).listByUser(USER_ID, 5_000);
    expect([normalized(db.calls[0]?.sql), db.calls[0]?.params]).toEqual([
      LIST_SQL,
      [uuidToBytes(USER_ID), 5_000, 5_000 - AUTH_SESSION_IDLE_MS, 50],
    ]);
  });

  it("reads with no idle term when the idle bound is `null`", async () => {
    const [client, db] = clientOf(() => []);
    await createAuthSessionStore(client, { idleTimeoutMs: null }).listByUser(USER_ID, 5_000);
    expect(normalized(db.calls[0]?.sql)).toBe(LIST_SQL.replace(" AND last_seen_at > ?", ""));
  });

  it("maps every row to a session record and never to its token's hash", async () => {
    const other = uuidv7();
    const [client] = clientOf(() => [
      sessionRow(SESSION_ID, 2_000, { device: "Chrome on Android", step_up_at: 2_100, step_up_kind: "passkey" }),
      sessionRow(other, 1_000),
    ]);
    expect(await createAuthSessionStore(client).listByUser(USER_ID, 5_000)).toEqual({
      ok: true,
      data: [
        {
          id: SESSION_ID,
          signedInAt: 2_000,
          expiresAt: 9_000,
          lastSeenAt: 2_000,
          stepUpAt: 2_100,
          stepUpKind: "passkey",
          device: "Chrome on Android",
        },
        { id: other, signedInAt: 1_000, expiresAt: 9_000, lastSeenAt: 1_000, stepUpAt: null, stepUpKind: null, device: null },
      ],
    });
  });

  it("answers none for an owner id that is not a UUID, and binds nothing", async () => {
    const [client, db] = clientOf(() => [sessionRow(SESSION_ID, 1_000)]);
    expect({ listed: await createAuthSessionStore(client).listByUser("u9", 5_000), calls: db.calls }).toEqual({
      listed: { ok: true, data: [] },
      calls: [],
    });
  });

  it("reports a row that will not decode as `unavailable`, rather than throwing", async () => {
    const [client] = clientOf(() => [sessionRow(SESSION_ID, 1_000, { session_id: null })]);
    expect(failureOf(await createAuthSessionStore(client).listByUser(USER_ID, 5_000))).toEqual([true, "unavailable", "sessions.listByUser"]);
  });

  it("surfaces a D1 failure as one AuthStoreError naming the operation", async () => {
    expect(failureOf(await createAuthSessionStore(failing()).listByUser(USER_ID, 5_000))).toEqual([true, "unavailable", "sessions.listByUser"]);
  });
});

describe("createAuthSessionStore — revoke", () => {
  it("deletes the one session the id names among the owner's, sparing the acting one, and records `sessions-revoked` in the same batch", async () => {
    const [client, db] = writerOf(() => 1);
    const batches = batchesOf(db);
    expect(await createAuthSessionStore(client).revoke(USER_ID, SESSION_ID, 6_000, { keep: HASH })).toEqual({ ok: true, data: true });
    expect({ batches, params: [db.calls[0]?.params, eventParams(db.calls[1]?.params)] }).toEqual({
      batches: [["DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ? AND id = ?", REVOKED_SQL]],
      params: [
        [uuidToBytes(USER_ID), HASH, uuidToBytes(SESSION_ID)],
        ["event-id", uuidToBytes(USER_ID), "sessions-revoked", null, HASH, null, 6_000],
      ],
    });
  });

  it("deletes nothing and records nothing for another user's session or the acting one", async () => {
    const db = fakeAuthD1([
      { id: USER_ID, email: "ada@example.test" },
      { id: OTHER_USER, email: "grace@example.test" },
    ]);
    const store = createAuthSessionStore(createD1Client(db as unknown as D1Database, { logger: nullLogger }));
    await store.create(INPUT, null);
    await store.create({ ...INPUT, tokenHash: PREVIOUS, userId: OTHER_USER }, null);
    const [own] = await listed(store, USER_ID);
    const [theirs] = await listed(store, OTHER_USER);
    const outcomes = [
      await store.revoke(USER_ID, theirs ?? "", 6_000, { keep: HASH }),
      await store.revoke(USER_ID, own ?? "", 6_000, { keep: HASH }),
    ];
    const events = await createSecurityEventStore(createD1Client(db as unknown as D1Database)).listByUser(USER_ID);
    expect({
      outcomes,
      left: [(await listed(store, USER_ID)).length, (await listed(store, OTHER_USER)).length],
      revokedEvents: events.ok && events.data.filter((event) => event.type === "sessions-revoked").length,
    }).toEqual({
      outcomes: [
        { ok: true, data: false },
        { ok: true, data: false },
      ],
      left: [1, 1],
      revokedEvents: 0,
    });
  });

  it("answers false for a malformed owner or session id, and binds nothing", async () => {
    const [client, db] = writerOf(() => 1);
    const store = createAuthSessionStore(client);
    expect([
      await store.revoke("u9", SESSION_ID, 6_000, { keep: HASH }),
      await store.revoke(USER_ID, "s9", 6_000, { keep: HASH }),
      db.calls,
    ]).toEqual([{ ok: true, data: false }, { ok: true, data: false }, []]);
  });

  it("surfaces a D1 failure as one AuthStoreError naming the operation", async () => {
    expect(failureOf(await createAuthSessionStore(failing()).revoke(USER_ID, SESSION_ID, 6_000, { keep: HASH }))).toEqual([
      true,
      "unavailable",
      "sessions.revoke",
    ]);
  });
});

describe("createAuthSessionStore — revokeOthers", () => {
  it("deletes the owner's rows except the one kept, records `sessions-revoked` behind the delete in the same batch, and answers how many went", async () => {
    const [client, db] = writerOf((sql) => (sql.includes("auth_security_events") ? 1 : 2));
    const batches = batchesOf(db);
    expect(await createAuthSessionStore(client).revokeOthers(USER_ID, 6_000, { keep: HASH })).toEqual({ ok: true, data: 2 });
    expect({ batches, params: [db.calls[0]?.params, eventParams(db.calls[1]?.params)] }).toEqual({
      batches: [["DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ?", REVOKED_SQL]],
      params: [
        [uuidToBytes(USER_ID), HASH],
        ["event-id", uuidToBytes(USER_ID), "sessions-revoked", null, HASH, null, 6_000],
      ],
    });
  });

  it("omits the spared-session term entirely when no session is kept, so every row goes and none is bound to `!= NULL`", async () => {
    const [client, db] = writerOf(() => 1);
    await createAuthSessionStore(client).revokeOthers(USER_ID, 6_000, { keep: null });
    expect([normalized(db.calls[0]?.sql), db.calls[0]?.params, normalized(db.calls[1]?.sql)]).toEqual([
      "DELETE FROM auth_sessions WHERE user_id = ?",
      [uuidToBytes(USER_ID)],
      securityEventText({ guard: "changes() > 0" }),
    ]);
  });

  it("revokes every session with `keep: null`, and records `sessions-revoked` only when one went", async () => {
    const db = fakeAuthD1([{ id: USER_ID, email: "ada@example.test" }]);
    const store = createAuthSessionStore(createD1Client(db as unknown as D1Database, { logger: nullLogger }));
    await store.create(INPUT, null);
    await store.create({ ...INPUT, tokenHash: PREVIOUS }, null);
    const revoked = [await store.revokeOthers(USER_ID, 6_000, { keep: null }), await store.revokeOthers(USER_ID, 6_000, { keep: null })];
    const events = await createSecurityEventStore(createD1Client(db as unknown as D1Database)).listByUser(USER_ID);
    expect({
      revoked,
      left: await listed(store, USER_ID),
      recorded: events.ok && events.data.filter((event) => event.type === "sessions-revoked").map((event) => [event.sessionId, event.at]),
    }).toEqual({
      revoked: [
        { ok: true, data: 2 },
        { ok: true, data: 0 },
      ],
      left: [],
      recorded: [[null, 6_000]],
    });
  });

  it("answers 0 for an owner id that is not a UUID, and binds nothing", async () => {
    const [client, db] = writerOf(() => 2);
    expect({ revoked: await createAuthSessionStore(client).revokeOthers("u9", 6_000, { keep: HASH }), calls: db.calls }).toEqual({
      revoked: { ok: true, data: 0 },
      calls: [],
    });
  });

  it("surfaces a D1 failure as one AuthStoreError naming the operation", async () => {
    expect(failureOf(await createAuthSessionStore(failing()).revokeOthers(USER_ID, 6_000, { keep: HASH }))).toEqual([
      true,
      "unavailable",
      "sessions.revokeOthers",
    ]);
  });
});

describe("authSessionRevocation", () => {
  it("spares the kept session and appends the guard as one more term", () => {
    const fragment = authSessionRevocation(uuidToBytes(USER_ID), HASH, sqlFragment`changes() > 0`);
    expect([normalized(fragment.text), fragment.params]).toEqual([
      "DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ? AND changes() > 0",
      [uuidToBytes(USER_ID), HASH],
    ]);
  });

  it("drops the spared-session term with no session to keep, since `token_hash != NULL` would match no row", () => {
    const fragment = authSessionRevocation(uuidToBytes(USER_ID), null);
    expect([normalized(fragment.text), fragment.params]).toEqual(["DELETE FROM auth_sessions WHERE user_id = ?", [uuidToBytes(USER_ID)]]);
  });
});
