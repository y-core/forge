import { describe, expect, it } from "bun:test";

import { AUTH_SECURITY_EVENT_TTL_MS, AUTH_SESSION_IDLE_MS, AUTH_SESSION_MAX_MS, AUTH_UNVERIFIED_USER_TTL_MS } from "../auth/config";
import { createAdminUserStore } from "../auth/stores/admin-users";
import { createChallengeStore } from "../auth/stores/challenges";
import { purgeAuthEphemera } from "../auth/stores/ephemera";
import { createSecurityEventStore } from "../auth/stores/events";
import { createFactorStore } from "../auth/stores/factors";
import { createNonceStore } from "../auth/stores/nonces";
import { createAuthSessionStore } from "../auth/stores/sessions";
import { createUserStore } from "../auth/stores/users";
import { ok } from "../result/result";
import { createD1Client } from "../storage/db/client";
import { sql } from "../storage/db/sql";
import { fakeAuthD1 } from "./auth-fakes";

const ADA = "018f0000-0000-7000-8000-000000000001";
const GRACE = "018f0000-0000-7000-8000-000000000002";
const OPERATOR = "018f0000-0000-7000-8000-000000000003";

const HANDLE = new Uint8Array([1, 2, 3, 4]);

// Driven through the real stores rather than asserted against hand-written rows: what this fake owes
// a consumer is that forge's own statements read back, which only the statements themselves prove.
function stores(users: Parameters<typeof fakeAuthD1>[0]) {
  const client = createD1Client(fakeAuthD1(users) as never);
  return {
    users: createUserStore(client),
    factors: createFactorStore(client),
    admin: createAdminUserStore(client),
    challenges: createChallengeStore(client),
    nonces: createNonceStore(client),
  };
}

const ACCOUNTS = [
  { id: ADA, email: "Ada@Example.com", webauthnId: HANDLE, factors: [{ kind: "passkey" }, { kind: "totp-app", confirmedAt: null }] },
  { id: GRACE, email: "grace@example.com", isAdmin: true, deactivatedAt: 99 },
];

describe("fakeAuthD1 through the user store", () => {
  it("reads an account back by id, decoding the UUID out of the BLOB column", async () => {
    const found = await stores(ACCOUNTS).users.findById(ADA);
    expect(found.ok && found.data?.id).toBe(ADA);
    expect(found.ok && found.data?.email).toBe("Ada@Example.com");
  });

  it("defaults the email key to the lowercased address, which is what the flows write", async () => {
    const found = await stores(ACCOUNTS).users.findByEmailKey("ada@example.com");
    expect(found.ok && found.data?.id).toBe(ADA);
  });

  it("carries `isAdmin` and `deactivatedAt` through, so an admin and a disabled account are both testable", async () => {
    const found = await stores(ACCOUNTS).users.findById(GRACE);
    expect(found.ok && found.data?.isAdmin).toBe(true);
    expect(found.ok && found.data?.deactivatedAt).toBe(99);
  });

  it("keeps a `null` verification stamp, so an account that never answered a link is modelled as one", async () => {
    const found = await stores([{ id: ADA, email: "ada@example.com", emailVerifiedAt: null }]).users.findById(ADA);
    expect(found.ok && found.data?.emailVerifiedAt).toBeNull();
  });

  it("finds an account by its WebAuthn handle", async () => {
    const found = await stores(ACCOUNTS).users.findByWebAuthnId(HANDLE);
    expect(found.ok && found.data?.id).toBe(ADA);
  });

  it("answers no row for an id it holds no account for, rather than failing", async () => {
    const found = await stores(ACCOUNTS).users.findById("018f0000-0000-7000-8000-00000000ffff");
    expect(found.ok && found.data).toBeNull();
  });
  it("claims the email-change cooldown once, refuses a claim inside it and grants one from its end on", async () => {
    const { users } = stores(ACCOUNTS);
    const claims = [
      await users.claimEmailChange(ADA, 1_000, 300_000),
      await users.claimEmailChange(ADA, 300_999, 300_000),
      await users.claimEmailChange(GRACE, 300_999, 300_000),
      await users.claimEmailChange(ADA, 301_000, 300_000),
    ];
    expect(claims.map((claim) => claim.ok && claim.data)).toEqual([true, false, true, true]);
  });

  it("claims no email-change cooldown for an id it holds no account for, or for a deleted one", async () => {
    const { users, admin } = stores(ACCOUNTS);
    await admin.remove(ADA);
    const claims = [
      await users.claimEmailChange("018f0000-0000-7000-8000-00000000ffff", 1_000, 300_000),
      await users.claimEmailChange(ADA, 1_000, 300_000),
    ];
    expect(claims.map((claim) => claim.ok && claim.data)).toEqual([false, false]);
  });
});

