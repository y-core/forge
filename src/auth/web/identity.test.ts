import { describe, expect, it } from "bun:test";

import { createSession } from "@remix-run/session";

import { bytesToHex } from "../../crypto/primitives/bytes";
import { sha256 } from "../../crypto/primitives/digest";
import { err, ok } from "../../result/result";
import { AUTH_SESSION_MAX_MS } from "../config";
import { AuthStoreError } from "../errors";
import type { AuthSessionStoreOptions } from "../stores/types";
import type { AuthSessionStore, AuthUser } from "../types";
import {
  APPROVAL_CODE_SESSION_KEY,
  APPROVAL_SESSION_KEY,
  AUTH_OTP_BINDING_SESSION_KEY,
  AUTH_PENDING_SIGNIN_SESSION_KEY,
  AUTH_SESSION_TOKEN_KEY,
  AUTH_SITE_DATA_OWED_SESSION_KEY,
  authFactorCaller,
  authOtpBinding,
  clearAuthSession,
  establishAuthSession,
  markApproval,
  markAuthStepUp,
  resolveApprovalMark,
  resolveAuthIdentity,
  revokeOtherAuthSessions,
} from "./identity";
import { fakeAuthSessionStore, fakeAuthUser } from "./web.fixture";

const NOW = 1_700_000_000_000;
const ADA = fakeAuthUser({ id: "u1", email: "ada@example.com", isAdmin: true });

type Method = keyof AuthSessionStore;

/** A `fakeAuthSessionStore` over `users` recording every method it was asked to run, with any method replaceable. */
function recordingStore(users: readonly AuthUser[] = [ADA], overrides: Partial<AuthSessionStore> = {}, options?: AuthSessionStoreOptions) {
  const inner = fakeAuthSessionStore(users, new Map(), options);
  const calls: Method[] = [];
  const wrap = <M extends Method>(method: M): AuthSessionStore[M] =>
    ((...args: Parameters<AuthSessionStore[M]>) => {
      calls.push(method);
      const run = (overrides[method] ?? inner[method]) as (...a: Parameters<AuthSessionStore[M]>) => ReturnType<AuthSessionStore[M]>;
      return run(...args);
    }) as AuthSessionStore[M];
  const store: AuthSessionStore = {
    create: wrap("create"),
    resolve: wrap("resolve"),
    rotate: wrap("rotate"),
    remove: wrap("remove"),
    listByUser: wrap("listByUser"),
    revoke: wrap("revoke"),
    revokeOthers: wrap("revokeOthers"),
  };
  return { store, rows: inner.rows, calls };
}

const failure = (method: Method) => async () => err(new AuthStoreError("unavailable", `sessions.${method}`));

async function keyOf(token: unknown): Promise<string> {
  return bytesToHex(await sha256(String(token)));
}

/** A row created for `userId` through the real `establishAuthSession`, answering the token its session carried. */
async function signedInToken(store: AuthSessionStore, userId = "u1", at = NOW): Promise<string> {
  const scratch = createSession("scratch");
  const created = await establishAuthSession(scratch, store, userId, at, at, { kind: "email-otp" });
  if (!created.ok) throw created.error;
  return String(scratch.get(AUTH_SESSION_TOKEN_KEY));
}

/** A session holding `data` as loaded, so `dirty` starts false and reports only what the call under test did. */
function loaded(data: Record<string, unknown>) {
  return createSession<Record<string, unknown>>("sid-1", [data, {}]);
}

