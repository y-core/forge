import { Forge } from "../../../src/app/forge-app";
import { createAccessTokenStore } from "../../../src/auth/stores/access-tokens";
import { createAdminUserStore } from "../../../src/auth/stores/admin-users";
import { createChallengeStore } from "../../../src/auth/stores/challenges";
import { createCredentialStore } from "../../../src/auth/stores/credentials";
import { purgeAuthEphemera } from "../../../src/auth/stores/ephemera";
import { createFactorStore, purgeStaleTotpSecrets } from "../../../src/auth/stores/factors";
import { createIdentityLinkStore } from "../../../src/auth/stores/identity-links";
import { createNonceStore } from "../../../src/auth/stores/nonces";
import { createOtpStateStore } from "../../../src/auth/stores/otp-state";
import { createRecoveryCodeStore } from "../../../src/auth/stores/recovery-codes";
import { createAuthSessionStore } from "../../../src/auth/stores/sessions";
import { createUserStore } from "../../../src/auth/stores/users";
import { createAccessTokenService } from "../../../src/auth/tokens/service";
import { requireBearer } from "../../../src/auth/web/guards";
import type { Result } from "../../../src/result/types";
import { createD1Client } from "../../../src/storage/db/client";
import { requireRowsWritten } from "../../../src/storage/db/sql";
import type { D1Database } from "../../../src/storage/db/types";
import { uuidToBytes, uuidv7 } from "../../../src/storage/db/uuid";
import { mapHandler } from "../../../src/testing/route";

interface Env {
  DB: D1Database;
}

