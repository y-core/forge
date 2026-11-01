import { describe, expect, it } from "bun:test";

import { CfApiClientError } from "../cf/api/types";
import { CliError } from "../cli/errors";
import { cfEnvelope, cfRefusal, fakeDbIo, REMOTE_AUTH } from "./db.fixture";
import { executeDeployed, exportDeployed, queryDeployed, readDeployedBookmark, restoreDeployedBookmark } from "./remote";
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
const SIGNED_URL = "https://d1-exports.example.com/dump.sql?X-Amz-Signature=deadbeef";
const QUERY_OPERATION = "POST /accounts/{account_id}/d1/database/{database_id}/query";
const EXPORT_OPERATION = "POST /accounts/{account_id}/d1/database/{database_id}/export";

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

const exportCalls = (io: FakeDbIo) => io.restCalls.filter((call) => call.url.endsWith("/export"));
const downloads = (io: FakeDbIo) => io.restCalls.filter((call) => call.url === SIGNED_URL);

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

  it("sends a batch over 131072 bytes as one request, with no argv to cap it", async () => {
    const io = remoteIo();
    const wide = `SELECT '${"x".repeat(50_000)}'`;
    replyTo(io, "/query", cfEnvelope([{ results: [] }, { results: [] }, { results: [] }]));
    await queryDeployed(io, REMOTE, [wide, wide, wide], "query");
    expect(io.restCalls).toHaveLength(1);
    expect(io.restCalls[0]?.body?.length).toBeGreaterThan(131_072);
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
    const error = await capture(() => queryDeployed(io, REMOTE, ["SELECT 1"], "query"));
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
    expect((await capture(() => queryDeployed(io, REMOTE, ["SELECT 1"], "query"))).message).toContain("failed: network error — ");
  });
});

