import { describe, expect, it } from "bun:test";

import { uuidToBytes, uuidv7 } from "../../crypto/mod";
import { createD1Client } from "../../storage/db/client";
import type { D1Client, D1Database } from "../../storage/db/types";
import { nullLogger } from "../../testing/context";
import { fakeD1 } from "../../testing/fakes";
import type { FakeD1Options } from "../../testing/types";
import { AuthStoreError } from "../errors";
import type { AuthUser } from "../types";
import { createUserStore } from "./users";

const USER_ID = uuidv7();

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

function userRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: uuidToBytes(USER_ID),
    email: "Aurora@Example.test",
    email_key: "aurora@example.test",
    email_verified_at: null,
    webauthn_id: null,
    is_admin: 0,
    deactivated_at: null,
    sessions_invalid_before: null,
    created_at: 1_000,
    updated_at: 2_000,
    ...overrides,
  };
}

describe("createUserStore — reads", () => {
  it("maps a row to the domain record, including the two boolean and nullable columns", async () => {
    const [client] = clientOf(() => [userRow({ is_admin: 1, email_verified_at: 4_000 })]);
    const found = await createUserStore(client).findById(USER_ID);
    expect(found).toEqual({
      ok: true,
      data: {
        id: USER_ID,
        email: "Aurora@Example.test",
        emailKey: "aurora@example.test",
        emailVerifiedAt: 4_000,
        webauthnId: null,
        isAdmin: true,
        deactivatedAt: null,
        sessionsInvalidBefore: null,
        createdAt: 1_000,
        updatedAt: 2_000,
      } satisfies AuthUser,
    });
  });

  it("reports a missing user as ok(null), never as an error", async () => {
    const [client] = clientOf(() => []);
    expect(await createUserStore(client).findById(USER_ID)).toEqual({ ok: true, data: null });
    expect(await createUserStore(client).findByEmailKey("nobody@example.test")).toEqual({ ok: true, data: null });
  });

  it("looks a user up by the normalized email key, bound as a parameter", async () => {
    const [client, db] = clientOf(() => [userRow()]);
    await createUserStore(client).findByEmailKey("aurora@example.test");
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]?.sql).toContain("email_key = ?");
    expect(db.calls[0]?.params).toEqual(["aurora@example.test"]);
  });

  it("reads a BLOB column back from bytes, an ArrayBuffer or a number array alike", async () => {
    const bytes = uuidToBytes(USER_ID);
    for (const shape of [bytes, bytes.buffer, [...bytes]]) {
      const [client] = clientOf(() => [userRow({ id: shape })]);
      const found = await createUserStore(client).findById(USER_ID);
      expect(found.ok && found.data?.id).toBe(USER_ID);
    }
  });
});

describe("createUserStore — writes", () => {
  it("returns the record it inserted, with both timestamps set to the given instant", async () => {
    const [client] = clientOf();
    const created = await createUserStore(client).create({ email: "Aurora@Example.test", emailKey: "aurora@example.test" }, 9_000);
    expect(created.ok && created.data).toEqual({
      id: created.ok ? created.data.id : "",
      email: "Aurora@Example.test",
      emailKey: "aurora@example.test",
      emailVerifiedAt: null,
      webauthnId: null,
      isAdmin: false,
      deactivatedAt: null,
      sessionsInvalidBefore: null,
      createdAt: 9_000,
      updatedAt: 9_000,
    });
  });

  // Answering the mailed link is the verification, so a second statement to stamp it is a write that
  // can fail on its own and leave the account holding an address it cannot prove.
  it("stamps the new address verified in the statement that moves it", async () => {
    const [client, db] = writerOf(() => 1);
    expect(await createUserStore(client).changeEmail(USER_ID, "new@example.test", "new@example.test", 9_000)).toEqual({ ok: true, data: true });
    expect(db.calls[0]?.sql.replace(/\s+/g, " ")).toBe(
      "UPDATE auth_users SET email = ?, email_key = ?, email_verified_at = ?, updated_at = ? WHERE id = ?",
    );
    expect(db.calls[0]?.params.slice(0, 4)).toEqual(["new@example.test", "new@example.test", 9_000, 9_000]);
  });

  // Monotonic, so two revocations racing cannot walk the barrier backwards and hand a session that
  // was already refused back to its holder.
  it("moves the session barrier forward only, in the statement itself", async () => {
    const [client, db] = writerOf(() => 1);
    expect(await createUserStore(client).revokeSessions(USER_ID, 9_000)).toEqual({ ok: true, data: true });
    expect(db.calls[0]?.sql.replace(/\s+/g, " ")).toBe(
      "UPDATE auth_users SET sessions_invalid_before = ?, updated_at = ? WHERE id = ? AND (sessions_invalid_before IS NULL OR sessions_invalid_before < ?)",
    );
    expect(db.calls[0]?.params).toEqual([9_000, 9_000, uuidToBytes(USER_ID), 9_000]);
  });

  it("reports no change when the barrier already stood at or past the instant asked for", async () => {
    const [client] = writerOf(() => 0);
    expect(await createUserStore(client).revokeSessions(USER_ID, 9_000)).toEqual({ ok: true, data: false });
  });

  it("has no capability to delete a user", () => {
    const [client] = clientOf();
    expect("remove" in createUserStore(client)).toBe(false);
    expect("setAdmin" in createUserStore(client)).toBe(false);
  });

  it("reports a verification stamp against a missing id, rather than returning success", async () => {
    const [missing] = writerOf(() => 0);
    const [present] = writerOf(() => 1);
    expect(await createUserStore(missing).markEmailVerified(USER_ID, 1)).toEqual({ ok: true, data: false });
    expect(await createUserStore(present).markEmailVerified(USER_ID, 1)).toEqual({ ok: true, data: true });
  });
});