interface StatementOutcome {
  readonly statement: string;
  readonly error: string | null;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

function statementsOf(ddl: string): string[] {
  return ddl
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

async function applySchema(db: D1Database, ddl: string): Promise<Response> {
  const outcomes: StatementOutcome[] = [];
  for (const statement of statementsOf(ddl)) {
    try {
      await db.prepare(statement).run();
      outcomes.push({ statement: statement.slice(0, 60), error: null });
    } catch (thrown) {
      outcomes.push({ statement: statement.slice(0, 60), error: messageOf(thrown) });
    }
  }
  return json({ outcomes, failures: outcomes.filter((outcome) => outcome.error !== null).length });
}

async function probeStrict(db: D1Database): Promise<Response> {
  let created: string | null = null;
  let rejectedTypeMismatch: string | null = null;
  try {
    await db.prepare("DROP TABLE IF EXISTS probe_strict").run();
    await db.prepare("CREATE TABLE probe_strict (id INTEGER PRIMARY KEY NOT NULL, n INTEGER NOT NULL) STRICT").run();
  } catch (thrown) {
    created = messageOf(thrown);
  }
  if (created === null) {
    try {
      await db.prepare("INSERT INTO probe_strict (id, n) VALUES (1, 'not a number')").run();
    } catch (thrown) {
      rejectedTypeMismatch = messageOf(thrown);
    }
  }
  return json({ createError: created, typeMismatchError: rejectedTypeMismatch });
}

async function probeBatch(db: D1Database): Promise<Response> {
  await db.prepare("DROP TABLE IF EXISTS probe_batch").run();
  await db.prepare("CREATE TABLE probe_batch (id INTEGER PRIMARY KEY NOT NULL)").run();

  let batchError: string | null = null;
  try {
    await db.batch([
      db.prepare("INSERT INTO probe_batch (id) VALUES (?)").bind(1),
      db.prepare("INSERT INTO probe_batch (id) VALUES (?)").bind(1),
      db.prepare("INSERT INTO probe_batch (id) VALUES (?)").bind(3),
    ]);
  } catch (thrown) {
    batchError = messageOf(thrown);
  }

  const rows = await db.prepare("SELECT id FROM probe_batch ORDER BY id").all<{ id: number }>();
  return json({ batchError, survivingRows: rows.results.map((row) => row.id) });
}

async function probeForeignKeys(db: D1Database): Promise<Response> {
  await db.prepare("DROP TABLE IF EXISTS probe_child").run();
  await db.prepare("DROP TABLE IF EXISTS probe_parent").run();
  await db.prepare("CREATE TABLE probe_parent (id INTEGER PRIMARY KEY NOT NULL)").run();
  await db
    .prepare("CREATE TABLE probe_child (id INTEGER PRIMARY KEY NOT NULL, parent INTEGER NOT NULL REFERENCES probe_parent (id) ON DELETE CASCADE)")
    .run();

  const orphan = async (): Promise<string | null> => {
    try {
      await db.prepare("INSERT INTO probe_child (id, parent) VALUES (1, 99)").run();
      return null;
    } catch (thrown) {
      return messageOf(thrown);
    }
  };
  const orphanError = await orphan();
  await db.prepare("PRAGMA foreign_keys = OFF").run();
  const orphanAfterOffError = await orphan();
  const pragmaAfterOff = await db.prepare("PRAGMA foreign_keys").first<{ foreign_keys: number }>();

  await db.batch([db.prepare("INSERT INTO probe_parent (id) VALUES (1)"), db.prepare("INSERT INTO probe_child (id, parent) VALUES (2, 1)")]);
  await db.prepare("DELETE FROM probe_parent WHERE id = 1").run();
  const cascaded = await db.prepare("SELECT id FROM probe_child").all<{ id: number }>();
  return json({
    orphanError,
    orphanAfterOffError,
    foreignKeysAfterOff: pragmaAfterOff?.foreign_keys ?? null,
    childrenLeft: cascaded.results.length,
  });
}

// The shipped fragment rather than a copy, so what `requireRowsWritten()` mints is what is proved.
const GUARD = requireRowsWritten().text;

async function probeChanges(db: D1Database): Promise<Response> {
  await db.prepare("DROP TABLE IF EXISTS probe_changes").run();
  await db.prepare("CREATE TABLE probe_changes (id INTEGER PRIMARY KEY NOT NULL, n INTEGER NOT NULL)").run();
  await db.prepare("INSERT INTO probe_changes (id, n) VALUES (1, 0)").run();

  const matched = await db.batch<{ c: number }>([
    db.prepare("UPDATE probe_changes SET n = 5 WHERE id = ?").bind(1),
    db.prepare("SELECT changes() AS c"),
  ]);
  const unmatched = await db.batch<{ c: number }>([
    db.prepare("UPDATE probe_changes SET n = 5 WHERE id = ?").bind(99),
    db.prepare("SELECT changes() AS c"),
  ]);

  let overflowError: string | null = null;
  try {
    await db.prepare("SELECT abs(-9223372036854775808) AS x").run();
  } catch (thrown) {
    overflowError = messageOf(thrown);
  }

  let guardAbortError: string | null = null;
  try {
    await db.batch([
      db.prepare("INSERT INTO probe_changes (id, n) VALUES (2, 0)"),
      db.prepare("UPDATE probe_changes SET n = 5 WHERE id = ?").bind(99),
      db.prepare(GUARD),
    ]);
  } catch (thrown) {
    guardAbortError = messageOf(thrown);
  }
  const afterAbort = (await db.prepare("SELECT id FROM probe_changes ORDER BY id").all<{ id: number }>()).results.map((row) => row.id);

  let guardPassError: string | null = null;
  try {
    await db.batch([
      db.prepare("INSERT INTO probe_changes (id, n) VALUES (3, 0)"),
      db.prepare("UPDATE probe_changes SET n = 7 WHERE id = ?").bind(1),
      db.prepare(GUARD),
    ]);
  } catch (thrown) {
    guardPassError = messageOf(thrown);
  }
  const afterPass = (await db.prepare("SELECT id FROM probe_changes ORDER BY id").all<{ id: number }>()).results.map((row) => row.id);

  return json({
    changesAfterMatched: matched[1]?.results[0]?.c ?? null,
    changesAfterUnmatched: unmatched[1]?.results[0]?.c ?? null,
    overflowError,
    guardAbortError,
    afterAbort,
    guardPassError,
    afterPass,
  });
}

async function probeBlob(db: D1Database): Promise<Response> {
  await db.prepare("DROP TABLE IF EXISTS probe_blob").run();
  await db.prepare("CREATE TABLE probe_blob (id BLOB PRIMARY KEY NOT NULL) STRICT").run();
  const written = new Uint8Array([1, 2, 3, 250, 251, 252]);
  await db.prepare("INSERT INTO probe_blob (id) VALUES (?)").bind(written).run();
  const row = await db.prepare("SELECT id FROM probe_blob").first<{ id: unknown }>();
  const value = row?.id;
  return json({
    constructorName: value?.constructor?.name ?? typeof value,
    isArray: Array.isArray(value),
    isArrayBuffer: value instanceof ArrayBuffer,
    isUint8Array: value instanceof Uint8Array,
    bytes: value instanceof ArrayBuffer ? [...new Uint8Array(value)] : value instanceof Uint8Array ? [...value] : value,
  });
}

async function writeMeta(db: D1Database, sql: string, ...params: unknown[]): Promise<Record<string, unknown>> {
  const meta = (
    await db
      .prepare(sql)
      .bind(...params)
      .run()
  ).meta as Record<string, unknown>;
  return { rows_written: meta.rows_written ?? null, changes: meta.changes ?? null, resolved: meta.rows_written ?? meta.changes ?? 0 };
}

async function probeRowsWritten(db: D1Database): Promise<Response> {
  await db.prepare("DROP TABLE IF EXISTS probe_rows").run();
  await db.prepare("CREATE TABLE probe_rows (id INTEGER PRIMARY KEY NOT NULL, n INTEGER NOT NULL) STRICT").run();
  await db.batch([
    db.prepare("INSERT INTO probe_rows (id, n) VALUES (?, ?)").bind(1, 10),
    db.prepare("INSERT INTO probe_rows (id, n) VALUES (?, ?)").bind(2, 20),
  ]);

  return json({
    updateMatched: await writeMeta(db, "UPDATE probe_rows SET n = ? WHERE id = ?", 11, 1),
    updateUnmatched: await writeMeta(db, "UPDATE probe_rows SET n = ? WHERE id = ?", 99, 404),
    updateGuardRefused: await writeMeta(db, "UPDATE probe_rows SET n = ? WHERE id = ? AND n > ?", 12, 1, 1_000),
    // A matched row whose value does not change — SQLite counts it, and a guard must not read that as a refusal.
    updateNoOp: await writeMeta(db, "UPDATE probe_rows SET n = ? WHERE id = ?", 11, 1),
    deleteMatched: await writeMeta(db, "DELETE FROM probe_rows WHERE id = ?", 2),
    deleteUnmatched: await writeMeta(db, "DELETE FROM probe_rows WHERE id = ?", 404),
  });
}

function must<T>(outcome: Result<T, unknown>, what: string): T {
  if (!outcome.ok) throw new Error(`${what}: ${messageOf(outcome.error)}`);
  return outcome.data;
}

async function countOf(db: D1Database, table: string, where = "1"): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).first<{ n: number }>();
  return row?.n ?? 0;
}

const AT = 1_700_000_000_000;

// A literal, because workerd refuses random generation at global scope and would not start this Worker.
const OPERATOR = "01900000-0000-7000-8000-000000000001";

const NO_ORIGIN = { keep: null };

