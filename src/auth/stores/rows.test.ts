import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

import { createD1Client } from "../../storage/db/client";
import type { D1Client, D1Database } from "../../storage/db/types";
import { uuidToBytes, uuidv7 } from "../../storage/db/uuid";
import { nullLogger } from "../../testing/context";
import { fakeD1 } from "../../testing/fakes";
import type { FakeD1Options } from "../../testing/types";
import { AuthStoreError } from "../errors";
import { createAccessTokenStore } from "./access-tokens";
import { createAdminUserStore } from "./admin-users";
import { createChallengeStore } from "./challenges";
import { createCredentialStore } from "./credentials";
import { purgeAuthEphemera } from "./ephemera";
import { createSecurityEventStore } from "./events";
import { createFactorStore } from "./factors";
import { createIdentityLinkStore } from "./identity-links";
import { createNonceStore } from "./nonces";
import { createOtpStateStore } from "./otp-state";
import { createRecoveryCodeStore } from "./recovery-codes";
import { blobBytes, isAppKeyDeleteRefusal, MAX_PAGE_LIMIT, storeError } from "./rows";
import { createAuthSessionStore } from "./sessions";
import { createUserStore } from "./users";

const USER_ID = uuidv7();
const OTHER_ID = uuidv7();
const ORIGIN = { keep: new Uint8Array(32) };
/** A sealed secret as a factor row holds it — the frame a verification opened, or the one a replacement writes. */
const FRAME = new Uint8Array([9, 8, 7]);

type FakeDb = ReturnType<typeof fakeD1>;

function clientOf(rows: (sql: string, params: unknown[]) => unknown[] = () => [], options?: FakeD1Options): [D1Client, FakeDb] {
  const db = fakeD1(rows, options);
  return [createD1Client(db as unknown as D1Database, { logger: nullLogger }), db];
}

function writerOf(
  rowsWritten: (sql: string, params: unknown[]) => number,
  rows?: (sql: string, params: unknown[]) => unknown[],
): [D1Client, FakeDb] {
  return clientOf(rows, { rowsWritten });
}

describe("blobBytes", () => {
  it("reads bytes, an ArrayBuffer and a number array as the same bytes", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    for (const shape of [bytes, bytes.buffer, [1, 2, 3]]) expect(blobBytes(shape)).toEqual(bytes);
  });

  it("refuses any other shape rather than reading it as empty bytes", () => {
    expect(() => blobBytes("010203")).toThrow(TypeError);
  });
});

describe("storeError", () => {
  it("names the index a unique-constraint failure violated, stopping at the second colon", () => {
    const error = storeError("users.create", new Error("UNIQUE constraint failed: auth_users.email_key: SQLITE_CONSTRAINT (extended: X)"));
    expect([error.code, error.operation, error.constraint]).toEqual(["conflict", "users.create", "auth_users.email_key"]);
  });

  it("reports a CHECK failure as invalid, not as unavailable", () => {
    const cause = new Error("D1_ERROR: CHECK constraint failed: auth_users: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_CHECK)");
    const error = storeError("users.create", cause);
    expect([error.code, error.operation, error.constraint, error.cause]).toEqual(["invalid", "users.create", undefined, cause]);
  });

  it("reports a foreign-key refusal as reference, not as unavailable", () => {
    const cause = new Error("D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)");
    const error = storeError("adminUsers.remove", cause);
    expect([error.code, error.operation, error.constraint, error.cause]).toEqual(["reference", "adminUsers.remove", undefined, cause]);
  });

  it("reports anything else as unavailable, carrying the cause", () => {
    const cause = new Error("D1_ERROR: network");
    const error = storeError("users.findById", cause);
    expect(error).toBeInstanceOf(AuthStoreError);
    expect([error.code, error.constraint, error.cause]).toEqual(["unavailable", undefined, cause]);
  });
});

