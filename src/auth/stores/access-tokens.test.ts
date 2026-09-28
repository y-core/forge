import { describe, expect, it } from "bun:test";

import { uuidToBytes, uuidv7 } from "../../crypto/mod";
import { createD1Client } from "../../storage/db/client";
import type { D1Client, D1Database } from "../../storage/db/types";
import { nullLogger } from "../../testing/context";
import { fakeD1 } from "../../testing/fakes";
import type { FakeD1Options } from "../../testing/types";
import { AuthStoreError } from "../errors";
import { createAccessTokenStore } from "./access-tokens";

const USER_ID = uuidv7();
const TOKEN_ID = uuidv7();
const HASH = new Uint8Array(32).fill(7);

type FakeDb = ReturnType<typeof fakeD1>;

function clientOf(rows: (sql: string, params: unknown[]) => unknown[] = () => [], options?: FakeD1Options): [D1Client, FakeDb] {
  const db = fakeD1(rows, options);
  return [createD1Client(db as unknown as D1Database, { logger: nullLogger }), db];
}

function writerOf(rowsWritten: (sql: string, params: unknown[]) => number): [D1Client, FakeDb] {
  return clientOf(undefined, { rowsWritten });
}

function failingWith(message: string): D1Client {
  return clientOf(undefined, { failOn: () => new Error(message) })[0];
}

function normalized(sql: string | undefined): string {
  return (sql ?? "").replace(/\s+/g, " ").trim();
}

function tokenRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: uuidToBytes(TOKEN_ID),
    user_id: uuidToBytes(USER_ID),
    label: "CLI",
    scopes: '["notes:read","notes:write"]',
    expires_at: 9_000,
    last_used_at: 8_500,
    revoked_at: null,
    created_at: 1_000,
    ...overrides,
  };
}

const INPUT = { userId: USER_ID, tokenHash: HASH, label: "CLI", scopes: ["notes:read"], expiresAt: 9_000 };

describe("createAccessTokenStore — create", () => {
  it("binds the hash bytes, the JSON scopes, the label, the expiry and the clock, and returns a token never used or revoked", async () => {
    const [client, db] = writerOf(() => 1);
    const created = await createAccessTokenStore(client).create(INPUT, 7_000);
    const params = db.calls[0]?.params ?? [];
    expect(params.slice(1)).toEqual([uuidToBytes(USER_ID), HASH, "CLI", '["notes:read"]', 9_000, null, null, 7_000]);
    expect(created.ok && { ...created.data, id: typeof created.data.id }).toEqual({
      id: "string",
      userId: USER_ID,
      label: "CLI",
      scopes: ["notes:read"],
      expiresAt: 9_000,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: 7_000,
    });
  });

  it("reports a malformed owner as unavailable and binds nothing", async () => {
    const [client, db] = writerOf(() => 1);
    const created = await createAccessTokenStore(client).create({ ...INPUT, userId: "u9" }, 7_000);
    expect(!created.ok && created.error.code).toBe("unavailable");
    expect(db.calls).toEqual([]);
  });

  it("names the hash index on a unique-constraint failure, and calls a CHECK failure the caller's", async () => {
    const conflict = await createAccessTokenStore(
      failingWith("D1_ERROR: UNIQUE constraint failed: auth_access_tokens.token_hash: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)"),
    ).create(INPUT, 7_000);
    expect(!conflict.ok && [conflict.error.code, conflict.error.constraint]).toEqual(["conflict", "auth_access_tokens.token_hash"]);

    const invalid = await createAccessTokenStore(
      failingWith("D1_ERROR: CHECK constraint failed: auth_access_tokens: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_CHECK)"),
    ).create({ ...INPUT, label: "" }, 7_000);
    expect(!invalid.ok && invalid.error.code).toBe("invalid");
  });
});