async function storesOn(db: D1Database) {
  for (const table of [
    "auth_access_tokens",
    "auth_nonces",
    "auth_challenges",
    "auth_otp_state",
    "auth_identity_links",
    "auth_credentials",
    "auth_recovery_codes",
    "auth_factors",
    "auth_sessions",
    "auth_users",
  ]) {
    await db.prepare(`DELETE FROM ${table}`).run();
  }
  const client = createD1Client(db as never);
  return {
    client,
    users: createUserStore(client),
    admins: createAdminUserStore(client),
    credentials: createCredentialStore(client),
    factors: createFactorStore(client),
    links: createIdentityLinkStore(client),
    otp: createOtpStateStore(client),
    challenges: createChallengeStore(client),
    nonces: createNonceStore(client),
    accessTokens: createAccessTokenStore(client),
    recoveryCodes: createRecoveryCodeStore(client),
    sessions: createAuthSessionStore(client),
  };
}

async function probeLastAdmin(db: D1Database): Promise<Record<string, unknown>> {
  const { users, admins } = await storesOn(db);
  const admin = async (local: string): Promise<string> =>
    must(await users.create({ email: `${local}@example.test`, emailKey: `${local}@example.test`, isAdmin: true }, AT), `create ${local}`).id;

  const alice = await admin("alice");
  const bob = await admin("bob");
  const demotions = (await Promise.all([admins.setAdmin(alice, false, AT + 1, OPERATOR), admins.setAdmin(bob, false, AT + 1, OPERATOR)])).map(
    (outcome) => must(outcome, "concurrent demote"),
  );
  return { demotions: [...demotions].sort(), adminsLeft: must(await admins.countAdmins(), "countAdmins") };
}

async function probeFirstAdmin(db: D1Database): Promise<Record<string, unknown>> {
  const { users, admins } = await storesOn(db);
  const person = async (local: string): Promise<string> =>
    must(await users.create({ email: `${local}@example.test`, emailKey: `${local}@example.test` }, AT), `create ${local}`).id;

  const hana = await person("hana");
  const ivan = await person("ivan");
  const claims = (await Promise.all([admins.claimFirstAdmin(hana, AT + 1), admins.claimFirstAdmin(ivan, AT + 1)])).map((outcome) =>
    must(outcome, "concurrent claim"),
  );
  return { claims: [...claims].sort(), adminsAfter: must(await admins.countAdmins(), "countAdmins") };
}

async function probeDeactivatedAdmin(db: D1Database): Promise<Record<string, unknown>> {
  const { users, admins } = await storesOn(db);
  const admin = async (local: string): Promise<string> =>
    must(await users.create({ email: `${local}@example.test`, emailKey: `${local}@example.test`, isAdmin: true }, AT), `create ${local}`).id;

  const carol = await admin("carol");
  const dave = await admin("dave");
  const gina = await admin("gina");
  return {
    deactivateDave: must(await admins.setDeactivated(dave, true, AT + 1, OPERATOR), "deactivate dave"),
    deactivateGina: must(await admins.setDeactivated(gina, true, AT + 2, OPERATOR), "deactivate gina"),
    demoteDeactivated: must(await admins.setAdmin(dave, false, AT + 3, OPERATOR), "demote dave"),
    removeDeactivated: must(await admins.remove(gina), "delete gina"),
    demoteLastActive: must(await admins.setAdmin(carol, false, AT + 4, OPERATOR), "demote carol"),
    removeLastActive: must(await admins.remove(carol), "delete carol"),
  };
}

async function probeOwnershipAndCounter(db: D1Database): Promise<Record<string, unknown>> {
  const { users, admins, credentials, factors, links, otp, accessTokens, recoveryCodes } = await storesOn(db);
  const person = async (local: string): Promise<string> =>
    must(await users.create({ email: `${local}@example.test`, emailKey: `${local}@example.test` }, AT), `create ${local}`).id;

  const erin = await person("erin");
  const frank = await person("frank");
  const credential = async (id: string) =>
    must(
      await credentials.create(
        { userId: erin, credentialId: id, publicKey: new Uint8Array([1, 2, 3]), algorithm: -7, signCount: 0 },
        AT,
        NO_ORIGIN,
      ),
      `create ${id}`,
    );
  const first = await credential("erin-1");
  await credential("erin-2");
  const factor = must(await factors.enrol({ userId: erin, kind: "totp-app", secret: new Uint8Array([9]) }, AT), "enrol factor");
  const link = must(await links.link({ userId: erin, provider: "github", subject: "erin" }, AT), "link erin");
  must(
    await otp.issue(erin, { token: "c2VhbGVk", attempts: 0, issuedAt: AT, expiresAt: AT + 600_000 }, 60_000, new Uint8Array(32)),
    "issue erin's code",
  );
  must(
    await accessTokens.create({ userId: erin, tokenHash: new Uint8Array(32).fill(1), label: "CLI", scopes: ["notes:read"], expiresAt: null }, AT),
    "issue erin's token",
  );
  must(await recoveryCodes.stage(erin, [new Uint8Array(32).fill(7)], AT), "stage erin's codes");

  const LOCKOUT_MS = 60_000;
  const spend = async (userId: string, at: number): Promise<number | null> =>
    must(await factors.countAttempt(userId, "totp-app", 2, at, LOCKOUT_MS), `spend at ${at}`)?.failedAttempts ?? null;
  const spendFirst = await spend(erin, AT + 1);
  const spendSecond = await spend(erin, AT + 2);
  const spendRefused = await spend(erin, AT + 3);
  const spendByStranger = await spend(frank, AT + 4);
  const spendInsideWindow = await spend(erin, AT + 2 + LOCKOUT_MS - 1);
  const spendAfterWindow = await spend(erin, AT + 2 + LOCKOUT_MS);
  const spentAfterWindow = await countOf(db, "auth_factors", "failed_attempts = 1");
  const spentSecretCarried = must(await factors.countAttempt(erin, "totp-app", 9, AT + 9, LOCKOUT_MS), "carry the secret")?.secret?.[0] ?? null;

  return {
    removeByStranger: must(await credentials.removeForUser(first.id, frank, 8_000, { keep: new Uint8Array(32) }, []), "remove as stranger"),
    removeByOwner: must(await credentials.removeForUser(first.id, erin, 8_000, { keep: new Uint8Array(32) }, []), "remove as owner"),
    spendFirst,
    spendSecond,
    spendRefused,
    spendByStranger,
    spendInsideWindow,
    spendAfterWindow,
    spentAfterWindow,
    spentSecretCarried,
    unlinkByStranger: must(await links.unlink(link.id, frank), "unlink as stranger"),
    unlinkByOwner: must(await links.unlink(link.id, erin), "unlink as owner"),
    advanceByStranger: must(await factors.recordVerification(factor.id, frank, 57, AT + 5, new Uint8Array([9])), "advance as stranger"),
    advanceFirst: must(await factors.recordVerification(factor.id, erin, 57, AT + 6, new Uint8Array([9])), "advance 57"),
    advanceReplay: must(await factors.recordVerification(factor.id, erin, 57, AT + 7, new Uint8Array([9])), "replay 57"),
    spentAfterAdvance: await countOf(db, "auth_factors", "failed_attempts > 0"),
    confirmByStranger: must(await factors.confirm(factor.id, frank, AT + 8, NO_ORIGIN), "confirm as stranger"),
    removeFactorByStranger: must(await factors.remove(factor.id, frank, 8_000, NO_ORIGIN, []), "remove factor as stranger"),
    removeUser: must(await admins.remove(erin), "delete erin"),
    leftBehind: {
      auth_access_tokens: await countOf(db, "auth_access_tokens"),
      auth_credentials: await countOf(db, "auth_credentials"),
      auth_factors: await countOf(db, "auth_factors"),
      auth_identity_links: await countOf(db, "auth_identity_links"),
      auth_otp_state: await countOf(db, "auth_otp_state"),
      auth_recovery_codes: await countOf(db, "auth_recovery_codes"),
      auth_users: await countOf(db, "auth_users"),
    },
  };
}

