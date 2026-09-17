import { describe, expect, it } from "bun:test";

import type { WranglerConfig } from "../../cf/types";
import { PLAIN } from "../../term/color";
import { argvHas, fakeDbIo, OK, schemaModelReply } from "../db.fixture";
import { sha256 } from "../digest";
import { appHome } from "../home";
import { migrationsDigest } from "../migrate/files";
import type { DbConfig, DbHostConfig, DbRunContext, FakeDbIo, Spawned } from "../types";
import { checkSchema, formatSchemaCheck } from "./check";
import { buildSchemaSnapshot, formatSchemaSnapshot } from "./snapshot";

const ROOT = "/app";
const MIGRATIONS = `${ROOT}/config/migrations`;
const SCHEMA = "config/schema.sql";
const LIB = "node_modules/acme/schema.sql";
const SNAPSHOT = `${ROOT}/schema.snapshot.json`;
const BASELINE_STATE = `${ROOT}/.forge/scratch/compose/baseline/.wrangler/state`;
const DESIRED_STATE = `${ROOT}/.forge/scratch/compose/desired/.wrangler/state`;

const INIT = "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL) STRICT;\n";

interface Shape {
  readonly name: string;
  readonly columns: readonly (readonly [string, string])[];
}

const USERS: Shape = {
  name: "users",
  columns: [
    ["id", "INTEGER PRIMARY KEY"],
    ["email", "TEXT NOT NULL"],
  ],
};
const USERS_WITH_NICKNAME: Shape = { name: "users", columns: [...USERS.columns, ["nickname", "TEXT"]] };

function ddl(shape: Shape): string {
  return `CREATE TABLE ${shape.name} (${shape.columns.map(([name, rest]) => `${name} ${rest}`).join(", ")}) STRICT`;
}

function schemaText(shapes: readonly Shape[]): string {
  return `${shapes.map((shape) => `${ddl(shape)};`).join("\n\n")}\n`;
}

function shapeRows(shapes: readonly Shape[]) {
  return {
    inventory: shapes.map((shape) => ({ type: "table", name: shape.name, tbl_name: shape.name, sql: ddl(shape) })),
    columns: shapes.flatMap((shape) =>
      shape.columns.map(([name, rest], cid) => ({
        tbl: shape.name,
        cid,
        name,
        type: rest.split(" ")[0],
        notnull: /\bNOT NULL\b/.test(rest) ? 1 : 0,
        dflt_value: null,
        pk: /\bPRIMARY KEY\b/.test(rest) ? 1 : 0,
        hidden: 0,
      })),
    ),
    indexList: [],
    indexColumns: [],
    foreignKeys: [],
  };
}

function snapshotText(_shapes: readonly Shape[], fields: { desired: Record<string, string>; migrationsDigest: string }): string {
  return formatSchemaSnapshot(buildSchemaSnapshot({ ...fields, declared: {} }));
}

