import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { createAdminUserStore } from "../../src/auth/stores/admin-users";
import { createCredentialStore } from "../../src/auth/stores/credentials";
import { purgeAuthEphemera } from "../../src/auth/stores/ephemera";
import { createFactorStore } from "../../src/auth/stores/factors";
import { createRecoveryCodeStore } from "../../src/auth/stores/recovery-codes";
import { createUserStore } from "../../src/auth/stores/users";
import { createD1Client } from "../../src/storage/db/client";
import type { D1Client, SqlFragment } from "../../src/storage/db/types";
import { uuidv7 } from "../../src/storage/db/uuid";
import { explainPlan, openTestD1, type TestD1, usesIndex } from "../../src/testing/d1";

let root: string;
let db: TestD1;

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "forge-auth-indexes-"));
  mkdirSync(join(root, "migrations"));
  copyFileSync(new URL("../../src/auth/schema.sql", import.meta.url).pathname, join(root, "migrations", "0001_auth.sql"));
  db = await openTestD1({ root, migrations: "migrations" });
});

test.afterAll(async () => {
  await db?.dispose();
  rmSync(root, { recursive: true, force: true });
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
    title: "purgeAuthEphemera reaches expired challenges through auth_challenges_expires_at",
    run: (c) => purgeAuthEphemera(c, 1),
    at: 0,
    index: "auth_challenges_expires_at",
  },
  {
    title: "purgeAuthEphemera reaches expired nonces through auth_nonces_expires_at",
    run: (c) => purgeAuthEphemera(c, 1),
    at: 1,
    index: "auth_nonces_expires_at",
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
    run: (c) => createRecoveryCodeStore(c).consume(uuidv7(), uuidv7(), new Uint8Array(32), 1),
    at: 0,
    index: "auth_recovery_codes_user_hash",
  },
  {
    title: "adminUsers.claimFirstAdmin checks for an existing admin through auth_users_is_admin",
    run: (c) => createAdminUserStore(c).claimFirstAdmin(uuidv7(), 1),
    at: 0,
    index: "auth_users_is_admin",
  },
];

for (const { title, run, at, index } of lookups) {
  test(title, async () => {
    const fragment = (await preparedBy(db, run))[at];
    expect(fragment).toBeDefined();
    expect(usesIndex(await explainPlan(db, fragment as SqlFragment), index)).toBe(true);
  });
}
