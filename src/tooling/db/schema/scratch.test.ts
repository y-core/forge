import { describe, expect, it } from "bun:test";

import type { WranglerConfig } from "../../cf/types";
import { CliError } from "../../cli/errors";
import { PLAIN } from "../../term/color";
import { argvHas, fakeDbIo, OK } from "../db.fixture";
import { appHome } from "../home";
import type { DbConfig, DbRunContext, FakeDbIo, Migration } from "../types";
import { cachedSchemaModel, composeScratchHome, forgeVersion, loadDesired, localScratchConfig, replayBaseline, scratchModelKey } from "./scratch";
import type { DesiredState, SchemaModel } from "./types";

const MIGRATIONS = "/app/migrations";
const COMPOSE = "/app/.forge/scratch/compose";

function wranglerConfig(): WranglerConfig {
  return {
    name: "app",
    compatibility_date: "2026-01-01",
    d1_databases: [{ binding: "DB", database_name: "app-db", database_id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a" }],
  } as WranglerConfig;
}

function dbConfig(): DbConfig {
  return {
    root: "/app",
    configPath: "/app/wrangler.jsonc",
    config: wranglerConfig(),
    env: null,
    entry: { binding: "DB", databaseName: "app-db", databaseId: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a", previewDatabaseId: null },
    target: { place: "remote", database: "live" },
  };
}

function context(files: Record<string, string> = {}): { run: DbRunContext; io: FakeDbIo } {
  const io = fakeDbIo(files);
  const config = dbConfig();
  const run: DbRunContext = { config, home: appHome(config), io, host: {}, json: false, yes: true, style: PLAIN, print: () => {} };
  return { run, io };
}

function migration(appliedName: string, sql: string): Migration {
  return { name: appliedName, version: 1, path: `${MIGRATIONS}/${appliedName}.sql`, sha256: "0".repeat(64), sql, origin: "custom", stamp: null };
}

function desired(source: string, text: string): DesiredState {
  return { source, path: `/app/${source}`, files: [`/app/${source}`], text, digest: "d" };
}

const MODEL: SchemaModel = { tables: [], indexes: [], triggers: [], views: [] };
const VIEW = { name: "v", sql: "CREATE VIEW v AS SELECT 1", normalized: "CREATE VIEW V AS SELECT 1" };
const CACHED: SchemaModel = { ...MODEL, views: [VIEW] };

describe("localScratchConfig", () => {
  it("forces the target to local and leaves the rest of the config alone", () => {
    const config = dbConfig();
    const scratch = localScratchConfig(config);
    expect(scratch.target).toEqual({ place: "local", database: null });
    expect({ ...scratch, target: config.target }).toEqual(config);
  });
});

describe("composeScratchHome", () => {
  it("writes a synthesized config under the side's compose directory", () => {
    const { run, io } = context();
    const home = composeScratchHome(run, "baseline");
    expect(home.dir).toBe(`${COMPOSE}/baseline`);
    expect(home.configPath).toBe(`${COMPOSE}/baseline/wrangler.jsonc`);
    expect(home.database).toBe("app-db-compose-baseline");
    expect(home.place).toBe("local");
    expect(home.persistTo).toBe(`${COMPOSE}/baseline/.wrangler/state`);
    expect(home.synthesized).toBe(true);
    const generated = JSON.parse(io.readText(home.configPath)) as { d1_databases: Record<string, unknown>[] };
    expect(generated.d1_databases[0]).toEqual({
      binding: "DB",
      database_name: "app-db-compose-baseline",
      database_id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a",
    });
  });

  it("removes the miniflare state directory under the home's persist path", () => {
    const state = `${COMPOSE}/desired/.wrangler/state/v3/d1/miniflare-D1DatabaseObject`;
    const { run, io } = context({ [`${state}/db.sqlite`]: "stale", "/app/keep.sql": "kept" });
    composeScratchHome(run, "desired");
    expect(io.exists(`${state}/db.sqlite`)).toBe(false);
    expect(io.exists("/app/keep.sql")).toBe(true);
  });
});

describe("replayBaseline", () => {
  it("stages every migration's SQL in the baseline scratch and loads each with its own execute", () => {
    const { run, io } = context();
    io.rules.push({ match: (a) => argvHas(a, "execute", "--file"), reply: OK });
    const home = replayBaseline(run, [
      migration("0001_init", "CREATE TABLE a (id INTEGER);"),
      migration("0002_next", "CREATE TABLE b (id INTEGER);"),
    ]);
    expect(io.readText(`${COMPOSE}/baseline/0001_init.sql`)).toBe("CREATE TABLE a (id INTEGER);");
    expect(io.readText(`${COMPOSE}/baseline/0002_next.sql`)).toBe("CREATE TABLE b (id INTEGER);");
    expect(io.calls).toEqual([
      [
        "wrangler",
        "d1",
        "execute",
        "app-db-compose-baseline",
        "-c",
        `${COMPOSE}/baseline/wrangler.jsonc`,
        "--local",
        "--persist-to",
        `${COMPOSE}/baseline/.wrangler/state`,
        "--yes",
        "--file",
        `${COMPOSE}/baseline/0001_init.sql`,
      ],
      [
        "wrangler",
        "d1",
        "execute",
        "app-db-compose-baseline",
        "-c",
        `${COMPOSE}/baseline/wrangler.jsonc`,
        "--local",
        "--persist-to",
        `${COMPOSE}/baseline/.wrangler/state`,
        "--yes",
        "--file",
        `${COMPOSE}/baseline/0002_next.sql`,
      ],
    ]);
    expect(home.database).toBe("app-db-compose-baseline");
  });

  it("wraps a failing load in a CliError naming the replay", () => {
    const { run, io } = context();
    io.rules.push({ match: (a) => argvHas(a, "execute", "--file"), reply: { code: 1, stdout: "", stderr: 'near "CREAT": syntax error' } });
    let caught: unknown;
    try {
      replayBaseline(run, [migration("0001_init", "CREAT TABLE a;")]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CliError);
    expect((caught as CliError).kind).toBe("invalid-args");
    expect((caught as CliError).message.startsWith("the baseline replay failed")).toBe(true);
    expect((caught as CliError).message).toContain('near "CREAT": syntax error');
  });
});

describe("loadDesired", () => {
  it("writes each namespace's file and executes them in order", () => {
    const { run, io } = context();
    io.rules.push({ match: (a) => argvHas(a, "execute", "--file"), reply: OK });
    loadDesired(run, [desired("app", "CREATE TABLE a (id INTEGER);"), desired("lib-auth", "CREATE TABLE b (id INTEGER);")]);
    expect(io.readText(`${COMPOSE}/desired/files/app.sql`)).toBe("CREATE TABLE a (id INTEGER);");
    expect(io.readText(`${COMPOSE}/desired/files/lib-auth.sql`)).toBe("CREATE TABLE b (id INTEGER);");
    expect(io.calls.map((call) => call.at(-1))).toEqual([`${COMPOSE}/desired/files/app.sql`, `${COMPOSE}/desired/files/lib-auth.sql`]);
    expect(io.calls[0]).toEqual([
      "wrangler",
      "d1",
      "execute",
      "app-db-compose-desired",
      "-c",
      `${COMPOSE}/desired/wrangler.jsonc`,
      "--local",
      "--persist-to",
      `${COMPOSE}/desired/.wrangler/state`,
      "--yes",
      "--file",
      `${COMPOSE}/desired/files/app.sql`,
    ]);
  });

  it("wraps a failing execute in a CliError naming the desired path", () => {
    const { run, io } = context();
    io.rules.push({ match: (a) => argvHas(a, "execute", "--file"), reply: { code: 1, stdout: "", stderr: "no such table: main.users" } });
    let caught: unknown;
    try {
      loadDesired(run, [desired("schema.sql", "ALTER TABLE users ADD COLUMN x TEXT;")]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CliError);
    expect((caught as CliError).message.startsWith("/app/schema.sql does not execute against an empty database")).toBe(true);
  });
});

describe("scratchModelKey", () => {
  it("is sixteen lowercase hex characters", () => {
    expect(scratchModelKey("wrangler 4.105.0", "abc")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes when either the wrangler version or the inputs digest changes", () => {
    const base = scratchModelKey("wrangler 4.105.0", "abc");
    expect(scratchModelKey("wrangler 4.106.0", "abc")).not.toBe(base);
    expect(scratchModelKey("wrangler 4.105.0", "abd")).not.toBe(base);
    expect(scratchModelKey("wrangler 4.105.0", "abc")).toBe(base);
  });
});

describe("cachedSchemaModel", () => {
  it("returns the cached model without producing one", () => {
    const { run, io } = context({ [`${COMPOSE}/desired/cache/k1/model.json`]: `${JSON.stringify(CACHED)}\n` });
    let produced = 0;
    const model = cachedSchemaModel(run, "desired", "k1", true, () => {
      produced += 1;
      return MODEL;
    });
    expect(produced).toBe(0);
    expect(model).toEqual(CACHED);
    expect(io.calls).toEqual([]);
  });

  it("rebuilds rather than returns a cache entry that is not a schema model", () => {
    for (const text of ['{"tables":[],"indexes":[],"triggers":[]}', '{"tables":{}}', "null", "[]", "{", '"a model"']) {
      const { run } = context({ [`${COMPOSE}/desired/cache/k1/model.json`]: text });
      let produced = 0;
      const model = cachedSchemaModel(run, "desired", "k1", true, () => {
        produced += 1;
        return MODEL;
      });
      expect(produced).toBe(1);
      expect(model).toEqual(MODEL);
    }
  });

  it("bypasses the cache when caching is off", () => {
    const { run } = context({ [`${COMPOSE}/desired/cache/k1/model.json`]: `${JSON.stringify(CACHED)}\n` });
    let produced = 0;
    const model = cachedSchemaModel(run, "desired", "k1", false, () => {
      produced += 1;
      return MODEL;
    });
    expect(produced).toBe(1);
    expect(model).toEqual(MODEL);
  });

  it("writes the produced model to the key's path", () => {
    const { run, io } = context();
    cachedSchemaModel(run, "baseline", "k2", true, () => MODEL);
    expect(io.readText(`${COMPOSE}/baseline/cache/k2/model.json`)).toBe(`${JSON.stringify(MODEL)}\n`);
  });

  it("removes every other key's directory, keeping one model per side", () => {
    const { run, io } = context({ [`${COMPOSE}/desired/cache/old1/model.json`]: "{}", [`${COMPOSE}/desired/cache/old2/model.json`]: "{}" });
    cachedSchemaModel(run, "desired", "new", false, () => MODEL);
    expect(io.exists(`${COMPOSE}/desired/cache/old1`)).toBe(false);
    expect(io.exists(`${COMPOSE}/desired/cache/old2`)).toBe(false);
    expect(io.readDir(`${COMPOSE}/desired/cache`)).toEqual(["new"]);
  });
});

describe("forgeVersion", () => {
  it("is unknown when the package manifest cannot be read", () => {
    expect(forgeVersion(fakeDbIo())).toBe("unknown");
  });
});
