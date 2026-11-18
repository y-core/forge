import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execute } from "../../cli/execute";
import { createDbCommands } from "../commands";
import { bufferedIO, fakeDbIo, minimalWranglerConfig, schemaModelRows } from "../db.fixture";
import { sha256 } from "../digest";
import { migrationsDigest } from "../migrate/files";
import type { DbHostConfig, FakeDbIo } from "../types";
import { buildSchemaSnapshot, formatSchemaSnapshot } from "./snapshot";

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const NOW = new Date("2026-09-11T10:00:00Z");

const USERS_DDL = "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL) STRICT";
const APP_MIGRATION = `${USERS_DDL};\n`;
const LIB_SCHEMA_TEXT = "CREATE TABLE acme_things (id INTEGER PRIMARY KEY) STRICT;\n";
const SCHEMA_TEXT = `${USERS_DDL};\n`;

/** A temp root with a real `wrangler.jsonc`, since the config is read from the filesystem either way. */
function appRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-db-schema-"));
  roots.push(root);
  const config = minimalWranglerConfig(root);
  writeFileSync(config.path, config.text, "utf-8");
  return root;
}

interface Paths {
  readonly root: string;
  readonly schema: string;
  readonly snapshot: string;
  readonly libSchema: string;
}

function paths(root: string): Paths {
  const lib = join(root, "node_modules", "acme-lib");
  return {
    root,
    schema: join(root, "schema.sql"),
    snapshot: join(root, "config", "db", "schema.snapshot.json"),
    libSchema: join(lib, "schema.sql"),
  };
}

/** An app that declares a library's schema and its own, with one composed migration on disk. */
function twoSchemaFiles(root: string): Record<string, string> {
  return {
    [join(root, "node_modules", "acme-lib", "schema.sql")]: LIB_SCHEMA_TEXT,
    [join(root, "config", "db", "migrations", "0001_init.sql")]: APP_MIGRATION,
  };
}

const LIB_DECLARED = join("node_modules", "acme-lib", "schema.sql");
const HOST: DbHostConfig = { schemas: [LIB_DECLARED, "schema.sql"] };

function snapshotFile(desiredText: string, migrations: readonly { name: string; sql: string }[]): string {
  return formatSchemaSnapshot(
    buildSchemaSnapshot({
      desired: { [LIB_DECLARED]: sha256(LIB_SCHEMA_TEXT), "schema.sql": sha256(desiredText) },
      declared: {},
      migrationsDigest: migrationsDigest(migrations.map((m) => ({ name: m.name, sha256: sha256(m.sql) }))),
    }),
  );
}

async function drive(io: FakeDbIo, argv: string[], host: DbHostConfig = HOST): Promise<{ out: string[]; err: string[]; code: number | null }> {
  const buffer = bufferedIO();
  try {
    await execute(createDbCommands({ io, host }), argv, buffer);
  } catch {
    // `bufferedIO().exit` throws so an in-process run stops where the real CLI would.
  }
  return { out: [...buffer.out], err: [...buffer.err], code: buffer.code };
}

describe("forge db schema", () => {
  it("mounts check under schema, which the bare verb runs too", () => {
    const schema = createDbCommands().commands.find((c) => c.name === "schema");
    expect(schema?.commands.map((c) => c.name)).toEqual(["check"]);
  });

  it("exits 0 under --check when every declared schema is in step with the snapshot", async () => {
    const p = paths(appRoot());
    const io = fakeDbIo(
      { ...twoSchemaFiles(p.root), [p.schema]: SCHEMA_TEXT, [p.snapshot]: snapshotFile(SCHEMA_TEXT, [{ name: "0001_init", sql: APP_MIGRATION }]) },
      { now: NOW },
    );

    const result = await drive(io, ["schema", "check", "--root", p.root]);

    expect(result.out).toEqual([`${LIB_DECLARED}, schema.sql match ${p.snapshot}`]);
    expect(result.err).toEqual([]);
    expect(result.code).toBe(null);
  });

  it("exits 1 under --check when a declared schema was edited after the last compose", async () => {
    const p = paths(appRoot());
    const io = fakeDbIo(
      {
        ...twoSchemaFiles(p.root),
        [p.schema]: `${SCHEMA_TEXT}\nCREATE TABLE notes (id INTEGER PRIMARY KEY) STRICT;\n`,
        [p.snapshot]: snapshotFile(SCHEMA_TEXT, [{ name: "0001_init", sql: APP_MIGRATION }]),
      },
      { now: NOW },
    );

    const result = await drive(io, ["schema", "check", "--root", p.root]);

    expect(result.out).toEqual([`${p.snapshot}:`, "  schema.sql moved since the last compose"]);
    expect(result.err).toEqual(["Error: the declared schemas, the snapshot and the migrations are not in step — see above."]);
    expect(result.code).toBe(1);
  });

  it("prints the report as one JSON document under --check --json", async () => {
    const p = paths(appRoot());
    const io = fakeDbIo(
      { ...twoSchemaFiles(p.root), [p.schema]: SCHEMA_TEXT, [p.snapshot]: snapshotFile(SCHEMA_TEXT, [{ name: "0001_init", sql: APP_MIGRATION }]) },
      { now: NOW },
    );

    const result = await drive(io, ["schema", "check", "--root", p.root, "--json"]);

    expect(result.out.length).toBe(1);
    expect(JSON.parse(result.out[0] ?? "")).toEqual({ snapshotPath: p.snapshot, schemas: [LIB_DECLARED, "schema.sql"], problems: [] });
    expect(result.code).toBe(null);
  });
});

