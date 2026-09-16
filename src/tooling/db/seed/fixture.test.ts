import { describe, expect, it } from "bun:test";

import type { WranglerConfig } from "../../cf/types";
import { PLAIN } from "../../term/color";
import { appHome } from "../home";
import { argvHas, fakeDbIo, jsonBatches, jsonRows, OK } from "../test-support";
import type { DbConfig, DbRunContext, FakeDbIo, SeedFixtureOptions } from "../types";
import { composeSeedFixture } from "./fixture";
import { lintSeed } from "./lint";

const FIXTURE = "/app/tests/fixtures/seeds/0001_ledger.sql";
const SCHEMA = "/app/config/schema.sql";

/** The columns the declared schema is faked as having, in `cid` order. */
const COLUMNS: Record<string, string[]> = { projects: ["uuid", "name"], tasks: ["uuid", "project_uuid", "summary"] };

const ROWS = {
  projects: [{ uuid: "p1", name: "task-forge" }],
  tasks: [
    { uuid: "t1", project_uuid: "p1", summary: "Read the board" },
    { uuid: "t2", project_uuid: "p1", summary: "A body\nover two lines" },
  ],
};

function dbConfig(): DbConfig {
  return {
    root: "/app",
    configPath: "/app/wrangler.jsonc",
    config: { name: "app", compatibility_date: "2026-01-01" } as WranglerConfig,
    env: null,
    entry: { binding: "DB", databaseName: "app-db", databaseId: null, previewDatabaseId: null },
    target: { place: "local", database: null },
  };
}

const command = (a: readonly string[]) => (argvHas(a, "execute", "--json", "--command") ? (a.at(-1) ?? "") : "");

/**
 * The scratch database as wrangler would answer for it: foreign keys on, each table's columns in the
 * order asked for, and a count per table taken from what the emitted statements actually loaded.
 */
