import { describe, expect, it } from "bun:test";

import { CliError } from "../cli/errors";
import { argvHas, fakeDbIo, jsonBatches, jsonRows, OK } from "./test-support";
import type { FakeDbIo } from "./types";
import type { Home } from "./types";
import { executeFile, executeSql, exportSql, queryBatches, queryOne, queryRows, queryRowsIfTable, runWrangler, wranglerVersion } from "./wrangler";

function home(over: Partial<Home> = {}): Home {
  return {
    label: "local",
    database: "app-db",
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

function capture(run: () => unknown): CliError {
  try {
    run();
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
  it("pins a local query to the config and the state directory", () => {
    const io = ioWith((a) => argvHas(a, "execute"), jsonRows([{ n: 1 }]));
    expect(queryRows(io, home(), "SELECT 1")).toEqual([{ n: 1 }]);
    expect(io.calls[0]).toEqual([
      "wrangler",
      "d1",
      "execute",
      "app-db",
      "-c",
      "/app/wrangler.jsonc",
      "--local",
      "--persist-to",
      "/app/.wrangler/state",
      "--json",
      "--command",
      "SELECT 1",
    ]);
  });

  it("pins a standby query to the generated config and its own state directory", () => {
    const io = ioWith((a) => argvHas(a, "execute"), jsonRows([]));
    queryRows(io, STANDBY, "SELECT 1");
    expect(io.calls[0]).toEqual([
      "wrangler",
      "d1",
      "execute",
      "app-db-standby",
      "-c",
      "/app/.forge/standby/app-db-standby/wrangler.jsonc",
      "--local",
      "--persist-to",
      "/app/.forge/standby/app-db-standby/.wrangler/state",
      "--json",
      "--command",
      "SELECT 1",
    ]);
  });

  it("sends a remote query with --remote and no state directory", () => {
    const io = ioWith((a) => argvHas(a, "execute"), jsonRows([]));
    queryRows(io, REMOTE, "SELECT 1");
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
  });

  it("sends a preview query with --remote --preview", () => {
    const io = ioWith((a) => argvHas(a, "execute"), jsonRows([]));
    queryRows(io, PREVIEW, "SELECT 1");
    expect(io.calls[0]).toEqual([
      "wrangler",
      "d1",
      "execute",
      "app-db",
      "-c",
      "/app/wrangler.jsonc",
      "--remote",
      "--preview",
      "--json",
      "--command",
      "SELECT 1",
    ]);
  });

  it("forwards the wrangler environment", () => {
    const io = ioWith((a) => argvHas(a, "execute"), jsonRows([]));
    queryRows(io, home({ env: "staging" }), "SELECT 1");
    expect(io.calls[0]).toEqual([
      "wrangler",
      "d1",
      "execute",
      "app-db",
      "-c",
      "/app/wrangler.jsonc",
      "-e",
      "staging",
      "--local",
      "--persist-to",
      "/app/.wrangler/state",
      "--json",
      "--command",
      "SELECT 1",
    ]);
  });

  it("reads the payload printed after a banner line", () => {
    const io = ioWith(() => true, {
      code: 0,
      stdout: '⛅️ wrangler 4.42.0\n🌀 Executing on local database\n[{"results":[{"name":"t"}],"success":true}]\n',
      stderr: "",
    });
    expect(queryRows(io, home(), "SELECT name FROM sqlite_master")).toEqual([{ name: "t" }]);
  });

  it("returns no rows when the statement produced none", () => {
    const io = ioWith(() => true, jsonRows([]));
    expect(queryRows(io, home(), "SELECT 1")).toEqual([]);
  });

  it("refuses output carrying no JSON at all, naming the command", () => {
    const io = ioWith(() => true, { code: 0, stdout: "⛅️ wrangler 4.42.0\n", stderr: "" });
    expect(() => queryRows(io, home(), "SELECT 1")).toThrow("query `SELECT 1` against local (app-db) printed no JSON:\n⛅️ wrangler 4.42.0");
  });

  it("refuses output whose JSON is cut short, naming the command rather than throwing the parser's own error", () => {
    const io = ioWith(() => true, { code: 0, stdout: '⛅️ wrangler 4.42.0\n{"truncated', stderr: "" });
    const thrown = capture(() => queryRows(io, home(), "SELECT 1"));
    expect(thrown.kind).toBe("external");
    expect(thrown.message.startsWith("query `SELECT 1` against local (app-db) printed JSON this tool cannot read (")).toBe(true);
    expect(thrown.message.endsWith('):\n⛅️ wrangler 4.42.0\n{"truncated')).toBe(true);
  });

  it("names the home, the database and the exit code when wrangler fails, as an external failure", () => {
    const io = ioWith(() => true, { code: 2, stdout: "", stderr: '✘ [ERROR] near "SELEC": syntax error\n' });
    expect(capture(() => queryRows(io, home(), "SELEC 1"))).toMatchObject({
      kind: "external",
      message: 'query `SELEC 1` against local (app-db) failed (exit 2):\n✘ [ERROR] near "SELEC": syntax error',
    });
  });
});

describe("queryBatches()", () => {
  it("sends every statement in one spawn, terminating each and doubling none", () => {
    const io = ioWith((a) => argvHas(a, "execute"), jsonBatches([[{ n: 1 }], [{ n: 2 }]]));
    expect(queryBatches(io, home(), ["SELECT 1 AS n;", "SELECT 2 AS n"])).toEqual([[{ n: 1 }], [{ n: 2 }]]);
    expect(io.calls.length).toBe(1);
    expect(io.calls[0]?.slice(-2)).toEqual(["--command", "SELECT 1 AS n;\nSELECT 2 AS n;"]);
  });

  it("returns the result sets in the order the statements were asked in", () => {
    const io = ioWith((a) => argvHas(a, "execute"), jsonBatches([[{ n: 1 }], [], [{ n: 3 }]]));
    expect(queryBatches(io, home(), ["SELECT 1", "SELECT 2", "SELECT 3"])).toEqual([[{ n: 1 }], [], [{ n: 3 }]]);
  });

  it("spawns nothing at all for no statements", () => {
    const io = ioWith(() => true, jsonRows([]));
    expect(queryBatches(io, home(), [])).toEqual([]);
    expect(io.calls).toEqual([]);
  });

  it("names the home and the exit code when wrangler fails", () => {
    const io = ioWith(() => true, { code: 2, stdout: "", stderr: "✘ [ERROR] no such table: t\n" });
    expect(capture(() => queryBatches(io, home(), ["SELECT 1 FROM t"]))).toMatchObject({
      kind: "external",
      message: "query `SELECT 1 FROM t;` against local (app-db) failed (exit 2):\n✘ [ERROR] no such table: t",
    });
  });

  // A result set per statement is what makes the answers positional; one fewer would silently shift them.
  it("refuses a reply carrying a different number of result sets than it asked statements", () => {
    const io = ioWith(() => true, jsonBatches([[{ n: 1 }]]));
    expect(capture(() => queryBatches(io, home(), ["SELECT 1", "SELECT 2"]))).toMatchObject({
      kind: "invalid-args",
      message: "wrangler answered 1 result set(s) for 2 statements against local",
    });
  });

  it("splits past the budget into as many spawns as it takes, concatenating the result sets in order", () => {
    const io = fakeDbIo();
    const replies = [jsonBatches([[{ n: 1 }], [{ n: 2 }]]), jsonBatches([[{ n: 3 }]])];
    io.rules.push({ match: (a) => argvHas(a, "execute"), reply: () => replies[io.calls.length - 1] ?? OK });

    expect(queryBatches(io, home(), ["SELECT 1 AS n", "SELECT 2 AS n", "SELECT 3 AS n"], 40)).toEqual([[{ n: 1 }], [{ n: 2 }], [{ n: 3 }]]);
    expect(io.calls.map((call) => call.at(-1))).toEqual(["SELECT 1 AS n;\nSELECT 2 AS n;", "SELECT 3 AS n;"]);
  });

  it("gives a statement longer than the budget a spawn of its own rather than splitting it", () => {
    const io = fakeDbIo();
    const wide = `SELECT '${"x".repeat(60)}' AS n`;
    io.rules.push({ match: (a) => argvHas(a, "execute"), reply: jsonBatches([[{ n: 1 }]]) });

    expect(queryBatches(io, home(), ["SELECT 1 AS n", wide], 40)).toEqual([[{ n: 1 }], [{ n: 1 }]]);
    expect(io.calls.map((call) => call.at(-1))).toEqual(["SELECT 1 AS n;", `${wide};`]);
  });
});

describe("queryOne()", () => {
  it("takes the first row, and is an empty row when there are none", () => {
    expect(
      queryOne(
        ioWith(() => true, jsonRows([{ n: 1 }, { n: 2 }])),
        home(),
        "SELECT n FROM t",
      ),
    ).toEqual({ n: 1 });
    expect(
      queryOne(
        ioWith(() => true, jsonRows([])),
        home(),
        "SELECT n FROM t",
      ),
    ).toEqual({});
  });
});

describe("queryRowsIfTable()", () => {
  it("returns the rows when the table is there", () => {
    expect(
      queryRowsIfTable(
        ioWith(() => true, jsonRows([{ name: "0001_init" }])),
        home(),
        "SELECT name FROM d1_migrations",
      ),
    ).toEqual([{ name: "0001_init" }]);
  });

  it("is null when the database has never been migrated", () => {
    const io = ioWith(() => true, { code: 1, stdout: "", stderr: "✘ [ERROR] no such table: d1_migrations\n" });
    expect(queryRowsIfTable(io, home(), "SELECT name FROM d1_migrations")).toBeNull();
  });

  it("throws on any other failure rather than reading it as an empty database", () => {
    const io = ioWith(() => true, { code: 1, stdout: "", stderr: "✘ [ERROR] database is locked\n" });
    expect(() => queryRowsIfTable(io, home(), "SELECT name FROM d1_migrations")).toThrow(
      "query `SELECT name FROM d1_migrations` against local (app-db) failed (exit 1):\n✘ [ERROR] database is locked",
    );
  });
});

describe("executeSql()", () => {
  it("passes --yes so a non-interactive run is not asked to confirm", () => {
    const io = ioWith(() => true, OK);
    executeSql(io, home(), "DELETE FROM t");
    expect(io.calls[0]).toEqual([
      "wrangler",
      "d1",
      "execute",
      "app-db",
      "-c",
      "/app/wrangler.jsonc",
      "--local",
      "--persist-to",
      "/app/.wrangler/state",
      "--yes",
      "--command",
      "DELETE FROM t",
    ]);
  });

  it("reports a failure as an execute", () => {
    const io = ioWith(() => true, { code: 1, stdout: "", stderr: "no such table: t" });
    expect(() => executeSql(io, home(), "DELETE FROM t")).toThrow(
      "execute `DELETE FROM t` against local (app-db) failed (exit 1):\nno such table: t",
    );
  });
});

describe("executeFile()", () => {
  it("loads a file against the home's place", () => {
    const io = ioWith(() => true, OK);
    executeFile(io, STANDBY, "/tmp/dump.sql");
    expect(io.calls[0]).toEqual([
      "wrangler",
      "d1",
      "execute",
      "app-db-standby",
      "-c",
      "/app/.forge/standby/app-db-standby/wrangler.jsonc",
      "--local",
      "--persist-to",
      "/app/.forge/standby/app-db-standby/.wrangler/state",
      "--yes",
      "--file",
      "/tmp/dump.sql",
    ]);
  });

  it("names the file it could not load", () => {
    const io = ioWith(() => true, { code: 1, stdout: "", stderr: "parse error at line 3" });
    expect(() => executeFile(io, home(), "/tmp/dump.sql")).toThrow(
      "loading /tmp/dump.sql against local (app-db) failed (exit 1):\nparse error at line 3",
    );
  });
});

describe("exportSql()", () => {
  it("runs with --local and no --persist-to, because export resolves state from the config's directory", () => {
    const io = ioWith(() => true, OK);
    exportSql(io, STANDBY, "/tmp/out.sql", ["--no-data"]);
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

  it("forwards the environment before the output", () => {
    const io = ioWith(() => true, OK);
    exportSql(io, home({ env: "staging" }), "/tmp/out.sql", []);
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

  it("carries --remote for a deployed database and --remote --preview for its preview, still with no --persist-to", () => {
    const io = ioWith(() => true, OK);
    exportSql(io, REMOTE, "/tmp/out.sql", ["--no-data"]);
    exportSql(io, PREVIEW, "/tmp/out.sql", ["--no-data"]);
    expect(io.calls).toEqual([
      ["wrangler", "d1", "export", "app-db", "-c", "/app/wrangler.jsonc", "--remote", "--output", "/tmp/out.sql", "--no-data"],
      ["wrangler", "d1", "export", "app-db", "-c", "/app/wrangler.jsonc", "--remote", "--preview", "--output", "/tmp/out.sql", "--no-data"],
    ]);
  });

  it("throws with the exit code when the export fails", () => {
    const io = ioWith(() => true, { code: 1, stdout: "", stderr: "no such database" });
    expect(() => exportSql(io, home(), "/tmp/out.sql", [])).toThrow("export against local (app-db) failed (exit 1):\nno such database");
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