describe("createAccessTokenStore — findByHash", () => {
  it("looks up by hash only while the owner is active, and never selects the hash back", async () => {
    const [client, db] = clientOf(() => []);
    expect(await createAccessTokenStore(client).findByHash(HASH)).toEqual({ ok: true, data: null });
    expect(normalized(db.calls[0]?.sql)).toContain("deactivated_at IS NULL");
    expect(normalized(db.calls[0]?.sql).split(" FROM ")[0]).not.toContain("token_hash");
    expect(db.calls[0]?.params).toEqual([HASH]);
  });

  it("decodes a stored row", async () => {
    const [client] = clientOf(() => [tokenRow()]);
    expect(await createAccessTokenStore(client).findByHash(HASH)).toEqual({
      ok: true,
      data: {
        id: TOKEN_ID,
        userId: USER_ID,
        label: "CLI",
        scopes: ["notes:read", "notes:write"],
        expiresAt: 9_000,
        lastUsedAt: 8_500,
        revokedAt: null,
        createdAt: 1_000,
      },
    });
  });

  it("reports scopes that are not a JSON array of strings as unavailable, rather than throwing", async () => {
    for (const scopes of ['"notes:read"', "[1]", "not json"]) {
      const [client] = clientOf(() => [tokenRow({ scopes })]);
      const found = await createAccessTokenStore(client).findByHash(HASH);
      expect(!found.ok && found.error).toBeInstanceOf(AuthStoreError);
      expect(!found.ok && found.error.code).toBe("unavailable");
    }
  });
});

describe("createAccessTokenStore — recordUse", () => {
  it("decides the throttle in the statement, binding the edge of the interval", async () => {
    const [client, db] = writerOf(() => 1);
    expect(await createAccessTokenStore(client).recordUse(TOKEN_ID, 100_000, 60_000)).toEqual({ ok: true, data: true });
    expect(normalized(db.calls[0]?.sql)).toBe(
      "UPDATE auth_access_tokens SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at <= ?)",
    );
    expect(db.calls[0]?.params).toEqual([100_000, uuidToBytes(TOKEN_ID), 40_000]);
  });

  it("reports a throttled stamp as false", async () => {
    const [client] = writerOf(() => 0);
    expect(await createAccessTokenStore(client).recordUse(TOKEN_ID, 100_000, 60_000)).toEqual({ ok: true, data: false });
  });

  it("answers false for a malformed id and binds nothing", async () => {
    const [client, db] = writerOf(() => 1);
    expect(await createAccessTokenStore(client).recordUse("u9", 100_000, 60_000)).toEqual({ ok: true, data: false });
    expect(db.calls).toEqual([]);
  });
});

describe("createAccessTokenStore — revoke", () => {
  it("revokes only the owner's token, and only once", async () => {
    const [client, db] = writerOf(() => 1);
    expect(await createAccessTokenStore(client).revoke(TOKEN_ID, USER_ID, 5_000)).toEqual({ ok: true, data: true });
    expect(normalized(db.calls[0]?.sql)).toBe("UPDATE auth_access_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL");
    expect(db.calls[0]?.params).toEqual([5_000, uuidToBytes(TOKEN_ID), uuidToBytes(USER_ID)]);
  });

  it("answers false for a malformed id or owner and binds nothing", async () => {
    const [client, db] = writerOf(() => 1);
    const tokens = createAccessTokenStore(client);
    expect(await tokens.revoke("u9", USER_ID, 5_000)).toEqual({ ok: true, data: false });
    expect(await tokens.revoke(TOKEN_ID, "u9", 5_000)).toEqual({ ok: true, data: false });
    expect(db.calls).toEqual([]);
  });
});

describe("createAccessTokenStore — listByUser", () => {
  it("lists the owner's tokens in key order", async () => {
    const [client, db] = clientOf(() => [tokenRow()]);
    const listed = await createAccessTokenStore(client).listByUser(USER_ID);
    expect(listed.ok && listed.data.map((token) => token.id)).toEqual([TOKEN_ID]);
    expect(normalized(db.calls[0]?.sql)).toEndWith("WHERE user_id = ? ORDER BY id");
  });

  it("answers an empty list for a malformed owner and binds nothing", async () => {
    const [client, db] = clientOf(() => [tokenRow()]);
    expect(await createAccessTokenStore(client).listByUser("u9")).toEqual({ ok: true, data: [] });
    expect(db.calls).toEqual([]);
  });
});