describe("fakeAuthD1 through the factor store", () => {
  it("lists a user's enrolments", async () => {
    const found = await stores(ACCOUNTS).factors.listByUser(ADA);
    expect(found.ok && found.data.map((row) => row.kind)).toEqual(["passkey", "totp-app"]);
  });

  it("finds one enrolment by kind", async () => {
    const found = await stores(ACCOUNTS).factors.find(ADA, "passkey");
    expect(found.ok && found.data?.kind).toBe("passkey");
  });

  it("lists only the confirmed kinds among those asked for", async () => {
    const [asked, both] = await Promise.all([
      stores(ACCOUNTS).factors.listConfirmedKinds(ADA, ["totp-app"]),
      stores(ACCOUNTS).factors.listConfirmedKinds(ADA, ["passkey", "totp-app"]),
    ]);
    expect([asked, both]).toEqual([ok([]), ok(["passkey"])]);
  });

  // An unconfirmed row is what an owed enrolment looks like to the registry, so it has to survive.
  it("keeps an unconfirmed enrolment unconfirmed, and confirms the rest by default", async () => {
    const found = await stores(ACCOUNTS).factors.listByUser(ADA);
    expect(found.ok && found.data.map((row) => row.confirmedAt)).toEqual([1, null]);
  });

  it("answers no enrolments for a user that has none", async () => {
    const found = await stores(ACCOUNTS).factors.listByUser(GRACE);
    expect(found.ok && found.data).toEqual([]);
  });
});

describe("fakeAuthD1 through the admin user store", () => {
  it("pages the accounts newest first, which on a UUIDv7 key is time order", async () => {
    const listed = await stores(ACCOUNTS).admin.list();
    expect(listed.ok && listed.data.map((row) => row.id)).toEqual([GRACE, ADA]);
  });

  it("honours the page limit", async () => {
    const listed = await stores(ACCOUNTS).admin.list({ limit: 1 });
    expect(listed.ok && listed.data.map((row) => row.id)).toEqual([GRACE]);
  });

  it("pages past a cursor", async () => {
    const listed = await stores(ACCOUNTS).admin.list({ after: GRACE });
    expect(listed.ok && listed.data.map((row) => row.id)).toEqual([ADA]);
  });

  it("anchors a search at the start of the address, folding case as the index does", async () => {
    const found = await stores(ACCOUNTS).admin.search("ADA@");
    expect(found.ok && found.data.map((row) => row.id)).toEqual([ADA]);
  });

  it("answers nothing for a term that only appears mid-address", async () => {
    const found = await stores(ACCOUNTS).admin.search("example.com");
    expect(found.ok && found.data).toEqual([]);
  });

  it("matches every account for an empty term, newest first", async () => {
    const found = await stores(ACCOUNTS).admin.search("");
    expect(found.ok && found.data.map((row) => row.id)).toEqual([GRACE, ADA]);
  });

  it("pages a search past a cursor", async () => {
    const found = await stores(ACCOUNTS).admin.search("", { after: GRACE });
    const bounded = await stores(ACCOUNTS).admin.search("ada", { after: ADA });
    expect([found.ok && found.data.map((row) => row.id), bounded.ok && bounded.data]).toEqual([[ADA], []]);
  });

  it("counts only the admins who could still sign in", async () => {
    const counted = await stores(ACCOUNTS).admin.countAdmins();
    expect(counted.ok && counted.data).toBe(0);
  });
});

