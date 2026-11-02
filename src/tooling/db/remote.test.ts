import { describe, expect, it } from "bun:test";

import { CfApiClientError } from "../cf/api/types";
import { CliError } from "../cli/errors";
import { cfEnvelope, cfRefusal, fakeDbIo, REMOTE_AUTH } from "./db.fixture";
import {
  D1_BATCH_MAX_BYTES,
  D1_BATCH_MAX_STATEMENTS,
  D1_STATEMENT_MAX_BYTES,
  executeDeployed,
  isD1ResultOverCap,
  queryDeployed,
  readDeployedBookmark,
  restoreDeployedBookmark,
} from "./remote";
import type { FakeDbIo, Home } from "./types";

const DB_ID = "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a";
const PREVIEW_ID = "1a2b3c4d-1b2c-4d3e-8f9a-0b1c2d3e4f5a";

const REMOTE: Home = {
  label: "remote",
  database: "app-db",
  binding: "DB",
  dir: "/app",
  configPath: "/app/wrangler.jsonc",
  persistTo: null,
  place: "remote",
  env: null,
  databaseId: DB_ID,
  auth: REMOTE_AUTH,
  synthesized: false,
};

const PREVIEW: Home = { ...REMOTE, label: "preview", place: "preview", databaseId: PREVIEW_ID };

const BASE = `https://api.cloudflare.com/client/v4/accounts/acct/d1/database/${DB_ID}`;
const QUERY_OPERATION = "POST /accounts/{account_id}/d1/database/{database_id}/query";

function remoteIo(): FakeDbIo {
  return fakeDbIo({}, { homes: [REMOTE, PREVIEW] });
}

async function capture(run: () => Promise<unknown>): Promise<CliError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  throw new Error("expected a CliError");
}

function replyTo(io: FakeDbIo, suffix: string, ...responses: Response[]): void {
  let next = 0;
  io.restRules.push({
    match: (url) => new URL(url).pathname.endsWith(suffix),
    reply: () => {
      const response = responses[Math.min(next, responses.length - 1)];
      next += 1;
      if (response === undefined) throw new Error("no reply queued");
      return response.clone();
    },
  });
}

function bodyOf(io: FakeDbIo, index: number): unknown {
  return JSON.parse(io.restCalls[index]?.body ?? "null");
}

function echoStatements(io: FakeDbIo): FakeDbIo {
  io.restRules.push({
    match: (url) => new URL(url).pathname.endsWith("/query"),
    reply: (_url, init) => {
      const { batch } = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { batch: { sql: string }[] };
      return cfEnvelope(batch.map(({ sql }) => ({ results: [{ sql }], success: true })));
    },
  });
  return io;
}

