import { expect, test } from "@playwright/test";

import { createTotpAppFactor } from "../../src/auth/factors/totp-app";
import { importAuthKeyRing } from "../../src/auth/keys/ring";
import { createAdminUserStore } from "../../src/auth/stores/admin-users";
import { createChallengeStore } from "../../src/auth/stores/challenges";
import { createCredentialStore } from "../../src/auth/stores/credentials";
import { purgeAuthEphemera } from "../../src/auth/stores/ephemera";
import { createSecurityEventStore } from "../../src/auth/stores/events";
import { createFactorStore, purgeStaleTotpSecrets } from "../../src/auth/stores/factors";
import { createRecoveryCodeStore } from "../../src/auth/stores/recovery-codes";
import { createAuthSessionStore } from "../../src/auth/stores/sessions";
import { createUserStore } from "../../src/auth/stores/users";
import type { AuthFactorKind, AuthSecurityEventType, AuthUserPage } from "../../src/auth/types";
import type { KeyRing } from "../../src/crypto/keyring/types";
import { base32Decode, hotpCode, totpCounter } from "../../src/crypto/primitives/mod";
import { createD1Client } from "../../src/storage/db/client";
import { uuidToBytes, uuidv7 } from "../../src/storage/db/uuid";
import type { TestD1 } from "../../src/testing/d1/mod";
import { insertSession, openAuthD1, securityEvents, sessionCount, signedUp, tokenHash } from "./auth-d1.fixture";

const AT = 2_000_000;
const ARRANGED_AT = AT - 1_000;
const SESSION = { signedInAt: ARRANGED_AT, expiresAt: AT + 1_000_000 };

let db: TestD1;
let stores: ReturnType<typeof storesOver>;

function storesOver(d1: TestD1) {
  const client = createD1Client(d1.binding);
  return {
    client,
    admin: createAdminUserStore(client),
    credentials: createCredentialStore(client),
    events: createSecurityEventStore(client),
    factors: createFactorStore(client),
    recovery: createRecoveryCodeStore(client),
    sessions: createAuthSessionStore(client),
    users: createUserStore(client),
  };
}

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.beforeAll(async () => {
  db = await openAuthD1();
  stores = storesOver(db);
});

test.afterAll(async () => {
  await db?.dispose();
});

test.beforeEach(() => db.reset());

function verifiedAccount(account: { isAdmin?: boolean } = {}): Promise<string> {
  return signedUp(db, ARRANGED_AT, { verifiedAt: ARRANGED_AT, ...account });
}

async function liveIds(userId: string): Promise<string[]> {
  const listed = await stores.sessions.listByUser(userId, AT);
  if (!listed.ok) throw listed.error;
  return listed.data.map((session) => session.id);
}

async function eventIds(userId: string, page?: AuthUserPage): Promise<string[]> {
  const listed = await stores.events.listByUser(userId, page);
  if (!listed.ok) throw listed.error;
  return listed.data.map((event) => event.id);
}

async function insertEvent(userId: string, id: string, at: number): Promise<void> {
  await db.binding
    .prepare("INSERT INTO auth_security_events (id, user_id, type, at) VALUES (?, ?, ?, ?)")
    .bind(uuidToBytes(id), uuidToBytes(userId), "signed-in", at)
    .run();
}

function setColumn(userId: string, column: "is_admin" | "deactivated_at", value: number): Promise<unknown> {
  return db.binding.prepare(`UPDATE auth_users SET ${column} = ? WHERE id = ?`).bind(value, uuidToBytes(userId)).run();
}

async function enrolled(userId: string, kind: AuthFactorKind, confirmedAt: number | null = null): Promise<string> {
  const factor = await stores.factors.enrol({ userId, kind, confirmedAt }, ARRANGED_AT);
  if (!factor.ok) throw factor.error;
  return factor.data.id;
}

async function passkey(userId: string): Promise<string> {
  const created = await stores.credentials.create(
    { userId, credentialId: `credential-${uuidv7()}`, publicKey: new Uint8Array(65), algorithm: -7, signCount: 0 },
    ARRANGED_AT,
    { keep: null },
  );
  if (!created.ok) throw created.error;
  return created.data.id;
}

async function stagedCodes(userId: string): Promise<{ factorId: string; hashes: Uint8Array<ArrayBuffer>[] }> {
  const factorId = await enrolled(userId, "recovery-code");
  const hashes = [tokenHash(), tokenHash()];
  const staged = await stores.recovery.stage(userId, hashes, ARRANGED_AT);
  if (!staged.ok) throw staged.error;
  return { factorId, hashes };
}

async function committedCodes(userId: string): Promise<{ factorId: string; hashes: Uint8Array<ArrayBuffer>[] }> {
  const codes = await stagedCodes(userId);
  const committed = await stores.recovery.commit(userId, codes.factorId, ARRANGED_AT, { keep: null });
  if (!committed.ok) throw committed.error;
  return codes;
}

