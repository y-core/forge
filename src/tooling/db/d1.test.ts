import { describe, expect, it } from "bun:test";

import { CliError } from "../cli/errors";
import {
  describeForeignKeyWatch,
  executeFile,
  executeSql,
  exportSql,
  foreignKeyWatch,
  queryBatches,
  queryOne,
  queryRows,
  queryRowsIfTable,
  runWrangler,
} from "./d1";
import { cfEnvelope, cfRefusal, fakeDbIo, OK, REMOTE_AUTH } from "./db.fixture";
import type { FakeDbIo } from "./types";
import type { Home } from "./types";

function home(over: Partial<Home> = {}): Home {
  return {
    label: "local",
    database: "app-db",
    binding: "DB",
    dir: "/app",
    configPath: "/app/wrangler.jsonc",
    persistTo: "/app/.wrangler/state",
    place: "local",
    env: null,
    databaseId: null,
    auth: null,
    synthesized: false,
    ...over,
  };
}

const STANDBY = home({
  label: "standby",
  database: "app-db-standby",
  binding: "DB",
  dir: "/app/.forge/standby/app-db-standby",
  configPath: "/app/.forge/standby/app-db-standby/wrangler.jsonc",
  persistTo: "/app/.forge/standby/app-db-standby/.wrangler/state",
  auth: null,
  synthesized: true,
});

const DB_ID = "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a";
const PREVIEW_ID = "1a2b3c4d-1b2c-4d3e-8f9a-0b1c2d3e4f5a";
const REMOTE = home({ label: "remote", place: "remote", persistTo: null, databaseId: DB_ID, auth: REMOTE_AUTH });
const PREVIEW = home({ label: "preview", place: "preview", persistTo: null, databaseId: PREVIEW_ID, auth: REMOTE_AUTH });
const SIGNED_URL = "https://d1-exports.example.com/dump.sql?X-Amz-Signature=deadbeef";

/** A deployed database answered over the fake REST API, through the same `d1Rules` a local one is. */
function remoteIo(seed: Record<string, string> = {}): FakeDbIo {
  return fakeDbIo(seed, { homes: [REMOTE, PREVIEW, home({ ...REMOTE, env: "staging" })] });
}

function refusingRemote(code: number, message: string, seed: Record<string, string> = {}): FakeDbIo {
  const io = remoteIo(seed);
  io.restRules.push({ match: () => true, reply: () => cfRefusal(code, message) });
  return io;
}

const bodyOf = (io: FakeDbIo, index = 0): unknown => JSON.parse(io.restCalls[index]?.body ?? "null");

function ioWith(match: (args: readonly string[]) => boolean, reply: { code: number; stdout: string; stderr: string }): FakeDbIo {
  const io = fakeDbIo();
  io.rules.push({ match, reply });
  return io;
}

function ioAnswering(rows: Record<string, unknown>[] | ((statement: string) => Record<string, unknown>[])): FakeDbIo {
  const io = fakeDbIo();
  io.d1Rules.push({ match: () => true, reply: rows });
  return io;
}

async function capture(run: () => unknown): Promise<CliError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  throw new Error("expected a CliError, and the call returned");
}

describe("runWrangler()", () => {
  it("prefixes d1 and runs in the home's directory", () => {
    const io = ioWith(() => true, OK);
    expect(runWrangler(io, home(), ["info", "app-db"])).toEqual(OK);
    expect(io.calls).toEqual([["wrangler", "d1", "info", "app-db"]]);
  });
});

