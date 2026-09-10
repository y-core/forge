import { describe, expect, it } from "bun:test";

import { uuidToBytes, uuidv7 } from "../../crypto/mod";
import { createD1Client } from "../../storage/db/client";
import type { D1Client, D1Database } from "../../storage/db/types";
import { nullLogger } from "../../testing/context";
import { fakeD1 } from "../../testing/fakes";
import type { FakeD1Options } from "../../testing/types";
import { createCredentialStore } from "./credentials";

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

  it("deletes the owner's credential and reports false for another user's, in one statement", async () => {
    const [client, db] = ownedBy(USER_ID);
    const credentials = createCredentialStore(client);
    expect(await credentials.removeForUser(OTHER_ID, USER_ID)).toEqual({ ok: true, data: true });
    expect(await credentials.removeForUser(OTHER_ID, OTHER_ID)).toEqual({ ok: true, data: false });
    expect(db.calls[0]?.sql.replace(/\s+/g, " ")).toBe("DELETE FROM auth_credentials WHERE id = ? AND user_id = ?");
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