interface Scene {
  owner: string;
  actor: string;
  keep: Uint8Array<ArrayBuffer>;
}

interface EventCase {
  title: string;
  /** Writes what the call needs before the owner's sessions exist, so arranging revokes none of them. */
  prepare: (owner: string) => Promise<(scene: Scene) => Promise<unknown>>;
  outcome: unknown;
  event: { type: AuthSecurityEventType; factorKind: AuthFactorKind | null; session: "keep" | null; admin: "actor" | "owner" | null } | null;
  /** Which of the owner's sessions survive; unset where the contract names none. */
  sessions?: "kept" | "all" | "none";
}

const cases: EventCase[] = [
  {
    title: "credentials.create records factor-added for a passkey and revokes the owner's other sessions",
    prepare: async () => async (scene) =>
      (
        await stores.credentials.create(
          { userId: scene.owner, credentialId: `credential-${uuidv7()}`, publicKey: new Uint8Array(65), algorithm: -7, signCount: 0 },
          AT,
          { keep: scene.keep },
        )
      ).ok,
    outcome: true,
    event: { type: "factor-added", factorKind: "passkey", session: "keep", admin: null },
    sessions: "kept",
  },
  {
    title: "credentials.removeForUser records factor-removed for a passkey and revokes the owner's other sessions",
    prepare: async (owner) => {
      const id = await passkey(owner);
      return (scene) => stores.credentials.removeForUser(id, scene.owner, AT, { keep: scene.keep }, []);
    },
    outcome: { ok: true, data: "changed" },
    event: { type: "factor-removed", factorKind: "passkey", session: "keep", admin: null },
    sessions: "kept",
  },
  {
    title: "factors.confirm records factor-added for the confirmed kind and revokes the owner's other sessions",
    prepare: async (owner) => {
      const id = await enrolled(owner, "totp-app");
      return (scene) => stores.factors.confirm(id, scene.owner, AT, { keep: scene.keep });
    },
    outcome: { ok: true, data: true },
    event: { type: "factor-added", factorKind: "totp-app", session: "keep", admin: null },
    sessions: "kept",
  },
  {
    title: "factors.confirm of a passkey row records nothing and revokes nothing, since its credential did both",
    prepare: async (owner) => {
      const id = await enrolled(owner, "passkey");
      return (scene) => stores.factors.confirm(id, scene.owner, AT, { keep: scene.keep });
    },
    outcome: { ok: true, data: true },
    event: null,
    sessions: "all",
  },
  {
    title: "factors.confirm of a factor already confirmed records nothing and revokes nothing",
    prepare: async (owner) => {
      const id = await enrolled(owner, "totp-app", ARRANGED_AT);
      return (scene) => stores.factors.confirm(id, scene.owner, AT, { keep: scene.keep });
    },
    outcome: { ok: true, data: false },
    event: null,
    sessions: "all",
  },
  {
    title: "factors.replaceSecret of a confirmed app records factor-replaced and revokes the owner's other sessions",
    prepare: async (owner) => {
      const id = await enrolled(owner, "totp-app", ARRANGED_AT);
      return (scene) => stores.factors.replaceSecret(id, scene.owner, new Uint8Array([5]), 77, AT, { keep: scene.keep });
    },
    outcome: { ok: true, data: true },
    event: { type: "factor-replaced", factorKind: "totp-app", session: "keep", admin: null },
    sessions: "kept",
  },
  {
    title: "factors.replaceSecret of an unconfirmed app records nothing and revokes nothing",
    prepare: async (owner) => {
      const id = await enrolled(owner, "totp-app");
      return (scene) => stores.factors.replaceSecret(id, scene.owner, new Uint8Array([5]), 77, AT, { keep: scene.keep });
    },
    outcome: { ok: true, data: false },
    event: null,
    sessions: "all",
  },
  {
    title: "factors.remove of a confirmed factor records factor-removed for its kind and revokes the owner's other sessions",
    prepare: async (owner) => {
      const id = await enrolled(owner, "totp-app", ARRANGED_AT);
      return (scene) => stores.factors.remove(id, scene.owner, AT, { keep: scene.keep }, []);
    },
    outcome: { ok: true, data: "changed" },
    event: { type: "factor-removed", factorKind: "totp-app", session: "keep", admin: null },
    sessions: "kept",
  },
  {
    title: "factors.remove of an unconfirmed factor deletes it but records nothing and revokes nothing",
    prepare: async (owner) => {
      const id = await enrolled(owner, "totp-app");
      return (scene) => stores.factors.remove(id, scene.owner, AT, { keep: scene.keep }, []);
    },
    outcome: { ok: true, data: "changed" },
    event: null,
    sessions: "all",
  },
  {
    title: "recoveryCodes.commit of a staged set records recovery-codes-issued and revokes the owner's other sessions",
    prepare: async (owner) => {
      const { factorId } = await stagedCodes(owner);
      return (scene) => stores.recovery.commit(scene.owner, factorId, AT, { keep: scene.keep });
    },
    outcome: { ok: true, data: true },
    event: { type: "recovery-codes-issued", factorKind: "recovery-code", session: "keep", admin: null },
    sessions: "kept",
  },
  {
    title: "recoveryCodes.commit with nothing staged records nothing and revokes nothing",
    prepare: async (owner) => {
      const factorId = await enrolled(owner, "recovery-code");
      return (scene) => stores.recovery.commit(scene.owner, factorId, AT, { keep: scene.keep });
    },
    outcome: { ok: true, data: false },
    event: null,
    sessions: "all",
  },
  {
    title: "recoveryCodes.consume of a live code records recovery-code-used and revokes the owner's other sessions",
    prepare: async (owner) => {
      const { factorId, hashes } = await committedCodes(owner);
      return (scene) => stores.recovery.consume(scene.owner, factorId, hashes[0] as Uint8Array<ArrayBuffer>, AT, { keep: scene.keep });
    },
    outcome: { ok: true, data: true },
    event: { type: "recovery-code-used", factorKind: "recovery-code", session: "keep", admin: null },
    sessions: "kept",
  },
  {
    title: "recoveryCodes.consume of a code the owner never held records nothing and revokes nothing",
    prepare: async (owner) => {
      const { factorId } = await committedCodes(owner);
      return (scene) => stores.recovery.consume(scene.owner, factorId, tokenHash(), AT, { keep: scene.keep });
    },
    outcome: { ok: true, data: false },
    event: null,
    sessions: "all",
  },
  {
    title: "users.changeEmail records email-changed naming no session and revokes every session",
    prepare: async () => (scene) => {
      const email = `${uuidv7()}@example.com`;
      return stores.users.changeEmail(scene.owner, email, email, AT);
    },
    outcome: { ok: true, data: true },
    event: { type: "email-changed", factorKind: null, session: null, admin: null },
    sessions: "none",
  },
  {
    title: "adminUsers.claimFirstAdmin records admin-granted by the claimant",
    prepare: async () => (scene) => stores.admin.claimFirstAdmin(scene.owner, AT),
    outcome: { ok: true, data: "changed" },
    event: { type: "admin-granted", factorKind: null, session: null, admin: "owner" },
    sessions: "all",
  },
  {
    title: "adminUsers.setAdmin granting records admin-granted by the acting administrator",
    prepare: async () => (scene) => stores.admin.setAdmin(scene.owner, true, AT, scene.actor),
    outcome: { ok: true, data: "changed" },
    event: { type: "admin-granted", factorKind: null, session: null, admin: "actor" },
    sessions: "all",
  },
  {
    title: "adminUsers.setAdmin revoking records admin-revoked by the acting administrator",
    prepare: async (owner) => {
      await setColumn(owner, "is_admin", 1);
      await verifiedAccount({ isAdmin: true });
      return (scene) => stores.admin.setAdmin(scene.owner, false, AT, scene.actor);
    },
    outcome: { ok: true, data: "changed" },
    event: { type: "admin-revoked", factorKind: null, session: null, admin: "actor" },
    sessions: "all",
  },
  {
    title: "adminUsers.setAdmin granting an administrator records nothing",
    prepare: async (owner) => {
      await setColumn(owner, "is_admin", 1);
      return (scene) => stores.admin.setAdmin(scene.owner, true, AT, scene.actor);
    },
    outcome: { ok: true, data: "unchanged" },
    event: null,
    sessions: "all",
  },
  {
    title: "adminUsers.setAdmin revoking from a non-administrator records nothing",
    prepare: async () => (scene) => stores.admin.setAdmin(scene.owner, false, AT, scene.actor),
    outcome: { ok: true, data: "unchanged" },
    event: null,
    sessions: "all",
  },
  {
    title: "adminUsers.setAdmin refusing to demote the last administrator records nothing",
    prepare: async (owner) => {
      await setColumn(owner, "is_admin", 1);
      return (scene) => stores.admin.setAdmin(scene.owner, false, AT, scene.actor);
    },
    outcome: { ok: true, data: "last-admin-demote" },
    event: null,
    sessions: "all",
  },
  {
    title: "adminUsers.setDeactivated(true) records account-deactivated by the acting administrator and revokes every session",
    prepare: async () => (scene) => stores.admin.setDeactivated(scene.owner, true, AT, scene.actor),
    outcome: { ok: true, data: "changed" },
    event: { type: "account-deactivated", factorKind: null, session: null, admin: "actor" },
    sessions: "none",
  },
  {
    title: "adminUsers.setDeactivated(true) of a deactivated account records nothing",
    prepare: async (owner) => {
      await setColumn(owner, "deactivated_at", ARRANGED_AT);
      return (scene) => stores.admin.setDeactivated(scene.owner, true, AT, scene.actor);
    },
    outcome: { ok: true, data: "unchanged" },
    event: null,
  },
  {
    title: "adminUsers.setDeactivated(false) records account-reactivated by the acting administrator",
    prepare: async (owner) => {
      await setColumn(owner, "deactivated_at", ARRANGED_AT);
      return (scene) => stores.admin.setDeactivated(scene.owner, false, AT, scene.actor);
    },
    outcome: { ok: true, data: "changed" },
    event: { type: "account-reactivated", factorKind: null, session: null, admin: "actor" },
    sessions: "all",
  },
  {
    title: "adminUsers.setDeactivated(false) of an active account records nothing",
    prepare: async () => (scene) => stores.admin.setDeactivated(scene.owner, false, AT, scene.actor),
    outcome: { ok: true, data: "unchanged" },
    event: null,
    sessions: "all",
  },
  {
    title: "adminUsers.resetFactors records factors-reset by the acting administrator and revokes every session",
    prepare: async () => (scene) => stores.admin.resetFactors(scene.owner, AT, scene.actor),
    outcome: { ok: true, data: "changed" },
    event: { type: "factors-reset", factorKind: null, session: null, admin: "actor" },
    sessions: "none",
  },
];