describe("queryRows()", () => {
  it("puts a local query to the home's own state and spawns nothing", async () => {
    const io = ioAnswering([{ n: 1 }]);
    expect(await queryRows(io, home(), "SELECT 1")).toEqual([{ n: 1 }]);
    expect(io.calls).toEqual([]);
    expect(io.d1Calls).toEqual([{ home: "local", place: "local", persistTo: "/app/.wrangler/state/v3", statements: ["SELECT 1"], source: null }]);
  });

  it("puts a standby query to the generated home's own state", async () => {
    const io = ioAnswering([]);
    await queryRows(io, STANDBY, "SELECT 1");
    expect(io.d1Calls[0]).toMatchObject({ home: "standby", persistTo: "/app/.forge/standby/app-db-standby/.wrangler/state/v3" });
  });

  it("sends a remote query to the D1 REST API in one request, spawning nothing", async () => {
    const io = remoteIo();
    io.d1Rules.push({ match: (statement) => statement === "SELECT 1 AS n", reply: [{ n: 1 }] });
    expect(await queryRows(io, REMOTE, "SELECT 1 AS n")).toEqual([{ n: 1 }]);
    expect(io.restCalls.map((call) => [call.method, call.url])).toEqual([
      ["POST", `https://api.cloudflare.com/client/v4/accounts/acct/d1/database/${DB_ID}/query`],
    ]);
    expect(io.calls).toEqual([]);
    expect(io.d1Calls).toEqual([]);
  });

  it("addresses a preview query to the preview database's id", async () => {
    const io = remoteIo();
    await queryRows(io, PREVIEW, "SELECT 1");
    expect(io.restCalls[0]?.url).toContain(`/d1/database/${PREVIEW_ID}/query`);
  });

  it("addresses the home's database id whatever the wrangler environment", async () => {
    const io = remoteIo();
    await queryRows(io, home({ ...REMOTE, env: "staging" }), "SELECT 1");
    expect(io.restCalls[0]?.url).toContain(`/d1/database/${DB_ID}/query`);
  });

  it("returns no rows when the statement produced none", async () => {
    expect(await queryRows(ioAnswering([]), home(), "SELECT 1")).toEqual([]);
  });

  it("names the home, the database and D1's error when a deployed query fails, as an external failure", async () => {
    const io = refusingRemote(7500, 'near "SELEC": syntax error at offset 0: SQLITE_ERROR');
    expect(await capture(() => queryRows(io, REMOTE, "SELEC 1"))).toMatchObject({
      kind: "external",
      message: 'query `SELEC 1` against remote (app-db) failed: near "SELEC": syntax error at offset 0: SQLITE_ERROR (Cloudflare error 7500)',
    });
  });

  it("names the home and the statement when the local database refuses it", async () => {
    const io = fakeDbIo();
    io.d1Rules.push({
      match: () => true,
      reply: () => {
        throw new Error('D1_ERROR: near "SELEC": syntax error');
      },
    });
    expect(await capture(() => queryRows(io, home(), "SELEC 1"))).toMatchObject({
      kind: "external",
      message: 'query `SELEC 1` against local (app-db) failed:\nD1_ERROR: near "SELEC": syntax error',
    });
  });
});

describe("queryBatches()", () => {
  it("puts every statement to the local database in one call, in order", async () => {
    const io = ioAnswering((statement) => [{ n: Number(/\d+/.exec(statement)?.[0] ?? 0) }]);
    expect(await queryBatches(io, home(), ["SELECT 1 AS n;", "SELECT 2 AS n"])).toEqual([[{ n: 1 }], [{ n: 2 }]]);
    expect(io.d1Calls.length).toBe(1);
    expect(io.d1Calls[0]?.statements).toEqual(["SELECT 1 AS n", "SELECT 2 AS n"]);
  });

  it("returns the result sets in the order the statements were asked in", async () => {
    const io = ioAnswering((statement) => (statement.endsWith("2") ? [] : [{ n: Number(/\d+/.exec(statement)?.[0] ?? 0) }]));
    expect(await queryBatches(io, home(), ["SELECT 1", "SELECT 2", "SELECT 3"])).toEqual([[{ n: 1 }], [], [{ n: 3 }]]);
  });

  it("reaches the database not at all for no statements", async () => {
    const io = ioAnswering([]);
    expect(await queryBatches(io, home(), [])).toEqual([]);
    expect(io.calls).toEqual([]);
    expect(io.d1Calls).toEqual([]);
  });

  it("names the home and D1's error when a deployed batch fails", async () => {
    const io = refusingRemote(7500, "no such table: t: SQLITE_ERROR");
    expect(await capture(() => queryBatches(io, REMOTE, ["SELECT 1 FROM t"]))).toMatchObject({
      kind: "external",
      message: "query `SELECT 1 FROM t` against remote (app-db) failed: no such table: t: SQLITE_ERROR (Cloudflare error 7500)",
    });
  });

  // A result set per statement is what makes the answers positional; one fewer would silently shift them.
  it("refuses a deployed reply carrying a different number of result sets than it asked statements", async () => {
    const io = remoteIo();
    io.restRules.push({ match: () => true, reply: () => cfEnvelope([{ results: [{ n: 1 }] }, { results: [{ n: 2 }] }]) });
    expect(await capture(() => queryBatches(io, REMOTE, ["SELECT 1", "SELECT 2", "SELECT 3"]))).toMatchObject({
      kind: "external",
      message: "the D1 REST API answered 2 result set(s) for 3 statements against remote",
    });
  });

  it("sends a deployed batch as one request, answering each statement through its own rows", async () => {
    const io = remoteIo();
    io.d1Rules.push({ match: () => true, reply: (statement) => [{ n: Number(/\d+/.exec(statement)?.[0] ?? 0) }] });
    expect(await queryBatches(io, REMOTE, ["SELECT 1 AS n", "SELECT 2 AS n", "SELECT 3 AS n"])).toEqual([[{ n: 1 }], [{ n: 2 }], [{ n: 3 }]]);
    expect(io.restCalls).toHaveLength(1);
    expect(bodyOf(io)).toEqual({ batch: [{ sql: "SELECT 1 AS n" }, { sql: "SELECT 2 AS n" }, { sql: "SELECT 3 AS n" }] });
  });

  // The port splits each element, so an element holding two statements answers one result set too many —
  // and locally wrangler never ran, so the message that reports it must not name wrangler.
  it("refuses a local element that holds more than one statement, naming the port that answered", async () => {
    const io = ioAnswering([]);
    expect(await capture(() => queryBatches(io, home(), ["SELECT 1; SELECT 2"]))).toMatchObject({
      kind: "external",
      message: "the in-process d1 binding answered 2 result set(s) for 1 statements against local",
    });
  });
});

