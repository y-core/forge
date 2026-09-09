import { describe, expect, it } from "bun:test";

import { createSession } from "@remix-run/session";

import { ok } from "../../result/result";
import type { AuthUser, UserStore } from "../types";
import {
  AUTH_PENDING_SIGNIN_SESSION_KEY,
  AUTH_SESSION_KEY,
  AUTH_STEP_UP_SESSION_KEY,
  clearAuthSession,
  establishAuthSession,
  markAuthStepUp,
  resolveAuthIdentity,
} from "./identity";

function fakeAuthUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "u1",
    email: "ada@example.com",
    emailKey: "ada@example.com",
    emailVerifiedAt: 1,
    webauthnId: null,
    isAdmin: false,
    deactivatedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function fakeUsers(users: readonly AuthUser[]): Pick<UserStore, "findById"> {
  return { findById: async (id) => ok(users.find((user) => user.id === id) ?? null) };
}

const unavailableUsers: Pick<UserStore, "findById"> = { findById: async () => ({ ok: false, error: new Error("db down") as never }) };

// Seeded through `initialData` and not `set`, so `dirty` starts false and a later assertion on it
// reports what this call did rather than what the fixture did.
function signedInSession(userId: string) {
  return createSession<Record<string, unknown>>("sid-1", [{ [AUTH_SESSION_KEY]: userId }, {}]);
}

describe("resolveAuthIdentity", () => {
  it("returns the identity the store confirms, with no step-up until one is marked", async () => {
    const identity = await resolveAuthIdentity(signedInSession("u1"), fakeUsers([fakeAuthUser({ isAdmin: true })]));
    expect(identity).toEqual({ userId: "u1", email: "ada@example.com", isAdmin: true, stepUpAt: null });
  });

  it("carries the session's step-up timestamp onto the identity", async () => {
    const session = signedInSession("u1");
    markAuthStepUp(session, 1_700_000_000_000);
    const identity = await resolveAuthIdentity(session, fakeUsers([fakeAuthUser()]));
    expect(identity?.stepUpAt).toBe(1_700_000_000_000);
  });

  it("ignores a step-up mark that is not a finite number", async () => {
    const session = signedInSession("u1");
    session.set(AUTH_STEP_UP_SESSION_KEY, "yesterday");
    const identity = await resolveAuthIdentity(session, fakeUsers([fakeAuthUser()]));
    expect(identity?.stepUpAt).toBeNull();
  });

  it("returns null for an anonymous session", async () => {
    expect(await resolveAuthIdentity(createSession("sid-1"), fakeUsers([fakeAuthUser()]))).toBeNull();
  });

  it("returns null when the session names a user the store does not have, and drops the auth keys", async () => {
    const session = signedInSession("ghost");
    markAuthStepUp(session, 1_700_000_000_000);
    session.set(AUTH_PENDING_SIGNIN_SESSION_KEY, "ada@example.com");

    expect(await resolveAuthIdentity(session, fakeUsers([fakeAuthUser()]))).toBeNull();
    expect(session.get(AUTH_SESSION_KEY)).toBeUndefined();
    expect(session.get(AUTH_STEP_UP_SESSION_KEY)).toBeUndefined();
    expect(session.get(AUTH_PENDING_SIGNIN_SESSION_KEY)).toBeUndefined();
  });

  it("returns null for a deactivated user, so a live session cannot outlive the account", async () => {
    const session = signedInSession("u1");
    markAuthStepUp(session, 1_700_000_000_000);
    session.set(AUTH_PENDING_SIGNIN_SESSION_KEY, "ada@example.com");

    expect(await resolveAuthIdentity(session, fakeUsers([fakeAuthUser({ deactivatedAt: 99 })]))).toBeNull();
    expect(session.get(AUTH_SESSION_KEY)).toBeUndefined();
    expect(session.get(AUTH_STEP_UP_SESSION_KEY)).toBeUndefined();
    expect(session.get(AUTH_PENDING_SIGNIN_SESSION_KEY)).toBeUndefined();
    expect(session.dirty).toBe(true);
  });

  // The revocation empties the session rather than granting it anything, so it costs no rotation:
  // a `regenerateId` here would add a store delete and a `Set-Cookie` on a plain GET.
  it("revokes a refused id without rotating the session id", async () => {
    const session = signedInSession("u1");
    await resolveAuthIdentity(session, fakeUsers([fakeAuthUser({ deactivatedAt: 99 })]));

    expect(session.id).toBe("sid-1");
    expect(session.deleteId).toBeUndefined();
  });

  // The bug: nothing unset the key, so reactivating the account made every cookie still in a
  // browser live again.
  it("keeps a revoked session refused once the account is reactivated", async () => {
    const session = signedInSession("u1");
    let user = fakeAuthUser({ deactivatedAt: 99 });
    const users: Pick<UserStore, "findById"> = { findById: async (id) => ok(id === user.id ? user : null) };

    expect(await resolveAuthIdentity(session, users)).toBeNull();
    user = fakeAuthUser({ deactivatedAt: null });
    expect(await resolveAuthIdentity(session, users)).toBeNull();
  });

  it("returns null when the store is unavailable, rather than reading as `not an admin`", async () => {
    const session = signedInSession("u1");

    expect(await resolveAuthIdentity(session, unavailableUsers)).toBeNull();
    expect(session.get(AUTH_SESSION_KEY)).toBe("u1");
    // The whole point of not clearing on an outage: no `Set-Cookie`, so a database blip signs nobody out.
    expect(session.dirty).toBe(false);
  });

  it("leaves an anonymous session clean, so no anonymous GET carries a `Set-Cookie`", async () => {
    const session = createSession("sid-1");
    expect(await resolveAuthIdentity(session, fakeUsers([fakeAuthUser()]))).toBeNull();
    expect(session.dirty).toBe(false);
  });

  it("returns null for a session whose stored id is not a string", async () => {
    const session = createSession("sid-1");
    session.set(AUTH_SESSION_KEY, 7);
    expect(await resolveAuthIdentity(session, fakeUsers([fakeAuthUser()]))).toBeNull();
  });
});