describe("every write reports whether a row changed", () => {
  /** One call per write on every store, so no method can quietly go back to reporting success. */
  function everyWrite(client: D1Client): Promise<{ ok: boolean; data?: unknown }>[] {
    const users = createUserStore(client);
    const factors = createFactorStore(client);
    const credentials = createCredentialStore(client);
    const links = createIdentityLinkStore(client);
    return [
      users.markEmailVerified(USER_ID, 1),
      users.changeEmail(USER_ID, "c@d.test", "c@d.test", 1),
      users.claimEmailChange(USER_ID, 1, 60_000),
      factors.confirm(OTHER_ID, USER_ID, 1, ORIGIN),
      factors.recordVerification(OTHER_ID, USER_ID, 57, 1, FRAME),
      factors.replaceSecret(OTHER_ID, USER_ID, FRAME, 57, 1, ORIGIN),
      credentials.recordUse(OTHER_ID, 1, false, 1),
      credentials.relabel(OTHER_ID, USER_ID, "Work laptop", 1),
      links.unlink(OTHER_ID, USER_ID),
    ];
  }

  it("reports false from every write against a missing id, rather than returning success", async () => {
    const [client] = writerOf(() => 0);
    for (const outcome of await Promise.all(everyWrite(client))) expect(outcome).toEqual({ ok: true, data: false });
  });

  it("reports true from every write that matched a row", async () => {
    const [client] = writerOf(() => 1);
    for (const outcome of await Promise.all(everyWrite(client))) expect(outcome).toEqual({ ok: true, data: true });
  });
});