describe("forge db types", () => {
  const HOST_APP: DbHostConfig = { schemas: ["schema.sql"] };
  const USERS_ROWS = {
    inventory: [{ type: "table", name: "users", tbl_name: "users", sql: USERS_DDL }],
    columns: [
      { tbl: "users", cid: 0, name: "id", type: "INTEGER", notnull: 0, dflt_value: null, pk: 1, hidden: 0 },
      { tbl: "users", cid: 1, name: "email", type: "TEXT", notnull: 1, dflt_value: null, pk: 0, hidden: 0 },
    ],
  };
  const USERS_TEXT = [
    "/** GENERATED by `forge db types` from the declared schemas — do not edit; run `forge db types` again. */",
    "",
    "export interface UsersRow {",
    "  id: number;",
    "  email: string;",
    "}",
    "",
    "export interface Tables {",
    "  users: UsersRow;",
    "}",
    "",
  ].join("\n");

  function typesIo(root: string, files: Record<string, string> = {}): FakeDbIo {
    const io = fakeDbIo({ [join(root, "schema.sql")]: SCHEMA_TEXT, ...files }, { now: NOW });
    io.d1Rules.unshift({
      match: (_statement, home) => home.label === "scratch:compose-desired",
      reply: (statement) => schemaModelRows(statement, USERS_ROWS),
    });
    return io;
  }

  const typesPath = (root: string): string => join(root, "config", "db", "tables.ts");

  it("is a forge db verb", () => {
    expect(createDbCommands().commands.map((c) => c.name)).toContain("types");
  });

  it("writes the row types and says where", async () => {
    const root = appRoot();
    const io = typesIo(root);

    const result = await drive(io, ["types", "--root", root], HOST_APP);

    expect(result.out).toEqual([`wrote ${typesPath(root)}`]);
    expect(io.files.get(typesPath(root))).toBe(USERS_TEXT);
    expect(result.code).toBe(null);
  });

  it("exits 1 under --check when the file is not what the declared schemas generate", async () => {
    const root = appRoot();
    const io = typesIo(root, { [typesPath(root)]: `${USERS_TEXT}\n` });

    const result = await drive(io, ["types", "--check", "--root", root], HOST_APP);

    expect(result.out).toEqual([`${typesPath(root)} is not what schema.sql generate — run \`forge db types\``]);
    expect(result.err).toEqual(["Error: the row types are not what the declared schemas generate — see above."]);
    expect(result.code).toBe(1);
  });

  it("exits 1 under --check when the file is absent", async () => {
    const root = appRoot();

    const result = await drive(typesIo(root), ["types", "--check", "--root", root], HOST_APP);

    expect(result.out).toEqual([`${typesPath(root)} does not exist — run \`forge db types\` to write it`]);
    expect(result.code).toBe(1);
  });

  it("exits 0 under --check when the file is current", async () => {
    const root = appRoot();

    const result = await drive(typesIo(root, { [typesPath(root)]: USERS_TEXT }), ["types", "--check", "--root", root], HOST_APP);

    expect(result.out).toEqual([`${typesPath(root)} matches schema.sql`]);
    expect(result.code).toBe(null);
  });

  it("exits 0 under --check when config/db.config.ts names no schemas", async () => {
    const root = appRoot();

    const result = await drive(fakeDbIo({}, { now: NOW }), ["types", "--check", "--root", root], {});

    expect(result.out).toEqual(["config/db.config.ts names no `schemas` — no row types to generate"]);
    expect(result.code).toBe(null);
  });

  it("prints the report as one JSON document under --check --json", async () => {
    const root = appRoot();

    const result = await drive(typesIo(root, { [typesPath(root)]: USERS_TEXT }), ["types", "--check", "--json", "--root", root], HOST_APP);

    expect(result.out.length).toBe(1);
    expect(JSON.parse(result.out[0] ?? "")).toEqual({ path: typesPath(root), schemas: ["schema.sql"], state: "current" });
    expect(result.code).toBe(null);
  });
});