describe("fakeAuthD1 through the challenge store", () => {
  it("takes a stored challenge back", async () => {
    const store = stores(ACCOUNTS).challenges;
    await store.put("ceremony", { challenge: "c1", sessionId: "s1" }, 300);
    const taken = await store.take("ceremony");
    expect(taken.ok && taken.data).toEqual({ challenge: "c1", sessionId: "s1" });
  });

  it("spends it, so a second take is handed nothing", async () => {
    const store = stores(ACCOUNTS).challenges;
    await store.put("ceremony", { challenge: "c1", sessionId: "s1" }, 300);
    await store.take("ceremony");
    const again = await store.take("ceremony");
    expect(again.ok && again.data).toBeNull();
  });
});

describe("fakeAuthD1 through the nonce store", () => {
  it("reports the first claim on a key as the one that won", async () => {
    const claimed = await stores(ACCOUNTS).nonces.markConsumed("token", 300);
    expect(claimed.ok && claimed.data).toBe(true);
  });

  it("refuses a replay of the same key", async () => {
    const store = stores(ACCOUNTS).nonces;
    await store.markConsumed("token", 300);
    const replayed = await store.markConsumed("token", 300);
    expect(replayed.ok && replayed.data).toBe(false);
  });

  it("keeps two keys apart", async () => {
    const store = stores(ACCOUNTS).nonces;
    await store.markConsumed("first", 300);
    const second = await store.markConsumed("second", 300);
    expect(second.ok && second.data).toBe(true);
  });
});