describe("queryOne()", () => {
  it("takes the first row, and is an empty row when there are none", async () => {
    expect(await queryOne(ioAnswering([{ n: 1 }, { n: 2 }]), home(), "SELECT n FROM t")).toEqual({ n: 1 });
    expect(await queryOne(ioAnswering([]), home(), "SELECT n FROM t")).toEqual({});
  });
});

describe("queryRowsIfTable()", () => {
  it("returns the rows when the table is there", async () => {
    expect(await queryRowsIfTable(ioAnswering([{ name: "0001_init" }]), home(), "SELECT name FROM d1_migrations")).toEqual([{ name: "0001_init" }]);
  });

  it("is null when the database has never been migrated", async () => {
    const io = fakeDbIo();
    io.d1Rules.push({
      match: () => true,
      reply: () => {
        throw new Error("D1_ERROR: no such table: d1_migrations");
      },
    });
    expect(await queryRowsIfTable(io, home(), "SELECT name FROM d1_migrations")).toBeNull();
  });

  it("is null when a deployed database answers no such table", async () => {
    const io = refusingRemote(7500, "no such table: d1_migrations: SQLITE_ERROR");
    expect(await queryRowsIfTable(io, REMOTE, "SELECT name FROM d1_migrations")).toBeNull();
  });

  it("throws on any other failure rather than reading it as an empty database", async () => {
    const io = fakeDbIo();
    io.d1Rules.push({
      match: () => true,
      reply: () => {
        throw new Error("D1_ERROR: database is locked");
      },
    });
    expect((await capture(() => queryRowsIfTable(io, home(), "SELECT name FROM d1_migrations"))).message).toBe(
      "query `SELECT name FROM d1_migrations` against local (app-db) failed:\nD1_ERROR: database is locked",
    );
  });
});

describe("executeSql()", () => {
  it("puts the statement to the local database rather than an argv", async () => {
    const io = ioAnswering([]);
    await executeSql(io, home(), "DELETE FROM t");
    expect(io.calls).toEqual([]);
    expect(io.d1Calls[0]?.statements).toEqual(["DELETE FROM t"]);
  });

  it("sends a deployed statement as one { sql } request, spawning nothing", async () => {
    const io = remoteIo();
    await executeSql(io, REMOTE, "DELETE FROM t");
    expect(io.restCalls).toHaveLength(1);
    expect(bodyOf(io)).toEqual({ sql: "DELETE FROM t" });
    expect(io.calls).toEqual([]);
  });

  it("names a deployed failure as an execute", async () => {
    const io = refusingRemote(7500, "no such table: t: SQLITE_ERROR");
    expect((await capture(() => executeSql(io, REMOTE, "DELETE FROM t"))).message).toBe(
      "execute `DELETE FROM t` against remote (app-db) failed: no such table: t: SQLITE_ERROR (Cloudflare error 7500)",
    );
  });

  it("reports a failure as an execute", async () => {
    const io = fakeDbIo();
    io.d1Rules.push({
      match: () => true,
      reply: () => {
        throw new Error("no such table: t");
      },
    });
    expect((await capture(() => executeSql(io, home(), "DELETE FROM t"))).message).toBe(
      "execute `DELETE FROM t` against local (app-db) failed:\nno such table: t",
    );
  });
});