describe("queryDeployed()", () => {
  it("posts the batch to the database's query path with the token as a bearer credential", async () => {
    const io = remoteIo();
    replyTo(io, "/query", cfEnvelope([{ results: [] }, { results: [] }]));
    await queryDeployed(io, REMOTE, ["SELECT 1", "SELECT 2"], "query");
    expect(io.restCalls).toHaveLength(1);
    expect(io.restCalls[0]).toMatchObject({ url: `${BASE}/query`, method: "POST" });
    expect(io.restCalls[0]?.headers.authorization).toBe("Bearer tok");
    expect(bodyOf(io, 0)).toEqual({ batch: [{ sql: "SELECT 1" }, { sql: "SELECT 2" }] });
  });

  it("returns each statement's rows in order", async () => {
    const io = remoteIo();
    replyTo(io, "/query", cfEnvelope([{ results: [{ n: 1 }], success: true, meta: {} }, { results: [{ n: 2 }] }]));
    expect(await queryDeployed(io, REMOTE, ["SELECT 1 AS n", "SELECT 2 AS n"], "query")).toEqual([[{ n: 1 }], [{ n: 2 }]]);
  });

  it("sends a statement verbatim, adding no terminator", async () => {
    const io = remoteIo();
    replyTo(io, "/query", cfEnvelope([{ results: [] }, { results: [] }]));
    await queryDeployed(io, REMOTE, ["SELECT 1", "SELECT 2;\n"], "query");
    expect(bodyOf(io, 0)).toEqual({ batch: [{ sql: "SELECT 1" }, { sql: "SELECT 2;\n" }] });
  });

  it("sends a read batch over the byte budget as ordered requests whose answers line up with the statements", async () => {
    const io = echoStatements(remoteIo());
    const statements = Array.from({ length: 5 }, (_, index) => `SELECT ${index} AS n, '${"x".repeat(30_000)}' AS pad`);
    const answers = await queryDeployed(io, REMOTE, statements, "query");
    expect(io.restCalls.length).toBeGreaterThan(1);
    expect(io.restCalls.every((call) => new TextEncoder().encode(call.body ?? "").length <= D1_BATCH_MAX_BYTES)).toBe(true);
    expect(io.restCalls.flatMap((call) => (JSON.parse(call.body ?? "{}") as { batch: { sql: string }[] }).batch.map(({ sql }) => sql))).toEqual(
      statements,
    );
    expect(answers).toEqual(statements.map((sql) => [{ sql }]));
  });

  it("splits a read batch at the statement cap", async () => {
    const io = echoStatements(remoteIo());
    const statements = Array.from({ length: D1_BATCH_MAX_STATEMENTS + 1 }, (_, index) => `SELECT ${index}`);
    expect(await queryDeployed(io, REMOTE, statements, "query")).toEqual(statements.map((sql) => [{ sql }]));
    expect(io.restCalls.map((call) => (JSON.parse(call.body ?? "{}") as { batch: unknown[] }).batch.length)).toEqual([D1_BATCH_MAX_STATEMENTS, 1]);
  });

  it("measures the budget in UTF-8 bytes, not UTF-16 units", async () => {
    const io = echoStatements(remoteIo());
    const statements = [`SELECT '${"é".repeat(20_000)}'`, `SELECT '${"é".repeat(20_000)}'`];
    await queryDeployed(io, REMOTE, statements, "query");
    expect(io.restCalls).toHaveLength(2);
  });

  it("sends a batch that fits the budget as one request", async () => {
    const io = echoStatements(remoteIo());
    const statements = [`SELECT '${"x".repeat(30_000)}'`, `SELECT '${"y".repeat(30_000)}'`];
    expect(await queryDeployed(io, REMOTE, statements, "query")).toEqual(statements.map((sql) => [{ sql }]));
    expect(io.restCalls).toHaveLength(1);
  });

  it("sends one statement over the budget but under D1's statement limit alone", async () => {
    const io = echoStatements(remoteIo());
    const statements = ["SELECT 1", `SELECT '${"x".repeat(90_000)}'`, "SELECT 2"];
    expect(await queryDeployed(io, REMOTE, statements, "query")).toEqual(statements.map((sql) => [{ sql }]));
    expect(io.restCalls).toHaveLength(3);
  });

  it("refuses a statement over D1's 100 KB limit before any request, naming the caller's query", async () => {
    const io = echoStatements(remoteIo());
    const statement = `SELECT '${"x".repeat(101 * 1024)}'`;
    const error = await capture(() => queryDeployed(io, REMOTE, ["SELECT 1", statement], "query `SELECT big`"));
    expect(error.message).toBe(
      `query \`SELECT big\` against remote (app-db) failed: statement 2 is ${statement.length} bytes, over D1's ${D1_STATEMENT_MAX_BYTES}-byte statement limit`,
    );
    expect(io.restCalls).toEqual([]);
  });

  it("refuses a write batch that would need more than one request before any request", async () => {
    const io = echoStatements(remoteIo());
    const statements = [`INSERT INTO t VALUES ('${"x".repeat(40_000)}')`, `INSERT INTO t VALUES ('${"y".repeat(40_000)}')`];
    const error = await capture(() => queryDeployed(io, REMOTE, statements, "seed"));
    expect(error.message).toBe(
      "seed against remote (app-db) failed: a batch holding a write has to go as one request, and these 2 statements exceed one",
    );
    expect(io.restCalls).toEqual([]);
  });

  it("numbers an unsuccessful statement in a later request by its place in the whole batch", async () => {
    const io = remoteIo();
    replyTo(
      io,
      "/query",
      cfEnvelope(Array.from({ length: D1_BATCH_MAX_STATEMENTS }, () => ({ results: [], success: true }))),
      cfEnvelope([{ results: [], success: false }]),
    );
    const statements = Array.from({ length: D1_BATCH_MAX_STATEMENTS + 1 }, (_, index) => `SELECT ${index}`);
    expect((await capture(() => queryDeployed(io, REMOTE, statements, "query"))).message).toBe(
      `query against remote (app-db) failed: D1 reported statement ${D1_BATCH_MAX_STATEMENTS + 1} unsuccessful`,
    );
  });

  it("sends a statement of exactly D1's documented 100,000 bytes, alone", async () => {
    const io = echoStatements(remoteIo());
    const statement = `SELECT '${"x".repeat(100_000 - "SELECT ''".length)}'`;
    expect(await queryDeployed(io, REMOTE, ["SELECT 1", statement], "query")).toEqual([[{ sql: "SELECT 1" }], [{ sql: statement }]]);
    expect(io.restCalls.map((_, index) => bodyOf(io, index))).toEqual([{ batch: [{ sql: "SELECT 1" }] }, { batch: [{ sql: statement }] }]);
  });

  it("refuses a statement one byte over D1's documented 100,000 bytes before any request", async () => {
    const io = echoStatements(remoteIo());
    const statement = `SELECT '${"x".repeat(100_001 - "SELECT ''".length)}'`;
    expect((await capture(() => queryDeployed(io, REMOTE, [statement], "query"))).message).toBe(
      "query against remote (app-db) failed: statement 1 is 100001 bytes, over D1's 100000-byte statement limit",
    );
    expect(io.restCalls).toEqual([]);
  });

  it("packs two statements whose body exactly fills the budget into one request, and splits them one byte over", async () => {
    const pad = (n: number) => [`SELECT '${"x".repeat(n)}'`, "SELECT 1"];
    const bodyBytes = (statements: string[]) => new TextEncoder().encode(JSON.stringify({ batch: statements.map((sql) => ({ sql })) })).length;
    const filling = D1_BATCH_MAX_BYTES - bodyBytes(pad(0));

    const exact = echoStatements(remoteIo());
    await queryDeployed(exact, REMOTE, pad(filling), "query");
    expect(exact.restCalls).toHaveLength(1);

    const over = echoStatements(remoteIo());
    await queryDeployed(over, REMOTE, pad(filling + 1), "query");
    expect(over.restCalls).toHaveLength(2);
  });

  it("stops at a request midway whose statement D1 reports unsuccessful, numbering it in the whole batch and sending no later request", async () => {
    const io = remoteIo();
    const succeeded = Array.from({ length: D1_BATCH_MAX_STATEMENTS }, () => ({ results: [], success: true }));
    replyTo(
      io,
      "/query",
      cfEnvelope(succeeded),
      cfEnvelope(succeeded.map((statement, index) => (index === 5 ? { results: [], success: false } : statement))),
      cfEnvelope(succeeded),
    );
    const statements = Array.from({ length: 2 * D1_BATCH_MAX_STATEMENTS + 1 }, (_, index) => `SELECT ${index}`);
    expect((await capture(() => queryDeployed(io, REMOTE, statements, "query"))).message).toBe(
      `query against remote (app-db) failed: D1 reported statement ${D1_BATCH_MAX_STATEMENTS + 6} unsuccessful`,
    );
    expect(io.restCalls).toHaveLength(2);
  });

  it("stops at a request midway that D1 refuses, sending no later request", async () => {
    const io = remoteIo();
    const succeeded = Array.from({ length: D1_BATCH_MAX_STATEMENTS }, () => ({ results: [], success: true }));
    replyTo(io, "/query", cfEnvelope(succeeded), cfRefusal(7500, "no such table: t"), cfEnvelope(succeeded));
    const statements = Array.from({ length: 2 * D1_BATCH_MAX_STATEMENTS + 1 }, (_, index) => `SELECT ${index}`);
    expect((await capture(() => queryDeployed(io, REMOTE, statements, "query"))).message).toBe(
      "query against remote (app-db) failed: no such table: t (Cloudflare error 7500)",
    );
    expect(io.restCalls).toHaveLength(2);
  });

  it("refuses a write batch over the statement cap before any request, naming the caller's query", async () => {
    const io = echoStatements(remoteIo());
    const statements = Array.from({ length: D1_BATCH_MAX_STATEMENTS + 1 }, (_, index) => `INSERT INTO t VALUES (${index})`);
    expect((await capture(() => queryDeployed(io, REMOTE, statements, "seed"))).message).toBe(
      `seed against remote (app-db) failed: a batch holding a write has to go as one request, and these ${D1_BATCH_MAX_STATEMENTS + 1} statements exceed one`,
    );
    expect(io.restCalls).toEqual([]);
  });

  it("refuses a statement D1 reports unsuccessful, naming the home and its position", async () => {
    const io = remoteIo();
    replyTo(
      io,
      "/query",
      cfEnvelope([
        { results: [], success: true },
        { results: [], success: false },
      ]),
    );
    const error = await capture(() => queryDeployed(io, REMOTE, ["SELECT 1", "SELECT 2"], "query `SELECT 1`"));
    expect(error.kind).toBe("external");
    expect(error.message).toBe("query `SELECT 1` against remote (app-db) failed: D1 reported statement 2 unsuccessful");
  });
});