function dbConfig(): DbConfig {
  return {
    root: ROOT,
    configPath: `${ROOT}/wrangler.jsonc`,
    config: { name: "app", compatibility_date: "2026-01-01", d1_databases: [{ binding: "DB", database_name: "app-db" }] } as WranglerConfig,
    env: null,
    entry: { binding: "DB", databaseName: "app-db", databaseId: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a", previewDatabaseId: null },
    target: { place: "local", database: null },
  };
}

function context(files: Record<string, string>, host: DbHostConfig = { schemas: [SCHEMA] }): { run: DbRunContext; io: FakeDbIo } {
  const io = fakeDbIo(files, { now: new Date("2026-09-11T10:00:00Z") });
  const config = dbConfig();
  const run: DbRunContext = {
    config,
    home: appHome(config),
    io,
    host: { migrations: "config/migrations", ...host },
    json: false,
    yes: true,
    style: PLAIN,
    print: () => undefined,
  };
  return { run, io };
}

function introspect(shapes: readonly Shape[]): (args: readonly string[]) => Spawned {
  return () => {
    const rows = shapeRows(shapes);
    return schemaModelReply({ inventory: rows.inventory, columns: rows.columns });
  };
}

function wire(io: FakeDbIo, sides: { baseline: readonly Shape[]; desired: readonly Shape[] }): void {
  io.rules.push(
    { match: (a) => argvHas(a, "--version"), reply: { code: 0, stdout: "4.0.0\n", stderr: "" } },
    { match: (a) => argvHas(a, "execute", "--file"), reply: OK },
    { match: (a) => argvHas(a, "--persist-to", BASELINE_STATE, "--json", "--command"), reply: introspect(sides.baseline) },
    { match: (a) => argvHas(a, "--persist-to", DESIRED_STATE, "--json", "--command"), reply: introspect(sides.desired) },
  );
}

const DIGESTS: { desired: Record<string, string>; migrationsDigest: string } = {
  desired: { [SCHEMA]: sha256(schemaText([USERS])) },
  migrationsDigest: migrationsDigest([{ name: "0001_init", sha256: sha256(INIT) }]),
};

const NO_REPLAY = { replay: false, cache: true };

describe("checkSchema()", () => {
  const migration = { [`${MIGRATIONS}/0001_init.sql`]: INIT };
  const schemaAt = (path: string, shapes: readonly Shape[]) => ({ [`${ROOT}/${path}`]: schemaText(shapes) });

  it("has nothing to hold in step when config/db.ts names no schemas and no snapshot exists", () => {
    const { run } = context(migration, {});

    expect(checkSchema(run, NO_REPLAY)).toEqual({ snapshotPath: SNAPSHOT, schemas: [], problems: null });
  });

  // An absent file is dropped on the way in, so the states count alone cannot tell a declaration
  // naming a missing file from no declaration at all — and reporting clean is the wrong answer.
  it("reports a schema config/db.ts declares with no file behind it, rather than reporting clean", () => {
    const { run } = context(migration);

    expect(checkSchema(run, NO_REPLAY).problems).toEqual([`${SCHEMA} is declared in config/db.ts and no file is there to read`]);
  });

  it("names the compose that writes the first snapshot when a schema is declared and none exists", () => {
    const { run } = context({ ...migration, ...schemaAt(SCHEMA, [USERS]) });

    expect(checkSchema(run, NO_REPLAY).problems).toEqual([`${SNAPSHOT} does not exist — run \`forge db migrate compose\` once to write it`]);
  });

  it("reports a declared schema edited since the last compose, by the path config/db.ts names", () => {
    const { run } = context({ ...migration, ...schemaAt(SCHEMA, [USERS_WITH_NICKNAME]), [SNAPSHOT]: snapshotText([USERS], DIGESTS) });

    expect(checkSchema(run, NO_REPLAY).problems).toEqual([`${SCHEMA} moved since the last compose`]);
  });

  it("reports an upgraded library by the same rule, which is what replaces the schema lock", () => {
    const libText = "CREATE TABLE acme_things (id INTEGER PRIMARY KEY) STRICT;\n";
    const { run } = context(
      {
        ...migration,
        ...schemaAt(SCHEMA, [USERS]),
        [`${ROOT}/${LIB}`]: `${libText}ALTER TABLE acme_things ADD COLUMN note TEXT;\n`,
        [SNAPSHOT]: snapshotText([USERS], { ...DIGESTS, desired: { ...DIGESTS.desired, [LIB]: sha256(libText) } }),
      },
      { schemas: [LIB, SCHEMA] },
    );

    expect(checkSchema(run, NO_REPLAY).problems).toEqual([`${LIB} moved since the last compose`]);
  });

  it("reports a schema the snapshot has never seen, and one the snapshot holds that is no longer declared", () => {
    const { run } = context({
      ...migration,
      ...schemaAt(SCHEMA, [USERS]),
      [SNAPSHOT]: snapshotText([USERS], { ...DIGESTS, desired: { [LIB]: "x" } }),
    });

    expect(checkSchema(run, NO_REPLAY).problems).toEqual([
      `${SCHEMA} is declared and the snapshot has never seen it`,
      `${LIB} is in the snapshot and config/db.ts no longer declares it, or the file is absent`,
    ]);
  });

  it("reports migrations changed since the last compose, naming the latest", () => {
    const { run } = context({
      ...migration,
      [`${MIGRATIONS}/0002_notes.sql`]: "CREATE TABLE notes (id INTEGER PRIMARY KEY) STRICT;\n",
      ...schemaAt(SCHEMA, [USERS]),
      [SNAPSHOT]: snapshotText([USERS], DIGESTS),
    });

    expect(checkSchema(run, NO_REPLAY).problems).toEqual([
      "the migrations changed after the last compose (latest: 0002_notes) — run `forge db migrate compose`",
    ]);
  });

  it("finds nothing wrong when every digest matches the snapshot", () => {
    const { run } = context({ ...migration, ...schemaAt(SCHEMA, [USERS]), [SNAPSHOT]: snapshotText([USERS], DIGESTS) });

    expect(checkSchema(run, NO_REPLAY).problems).toEqual([]);
  });

  it("compares the replayed migrations against the declared schema when --replay asks, though the digests agree", () => {
    const { run, io } = context({ ...migration, ...schemaAt(SCHEMA, [USERS]), [SNAPSHOT]: snapshotText([USERS], DIGESTS) });
    wire(io, { baseline: [USERS], desired: [USERS_WITH_NICKNAME] });

    expect(checkSchema(run, { replay: true, cache: true }).problems).toEqual([
      "table users: differs between the replayed migrations and the declared schema",
    ]);
  });

  it("replays and finds nothing when both scratch databases agree with the snapshot", () => {
    const { run, io } = context({ ...migration, ...schemaAt(SCHEMA, [USERS]), [SNAPSHOT]: snapshotText([USERS], DIGESTS) });
    wire(io, { baseline: [USERS], desired: [USERS] });

    expect(checkSchema(run, { replay: true, cache: true }).problems).toEqual([]);
  });

  it("matches a replayed name to the snapshot's as SQLite resolves it, so a case-only difference is none", () => {
    const { run, io } = context({ ...migration, ...schemaAt(SCHEMA, [USERS]), [SNAPSHOT]: snapshotText([USERS], DIGESTS) });
    wire(io, { baseline: [{ ...USERS, name: "Users" }], desired: [USERS] });

    expect(checkSchema(run, { replay: true, cache: true }).problems).toEqual([]);
  });

  it("checks that the declarations execute, and holds nothing to a snapshot, for a checkout that composes nothing", () => {
    const { run, io } = context(schemaAt(SCHEMA, [USERS]));
    wire(io, { baseline: [], desired: [USERS] });

    const report = checkSchema(run, { replay: true, cache: true });

    expect(report.problems).toEqual([]);
    expect(report.snapshotPath).toBe(null);
  });
});

describe("formatSchemaCheck()", () => {
  it("says there is nothing to hold in step when nothing is declared", () => {
    expect(formatSchemaCheck({ snapshotPath: SNAPSHOT, schemas: [], problems: null })).toEqual([
      "config/db.ts names no `schemas`, and there is no snapshot — nothing to hold in step",
    ]);
  });

  it("names every declared schema when they match", () => {
    expect(formatSchemaCheck({ snapshotPath: SNAPSHOT, schemas: [LIB, SCHEMA], problems: [] })).toEqual([`${LIB}, ${SCHEMA} match ${SNAPSHOT}`]);
  });

  it("prints the snapshot path and an indented problem each", () => {
    expect(formatSchemaCheck({ snapshotPath: SNAPSHOT, schemas: [SCHEMA], problems: ["edited", "and renumbered"] })).toEqual([
      `${SNAPSHOT}:`,
      "  edited",
      "  and renumbered",
    ]);
  });
});
