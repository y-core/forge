import { describe, expect, it } from "bun:test";

import type { WranglerConfig } from "../../cf/types";
import { PLAIN } from "../../term/color";
import { fakeDbIo } from "../db.fixture";
import { appHome } from "../home";
import type { DbConfig, DbRunContext, FakeDbIo, SeedFixtureOptions } from "../types";
import { composeSeedFixture } from "./fixture";
import { lintSeed } from "./lint";

const FIXTURE = "/app/tests/fixtures/seeds/0001_ledger.sql";
const SCHEMA = "/app/config/schema.sql";

/** The columns the declared schema is faked as having, in `cid` order. */
const COLUMNS: Record<string, string[]> = { projects: ["uuid", "name"], tasks: ["uuid", "project_uuid", "summary"] };

const ROWS = {
  projects: [{ uuid: "p1", name: "seed-fixture" }],
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

/** The scratch database as it would answer for itself. */
function wire(io: FakeDbIo, over: { foreignKeys?: number; columns?: Record<string, string[]>; counts?: Record<string, number> } = {}): void {
  const columns = over.columns ?? COLUMNS;
  io.d1Rules.push(
    { match: (statement) => statement.includes("pragma_foreign_keys"), reply: [{ foreign_keys: over.foreignKeys ?? 1 }] },
    {
      match: (statement) => statement.includes("pragma_table_info"),
      reply: (statement) => {
        const table = /pragma_table_info\('([^']+)'\)/.exec(statement)?.[1] ?? "";
        return (columns[table] ?? []).map((name, cid) => ({ cid, name, type: "TEXT", notnull: 0, pk: 0 }));
      },
    },
    {
      match: (statement) => statement.includes("COUNT(*)"),
      reply: (statement) => {
        const table = /FROM "([^"]+)"/.exec(statement)?.[1] ?? "";
        return [{ rows: over.counts?.[table] ?? (ROWS[table as keyof typeof ROWS] ?? []).length }];
      },
    },
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
INSERT OR IGNORE INTO "projects" ("uuid","name") VALUES ('p1','seed-fixture');
INSERT OR IGNORE INTO "tasks" ("uuid","project_uuid","summary") VALUES ('t1','p1','Read the board');
INSERT OR IGNORE INTO "tasks" ("uuid","project_uuid","summary") VALUES ('t2','p1',replace('A body~~N~~over two lines','~~N~~',char(10)));
`;

describe("await composeSeedFixture()", () => {
  it("writes the seed byte for byte, with the places line and one idempotent statement per row", async () => {
    const { run, io } = context();
    wire(io);

    const outcome = await composeSeedFixture(run, OPTIONS);

    expect(outcome.sql).toBe(EXPECTED);
    expect(io.readText(FIXTURE)).toBe(EXPECTED);
    expect(outcome.tables).toEqual([
      { name: "projects", rows: 1, dropped: [] },
      { name: "tasks", rows: 2, dropped: [] },
    ]);
  });

  it("composes the same rows to the same hash twice, since nothing in the text is stamped with the run", async () => {
    const first = context();
    wire(first.io);
    const second = context();
    wire(second.io);

    expect((await composeSeedFixture(first.run, OPTIONS)).sha256).toBe((await composeSeedFixture(second.run, OPTIONS)).sha256);
  });

  it("writes no places line when the caller names no place", async () => {
    const { run, io } = context();
    wire(io);

    expect((await composeSeedFixture(run, { path: FIXTURE, tables: ["projects"], rows: { projects: ROWS.projects } })).sql).toBe(
      `INSERT OR IGNORE INTO "projects" ("uuid","name") VALUES ('p1','seed-fixture');\n`,
    );
  });

  it("draws no seed-insert-not-idempotent finding from the linter that judges the file it wrote", async () => {
    const { run, io } = context();
    wire(io);

    const outcome = await composeSeedFixture(run, OPTIONS);

    expect(lintSeed(outcome.path, outcome.sql)).toEqual([]);
  });

  it("refuses a path outside every declared seeds directory", async () => {
    const { run, io } = context();
    wire(io);

    await expect(composeSeedFixture(run, { ...OPTIONS, path: "/app/tmp/0001_ledger.sql" })).rejects.toThrow(
      "/app/tmp/0001_ledger.sql is outside every seeds directory `config/db.ts` names (tests/fixtures/seeds)",
    );
    await expect(composeSeedFixture(run, { ...OPTIONS, path: "/app/tests/fixtures/seeds/ledger.txt" })).rejects.toThrow("is not a .sql file");
  });

  it("refuses a table the declared schema does not create", async () => {
    const { run, io } = context();
    wire(io);

    await expect(composeSeedFixture(run, { ...OPTIONS, tables: ["projects", "epics"], rows: { ...ROWS, epics: [] } })).rejects.toThrow(
      "the declared schema has no table `epics` — the fixture names one it does not create",
    );
  });

  it("refuses a row missing a column the schema declares, naming both", async () => {
    const { run, io } = context();
    wire(io, { columns: { ...COLUMNS, projects: ["uuid", "name", "created_at"] } });

    await expect(composeSeedFixture(run, OPTIONS)).rejects.toThrow(
      "projects declares created_at, which the rows given here do not carry — add the column to them",
    );
  });

  it("reports a column the schema no longer declares, and emits nothing for it", async () => {
    const { run, io } = context();
    wire(io, { columns: { ...COLUMNS, projects: ["uuid"] } });

    const outcome = await composeSeedFixture(run, OPTIONS);

    expect(outcome.tables[0]).toEqual({ name: "projects", rows: 1, dropped: ["name"] });
    expect(outcome.sql).toContain(`INSERT OR IGNORE INTO "projects" ("uuid") VALUES ('p1');`);
    expect(outcome.sql).not.toContain("seed-fixture");
  });

  it("refuses a seed variable in a row, naming it", async () => {
    const { run, io } = context();
    wire(io);
    const rows = { ...ROWS, projects: [{ uuid: "p1", name: "${TASK} board" }] };

    await expect(composeSeedFixture(run, { ...OPTIONS, rows })).rejects.toThrow(
      "the rows hold ${TASK}, which `seed apply` substitutes from the environment",
    );
  });

  it("refuses a loaded count below the authored count, which is a key OR IGNORE swallowed", async () => {
    const { run, io } = context();
    wire(io, { counts: { projects: 1, tasks: 1 } });

    await expect(composeSeedFixture(run, OPTIONS)).rejects.toThrow("tasks: 2 row(s) are given here and 1 loaded — two of them share a key");
  });

  it("refuses a scratch database with foreign keys off, which would prove nothing", async () => {
    const { run, io } = context();
    wire(io, { foreignKeys: 0 });

    await expect(composeSeedFixture(run, OPTIONS)).rejects.toThrow("the scratch database has foreign keys off");
  });

  it("names the constraint that refused a row when the load fails, and writes no file", async () => {
    const { run, io } = context();
    wire(io);
    io.d1Rules.unshift({
      match: (statement) => statement.startsWith("INSERT"),
      reply: () => {
        throw new Error("FOREIGN KEY constraint failed");
      },
    });

    await expect(composeSeedFixture(run, OPTIONS)).rejects.toThrow("FOREIGN KEY constraint failed");
    expect(io.exists(FIXTURE)).toBe(false);
  });
});