async function probeEphemera(db: D1Database): Promise<Record<string, unknown>> {
  const { client, challenges, nonces } = await storesOn(db);
  const record = { challenge: "Y2hhbGxlbmdl", sessionId: "sess-1" };

  must(await challenges.put("race", record, 300), "put the challenge");
  const takes = await Promise.all([challenges.take("race"), challenges.take("race"), challenges.take("race")]);
  const taken = takes.map((outcome) => must(outcome, "take the challenge"));

  const consumed = (await Promise.all([nonces.markConsumed("race", 900), nonces.markConsumed("race", 900), nonces.markConsumed("race", 900)])).map(
    (outcome) => must(outcome, "consume the nonce"),
  );

  must(await challenges.put("stale", record, -1), "put an expired challenge");
  const takeExpired = must(await challenges.take("stale"), "take the expired challenge");

  const beforePurge = await countOf(db, "auth_challenges");
  must(await purgeAuthEphemera(client, Date.now()), "purge");

  return {
    challengesTaken: taken.filter((value) => value !== null).length,
    challengeValue: taken.find((value) => value !== null) ?? null,
    noncesWon: consumed.filter(Boolean).length,
    takeExpired,
    beforePurge,
    challengesAfterPurge: await countOf(db, "auth_challenges"),
    noncesAfterPurge: await countOf(db, "auth_nonces"),
  };
}

async function probeEmailLength(db: D1Database): Promise<Record<string, unknown>> {
  const { users } = await storesOn(db);
  const long = `${"a".repeat(250)}@example.test`;
  const refused = await users.create({ email: long, emailKey: long }, AT);
  const accepted = await users.create({ email: "ada@example.test", emailKey: "ada@example.test" }, AT);
  return {
    refusedCode: refused.ok ? "accepted" : (refused.error as { code: string }).code,
    acceptedOk: accepted.ok,
    rows: await countOf(db, "auth_users"),
  };
}

async function probeAccessTokens(db: D1Database): Promise<Record<string, unknown>> {
  const { users, admins, accessTokens } = await storesOn(db);
  const person = async (local: string): Promise<string> =>
    must(await users.create({ email: `${local}@example.test`, emailKey: `${local}@example.test` }, AT), `create ${local}`).id;

  const kim = await person("kim");
  const lee = await person("lee");
  const hash = new Uint8Array(32).fill(2);
  const input = { userId: kim, tokenHash: hash, label: "CLI", scopes: ["notes:read"], expiresAt: null };
  const token = must(await accessTokens.create(input, AT), "issue kim's token");
  const duplicate = await accessTokens.create({ ...input, userId: lee }, AT);

  const INTERVAL_MS = 60_000;
  const use = async (at: number): Promise<boolean> => must(await accessTokens.recordUse(token.id, at, INTERVAL_MS), `use at ${at}`);
  const useFirst = await use(AT + 1);
  const useInsideInterval = await use(AT + INTERVAL_MS);
  const useAtEdge = await use(AT + 1 + INTERVAL_MS);

  const revokeByStranger = must(await accessTokens.revoke(token.id, lee, AT + 2), "revoke as stranger");
  const revokeByOwner = must(await accessTokens.revoke(token.id, kim, AT + 3), "revoke as owner");
  const revokeAgain = must(await accessTokens.revoke(token.id, kim, AT + 4), "revoke again");

  must(await admins.setDeactivated(kim, true, AT + 5, OPERATOR), "deactivate kim");
  const foundWhileDeactivated = must(await accessTokens.findByHash(hash), "find while deactivated")?.id ?? null;
  must(await admins.setDeactivated(kim, false, AT + 6, OPERATOR), "reactivate kim");
  const foundAfterReactivation = must(await accessTokens.findByHash(hash), "find after reactivation")?.id === token.id;

  return {
    duplicate: duplicate.ok ? "accepted" : { code: duplicate.error.code, constraint: duplicate.error.constraint },
    useFirst,
    useInsideInterval,
    useAtEdge,
    revokeByStranger,
    revokeByOwner,
    revokeAgain,
    foundWhileDeactivated,
    foundAfterReactivation,
  };
}