for (const { title, prepare, outcome, event, sessions } of cases) {
  test(title, async () => {
    const owner = await verifiedAccount();
    const bystander = await verifiedAccount();
    const actor = uuidv7();
    const act = await prepare(owner);
    const keep = tokenHash();
    const [keepId, firstId, secondId] = [uuidv7(), uuidv7(), uuidv7()];
    await insertSession(db, { tokenHash: keep, userId: owner, id: keepId, ...SESSION });
    await insertSession(db, { tokenHash: tokenHash(), userId: owner, id: firstId, ...SESSION });
    await insertSession(db, { tokenHash: tokenHash(), userId: owner, id: secondId, ...SESSION });
    await insertSession(db, { tokenHash: tokenHash(), userId: bystander, ...SESSION });
    const before = await securityEvents(db, owner);

    expect(await act({ owner, actor, keep })).toEqual(outcome);
    const admins = { actor, owner };
    const landed =
      event === null
        ? []
        : [
            {
              userId: owner,
              type: event.type,
              factorKind: event.factorKind,
              sessionId: event.session === null ? null : keepId,
              adminId: event.admin === null ? null : admins[event.admin],
              at: AT,
            },
          ];
    expect(await securityEvents(db, owner)).toEqual([...landed, ...before]);
    if (sessions !== undefined) {
      const survivors = { kept: [keepId], all: [keepId, firstId, secondId], none: [] }[sessions];
      expect((await liveIds(owner)).sort()).toEqual(survivors.sort());
    }
    expect(await sessionCount(db, bystander)).toBe(1);
  });
}