describe("executeFile()", () => {
  it("loads a local file's text in one call, naming the file it came from", async () => {
    const io = fakeDbIo({ "/tmp/dump.sql": "CREATE TABLE t (id INTEGER);\nINSERT INTO t VALUES (1);\n" });
    await executeFile(io, STANDBY, "/tmp/dump.sql");
    expect(io.calls).toEqual([]);
    expect(io.d1Calls).toEqual([
      {
        home: "standby",
        place: "local",
        persistTo: "/app/.forge/standby/app-db-standby/.wrangler/state/v3",
        statements: ["CREATE TABLE t (id INTEGER)", "INSERT INTO t VALUES (1)"],
        source: "/tmp/dump.sql",
      },
    ]);
  });

  it("sends a deployed file's text as one { sql } request, spawning nothing", async () => {
    const io = remoteIo({ "/tmp/dump.sql": "CREATE TABLE t (id INTEGER);\nINSERT INTO t VALUES (1);\n" });
    await executeFile(io, REMOTE, "/tmp/dump.sql");
    expect(io.restCalls).toHaveLength(1);
    expect(bodyOf(io)).toEqual({ sql: "CREATE TABLE t (id INTEGER);\nINSERT INTO t VALUES (1);\n" });
    expect(io.calls).toEqual([]);
    expect(io.d1Calls).toEqual([]);
  });

  it("names the file it could not load", async () => {
    const io = fakeDbIo({ "/tmp/dump.sql": "CREATE TABLE t (id INTEGER);" });
    io.d1Rules.push({
      match: () => true,
      reply: () => {
        throw new Error("parse error at line 3");
      },
    });
    expect((await capture(() => executeFile(io, home(), "/tmp/dump.sql"))).message).toBe(
      "loading /tmp/dump.sql against local (app-db) failed:\nparse error at line 3",
    );
  });

  describe("a local load refused at commit", () => {
    const FILE = "/tmp/orphan.sql";
    const SQL = "PRAGMA defer_foreign_keys = true;\nCREATE TABLE note (id INTEGER);\nINSERT INTO child (id, parent_id) VALUES (1, 99);\n";
    const STATEMENTS = ["PRAGMA defer_foreign_keys = true", "CREATE TABLE note (id INTEGER)", "INSERT INTO child (id, parent_id) VALUES (1, 99)"];
    const OPAQUE = "internal error; reference = unf7bq10q3mobq6tis9d5gbn";
    const RESET =
      "Durable Object was reset and rolled back to its last known good state because the application left the database in a state where constraints were violated: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)";
    const MARKED_AFTER_INSERT = `D1_ERROR: bad JSON path: 'forge-fk 2 "child" "parent"': SQLITE_ERROR`;
    const DIAGNOSIS =
      "FOREIGN KEY constraint failed: child first held a row with no match in parent after `INSERT INTO child (id, parent_id) VALUES (1, 99)`";
    const failure = (detail: string) => `loading ${FILE} against local (app-db) failed:\n${detail}`;

    /** A local database refusing the load with `refusal`, then answering the watch call with `watch` — an error, or the rows of a watch that committed. */
    function refusing(refusal: unknown, watch: Error | null): { io: FakeDbIo; sent: (readonly string[])[] } {
      const io = fakeDbIo({ [FILE]: SQL });
      const sent: (readonly string[])[] = [];
      const d1 = io.d1.bind(io);
      io.d1 = (target, sql) => {
        sent.push(sql);
        if (sent.length === 1) return Promise.reject(refusal);
        return watch === null ? d1(target, sql) : Promise.reject(watch);
      };
      return { io, sent };
    }

    const diagnosed: { name: string; refusal: string }[] = [
      { name: "the opaque internal error of workerd 1.20261019", refusal: OPAQUE },
      { name: "the reset-and-rolled-back message of wrangler 4.136", refusal: RESET },
    ];
    for (const { name, refusal } of diagnosed) {
      it(`replays the file under the foreign-key watch and names the violation ahead of ${name}`, async () => {
        const { io, sent } = refusing(new Error(refusal), new Error(MARKED_AFTER_INSERT));

        expect(await capture(() => executeFile(io, home(), FILE))).toMatchObject({
          kind: "external",
          message: failure(`${DIAGNOSIS}\n${refusal}`),
        });
        expect(sent).toEqual([[SQL], [foreignKeyWatch(STATEMENTS)]]);
        expect(io.calls).toEqual([]);
      });
    }

    const undiagnosed: { name: string; watch: Error | null }[] = [
      { name: "the watch reaches its sentinel", watch: new Error("D1_ERROR: bad JSON path: 'forge-fk none': SQLITE_ERROR") },
      { name: "the watch fails on an error it did not raise", watch: new Error("D1_ERROR: no such table: child: SQLITE_ERROR") },
      { name: "the watch commits rather than failing", watch: null },
    ];
    for (const { name, watch } of undiagnosed) {
      it(`keeps the original detail alone when ${name}`, async () => {
        const { io, sent } = refusing(new Error(OPAQUE), watch);

        expect(await capture(() => executeFile(io, home(), FILE))).toMatchObject({ kind: "external", message: failure(OPAQUE) });
        expect(sent.length).toBe(2);
      });
    }

    const unwatched: { name: string; refusal: string }[] = [
      { name: "an internal error D1 prefixes, the busy shape", refusal: "D1_ERROR: internal error; reference = kd8n226n3710119qmodjhvl0" },
      { name: "a statement error", refusal: "D1_ERROR: no such table: child: SQLITE_ERROR" },
      { name: "an internal error with more after it on the line", refusal: "internal error; reference = abc while closing" },
    ];
    for (const { name, refusal } of unwatched) {
      it(`runs no watch for ${name}, keeping the original detail`, async () => {
        const { io, sent } = refusing(new Error(refusal), new Error(MARKED_AFTER_INSERT));

        expect(await capture(() => executeFile(io, home(), FILE))).toMatchObject({ kind: "external", message: failure(refusal) });
        expect(sent).toEqual([[SQL]]);
      });
    }

    it("passes a refusal of the home's own configuration through unwrapped, running no watch", async () => {
      const refusal = new CliError("invalid-args", "/app/wrangler.jsonc declares no d1_databases binding named DB");
      const { io, sent } = refusing(refusal, new Error(MARKED_AFTER_INSERT));

      expect(await capture(() => executeFile(io, home(), FILE))).toBe(refusal);
      expect(sent).toEqual([[SQL]]);
    });

    it("runs no watch for a deployed load, whose refusal D1 reports as it answered it", async () => {
      const io = refusingRemote(7500, OPAQUE, { [FILE]: SQL });

      expect(await capture(() => executeFile(io, REMOTE, FILE))).toMatchObject({
        kind: "external",
        message: `loading ${FILE} against remote (app-db) failed: ${OPAQUE} (Cloudflare error 7500)`,
      });
      expect(io.restCalls.length).toBe(1);
      expect(io.calls).toEqual([]);
      expect(io.d1Calls).toEqual([]);
    });
  });
});