describe("createUserStore — the WebAuthn handle", () => {
  const HANDLE = new Uint8Array([1, 2, 3, 4]);
  const WON_BY_ANOTHER = new Uint8Array([9, 9]);

  it("resolves a user from the handle alone, which is the whole of a discoverable login", async () => {
    const [client, db] = clientOf(() => [userRow({ webauthn_id: [...HANDLE] })]);
    const found = await createUserStore(client).findByWebAuthnId(HANDLE);
    expect(found.ok && found.data?.id).toBe(USER_ID);
    expect(found.ok && found.data?.webauthnId).toEqual(HANDLE);
    expect(db.calls[0]?.sql).toContain("webauthn_id = ?");
    expect(db.calls[0]?.params).toEqual([HANDLE]);
  });

  it("reports a user with no handle yet as null, not as empty bytes", async () => {
    const [client] = clientOf(() => [userRow()]);
    const found = await createUserStore(client).findById(USER_ID);
    expect(found.ok && found.data?.webauthnId).toBeNull();
  });

  it("mints the handle in one conditional statement, only while the column is null", async () => {
    const [client, db] = writerOf(
      () => 1,
      () => [userRow({ webauthn_id: [...HANDLE] })],
    );
    const set = await createUserStore(client).setWebAuthnIdIfAbsent(USER_ID, HANDLE, 9_000);
    expect(set.ok && set.data?.webauthnId).toEqual(HANDLE);
    expect(db.calls[0]?.sql.replace(/\s+/g, " ")).toContain("SET webauthn_id = ?, updated_at = ? WHERE id = ? AND webauthn_id IS NULL");
  });

  it("returns the handle a concurrent request already set, rather than an error", async () => {
    const [client] = writerOf(
      () => 0,
      () => [userRow({ webauthn_id: [...WON_BY_ANOTHER] })],
    );
    const set = await createUserStore(client).setWebAuthnIdIfAbsent(USER_ID, HANDLE, 9_000);
    expect(set.ok && set.data?.webauthnId).toEqual(WON_BY_ANOTHER);
  });

  it("reports a missing user as ok(null), rather than claiming a handle was minted", async () => {
    const [client] = writerOf(() => 0);
    expect(await createUserStore(client).setWebAuthnIdIfAbsent(USER_ID, HANDLE, 1)).toEqual({ ok: true, data: null });
  });
});

describe("createUserStore — failures", () => {
  it("reports a unique-constraint violation as a conflict naming the index", async () => {
    const [client] = clientOf(() => [], {
      failOn: () => new Error("D1_ERROR: UNIQUE constraint failed: auth_users.email_key: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)"),
    });
    const outcome = await createUserStore(client).create({ email: "a@b.test", emailKey: "a@b.test" }, 1);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.error).toBeInstanceOf(AuthStoreError);
    expect(outcome.ok === false && outcome.error.code).toBe("conflict");
    expect(outcome.ok === false && outcome.error.constraint).toBe("auth_users.email_key");
    expect(outcome.ok === false && outcome.error.operation).toBe("users.create");
  });

  it("reports anything else as unavailable, and never throws across the boundary", async () => {
    const [client] = clientOf(() => [], { failOn: () => new Error("D1_ERROR: network") });
    const outcome = await createUserStore(client).findById(USER_ID);
    expect(outcome.ok === false && outcome.error.code).toBe("unavailable");
    expect(outcome.ok === false && outcome.error.operation).toBe("users.findById");
  });
});