describe("executeDeployed()", () => {
  it("sends the whole body as one { sql } request", async () => {
    const io = remoteIo();
    replyTo(io, "/query", cfEnvelope([{ results: [] }, { results: [] }]));
    await executeDeployed(io, REMOTE, "CREATE TABLE t (a);\nINSERT INTO t VALUES (1);", "loading m.sql");
    expect(io.restCalls).toHaveLength(1);
    expect(bodyOf(io, 0)).toEqual({ sql: "CREATE TABLE t (a);\nINSERT INTO t VALUES (1);" });
  });

  it("refuses a statement D1 reports unsuccessful", async () => {
    const io = remoteIo();
    replyTo(io, "/query", cfEnvelope([{ results: [], success: false }]));
    expect((await capture(() => executeDeployed(io, REMOTE, "DELETE FROM t", "execute"))).message).toContain(
      "D1 reported statement 1 unsuccessful",
    );
  });
});

describe("a failure envelope", () => {
  it("passes D1's SQL error through, carrying the client error as its cause", async () => {
    const io = remoteIo();
    replyTo(io, "/query", cfRefusal(7500, "no such table: t: SQLITE_ERROR"));
    const error = await capture(() => queryDeployed(io, REMOTE, ["SELECT * FROM t"], "query `SELECT * FROM t`"));
    expect(error.kind).toBe("external");
    expect(error.message).toBe("query `SELECT * FROM t` against remote (app-db) failed: no such table: t: SQLITE_ERROR (Cloudflare error 7500)");
    expect(error.cause).toBeInstanceOf(CfApiClientError);
  });

  it("names the token and the permission on an auth code, and never the token's value", async () => {
    const io = remoteIo();
    replyTo(io, "/query", cfRefusal(10000, "Authentication error"));
    const { message } = await capture(() => queryDeployed(io, REMOTE, ["SELECT 1"], "query"));
    expect(message).toContain("--api-token");
    expect(message).toContain("Account → D1 → Edit");
    expect(message).toContain(" · code 10000");
    expect(message).not.toMatch(/\btok\b/);
  });

  it("reads a 403 carrying no code as an auth refusal", async () => {
    const io = remoteIo();
    replyTo(io, "/query", Response.json({ success: false, errors: [], result: null }, { status: 403 }));
    const { message } = await capture(() => queryDeployed(io, REMOTE, ["SELECT 1"], "query"));
    expect(message).toBe("query against remote (app-db) failed: Cloudflare refused the --api-token — it is invalid, or lacks Account → D1 → Edit");
  });

  it("names database_id for a missing remote database and preview_database_id for a missing preview one", async () => {
    const io = remoteIo();
    io.restRules.push({ match: () => true, reply: () => cfRefusal(7003, "Could not route to /accounts/acct/d1/database", 404) });
    expect((await capture(() => queryDeployed(io, REMOTE, ["SELECT 1"], "query"))).message).toBe(
      `query against remote (app-db) failed: no D1 database ${DB_ID} in the account --account-id names — check database_id`,
    );
    expect((await capture(() => queryDeployed(io, PREVIEW, ["SELECT 1"], "query"))).message).toBe(
      `query against preview (app-db) failed: no D1 database ${PREVIEW_ID} in the account --account-id names — check preview_database_id`,
    );
  });

  it("refuses a result that is not a list, naming the operation and the field without echoing the value", async () => {
    const io = remoteIo();
    replyTo(io, "/query", cfEnvelope({ rows: "do-not-echo" }));
    const { message } = await capture(() => queryDeployed(io, REMOTE, ["SELECT 1"], "query"));
    expect(message).toContain(QUERY_OPERATION);
    expect(message).toContain("unexpected response shape at result");
    expect(message).not.toContain("do-not-echo");
  });

  it("refuses a body that is not JSON, naming the home", async () => {
    const io = remoteIo();
    replyTo(io, "/query", new Response("<html>Bad gateway</html>", { status: 502 }));
    const error = await capture(() => queryDeployed(io, REMOTE, ["DELETE FROM t"], "query"));
    expect(error.kind).toBe("external");
    expect(error.message).toBe("query against remote (app-db) failed: Failed to parse response (HTTP 502)");
  });

  it("reports a fetch that throws as a network error", async () => {
    const io = remoteIo();
    io.restRules.push({
      match: () => true,
      reply: () => {
        throw new Error("connection reset");
      },
    });
    expect((await capture(() => queryDeployed(io, REMOTE, ["DELETE FROM t"], "query"))).message).toContain("failed: network error — ");
  });
});