describe("an id that is not a canonical UUID", () => {
  const BAD_IDS = ["u9", "", "01a08574-257c-71bd-8eb7-f399ec130d3", "'; DROP TABLE auth_users; --"];

  /** Every id-taking method, paired with the answer its own contract calls "no such row". */
  function everyIdMethod(client: D1Client, id: string): [string, Promise<unknown>, unknown][] {
    const users = createUserStore(client);
    const admins = createAdminUserStore(client);
    const factors = createFactorStore(client);
    const credentials = createCredentialStore(client);
    const links = createIdentityLinkStore(client);
    const otp = createOtpStateStore(client);
    const none = { ok: true, data: null };
    const empty = { ok: true, data: [] };
    const unchanged = { ok: true, data: false };
    const missing = { ok: true, data: "not-found" };
    return [
      ["users.findById", users.findById(id), none],
      ["users.setWebAuthnIdIfAbsent", users.setWebAuthnIdIfAbsent(id, new Uint8Array([1]), 1), none],
      ["users.markEmailVerified", users.markEmailVerified(id, 1), unchanged],
      ["users.changeEmail", users.changeEmail(id, "c@d.test", "c@d.test", 1), unchanged],
      ["users.claimEmailChange", users.claimEmailChange(id, 1, 60_000), unchanged],
      ["adminUsers.findById", admins.findById(id), none],
      ["adminUsers.list", admins.list({ after: id }), empty],
      ["adminUsers.search", admins.search("ada", { after: id }), empty],
      ["adminUsers.setAdmin", admins.setAdmin(id, false, 1, OTHER_ID), missing],
      ["adminUsers.setDeactivated", admins.setDeactivated(id, true, 1, OTHER_ID), missing],
      ["adminUsers.setAdmin — actor", admins.setAdmin(USER_ID, true, 1, id), missing],
      ["adminUsers.remove", admins.remove(id), missing],
      ["adminUsers.resetFactors", admins.resetFactors(id, 1, OTHER_ID), missing],
      ["securityEvents.listByUser", createSecurityEventStore(client).listByUser(id), empty],
      ["securityEvents.listByUser — cursor", createSecurityEventStore(client).listByUser(USER_ID, { after: id }), empty],
      ["factors.listByUser", factors.listByUser(id), empty],
      ["factors.find", factors.find(id, "passkey"), none],
      ["factors.listConfirmedKinds", factors.listConfirmedKinds(id, ["passkey"]), empty],
      ["factors.confirm", factors.confirm(id, USER_ID, 1, ORIGIN), unchanged],
      ["factors.confirm — owner", factors.confirm(OTHER_ID, id, 1, ORIGIN), unchanged],
      ["factors.countAttempt", factors.countAttempt(id, "totp-app", 5, 1, 900_000), none],

      ["factors.recordVerification", factors.recordVerification(id, USER_ID, 57, 1, FRAME), unchanged],
      ["factors.recordVerification — owner", factors.recordVerification(OTHER_ID, id, 57, 1, FRAME), unchanged],
      ["factors.replaceSecret", factors.replaceSecret(id, USER_ID, FRAME, 57, 1, ORIGIN), unchanged],
      ["factors.replaceSecret — owner", factors.replaceSecret(OTHER_ID, id, FRAME, 57, 1, ORIGIN), unchanged],
      ["factors.remove", factors.remove(id, USER_ID, 8_000, ORIGIN, []), missing],
      ["factors.remove — owner", factors.remove(OTHER_ID, id, 8_000, ORIGIN, []), missing],
      ["credentials.listByUser", credentials.listByUser(id), empty],
      ["credentials.recordUse", credentials.recordUse(id, 1, false, 1), unchanged],
      ["credentials.relabel", credentials.relabel(id, USER_ID, "Work laptop", 1), unchanged],
      ["credentials.relabel — owner", credentials.relabel(OTHER_ID, id, "Work laptop", 1), unchanged],
      ["credentials.removeForUser", credentials.removeForUser(id, USER_ID, 8_000, ORIGIN, []), missing],
      ["credentials.removeForUser — owner", credentials.removeForUser(OTHER_ID, id, 8_000, ORIGIN, []), missing],
      ["identityLinks.listByUser", links.listByUser(id), empty],
      ["identityLinks.unlink", links.unlink(id, USER_ID), unchanged],
      ["identityLinks.unlink — owner", links.unlink(OTHER_ID, id), unchanged],
      ["otpState.issue", otp.issue(id, { token: "c2VhbGVk", attempts: 0, issuedAt: 1, expiresAt: 2 }, 60_000, new Uint8Array(32)), unchanged],
      ["otpState.countAttempt", otp.countAttempt(id, 3, 1, 900_000, new Uint8Array(32)), none],
      ["otpState.read", otp.read(id, 1, new Uint8Array(32)), none],
      ["otpState.discard", otp.discard(id, "c2VhbGVk"), { ok: true, data: undefined }],
      ["otpState.clear", otp.clear(id), { ok: true, data: undefined }],
      ["sessions.listByUser", createAuthSessionStore(client).listByUser(id, 1), empty],
      ["sessions.revoke", createAuthSessionStore(client).revoke(id, OTHER_ID, 1, ORIGIN), unchanged],
      ["sessions.revoke — session", createAuthSessionStore(client).revoke(USER_ID, id, 1, ORIGIN), unchanged],
      ["sessions.revokeOthers", createAuthSessionStore(client).revokeOthers(id, 1, ORIGIN), { ok: true, data: 0 }],
    ];
  }

  it("settles every id-taking method to its own not-found answer, rather than rejecting", async () => {
    for (const id of BAD_IDS) {
      const [client] = writerOf(
        () => 1,
        () => [{ id: 1 }],
      );
      for (const [operation, call, expected] of everyIdMethod(client, id)) {
        expect(`${operation}: ${JSON.stringify(await call)}`).toBe(`${operation}: ${JSON.stringify(expected)}`);
      }
    }
  });

  it("binds no statement at all, so a crafted id never reaches the database", async () => {
    const [client, db] = writerOf(
      () => 1,
      () => [{ id: 1 }],
    );
    await Promise.all(everyIdMethod(client, "u9").map(([, call]) => call));
    expect(db.calls).toEqual([]);
  });

  it("reports an insert against a malformed owner as reference, never as a throw", async () => {
    const [client] = writerOf(() => 1);
    const inserts = [
      createFactorStore(client).enrol({ userId: "u9", kind: "passkey" }, 1),
      createCredentialStore(client).create(
        { userId: "u9", credentialId: "Y3JlZA", publicKey: new Uint8Array([1]), algorithm: -7, signCount: 0 },
        1,
        ORIGIN,
      ),
      createIdentityLinkStore(client).link({ userId: "u9", provider: "github", subject: "42" }, 1),
      createAuthSessionStore(client).create({ tokenHash: new Uint8Array(32), userId: "u9", signedInAt: 1, signedInWith: "email-otp" }, null),
    ];
    for (const outcome of await Promise.all(inserts)) {
      expect(outcome.ok).toBe(false);
      const error = outcome.ok ? null : outcome.error;
      expect(error).toBeInstanceOf(AuthStoreError);
      expect((error as AuthStoreError).code).toBe("reference");
    }
  });
});

