import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createD1Client } from "../storage/db/client";
import { uuidToBytes, uuidv7 } from "../storage/db/uuid";
import { nullLogger } from "../testing/context";
import { openBunD1 } from "../testing/d1/bun";
import type { TestD1 } from "../testing/d1/types";
import { createAccessTokenStore } from "./mod";

const USER_ID = uuidv7();
const HASH = new Uint8Array(32).fill(3);

let root: string;
let d1: TestD1;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "revoked-reason-"));
  mkdirSync(join(root, "migrations"));
  copyFileSync(new URL("./schema.sql", import.meta.url), join(root, "migrations", "0001_auth.sql"));
  d1 = await openBunD1({ root, migrations: "migrations" });
  await d1.binding
    .prepare("INSERT INTO auth_users (id, email, email_key, created_at, updated_at) VALUES (?, 'a@example.com', 'a@example.com', 1, 1)")
    .bind(uuidToBytes(USER_ID))
    .run();
});

afterEach(async () => {
  await d1.dispose();
  rmSync(root, { recursive: true, force: true });
});

async function issuedToken() {
  const tokens = createAccessTokenStore(createD1Client(d1.binding, { logger: nullLogger }));
  const created = await tokens.create({ userId: USER_ID, tokenHash: HASH, label: "CLI", scopes: ["notes:read"], expiresAt: null }, 1_000);
  if (!created.ok) throw new Error("the token could not be created");
  return { tokens, id: created.data.id };
}

describe("an access token's revoked reason", () => {
  it("starts out null on a token never revoked", async () => {
    const { tokens } = await issuedToken();
    const found = await tokens.findByHash(HASH);

    expect(found.ok && found.data?.revokedReason).toBeNull();
  });

  it("is written by the revoke and read back with the token", async () => {
    const { tokens, id } = await issuedToken();

    expect(await tokens.revoke(id, USER_ID, 2_000, "leaked in a CI log")).toEqual({ ok: true, data: true });
    const listed = await tokens.listByUser(USER_ID);
    expect(listed.ok && listed.data.map((token) => [token.revokedAt, token.revokedReason])).toEqual([[2_000, "leaked in a CI log"]]);
  });

  it("stays null when the revoke gives none", async () => {
    const { tokens, id } = await issuedToken();
    await tokens.revoke(id, USER_ID, 2_000, null);
    const listed = await tokens.listByUser(USER_ID);

    expect(listed.ok && listed.data.map((token) => [token.revokedAt, token.revokedReason])).toEqual([[2_000, null]]);
  });

  it("is refused by the table past 200 characters, leaving the token unrevoked", async () => {
    const { tokens, id } = await issuedToken();

    expect((await tokens.revoke(id, USER_ID, 2_000, "x".repeat(201))).ok).toBe(false);
    const listed = await tokens.listByUser(USER_ID);
    expect(listed.ok && listed.data.map((token) => token.revokedAt)).toEqual([null]);
  });
});