describe("missing credentials", () => {
  const OPERATIONS: [string, (io: FakeDbIo, home: Home) => Promise<unknown>][] = [
    ["query", (io, home) => queryDeployed(io, home, ["SELECT 1"], "query")],
    ["bookmark", (io, home) => readDeployedBookmark(io, home)],
    ["execute", (io, home) => executeDeployed(io, home, "DELETE FROM t", "execute")],
    ["restore", (io, home) => restoreDeployedBookmark(io, home, { bookmark: "B" })],
  ];

  for (const [name, run] of OPERATIONS) {
    describe(name, () => {
      it("refuses a home carrying no credentials, before any request", async () => {
        const io = remoteIo();
        const error = await capture(() => run(io, { ...REMOTE, auth: null }));
        expect(error.kind).toBe("invalid-args");
        expect(error.message).toStartWith("--account-id and --api-token are not given.");
        expect(io.restCalls).toEqual([]);
      });

      it("reads no credential from the environment", async () => {
        const io = fakeDbIo({}, { env: { CLOUDFLARE_ACCOUNT_ID: "acct", CLOUDFLARE_API_TOKEN: "tok" }, homes: [REMOTE] });
        expect((await capture(() => run(io, { ...REMOTE, auth: null }))).message).toStartWith("--account-id and --api-token are not given.");
        expect(io.restCalls).toEqual([]);
      });
    });
  }

  it("refuses a home with no D1 id before reading the credentials", async () => {
    const io = remoteIo();
    const error = await capture(() => queryDeployed(io, { ...REMOTE, databaseId: null, auth: null }, ["SELECT 1"], "query"));
    expect(error.message).toBe("remote (app-db) has no D1 id to address");
    expect(io.restCalls).toEqual([]);
  });
});