describe("a row that will not decode", () => {
  const CORRUPT = { id: "not-bytes", user_id: "not-bytes", public_key: "not-bytes", transports: null, kind: "passkey", algorithm: -7 };

  function everyReader(client: D1Client): [string, Promise<{ ok: boolean; error?: unknown }>][] {
    return [
      ["users.findById", createUserStore(client).findById(USER_ID)],
      ["users.findByEmailKey", createUserStore(client).findByEmailKey("a@b.test")],
      ["adminUsers.findById", createAdminUserStore(client).findById(USER_ID)],
      ["adminUsers.list", createAdminUserStore(client).list()],
      ["adminUsers.search", createAdminUserStore(client).search("ada")],
      ["factors.listByUser", createFactorStore(client).listByUser(USER_ID)],
      ["factors.find", createFactorStore(client).find(USER_ID, "passkey")],
      ["credentials.listByUser", createCredentialStore(client).listByUser(USER_ID)],
      ["credentials.findByCredentialId", createCredentialStore(client).findByCredentialId("Y3JlZA")],
      ["identityLinks.find", createIdentityLinkStore(client).find("github", "42")],
      ["identityLinks.listByUser", createIdentityLinkStore(client).listByUser(USER_ID)],
      ["sessions.resolve", createAuthSessionStore(client).resolve(new Uint8Array(32), 1)],
      ["sessions.listByUser", createAuthSessionStore(client).listByUser(USER_ID, 1)],
      ["securityEvents.listByUser", createSecurityEventStore(client).listByUser(USER_ID)],
    ];
  }

  it("reports unavailable from every reader, rather than rejecting", async () => {
    const [client] = clientOf(() => [CORRUPT]);
    for (const [operation, call] of everyReader(client)) {
      const outcome = await call;
      expect(`${operation}: ${outcome.ok}`).toBe(`${operation}: false`);
      expect(outcome.error).toBeInstanceOf(AuthStoreError);
      expect((outcome.error as AuthStoreError).code).toBe("unavailable");
    }
  });

  it("reads transports that are not a JSON array as none, rather than throwing on the parse", async () => {
    const row = { id: new Uint8Array(16), user_id: new Uint8Array(16), public_key: new Uint8Array([1]), transports: '"usb"', algorithm: -7 };
    const [client] = clientOf(() => [row]);
    const outcome = await createCredentialStore(client).findByCredentialId("Y3JlZA");
    expect(outcome.ok && outcome.data?.transports).toEqual([]);
  });

  it("reads a credential with no public key as empty bytes, matching the columns that already guard null", async () => {
    const row = { id: new Uint8Array(16), user_id: new Uint8Array(16), public_key: null, transports: null, algorithm: -7 };
    const [client] = clientOf(() => [row]);
    const outcome = await createCredentialStore(client).findByCredentialId("Y3JlZA");
    expect(outcome.ok && outcome.data?.publicKey).toEqual(new Uint8Array());
  });
});

describe("a page limit outside the range a statement may bind", () => {
  async function limitBoundBy(limit: number, search = false): Promise<unknown> {
    const [client, db] = clientOf(() => []);
    const admins = createAdminUserStore(client);
    if (search) await admins.search("ada", { limit });
    else await admins.list({ limit });
    return db.calls[0]?.params.at(-1);
  }

  it("clamps a zero, a negative and a fractional limit up to one row", async () => {
    for (const limit of [0, -1, -1000, 0.5]) expect(`${limit} → ${await limitBoundBy(limit)}`).toBe(`${limit} → 1`);
  });

  it("clamps an oversized limit down to the ceiling, on both listing and search", async () => {
    expect(await limitBoundBy(1_000_000)).toBe(MAX_PAGE_LIMIT);
    expect(await limitBoundBy(1_000_000, true)).toBe(MAX_PAGE_LIMIT);
  });

  it("binds a limit already inside the range unchanged", async () => {
    expect(await limitBoundBy(25)).toBe(25);
  });
});