describe("establishAuthSession", () => {
  it("stores the user id and rotates the session id, so a fixated id cannot survive the sign-in", () => {
    const session = createSession("sid-1");
    establishAuthSession(session, "u1");
    expect(session.get(AUTH_SESSION_KEY)).toBe("u1");
    expect(session.id).not.toBe("sid-1");
    expect(session.deleteId).toBe("sid-1");
  });

  it("clears a previous step-up, so a new sign-in cannot inherit a demand it never met", () => {
    const session = createSession("sid-1");
    markAuthStepUp(session, Date.now());
    establishAuthSession(session, "u1");
    expect(session.get(AUTH_STEP_UP_SESSION_KEY)).toBeUndefined();
  });
});

describe("markAuthStepUp", () => {
  it("records the moment the step-up passed, which is the memory `resolve` has not got", () => {
    const session = signedInSession("u1");
    markAuthStepUp(session, 42);
    expect(session.get(AUTH_STEP_UP_SESSION_KEY)).toBe(42);
  });

  it("clamps a mark dated into the future to now, so a skewed clock cannot make one last forever", () => {
    const session = signedInSession("u1");
    markAuthStepUp(session, Date.now() + 3_600_000);
    expect(session.get(AUTH_STEP_UP_SESSION_KEY)).toBeLessThanOrEqual(Date.now());
  });
});

describe("clearAuthSession", () => {
  it("drops the user id and the step-up mark, and rotates the session id", () => {
    const session = signedInSession("u1");
    markAuthStepUp(session, Date.now());
    clearAuthSession(session);
    expect(session.get(AUTH_SESSION_KEY)).toBeUndefined();
    expect(session.get(AUTH_STEP_UP_SESSION_KEY)).toBeUndefined();
    expect(session.id).not.toBe("sid-1");
  });

  it("leaves a resolved identity anonymous afterwards", async () => {
    const session = signedInSession("u1");
    clearAuthSession(session);
    expect(await resolveAuthIdentity(session, fakeUsers([fakeAuthUser()]))).toBeNull();
  });
});
