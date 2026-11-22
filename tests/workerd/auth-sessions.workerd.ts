// `fakeD1` answers what it is told to answer, so `auth_sessions`' constraints, cascade and joins stay unproved until real D1 runs them.
import { expect, test } from "@playwright/test";

import { createAdminUserStore } from "../../src/auth/stores/admin-users";
import { createCredentialStore } from "../../src/auth/stores/credentials";
import { purgeAuthEphemera } from "../../src/auth/stores/ephemera";
import { authSessionBounds, createAuthSessionStore } from "../../src/auth/stores/sessions";
import { createUserStore } from "../../src/auth/stores/users";
import type { AuthSessionStore } from "../../src/auth/types";
import { createD1Client } from "../../src/storage/db/client";
import { uuidToBytes, uuidv7 } from "../../src/storage/db/uuid";
import type { TestD1 } from "../../src/testing/d1/mod";
import { insertSession, openAuthD1, securityEvents, sessionCount, signedUp, tokenHash } from "./auth-d1.fixture";

const SIGNED_IN_AT = 1_000;
const LIFETIME_MS = 600_000;
const EXPIRES_AT = SIGNED_IN_AT + LIFETIME_MS;

/** An idle bound well inside the absolute lifetime, so a session can go idle while it is still unexpired. */
const IDLE_BOUNDED = { absoluteLifetimeMs: 3_600_000, idleTimeoutMs: 600_000 };

let db: TestD1;
let sessions: AuthSessionStore;
let idleSessions: AuthSessionStore;

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.beforeAll(async () => {
  db = await openAuthD1();
  sessions = createAuthSessionStore(createD1Client(db.binding), { absoluteLifetimeMs: LIFETIME_MS });
  idleSessions = createAuthSessionStore(createD1Client(db.binding), IDLE_BOUNDED);
});

test.afterAll(async () => {
  await db?.dispose();
});

test.beforeEach(() => db.reset());

function account(): Promise<string> {
  return signedUp(db, SIGNED_IN_AT);
}

async function signedIn(userId: string): Promise<Uint8Array<ArrayBuffer>> {
  const hash = tokenHash();
  const created = await sessions.create({ tokenHash: hash, userId, signedInAt: SIGNED_IN_AT, signedInWith: "email-otp" }, null);
  if (!created.ok) throw created.error;
  return hash;
}

async function lastSeenAt(hash: Uint8Array<ArrayBuffer>): Promise<number | undefined> {
  const row = await db.binding.prepare("SELECT last_seen_at FROM auth_sessions WHERE token_hash = ?").bind(hash).first<{ last_seen_at: number }>();
  return row?.last_seen_at;
}

async function liveIds(store: AuthSessionStore, userId: string, at: number): Promise<string[]> {
  const listed = await store.listByUser(userId, at);
  if (!listed.ok) throw listed.error;
  return listed.data.map((session) => session.id);
}

