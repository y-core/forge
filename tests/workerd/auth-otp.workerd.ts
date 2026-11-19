import { expect, test } from "@playwright/test";

import { createOtpStateStore } from "../../src/auth/stores/otp-state";
import { createUserStore } from "../../src/auth/stores/users";
import type { OtpStateStore, UserStore } from "../../src/auth/types";
import { createD1Client } from "../../src/storage/db/client";
import { uuidToBytes } from "../../src/storage/db/uuid";
import type { TestD1 } from "../../src/testing/d1";
import { openAuthD1, signedUp, tokenHash } from "./auth-d1.fixture";

const MAX_ATTEMPTS = 3;
const WINDOW_MS = 900_000;
const COOLDOWN_MS = 60_000;
const OPENED_AT = 1_700_000_000_000;
const CODE = { token: "sealed-code-1", attempts: 0, issuedAt: OPENED_AT, expiresAt: OPENED_AT + 10 * WINDOW_MS };

let db: TestD1;
let otp: OtpStateStore;
let users: UserStore;

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.beforeAll(async () => {
  db = await openAuthD1();
  otp = createOtpStateStore(createD1Client(db.binding));
  users = createUserStore(createD1Client(db.binding));
});

test.afterAll(async () => {
  await db?.dispose();
});

test.beforeEach(() => db.reset());

async function issued(binding: Uint8Array<ArrayBuffer>): Promise<string> {
  const userId = await signedUp(db, OPENED_AT);
  expect(await otp.issue(userId, CODE, COOLDOWN_MS, binding)).toEqual({ ok: true, data: true });
  return userId;
}

async function window(userId: string): Promise<{ attempts: number; window_started_at: number | null; token: string } | null> {
  return db.binding.prepare("SELECT attempts, window_started_at, token FROM auth_otp_state WHERE user_id = ?").bind(uuidToBytes(userId)).first();
}

async function spend(userId: string, binding: Uint8Array<ArrayBuffer>, count: number): Promise<void> {
  for (let guess = 0; guess < count; guess += 1) {
    const spent = await otp.countAttempt(userId, MAX_ATTEMPTS, OPENED_AT + guess, WINDOW_MS, binding);
    if (!spent.ok || spent.data === null) throw new Error(`guess ${guess} was refused while setting up`);
  }
}