test("sessions.create records signed-in with the factor signed in with, naming the new session", async () => {
  const owner = await verifiedAccount();
  const created = await stores.sessions.create({ tokenHash: tokenHash(), userId: owner, signedInAt: AT, signedInWith: "passkey" }, null);
  expect(created.ok).toBe(true);
  const [sessionId] = await liveIds(owner);
  expect(await securityEvents(db, owner)).toEqual([{ userId: owner, type: "signed-in", factorKind: "passkey", sessionId, adminId: null, at: AT }]);
});

test.describe("claimFirstAdmin with a rotation", () => {
  test("on a deployment with no administrator grants, records admin-granted naming the session, and rotates it", async () => {
    const owner = await verifiedAccount();
    const replaces = tokenHash();
    const sessionId = uuidv7();
    await insertSession(db, { tokenHash: replaces, userId: owner, id: sessionId, ...SESSION });
    const rotated = tokenHash();
    expect(await stores.admin.claimFirstAdmin(owner, AT, { replaces, tokenHash: rotated })).toEqual({ ok: true, data: "changed" });
    expect(await securityEvents(db, owner)).toEqual([
      { userId: owner, type: "admin-granted", factorKind: null, sessionId, adminId: owner, at: AT },
    ]);
    expect(await stores.sessions.resolve(replaces, AT)).toEqual({ ok: true, data: null });
    const resolved = await stores.sessions.resolve(rotated, AT);
    expect(resolved.ok && [resolved.data?.session.id, resolved.data?.user.isAdmin]).toEqual([sessionId, true]);
  });

  test("once an administrator exists is refused, records nothing and leaves the claimant's session on its old token", async () => {
    const first = await verifiedAccount();
    expect(await stores.admin.claimFirstAdmin(first, AT)).toEqual({ ok: true, data: "changed" });
    const second = await verifiedAccount();
    const replaces = tokenHash();
    await insertSession(db, { tokenHash: replaces, userId: second, id: uuidv7(), ...SESSION });
    const rotated = tokenHash();
    expect(await stores.admin.claimFirstAdmin(second, AT, { replaces, tokenHash: rotated })).toEqual({ ok: true, data: "admin-exists" });
    expect(await securityEvents(db, second)).toEqual([]);
    expect(await stores.sessions.resolve(rotated, AT)).toEqual({ ok: true, data: null });
    const kept = await stores.sessions.resolve(replaces, AT);
    expect(kept.ok && [kept.data?.user.id, kept.data?.user.isAdmin]).toEqual([second, false]);
  });
});