function rawInsert(hash: Uint8Array, userId: string, signedInAt: number, expiresAt: number): Promise<unknown> {
  return db.binding
    .prepare("INSERT INTO auth_sessions (token_hash, user_id, signed_in_at, expires_at, id, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(hash, uuidToBytes(userId), signedInAt, expiresAt, uuidToBytes(uuidv7()), signedInAt)
    .run();
}

test("the CHECK refuses a token_hash that is not 32 bytes", async () => {
  const owner = await account();
  await expect(rawInsert(new Uint8Array(31), owner, SIGNED_IN_AT, EXPIRES_AT)).rejects.toThrow("CHECK constraint failed");
  expect(await sessionCount(db, owner)).toBe(0);
});

test("the CHECK refuses an expires_at not after signed_in_at", async () => {
  const owner = await account();
  await expect(rawInsert(new Uint8Array(32).fill(1), owner, SIGNED_IN_AT, SIGNED_IN_AT)).rejects.toThrow("CHECK constraint failed");
  await expect(rawInsert(new Uint8Array(32).fill(2), owner, SIGNED_IN_AT, SIGNED_IN_AT - 1)).rejects.toThrow("CHECK constraint failed");
  expect(await sessionCount(db, owner)).toBe(0);
});

test("deleting an auth_users row cascades to its sessions", async () => {
  const owner = await account();
  await signedIn(owner);
  await signedIn(owner);
  await db.binding.prepare("DELETE FROM auth_users WHERE id = ?").bind(uuidToBytes(owner)).run();
  expect(await sessionCount(db, owner)).toBe(0);
});

test("resolve finds the session until expires_at and refuses it from expires_at on", async () => {
  const owner = await account();
  const hash = await signedIn(owner);
  const live = await sessions.resolve(hash, EXPIRES_AT - 1);
  const expired = await sessions.resolve(hash, EXPIRES_AT);
  expect([live.ok && live.data?.user.id, live.ok && live.data?.session.expiresAt]).toEqual([owner, EXPIRES_AT]);
  expect(expired).toEqual({ ok: true, data: null });
});

test("resolve refuses the session of a deactivated owner", async () => {
  const owner = await account();
  const hash = await signedIn(owner);
  // A raw write, so the row survives to test the JOIN rather than `setDeactivated`'s own delete.
  await db.binding.prepare("UPDATE auth_users SET deactivated_at = ? WHERE id = ?").bind(SIGNED_IN_AT, uuidToBytes(owner)).run();
  expect(await sessionCount(db, owner)).toBe(1);
  expect(await sessions.resolve(hash, SIGNED_IN_AT)).toEqual({ ok: true, data: null });
});

test("resolve answers null for an unknown token hash", async () => {
  expect(await sessions.resolve(tokenHash(), SIGNED_IN_AT)).toEqual({ ok: true, data: null });
});

test.describe("the idle bound", () => {
  const SEEN = 50_000;
  const cutOff = SEEN + IDLE_BOUNDED.idleTimeoutMs;

  test("resolve and listByUser keep a session seen inside the idle bound and drop it from the bound on, though it is unexpired", async () => {
    const owner = await account();
    const hash = tokenHash();
    await insertSession(db, { tokenHash: hash, userId: owner, id: uuidv7(), signedInAt: SEEN, expiresAt: SEEN + IDLE_BOUNDED.absoluteLifetimeMs });
    expect(await idleSessions.resolve(hash, cutOff)).toEqual({ ok: true, data: null });
    expect(await liveIds(idleSessions, owner, cutOff)).toEqual([]);
    expect((await liveIds(idleSessions, owner, cutOff - 1)).length).toBe(1);
    const live = await idleSessions.resolve(hash, cutOff - 1);
    expect(live.ok && live.data?.user.id).toBe(owner);
  });

  test("resolve leaves last_seen_at alone inside the touch interval and moves it to the resolve instant once the interval has passed", async () => {
    const { touchIntervalMs } = authSessionBounds(IDLE_BOUNDED);
    const owner = await account();
    const hash = tokenHash();
    await insertSession(db, { tokenHash: hash, userId: owner, id: uuidv7(), signedInAt: SEEN, expiresAt: SEEN + IDLE_BOUNDED.absoluteLifetimeMs });
    await idleSessions.resolve(hash, SEEN + touchIntervalMs - 1);
    expect(await lastSeenAt(hash)).toBe(SEEN);
    await idleSessions.resolve(hash, SEEN + touchIntervalMs);
    expect(await lastSeenAt(hash)).toBe(SEEN + touchIntervalMs);
  });
});

test("listByUser answers the owner's live sessions newest sign-in first, a tie broken newest row first, leaving expired, idle and another user's out", async () => {
  const at = 1_000_000;
  const owner = await account();
  const other = await account();
  const live = { expiresAt: at + 1_000, lastSeenAt: at - 1_000 };
  const [earliest, tied, tiedLater, expired, idle, others] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
  await insertSession(db, { tokenHash: tokenHash(), userId: owner, id: earliest, signedInAt: at - 3_000, ...live });
  await insertSession(db, { tokenHash: tokenHash(), userId: owner, id: tied, signedInAt: at - 2_000, ...live });
  await insertSession(db, { tokenHash: tokenHash(), userId: owner, id: tiedLater, signedInAt: at - 2_000, ...live });
  await insertSession(db, { tokenHash: tokenHash(), userId: owner, id: expired, signedInAt: at - 5_000, expiresAt: at, lastSeenAt: at - 1_000 });
  await insertSession(db, {
    tokenHash: tokenHash(),
    userId: owner,
    id: idle,
    signedInAt: at - 4_000,
    expiresAt: at + 1_000,
    lastSeenAt: at - IDLE_BOUNDED.idleTimeoutMs,
  });
  await insertSession(db, { tokenHash: tokenHash(), userId: other, id: others, signedInAt: at - 1_000, ...live });
  expect(await liveIds(idleSessions, owner, at)).toEqual([tiedLater, tied, earliest]);
});

test.describe("rotation", () => {
  test("moves the session onto the new token in its own row, keeping every column, and stamps a step-up only when one is given", async () => {
    const seen = SIGNED_IN_AT + 5_000;
    const stepUpAt = SIGNED_IN_AT + 6_000;
    const owner = await account();
    const first = tokenHash();
    const created = await sessions.create(
      {
        tokenHash: first,
        userId: owner,
        signedInAt: SIGNED_IN_AT,
        signedInWith: "email-otp",
        stepUp: { at: SIGNED_IN_AT, kind: "email-otp" },
        device: "Firefox on macOS",
      },
      null,
    );
    if (!created.ok) throw created.error;
    await db.binding.prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?").bind(seen, first).run();
    const before = await sessions.listByUser(owner, seen);
    if (!before.ok) throw before.error;
    const [original] = before.data;
    expect(original?.device).toBe("Firefox on macOS");

    const second = tokenHash();
    expect(await sessions.rotate(first, second)).toEqual({ ok: true, data: true });
    expect(await sessions.resolve(first, seen)).toEqual({ ok: true, data: null });
    expect(await sessions.listByUser(owner, seen)).toEqual({ ok: true, data: [original] });

    const third = tokenHash();
    expect(await sessions.rotate(second, third, { at: stepUpAt, kind: "passkey" })).toEqual({ ok: true, data: true });
    expect(await sessions.resolve(second, seen)).toEqual({ ok: true, data: null });
    expect(await sessions.listByUser(owner, seen)).toEqual({ ok: true, data: [{ ...original, stepUpAt, stepUpKind: "passkey" }] });
    const rotated = await sessions.resolve(third, seen);
    expect(rotated.ok && rotated.data?.user.id).toBe(owner);
    expect(await sessionCount(db, owner)).toBe(1);
  });

  test("records stepped-up naming the session only for the rotation that carries a step-up", async () => {
    const stepUpAt = SIGNED_IN_AT + 6_000;
    const owner = await account();
    const first = await signedIn(owner);
    const [sessionId] = await liveIds(sessions, owner, SIGNED_IN_AT);
    const second = tokenHash();
    await sessions.rotate(first, second);
    await sessions.rotate(second, tokenHash(), { at: stepUpAt, kind: "totp-app" });
    expect(await securityEvents(db, owner)).toEqual([
      { userId: owner, type: "stepped-up", factorKind: "totp-app", sessionId, adminId: null, at: stepUpAt },
      { userId: owner, type: "signed-in", factorKind: "email-otp", sessionId, adminId: null, at: SIGNED_IN_AT },
    ]);
  });

  test("of a token no session holds answers false and records no event", async () => {
    expect(await sessions.rotate(tokenHash(), tokenHash(), { at: SIGNED_IN_AT, kind: "passkey" })).toEqual({ ok: true, data: false });
    expect(await db.rows("SELECT count(*) AS n FROM auth_security_events")).toEqual([{ n: 0 }]);
  });
});

test("the CHECK refuses a device label longer than 64 characters", async () => {
  const owner = await account();
  const created = await sessions.create(
    { tokenHash: tokenHash(), userId: owner, signedInAt: SIGNED_IN_AT, signedInWith: "email-otp", device: "x".repeat(65) },
    null,
  );
  expect([created.ok, await sessionCount(db, owner)]).toEqual([false, 0]);
});

test("changeEmail deletes every session of that user and leaves another user's", async () => {
  const owner = await account();
  const other = await account();
  await signedIn(owner);
  await signedIn(owner);
  await signedIn(other);
  const email = `${uuidv7()}@example.com`;
  expect(await createUserStore(createD1Client(db.binding)).changeEmail(owner, email, email, SIGNED_IN_AT + 1)).toEqual({ ok: true, data: true });
  expect([await sessionCount(db, owner), await sessionCount(db, other)]).toEqual([0, 1]);
});

test("setDeactivated(true) deletes the user's sessions and leaves another user's", async () => {
  const owner = await account();
  const other = await account();
  await signedIn(owner);
  await signedIn(owner);
  await signedIn(other);
  expect(await createAdminUserStore(createD1Client(db.binding)).setDeactivated(owner, true, SIGNED_IN_AT + 1, uuidv7())).toEqual({
    ok: true,
    data: "changed",
  });
  expect([await sessionCount(db, owner), await sessionCount(db, other)]).toEqual([0, 1]);
});

test.describe("revocation", () => {
  const AT = SIGNED_IN_AT + 10_000;

  /** The owner holding the current session and two others, and another user holding one, each with a known public id. */
  async function scene() {
    const owner = await account();
    const other = await account();
    const keep = tokenHash();
    const ids = { keep: uuidv7(), first: uuidv7(), second: uuidv7(), others: uuidv7() };
    const row = { signedInAt: SIGNED_IN_AT, expiresAt: EXPIRES_AT };
    await insertSession(db, { tokenHash: keep, userId: owner, id: ids.keep, ...row });
    await insertSession(db, { tokenHash: tokenHash(), userId: owner, id: ids.first, ...row });
    await insertSession(db, { tokenHash: tokenHash(), userId: owner, id: ids.second, ...row });
    await insertSession(db, { tokenHash: tokenHash(), userId: other, id: ids.others, ...row });
    return { owner, other, keep, ids };
  }

  const revokedBy = (userId: string, sessionId: string | null) => ({
    userId,
    type: "sessions-revoked",
    factorKind: null,
    sessionId,
    adminId: null,
    at: AT,
  });

  test("revoke deletes the owner's named session and records sessions-revoked naming the acting one", async () => {
    const { owner, keep, ids } = await scene();
    expect(await sessions.revoke(owner, ids.first, AT, { keep })).toEqual({ ok: true, data: true });
    expect((await liveIds(sessions, owner, AT)).sort()).toEqual([ids.keep, ids.second].sort());
    expect(await securityEvents(db, owner)).toEqual([revokedBy(owner, ids.keep)]);
  });

  test("revoke of another user's session deletes nothing and records nothing", async () => {
    const { owner, other, keep, ids } = await scene();
    expect(await sessions.revoke(owner, ids.others, AT, { keep })).toEqual({ ok: true, data: false });
    expect([await sessionCount(db, owner), await sessionCount(db, other)]).toEqual([3, 1]);
    expect([await securityEvents(db, owner), await securityEvents(db, other)]).toEqual([[], []]);
  });

  test("revoke of the acting session itself deletes nothing and records nothing", async () => {
    const { owner, keep, ids } = await scene();
    expect(await sessions.revoke(owner, ids.keep, AT, { keep })).toEqual({ ok: true, data: false });
    expect(await sessionCount(db, owner)).toBe(3);
    expect(await securityEvents(db, owner)).toEqual([]);
  });

  test("revokeOthers spares the kept session and records one sessions-revoked naming it, and a second call that deletes nothing records nothing", async () => {
    const { owner, other, keep, ids } = await scene();
    expect(await sessions.revokeOthers(owner, AT, { keep })).toEqual({ ok: true, data: 2 });
    expect(await liveIds(sessions, owner, AT)).toEqual([ids.keep]);
    expect(await sessionCount(db, other)).toBe(1);
    expect(await sessions.revokeOthers(owner, AT, { keep })).toEqual({ ok: true, data: 0 });
    expect(await securityEvents(db, owner)).toEqual([revokedBy(owner, ids.keep)]);
  });

  test("revokeOthers with no kept session deletes every one the owner holds and records an event naming none", async () => {
    const { owner, other } = await scene();
    expect(await sessions.revokeOthers(owner, AT, { keep: null })).toEqual({ ok: true, data: 3 });
    expect([await sessionCount(db, owner), await sessionCount(db, other)]).toEqual([0, 1]);
    expect(await securityEvents(db, owner)).toEqual([revokedBy(owner, null)]);
  });

  test("revokeOthers deletes the owner's other sessions, spares the kept one and another user's, and answers the count", async () => {
    const owner = await account();
    const other = await account();
    const kept = await signedIn(owner);
    await signedIn(owner);
    await signedIn(owner);
    const bystander = await signedIn(other);
    expect(await sessions.revokeOthers(owner, SIGNED_IN_AT, { keep: kept })).toEqual({ ok: true, data: 2 });
    expect([await sessionCount(db, owner), await sessionCount(db, other)]).toEqual([1, 1]);
    const survivor = await sessions.resolve(kept, SIGNED_IN_AT);
    expect(survivor.ok && survivor.data?.user.id).toBe(owner);
    // Another user's token as `keep` revokes the caller's own sessions and none of that user's.
    expect(await sessions.revokeOthers(owner, SIGNED_IN_AT, { keep: bystander })).toEqual({ ok: true, data: 1 });
    expect([await sessionCount(db, owner), await sessionCount(db, other)]).toEqual([0, 1]);
  });

  test("removeForUser of another user's credential deletes no credential, revokes no session and records no event", async () => {
    const credentials = createCredentialStore(createD1Client(db.binding));
    const holder = await account();
    const credential = await credentials.create(
      { userId: holder, credentialId: `credential-${uuidv7()}`, publicKey: new Uint8Array(65), algorithm: -7, signCount: 0 },
      SIGNED_IN_AT,
      { keep: null },
    );
    if (!credential.ok) throw credential.error;
    const holderEvents = await securityEvents(db, holder);
    const row = { signedInAt: SIGNED_IN_AT, expiresAt: EXPIRES_AT };
    await insertSession(db, { tokenHash: tokenHash(), userId: holder, ...row });
    await insertSession(db, { tokenHash: tokenHash(), userId: holder, ...row });
    const intruder = await account();
    const keep = tokenHash();
    await insertSession(db, { tokenHash: keep, userId: intruder, ...row });
    await insertSession(db, { tokenHash: tokenHash(), userId: intruder, ...row });

    expect(await credentials.removeForUser(credential.data.id, intruder, AT, { keep }, [])).toEqual({ ok: true, data: "not-found" });
    const kept = await credentials.findByCredentialId(credential.data.credentialId);
    expect(kept.ok && kept.data?.userId).toBe(holder);
    expect([await sessionCount(db, holder), await sessionCount(db, intruder)]).toEqual([2, 2]);
    expect([await securityEvents(db, holder), await securityEvents(db, intruder)]).toEqual([holderEvents, []]);
  });
});

test("the unverified-account purge deletes an account unverified past its lifetime with its sessions, and keeps a younger one and a verified one", async () => {
  const createdAt = 1_000;
  const unverifiedUserTtlMs = 7_200_000;
  const purgeAt = createdAt + unverifiedUserTtlMs;
  const stale = await signedUp(db, createdAt);
  const young = await signedUp(db, createdAt + 1);
  const verified = await signedUp(db, createdAt, { verifiedAt: createdAt });
  for (const userId of [stale, young, verified]) {
    await insertSession(db, { tokenHash: tokenHash(), userId, signedInAt: createdAt, expiresAt: purgeAt + 1 });
  }
  expect(await purgeAuthEphemera(createD1Client(db.binding), purgeAt, { unverifiedUserTtlMs })).toMatchObject({
    ok: true,
    data: { complete: true, blocked: [] },
  });
  const users = createUserStore(createD1Client(db.binding));
  const found = await Promise.all([stale, young, verified].map((id) => users.findById(id)));
  expect(found.map((user) => user.ok && user.data?.id)).toEqual([undefined, young, verified]);
  expect([await sessionCount(db, stale), await sessionCount(db, young), await sessionCount(db, verified)]).toEqual([0, 1, 1]);
});
