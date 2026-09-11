// Four questions about D1 that a fake cannot answer, asked of the real thing: does it accept and
// enforce `STRICT`, what does a mid-batch failure leave behind, what JavaScript shape does a BLOB
// column read back as, and which rows-affected field a write populates. The spec posts
// `src/auth/schema.sql` here rather than importing it, so what runs is the file a consumer would apply.
//
// `/guards` then runs the shipped store adapters themselves against that schema, because a guard
// answered by a fake is a guard whose SQL was never executed.
import { createAdminUserStore } from "../../../src/auth/stores/admin-users";
import { createChallengeStore } from "../../../src/auth/stores/challenges";
import { createCredentialStore } from "../../../src/auth/stores/credentials";
import { purgeAuthEphemera } from "../../../src/auth/stores/ephemera";
import { createFactorStore } from "../../../src/auth/stores/factors";
import { createIdentityLinkStore } from "../../../src/auth/stores/identity-links";
import { createNonceStore } from "../../../src/auth/stores/nonces";
import { createOtpStateStore } from "../../../src/auth/stores/otp-state";
import { createUserStore } from "../../../src/auth/stores/users";
import type { Result } from "../../../src/result/result";
import { createD1Client } from "../../../src/storage/db/client";

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

// `wrangler dev` persists this database under the fixture, so a table created by an earlier run
// outlives the schema that created it: `CREATE TABLE IF NOT EXISTS` then silently keeps the old
// columns and a new index over a new one fails. The spec drops them before it applies anything.
async function resetSchema(db: D1Database): Promise<Response> {
  const tables = ["auth_nonces", "auth_challenges", "auth_otp_state", "auth_identity_links", "auth_credentials", "auth_factors", "auth_users"];
  for (const table of tables) await db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
  return json({ dropped: tables });
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

/** What one write reported, in both fields the client reads and in the order it reads them. */
async function writeMeta(db: D1Database, sql: string, ...params: unknown[]): Promise<Record<string, unknown>> {
  const meta = (
    await db
      .prepare(sql)
      .bind(...params)
      .run()
  ).meta as Record<string, unknown>;
  return {
    rows_written: meta.rows_written ?? null,
    changes: meta.changes ?? null,
    // What `createD1Client` actually returns for this write.
    resolved: meta.rows_written ?? meta.changes ?? 0,
  };
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
    // The refusal path exactly as a guard writes it: the row exists, the guard is what fails.
    updateGuardRefused: await writeMeta(db, "UPDATE probe_rows SET n = ? WHERE id = ? AND n > ?", 12, 1, 1_000),
    // A matched row whose value does not change — SQLite counts it, and a guard must not read that as a refusal.
    updateNoOp: await writeMeta(db, "UPDATE probe_rows SET n = ? WHERE id = ?", 11, 1),
    deleteMatched: await writeMeta(db, "DELETE FROM probe_rows WHERE id = ?", 2),
    deleteUnmatched: await writeMeta(db, "DELETE FROM probe_rows WHERE id = ?", 404),
  });
}

function must<T>(outcome: Result<T>, what: string): T {
  if (!outcome.ok) throw new Error(`${what}: ${messageOf(outcome.error)}`);
  return outcome.data;
}

async function countOf(db: D1Database, table: string, where = "1"): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).first<{ n: number }>();
  return row?.n ?? 0;
}

const AT = 1_700_000_000_000;