function wire(io: FakeDbIo, over: { foreignKeys?: number; columns?: Record<string, string[]>; counts?: Record<string, number> } = {}): void {
  const columns = over.columns ?? COLUMNS;
  io.rules.push(
    { match: (a) => command(a).includes("pragma_foreign_keys"), reply: jsonRows([{ foreign_keys: over.foreignKeys ?? 1 }]) },
    {
      match: (a) => command(a).includes("pragma_table_info"),
      reply: (a) => {
        const asked = [...command(a).matchAll(/pragma_table_info\('([^']+)'\)/g)].map((match) => match[1] ?? "");
        return jsonBatches(asked.map((table) => (columns[table] ?? []).map((name, cid) => ({ cid, name, type: "TEXT", notnull: 0, pk: 0 }))));
      },
    },
    {
      match: (a) => command(a).includes("COUNT(*)"),
      reply: (a) => {
        const asked = [...command(a).matchAll(/FROM "([^"]+)"/g)].map((match) => match[1] ?? "");
        return jsonBatches(asked.map((table) => [{ rows: over.counts?.[table] ?? (ROWS[table as keyof typeof ROWS] ?? []).length }]));
      },
    },
    { match: (a) => command(a) !== "", reply: jsonRows([]) },
    { match: (a) => argvHas(a, "execute", "--yes"), reply: OK },
  );
}

function context(): { run: DbRunContext; io: FakeDbIo } {
  const io = fakeDbIo({ [SCHEMA]: "CREATE TABLE projects (uuid TEXT PRIMARY KEY, name TEXT) STRICT;" });
  const config = dbConfig();
  const run: DbRunContext = {
    config,
    home: appHome(config),
    io,
    host: { schemas: ["config/schema.sql"], seeds: ["tests/fixtures/seeds"] },
    json: false,
    yes: true,
    style: PLAIN,
    print: () => {},
  };
  return { run, io };
}

const OPTIONS: SeedFixtureOptions = { path: FIXTURE, tables: ["projects", "tasks"], rows: ROWS, places: ["standby"] };

const EXPECTED = `-- forge:places standby
INSERT OR IGNORE INTO "projects" ("uuid","name") VALUES ('p1','task-forge');
INSERT OR IGNORE INTO "tasks" ("uuid","project_uuid","summary") VALUES ('t1','p1','Read the board');
INSERT OR IGNORE INTO "tasks" ("uuid","project_uuid","summary") VALUES ('t2','p1',replace('A body~~N~~over two lines','~~N~~',char(10)));
`;

describe("composeSeedFixture()", () => {
  it("writes the seed byte for byte, with the places line and one idempotent statement per row", () => {
    const { run, io } = context();
    wire(io);

    const outcome = composeSeedFixture(run, OPTIONS);

    expect(outcome.sql).toBe(EXPECTED);
    expect(io.readText(FIXTURE)).toBe(EXPECTED);
    expect(outcome.tables).toEqual([
      { name: "projects", rows: 1, dropped: [] },
      { name: "tasks", rows: 2, dropped: [] },
    ]);
  });

  it("composes the same rows to the same hash twice, since nothing in the text is stamped with the run", () => {
    const first = context();
    wire(first.io);
    const second = context();
    wire(second.io);

    expect(composeSeedFixture(first.run, OPTIONS).sha256).toBe(composeSeedFixture(second.run, OPTIONS).sha256);
  });

  it("writes no places line when the caller names no place", () => {
    const { run, io } = context();
    wire(io);

    expect(composeSeedFixture(run, { path: FIXTURE, tables: ["projects"], rows: { projects: ROWS.projects } }).sql).toBe(
      `INSERT OR IGNORE INTO "projects" ("uuid","name") VALUES ('p1','task-forge');\n`,
    );
  });

  it("draws no seed-insert-not-idempotent finding from the linter that judges the file it wrote", () => {
    const { run, io } = context();
    wire(io);

    const outcome = composeSeedFixture(run, OPTIONS);

    expect(lintSeed(outcome.path, outcome.sql)).toEqual([]);
  });

  it("refuses a path outside every declared seeds directory", () => {
    const { run, io } = context();
    wire(io);

    expect(() => composeSeedFixture(run, { ...OPTIONS, path: "/app/tmp/0001_ledger.sql" })).toThrow(
      "/app/tmp/0001_ledger.sql is outside every seeds directory `config/db.ts` names (tests/fixtures/seeds)",
    );
    expect(() => composeSeedFixture(run, { ...OPTIONS, path: "/app/tests/fixtures/seeds/ledger.txt" })).toThrow("is not a .sql file");
  });

  it("refuses a table the declared schema does not create", () => {
    const { run, io } = context();
    wire(io);

    expect(() => composeSeedFixture(run, { ...OPTIONS, tables: ["projects", "epics"], rows: { ...ROWS, epics: [] } })).toThrow(
      "the declared schema has no table `epics` — the fixture names one it does not create",
    );
  });

  it("refuses a row missing a column the schema declares, naming both", () => {
    const { run, io } = context();
    wire(io, { columns: { ...COLUMNS, projects: ["uuid", "name", "created_at"] } });

    expect(() => composeSeedFixture(run, OPTIONS)).toThrow(
      "projects declares created_at, which the rows given here do not carry — add the column to them",
    );
  });

  it("reports a column the schema no longer declares, and emits nothing for it", () => {
    const { run, io } = context();
    wire(io, { columns: { ...COLUMNS, projects: ["uuid"] } });

    const outcome = composeSeedFixture(run, OPTIONS);

    expect(outcome.tables[0]).toEqual({ name: "projects", rows: 1, dropped: ["name"] });
    expect(outcome.sql).toContain(`INSERT OR IGNORE INTO "projects" ("uuid") VALUES ('p1');`);
    expect(outcome.sql).not.toContain("task-forge");
  });

  it("refuses a seed variable in a row, naming it", () => {
    const { run, io } = context();
    wire(io);
    const rows = { ...ROWS, projects: [{ uuid: "p1", name: "${TASK} board" }] };

    expect(() => composeSeedFixture(run, { ...OPTIONS, rows })).toThrow(
      "the rows hold ${TASK}, which `seed apply` substitutes from the environment",
    );
  });

  it("refuses a loaded count below the authored count, which is a key OR IGNORE swallowed", () => {
    const { run, io } = context();
    wire(io, { counts: { projects: 1, tasks: 1 } });

    expect(() => composeSeedFixture(run, OPTIONS)).toThrow("tasks: 2 row(s) are given here and 1 loaded — two of them share a key");
  });

  it("refuses a scratch database with foreign keys off, which would prove nothing", () => {
    const { run, io } = context();
    wire(io, { foreignKeys: 0 });

    expect(() => composeSeedFixture(run, OPTIONS)).toThrow("the scratch database has foreign keys off");
  });

  it("names the constraint that refused a row when the load fails, and writes no file", () => {
    const { run, io } = context();
    wire(io);
    io.rules.unshift({
      match: (a) => argvHas(a, "execute", "--yes", "--file"),
      reply: { code: 1, stdout: "", stderr: "FOREIGN KEY constraint failed" },
    });

    expect(() => composeSeedFixture(run, OPTIONS)).toThrow("FOREIGN KEY constraint failed");
    expect(io.exists(FIXTURE)).toBe(false);
  });
});