describe("fakeAuthD1 through the session store", () => {
  const TOKEN = new Uint8Array(32).fill(7);
  const OTHER = new Uint8Array(32).fill(8);
  const THIRD = new Uint8Array(32).fill(9);
  const live = { userId: ADA, signedInAt: 1_000, signedInWith: "email-otp" } as const;
  const EXPIRES = 1_000 + AUTH_SESSION_MAX_MS;

  function sessionStores(users: Parameters<typeof fakeAuthD1>[0] = ACCOUNTS, options?: Parameters<typeof createAuthSessionStore>[1]) {
    const client = createD1Client(fakeAuthD1(users) as never);
    return { sessions: createAuthSessionStore(client, options), admin: createAdminUserStore(client), users: createUserStore(client) };
  }

  it("resolves a created row joined to its owner, with no step-up until one is marked", async () => {
    const { sessions } = sessionStores();
    await sessions.create({ tokenHash: TOKEN, ...live }, null);
    const found = await sessions.resolve(TOKEN, 4_999);
    const { id: sessionId, ...session } = found.ok && found.data ? found.data.session : { id: null };
    expect({ user: found.ok && found.data?.user, session, sessionId: typeof sessionId }).toEqual({
      user: { id: ADA, email: "Ada@Example.com", isAdmin: false },
      session: { signedInAt: 1_000, expiresAt: EXPIRES, lastSeenAt: 1_000, stepUpAt: null, stepUpKind: null, device: null },
      sessionId: "string",
    });
  });

  it("answers no row at the expiry instant, and none for an owner seeded as deactivated", async () => {
    const { sessions } = sessionStores(ACCOUNTS, { idleTimeoutMs: null });
    await sessions.create({ tokenHash: TOKEN, ...live }, null);
    await sessions.create({ tokenHash: OTHER, ...live, userId: GRACE }, null);
    const [expired, deactivated] = await Promise.all([sessions.resolve(TOKEN, EXPIRES), sessions.resolve(OTHER, 1_000)]);
    expect([expired, deactivated]).toEqual([ok(null), ok(null)]);
  });

  it("deletes the row a create names as replaced, in the same batch", async () => {
    const { sessions } = sessionStores();
    await sessions.create({ tokenHash: TOKEN, ...live }, null);
    await sessions.create({ tokenHash: OTHER, ...live }, TOKEN);
    const [replaced, current] = await Promise.all([sessions.resolve(TOKEN, 2_000), sessions.resolve(OTHER, 2_000)]);
    expect([replaced.ok && replaced.data, current.ok && current.data?.user.id]).toEqual([null, ADA]);
  });

  it("moves a row onto a new token with the step-up mark, retiring the old one, and reports a row it does not hold as unwritten", async () => {
    const { sessions } = sessionStores();
    await sessions.create({ tokenHash: TOKEN, ...live }, null);
    const stepUp = { at: 1_500, kind: "totp-app" } as const;
    const marks = [await sessions.rotate(TOKEN, OTHER, stepUp), await sessions.rotate(TOKEN, OTHER, stepUp)];
    const [retired, found] = await Promise.all([sessions.resolve(TOKEN, 2_000), sessions.resolve(OTHER, 2_000)]);
    expect({ marks, retired, stepUp: found.ok && [found.data?.session.stepUpAt, found.data?.session.stepUpKind] }).toEqual({
      marks: [ok(true), ok(false)],
      retired: ok(null),
      stepUp: [1_500, "totp-app"],
    });
  });

  it("carries the id, the sign-in instant, the expiry, the last-seen stamp, the device and an earlier mark and kind onto the new token when a rotation stamps none", async () => {
    const { sessions } = sessionStores();
    const seenAt = 1_000 + AUTH_SESSION_IDLE_MS / 12;
    await sessions.create({ tokenHash: TOKEN, ...live, stepUp: { at: 1_200, kind: "passkey" }, device: "Firefox on macOS" }, null);
    const before = await sessions.resolve(TOKEN, seenAt);
    await sessions.rotate(TOKEN, OTHER);
    const [retired, found] = await Promise.all([sessions.resolve(TOKEN, seenAt), sessions.resolve(OTHER, seenAt)]);
    expect({ retired, session: found.ok && found.data?.session }).toEqual({
      retired: ok(null),
      session: {
        id: before.ok ? before.data?.session.id : "unresolved",
        signedInAt: 1_000,
        expiresAt: EXPIRES,
        lastSeenAt: seenAt,
        stepUpAt: 1_200,
        stepUpKind: "passkey",
        device: "Firefox on macOS",
      },
    });
  });

  it("carries the device onto the new token when a rotation stamps a step-up", async () => {
    const { sessions } = sessionStores();
    await sessions.create({ tokenHash: TOKEN, ...live, device: "Safari on iOS" }, null);
    await sessions.rotate(TOKEN, OTHER, { at: 1_500, kind: "totp-app" });
    const found = await sessions.resolve(OTHER, 2_000);
    expect(found.ok && found.data?.session.device).toBe("Safari on iOS");
  });

  it("lists the owner's live sessions newest sign-in first, without another owner's or an expired one", async () => {
    const { sessions } = sessionStores([
      { id: ADA, email: "ada@example.com" },
      { id: GRACE, email: "grace@example.com" },
    ]);
    await sessions.create({ tokenHash: TOKEN, ...live, device: "Firefox on Linux" }, null);
    await sessions.create({ tokenHash: OTHER, ...live, signedInAt: 1_100 }, null);
    await sessions.create({ tokenHash: THIRD, ...live, userId: GRACE }, null);
    const listed = await sessions.listByUser(ADA, 2_000);
    const expired = await sessions.listByUser(ADA, EXPIRES + 100);
    expect({ listed: listed.ok && listed.data.map((session) => [session.signedInAt, session.device]), expired }).toEqual({
      listed: [
        [1_100, null],
        [1_000, "Firefox on Linux"],
      ],
      expired: ok([]),
    });
  });

  it("revokes one session by its id among the owner's, never the kept one or another owner's", async () => {
    const { sessions } = sessionStores([
      { id: ADA, email: "ada@example.com" },
      { id: GRACE, email: "grace@example.com" },
    ]);
    await sessions.create({ tokenHash: TOKEN, ...live }, null);
    await sessions.create({ tokenHash: OTHER, ...live }, null);
    await sessions.create({ tokenHash: THIRD, ...live, userId: GRACE }, null);
    const idOf = async (hash: Uint8Array<ArrayBuffer>) => {
      const found = await sessions.resolve(hash, 2_000);
      return found.ok ? (found.data?.session.id ?? "") : "";
    };
    const [kept, other, theirs] = [await idOf(TOKEN), await idOf(OTHER), await idOf(THIRD)];
    const outcomes = [
      await sessions.revoke(ADA, kept, 2_000, { keep: TOKEN }),
      await sessions.revoke(ADA, theirs, 2_000, { keep: TOKEN }),
      await sessions.revoke(ADA, other, 2_000, { keep: TOKEN }),
    ];
    expect({ outcomes, left: [await idOf(TOKEN), await idOf(OTHER), await idOf(THIRD)] }).toEqual({
      outcomes: [ok(false), ok(false), ok(true)],
      left: [kept, "", theirs],
    });
  });

  it("removes a row once, so a second removal reports nothing removed", async () => {
    const { sessions } = sessionStores();
    await sessions.create({ tokenHash: TOKEN, ...live }, null);
    expect([await sessions.remove(TOKEN), await sessions.remove(TOKEN), await sessions.resolve(TOKEN, 2_000)]).toEqual([
      ok(true),
      ok(false),
      ok(null),
    ]);
  });

  it("revokes every other row of the owner, reporting the rows it removed and sparing another owner's", async () => {
    const { sessions } = sessionStores([
      { id: ADA, email: "ada@example.com" },
      { id: GRACE, email: "grace@example.com" },
    ]);
    await sessions.create({ tokenHash: TOKEN, ...live }, null);
    await sessions.create({ tokenHash: OTHER, ...live }, null);
    await sessions.create({ tokenHash: THIRD, ...live, userId: GRACE }, null);
    const revoked = await sessions.revokeOthers(ADA, 2_000, { keep: TOKEN });
    const owners = await Promise.all(
      [TOKEN, OTHER, THIRD].map(async (hash) => {
        const found = await sessions.resolve(hash, 2_000);
        return found.ok ? (found.data?.user.id ?? null) : "failed";
      }),
    );
    expect({ revoked, owners }).toEqual({ revoked: ok(1), owners: [ADA, null, GRACE] });
  });

  it("purges the rows expired at or before the instant, and keeps a later one", async () => {
    const db = fakeAuthD1(ACCOUNTS);
    const client = createD1Client(db as never);
    const sessions = createAuthSessionStore(client);
    await sessions.create({ tokenHash: TOKEN, ...live }, null);
    await sessions.create({ tokenHash: OTHER, ...live, signedInAt: 1_001 }, null);
    await purgeAuthEphemera(client, EXPIRES);
    const [purged, kept] = await Promise.all([sessions.resolve(TOKEN, 0), sessions.resolve(OTHER, 0)]);
    expect([purged.ok && purged.data, kept.ok && kept.data?.user.id]).toEqual([null, ADA]);
  });

  it("deletes only as many expired rows as one bounded purge step names, the earliest-expiring first", async () => {
    const db = fakeAuthD1(ACCOUNTS);
    const client = createD1Client(db as never);
    const sessions = createAuthSessionStore(client, { idleTimeoutMs: null });
    await sessions.create({ tokenHash: THIRD, ...live, signedInAt: 1_002 }, null);
    await sessions.create({ tokenHash: TOKEN, ...live, signedInAt: 1_000 }, null);
    await sessions.create({ tokenHash: OTHER, ...live, signedInAt: 1_001 }, null);
    const step = await client.query(
      sql`DELETE FROM auth_sessions WHERE rowid IN (SELECT rowid FROM auth_sessions WHERE expires_at <= ${1_002 + AUTH_SESSION_MAX_MS} ORDER BY expires_at LIMIT ${2}) RETURNING rowid`,
    );
    const held = await Promise.all(
      [TOKEN, OTHER, THIRD].map(async (hash) => {
        const found = await sessions.resolve(hash, 0);
        return found.ok && found.data !== null;
      }),
    );
    expect({ returned: step.ok && step.data.length, held }).toEqual({ returned: 2, held: [false, false, true] });
  });

  it("deletes every row of a user whose address moves", async () => {
    const { sessions, users } = sessionStores();
    await sessions.create({ tokenHash: TOKEN, ...live }, null);
    await sessions.create({ tokenHash: OTHER, ...live }, null);
    await users.changeEmail(ADA, "moved@example.com", "moved@example.com", 2_000);
    expect([await sessions.resolve(TOKEN, 2_000), await sessions.resolve(OTHER, 2_000)]).toEqual([ok(null), ok(null)]);
  });

  it("deletes every row of a user whose factors an administrator resets", async () => {
    const { sessions, admin } = sessionStores();
    await sessions.create({ tokenHash: TOKEN, ...live }, null);
    await admin.resetFactors(ADA, 2_000, OPERATOR);
    expect(await sessions.resolve(TOKEN, 2_000)).toEqual(ok(null));
  });
});