/** Every store the guards live in, over one client, on an empty set of tables. */
async function storesOn(db: D1Database) {
  for (const table of [
    "auth_nonces",
    "auth_challenges",
    "auth_otp_state",
    "auth_identity_links",
    "auth_credentials",
    "auth_factors",
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
  };
}

// Each scenario starts from empty tables, so no earlier one's surviving admin answers a later
// one's guard. Every value below is decided by the shipped adapters' SQL, run by real D1.
async function probeLastAdmin(db: D1Database): Promise<Record<string, unknown>> {
  const { users, admins } = await storesOn(db);
  const admin = async (local: string): Promise<string> =>
    must(await users.create({ email: `${local}@example.test`, emailKey: `${local}@example.test`, isAdmin: true }, AT), `create ${local}`).id;

  const alice = await admin("alice");
  const bob = await admin("bob");
  const demotions = (await Promise.all([admins.setAdmin(alice, false, AT + 1), admins.setAdmin(bob, false, AT + 1)])).map((outcome) =>
    must(outcome, "concurrent demote"),
  );
  return { demotions: [...demotions].sort(), adminsLeft: must(await admins.countAdmins(), "countAdmins") };
}

async function probeDeactivatedAdmin(db: D1Database): Promise<Record<string, unknown>> {
  const { users, admins } = await storesOn(db);
  const admin = async (local: string): Promise<string> =>
    must(await users.create({ email: `${local}@example.test`, emailKey: `${local}@example.test`, isAdmin: true }, AT), `create ${local}`).id;

  const carol = await admin("carol");
  const dave = await admin("dave");
  const gina = await admin("gina");
  return {
    deactivateDave: must(await admins.setDeactivated(dave, true, AT + 1), "deactivate dave"),
    deactivateGina: must(await admins.setDeactivated(gina, true, AT + 2), "deactivate gina"),
    // Both are still admins by column, and neither could sign in to undo a lockout.
    demoteDeactivated: must(await admins.setAdmin(dave, false, AT + 3), "demote dave"),
    removeDeactivated: must(await admins.remove(gina), "delete gina"),
    demoteLastActive: must(await admins.setAdmin(carol, false, AT + 4), "demote carol"),
    removeLastActive: must(await admins.remove(carol), "delete carol"),
  };
}

async function probeOwnershipAndCounter(db: D1Database): Promise<Record<string, unknown>> {
  const { users, admins, credentials, factors, links, otp } = await storesOn(db);
  const person = async (local: string): Promise<string> =>
    must(await users.create({ email: `${local}@example.test`, emailKey: `${local}@example.test` }, AT), `create ${local}`).id;

  const erin = await person("erin");
  const frank = await person("frank");
  const credential = async (id: string) =>
    must(
      await credentials.create({ userId: erin, credentialId: id, publicKey: new Uint8Array([1, 2, 3]), algorithm: -7, signCount: 0 }, AT),
      `create ${id}`,
    );
  const first = await credential("erin-1");
  await credential("erin-2");
  const factor = must(await factors.enrol({ userId: erin, kind: "totp-app", secret: new Uint8Array([9]) }, AT), "enrol factor");
  const link = must(await links.link({ userId: erin, provider: "github", subject: "erin" }, AT), "link erin");
  must(await otp.issue(erin, { token: "c2VhbGVk", attempts: 0, issuedAt: AT, expiresAt: AT + 600_000 }, 60_000), "issue erin's code");

  // Two guesses of a budget of two, then a third that the statement refuses before any code is
  // compared — until the lockout window has run from the last admitted guess, when the next one
  // reopens the budget at a count of one. An accepted step clears it outright.
  const LOCKOUT_MS = 60_000;
  // One statement now answers the row too, so the count it reports is the count that guess wrote —
  // there is no second read for a parallel guess to slip between.
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
    removeByStranger: must(await credentials.removeForUser(first.id, frank), "remove as stranger"),
    removeByOwner: must(await credentials.removeForUser(first.id, erin), "remove as owner"),
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
    revokeSessions: must(await users.revokeSessions(erin, AT + 10), "revoke erin's sessions"),
    revokeSessionsBackwards: must(await users.revokeSessions(erin, AT + 9), "revoke backwards"),
    advanceByStranger: must(await factors.advanceCounter(factor.id, frank, 57, AT + 5), "advance as stranger"),
    advanceFirst: must(await factors.advanceCounter(factor.id, erin, 57, AT + 6), "advance 57"),
    advanceReplay: must(await factors.advanceCounter(factor.id, erin, 57, AT + 7), "replay 57"),
    // Zero again: the accepted step is what clears the guesses, so this is the reset holding.
    spentAfterAdvance: await countOf(db, "auth_factors", "failed_attempts > 0"),
    confirmByStranger: must(await factors.confirm(factor.id, frank, AT + 8), "confirm as stranger"),
    removeFactorByStranger: must(await factors.remove(factor.id, frank), "remove factor as stranger"),
    removeUser: must(await admins.remove(erin), "delete erin"),
    leftBehind: {
      auth_credentials: await countOf(db, "auth_credentials"),
      auth_factors: await countOf(db, "auth_factors"),
      auth_identity_links: await countOf(db, "auth_identity_links"),
      auth_otp_state: await countOf(db, "auth_otp_state"),
      auth_users: await countOf(db, "auth_users"),
    },
  };
}

// The claim the move off KV rests on: one challenge is taken once, and one nonce is consumed once,
// however many requests ask at the same moment. A fake cannot settle either — both are the database
// serialising writers, not anything the adapter does.
async function probeEphemera(db: D1Database): Promise<Record<string, unknown>> {
  const { client, challenges, nonces } = await storesOn(db);
  const record = { challenge: "Y2hhbGxlbmdl", sessionId: "sess-1" };

  must(await challenges.put("race", record, 300), "put the challenge");
  const takes = await Promise.all([challenges.take("race"), challenges.take("race"), challenges.take("race")]);
  const taken = takes.map((outcome) => must(outcome, "take the challenge"));

  const consumed = (await Promise.all([nonces.markConsumed("race", 900), nonces.markConsumed("race", 900), nonces.markConsumed("race", 900)])).map(
    (outcome) => must(outcome, "consume the nonce"),
  );

  // Expiry is the predicate on the read, never a row being gone: a challenge written already dead
  // is invisible, and a purge only reclaims the space it left.
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
    // A consumed nonce is still live, so the purge leaves it: only the dead rows go.
    noncesAfterPurge: await countOf(db, "auth_nonces"),
  };
}

// The web schema caps a typed address at 254 characters before `normalizeEmail` NFKC-expands it, so
// the CHECK is the backstop — and `storeError` must call it the caller's fault, not an outage.
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

async function probeGuards(db: D1Database): Promise<Response> {
  return json({
    lastAdmin: await probeLastAdmin(db),
    deactivatedAdmin: await probeDeactivatedAdmin(db),
    ownership: await probeOwnershipAndCounter(db),
    ephemera: await probeEphemera(db),
    emailLength: await probeEmailLength(db),
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === "/reset" && request.method === "POST") return await resetSchema(env.DB);
      if (pathname === "/apply" && request.method === "POST") return await applySchema(env.DB, await request.text());
      if (pathname === "/strict") return await probeStrict(env.DB);
      if (pathname === "/batch") return await probeBatch(env.DB);
      if (pathname === "/blob") return await probeBlob(env.DB);
      if (pathname === "/rows-written") return await probeRowsWritten(env.DB);
      if (pathname === "/guards") return await probeGuards(env.DB);
    } catch (thrown) {
      return json({ unexpected: messageOf(thrown) });
    }
    return new Response("not found", { status: 404 });
  },
};