describe("retrying a transient failure", () => {
  const unavailable = () => cfRefusal(7500, "unavailable", 503);
  const retryNow = () => Response.json({ success: false, errors: [], result: null }, { status: 503, headers: { "Retry-After": "0" } });
  const sentTo = (io: FakeDbIo, suffix: string) => io.restCalls.filter((call) => new URL(call.url).pathname.endsWith(suffix)).length;

  it("retries a read-only query batch", async () => {
    const io = remoteIo();
    replyTo(io, "/query", retryNow(), cfEnvelope([{ results: [{ n: 1 }] }]));
    expect(await queryDeployed(io, REMOTE, ["SELECT 1 AS n"], "query")).toEqual([[{ n: 1 }]]);
    expect(sentTo(io, "/query")).toBe(2);
  });

  it("sends a query batch holding a write once", async () => {
    const io = remoteIo();
    replyTo(io, "/query", unavailable(), cfEnvelope([{ results: [] }, { results: [] }]));
    await capture(() => queryDeployed(io, REMOTE, ["SELECT 1", "INSERT INTO t VALUES (1)"], "query"));
    expect(sentTo(io, "/query")).toBe(1);
  });

  it("sends an element packing a write after a read once", async () => {
    const io = remoteIo();
    replyTo(io, "/query", retryNow(), cfEnvelope([{ results: [] }]));
    const error = await capture(() => queryDeployed(io, REMOTE, ["SELECT 1; DELETE FROM t"], "query"));
    expect(error.kind).toBe("external");
    expect(sentTo(io, "/query")).toBe(1);
  });

  it("sends a body of SQL loaded from a file once", async () => {
    const io = remoteIo();
    replyTo(io, "/query", unavailable(), cfEnvelope([{ results: [] }]));
    await capture(() => executeDeployed(io, REMOTE, "INSERT INTO t VALUES (1);", "loading m.sql"));
    expect(sentTo(io, "/query")).toBe(1);
  });

  it("sends a Time Travel restore once", async () => {
    const io = remoteIo();
    replyTo(io, "/time_travel/restore", unavailable(), cfEnvelope({ bookmark: "B", previous_bookmark: "A" }));
    expect((await restoreDeployedBookmark(io, REMOTE, { bookmark: "B" })).kind).toBe("unknown");
    expect(sentTo(io, "/time_travel/restore")).toBe(1);
  });

  it("retries a bookmark read", async () => {
    const io = remoteIo();
    replyTo(io, "/time_travel/bookmark", retryNow(), cfEnvelope({ bookmark: "b" }));
    expect(await readDeployedBookmark(io, REMOTE)).toBe("b");
    expect(sentTo(io, "/time_travel/bookmark")).toBe(2);
  });
});

