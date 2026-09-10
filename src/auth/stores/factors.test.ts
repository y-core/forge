import { describe, expect, it } from "bun:test";

import { uuidToBytes, uuidv7 } from "../../crypto/mod";
import { createD1Client } from "../../storage/db/client";
import type { D1Client, D1Database } from "../../storage/db/types";
import { nullLogger } from "../../testing/context";
import { fakeD1 } from "../../testing/fakes";
import type { FakeD1Options } from "../../testing/types";
import { createFactorStore } from "./factors";

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

describe("createFactorStore", () => {
  it("resolves every offered kind in one statement", async () => {
    const [client, db] = clientOf(() => []);
    await createFactorStore(client).findEnrolled(USER_ID, ["email-otp", "passkey", "totp-app"]);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]?.sql).toContain("kind IN (?, ?, ?)");
    expect(db.calls[0]?.params).toEqual([uuidToBytes(USER_ID), "email-otp", "passkey", "totp-app"]);
  });

  it("issues no statement at all for an empty kind list", async () => {
    const [client, db] = clientOf(() => []);
    expect(await createFactorStore(client).findEnrolled(USER_ID, [])).toEqual({ ok: true, data: [] });
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
        confirmed_at: null,
        created_at: 1,
        updated_at: 2,
      },
    ]);
    const found = await createFactorStore(client).find(USER_ID, "email-otp");
    expect(found.ok && found.data?.secret).toBeNull();
    expect(found.ok && found.data?.lastCounter).toBeNull();
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
    expect(await factors.advanceCounter(OTHER_ID, USER_ID, 57, 1)).toEqual({ ok: true, data: true });
    expect(await factors.advanceCounter(OTHER_ID, USER_ID, 57, 2)).toEqual({ ok: true, data: false });
    expect(await factors.advanceCounter(OTHER_ID, USER_ID, 56, 3)).toEqual({ ok: true, data: false });
    expect(await factors.advanceCounter(OTHER_ID, USER_ID, 58, 4)).toEqual({ ok: true, data: true });
    expect(db.calls[0]?.sql.replace(/\s+/g, " ")).toContain("WHERE id = ? AND user_id = ? AND (last_counter IS NULL OR last_counter < ?)");
  });

  // The budget is spent by the statement that admits the guess, so N parallel guesses spend N of it
  // rather than each comparing against a count none of them has written.
  it("spends a guess and admits it in one statement, and clears the count on an accepted step", async () => {
    let spent = 0;
    const [client, db] = writerOf((sql, params) => {
      if (sql.includes("SET failed_attempts = failed_attempts + 1")) {
        if (spent >= (params[3] as number)) return 0;
        spent += 1;
        return 1;
      }
      spent = 0;
      return 1;
    });
    const factors = createFactorStore(client);

    expect(await factors.countAttempt(OTHER_ID, USER_ID, 2, 1)).toEqual({ ok: true, data: true });
    expect(await factors.countAttempt(OTHER_ID, USER_ID, 2, 2)).toEqual({ ok: true, data: true });
    expect(await factors.countAttempt(OTHER_ID, USER_ID, 2, 3)).toEqual({ ok: true, data: false });
    await factors.advanceCounter(OTHER_ID, USER_ID, 57, 4);
    expect(await factors.countAttempt(OTHER_ID, USER_ID, 2, 5)).toEqual({ ok: true, data: true });

    expect(db.calls[0]?.sql.replace(/\s+/g, " ")).toContain("WHERE id = ? AND user_id = ? AND failed_attempts < ?");
    expect(db.calls[3]?.sql.replace(/\s+/g, " ")).toContain("SET last_counter = ?, failed_attempts = 0");
  });
});