describe("fakeAuthD1 through an account removal", () => {
  const HOPPER = "018f0000-0000-7000-8000-000000000004";
  const DORA = "018f0000-0000-7000-8000-000000000005";
  const MISSING = "018f0000-0000-7000-8000-00000000ffff";
  const member = { id: ADA, email: "ada@example.com" };
  const admin = { id: GRACE, email: "grace@example.com", isAdmin: true };
  const secondAdmin = { id: HOPPER, email: "hopper@example.com", isAdmin: true };
  const deactivatedAdmin = { id: DORA, email: "dora@example.com", isAdmin: true, deactivatedAt: 99 };

  const removals = [
    { title: "a member's", users: [member, admin], target: ADA, expected: { [ADA]: 0, [GRACE]: 1 } },
    { title: "one of two active admins'", users: [member, admin, secondAdmin], target: GRACE, expected: { [ADA]: 1, [GRACE]: 0, [HOPPER]: 1 } },
    {
      title: "a deactivated admin's, beside the last active one,",
      users: [admin, deactivatedAdmin],
      target: DORA,
      expected: { [GRACE]: 1, [DORA]: 0 },
    },
    { title: "none of the last active admin's", users: [member, admin], target: GRACE, expected: { [ADA]: 1, [GRACE]: 1 } },
    {
      title: "none of the last active admin's, beside a deactivated admin,",
      users: [admin, deactivatedAdmin],
      target: GRACE,
      expected: { [GRACE]: 1, [DORA]: 1 },
    },
    { title: "nobody's for an id it holds no account for", users: [member, admin], target: MISSING, expected: { [ADA]: 1, [GRACE]: 1 } },
  ];

  function removing(users: Parameters<typeof fakeAuthD1>[0]) {
    const client = createD1Client(fakeAuthD1(users) as never);
    return {
      sessions: createAuthSessionStore(client),
      adminUsers: createAdminUserStore(client),
      users: createUserStore(client),
      events: createSecurityEventStore(client),
    };
  }

  it("answers changed for a removable account, which then no longer reads back and keeps no session or security event, while another's stay", async () => {
    const { sessions, adminUsers, users, events } = removing([member, admin]);
    await sessions.create({ tokenHash: new Uint8Array(32).fill(1), userId: ADA, signedInAt: 1_000, signedInWith: "email-otp" }, null);
    await sessions.create({ tokenHash: new Uint8Array(32).fill(2), userId: GRACE, signedInAt: 1_000, signedInWith: "email-otp" }, null);
    const outcome = await adminUsers.remove(ADA);
    const [found, adaSessions, adaEvents, graceEvents] = await Promise.all([
      users.findById(ADA),
      sessions.listByUser(ADA, 2_000),
      events.listByUser(ADA),
      events.listByUser(GRACE),
    ]);
    expect({
      outcome,
      found: found.ok && found.data,
      adaSessions: adaSessions.ok && adaSessions.data.length,
      adaEvents: adaEvents.ok && adaEvents.data.length,
      graceEvents: graceEvents.ok && graceEvents.data.length,
    }).toEqual({ outcome: ok("changed"), found: null, adaSessions: 0, adaEvents: 0, graceEvents: 1 });
  });

  it("answers last-admin-delete for the last active admin, whose account still reads back", async () => {
    const { adminUsers, users } = removing([member, admin]);
    const outcome = await adminUsers.remove(GRACE);
    const found = await users.findById(GRACE);
    expect([outcome, found.ok && found.data?.id]).toEqual([ok("last-admin-delete"), GRACE]);
  });

  it("answers not-found for an id it holds no account for, and for an account already removed", async () => {
    const { adminUsers } = removing([member, admin]);
    expect([await adminUsers.remove(MISSING), await adminUsers.remove(ADA), await adminUsers.remove(ADA)]).toEqual([
      ok("not-found"),
      ok("changed"),
      ok("not-found"),
    ]);
  });

  for (const { title, users, target, expected } of removals) {
    it(`drops ${title} sessions through the guarded account delete, and every other owner's stay`, async () => {
      const client = createD1Client(fakeAuthD1(users) as never);
      const sessions = createAuthSessionStore(client);
      for (const [index, user] of users.entries()) {
        await sessions.create(
          { tokenHash: new Uint8Array(32).fill(index + 1), userId: user.id, signedInAt: 1_000, signedInWith: "email-otp" },
          null,
        );
      }
      await createAdminUserStore(client).remove(target);
      const counts = await Promise.all(
        users.map(async (user) => {
          const listed = await sessions.listByUser(user.id, 2_000);
          return [user.id, listed.ok ? listed.data.length : -1] as const;
        }),
      );
      expect(Object.fromEntries(counts)).toEqual(expected);
    });
  }
});

