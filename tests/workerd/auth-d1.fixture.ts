import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSecurityEventStore } from "../../src/auth/stores/events";
import { createUserStore } from "../../src/auth/stores/users";
import type { AuthSecurityEvent } from "../../src/auth/types";
import { createD1Client } from "../../src/storage/db/client";
import { uuidToBytes, uuidv7 } from "../../src/storage/db/uuid";
import { openTestD1, type TestD1 } from "../../src/testing/d1/mod";

/** A private real D1 holding `src/auth/schema.sql`, its temporary root removed on dispose. */
export async function openAuthD1(): Promise<TestD1> {
  const root = mkdtempSync(join(tmpdir(), "forge-auth-d1-"));
  mkdirSync(join(root, "migrations"));
  copyFileSync(new URL("../../src/auth/schema.sql", import.meta.url).pathname, join(root, "migrations", "0001_auth.sql"));
  const db = await openTestD1({ root, migrations: "migrations" }).catch((error: unknown) => {
    rmSync(root, { recursive: true, force: true });
    throw error;
  });
  return {
    ...db,
    async dispose() {
      await db.dispose();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function tokenHash(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(32));
}

/** A fresh account created at `at`, so a test owns every row it counts. */
export async function signedUp(db: TestD1, at: number, account: { verifiedAt?: number; isAdmin?: boolean } = {}): Promise<string> {
  const email = `${uuidv7()}@example.com`;
  const created = await createUserStore(createD1Client(db.binding)).create(
    { email, emailKey: email, emailVerifiedAt: account.verifiedAt ?? null, isAdmin: account.isAdmin ?? false },
    at,
  );
  if (!created.ok) throw created.error;
  return created.data.id;
}

export interface SessionRow {
  tokenHash: Uint8Array<ArrayBuffer>;
  userId: string;
  signedInAt: number;
  expiresAt: number;
  id?: string;
  lastSeenAt?: number;
}

/** A session row written past the store, so its columns are the test's and no `signed-in` event lands beside it. */
export async function insertSession(db: TestD1, row: SessionRow): Promise<void> {
  await db.binding
    .prepare("INSERT INTO auth_sessions (token_hash, user_id, signed_in_at, expires_at, id, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(row.tokenHash, uuidToBytes(row.userId), row.signedInAt, row.expiresAt, uuidToBytes(row.id ?? uuidv7()), row.lastSeenAt ?? row.signedInAt)
    .run();
}

export async function sessionCount(db: TestD1, userId: string): Promise<number> {
  const row = await db.binding
    .prepare("SELECT count(*) AS n FROM auth_sessions WHERE user_id = ?")
    .bind(uuidToBytes(userId))
    .first<{ n: number }>();
  return row?.n ?? -1;
}

/** An account's security events newest first, without the row id a test cannot know in advance. */
export async function securityEvents(db: TestD1, userId: string): Promise<Omit<AuthSecurityEvent, "id">[]> {
  const listed = await createSecurityEventStore(createD1Client(db.binding)).listByUser(userId);
  if (!listed.ok) throw listed.error;
  return listed.data.map(({ userId: owner, type, factorKind, sessionId, adminId, at }) => ({
    userId: owner,
    type,
    factorKind,
    sessionId,
    adminId,
    at,
  }));
}
