import { expect, test } from "@playwright/test";

import { createAdminUserStore } from "../../src/auth/stores/admin-users";
import { createCredentialStore } from "../../src/auth/stores/credentials";
import { purgeAuthEphemera } from "../../src/auth/stores/ephemera";
import { createSecurityEventStore } from "../../src/auth/stores/events";
import { createFactorStore } from "../../src/auth/stores/factors";
import { createRecoveryCodeStore } from "../../src/auth/stores/recovery-codes";
import { createAuthSessionStore } from "../../src/auth/stores/sessions";
import { createUserStore } from "../../src/auth/stores/users";
import { createD1Client } from "../../src/storage/db/client";
import type { D1Client, SqlFragment } from "../../src/storage/db/types";
import { uuidv7 } from "../../src/storage/db/uuid";
import { explainPlan, scansTable, type TestD1, usesIndex } from "../../src/testing/d1/mod";
import { openAuthD1 } from "./auth-d1.fixture";

let db: TestD1;

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.beforeAll(async () => {
  db = await openAuthD1();
});

test.afterAll(async () => {
  await db?.dispose();
});

function recordingClient(inner: D1Client): { client: D1Client; fragments: SqlFragment[] } {
  const fragments: SqlFragment[] = [];
  const client: D1Client = {
    batch(batch, options) {
      fragments.push(...batch);
      return inner.batch(batch, options);
    },
    execute(fragment, options) {
      fragments.push(fragment);
      return inner.execute(fragment, options);
    },
    query(fragment) {
      fragments.push(fragment);
      return inner.query(fragment);
    },
    queryOne(fragment) {
      fragments.push(fragment);
      return inner.queryOne(fragment);
    },
  };
  return { client, fragments };
}

async function preparedBy(d1: TestD1, run: (client: D1Client) => Promise<unknown>): Promise<SqlFragment[]> {
  const { client, fragments } = recordingClient(createD1Client(d1.binding));
  await run(client);
  return fragments;
}