describe("fakeAuthD1 through a deactivation", () => {
  const TOKEN = new Uint8Array(32).fill(7);
  const MEMBERS = [
    { id: ADA, email: "ada@example.com" },
    { id: GRACE, email: "grace@example.com", isAdmin: true },
  ];

  function deactivating(users: Parameters<typeof fakeAuthD1>[0] = MEMBERS) {
    const client = createD1Client(fakeAuthD1(users) as never);
    return { sessions: createAuthSessionStore(client), admin: createAdminUserStore(client), users: createUserStore(client) };
  }

  it("records the deactivation on the account, so every later read finds it deactivated", async () => {
    const { admin, users } = deactivating();
    const outcome = await admin.setDeactivated(ADA, true, 4_000, OPERATOR);
    const found = await users.findById(ADA);
    expect({ outcome, deactivatedAt: found.ok && found.data?.deactivatedAt }).toEqual({ outcome: ok("changed"), deactivatedAt: 4_000 });
  });

  it("deletes the deactivated user's session rows in the same batch", async () => {
    const { sessions, admin } = deactivating();
    await sessions.create({ tokenHash: TOKEN, userId: ADA, signedInAt: 1_000, signedInWith: "email-otp" }, null);
    await admin.setDeactivated(ADA, true, 4_000, OPERATOR);
    await admin.setDeactivated(ADA, false, 5_000, OPERATOR);
    expect(await sessions.resolve(TOKEN, 6_000)).toEqual(ok(null));
  });

  it("refuses to deactivate the last admin who could sign in, and leaves that admin's sessions", async () => {
    const { sessions, admin, users } = deactivating();
    await sessions.create({ tokenHash: TOKEN, userId: GRACE, signedInAt: 1_000, signedInWith: "email-otp" }, null);
    const outcome = await admin.setDeactivated(GRACE, true, 4_000, OPERATOR);
    const [found, held] = await Promise.all([users.findById(GRACE), sessions.resolve(TOKEN, 6_000)]);
    expect({ outcome, deactivatedAt: found.ok && found.data?.deactivatedAt, held: held.ok && held.data?.user.id }).toEqual({
      outcome: ok("last-admin-deactivate"),
      deactivatedAt: null,
      held: GRACE,
    });
  });

  it("clears the mark on reactivation, so the account signs in again", async () => {
    const { admin, users } = deactivating();
    await admin.setDeactivated(ADA, true, 4_000, OPERATOR);
    const outcome = await admin.setDeactivated(ADA, false, 5_000, OPERATOR);
    const found = await users.findById(ADA);
    expect({ outcome, deactivatedAt: found.ok && found.data?.deactivatedAt }).toEqual({ outcome: ok("changed"), deactivatedAt: null });
  });

  it("reports an id it holds no account for as not found, either way", async () => {
    const { admin } = deactivating();
    const missing = "018f0000-0000-7000-8000-00000000ffff";
    expect([await admin.setDeactivated(missing, true, 4_000, OPERATOR), await admin.setDeactivated(missing, false, 4_000, OPERATOR)]).toEqual([
      ok("not-found"),
      ok("not-found"),
    ]);
  });
});