describe("establishAuthSession", () => {
  it("creates exactly one row, signed in at the earlier of `at` and `now` and expiring the absolute lifetime after it", async () => {
    const { store, rows } = recordingStore();
    const session = createSession("sid-1");
    expect(await establishAuthSession(session, store, "u1", NOW + 5_000, NOW, { kind: "email-otp" })).toEqual({ ok: true, data: undefined });
    expect([...rows.values()].map(({ id: _id, ...row }) => row)).toEqual([
      { userId: "u1", signedInAt: NOW, expiresAt: NOW + AUTH_SESSION_MAX_MS, lastSeenAt: NOW, stepUpAt: null, stepUpKind: null, device: null },
    ]);
  });

  it("labels the row with the device it was given", async () => {
    const { store, rows } = recordingStore();
    await establishAuthSession(createSession("sid-1"), store, "u1", NOW, NOW, { kind: "email-otp", device: "Firefox on macOS" });
    expect([...rows.values()].map((row) => row.device)).toEqual(["Firefox on macOS"]);
  });

  it("clamps against the caller's own clock, so an injected clock ahead of wall time stores what it was given", async () => {
    const { store, rows } = recordingStore();
    const injected = Date.now() + 3_600_000;
    await establishAuthSession(createSession("sid-1"), store, "u1", injected, injected, { kind: "email-otp" });
    expect([...rows.values()].map((row) => row.signedInAt)).toEqual([injected]);
  });

  it("records a sign-in that counts as the step-up under the kind it signed in with, at the sign-in instant", async () => {
    const { store, rows } = recordingStore();
    await establishAuthSession(createSession("sid-1"), store, "u1", NOW, NOW, { kind: "passkey", steppedUp: true });
    expect([...rows.values()].map((row) => [row.stepUpAt, row.stepUpKind])).toEqual([[NOW, "passkey"]]);
  });

  it("keeps the token on the session and only its SHA-256 as the row key", async () => {
    const { store, rows } = recordingStore();
    const session = createSession("sid-1");
    await establishAuthSession(session, store, "u1", NOW, NOW, { kind: "email-otp" });
    const token = session.get(AUTH_SESSION_TOKEN_KEY);
    expect({ keys: [...rows.keys()], tokenIsKey: rows.has(String(token)), length: String(token).length }).toEqual({
      keys: [await keyOf(token)],
      tokenIsKey: false,
      length: 43,
    });
  });

  it("starts the new row with no step-up even when the session's previous row was stepped up, so a sign-in inherits no demand it never met", async () => {
    const { store, rows } = recordingStore();
    const session = createSession("sid-1");
    await establishAuthSession(session, store, "u1", NOW, NOW, { kind: "email-otp" });
    await markAuthStepUp(session, store, NOW, NOW, "email-otp");
    await establishAuthSession(session, store, "u1", NOW + 1, NOW + 1, { kind: "email-otp" });
    expect([...rows.values()].map((row) => row.stepUpAt)).toEqual([null]);
  });

  it("deletes the row the session held before, so a second sign-in leaves one live session and not two", async () => {
    const { store, rows } = recordingStore();
    const session = createSession("sid-1");
    await establishAuthSession(session, store, "u1", NOW, NOW, { kind: "email-otp" });
    const first = await keyOf(session.get(AUTH_SESSION_TOKEN_KEY));
    await establishAuthSession(session, store, "u1", NOW + 1, NOW + 1, { kind: "email-otp" });
    const second = await keyOf(session.get(AUTH_SESSION_TOKEN_KEY));
    expect({ keys: [...rows.keys()], replaced: first !== second }).toEqual({ keys: [second], replaced: true });
  });

  it("clears a pending sign-in, a storage clear a sign-out left owing, and an administrator approval given before it", async () => {
    const { store } = recordingStore();
    const session = createSession("sid-1");
    session.set(AUTH_PENDING_SIGNIN_SESSION_KEY, "ada@example.com");
    session.set(AUTH_SITE_DATA_OWED_SESSION_KEY, true);
    markApproval(session, { presentedAt: NOW, digest: "k.mac" });
    await establishAuthSession(session, store, "u1", NOW, NOW, { kind: "email-otp" });
    expect([
      session.get(AUTH_PENDING_SIGNIN_SESSION_KEY),
      session.get(AUTH_SITE_DATA_OWED_SESSION_KEY),
      session.get(APPROVAL_SESSION_KEY),
      session.get(APPROVAL_CODE_SESSION_KEY),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("rotates the session id and deletes the old one, so a fixated id cannot survive the sign-in", async () => {
    const { store } = recordingStore();
    const session = createSession("sid-1");
    await establishAuthSession(session, store, "u1", NOW, NOW, { kind: "email-otp" });
    expect({ rotated: session.id !== "sid-1", deleteId: session.deleteId }).toEqual({ rotated: true, deleteId: "sid-1" });
  });

  it("answers the store's failure and leaves the session exactly as it was — no token, no new id, nothing cleared", async () => {
    const { store, rows } = recordingStore([ADA], { create: failure("create") });
    const session = loaded({ [AUTH_PENDING_SIGNIN_SESSION_KEY]: "ada@example.com", [AUTH_SITE_DATA_OWED_SESSION_KEY]: true });
    const result = await establishAuthSession(session, store, "u1", NOW, NOW, { kind: "email-otp" });
    expect({
      ok: result.ok,
      code: result.ok ? null : result.error.code,
      rows: rows.size,
      token: session.get(AUTH_SESSION_TOKEN_KEY),
      pending: session.get(AUTH_PENDING_SIGNIN_SESSION_KEY),
      owed: session.get(AUTH_SITE_DATA_OWED_SESSION_KEY),
      id: session.id,
      deleteId: session.deleteId,
      dirty: session.dirty,
    }).toEqual({
      ok: false,
      code: "unavailable",
      rows: 0,
      token: undefined,
      pending: "ada@example.com",
      owed: true,
      id: "sid-1",
      deleteId: undefined,
      dirty: false,
    });
  });
});

describe("markAuthStepUp", () => {
  it("moves the row onto a new token carrying the step-up, so the token held before it resolves nothing, and rotates the id", async () => {
    const { store, rows } = recordingStore();
    const token = await signedInToken(store);
    const session = loaded({ [AUTH_SESSION_TOKEN_KEY]: token });
    expect(await markAuthStepUp(session, store, NOW + 42, NOW + 100, "email-otp")).toEqual({ ok: true, data: true });
    const next = session.get(AUTH_SESSION_TOKEN_KEY);
    expect({
      rotated: next !== token,
      rows: [...rows.keys()],
      stepUpAt: rows.get(await keyOf(next))?.stepUpAt,
      previous: await store.resolve(await sha256(token), NOW),
      id: session.id !== "sid-1",
    }).toEqual({ rotated: true, rows: [await keyOf(next)], stepUpAt: NOW + 42, previous: { ok: true, data: null }, id: true });
  });

  it("clamps a mark dated after the caller's `now` to `now`, so a skewed clock cannot make one last forever", async () => {
    const { store, rows } = recordingStore();
    const session = loaded({ [AUTH_SESSION_TOKEN_KEY]: await signedInToken(store) });
    await markAuthStepUp(session, store, NOW + 3_600_000, NOW + 10, "email-otp");
    expect(rows.get(await keyOf(session.get(AUTH_SESSION_TOKEN_KEY)))?.stepUpAt).toBe(NOW + 10);
  });

  it("clamps against the caller's own clock, so an injected clock ahead of wall time stores what it was given", async () => {
    const { store, rows } = recordingStore();
    const session = loaded({ [AUTH_SESSION_TOKEN_KEY]: await signedInToken(store) });
    const injected = Date.now() + 3_600_000;
    await markAuthStepUp(session, store, injected, injected, "email-otp");
    expect(rows.get(await keyOf(session.get(AUTH_SESSION_TOKEN_KEY)))?.stepUpAt).toBe(injected);
  });

  it("answers `false` for a session holding no token, without asking the store", async () => {
    const { store, calls } = recordingStore();
    expect(await markAuthStepUp(createSession("sid-1"), store, NOW, NOW, "email-otp")).toEqual({ ok: true, data: false });
    expect(calls).toEqual([]);
  });

  it("answers the store's failure, leaving the session on the token it held", async () => {
    const { store } = recordingStore([ADA], { rotate: failure("rotate") });
    const token = await signedInToken(store);
    const session = loaded({ [AUTH_SESSION_TOKEN_KEY]: token });
    const result = await markAuthStepUp(session, store, NOW, NOW, "email-otp");
    expect({ code: result.ok ? null : result.error.code, token: session.get(AUTH_SESSION_TOKEN_KEY), dirty: session.dirty }).toEqual({
      code: "unavailable",
      token,
      dirty: false,
    });
  });
});

describe("the absolute lifetime", () => {
  it("is never moved by use or by a step-up: the row keeps the instants it was created with", async () => {
    const { store, rows } = recordingStore();
    const token = await signedInToken(store);
    const before = rows.get(await keyOf(token));
    const session = loaded({ [AUTH_SESSION_TOKEN_KEY]: token });
    await resolveAuthIdentity(session, store, NOW + 1_000);
    await markAuthStepUp(session, store, NOW + 2_000, NOW + 2_000, "email-otp");
    await resolveAuthIdentity(session, store, NOW + 3_000);
    const after = rows.get(await keyOf(session.get(AUTH_SESSION_TOKEN_KEY)));
    expect({ signedInAt: after?.signedInAt, expiresAt: after?.expiresAt }).toEqual({
      signedInAt: before?.signedInAt,
      expiresAt: NOW + AUTH_SESSION_MAX_MS,
    });
  });
});

describe("clearAuthSession", () => {
  it("deletes the session's row, drops its token, pending sign-in, code binding and approval, and rotates the id", async () => {
    const { store, rows } = recordingStore();
    const token = await signedInToken(store);
    const session = loaded({
      [AUTH_SESSION_TOKEN_KEY]: token,
      [AUTH_PENDING_SIGNIN_SESSION_KEY]: "ada@example.com",
      [AUTH_OTP_BINDING_SESSION_KEY]: authOtpBinding(createSession("scratch")),
      [APPROVAL_SESSION_KEY]: NOW,
      [APPROVAL_CODE_SESSION_KEY]: "k.mac",
    });
    expect(await clearAuthSession(session, store)).toEqual({ ok: true, data: undefined });
    expect({
      rows: rows.size,
      token: session.get(AUTH_SESSION_TOKEN_KEY),
      pending: session.get(AUTH_PENDING_SIGNIN_SESSION_KEY),
      binding: session.get(AUTH_OTP_BINDING_SESSION_KEY),
      approval: resolveApprovalMark(session),
      code: session.get(APPROVAL_CODE_SESSION_KEY),
      deleteId: session.deleteId,
    }).toEqual({ rows: 0, token: undefined, pending: undefined, binding: undefined, approval: null, code: undefined, deleteId: "sid-1" });
  });

  it("keeps the storage clear a sign-out owes, which the sign-out sets after it", async () => {
    const { store } = recordingStore();
    const session = loaded({ [AUTH_SESSION_TOKEN_KEY]: await signedInToken(store), [AUTH_SITE_DATA_OWED_SESSION_KEY]: true });
    await clearAuthSession(session, store);
    expect(session.get(AUTH_SITE_DATA_OWED_SESSION_KEY)).toBe(true);
  });

  it("leaves only the row it names: another session of the same user stays signed in", async () => {
    const { store, rows } = recordingStore();
    const kept = await signedInToken(store);
    await clearAuthSession(loaded({ [AUTH_SESSION_TOKEN_KEY]: await signedInToken(store) }), store);
    expect([...rows.keys()]).toEqual([await keyOf(kept)]);
  });

  it("asks the store nothing for a session holding no token, and still rotates it", async () => {
    const { store, calls } = recordingStore();
    const session = createSession("sid-1");
    expect(await clearAuthSession(session, store)).toEqual({ ok: true, data: undefined });
    expect({ calls, deleteId: session.deleteId }).toEqual({ calls: [], deleteId: "sid-1" });
  });

  it("answers the store's failure and leaves the session untouched, so the visitor can retry and no copied cookie outlives a false sign-out", async () => {
    const { store, rows } = recordingStore([ADA], { remove: failure("remove") });
    const token = await signedInToken(store);
    const session = loaded({ [AUTH_SESSION_TOKEN_KEY]: token, [APPROVAL_SESSION_KEY]: NOW, [APPROVAL_CODE_SESSION_KEY]: "k.mac" });
    const result = await clearAuthSession(session, store);
    expect({
      code: result.ok ? null : result.error.code,
      rows: rows.size,
      token: session.get(AUTH_SESSION_TOKEN_KEY),
      approval: resolveApprovalMark(session),
      id: session.id,
      deleteId: session.deleteId,
      dirty: session.dirty,
    }).toEqual({
      code: "unavailable",
      rows: 1,
      token,
      approval: { presentedAt: NOW, digest: "k.mac" },
      id: "sid-1",
      deleteId: undefined,
      dirty: false,
    });
  });
});

describe("authOtpBinding and authFactorCaller", () => {
  it("mints a binding on first use, stores it, and answers the same one after", () => {
    const session = loaded({});
    const minted = authOtpBinding(session);
    expect({ minted: minted.length, stored: session.get(AUTH_OTP_BINDING_SESSION_KEY), again: authOtpBinding(session) }).toEqual({
      minted: 43,
      stored: minted,
      again: minted,
    });
  });

  it("gives two browsers two bindings", () => {
    expect(authOtpBinding(loaded({}))).not.toBe(authOtpBinding(loaded({})));
  });

  it("replaces a stored value that is not a binding it could have minted", () => {
    const session = loaded({ [AUTH_OTP_BINDING_SESSION_KEY]: "short" });
    const minted = authOtpBinding(session);
    expect({ replaced: minted !== "short", stored: session.get(AUTH_OTP_BINDING_SESSION_KEY) === minted }).toEqual({
      replaced: true,
      stored: true,
    });
  });

  it("carries the binding and the SHA-256 of the signed-in token, and no token hash before sign-in", async () => {
    const { store } = recordingStore();
    const token = await signedInToken(store);
    const signedIn = loaded({ [AUTH_SESSION_TOKEN_KEY]: token });
    const anonymous = loaded({});
    const caller = await authFactorCaller(signedIn);
    const before = await authFactorCaller(anonymous);
    expect({
      binding: caller.binding === signedIn.get(AUTH_OTP_BINDING_SESSION_KEY),
      keep: caller.keep === null ? null : bytesToHex(caller.keep),
      anonymous: { binding: before.binding === anonymous.get(AUTH_OTP_BINDING_SESSION_KEY), keep: before.keep },
    }).toEqual({ binding: true, keep: await keyOf(token), anonymous: { binding: true, keep: null } });
  });
});

describe("revokeOtherAuthSessions", () => {
  it("deletes every other row the user holds, spares this session's and another user's, and answers how many went", async () => {
    const grace = fakeAuthUser({ id: "u2", email: "grace@example.com" });
    const { store, rows } = recordingStore([ADA, grace]);
    const current = await signedInToken(store);
    await signedInToken(store);
    await signedInToken(store);
    const graces = await signedInToken(store, "u2");
    expect(await revokeOtherAuthSessions(loaded({ [AUTH_SESSION_TOKEN_KEY]: current }), store, "u1", NOW)).toEqual({ ok: true, data: 2 });
    expect([...rows.keys()].sort()).toEqual([await keyOf(current), await keyOf(graces)].sort());
  });

  it("answers zero for a session holding no token, without asking the store", async () => {
    const { store, rows, calls } = recordingStore();
    await signedInToken(store);
    calls.length = 0;
    expect(await revokeOtherAuthSessions(createSession("sid-1"), store, "u1", NOW)).toEqual({ ok: true, data: 0 });
    expect({ calls, rows: rows.size }).toEqual({ calls: [], rows: 1 });
  });

  it("names this session as the one the revocation spares and records it at `at`", async () => {
    const { store } = recordingStore();
    const seen: unknown[][] = [];
    const token = await signedInToken(store);
    const spy = { revokeOthers: async (...args: Parameters<AuthSessionStore["revokeOthers"]>) => (seen.push(args), store.revokeOthers(...args)) };
    await revokeOtherAuthSessions(loaded({ [AUTH_SESSION_TOKEN_KEY]: token }), spy, "u1", NOW);
    expect(seen.map(([userId, at, origin]) => [userId, at, bytesToHex((origin as { keep: Uint8Array }).keep)])).toEqual([
      ["u1", NOW, await keyOf(token)],
    ]);
  });

  it("answers the store's failure", async () => {
    const { store } = recordingStore([ADA], { revokeOthers: failure("revokeOthers") });
    const result = await revokeOtherAuthSessions(loaded({ [AUTH_SESSION_TOKEN_KEY]: await signedInToken(store) }), store, "u1", NOW);
    expect(result.ok ? null : result.error.code).toBe("unavailable");
  });
});

describe("resolveAuthIdentity", () => {
  it("returns the identity of the row's owner, with the step-up the row holds", async () => {
    const { store, rows } = recordingStore();
    const token = await signedInToken(store);
    const session = loaded({ [AUTH_SESSION_TOKEN_KEY]: token });
    await markAuthStepUp(session, store, NOW + 7, NOW + 7, "passkey");
    const [row] = rows.values();
    expect(await resolveAuthIdentity(session, store, NOW + 10)).toEqual(
      ok({ userId: "u1", email: "ada@example.com", isAdmin: true, sessionId: row?.id, stepUpAt: NOW + 7, stepUpKind: "passkey" }),
    );
  });

  it("returns no step-up for a row that was never stepped up", async () => {
    const { store } = recordingStore();
    const identity = await resolveAuthIdentity(loaded({ [AUTH_SESSION_TOKEN_KEY]: await signedInToken(store) }), store, NOW);
    expect(identity.ok ? identity.data?.stepUpAt : "failed").toBeNull();
  });

  it("asks the store nothing for an anonymous session and leaves it clean, so no anonymous GET writes or carries a `Set-Cookie`", async () => {
    const { store, calls } = recordingStore();
    const session = loaded({});
    expect(await resolveAuthIdentity(session, store, NOW)).toEqual(ok(null));
    expect({ calls, dirty: session.dirty }).toEqual({ calls: [], dirty: false });
  });

  for (const [shape, token] of [
    ["a string one character short", "x".repeat(42)],
    ["a string one character long", "x".repeat(44)],
    ["a number", 7],
    ["an empty string", ""],
  ] as const) {
    it(`returns null for a token that is ${shape}, without asking the store`, async () => {
      const { store, calls } = recordingStore();
      expect(await resolveAuthIdentity(loaded({ [AUTH_SESSION_TOKEN_KEY]: token }), store, NOW)).toEqual(ok(null));
      expect(calls).toEqual([]);
    });
  }

  it("finds the row one millisecond before it expires, and refuses it at the instant it does, dropping the token", async () => {
    const { store } = recordingStore([ADA], {}, { idleTimeoutMs: null });
    const token = await signedInToken(store);
    const live = loaded({ [AUTH_SESSION_TOKEN_KEY]: token });
    const expired = loaded({ [AUTH_SESSION_TOKEN_KEY]: token });
    const before = await resolveAuthIdentity(live, store, NOW + AUTH_SESSION_MAX_MS - 1);
    const at = await resolveAuthIdentity(expired, store, NOW + AUTH_SESSION_MAX_MS);
    expect({ before: before.ok ? before.data?.userId : "failed", at, token: expired.get(AUTH_SESSION_TOKEN_KEY) }).toEqual({
      before: "u1",
      at: ok(null),
      token: undefined,
    });
  });

  it("refuses a row whose owner is deactivated, dropping the token", async () => {
    const { store } = recordingStore([fakeAuthUser({ id: "u1", deactivatedAt: 99 })]);
    const session = loaded({ [AUTH_SESSION_TOKEN_KEY]: await signedInToken(store) });
    expect(await resolveAuthIdentity(session, store, NOW)).toEqual(ok(null));
    expect(session.get(AUTH_SESSION_TOKEN_KEY)).toBeUndefined();
  });

  it("refuses a token naming no row, dropping it without rotating the id", async () => {
    const { store } = recordingStore();
    const scratch = createSession("scratch");
    await establishAuthSession(scratch, fakeAuthSessionStore([ADA]), "u1", NOW, NOW, { kind: "email-otp" });
    const session = loaded({ [AUTH_SESSION_TOKEN_KEY]: scratch.get(AUTH_SESSION_TOKEN_KEY) });
    expect(await resolveAuthIdentity(session, store, NOW)).toEqual(ok(null));
    expect({ token: session.get(AUTH_SESSION_TOKEN_KEY), id: session.id, deleteId: session.deleteId }).toEqual({
      token: undefined,
      id: "sid-1",
      deleteId: undefined,
    });
  });

  it("answers the store's failure rather than nobody when the store is unavailable, keeping the token and the session clean so an outage signs nobody out", async () => {
    const { store } = recordingStore([ADA], { resolve: failure("resolve") });
    const token = await signedInToken(store);
    const session = loaded({ [AUTH_SESSION_TOKEN_KEY]: token });
    const resolved = await resolveAuthIdentity(session, store, NOW);
    expect(resolved.ok ? "resolved" : resolved.error.code).toBe("unavailable");
    expect({ token: session.get(AUTH_SESSION_TOKEN_KEY), dirty: session.dirty }).toEqual({ token, dirty: false });
  });

  it("reads a session as anonymous once it was cleared", async () => {
    const { store } = recordingStore();
    const session = loaded({ [AUTH_SESSION_TOKEN_KEY]: await signedInToken(store) });
    await clearAuthSession(session, store);
    expect(await resolveAuthIdentity(session, store, NOW)).toEqual(ok(null));
  });
});

describe("markApproval and resolveApprovalMark", () => {
  it("rotates the session id when the approval is recorded, so a fixated id cannot inherit it", () => {
    const session = createSession("sid-1");
    markApproval(session, { presentedAt: NOW, digest: "k.mac" });
    expect(session.id).not.toBe("sid-1");
  });

  it("read back the moment the code was presented, under the approval's own key", () => {
    const session = createSession("sid-1");
    markApproval(session, { presentedAt: NOW, digest: "k.mac" });
    expect({ mark: resolveApprovalMark(session), stored: session.get(APPROVAL_SESSION_KEY) }).toEqual({
      mark: { presentedAt: NOW, digest: "k.mac" },
      stored: NOW,
    });
  });

  it("read no approval off a session that holds none, or one that holds something other than a finite stamp", () => {
    const session = createSession("sid-1");
    const unset = resolveApprovalMark(session);
    session.set(APPROVAL_CODE_SESSION_KEY, "k.mac");
    session.set(APPROVAL_SESSION_KEY, "yesterday");
    expect([unset, resolveApprovalMark(session)]).toEqual([null, null]);
  });

  it("leaves a signed-in session's token alone, and still deletes the old session id", async () => {
    const token = await signedInToken(recordingStore().store);
    const session = loaded({ [AUTH_SESSION_TOKEN_KEY]: token });
    markApproval(session, { presentedAt: NOW, digest: "k.mac" });
    expect({ token: session.get(AUTH_SESSION_TOKEN_KEY), deleteId: session.deleteId }).toEqual({ token, deleteId: "sid-1" });
  });
});