const lookups: { title: string; run: (client: D1Client) => Promise<unknown>; at: number; index: string }[] = [
  {
    title: "users.findByEmailKey reaches its row through auth_users_email_key",
    run: (c) => createUserStore(c).findByEmailKey("ada@example.com"),
    at: 0,
    index: "auth_users_email_key",
  },
  {
    title: "users.findById reaches its row through sqlite_autoindex_auth_users_1",
    run: (c) => createUserStore(c).findById(uuidv7()),
    at: 0,
    index: "sqlite_autoindex_auth_users_1",
  },
  {
    title: "adminUsers.findById reaches its row through sqlite_autoindex_auth_users_1",
    run: (c) => createAdminUserStore(c).findById(uuidv7()),
    at: 0,
    index: "sqlite_autoindex_auth_users_1",
  },
  {
    title: "adminUsers.search reaches its rows through auth_users_email_key",
    run: (c) => createAdminUserStore(c).search("ada"),
    at: 0,
    index: "auth_users_email_key",
  },
  {
    title: "adminUsers.search under a cursor reaches its rows through auth_users_email_key",
    run: (c) => createAdminUserStore(c).search("ada", { after: uuidv7() }),
    at: 0,
    index: "auth_users_email_key",
  },
  {
    title: "factors.find reaches its row through auth_factors_user_kind",
    run: (c) => createFactorStore(c).find(uuidv7(), "totp-app"),
    at: 0,
    index: "auth_factors_user_kind",
  },
  {
    title: "factors.listConfirmedKinds reaches the owner's rows through auth_factors_user_kind",
    run: (c) => createFactorStore(c).listConfirmedKinds(uuidv7(), ["totp-app", "passkey"]),
    at: 0,
    index: "auth_factors_user_kind",
  },
  {
    title: "sessions.listByUser reaches the owner's rows through auth_sessions_user_id",
    run: (c) => createAuthSessionStore(c).listByUser(uuidv7(), 1),
    at: 0,
    index: "auth_sessions_user_id",
  },
  {
    title: "securityEvents.listByUser reaches the account's rows through auth_security_events_user_id",
    run: (c) => createSecurityEventStore(c).listByUser(uuidv7()),
    at: 0,
    index: "auth_security_events_user_id",
  },
  {
    title: "securityEvents.listByUser under a cursor reaches the account's rows through auth_security_events_user_id",
    run: (c) => createSecurityEventStore(c).listByUser(uuidv7(), { after: uuidv7() }),
    at: 0,
    index: "auth_security_events_user_id",
  },
  {
    title: "sessions.resolve reaches its row through sqlite_autoindex_auth_sessions_1",
    run: (c) => createAuthSessionStore(c).resolve(new Uint8Array(32), 1),
    at: 0,
    index: "sqlite_autoindex_auth_sessions_1",
  },
  {
    title: "sessions.revokeOthers reaches the owner's rows through auth_sessions_user_id",
    run: (c) => createAuthSessionStore(c).revokeOthers(uuidv7(), 1, { keep: new Uint8Array(32) }),
    at: 0,
    index: "auth_sessions_user_id",
  },
  {
    title: "users.findByWebAuthnId reaches its row through auth_users_webauthn_id",
    run: (c) => createUserStore(c).findByWebAuthnId(new Uint8Array(16)),
    at: 0,
    index: "auth_users_webauthn_id",
  },
  {
    title: "credentials.findByCredentialId reaches its row through auth_credentials_credential_id",
    run: (c) => createCredentialStore(c).findByCredentialId("credential-id"),
    at: 0,
    index: "auth_credentials_credential_id",
  },
  {
    title: "recoveryCodes.consume reaches the code through auth_recovery_codes_user_hash",
    run: (c) => createRecoveryCodeStore(c).consume(uuidv7(), uuidv7(), new Uint8Array(32), 1, { keep: null }),
    at: 0,
    index: "auth_recovery_codes_user_hash",
  },
  {
    title: "adminUsers.claimFirstAdmin checks for an existing admin through auth_users_active_admin",
    run: (c) => createAdminUserStore(c).claimFirstAdmin(uuidv7(), 1),
    at: 0,
    index: "auth_users_active_admin",
  },
  {
    title: "adminUsers.countAdmins counts the active admins through auth_users_active_admin",
    run: (c) => createAdminUserStore(c).countAdmins(),
    at: 0,
    index: "auth_users_active_admin",
  },
  {
    title: "adminUsers.setAdmin's demotion counts the remaining admins through auth_users_active_admin",
    run: (c) => createAdminUserStore(c).setAdmin(uuidv7(), false, 1, uuidv7()),
    at: 0,
    index: "auth_users_active_admin",
  },
  {
    title: "adminUsers.setDeactivated counts the remaining admins through auth_users_active_admin",
    run: (c) => createAdminUserStore(c).setDeactivated(uuidv7(), true, 1, uuidv7()),
    at: 0,
    index: "auth_users_active_admin",
  },
  {
    title: "adminUsers.remove's guarded delete counts the remaining admins through auth_users_active_admin",
    run: (c) => createAdminUserStore(c).remove(uuidv7()),
    at: 1,
    index: "auth_users_active_admin",
  },
];

for (const { title, run, at, index } of lookups) {
  test(title, async () => {
    const fragment = (await preparedBy(db, run))[at] as SqlFragment;
    expect(fragment).toBeDefined();
    expect(usesIndex(await explainPlan(db, fragment.text, fragment.params), index)).toBe(true);
  });
}

const purges: { title: string; table: string; index: string }[] = [
  { title: "expired challenges", table: "auth_challenges", index: "auth_challenges_expires_at" },
  { title: "expired nonces", table: "auth_nonces", index: "auth_nonces_expires_at" },
  { title: "expired sessions", table: "auth_sessions", index: "auth_sessions_expires_at" },
  { title: "lapsed unverified accounts", table: "auth_users", index: "auth_users_unverified_created_at" },
  { title: "lapsed security events", table: "auth_security_events", index: "auth_security_events_at" },
];

for (const { title, table, index } of purges) {
  test(`purgeAuthEphemera reaches ${title} through ${index} and never scans ${table}`, async () => {
    const fragment = (await preparedBy(db, (c) => purgeAuthEphemera(c, 1))).find((prepared) =>
      prepared.text.startsWith(`DELETE FROM ${table} `),
    ) as SqlFragment;
    expect(fragment).toBeDefined();
    const plan = await explainPlan(db, fragment.text, fragment.params);
    expect(usesIndex(plan, index)).toBe(true);
    expect(scansTable(plan, table)).toBe(false);
  });
}