test.describe("a mid-batch failure", () => {
  test("in a statement after the event rolls the event back with the mutation it records", async () => {
    const owner = await verifiedAccount();
    await insertSession(db, { tokenHash: tokenHash(), userId: owner, id: uuidv7(), ...SESSION });
    const before = await stores.users.findById(owner);
    await db.binding
      .prepare("CREATE TRIGGER auth_sessions_refuse_delete BEFORE DELETE ON auth_sessions BEGIN SELECT RAISE(ABORT, 'refused by the test'); END")
      .run();
    const email = `${uuidv7()}@example.com`;
    expect((await stores.users.changeEmail(owner, email, email, AT)).ok).toBe(false);
    expect(await stores.users.findById(owner)).toEqual(before);
    expect(await securityEvents(db, owner)).toEqual([]);
    expect(await sessionCount(db, owner)).toBe(1);
  });

  test("in the event insert itself rolls back the mutation it records", async () => {
    const owner = await verifiedAccount();
    await db.binding
      .prepare(
        "CREATE TRIGGER auth_security_events_refuse BEFORE INSERT ON auth_security_events BEGIN SELECT RAISE(ABORT, 'refused by the test'); END",
      )
      .run();
    expect((await stores.admin.setAdmin(owner, true, AT, uuidv7())).ok).toBe(false);
    const found = await stores.users.findById(owner);
    expect(found.ok && found.data?.isAdmin).toBe(false);
  });
});

test("auth_security_events holds exactly the seven columns the schema declares", async () => {
  expect(await db.rows("SELECT name FROM pragma_table_info('auth_security_events') ORDER BY cid")).toEqual(
    ["id", "user_id", "type", "factor_kind", "session_id", "admin_id", "at"].map((name) => ({ name })),
  );
});

test("the purge deletes an event at its lifetime's end and keeps one a millisecond younger", async () => {
  const securityEventTtlMs = 3_456_000_000;
  const purgeAt = 4_000_000_000;
  const owner = await verifiedAccount();
  const [expired, young] = [uuidv7(), uuidv7()];
  await insertEvent(owner, expired, purgeAt - securityEventTtlMs);
  await insertEvent(owner, young, purgeAt - securityEventTtlMs + 1);
  expect((await purgeAuthEphemera(stores.client, purgeAt, { securityEventTtlMs })).ok).toBe(true);
  expect(await eventIds(owner)).toEqual([young]);
});

test("adminUsers.remove deletes the account's events and leaves another account's", async () => {
  const owner = await verifiedAccount();
  const other = await verifiedAccount();
  await insertEvent(owner, uuidv7(), AT);
  await insertEvent(owner, uuidv7(), AT);
  const kept = uuidv7();
  await insertEvent(other, kept, AT);
  expect(await stores.admin.remove(owner)).toEqual({ ok: true, data: "changed" });
  expect(await db.binding.prepare("SELECT count(*) AS n FROM auth_security_events WHERE user_id = ?").bind(uuidToBytes(owner)).first()).toEqual({
    n: 0,
  });
  expect(await eventIds(other)).toEqual([kept]);
});

async function recoveryCodeCount(userId: string): Promise<number> {
  const row = await db.binding
    .prepare("SELECT count(*) AS n FROM auth_recovery_codes WHERE user_id = ?")
    .bind(uuidToBytes(userId))
    .first<{ n: number }>();
  return row?.n ?? -1;
}

/** The confirmed recoverable kinds `userId` holds, whether a recovery-code factor row is left, and how many codes. */
async function recoveryHeld(userId: string) {
  const kinds = await stores.factors.listConfirmedKinds(userId, ["passkey", "totp-app"]);
  const recoveryFactor = await stores.factors.find(userId, "recovery-code");
  return {
    kinds: kinds.ok ? [...kinds.data].sort() : kinds.error,
    recoveryFactor: recoveryFactor.ok ? recoveryFactor.data !== null : recoveryFactor.error,
    codes: await recoveryCodeCount(userId),
  };
}