async function probeRecoveryCodes(db: D1Database): Promise<Record<string, unknown>> {
  const { users, admins, credentials, factors, recoveryCodes, sessions } = await storesOn(db);
  const person = async (local: string): Promise<string> =>
    must(await users.create({ email: `${local}@example.test`, emailKey: `${local}@example.test` }, AT), `create ${local}`).id;
  const code = (n: number) => new Uint8Array(32).fill(n);
  const attemptsOf = async (userId: string): Promise<number | null> =>
    must(await factors.find(userId, "recovery-code"), "find the code factor")?.failedAttempts ?? null;
  const LOCKOUT_MS = 60_000;
  const spend = async (userId: string, at: number) =>
    must(await factors.countAttempt(userId, "recovery-code", 5, at, LOCKOUT_MS), `spend at ${at}`);

  const mia = await person("mia");
  const noah = await person("noah");
  const totp = must(await factors.enrol({ userId: mia, kind: "totp-app", secret: new Uint8Array([9]), confirmedAt: AT }, AT), "enrol mia's totp");
  const factor = must(await factors.enrol({ userId: mia, kind: "recovery-code" }, AT), "enrol mia's codes");
  must(await recoveryCodes.stage(mia, [code(1), code(2)], AT + 1), "stage the first set");
  must(await recoveryCodes.commit(mia, factor.id, AT + 2, NO_ORIGIN), "commit the first set");
  const consume = async (userId: string, hash: number, at: number): Promise<boolean> =>
    must(await recoveryCodes.consume(userId, factor.id, code(hash), at, NO_ORIGIN), `consume ${hash} at ${at}`);

  const confirmedAt = must(await factors.find(mia, "recovery-code"), "find after commit")?.confirmedAt ?? null;
  await spend(mia, AT + 3);
  const consumeFirst = await consume(mia, 1, AT + 4);
  const attemptsAfterFirst = await attemptsOf(mia);
  await spend(mia, AT + 5);
  const consumeReplay = await consume(mia, 1, AT + 6);
  const attemptsAfterReplay = await attemptsOf(mia);
  const consumeByStranger = await consume(noah, 2, AT + 7);

  must(await recoveryCodes.stage(mia, [code(3), code(4)], AT + 8), "stage the second set");
  const consumeStaged = await consume(mia, 3, AT + 9);
  const heldStaged = must(await recoveryCodes.holdsStaged(mia, code(3)), "holds staged");
  const heldStagedByStranger = must(await recoveryCodes.holdsStaged(noah, code(3)), "holds staged as stranger");
  const remainingBeforeCommit = must(await recoveryCodes.remaining(mia), "remaining before commit");
  must(await recoveryCodes.commit(mia, factor.id, AT + 10, NO_ORIGIN), "commit the second set");
  const remainingAfterCommit = must(await recoveryCodes.remaining(mia), "remaining after commit");
  const consumeRetired = await consume(mia, 2, AT + 11);
  const consumeSwapped = await consume(mia, 4, AT + 12);

  const removeLastTotp = must(await factors.remove(totp.id, mia, 8_000, NO_ORIGIN, []), "remove mia's totp");
  const codesAfterRemove = await countOf(db, "auth_recovery_codes");
  const codeFactorsAfterRemove = await countOf(db, "auth_factors", "kind = 'recovery-code'");

  const olive = await person("olive");
  must(await factors.enrol({ userId: olive, kind: "totp-app", secret: new Uint8Array([9]), confirmedAt: AT }, AT), "enrol olive's totp");
  const oliveFactor = must(await factors.enrol({ userId: olive, kind: "recovery-code" }, AT), "enrol olive's codes");
  must(await recoveryCodes.stage(olive, [code(5)], AT + 13), "stage olive's codes");
  must(await recoveryCodes.commit(olive, oliveFactor.id, AT + 14, NO_ORIGIN), "commit olive's codes");
  must(
    await credentials.create(
      { userId: olive, credentialId: "olive-1", publicKey: new Uint8Array([1, 2, 3]), algorithm: -7, signCount: 0 },
      AT,
      NO_ORIGIN,
    ),
    "create olive's credential",
  );
  must(
    await sessions.create({ tokenHash: new Uint8Array(32).fill(3), userId: olive, signedInAt: AT, signedInWith: "email-otp" }, null),
    "sign olive in",
  );
  const resetFactors = must(await admins.resetFactors(olive, AT + 20, OPERATOR), "reset olive's factors");

  return {
    confirmedAt,
    consumeFirst,
    attemptsAfterFirst,
    consumeReplay,
    attemptsAfterReplay,
    consumeByStranger,
    consumeStaged,
    heldStaged,
    heldStagedByStranger,
    remainingBeforeCommit,
    remainingAfterCommit,
    consumeRetired,
    consumeSwapped,
    removeLastTotp,
    codesAfterRemove,
    codeFactorsAfterRemove,
    resetFactors,
    leftAfterReset: {
      auth_credentials: await countOf(db, "auth_credentials"),
      auth_factors: await countOf(db, "auth_factors"),
      auth_recovery_codes: await countOf(db, "auth_recovery_codes"),
      auth_sessions: await countOf(db, "auth_sessions"),
    },
  };
}

