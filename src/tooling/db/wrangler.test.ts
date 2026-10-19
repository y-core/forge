import { describe, expect, it } from "bun:test";

import { CliError } from "../cli/errors";
import { argvHas, fakeDbIo, jsonBatches, jsonRows, OK } from "./db.fixture";
import type { FakeDbIo } from "./types";
import type { Home } from "./types";
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
  wranglerVersion,
} from "./wrangler";

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
  synthesized: true,
});

const REMOTE = home({ label: "remote", place: "remote", persistTo: null });
const PREVIEW = home({ label: "preview", place: "preview", persistTo: null });

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

  it("sends a remote query with --remote and no state directory", async () => {
    const io = ioWith((a) => argvHas(a, "execute"), jsonRows([]));
    await queryRows(io, REMOTE, "SELECT 1");
    expect(io.calls[0]).toEqual([
      "wrangler",
      "d1",
      "execute",
      "app-db",
      "-c",
      "/app/wrangler.jsonc",
      "--remote",
      "--json",
      "--command",
      "SELECT 1",
    ]);
    expect(io.d1Calls).toEqual([]);
  });

  it("sends a preview query with --remote --preview", async () => {
    const io = ioWith((a) => argvHas(a, "execute"), jsonRows([]));
    await queryRows(io, PREVIEW, "SELECT 1");
    expect(io.calls[0]?.slice(6, 8)).toEqual(["--remote", "--preview"]);
  });

  it("forwards the wrangler environment on the deployed path", async () => {
    const io = ioWith((a) => argvHas(a, "execute"), jsonRows([]));
    await queryRows(io, home({ label: "remote", place: "remote", persistTo: null, env: "staging" }), "SELECT 1");
    expect(io.calls[0]?.slice(4, 8)).toEqual(["-c", "/app/wrangler.jsonc", "-e", "staging"]);
  });

  it("reads a deployed payload printed after a banner line", async () => {
    const io = ioWith(() => true, {
      code: 0,
      stdout: '⛅️ wrangler 4.42.0\n🌀 Executing on local database\n[{"results":[{"name":"t"}],"success":true}]\n',
      stderr: "",
    });
    expect(await queryRows(io, REMOTE, "SELECT name FROM sqlite_master")).toEqual([{ name: "t" }]);
  });

  it("reads a deployed payload when wrangler appended an update notice after it", async () => {
    const io = ioWith(() => true, {
      code: 0,
      stdout: '[{"results":[{"name":"t"}],"success":true}]\nThere is a newer version of Wrangler available (current: 4.129.1, latest: 4.133.0).\n',
      stderr: "",
    });
    expect(await queryRows(io, REMOTE, "SELECT name FROM sqlite_master")).toEqual([{ name: "t" }]);
  });

  it("reads a deployed payload between a banner and a trailing notice", async () => {
    const io = ioWith(() => true, {
      code: 0,
      stdout: '⛅️ wrangler 4.129.1\n[{"results":[{"name":"t"}],"success":true}]\nUpdate available: 4.133.0\n',
      stderr: "",
    });
    expect(await queryRows(io, REMOTE, "SELECT name FROM sqlite_master")).toEqual([{ name: "t" }]);
  });

  it("returns no rows when the statement produced none", async () => {
    expect(await queryRows(ioAnswering([]), home(), "SELECT 1")).toEqual([]);
  });

  it("refuses deployed output carrying no JSON at all, naming the command", async () => {
    const io = ioWith(() => true, { code: 0, stdout: "⛅️ wrangler 4.42.0\n", stderr: "" });
    expect((await capture(() => queryRows(io, REMOTE, "SELECT 1"))).message).toBe(
      "query `SELECT 1` against remote (app-db) printed no JSON:\n⛅️ wrangler 4.42.0",
    );
  });

  it("refuses deployed output whose JSON is cut short, naming the command rather than throwing the parser's own error", async () => {
    const io = ioWith(() => true, { code: 0, stdout: '⛅️ wrangler 4.42.0\n{"truncated', stderr: "" });
    const thrown = await capture(() => queryRows(io, REMOTE, "SELECT 1"));
    expect(thrown.kind).toBe("external");
    expect(thrown.message.startsWith("query `SELECT 1` against remote (app-db) printed JSON this tool cannot read (")).toBe(true);
    expect(thrown.message.endsWith('):\n⛅️ wrangler 4.42.0\n{"truncated')).toBe(true);
  });

  it("names the home, the database and the exit code when a deployed run fails, as an external failure", async () => {
    const io = ioWith(() => true, { code: 2, stdout: "", stderr: '✘ [ERROR] near "SELEC": syntax error\n' });
    expect(await capture(() => queryRows(io, REMOTE, "SELEC 1"))).toMatchObject({
      kind: "external",
      message: 'query `SELEC 1` against remote (app-db) failed (exit 2):\n✘ [ERROR] near "SELEC": syntax error',
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

  it("names the home and the exit code when a deployed run fails", async () => {
    const io = ioWith(() => true, { code: 2, stdout: "", stderr: "✘ [ERROR] no such table: t\n" });
    expect(await capture(() => queryBatches(io, REMOTE, ["SELECT 1 FROM t"]))).toMatchObject({
      kind: "external",
      message: "query `SELECT 1 FROM t;` against remote (app-db) failed (exit 2):\n✘ [ERROR] no such table: t",
    });
  });

  // A result set per statement is what makes the answers positional; one fewer would silently shift them.
  it("refuses a deployed reply carrying a different number of result sets than it asked statements", async () => {
    const io = ioWith(() => true, jsonBatches([[{ n: 1 }]]));
    expect(await capture(() => queryBatches(io, REMOTE, ["SELECT 1", "SELECT 2"]))).toMatchObject({
      kind: "external",
      message: "wrangler answered 1 result set(s) for 2 statements against remote",
    });
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

  it("splits a deployed batch past the budget into as many spawns as it takes, concatenating the result sets in order", async () => {
    const io = fakeDbIo();
    const replies = [jsonBatches([[{ n: 1 }], [{ n: 2 }]]), jsonBatches([[{ n: 3 }]])];
    io.rules.push({ match: (a) => argvHas(a, "execute"), reply: () => replies[io.calls.length - 1] ?? OK });

    expect(await queryBatches(io, REMOTE, ["SELECT 1 AS n", "SELECT 2 AS n", "SELECT 3 AS n"], 40)).toEqual([[{ n: 1 }], [{ n: 2 }], [{ n: 3 }]]);
    expect(io.calls.map((call) => call.at(-1))).toEqual(["SELECT 1 AS n;\nSELECT 2 AS n;", "SELECT 3 AS n;"]);
  });

  it("gives a deployed statement longer than the budget a spawn of its own rather than splitting it", async () => {
    const io = fakeDbIo();
    const wide = `SELECT '${"x".repeat(60)}' AS n`;
    io.rules.push({ match: (a) => argvHas(a, "execute"), reply: jsonBatches([[{ n: 1 }]]) });

    expect(await queryBatches(io, REMOTE, ["SELECT 1 AS n", wide], 40)).toEqual([[{ n: 1 }], [{ n: 1 }]]);
    expect(io.calls.map((call) => call.at(-1))).toEqual(["SELECT 1 AS n;", `${wide};`]);
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

  it("passes --yes on the deployed path, so a non-interactive run is not asked to confirm", async () => {
    const io = ioWith(() => true, OK);
    await executeSql(io, REMOTE, "DELETE FROM t");
    expect(io.calls[0]).toEqual([
      "wrangler",
      "d1",
      "execute",
      "app-db",
      "-c",
      "/app/wrangler.jsonc",
      "--remote",
      "--yes",
      "--command",
      "DELETE FROM t",
    ]);
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

  it("loads a deployed file through --file", async () => {
    const io = ioWith(() => true, OK);
    await executeFile(io, REMOTE, "/tmp/dump.sql");
    expect(io.calls[0]?.slice(-2)).toEqual(["--file", "/tmp/dump.sql"]);
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

    it("runs no watch for a deployed load, whose refusal the CLI reports as it printed it", async () => {
      const io = ioWith(() => true, { code: 1, stdout: "", stderr: `${OPAQUE}\n` });

      expect(await capture(() => executeFile(io, REMOTE, FILE))).toMatchObject({
        kind: "external",
        message: `loading ${FILE} against remote (app-db) failed (exit 1):\n${OPAQUE}`,
      });
      expect(io.calls.length).toBe(1);
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
  it("runs with --local and no --persist-to, because export resolves state from the config's directory", async () => {
    const io = ioWith(() => true, OK);
    await exportSql(io, STANDBY, "/tmp/out.sql", ["--no-data"]);
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
    await exportSql(io, STANDBY, "/tmp/out.sql", []);
    expect(io.closed).toEqual(["/app/.forge/standby/app-db-standby/.wrangler/state/v3"]);
  });

  it("releases no handle for a deployed database, which holds none", async () => {
    const io = ioWith(() => true, OK);
    await exportSql(io, REMOTE, "/tmp/out.sql", []);
    expect(io.closed).toEqual([]);
  });

  it("forwards the environment before the output", async () => {
    const io = ioWith(() => true, OK);
    await exportSql(io, home({ env: "staging" }), "/tmp/out.sql", []);
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
    ]);
  });

  it("carries --remote for a deployed database and --remote --preview for its preview, still with no --persist-to", async () => {
    const io = ioWith(() => true, OK);
    await exportSql(io, REMOTE, "/tmp/out.sql", ["--no-data"]);
    await exportSql(io, PREVIEW, "/tmp/out.sql", ["--no-data"]);
    expect(io.calls).toEqual([
      ["wrangler", "d1", "export", "app-db", "-c", "/app/wrangler.jsonc", "--remote", "--output", "/tmp/out.sql", "--no-data"],
      ["wrangler", "d1", "export", "app-db", "-c", "/app/wrangler.jsonc", "--remote", "--preview", "--output", "/tmp/out.sql", "--no-data"],
    ]);
  });

  it("throws with the exit code when the export fails", async () => {
    const io = ioWith(() => true, { code: 1, stdout: "", stderr: "no such database" });
    expect((await capture(() => exportSql(io, home(), "/tmp/out.sql", []))).message).toBe(
      "export against local (app-db) failed (exit 1):\nno such database",
    );
  });
});

describe("wranglerVersion()", () => {
  it("takes the last line, which is where wrangler prints the number after its banner", () => {
    const io = ioWith((a) => argvHas(a, "--version"), { code: 0, stdout: " ⛅️ wrangler\n4.42.0\n", stderr: "" });
    expect(wranglerVersion(io, home())).toBe("4.42.0");
    expect(io.calls[0]).toEqual(["wrangler", "--version"]);
  });

  it("is unknown when wrangler could not be run, so a manifest still records something", () => {
    expect(wranglerVersion(fakeDbIo(), home())).toBe("unknown");
  });
});