describe("Time Travel", () => {
  it("reads the bookmark for now with no query", async () => {
    const io = remoteIo();
    replyTo(io, "/time_travel/bookmark", cfEnvelope({ bookmark: "00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683" }));
    expect(await readDeployedBookmark(io, REMOTE)).toBe("00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683");
    expect(io.restCalls[0]).toMatchObject({ url: `${BASE}/time_travel/bookmark`, method: "GET", body: null });
  });

  it("sends a Unix timestamp as an ISO 8601 instant", async () => {
    const io = remoteIo();
    replyTo(io, "/time_travel/bookmark", cfEnvelope({ bookmark: "b" }));
    await readDeployedBookmark(io, REMOTE, "1700000000");
    expect(io.restCalls[0]?.url).toBe(`${BASE}/time_travel/bookmark?timestamp=2023-11-14T22%3A13%3A20.000Z`);
  });

  it("restores to a bookmark with no body, returning the bookmark it held before", async () => {
    const io = remoteIo();
    replyTo(io, "/time_travel/restore", cfEnvelope({ bookmark: "B", previous_bookmark: "A", message: "Restored" }));
    expect(await restoreDeployedBookmark(io, REMOTE, { bookmark: "B" })).toEqual({ kind: "restored", previousBookmark: "A" });
    expect(io.restCalls[0]).toMatchObject({ url: `${BASE}/time_travel/restore?bookmark=B`, method: "POST", body: null });
  });

  it("restores to a timestamp as an ISO 8601 instant", async () => {
    const io = remoteIo();
    replyTo(io, "/time_travel/restore", cfEnvelope({ bookmark: "B", previous_bookmark: "A" }));
    expect(await restoreDeployedBookmark(io, REMOTE, { timestamp: "2026-09-01T00:00:00Z" })).toEqual({ kind: "restored", previousBookmark: "A" });
    expect(io.restCalls[0]?.url).toBe(`${BASE}/time_travel/restore?timestamp=2026-09-01T00%3A00%3A00.000Z`);
  });

  it("answers a restore whose reply names no previous bookmark as restored with none", async () => {
    const io = remoteIo();
    replyTo(io, "/time_travel/restore", cfEnvelope({ bookmark: "B" }));
    expect(await restoreDeployedBookmark(io, REMOTE, { bookmark: "B" })).toEqual({ kind: "restored", previousBookmark: null });
  });

  it("answers an accepted restore whose reply cannot be read as unreadable, never as a refusal", async () => {
    for (const reply of [
      cfEnvelope({ previous_bookmark: 42 }),
      cfEnvelope([]),
      new Response("<html>ok</html>", { status: 200 }),
      Response.json({ result: null }),
    ]) {
      const io = remoteIo();
      replyTo(io, "/time_travel/restore", reply);
      expect(await restoreDeployedBookmark(io, REMOTE, { bookmark: "B" })).toEqual({ kind: "unreadable" });
    }
  });

  it("answers a restore whose transport failed as unknown, having sent it once", async () => {
    const io = remoteIo();
    io.restRules.push({
      match: (url) => url.includes("/time_travel/restore"),
      reply: () => {
        throw new Error("connection reset");
      },
    });
    expect(await restoreDeployedBookmark(io, REMOTE, { bookmark: "B" })).toEqual({ kind: "unknown", reason: "Network error: connection reset" });
    expect(io.restCalls).toHaveLength(1);
  });

  it("answers a failure envelope on a 2xx as unknown, since D1 may have acted on it", async () => {
    const io = remoteIo();
    replyTo(io, "/time_travel/restore", Response.json({ success: false, errors: [], result: null }, { status: 200 }));
    expect(await restoreDeployedBookmark(io, REMOTE, { bookmark: "B" })).toEqual({
      kind: "unknown",
      reason: "D1 answered HTTP 200 with a failure envelope",
    });
  });

  it("refuses a rate-limited restore as not restored, naming the time a Retry-After allows the next", async () => {
    const io = remoteIo();
    replyTo(
      io,
      "/time_travel/restore",
      Response.json({ success: false, errors: [], result: null }, { status: 429, headers: { "Retry-After": "90" } }),
    );
    const error = await capture(() => restoreDeployedBookmark(io, REMOTE, { bookmark: "B" }));
    expect([error.kind, error.message]).toEqual([
      "external",
      "time-travel restore against remote (app-db) failed: not restored — D1 rate-limited the restore; the next is allowed after 2026-09-11T10:01:30.000Z",
    ]);
    expect(io.restCalls).toHaveLength(1);
  });

  it("names the time a Retry-After HTTP date allows the next restore", async () => {
    const io = remoteIo();
    replyTo(
      io,
      "/time_travel/restore",
      Response.json({ success: false, errors: [], result: null }, { status: 429, headers: { "Retry-After": "Fri, 11 Sep 2026 10:05:00 GMT" } }),
    );
    expect((await capture(() => restoreDeployedBookmark(io, REMOTE, { bookmark: "B" }))).message).toBe(
      "time-travel restore against remote (app-db) failed: not restored — D1 rate-limited the restore; the next is allowed after 2026-09-11T10:05:00.000Z",
    );
  });

  it("refuses a rate-limited restore with no Retry-After as not restored", async () => {
    const io = remoteIo();
    replyTo(io, "/time_travel/restore", cfRefusal(971, "Too many requests", 429));
    expect((await capture(() => restoreDeployedBookmark(io, REMOTE, { bookmark: "B" }))).message).toBe(
      "time-travel restore against remote (app-db) failed: not restored — D1 rate-limited the restore; try again in a few minutes",
    );
  });

  it("refuses a date that does not exist before any request, rather than rolling it over", async () => {
    for (const timestamp of ["2026-02-30", "2027-02-29", "2026-02-28T24:30:00Z", "2026-04-31T10:00:00+02:00", "2026-02-28T10:61"]) {
      const io = remoteIo();
      const restore = await capture(() => restoreDeployedBookmark(io, REMOTE, { timestamp }));
      const read = await capture(() => readDeployedBookmark(io, REMOTE, timestamp));
      expect([restore.kind, restore.message]).toEqual(["invalid-args", `--timestamp ${JSON.stringify(timestamp)} is not a date-time`]);
      expect([read.kind, read.message]).toEqual(["invalid-args", `--timestamp ${JSON.stringify(timestamp)} is not a date-time`]);
      expect(io.restCalls).toEqual([]);
    }
  });

  it("accepts a date that exists, a leap day included, sending the instant it names", async () => {
    for (const [timestamp, sent] of [
      ["2026-02-28", "2026-02-28T00%3A00%3A00.000Z"],
      ["2028-02-29", "2028-02-29T00%3A00%3A00.000Z"],
      ["2028-02-29T23:59:59+02:00", "2028-02-29T21%3A59%3A59.000Z"],
    ] as const) {
      const io = remoteIo();
      replyTo(io, "/time_travel/restore", cfEnvelope({ bookmark: "B", previous_bookmark: "A" }));
      expect(await restoreDeployedBookmark(io, REMOTE, { timestamp })).toEqual({ kind: "restored", previousBookmark: "A" });
      expect(io.restCalls[0]?.url).toBe(`${BASE}/time_travel/restore?timestamp=${sent}`);
    }
  });

  it("reads a time with no zone as local time, as wrangler does", async () => {
    const io = remoteIo();
    replyTo(io, "/time_travel/bookmark", cfEnvelope({ bookmark: "b" }));
    await readDeployedBookmark(io, REMOTE, "2026-02-28T10:30");
    expect(new URL(io.restCalls[0]?.url ?? "").searchParams.get("timestamp")).toBe(new Date(2026, 1, 28, 10, 30).toISOString());
  });

  it("refuses a timestamp that is not a date before any request", async () => {
    const io = remoteIo();
    expect((await capture(() => readDeployedBookmark(io, REMOTE, "2026-13-45"))).message).toBe('--timestamp "2026-13-45" is not a date-time');
    expect(io.restCalls).toEqual([]);
  });

  it("refuses a restore to a timestamp that is not a date before any request", async () => {
    const io = remoteIo();
    const error = await capture(() => restoreDeployedBookmark(io, REMOTE, { timestamp: "2026-13-45" }));
    expect([error.kind, error.message]).toEqual(["invalid-args", '--timestamp "2026-13-45" is not a date-time']);
    expect(io.restCalls).toEqual([]);
  });
});