const WATCH_MARKED = `D1_ERROR: bad JSON path: 'forge-fk 3 "child" "parent"': SQLITE_ERROR`;
const WATCH_CLEAN = "D1_ERROR: bad JSON path: 'forge-fk none': SQLITE_ERROR";
const PARENT_REBUILD = [
  "PRAGMA defer_foreign_keys = true",
  'CREATE TABLE "parent_new" (id INTEGER PRIMARY KEY, a TEXT)',
  'INSERT INTO "parent_new" ("id", "a") SELECT "id", "a" FROM "parent"',
  'DROP TABLE "parent"',
  'ALTER TABLE "parent_new" RENAME TO "parent"',
];

describe("foreignKeyWatch()", () => {
  it("follows each statement with a check that names its index, ending in the always-failing sentinel", () => {
    expect(foreignKeyWatch(["PRAGMA defer_foreign_keys = true", 'DROP TABLE "parent"'])).toBe(
      [
        "PRAGMA defer_foreign_keys = true;",
        `SELECT json_extract('{}', 'forge-fk 0 ' || json_quote("table") || ' ' || json_quote("parent")) FROM pragma_foreign_key_check LIMIT 1;`,
        'DROP TABLE "parent";',
        `SELECT json_extract('{}', 'forge-fk 1 ' || json_quote("table") || ' ' || json_quote("parent")) FROM pragma_foreign_key_check LIMIT 1;`,
        "SELECT json_extract('{}', 'forge-fk none');",
      ].join("\n"),
    );
  });

  it("is the sentinel alone for no statements, so even an empty watch never commits", () => {
    expect(foreignKeyWatch([])).toBe("SELECT json_extract('{}', 'forge-fk none');");
  });
});