describe("fakeAuthD1 through the security events a write records", () => {
  const TOKEN = new Uint8Array(32).fill(7);
  const MEMBERS = [
    { id: ADA, email: "ada@example.com" },
    { id: GRACE, email: "grace@example.com", isAdmin: true },
  ];

  function recording() {
    const client = createD1Client(fakeAuthD1(MEMBERS) as never);
    return { sessions: createAuthSessionStore(client), admin: createAdminUserStore(client), events: createSecurityEventStore(client) };
  }

  async function typesOf(events: ReturnType<typeof recording>["events"], userId: string): Promise<unknown> {
    const listed = await events.listByUser(userId);
    return listed.ok ? listed.data.map((event) => [event.type, event.factorKind, event.adminId, event.sessionId === null]) : listed;
  }

  it("records a sign-in against its owner with the factor it used, naming the session by its public id", async () => {
    const { sessions, events } = recording();
    await sessions.create({ tokenHash: TOKEN, userId: ADA, signedInAt: 1_000, signedInWith: "email-otp" }, null);
    const resolved = await sessions.resolve(TOKEN, 2_000);
    const listed = await events.listByUser(ADA);
    expect(listed.ok && listed.data.map((event) => [event.type, event.factorKind, event.sessionId])).toEqual([
      ["signed-in", "email-otp", resolved.ok ? resolved.data?.session.id : undefined],
    ]);
  });

  it("records a deactivation and a reactivation under the acting admin, newest first, and nothing for a no-op or a refusal", async () => {
    const { admin, events } = recording();
    await admin.setDeactivated(ADA, true, 4_000, OPERATOR);
    await admin.setDeactivated(ADA, true, 4_500, OPERATOR);
    await admin.setDeactivated(ADA, false, 5_000, OPERATOR);
    await admin.setDeactivated(GRACE, true, 6_000, OPERATOR);
    expect([await typesOf(events, ADA), await typesOf(events, GRACE)]).toEqual([
      [
        ["account-reactivated", null, OPERATOR, true],
        ["account-deactivated", null, OPERATOR, true],
      ],
      [],
    ]);
  });
});