async function probeResetTokens(db: D1Database): Promise<Record<string, unknown>> {
  const { users, admins, accessTokens } = await storesOn(db);
  const person = async (local: string): Promise<string> =>
    must(await users.create({ email: `${local}@example.test`, emailKey: `${local}@example.test` }, AT), `create ${local}`).id;
  const service = createAccessTokenService({ store: accessTokens, prefix: "rt_", scopes: ["notes:read"], maxLifetimeMs: null });
  const issue = async (userId: string, label: string) => service.issue({ userId, label, scopes: ["notes:read"], expiresAt: null }, AT);
  const revokedAtByLabel = async (userId: string) =>
    Object.fromEntries(must(await accessTokens.listByUser(userId), "list tokens").map((token) => [token.label, token.revokedAt]));

  const app = new Forge();
  app.use("*", requireBearer({ tokens: () => service, scopes: ["notes:read"], now: () => AT + 30 }));
  mapHandler(app, "GET", "/api", () => new Response("admitted"));
  const bearer = async (token: string): Promise<string> => {
    const res = await app.request("/api", { headers: { Authorization: `Bearer ${token}` } });
    return `${res.status} ${res.headers.get("WWW-Authenticate")}`;
  };

  const rae = await person("rae");
  const sam = await person("sam");
  const cli = must(await issue(rae, "cli"), "issue rae's cli token").token;
  must(await issue(rae, "ci"), "issue rae's ci token");
  const retired = must(await issue(rae, "retired"), "issue rae's retired token");
  must(await accessTokens.revoke(retired.accessToken.id, rae, AT + 1), "revoke rae's retired token");
  const samToken = must(await issue(sam, "sam-cli"), "issue sam's token").token;
  const bearerBeforeReset = await bearer(cli);

  const resetFactors = must(await admins.resetFactors(rae, AT + 20, OPERATOR), "reset rae's factors");
  return {
    resetFactors,
    bearerBeforeReset,
    bearerAfterReset: await bearer(cli),
    bearerStrangerAfterReset: await bearer(samToken),
    revokedAt: { rae: await revokedAtByLabel(rae), sam: await revokedAtByLabel(sam) },
  };
}

async function probeReferenced(db: D1Database): Promise<Record<string, unknown>> {
  await db.prepare("DROP TABLE IF EXISTS probe_owned").run();
  const { users, admins, factors } = await storesOn(db);
  await db.prepare("CREATE TABLE probe_owned (id INTEGER PRIMARY KEY NOT NULL, owner_id BLOB NOT NULL REFERENCES auth_users(id))").run();
  const kim = must(await users.create({ email: "kim@example.test", emailKey: "kim@example.test" }, AT), "create kim").id;
  must(await factors.enrol({ userId: kim, kind: "passkey" }, AT), "enrol kim's passkey");
  await db.prepare("INSERT INTO probe_owned (id, owner_id) VALUES (1, ?)").bind(uuidToBytes(kim)).run();

  const refused = must(await admins.remove(kim), "delete referenced kim");
  const userKept = await countOf(db, "auth_users");
  const factorKept = await countOf(db, "auth_factors");
  const unknownOwner = await factors.enrol({ userId: uuidv7(), kind: "passkey" }, AT);
  const unknownOwnerCode = unknownOwner.ok ? "accepted" : unknownOwner.error.code;

  await db.prepare("DELETE FROM probe_owned").run();
  const afterClearing = must(await admins.remove(kim), "delete kim after clearing");
  await db.prepare("DROP TABLE probe_owned").run();
  return { refused, userKept, factorKept, unknownOwnerCode, afterClearing };
}

/** The starter's shape: the authenticator app mandatory, a passkey optional. */
const APP_MANDATORY = ["totp-app"] as const;
const BOTH_MANDATORY = ["totp-app", "passkey"] as const;