describe("schema drift", () => {
  const schema = readFileSync(new URL("../schema.sql", import.meta.url).pathname, "utf-8");

  /** `{ auth_users: Set<"id" | "email" | …>, … }`, parsed out of the DDL. */
  function schemaColumns(ddl: string): Map<string, Set<string>> {
    const tables = new Map<string, Set<string>>();
    for (const match of ddl.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\) STRICT;/g)) {
      const [, table = "", body = ""] = match;
      const columns = new Set<string>();
      for (const line of body.split("\n")) {
        const bare = line.replace(/--.*$/, "").trim();
        const name = /^(\w+)\s+(BLOB|TEXT|INTEGER|REAL|ANY)\b/.exec(bare)?.[1];
        if (name) columns.add(name);
      }
      tables.set(table, columns);
    }
    return tables;
  }

  const TABLES = schemaColumns(schema);

  /** SQL words a statement may contain that are not column names — `excluded` is the upsert pseudo-table. */
  const KEYWORDS = new Set(
    `SELECT FROM WHERE AND OR NOT NULL IS INSERT INTO VALUES UPDATE SET DELETE ORDER BY ASC DESC LIMIT OFFSET COUNT AS IN ON JOIN LEFT INNER GROUP HAVING DISTINCT EXISTS LIKE ESCAPE EXCLUDED CHANGES ROWID`.split(
      " ",
    ),
  );

  /** Every identifier a statement names that the tables it touches do not declare. */
  function unknownColumns(statement: string): string[] {
    const named = [...statement.matchAll(/\bauth_\w+\b/g)].map((match) => match[0]);
    const allowed = new Set<string>();
    for (const table of named) for (const column of TABLES.get(table) ?? []) allowed.add(column);
    const missing: string[] = [];
    // An `AS` alias names a result column, not a stored one, so it is not the schema's to declare.
    const scanned = statement.replace(/\bAS\s+\w+/gi, "").replaceAll("(SELECT value FROM json_each(?))", "(?)");
    for (const match of scanned.matchAll(/[a-z_][a-z0-9_]*/g)) {
      const word = match[0];
      if (KEYWORDS.has(word.toUpperCase()) || word.startsWith("auth_") || allowed.has(word)) continue;
      missing.push(word);
    }
    return missing;
  }

  const STALE_SESSION_ROW = {
    id: uuidToBytes(USER_ID),
    email: "a@b.test",
    is_admin: 0,
    session_id: uuidToBytes(OTHER_ID),
    signed_in_at: 1,
    expires_at: 2,
    step_up_at: null,
    step_up_kind: null,
    last_seen_at: 1,
    device: null,
  };

  /** One statement as a batch carried it. */
  interface Batched {
    readonly sql: string;
    readonly params: readonly unknown[];
  }

  async function everyStatement(): Promise<string[]> {
    return (await everyWrite()).statements;
  }

  /** Every adapter statement, and every batch among them as the statements it carried, in order. */
  async function everyWrite(): Promise<{ readonly statements: string[]; readonly batches: Batched[][] }> {
    const [client, db] = clientOf(() => []);
    const batches: Batched[][] = [];
    const batch = db.batch;
    db.batch = (statements) => {
      batches.push(statements.map((statement) => statement as unknown as Batched));
      return batch(statements);
    };
    const users = createUserStore(client);
    const admins = createAdminUserStore(client);
    const factors = createFactorStore(client);
    const credentials = createCredentialStore(client);
    const links = createIdentityLinkStore(client);
    const otp = createOtpStateStore(client);
    await users.findById(USER_ID);
    await users.findByEmailKey("a@b.test");
    await users.findByWebAuthnId(new Uint8Array([1, 2]));
    await users.create({ email: "a@b.test", emailKey: "a@b.test" }, 1);
    await users.setWebAuthnIdIfAbsent(USER_ID, new Uint8Array([1, 2]), 1);
    await users.markEmailVerified(USER_ID, 1);
    await users.changeEmail(USER_ID, "c@d.test", "c@d.test", 1);
    await users.claimEmailChange(USER_ID, 1, 60_000);
    await admins.findById(USER_ID);
    await admins.list();
    await admins.list({ after: OTHER_ID });
    await admins.search("a@b.test");
    await admins.search("a@b.test", { after: OTHER_ID });
    await admins.countAdmins();
    await admins.claimFirstAdmin(USER_ID, 1, { replaces: new Uint8Array(32), tokenHash: new Uint8Array(32) });
    await admins.setAdmin(USER_ID, true, 1, OTHER_ID);
    await admins.setAdmin(USER_ID, false, 1, OTHER_ID);
    await admins.setDeactivated(USER_ID, true, 1, OTHER_ID);
    await admins.setDeactivated(USER_ID, false, 1, OTHER_ID);
    await admins.remove(USER_ID);
    await admins.resetFactors(USER_ID, 1, OTHER_ID);
    await factors.listByUser(USER_ID);
    await factors.find(USER_ID, "passkey");
    await factors.listConfirmedKinds(USER_ID, ["passkey", "totp-app"]);
    await factors.enrol({ userId: USER_ID, kind: "passkey" }, 1);
    await factors.confirm(OTHER_ID, USER_ID, 1, ORIGIN);
    await factors.countAttempt(USER_ID, "totp-app", 5, 1, 900_000);
    await factors.recordVerification(OTHER_ID, USER_ID, 57, 1, FRAME);
    await factors.replaceSecret(OTHER_ID, USER_ID, FRAME, 57, 1, ORIGIN);
    await factors.remove(OTHER_ID, USER_ID, 8_000, ORIGIN, []);
    await credentials.listByUser(USER_ID);
    await credentials.findByCredentialId("Y3JlZA");
    await credentials.create({ userId: USER_ID, credentialId: "Y3JlZA", publicKey: new Uint8Array([1]), algorithm: -7, signCount: 0 }, 1, ORIGIN);
    await credentials.recordUse(OTHER_ID, 1, false, 1);
    await credentials.relabel(OTHER_ID, USER_ID, "Work laptop", 1);
    await credentials.removeForUser(OTHER_ID, USER_ID, 8_000, ORIGIN, []);
    await credentials.removeForUser(OTHER_ID, USER_ID, 8_000, { keep: null }, []);
    await links.find("github", "42");
    await links.listByUser(USER_ID);
    await links.link({ userId: USER_ID, provider: "github", subject: "42" }, 1);
    await links.unlink(OTHER_ID, USER_ID);
    await otp.issue(USER_ID, { token: "c2VhbGVk", attempts: 0, issuedAt: 1, expiresAt: 2 }, 60_000, new Uint8Array(32));
    await otp.countAttempt(USER_ID, 3, 1, 900_000, new Uint8Array(32));
    await otp.read(USER_ID, 1, new Uint8Array(32));
    await otp.discard(USER_ID, "c2VhbGVk");
    await otp.clear(USER_ID);
    await createChallengeStore(client).put("k1", { challenge: "Y2g", sessionId: "s1" }, 300);
    await createChallengeStore(client).take("k1");
    await createNonceStore(client).markConsumed("n1", 900);
    await purgeAuthEphemera(client, 1);
    const accessTokens = createAccessTokenStore(client);
    await accessTokens.create({ userId: USER_ID, tokenHash: new Uint8Array(32), label: "CLI", scopes: ["notes:read"], expiresAt: 2 }, 1);
    await accessTokens.findByHash(new Uint8Array(32));
    await accessTokens.listByUser(USER_ID);
    await accessTokens.recordUse(OTHER_ID, 1, 60_000);
    await accessTokens.revoke(OTHER_ID, USER_ID, 1);
    const recoveryCodes = createRecoveryCodeStore(client);
    await recoveryCodes.stage(USER_ID, [new Uint8Array(32)], 1);
    await recoveryCodes.holdsStaged(USER_ID, new Uint8Array(32));
    await recoveryCodes.commit(USER_ID, OTHER_ID, 1, ORIGIN);
    await recoveryCodes.consume(USER_ID, OTHER_ID, new Uint8Array(32), 1, ORIGIN);
    await recoveryCodes.remaining(USER_ID);
    const sessions = createAuthSessionStore(client);
    await sessions.create(
      {
        tokenHash: new Uint8Array(32),
        userId: USER_ID,
        signedInAt: 1,
        signedInWith: "email-otp",
        stepUp: { at: 1, kind: "passkey" },
        device: "Firefox on Linux",
      },
      new Uint8Array(32),
    );
    await sessions.resolve(new Uint8Array(32), 1);
    await sessions.rotate(new Uint8Array(32), new Uint8Array(32), { at: 1, kind: "recovery-code" });
    await sessions.rotate(new Uint8Array(32), new Uint8Array(32));
    await sessions.remove(new Uint8Array(32));
    await sessions.listByUser(USER_ID, 1);
    await sessions.revoke(USER_ID, OTHER_ID, 1, ORIGIN);
    await sessions.revokeOthers(USER_ID, 1, ORIGIN);
    await sessions.revokeOthers(USER_ID, 1, { keep: null });
    const events = createSecurityEventStore(client);
    await events.listByUser(USER_ID);
    await events.listByUser(USER_ID, { after: OTHER_ID });
    const [seenClient, seenDb] = clientOf(() => [{ ...STALE_SESSION_ROW }]);
    await createAuthSessionStore(seenClient).resolve(new Uint8Array(32), 600_000);
    return { statements: [...db.calls, ...seenDb.calls].map((call) => call.sql), batches };
  }

  it("parses every table and its columns out of the DDL", () => {
    expect([...TABLES.keys()].sort()).toEqual([
      "auth_access_tokens",
      "auth_challenges",
      "auth_credentials",
      "auth_factors",
      "auth_identity_links",
      "auth_nonces",
      "auth_otp_state",
      "auth_recovery_codes",
      "auth_security_events",
      "auth_sessions",
      "auth_users",
    ]);
    expect([...(TABLES.get("auth_users") ?? [])].sort()).toEqual([
      "created_at",
      "deactivated_at",
      "email",
      "email_change_requested_at",
      "email_key",
      "email_verified_at",
      "id",
      "is_admin",
      "updated_at",
      "webauthn_id",
    ]);
  });

  it("declares every auth table with a rowid, which the purge's bounded steps select by", () => {
    const tables = schema
      .replace(/--.*$/gm, "")
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => statement.startsWith("CREATE TABLE"));
    expect(tables).toHaveLength(TABLES.size);
    expect(tables.filter((statement) => /\bWITHOUT\s+ROWID\b/i.test(statement))).toEqual([]);
  });

  it("gives a security event row exactly its type, factor kind, public session id, admin id and time beside its keys — no column for an address, a client detail or a secret", () => {
    expect([...(TABLES.get("auth_security_events") ?? [])].sort()).toEqual([
      "admin_id",
      "at",
      "factor_kind",
      "id",
      "session_id",
      "type",
      "user_id",
    ]);
  });

  it("names no column the schema lacks, across every adapter statement", async () => {
    const statements = await everyStatement();
    expect(statements.length).toBeGreaterThan(20);
    for (const statement of statements) {
      expect(`${statement.replace(/\s+/g, " ").slice(0, 60)} → ${unknownColumns(statement).join(", ")}`).toBe(
        `${statement.replace(/\s+/g, " ").slice(0, 60)} → `,
      );
    }
  });

  it("guards every `changes() > 0` on the write directly before it in its own batch, never on a read or on nothing", async () => {
    const { statements, batches } = await everyWrite();
    const squash = (sql: string) => sql.replace(/\s+/g, " ").trim();
    const guarded = batches.flatMap((carried) =>
      carried.flatMap((statement, index) =>
        statement.sql.includes("changes()")
          ? [/^(INSERT|UPDATE|DELETE) /.test(squash(carried[index - 1]?.sql ?? "")) ? "after a write" : squash(statement.sql)]
          : [],
      ),
    );
    expect({
      guarded: [...new Set(guarded)],
      outsideBatches: statements.filter((sql) => sql.includes("changes()")).length - guarded.length,
    }).toEqual({ guarded: ["after a write"], outsideBatches: 0 });
  });

  it("writes every security event type beside a change in its batch, from the owner, a factor kind, the acting session's public id, an admin id and the time alone", async () => {
    const EVENT =
      /^INSERT INTO auth_security_events \(id, user_id, type, factor_kind, session_id, admin_id, at\) SELECT \?, (\?|\(SELECT user_id FROM auth_sessions WHERE token_hash = \?\)), \?, (\?|\(SELECT kind FROM auth_factors WHERE id = \? AND user_id = \?\)), (NULL|\(SELECT id FROM auth_sessions WHERE token_hash = \?\)), \?, \? WHERE .+$/;
    const bytesOf = (value: unknown) => (value instanceof Uint8Array ? [...value].join(",") : String(value));
    const ids = new Map([
      [bytesOf(uuidToBytes(USER_ID)), "the account"],
      [bytesOf(uuidToBytes(OTHER_ID)), "another account"],
    ]);
    const { batches } = await everyWrite();
    const events = batches.flatMap((carried) =>
      carried
        .filter((statement) => statement.sql.includes("INSERT INTO auth_security_events"))
        .map((statement) => {
          const shape = EVENT.exec(statement.sql.replace(/\s+/g, " ").trim());
          if (shape === null) {
            const unrecognised = `a statement of another shape: ${statement.sql}`;
            return {
              type: unrecognised,
              owner: unrecognised,
              kind: unrecognised,
              session: unrecognised,
              admin: unrecognised,
              at: unrecognised,
              batch: unrecognised,
            };
          }
          const [, user, kind, session] = shape;
          const kindParams = kind === "?" ? 1 : 2;
          const sessionParams = session === "NULL" ? 0 : 1;
          const admin = statement.params[3 + kindParams + sessionParams];
          const changes = carried.filter((other) => other !== statement && /^\s*(INSERT|UPDATE|DELETE) /.test(other.sql)).length;
          return {
            type: statement.params[2],
            owner: user === "?" ? (ids.get(bytesOf(statement.params[1])) ?? "a value that is no account id") : "the session's owner",
            kind: kind === "?" ? statement.params[3] : "the factor row's kind",
            session: session === "NULL" ? "no session" : "the session's public id",
            admin: admin === null ? "no admin" : (ids.get(bytesOf(admin)) ?? "a value that is no account id"),
            at: typeof statement.params[4 + kindParams + sessionParams],
            batch: changes > 0 ? "beside a change" : "alone",
          };
        }),
    );
    const distinct = (field: keyof (typeof events)[number]) => [...new Set(events.map((event) => String(event[field])))].sort();
    expect({
      type: distinct("type"),
      owner: distinct("owner"),
      kind: distinct("kind"),
      session: distinct("session"),
      admin: distinct("admin"),
      at: distinct("at"),
      batch: distinct("batch"),
    }).toEqual({
      type: [
        "account-deactivated",
        "account-reactivated",
        "admin-granted",
        "admin-revoked",
        "email-changed",
        "factor-added",
        "factor-removed",
        "factor-replaced",
        "factors-reset",
        "recovery-code-used",
        "recovery-codes-issued",
        "sessions-revoked",
        "signed-in",
        "stepped-up",
      ],
      owner: ["the account", "the session's owner"],
      kind: ["email-otp", "null", "passkey", "recovery-code", "the factor row's kind", "totp-app"],
      session: ["no session", "the session's public id"],
      admin: ["another account", "no admin", "the account"],
      at: ["number"],
      batch: ["beside a change"],
    });
  });

  it("reports a column the schema lacks, so the check above can actually fail", () => {
    expect(unknownColumns("SELECT last_login FROM auth_users WHERE id = ?")).toEqual(["last_login"]);
    expect(unknownColumns("UPDATE auth_factors SET rotated_at = ? WHERE id = ?")).toEqual(["rotated_at"]);
  });

  it("reports a column that exists on another table but not the one being queried", () => {
    expect(unknownColumns("SELECT sign_count FROM auth_users WHERE id = ?")).toEqual(["sign_count"]);
  });
});

describe("isAppKeyDeleteRefusal", () => {
  it("is true for a foreign-key, NOT NULL or CHECK refusal, and false for a UNIQUE refusal, an outage or an unrecognised error", () => {
    const failures = [
      "D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT",
      "D1_ERROR: NOT NULL constraint failed: app_devices.sid: SQLITE_CONSTRAINT",
      "D1_ERROR: CHECK constraint failed: owner IS NOT NULL: SQLITE_CONSTRAINT",
      "D1_ERROR: UNIQUE constraint failed: app_archive.id: SQLITE_CONSTRAINT",
      "D1_ERROR: Network connection lost.",
      "something else",
    ];
    expect(failures.map((failure) => isAppKeyDeleteRefusal(new Error(failure)))).toEqual([true, true, true, false, false, false]);
  });
});