test.describe("credentials.removeForUser on the passkey factor and the recovery codes", () => {
  /** Enrols a confirmed passkey with `credentials` credentials and committed recovery codes, removes one credential, and reads what is left. */
  async function afterRemovingOne(credentials: number, alsoTotp: boolean) {
    const owner = await verifiedAccount();
    await enrolled(owner, "passkey", ARRANGED_AT);
    if (alsoTotp) await enrolled(owner, "totp-app", ARRANGED_AT);
    const ids: string[] = [];
    for (let i = 0; i < credentials; i++) ids.push(await passkey(owner));
    await committedCodes(owner);
    expect(await stores.credentials.removeForUser(ids[0] as string, owner, AT, { keep: null }, [])).toEqual({ ok: true, data: "changed" });
    return recoveryHeld(owner);
  }

  const removals = [
    {
      title: "removing the last passkey drops the passkey factor, the recovery-code factor and every recovery code",
      credentials: 1,
      alsoTotp: false,
      expected: { kinds: [], recoveryFactor: false, codes: 0 },
    },
    {
      title: "removing one passkey while another remains keeps the passkey factor and the recovery codes",
      credentials: 2,
      alsoTotp: false,
      expected: { kinds: ["passkey"], recoveryFactor: true, codes: 2 },
    },
    {
      title: "removing the last passkey beside a confirmed authenticator app drops the passkey factor and keeps the recovery codes",
      credentials: 1,
      alsoTotp: true,
      expected: { kinds: ["totp-app"], recoveryFactor: true, codes: 2 },
    },
  ];

  for (const { title, credentials, alsoTotp, expected } of removals) {
    test(title, async () => {
      expect(await afterRemovingOne(credentials, alsoTotp)).toEqual(expected);
    });
  }

  test("another user naming the holder's only passkey leaves the holder's passkey factor and recovery codes in place", async () => {
    const holder = await verifiedAccount();
    await enrolled(holder, "passkey", ARRANGED_AT);
    const credential = await passkey(holder);
    await committedCodes(holder);
    const intruder = await verifiedAccount();
    expect(await stores.credentials.removeForUser(credential, intruder, AT, { keep: null }, [])).toEqual({ ok: true, data: "not-found" });
    const kinds = await stores.factors.listConfirmedKinds(holder, ["passkey", "totp-app"]);
    expect({ kinds: kinds.ok ? kinds.data : kinds.error, codes: await recoveryCodeCount(holder) }).toEqual({ kinds: ["passkey"], codes: 2 });
  });
});