describe("missing credentials", () => {
  const OPERATIONS: [string, (io: FakeDbIo, home: Home) => Promise<unknown>][] = [
    ["query", (io, home) => queryDeployed(io, home, ["SELECT 1"], "query")],
    ["export", (io, home) => exportDeployed(io, home, "/out.sql", "schema")],
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

describe("exportDeployed()", () => {
  const active = (bookmark: string) => cfEnvelope({ status: "active", at_bookmark: bookmark, messages: [] }, 202);
  const complete = (bookmark?: string, signedUrl = SIGNED_URL) =>
    cfEnvelope({
      status: "complete",
      ...(bookmark === undefined ? {} : { at_bookmark: bookmark }),
      result: { filename: "dump.sql", signed_url: signedUrl },
    });

  function exportIo(...polls: Response[]): FakeDbIo {
    const io = remoteIo();
    replyTo(io, "/export", ...polls);
    io.restRules.push({ match: (url) => url === SIGNED_URL, reply: () => new Response("CREATE TABLE t (a);\n") });
    return io;
  }

  it("asks for a schema-only export first, carrying no bookmark", async () => {
    const io = exportIo(complete("B"));
    await exportDeployed(io, REMOTE, "/out.sql", "schema");
    expect(io.restCalls[0]?.url).toBe(`${BASE}/export`);
    expect(bodyOf(io, 0)).toEqual({ output_format: "polling", dump_options: { no_data: true } });
  });

  it("asks for the data part with no_schema", async () => {
    const io = exportIo(complete("B"));
    await exportDeployed(io, REMOTE, "/out.sql", "data");
    expect(bodyOf(io, 0)).toEqual({ output_format: "polling", dump_options: { no_schema: true } });
  });

  it("polls an active export with the bookmark it answered, then downloads without the token and returns it", async () => {
    const io = exportIo(active("B"), complete("B"));
    expect(await exportDeployed(io, REMOTE, "/out.sql", "schema")).toBe("B");
    expect(exportCalls(io)).toHaveLength(2);
    expect(bodyOf(io, 1)).toEqual({ output_format: "polling", dump_options: { no_data: true }, current_bookmark: "B" });
    expect(downloads(io)).toEqual([{ url: SIGNED_URL, method: "GET", headers: {}, body: null }]);
    expect(io.readText("/out.sql")).toBe("CREATE TABLE t (a);\n");
  });

  it("makes one request when the export completes at once, returning its bookmark or null", async () => {
    const withBookmark = exportIo(complete("B"));
    expect(await exportDeployed(withBookmark, REMOTE, "/out.sql", "schema")).toBe("B");
    expect(exportCalls(withBookmark)).toHaveLength(1);

    const without = exportIo(complete());
    expect(await exportDeployed(without, REMOTE, "/out.sql", "schema")).toBeNull();
    expect(exportCalls(without)).toHaveLength(1);
  });

  it("falls back to the polled bookmark when the completed export names none", async () => {
    expect(await exportDeployed(exportIo(active("B"), complete()), REMOTE, "/out.sql", "schema")).toBe("B");
  });

  it("refuses an export D1 reports in error with D1's text, and downloads nothing", async () => {
    const io = exportIo(cfEnvelope({ status: "error", error: "database is too large to export" }));
    expect((await capture(() => exportDeployed(io, REMOTE, "/out.sql", "schema"))).message).toBe(
      "export against remote (app-db) failed: database is too large to export",
    );
    expect(downloads(io)).toEqual([]);
  });

  it("says so when D1 reports an error and no detail", async () => {
    const io = exportIo(cfEnvelope({ status: "error" }));
    expect((await capture(() => exportDeployed(io, REMOTE, "/out.sql", "schema"))).message).toBe(
      "export against remote (app-db) failed: D1 reported an error and no detail",
    );
  });

  it("refuses an export whose bookmark moves while it is polled", async () => {
    const io = exportIo(active("B"), active("C"));
    expect((await capture(() => exportDeployed(io, REMOTE, "/out.sql", "schema"))).message).toBe(
      "export against remote (app-db) failed: D1 moved the export's bookmark while it was being polled",
    );
    expect(downloads(io)).toEqual([]);
  });

  it("refuses an active export with no bookmark as a schema refusal", async () => {
    const io = exportIo(cfEnvelope({ status: "active" }, 202));
    const { message } = await capture(() => exportDeployed(io, REMOTE, "/out.sql", "schema"));
    expect(message).toContain(EXPORT_OPERATION);
    expect(message).toContain("unexpected response shape at at_bookmark");
  });

  it("refuses a signed URL that is not HTTPS without fetching or quoting it", async () => {
    const plain = "http://d1-exports.example.com/dump.sql?X-Amz-Signature=deadbeef";
    const io = exportIo(complete("B", plain));
    const { message } = await capture(() => exportDeployed(io, REMOTE, "/out.sql", "schema"));
    expect(message).toBe("downloading the export of remote (app-db) was refused: D1 answered a signed URL that is not HTTPS");
    expect(io.restCalls.map((call) => call.url)).not.toContain(plain);
    expect(message).not.toContain("d1-exports.example.com");
  });

  it("refuses a download the signed URL answers with an error status, naming the status alone and writing nothing", async () => {
    const io = remoteIo();
    replyTo(io, "/export", complete("B"));
    io.restRules.push({ match: (url) => url === SIGNED_URL, reply: () => new Response("denied", { status: 403 }) });
    const { message } = await capture(() => exportDeployed(io, REMOTE, "/out.sql", "schema"));
    expect(message).toBe("downloading the export of remote (app-db) failed (HTTP 403)");
    expect(io.exists("/out.sql")).toBe(false);
  });

  it("reports a download that throws as a network error carrying no cause, writing nothing", async () => {
    const io = remoteIo();
    replyTo(io, "/export", complete("B"));
    io.restRules.push({ match: (url) => url === SIGNED_URL, reply: () => Promise.reject(new Error(`fetch ${SIGNED_URL} failed`)) as never });
    const error = await capture(() => exportDeployed(io, REMOTE, "/out.sql", "schema"));
    expect([error.kind, error.message, error.cause]).toEqual([
      "external",
      "downloading the export of remote (app-db) failed: network error",
      undefined,
    ]);
    expect(io.exists("/out.sql")).toBe(false);
  });

  it("writes nothing when the signed URL is refused for not being HTTPS", async () => {
    const io = exportIo(complete("B", "HTTP://d1-exports.example.com/dump.sql"));
    await capture(() => exportDeployed(io, REMOTE, "/out.sql", "schema"));
    expect([downloads(io), io.restCalls.filter((call) => call.url.includes("d1-exports")), io.exists("/out.sql")]).toEqual([[], [], false]);
  });

  it("refuses a completed export whose result is malformed without quoting the signed URL it carried", async () => {
    const io = exportIo(cfEnvelope({ status: "complete", at_bookmark: "B", result: { signed_url: SIGNED_URL } }));
    const error = await capture(() => exportDeployed(io, REMOTE, "/out.sql", "schema"));
    expect(error.message).toStartWith(`export against remote (app-db) failed: ${EXPORT_OPERATION}: unexpected response shape at result.filename`);
    expect(error.message).not.toContain("d1-exports.example.com");
    expect(String((error.cause as Error | undefined)?.message)).not.toContain("d1-exports.example.com");
    expect(downloads(io)).toEqual([]);
  });

  it("keeps polling an export that stays active at the same bookmark, carrying it on every poll", async () => {
    const io = exportIo(active("B"), active("B"), active("B"), complete("B"));
    expect(await exportDeployed(io, REMOTE, "/out.sql", "schema")).toBe("B");
    expect(exportCalls(io).map((call) => (JSON.parse(call.body ?? "{}") as { current_bookmark?: string }).current_bookmark)).toEqual([
      undefined,
      "B",
      "B",
      "B",
    ]);
  });

  it("refuses an export in error after a poll, downloading nothing", async () => {
    const io = exportIo(active("B"), cfEnvelope({ status: "error", error: "export cancelled" }));
    expect((await capture(() => exportDeployed(io, REMOTE, "/out.sql", "schema"))).message).toBe(
      "export against remote (app-db) failed: export cancelled",
    );
    expect(downloads(io)).toEqual([]);
  });

  it("never puts the signed URL in a message or a log line, whether the download succeeds or fails", async () => {
    const succeeded = exportIo(active("B"), complete("B"));
    await exportDeployed(succeeded, REMOTE, "/out.sql", "schema");
    expect(succeeded.logs.join("\n")).not.toContain("d1-exports.example.com");

    for (const reply of [() => new Response("denied", { status: 403 }), () => Promise.reject(new Error(`fetch ${SIGNED_URL} failed`))]) {
      const failing = remoteIo();
      replyTo(failing, "/export", complete("B"));
      failing.restRules.push({ match: (url) => url === SIGNED_URL, reply: reply as () => Response });
      const error = await capture(() => exportDeployed(failing, REMOTE, "/out.sql", "schema"));
      expect(error.message).not.toContain("d1-exports.example.com");
      expect(error.message).not.toContain("X-Amz-Signature");
      expect(String(error.cause ?? "")).not.toContain("d1-exports.example.com");
      expect(failing.logs.join("\n")).not.toContain("d1-exports.example.com");
    }
  });

  it("gives the auth message when a poll is refused for the token", async () => {
    const io = exportIo(active("B"), cfRefusal(10000, "Authentication error"));
    expect((await capture(() => exportDeployed(io, REMOTE, "/out.sql", "schema"))).message).toBe(
      "export against remote (app-db) failed: Cloudflare refused the --api-token — it is invalid, or lacks Account → D1 → Edit · code 10000",
    );
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
    expect(await restoreDeployedBookmark(io, REMOTE, { bookmark: "B" })).toBe("A");
    expect(io.restCalls[0]).toMatchObject({ url: `${BASE}/time_travel/restore?bookmark=B`, method: "POST", body: null });
  });

  it("restores to a timestamp as an ISO 8601 instant", async () => {
    const io = remoteIo();
    replyTo(io, "/time_travel/restore", cfEnvelope({ bookmark: "B", previous_bookmark: "A" }));
    expect(await restoreDeployedBookmark(io, REMOTE, { timestamp: "2026-09-01T00:00:00Z" })).toBe("A");
    expect(io.restCalls[0]?.url).toBe(`${BASE}/time_travel/restore?timestamp=2026-09-01T00%3A00%3A00.000Z`);
  });

  it("refuses a restore whose answer carries no previous bookmark as a schema refusal", async () => {
    const io = remoteIo();
    replyTo(io, "/time_travel/restore", cfEnvelope({ bookmark: "B" }));
    const { message } = await capture(() => restoreDeployedBookmark(io, REMOTE, { bookmark: "B" }));
    expect(message).toContain("POST /accounts/{account_id}/d1/database/{database_id}/time_travel/restore");
    expect(message).toContain("unexpected response shape at previous_bookmark");
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
      expect(await restoreDeployedBookmark(io, REMOTE, { timestamp })).toBe("A");
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
    {
      name: "an export status D1 does not define",
      reply: cfEnvelope({ status: SENTINEL }),
      run: (io) => exportDeployed(io, REMOTE, "/o.sql", "schema"),
    },
    {
      name: "an active export whose bookmark is not text",
      reply: cfEnvelope({ status: "active", at_bookmark: [SENTINEL] }, 202),
      run: (io) => exportDeployed(io, REMOTE, "/o.sql", "schema"),
    },
    { name: "a bookmark that is not text", reply: cfEnvelope({ bookmark: { value: SENTINEL } }), run: (io) => readDeployedBookmark(io, REMOTE) },
    {
      name: "a restore with no previous bookmark",
      reply: cfEnvelope({ bookmark: SENTINEL, message: SENTINEL }),
      run: (io) => restoreDeployedBookmark(io, REMOTE, { bookmark: "B" }),
    },
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
      const error = await capture(() => queryDeployed(io, HOME, ["SELECT 1"], "query"));
      expect(error.kind).toBe("external");
      expect(error.message).not.toContain(TOKEN);
      expect(String((error.cause as Error | undefined)?.message)).not.toContain(TOKEN);
      expect(io.logs.join("\n")).not.toContain(TOKEN);
    });
  }

  it("never reaches the signed URL, nor a refused download's message", async () => {
    const io = remoteIo();
    replyTo(io, "/export", cfEnvelope({ status: "complete", at_bookmark: "B", result: { filename: "d.sql", signed_url: SIGNED_URL } }));
    io.restRules.push({ match: (url) => url === SIGNED_URL, reply: () => new Response("denied", { status: 403 }) });
    const error = await capture(() => exportDeployed(io, HOME, "/out.sql", "schema"));
    expect(downloads(io)).toHaveLength(1);
    expect(JSON.stringify(downloads(io))).not.toContain(TOKEN);
    expect(error.message).not.toContain(TOKEN);
  });
});

describe("paging", () => {
  it("sends no paging parameter on any D1 request", async () => {
    const io = remoteIo();
    replyTo(io, "/query", cfEnvelope([{ results: [] }]));
    replyTo(io, "/export", cfEnvelope({ status: "complete", at_bookmark: "B", result: { filename: "d.sql", signed_url: SIGNED_URL } }));
    replyTo(io, "/time_travel/bookmark", cfEnvelope({ bookmark: "B" }));
    replyTo(io, "/time_travel/restore", cfEnvelope({ bookmark: "B", previous_bookmark: "A" }));
    io.restRules.push({ match: (url) => url === SIGNED_URL, reply: () => new Response("") });
    await queryDeployed(io, REMOTE, ["SELECT 1"], "query");
    await executeDeployed(io, REMOTE, "SELECT 1", "execute");
    await exportDeployed(io, REMOTE, "/out.sql", "schema");
    await readDeployedBookmark(io, REMOTE, "1700000000");
    await restoreDeployedBookmark(io, REMOTE, { bookmark: "B" });
    for (const call of io.restCalls.filter((c) => c.url.startsWith("https://api.cloudflare.com/"))) {
      expect(new URL(call.url).searchParams.has("per_page")).toBe(false);
      expect(new URL(call.url).searchParams.has("page")).toBe(false);
      expect(new URL(call.url).searchParams.has("cursor")).toBe(false);
    }
  });
});
