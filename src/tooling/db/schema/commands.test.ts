import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execute } from "../../cli/execute";
import { createDbCommands } from "../commands";
import { sha256 } from "../digest";
import { migrationsDigest } from "../migrate/files";
import { bufferedIO, fakeDbIo, minimalWranglerConfig } from "../test-support";
import type { DbHostConfig, FakeDbIo } from "../types";
import { buildSchemaSnapshot, formatSchemaSnapshot } from "./snapshot";

const NOW = new Date("2026-09-11T10:00:00Z");

const USERS_DDL = "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL) STRICT";
const APP_MIGRATION = `${USERS_DDL};\n`;
const LIB_SCHEMA_TEXT = "CREATE TABLE acme_things (id INTEGER PRIMARY KEY) STRICT;\n";
const SCHEMA_TEXT = `${USERS_DDL};\n`;

/** A temp root with a real `wrangler.jsonc`, since the config is read from the filesystem either way. */
function appRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-db-schema-"));
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
  return { root, schema: join(root, "schema.sql"), snapshot: join(root, "schema.snapshot.json"), libSchema: join(lib, "schema.sql") };
}

/** An app that declares a library's schema and its own, with one composed migration on disk. */
function twoSchemaFiles(root: string): Record<string, string> {
  return { [join(root, "node_modules", "acme-lib", "schema.sql")]: LIB_SCHEMA_TEXT, [join(root, "migrations", "0001_init.sql")]: APP_MIGRATION };
}

const LIB_DECLARED = join("node_modules", "acme-lib", "schema.sql");
const HOST: DbHostConfig = { schemas: [LIB_DECLARED, "schema.sql"] };

function snapshotFile(desiredText: string, migrations: readonly { name: string; sql: string }[]): string {
  return formatSchemaSnapshot(
    buildSchemaSnapshot({
      desired: { [LIB_DECLARED]: sha256(LIB_SCHEMA_TEXT), "schema.sql": sha256(desiredText) },
      migrationsDigest: migrationsDigest(migrations),
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