test.describe("recoveryCodes.stage against D1's bound-parameter limit", () => {
  /** The owner's staged codes as hex, sorted, with the columns a staged row must carry. */
  async function stagedRows(userId: string) {
    const listed = await db.binding
      .prepare("SELECT hex(code_hash) AS hash, staged, used_at, created_at FROM auth_recovery_codes WHERE user_id = ? ORDER BY hash")
      .bind(uuidToBytes(userId))
      .all<{ hash: string; staged: number; used_at: number | null; created_at: number }>();
    return listed.results;
  }

  const asRows = (hashes: Uint8Array<ArrayBuffer>[]) =>
    hashes
      .map((hash) => Array.from(hash, (byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(""))
      .sort()
      .map((hash) => ({ hash, staged: 1, used_at: null, created_at: AT }));

  test("stages 21 codes, more than one insert can bind, and reads every one back staged", async () => {
    const owner = await verifiedAccount();
    const hashes = Array.from({ length: 21 }, () => tokenHash());
    expect(await stores.recovery.stage(owner, hashes, AT)).toEqual({ ok: true, data: undefined });
    expect(await stagedRows(owner)).toEqual(asRows(hashes));
  });

  test("stages no codes, clearing the set staged before it and inserting nothing", async () => {
    const owner = await verifiedAccount();
    await stagedCodes(owner);
    expect(await stores.recovery.stage(owner, [], AT)).toEqual({ ok: true, data: undefined });
    expect(await stagedRows(owner)).toEqual([]);
  });
});

test("listByUser answers the account's events newest first, and a cursor pages past the ones already read", async () => {
  const owner = await verifiedAccount();
  const other = await verifiedAccount();
  const [oldest, middle, newest] = [uuidv7(), uuidv7(), uuidv7()];
  for (const id of [oldest, middle, newest]) await insertEvent(owner, id, AT);
  await insertEvent(other, uuidv7(), AT);
  expect(await eventIds(owner)).toEqual([newest, middle, oldest]);
  expect(await eventIds(owner, { after: newest })).toEqual([middle, oldest]);
  expect(await eventIds(owner, { after: middle, limit: 1 })).toEqual([oldest]);
});

test.describe("replacing an authenticator app's secret", () => {
  const ROOT_OLD = "2c83943e16eb5c3741d74260b4751de91afeab397689cfd139f7263b21aec037";
  const ROOT_NEW = "9d1f4b6a0c27e8531fa4d90b6e2c7148ab35f0d962741ec8530b9af62d418c75";
  const STEP = 30_000;
  const DAY = 86_400_000;
  const FLOOR = ["totp-app", "passkey"] as const;
  let ring: KeyRing;
  /** The same key demoted behind a newer one, as a rotation leaves it. */
  let rotated: KeyRing;

  test.beforeAll(async () => {
    ring = await importAuthKeyRing([ROOT_OLD]);
    rotated = await importAuthKeyRing([ROOT_NEW, ROOT_OLD]);
  });

  const factorOver = (keys: KeyRing = ring) =>
    createTotpAppFactor({ keys, factors: stores.factors, challenges: createChallengeStore(stores.client), issuer: "Forge", account: () => "a" });
  const codeAt = (secret: Uint8Array<ArrayBuffer>, at: number) => hotpCode(secret, totpCounter(Math.floor(at / 1000), { period: 30 }));
  const secretOf = (challenge: { options?: Readonly<Record<string, unknown>> }) => base32Decode((challenge.options as { secret: string }).secret);

  /** A confirmed app enrolled at `at` under `keys`, before any session exists, so its confirmation revokes none the test counts. */
  async function enrolledApp(owner: string, keys: KeyRing = ring, at = AT): Promise<Uint8Array<ArrayBuffer>> {
    const factor = factorOver(keys);
    const begun = await factor.beginEnrolment(owner, at);
    if (!begun.ok) throw new Error(begun.error);
    const secret = secretOf(begun.data);
    const confirmed = await factor.completeEnrolment(owner, await codeAt(secret, at), at, { binding: null, keep: null });
    if (!confirmed.ok) throw new Error(confirmed.error);
    return secret;
  }

  async function replacement(owner: string, keep: Uint8Array<ArrayBuffer>, at: number, keys: KeyRing = ring): Promise<Uint8Array<ArrayBuffer>> {
    const begun = await factorOver(keys).beginReplacement(owner, at, { binding: null, keep });
    if (!begun.ok) throw new Error(begun.error);
    return secretOf(begun.data);
  }

  const verifies = async (owner: string, secret: Uint8Array<ArrayBuffer>, at: number) =>
    (await factorOver().verifyChallenge(owner, await codeAt(secret, at), at, { binding: null, keep: null })).ok;

  test("a commit batch failing mid-way leaves the old secret, writes no event, keeps every session and keeps the pending one", async () => {
    const owner = await verifiedAccount();
    const live = await enrolledApp(owner);
    const keep = tokenHash();
    await insertSession(db, { tokenHash: keep, userId: owner, id: uuidv7(), ...SESSION });
    await insertSession(db, { tokenHash: tokenHash(), userId: owner, id: uuidv7(), ...SESSION });
    const next = await replacement(owner, keep, AT + STEP);
    const before = await securityEvents(db, owner);
    await db.binding
      .prepare("CREATE TRIGGER auth_sessions_refuse_delete BEFORE DELETE ON auth_sessions BEGIN SELECT RAISE(ABORT, 'refused by the test'); END")
      .run();
    const failed = await factorOver().completeReplacement(owner, await codeAt(next, AT + STEP), AT + STEP, { binding: null, keep });
    await db.binding.prepare("DROP TRIGGER auth_sessions_refuse_delete").run();

    expect({
      failed,
      events: await securityEvents(db, owner),
      sessions: await sessionCount(db, owner),
      old: await verifies(owner, live, AT + 2 * STEP),
    }).toEqual({ failed: { ok: false, error: "unavailable" }, events: before, sessions: 2, old: true });
    const retried = await factorOver().completeReplacement(owner, await codeAt(next, AT + 3 * STEP), AT + 3 * STEP, { binding: null, keep });
    expect(retried.ok).toBe(true);
  });

  test("an abandoned replacement leaves the old secret verifying, and its pending secret lapses", async () => {
    const owner = await verifiedAccount();
    const live = await enrolledApp(owner);
    const keep = tokenHash();
    const beganAt = Date.now();
    const next = await replacement(owner, keep, AT + STEP);
    const pending = await db.rows<{ expires_at: number }>("SELECT expires_at FROM auth_challenges WHERE key LIKE '%totp-replace:%'");
    expect(await verifies(owner, live, AT + 2 * STEP)).toBe(true);
    expect(pending).toHaveLength(1);
    const expiresAt = pending[0]?.expires_at ?? 0;
    expect(expiresAt > beganAt && expiresAt <= Date.now() + 15 * 60_000).toBe(true);

    const lapsedAt = AT + STEP + 15 * 60_000;
    const lapsed = await factorOver().completeReplacement(owner, await codeAt(next, lapsedAt), lapsedAt, { binding: null, keep });
    expect(lapsed).toEqual({ ok: false, error: "expired" });
    expect(await verifies(owner, live, lapsedAt + STEP)).toBe(true);
  });

  /** Runs both writes together, issuing `replace` first or second, and answers them as `[replace, remove]` either way. */
  async function raced<A, B>(replace: () => Promise<A>, remove: () => Promise<B>, replaceFirst: boolean): Promise<[A, B]> {
    if (replaceFirst) return Promise.all([replace(), remove()]);
    const [removed, replaced] = await Promise.all([remove(), replace()]);
    return [replaced, removed];
  }

  for (const replaceFirst of [true, false]) {
    test(`a replacement racing a removal at the minimum keeps the row with the new secret and one event (replace issued ${replaceFirst ? "first" : "second"})`, async () => {
      const owner = await verifiedAccount();
      const id = await enrolled(owner, "totp-app", ARRANGED_AT);
      const secret = new Uint8Array([5, 5, 5]);
      const [replaced, removed] = await raced(
        () => stores.factors.replaceSecret(id, owner, secret, 77, AT, { keep: null }),
        () => stores.factors.remove(id, owner, AT, { keep: null }, FLOOR),
        replaceFirst,
      );
      const row = await stores.factors.find(owner, "totp-app");
      expect({
        replaced,
        removed,
        secret: row.ok ? [...(row.data?.secret ?? [])] : null,
        events: (await securityEvents(db, owner)).map((event) => event.type),
      }).toEqual({
        replaced: { ok: true, data: true },
        removed: { ok: true, data: "second-factor-required" },
        secret: [5, 5, 5],
        events: ["factor-replaced"],
      });
    });

    test(`a replacement racing a removal under \`optional\` loses the row, and records its event only where it landed (replace issued ${replaceFirst ? "first" : "second"})`, async () => {
      const owner = await verifiedAccount();
      const id = await enrolled(owner, "totp-app", ARRANGED_AT);
      const [replaced, removed] = await raced(
        () => stores.factors.replaceSecret(id, owner, new Uint8Array([5]), 77, AT, { keep: null }),
        () => stores.factors.remove(id, owner, AT, { keep: null }, []),
        replaceFirst,
      );
      const types = (await securityEvents(db, owner)).map((event) => event.type).sort();
      const landed = replaced.ok && replaced.data;
      expect({ removed, row: await stores.factors.find(owner, "totp-app"), types }).toEqual({
        removed: { ok: true, data: "changed" },
        row: { ok: true, data: null },
        types: landed ? ["factor-removed", "factor-replaced"] : ["factor-removed"],
      });
    });

    test(`a verification under the old frame racing a replacement never leaves the old secret (replace issued ${replaceFirst ? "first" : "second"})`, async () => {
      const owner = await verifiedAccount();
      const old = new Uint8Array([1, 1, 1]);
      const created = await stores.factors.enrol({ userId: owner, kind: "totp-app", secret: old, confirmedAt: ARRANGED_AT }, ARRANGED_AT);
      if (!created.ok) throw created.error;
      const fresh = new Uint8Array([2, 2, 2]);
      await raced(
        () => stores.factors.replaceSecret(created.data.id, owner, fresh, 70, AT, { keep: null }),
        () => stores.factors.recordVerification(created.data.id, owner, 71, AT, old, new Uint8Array([3, 3, 3])),
        replaceFirst,
      );
      const row = await stores.factors.find(owner, "totp-app");
      expect(row.ok ? [...(row.data?.secret ?? [])] : null).toEqual([2, 2, 2]);
    });
  }

  test("a TOTP-only user the purge keeps on a retiring key leaves its kept count by replacing", async () => {
    const owner = await verifiedAccount();
    await enrolledApp(owner, ring, AT);
    const purge = (at: number) =>
      purgeStaleTotpSecrets(stores.client, at, { keys: rotated, idleForMs: DAY, factors: { offered: FLOOR, mandatory: ["totp-app"] } });
    const before = await purge(AT + 2 * DAY);

    const replacedAt = AT + 2 * DAY;
    const keep = tokenHash();
    const next = await replacement(owner, keep, replacedAt, rotated);
    const replaced = await factorOver(rotated).completeReplacement(owner, await codeAt(next, replacedAt), replacedAt, { binding: null, keep });
    // Idle again by the second run, so only the key it is sealed under can be what spares it.
    const after = await purge(replacedAt + 2 * DAY);
    const row = await stores.factors.find(owner, "totp-app");
    expect({ before, replaced: replaced.ok, after, held: row.ok && row.data !== null }).toEqual({
      before: { ok: true, data: { purged: 0, kept: 1 } },
      replaced: true,
      after: { ok: true, data: { purged: 0, kept: 0 } },
      held: true,
    });
  });
});