describe("a schema refusal", () => {
  const SENTINEL = "do-not-echo-7f3a";
  const CASES: { name: string; reply: Response; run: (io: FakeDbIo) => Promise<unknown> }[] = [
    { name: "a bookmark that is not text", reply: cfEnvelope({ bookmark: { value: SENTINEL } }), run: (io) => readDeployedBookmark(io, REMOTE) },
    {
      name: "a statement whose rows are not a list",
      reply: cfEnvelope([{ results: SENTINEL }]),
      run: (io) => queryDeployed(io, REMOTE, ["SELECT 1"], "query"),
    },
  ];

  for (const { name, reply, run } of CASES) {
    it(`names the field and never echoes the received value, for ${name}`, async () => {
      const io = remoteIo();
      io.restRules.push({ match: () => true, reply: () => reply.clone() });
      const error = await capture(() => run(io));
      expect(error.message).toContain("unexpected response shape at");
      expect(error.message).not.toContain(SENTINEL);
      expect(String((error.cause as Error | undefined)?.message)).not.toContain(SENTINEL);
    });
  }
});

describe("the API token", () => {
  const TOKEN = "tkn-Zq9xW2vLp7";
  const HOME: Home = { ...REMOTE, auth: { accountId: "acct", apiToken: TOKEN } };
  const FAILURES: [string, () => Response][] = [
    ["an auth code", () => cfRefusal(10000, "Authentication error")],
    ["a 403 with no code", () => Response.json({ success: false, errors: [], result: null }, { status: 403 })],
    ["a missing database", () => cfRefusal(7003, "Could not route", 404)],
    ["a SQL error", () => cfRefusal(7500, "no such table: t: SQLITE_ERROR")],
    ["a malformed result", () => cfEnvelope({ rows: [] })],
    ["a body that is not JSON", () => new Response("<html>Bad gateway</html>", { status: 502 })],
    ["an unsuccessful statement", () => cfEnvelope([{ results: [], success: false }])],
    [
      "a fetch that throws",
      () => {
        throw new Error("connection reset");
      },
    ],
  ];

  it("is sent as the bearer credential", async () => {
    const io = remoteIo();
    replyTo(io, "/query", cfEnvelope([{ results: [] }]));
    await queryDeployed(io, HOME, ["SELECT 1"], "query");
    expect(io.restCalls[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  for (const [name, reply] of FAILURES) {
    it(`never appears in the refusal for ${name}`, async () => {
      const io = remoteIo();
      io.restRules.push({ match: () => true, reply });
      const error = await capture(() => queryDeployed(io, HOME, ["DELETE FROM t"], "query"));
      expect(error.kind).toBe("external");
      expect(error.message).not.toContain(TOKEN);
      expect(String((error.cause as Error | undefined)?.message)).not.toContain(TOKEN);
      expect(io.logs.join("\n")).not.toContain(TOKEN);
    });
  }
});

describe("paging", () => {
  it("sends no paging parameter on any D1 request", async () => {
    const io = remoteIo();
    replyTo(io, "/query", cfEnvelope([{ results: [] }]));
    replyTo(io, "/time_travel/bookmark", cfEnvelope({ bookmark: "B" }));
    replyTo(io, "/time_travel/restore", cfEnvelope({ bookmark: "B", previous_bookmark: "A" }));
    await queryDeployed(io, REMOTE, ["SELECT 1"], "query");
    await executeDeployed(io, REMOTE, "SELECT 1", "execute");
    await readDeployedBookmark(io, REMOTE, "1700000000");
    await restoreDeployedBookmark(io, REMOTE, { bookmark: "B" });
    for (const call of io.restCalls.filter((c) => c.url.startsWith("https://api.cloudflare.com/"))) {
      expect(new URL(call.url).searchParams.has("per_page")).toBe(false);
      expect(new URL(call.url).searchParams.has("page")).toBe(false);
      expect(new URL(call.url).searchParams.has("cursor")).toBe(false);
    }
  });
});

describe("isD1ResultOverCap()", () => {
  const OVER_CAP = "Query result size exceeds the 50 MB limit";

  it("holds for a query D1 refused with a message naming the result size limit", async () => {
    const io = remoteIo();
    replyTo(io, "/query", cfRefusal(7500, OVER_CAP));
    expect(isD1ResultOverCap(await capture(() => queryDeployed(io, REMOTE, ["SELECT * FROM t"], "query")))).toBe(true);
  });

  it("does not hold for another refusal, nor for the same words outside a Cloudflare refusal", async () => {
    const io = remoteIo();
    replyTo(io, "/query", cfRefusal(7500, "no such table: t"));
    expect(isD1ResultOverCap(await capture(() => queryDeployed(io, REMOTE, ["SELECT * FROM t"], "query")))).toBe(false);
    expect(isD1ResultOverCap(new CliError("external", OVER_CAP))).toBe(false);
    expect(isD1ResultOverCap(new CliError("external", "x", { cause: new CfApiClientError("network", OVER_CAP) }))).toBe(false);
    expect(isD1ResultOverCap(new Error(OVER_CAP))).toBe(false);
  });

  for (const message of ["no such column: result", 'near "result": syntax error', "D1_ERROR: result set is empty", "string or blob too big"]) {
    it(`does not hold for a Cloudflare refusal that is not about the result cap: ${message}`, async () => {
      const io = remoteIo();
      replyTo(io, "/query", cfRefusal(7500, message));
      expect(isD1ResultOverCap(await capture(() => queryDeployed(io, REMOTE, ["SELECT * FROM t"], "query")))).toBe(false);
    });
  }
});