async function probeSecondFactorFloor(db: D1Database): Promise<Record<string, unknown>> {
  const { users, admins, credentials, factors, sessions } = await storesOn(db);
  const person = async (local: string): Promise<string> =>
    must(await users.create({ email: `${local}@example.test`, emailKey: `${local}@example.test` }, AT), `create ${local}`).id;
  const passkey = async (userId: string, credentialId: string): Promise<string> =>
    must(
      await credentials.create({ userId, credentialId, publicKey: new Uint8Array([1, 2, 3]), algorithm: -7, signCount: 0 }, AT, NO_ORIGIN),
      `create ${credentialId}`,
    ).id;
  const enrol = async (userId: string, kind: "passkey" | "totp-app", confirmedAt: number | null): Promise<string> =>
    must(await factors.enrol({ userId, kind, secret: kind === "totp-app" ? new Uint8Array([9]) : null, confirmedAt }, AT), `enrol ${kind}`).id;
  const signIn = async (userId: string, fill: number) =>
    must(await sessions.create({ tokenHash: new Uint8Array(32).fill(fill), userId, signedInAt: AT, signedInWith: "email-otp" }, null), "sign in");
  const ownedBy = async (table: string, userId: string, where = "1"): Promise<number> => {
    const row = await db
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ? AND ${where}`)
      .bind(uuidToBytes(userId))
      .first<{ n: number }>();
    return row?.n ?? 0;
  };
  const kindsHeld = async (userId: string): Promise<string[]> => {
    const rows = await db
      .prepare("SELECT kind FROM auth_factors WHERE user_id = ? AND confirmed_at IS NOT NULL AND kind IN ('totp-app', 'passkey') ORDER BY kind")
      .bind(uuidToBytes(userId))
      .all<{ kind: string }>();
    return rows.results.map((row) => row.kind);
  };
  const left = async (userId: string) => ({
    secondFactors: await ownedBy("auth_factors", userId, "kind IN ('totp-app', 'passkey') AND confirmed_at IS NOT NULL"),
    removedEvents: await ownedBy("auth_security_events", userId, "type = 'factor-removed'"),
    sessions: await ownedBy("auth_sessions", userId),
  });

  const pia = await person("pia");
  await enrol(pia, "passkey", AT);
  const piaFirst = await passkey(pia, "pia-1");
  const piaSecond = await passkey(pia, "pia-2");
  await signIn(pia, 11);
  const passkeyPair = (
    await Promise.all([
      credentials.removeForUser(piaFirst, pia, AT + 1, NO_ORIGIN, BOTH_MANDATORY),
      credentials.removeForUser(piaSecond, pia, AT + 1, NO_ORIGIN, BOTH_MANDATORY),
    ])
  ).map((outcome) => must(outcome, "concurrent passkey removal"));

  const quinn = await person("quinn");
  const quinnTotp = await enrol(quinn, "totp-app", AT);
  await enrol(quinn, "passkey", AT);
  const quinnKey = await passkey(quinn, "quinn-1");
  await signIn(quinn, 12);
  const totpAndPasskey = (
    await Promise.all([
      factors.remove(quinnTotp, quinn, AT + 1, NO_ORIGIN, APP_MANDATORY),
      credentials.removeForUser(quinnKey, quinn, AT + 1, NO_ORIGIN, APP_MANDATORY),
    ])
  ).map((outcome) => must(outcome, "concurrent totp and passkey removal"));

  const rhea = await person("rhea");
  const rheaTotp = await enrol(rhea, "totp-app", AT);
  await signIn(rhea, 13);
  const lastRefused = must(await factors.remove(rheaTotp, rhea, AT + 1, NO_ORIGIN, APP_MANDATORY), "remove rhea's last totp");
  const rheaAfterRefusal = await left(rhea);
  const resetAtMinimum = must(await admins.resetFactors(rhea, AT + 2, OPERATOR), "reset rhea");

  const saul = await person("saul");
  await enrol(saul, "passkey", AT);
  await passkey(saul, "saul-1");
  const saulPending = await enrol(saul, "totp-app", null);
  const pendingRemoved = must(await factors.remove(saulPending, saul, AT + 1, NO_ORIGIN, APP_MANDATORY), "remove saul's pending totp");

  const tess = await person("tess");
  await enrol(tess, "passkey", AT);
  const tessKey = await passkey(tess, "tess-1");
  await signIn(tess, 14);
  const lastOptionalPasskey = must(await credentials.removeForUser(tessKey, tess, AT + 1, NO_ORIGIN, APP_MANDATORY), "remove tess's last passkey");

  const ivy = await person("ivy");
  await enrol(ivy, "passkey", AT);
  const ivyKey = await passkey(ivy, "ivy-1");
  await signIn(ivy, 16);
  const lastPasskeyRefused = must(await credentials.removeForUser(ivyKey, ivy, AT + 1, NO_ORIGIN, BOTH_MANDATORY), "remove ivy's last passkey");

  const uma = await person("uma");
  await enrol(uma, "passkey", null);
  const umaKey = await passkey(uma, "uma-1");
  const umaTotp = await enrol(uma, "totp-app", AT);
  const unconfirmedPasskey = {
    totpRemoval: must(await factors.remove(umaTotp, uma, AT + 1, NO_ORIGIN, BOTH_MANDATORY), "remove uma's totp"),
    passkeyRemoval: must(await credentials.removeForUser(umaKey, uma, AT + 1, NO_ORIGIN, BOTH_MANDATORY), "remove uma's passkey"),
  };

  const vic = await person("vic");
  const vicTotp = await enrol(vic, "totp-app", AT);
  await enrol(vic, "passkey", AT);
  const vicKey = await passkey(vic, "vic-1");
  const kindOutsideFloor = {
    passkeyUnderPasskeyFloor: must(await credentials.removeForUser(vicKey, vic, AT + 1, NO_ORIGIN, ["passkey"]), "remove vic's passkey"),
    totpUnderTotpFloor: must(await factors.remove(vicTotp, vic, AT + 1, NO_ORIGIN, ["totp-app"]), "remove vic's totp"),
    passkeyUnderTotpFloor: must(await credentials.removeForUser(vicKey, vic, AT + 1, NO_ORIGIN, ["totp-app"]), "remove vic's passkey"),
    totpUnderPasskeyFloor: must(await factors.remove(vicTotp, vic, AT + 1, NO_ORIGIN, ["passkey"]), "remove vic's totp"),
  };

  const wade = await person("wade");
  const wadePending = await enrol(wade, "totp-app", null);
  await signIn(wade, 15);
  const onlyPendingRemoved = must(await factors.remove(wadePending, wade, AT + 1, NO_ORIGIN, APP_MANDATORY), "remove wade's pending totp");

  return {
    lastOptionalPasskey,
    tessLeft: { ...(await left(tess)), credentials: await ownedBy("auth_credentials", tess) },
    lastPasskeyRefused,
    ivyLeft: { ...(await left(ivy)), credentials: await ownedBy("auth_credentials", ivy) },
    unconfirmedPasskey,
    umaLeft: { ...(await left(uma)), credentials: await ownedBy("auth_credentials", uma) },
    kindOutsideFloor,
    vicLeft: { ...(await left(vic)), credentials: await ownedBy("auth_credentials", vic) },
    onlyPendingRemoved,
    wadeLeft: { ...(await left(wade)), factors: await ownedBy("auth_factors", wade) },
    passkeyPair: [...passkeyPair].sort(),
    piaLeft: { ...(await left(pia)), credentials: await ownedBy("auth_credentials", pia) },
    // Call order, not sorted: under APP_MANDATORY each kind's outcome is fixed, so the order names which was refused.
    totpAndPasskey: { totp: totpAndPasskey[0], passkey: totpAndPasskey[1] },
    quinnLeft: { ...(await left(quinn)), kinds: await kindsHeld(quinn), credentials: await ownedBy("auth_credentials", quinn) },
    lastRefused,
    rheaAfterRefusal,
    resetAtMinimum,
    rheaAfterReset: await left(rhea),
    pendingRemoved,
    saulLeft: await left(saul),
  };
}

const DAY = 86_400_000;

async function probeStaleTotpPurge(db: D1Database): Promise<Record<string, unknown>> {
  const { client, users, credentials, factors, recoveryCodes } = await storesOn(db);
  const person = async (local: string): Promise<string> =>
    must(await users.create({ email: `${local}@example.test`, emailKey: `${local}@example.test` }, AT), `create ${local}`).id;
  const totp = async (userId: string, at: number) =>
    must(await factors.enrol({ userId, kind: "totp-app", secret: new Uint8Array([9]), confirmedAt: at }, at), "enrol totp");
  const passkey = async (userId: string, confirmedAt: number | null) => {
    must(await factors.enrol({ userId, kind: "passkey", confirmedAt }, AT), "enrol passkey");
    must(
      await credentials.create(
        { userId, credentialId: `${userId}-key`, publicKey: new Uint8Array([1, 2, 3]), algorithm: -7, signCount: 0 },
        AT,
        NO_ORIGIN,
      ),
      "create credential",
    );
  };
  const codes = async (userId: string, commit: boolean) => {
    const factor = must(await factors.enrol({ userId, kind: "recovery-code" }, AT), "enrol codes");
    must(await recoveryCodes.stage(userId, [new Uint8Array(32).fill(7)], AT), "stage codes");
    if (commit) must(await recoveryCodes.commit(userId, factor.id, AT, NO_ORIGIN), "commit codes");
    return factor.id;
  };
  const held = async (userId: string) => ({
    totp: must(await factors.find(userId, "totp-app"), "find totp") !== null,
    codes: must(await recoveryCodes.remaining(userId), "remaining codes"),
  });

  const totpOnly = await person("xena");
  await totp(totpOnly, AT);
  const withPasskey = await person("yuri");
  await totp(withPasskey, AT);
  await passkey(withPasskey, AT);
  const withCodes = await person("zack");
  await totp(withCodes, AT);
  await codes(withCodes, true);
  const unconfirmedPasskey = await person("abel");
  await totp(unconfirmedPasskey, AT);
  await passkey(unconfirmedPasskey, null);
  const stagedCodes = await person("bea");
  await totp(stagedCodes, AT);
  await codes(stagedCodes, false);
  const fresh = await person("cleo");
  await totp(fresh, AT + DAY + 1);
  const usedCodes = await person("dina");
  await totp(usedCodes, AT);
  const usedFactor = await codes(usedCodes, true);
  const spent = must(await recoveryCodes.consume(usedCodes, usedFactor, new Uint8Array(32).fill(7), AT + 1, NO_ORIGIN), "consume dina's code");
  const pendingTotp = await person("emil");
  must(await factors.enrol({ userId: pendingTotp, kind: "totp-app", secret: new Uint8Array([9]) }, AT), "enrol emil's pending totp");
  const secondTotp = await factors.enrol(
    { userId: totpOnly, kind: "totp-app", secret: new Uint8Array([9]), confirmedAt: AT + DAY + 1 },
    AT + DAY + 1,
  );

  const report = must(
    await purgeStaleTotpSecrets(client, AT + 2 * DAY, {
      keys: { activeKeyId: "AAAAAAAA", keys: {} },
      idleForMs: DAY,
      factors: { offered: ["totp-app", "passkey"], mandatory: APP_MANDATORY },
    }),
    "purge stale totp secrets",
  );
  return {
    report,
    totpOnly: await held(totpOnly),
    withPasskey: await held(withPasskey),
    withCodes: await held(withCodes),
    unconfirmedPasskey: await held(unconfirmedPasskey),
    stagedCodes: await held(stagedCodes),
    fresh: await held(fresh),
    usedCodes: { spent, ...(await held(usedCodes)) },
    pendingTotp: await held(pendingTotp),
    secondTotp: secondTotp.ok ? "enrolled" : secondTotp.error.code,
  };
}

async function probeGuards(db: D1Database): Promise<Response> {
  return json({
    lastAdmin: await probeLastAdmin(db),
    firstAdmin: await probeFirstAdmin(db),
    deactivatedAdmin: await probeDeactivatedAdmin(db),
    ownership: await probeOwnershipAndCounter(db),
    ephemera: await probeEphemera(db),
    emailLength: await probeEmailLength(db),
    accessTokens: await probeAccessTokens(db),
    recoveryCodes: await probeRecoveryCodes(db),
    resetTokens: await probeResetTokens(db),
    referenced: await probeReferenced(db),
    secondFactorFloor: await probeSecondFactorFloor(db),
    staleTotpPurge: await probeStaleTotpPurge(db),
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === "/apply" && request.method === "POST") return await applySchema(env.DB, await request.text());
      if (pathname === "/strict") return await probeStrict(env.DB);
      if (pathname === "/batch") return await probeBatch(env.DB);
      if (pathname === "/foreign-keys") return await probeForeignKeys(env.DB);
      if (pathname === "/blob") return await probeBlob(env.DB);
      if (pathname === "/changes") return await probeChanges(env.DB);
      if (pathname === "/rows-written") return await probeRowsWritten(env.DB);
      if (pathname === "/guards") return await probeGuards(env.DB);
    } catch (thrown) {
      return json({ unexpected: messageOf(thrown) });
    }
    return new Response("not found", { status: 404 });
  },
};