test.describe("countAttempt", () => {
  test("the first guess opens the window at its own instant, and each later one counts against it", async () => {
    const binding = tokenHash();
    const userId = await issued(binding);
    expect(await otp.countAttempt(userId, MAX_ATTEMPTS, OPENED_AT, WINDOW_MS, binding)).toEqual({ ok: true, data: { ...CODE, attempts: 1 } });
    expect(await window(userId)).toEqual({ attempts: 1, window_started_at: OPENED_AT, token: CODE.token });
    expect(await otp.countAttempt(userId, MAX_ATTEMPTS, OPENED_AT + 1, WINDOW_MS, binding)).toEqual({ ok: true, data: { ...CODE, attempts: 2 } });
    expect(await window(userId)).toEqual({ attempts: 2, window_started_at: OPENED_AT, token: CODE.token });
  });

  test("a guess past the budget inside the window is refused and spends nothing", async () => {
    const binding = tokenHash();
    const userId = await issued(binding);
    await spend(userId, binding, MAX_ATTEMPTS);
    expect(await otp.countAttempt(userId, MAX_ATTEMPTS, OPENED_AT + WINDOW_MS - 1, WINDOW_MS, binding)).toEqual({ ok: true, data: null });
    expect(await window(userId)).toEqual({ attempts: MAX_ATTEMPTS, window_started_at: OPENED_AT, token: CODE.token });
  });

  test("a spent window reopens exactly at its boundary, with one guess counted against the new window", async () => {
    const binding = tokenHash();
    const userId = await issued(binding);
    await spend(userId, binding, MAX_ATTEMPTS);
    const boundary = OPENED_AT + WINDOW_MS;
    expect(await otp.countAttempt(userId, MAX_ATTEMPTS, boundary, WINDOW_MS, binding)).toEqual({ ok: true, data: { ...CODE, attempts: 1 } });
    expect(await window(userId)).toEqual({ attempts: 1, window_started_at: boundary, token: CODE.token });
  });

  test("a window that lapses under budget starts the count again rather than carrying it", async () => {
    const binding = tokenHash();
    const userId = await issued(binding);
    await spend(userId, binding, 1);
    const boundary = OPENED_AT + WINDOW_MS;
    expect(await otp.countAttempt(userId, MAX_ATTEMPTS, boundary, WINDOW_MS, binding)).toEqual({ ok: true, data: { ...CODE, attempts: 1 } });
    expect(await window(userId)).toEqual({ attempts: 1, window_started_at: boundary, token: CODE.token });
  });

  test("a reissue past the cooldown replaces the code and keeps the spent window, so the new code is refused too", async () => {
    const binding = tokenHash();
    const userId = await issued(binding);
    await spend(userId, binding, MAX_ATTEMPTS);
    const reissuedAt = OPENED_AT + COOLDOWN_MS;
    const reissue = { ...CODE, token: "sealed-code-2", issuedAt: reissuedAt };
    expect(await otp.issue(userId, reissue, COOLDOWN_MS, binding)).toEqual({ ok: true, data: true });
    expect(await otp.countAttempt(userId, MAX_ATTEMPTS, reissuedAt + 1, WINDOW_MS, binding)).toEqual({ ok: true, data: null });
    expect(await window(userId)).toEqual({ attempts: MAX_ATTEMPTS, window_started_at: OPENED_AT, token: reissue.token });
  });

  test("a discard kills the code and gives the cooldown back, but keeps the spent window for the next code", async () => {
    const binding = tokenHash();
    const userId = await issued(binding);
    await spend(userId, binding, MAX_ATTEMPTS);
    expect(await otp.discard(userId, CODE.token)).toEqual({ ok: true, data: undefined });
    expect(await otp.read(userId, OPENED_AT + 1, binding)).toEqual({ ok: true, data: null });
    const reissue = { ...CODE, token: "sealed-code-2", issuedAt: OPENED_AT + 1 };
    expect(await otp.issue(userId, reissue, COOLDOWN_MS, binding)).toEqual({ ok: true, data: true });
    expect(await otp.countAttempt(userId, MAX_ATTEMPTS, OPENED_AT + 2, WINDOW_MS, binding)).toEqual({ ok: true, data: null });
    expect(await window(userId)).toEqual({ attempts: MAX_ATTEMPTS, window_started_at: OPENED_AT, token: reissue.token });
  });

  test("a guess under another binding matches no row and spends nothing", async () => {
    const binding = tokenHash();
    const userId = await issued(binding);
    await spend(userId, binding, 1);
    expect(await otp.countAttempt(userId, MAX_ATTEMPTS, OPENED_AT + 1, WINDOW_MS, tokenHash())).toEqual({ ok: true, data: null });
    expect(await otp.read(userId, OPENED_AT + 1, tokenHash())).toEqual({ ok: true, data: null });
    expect(await window(userId)).toEqual({ attempts: 1, window_started_at: OPENED_AT, token: CODE.token });
  });

  test("a row holding no binding is matched by no guess", async () => {
    const userId = await signedUp(db, OPENED_AT);
    await db.binding
      .prepare("INSERT INTO auth_otp_state (user_id, token, issued_at, expires_at) VALUES (?, ?, ?, ?)")
      .bind(uuidToBytes(userId), CODE.token, CODE.issuedAt, CODE.expiresAt)
      .run();
    expect(await otp.countAttempt(userId, MAX_ATTEMPTS, OPENED_AT, WINDOW_MS, tokenHash())).toEqual({ ok: true, data: null });
    expect(await window(userId)).toEqual({ attempts: 0, window_started_at: null, token: CODE.token });
  });
});

test("the CHECK refuses a binding that is not 32 bytes, as the caller's fault", async () => {
  const userId = await signedUp(db, OPENED_AT);
  for (const length of [31, 33]) {
    const refused = await otp.issue(userId, CODE, COOLDOWN_MS, new Uint8Array(length));
    expect([refused.ok, !refused.ok && refused.error.code]).toEqual([false, "invalid"]);
  }
  expect(await window(userId)).toBeNull();
});

test("claimEmailChange accepts the first claim, refuses one inside the cooldown, and accepts one at its edge", async () => {
  const cooldownMs = 300_000;
  const userId = await signedUp(db, OPENED_AT);
  const claimed = async () =>
    (
      await db.binding
        .prepare("SELECT email_change_requested_at AS at FROM auth_users WHERE id = ?")
        .bind(uuidToBytes(userId))
        .first<{ at: number | null }>()
    )?.at;
  expect(await users.claimEmailChange(userId, OPENED_AT, cooldownMs)).toEqual({ ok: true, data: true });
  expect(await users.claimEmailChange(userId, OPENED_AT + cooldownMs - 1, cooldownMs)).toEqual({ ok: true, data: false });
  expect(await claimed()).toBe(OPENED_AT);
  expect(await users.claimEmailChange(userId, OPENED_AT + cooldownMs, cooldownMs)).toEqual({ ok: true, data: true });
  expect(await claimed()).toBe(OPENED_AT + cooldownMs);
});