describe("fakeAuthD1 through a purge", () => {
  const PURGE_AT = 1 + AUTH_UNVERIFIED_USER_TTL_MS;

  it("deletes a stale unverified account with its sessions, and keeps a younger unverified one and a verified one", async () => {
    const client = createD1Client(
      fakeAuthD1([
        { id: ADA, email: "ada@example.com", emailVerifiedAt: null, createdAt: 1 },
        { id: GRACE, email: "grace@example.com", emailVerifiedAt: null, createdAt: 2 },
        { id: OPERATOR, email: "operator@example.com", createdAt: 1 },
      ]) as never,
    );
    const sessions = createAuthSessionStore(client, { idleTimeoutMs: null });
    const users = createUserStore(client);
    await sessions.create({ tokenHash: new Uint8Array(32).fill(7), userId: ADA, signedInAt: PURGE_AT, signedInWith: "email-otp" }, null);
    const purged = await purgeAuthEphemera(client, PURGE_AT);
    const found = await Promise.all(
      [ADA, GRACE, OPERATOR].map(async (id) => {
        const user = await users.findById(id);
        return user.ok && user.data !== null;
      }),
    );
    const session = await sessions.resolve(new Uint8Array(32).fill(7), PURGE_AT);
    expect({ purged, found, session }).toEqual({
      purged: ok({ deleted: { challenges: 0, nonces: 0, signIns: 0, users: 1, securityEvents: 0 }, complete: true, blocked: [] }),
      found: [false, true, true],
      session: ok(null),
    });
  });

  it("deletes the lapsed challenges, sessions and security events, the earliest first, and keeps a challenge still live", async () => {
    const signedIn = Date.now();
    const at = signedIn + AUTH_SECURITY_EVENT_TTL_MS;
    const client = createD1Client(fakeAuthD1(ACCOUNTS) as never);
    const challenges = createChallengeStore(client);
    const sessions = createAuthSessionStore(client, { idleTimeoutMs: null });
    await challenges.put("dead", { challenge: "c1", sessionId: "s1" }, 1);
    await challenges.put("live", { challenge: "c2", sessionId: "s2" }, (2 * AUTH_SECURITY_EVENT_TTL_MS) / 1000);
    await sessions.create({ tokenHash: new Uint8Array(32).fill(1), userId: ADA, signedInAt: signedIn, signedInWith: "email-otp" }, null);
    await sessions.create({ tokenHash: new Uint8Array(32).fill(2), userId: ADA, signedInAt: signedIn + 1, signedInWith: "email-otp" }, null);
    const purged = await purgeAuthEphemera(client, at);
    const live = await challenges.take("live");
    expect({ purged, live: live.ok && live.data }).toEqual({
      purged: ok({ deleted: { challenges: 1, nonces: 0, signIns: 2, users: 0, securityEvents: 1 }, complete: true, blocked: [] }),
      live: { challenge: "c2", sessionId: "s2" },
    });
  });
});
