import { describe, expect, it } from "bun:test";

import { CliError } from "../cli/errors";
import { argvHas, fakeDbIo, jsonBatches, jsonRows, OK } from "./db.fixture";
import type { FakeDbIo } from "./types";
import type { Home } from "./types";
import { executeFile, executeSql, exportSql, queryBatches, queryOne, queryRows, queryRowsIfTable, runWrangler, wranglerVersion } from "./wrangler";

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
