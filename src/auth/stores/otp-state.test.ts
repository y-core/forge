import { describe, expect, it } from "bun:test";

import { uuidToBytes, uuidv7 } from "../../crypto/mod";
import { createD1Client } from "../../storage/db/client";
import type { D1Client, D1Database } from "../../storage/db/types";
import { nullLogger } from "../../testing/context";
import { fakeD1, type FakeD1Options } from "../../testing/fakes";
import { AuthStoreError } from "../errors";
import type { OtpState } from "../types";
import { createOtpStateStore, type OtpStateRow } from "./otp-state";

const USER_ID = uuidv7();
const OTHER_ID = uuidv7();
const NOW = 1_700_000_000_000;
const TTL_MS = 600_000;
const COOLDOWN_MS = 60_000;

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
  it("claims the cooldown in the upsert itself, so no prior read decides it", async () => {
    const [client, db] = clientOf(() => [], { rowsWritten: () => 1 });
    expect(await createOtpStateStore(client).issue(USER_ID, STATE, COOLDOWN_MS)).toEqual({ ok: true, data: true });
    expect(normalized(db.calls[0]?.sql)).toBe(
      "INSERT INTO auth_otp_state (user_id, token, attempts, issued_at, expires_at) VALUES (?, ?, 0, ?, ?) " +
        "ON CONFLICT (user_id) DO UPDATE SET token = excluded.token, attempts = 0, issued_at = excluded.issued_at, expires_at = excluded.expires_at " +
        "WHERE auth_otp_state.issued_at <= ?",
    );
    expect(db.calls[0]?.params).toEqual([uuidToBytes(USER_ID), STATE.token, STATE.issuedAt, STATE.expiresAt, NOW - COOLDOWN_MS]);
  });

  it("reports the cooldown holding as false rather than as a failure", async () => {
    const [client] = clientOf(() => [], { rowsWritten: () => 0 });
    expect(await createOtpStateStore(client).issue(USER_ID, STATE, COOLDOWN_MS)).toEqual({ ok: true, data: false });
  });
});

describe("createOtpStateStore — spending a guess", () => {
  it("increments and admits in one statement, returning the code the guess was spent against", async () => {
    const [client, db] = clientOf(() => [ROW]);
    expect(await createOtpStateStore(client).countAttempt(USER_ID, 3, NOW)).toEqual({
      ok: true,
      data: { token: STATE.token, attempts: 1, issuedAt: STATE.issuedAt, expiresAt: STATE.expiresAt },
    });
    expect(normalized(db.calls[0]?.sql)).toBe(
      "UPDATE auth_otp_state SET attempts = attempts + 1 WHERE user_id = ? AND attempts < ? AND expires_at > ? RETURNING token, attempts, issued_at, expires_at",
    );
    expect(db.calls[0]?.params).toEqual([uuidToBytes(USER_ID), 3, NOW]);
  });

  it("reports a refused guess as null, which is the budget and the expiry collapsed into one answer", async () => {
    const [client] = clientOf(() => []);
    expect(await createOtpStateStore(client).countAttempt(USER_ID, 3, NOW)).toEqual({ ok: true, data: null });
  });

  it("holds a read against the clock, so an expired row is no code at all", async () => {
    const [client, db] = clientOf(() => []);
    expect(await createOtpStateStore(client).read(USER_ID, NOW)).toEqual({ ok: true, data: null });
    expect(normalized(db.calls[0]?.sql)).toBe(
      "SELECT token, attempts, issued_at, expires_at FROM auth_otp_state WHERE user_id = ? AND expires_at > ?",
    );
    expect(db.calls[0]?.params).toEqual([uuidToBytes(USER_ID), NOW]);
  });

  it("reads the live code without spending a guess", async () => {
    const [client] = clientOf(() => [ROW]);
    const live = await createOtpStateStore(client).read(USER_ID, NOW);
    expect(live).toEqual({ ok: true, data: { token: STATE.token, attempts: 1, issuedAt: STATE.issuedAt, expiresAt: STATE.expiresAt } });
  });

  it("clears one identity's code by its own key", async () => {
    const [client, db] = clientOf(() => [], { rowsWritten: () => 1 });
    expect(await createOtpStateStore(client).clear(OTHER_ID)).toEqual({ ok: true, data: undefined });
    expect(normalized(db.calls[0]?.sql)).toBe("DELETE FROM auth_otp_state WHERE user_id = ?");
    expect(db.calls[0]?.params).toEqual([uuidToBytes(OTHER_ID)]);
  });
});

describe("createOtpStateStore — failures", () => {
  it("surfaces every backend failure as an AuthStoreError, never as a thrown error", async () => {
    const [client] = clientOf(() => [], { failOn: () => new Error("D1 unreachable") });
    const store = createOtpStateStore(client);
    const outcomes = [
      ["otpState.issue", await store.issue(USER_ID, STATE, COOLDOWN_MS)],
      ["otpState.countAttempt", await store.countAttempt(USER_ID, 3, NOW)],
      ["otpState.read", await store.read(USER_ID, NOW)],
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
