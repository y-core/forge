import { describe, expect, it } from "bun:test";

import { createD1Client } from "../../storage/db/client";
import type { D1Client, D1Database } from "../../storage/db/types";
import { uuidToBytes, uuidv7 } from "../../storage/db/uuid";
import { nullLogger } from "../../testing/context";
import { fakeD1 } from "../../testing/fakes";
import type { FakeD1Options } from "../../testing/types";
import { AuthStoreError } from "../errors";
import type { OtpState } from "../types";
import { createOtpStateStore } from "./otp-state";
import type { OtpStateRow } from "./types";

const USER_ID = uuidv7();
const OTHER_ID = uuidv7();
const NOW = 1_700_000_000_000;
const TTL_MS = 600_000;
const COOLDOWN_MS = 60_000;
const WINDOW_MS = 900_000;
const BINDING = new Uint8Array(32).fill(7);

const STATE: OtpState = { token: "c2VhbGVk", attempts: 0, issuedAt: NOW, expiresAt: NOW + TTL_MS };
const ROW: OtpStateRow = { token: STATE.token, attempts: 1, issued_at: STATE.issuedAt, expires_at: STATE.expiresAt };

type FakeDb = ReturnType<typeof fakeD1>;

function clientOf(rows: (sql: string, params: unknown[]) => unknown[] = () => [], options?: FakeD1Options): [D1Client, FakeDb] {
  const db = fakeD1(rows, options);
  return [createD1Client(db as unknown as D1Database, { logger: nullLogger }), db];
}

function normalized(sql: string | undefined): string {
  return (sql ?? "").replace(/\s+/g, " ").trim();
}

describe("createOtpStateStore — issuing", () => {
  it("claims the cooldown in the upsert itself, moving the binding to the reissued code and leaving it the guess count and window", async () => {
    const [client, db] = clientOf(() => [], { rowsWritten: () => 1 });
    expect(await createOtpStateStore(client).issue(USER_ID, STATE, COOLDOWN_MS, BINDING)).toEqual({ ok: true, data: true });
    expect(normalized(db.calls[0]?.sql)).toBe(
      "INSERT INTO auth_otp_state (user_id, token, attempts, issued_at, expires_at, binding) VALUES (?, ?, 0, ?, ?, ?) " +
        "ON CONFLICT (user_id) DO UPDATE SET token = excluded.token, issued_at = excluded.issued_at, expires_at = excluded.expires_at, " +
        "binding = excluded.binding WHERE auth_otp_state.issued_at <= ?",
    );
    expect(db.calls[0]?.params).toEqual([uuidToBytes(USER_ID), STATE.token, STATE.issuedAt, STATE.expiresAt, BINDING, NOW - COOLDOWN_MS]);
  });

  it("reports the cooldown holding as false rather than as a failure", async () => {
    const [client] = clientOf(() => [], { rowsWritten: () => 0 });
    expect(await createOtpStateStore(client).issue(USER_ID, STATE, COOLDOWN_MS, BINDING)).toEqual({ ok: true, data: false });
  });
});

describe("createOtpStateStore — a reissue from another browser", () => {
  /** A one-row double that evaluates the store's own upsert and read, moving the binding only where the upsert's `SET` names it. */
  function oneRow(): [D1Client, FakeDb] {
    let row: { token: unknown; issued_at: number; expires_at: number; binding: Uint8Array } | null = null;
    const sameBinding = (held: Uint8Array, asked: unknown) => asked instanceof Uint8Array && held.every((byte, i) => byte === asked[i]);
    return clientOf(
      (sql, params) => {
        if (!sql.startsWith("SELECT") || row === null) return [];
        const [, at, binding] = params as [unknown, number, Uint8Array];
        return row.expires_at > at && sameBinding(row.binding, binding) ? [{ ...ROW, token: row.token }] : [];
      },
      {
        rowsWritten: (sql, params) => {
          if (!sql.startsWith("INSERT INTO auth_otp_state")) return 0;
          const [, token, issuedAt, expiresAt, binding, claimable] = params as [unknown, unknown, number, number, Uint8Array, number];
          if (row !== null && row.issued_at > claimable) return 0;
          const rebinds = row === null || /\bbinding = excluded\.binding\b/.test(sql);
          row = { token, issued_at: issuedAt, expires_at: expiresAt, binding: rebinds ? binding : (row?.binding ?? binding) };
          return 1;
        },
      },
    );
  }

  it("moves the live code to the browser that asks once the cooldown has passed, so the first browser's code reads as none", async () => {
    const [client] = oneRow();
    const store = createOtpStateStore(client);
    const other = new Uint8Array(32).fill(9);
    const later: OtpState = { ...STATE, token: "cmViaW5k", issuedAt: NOW + COOLDOWN_MS, expiresAt: NOW + COOLDOWN_MS + TTL_MS };
    await store.issue(USER_ID, STATE, COOLDOWN_MS, BINDING);
    const reissued = await store.issue(USER_ID, later, COOLDOWN_MS, other);
    const read = async (binding: Uint8Array<ArrayBuffer>) => {
      const found = await store.read(USER_ID, NOW + COOLDOWN_MS, binding);
      return found.ok ? (found.data?.token ?? null) : "unavailable";
    };
    expect({ reissued, first: await read(BINDING), asking: await read(other) }).toEqual({
      reissued: { ok: true, data: true },
      first: null,
      asking: "cmViaW5k",
    });
  });
});