describe("describeForeignKeyWatch()", () => {
  it("names the child, the parent and the statement after which the check first found a row", () => {
    expect(describeForeignKeyWatch(WATCH_MARKED, PARENT_REBUILD.slice(0, 4))).toBe(
      'FOREIGN KEY constraint failed: child first held a row with no match in parent after `DROP TABLE "parent"`',
    );
  });

  it("undoes SQLite's doubled quote and the JSON escapes in a table name", () => {
    const message = String.raw`D1_ERROR: bad JSON path: 'forge-fk 1 "we''ird \"kid\"" "parent"': SQLITE_ERROR`;

    expect(describeForeignKeyWatch(message, PARENT_REBUILD)).toBe(
      `FOREIGN KEY constraint failed: we'ird "kid" first held a row with no match in parent after \`CREATE TABLE "parent_new" (id INTEGER PRIMARY KEY, a TEXT)\``,
    );
  });

  const unnamed: { name: string; message: string; statements: readonly string[] }[] = [
    { name: "the sentinel, reached with no violation", message: WATCH_CLEAN, statements: PARENT_REBUILD },
    { name: "an error the watch did not raise", message: "D1_ERROR: no such table: parent: SQLITE_ERROR", statements: PARENT_REBUILD },
    { name: "a marker whose index is past the last statement", message: WATCH_MARKED, statements: PARENT_REBUILD.slice(0, 3) },
  ];
  for (const { name, message, statements } of unnamed) {
    it(`answers null for ${name}`, () => {
      expect(describeForeignKeyWatch(message, statements)).toBeNull();
    });
  }

  it("quotes a long statement cut to its first 120 characters", () => {
    const head = "A".repeat(120);

    expect(describeForeignKeyWatch(WATCH_MARKED, ["", "", "", `${head}${"B".repeat(80)}`])).toBe(
      `FOREIGN KEY constraint failed: child first held a row with no match in parent after \`${head}\``,
    );
  });
});

describe("exportSql()", () => {
  it("runs a local schema export with --local, --no-data and no --persist-to, because export resolves state from the config's directory", async () => {
    const io = ioWith(() => true, OK);
    expect(await exportSql(io, STANDBY, "/tmp/out.sql", "schema")).toBeNull();
    expect(io.calls[0]).toEqual([
      "wrangler",
      "d1",
      "export",
      "app-db-standby",
      "-c",
      "/app/.forge/standby/app-db-standby/wrangler.jsonc",
      "--local",
      "--output",
      "/tmp/out.sql",
      "--no-data",
    ]);
  });

  // A separate wrangler process reads the state through its own handle, which cannot see what this
  // run's handle holds uncommitted to disk.
  it("releases the local handle before the export process reads the same state", async () => {
    const io = ioWith(() => true, OK);
    await exportSql(io, STANDBY, "/tmp/out.sql", "data");
    expect(io.closed).toEqual(["/app/.forge/standby/app-db-standby/.wrangler/state/v3"]);
  });

  it("forwards the environment before the output, and asks for the data part with --no-schema", async () => {
    const io = ioWith(() => true, OK);
    expect(await exportSql(io, home({ env: "staging" }), "/tmp/out.sql", "data")).toBeNull();
    expect(io.calls[0]).toEqual([
      "wrangler",
      "d1",
      "export",
      "app-db",
      "-c",
      "/app/wrangler.jsonc",
      "-e",
      "staging",
      "--local",
      "--output",
      "/tmp/out.sql",
      "--no-schema",
    ]);
  });

  it("exports a deployed database through D1's export, spawning nothing and releasing no handle, and answers its bookmark", async () => {
    const io = remoteIo();
    io.restRules.push(
      {
        match: (url) => url.endsWith("/export"),
        reply: () => cfEnvelope({ status: "complete", at_bookmark: "B", result: { filename: "d.sql", signed_url: SIGNED_URL } }),
      },
      { match: (url) => url === SIGNED_URL, reply: () => new Response("CREATE TABLE t (a);\n") },
    );
    expect(await exportSql(io, REMOTE, "/tmp/out.sql", "schema")).toBe("B");
    expect(io.readText("/tmp/out.sql")).toBe("CREATE TABLE t (a);\n");
    expect(io.calls).toEqual([]);
    expect(io.closed).toEqual([]);
  });

  it("throws with the exit code when a local export fails", async () => {
    const io = ioWith(() => true, { code: 1, stdout: "", stderr: "no such database" });
    expect((await capture(() => exportSql(io, home(), "/tmp/out.sql", "schema"))).message).toBe(
      "export against local (app-db) failed (exit 1):\nno such database",
    );
  });
});