describe("createOtpStateStore — spending a guess", () => {
  it("spends the guess against the identity's window in one statement, opening a new window once the last has lapsed", async () => {
    const [client, db] = clientOf(() => [ROW]);
    expect(await createOtpStateStore(client).countAttempt(USER_ID, 3, NOW, WINDOW_MS, BINDING)).toEqual({
      ok: true,
      data: { token: STATE.token, attempts: 1, issuedAt: STATE.issuedAt, expiresAt: STATE.expiresAt },
    });
    expect(normalized(db.calls[0]?.sql)).toBe(
      "UPDATE auth_otp_state SET attempts = CASE WHEN window_started_at > ? THEN attempts + 1 ELSE 1 END, " +
        "window_started_at = CASE WHEN window_started_at > ? THEN window_started_at ELSE ? END " +
        "WHERE user_id = ? AND expires_at > ? AND binding = ? AND (window_started_at IS NULL OR window_started_at <= ? OR attempts < ?) " +
        "RETURNING token, attempts, issued_at, expires_at",
    );
    const lapsed = NOW - WINDOW_MS;
    expect(db.calls[0]?.params).toEqual([lapsed, lapsed, NOW, uuidToBytes(USER_ID), NOW, BINDING, lapsed, 3]);
  });

  it("reports a refused guess as null, which is the budget and the expiry collapsed into one answer", async () => {
    const [client] = clientOf(() => []);
    expect(await createOtpStateStore(client).countAttempt(USER_ID, 3, NOW, WINDOW_MS, BINDING)).toEqual({ ok: true, data: null });
  });

  it("holds a read against the clock and the binding, so an expired row or another browser's is no code at all", async () => {
    const [client, db] = clientOf(() => []);
    expect(await createOtpStateStore(client).read(USER_ID, NOW, BINDING)).toEqual({ ok: true, data: null });
    expect(normalized(db.calls[0]?.sql)).toBe(
      "SELECT token, attempts, issued_at, expires_at FROM auth_otp_state WHERE user_id = ? AND expires_at > ? AND binding = ? LIMIT 1",
    );
    expect(db.calls[0]?.params).toEqual([uuidToBytes(USER_ID), NOW, BINDING]);
  });

  it("reads the live code without spending a guess", async () => {
    const [client] = clientOf(() => [ROW]);
    const live = await createOtpStateStore(client).read(USER_ID, NOW, BINDING);
    expect(live).toEqual({ ok: true, data: { token: STATE.token, attempts: 1, issuedAt: STATE.issuedAt, expiresAt: STATE.expiresAt } });
  });

  it("clears one identity's code by its own key", async () => {
    const [client, db] = clientOf(() => [], { rowsWritten: () => 1 });
    expect(await createOtpStateStore(client).clear(OTHER_ID)).toEqual({ ok: true, data: undefined });
    expect(normalized(db.calls[0]?.sql)).toBe("DELETE FROM auth_otp_state WHERE user_id = ?");
    expect(db.calls[0]?.params).toEqual([uuidToBytes(OTHER_ID)]);
  });
});

// `clear` is an unconditional delete, so rolling an undeliverable issue back with it would wipe a
// second issue that raced it and did reach the address.
describe("createOtpStateStore — discarding one named code", () => {
  it("names the token in the statement, and retires that code rather than deleting the row its guess window lives on", async () => {
    const [client, db] = clientOf(() => [], { rowsWritten: () => 1 });
    expect(await createOtpStateStore(client).discard(USER_ID, STATE.token)).toEqual({ ok: true, data: undefined });
    expect(normalized(db.calls[0]?.sql)).toBe("UPDATE auth_otp_state SET issued_at = 0, expires_at = 0 WHERE user_id = ? AND token = ?");
    expect(db.calls[0]?.params).toEqual([uuidToBytes(USER_ID), STATE.token]);
  });

  it("reports success when the row was already replaced, since the rollback has nothing left to undo", async () => {
    const [client] = clientOf(() => [], { rowsWritten: () => 0 });
    expect(await createOtpStateStore(client).discard(USER_ID, STATE.token)).toEqual({ ok: true, data: undefined });
  });
});

describe("createOtpStateStore — failures", () => {
  it("surfaces every backend failure as an AuthStoreError, never as a thrown error", async () => {
    const [client] = clientOf(() => [], { failOn: () => new Error("D1 unreachable") });
    const store = createOtpStateStore(client);
    const outcomes = [
      ["otpState.issue", await store.issue(USER_ID, STATE, COOLDOWN_MS, BINDING)],
      ["otpState.countAttempt", await store.countAttempt(USER_ID, 3, NOW, WINDOW_MS, BINDING)],
      ["otpState.read", await store.read(USER_ID, NOW, BINDING)],
      ["otpState.discard", await store.discard(USER_ID, STATE.token)],
      ["otpState.clear", await store.clear(USER_ID)],
    ] as const;

    for (const [operation, outcome] of outcomes) {
      expect(`${operation}: ${outcome.ok}`).toBe(`${operation}: false`);
      if (outcome.ok) continue;
      expect(outcome.error).toBeInstanceOf(AuthStoreError);
      expect(`${outcome.error.code} ${outcome.error.operation}`).toBe(`unavailable ${operation}`);
    }
  });
});
