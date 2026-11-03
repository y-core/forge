import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import { getPlatformProxy } from "wrangler";

import { executeFile } from "../../src/tooling/db/d1";
import { realDbIo } from "../../src/tooling/db/io";
import type { Home } from "../../src/tooling/db/types";

const FORGE = fileURLToPath(new URL("../..", import.meta.url));
const BIN = join(FORGE, "src", "tooling", "root", "bin.ts");
const DATABASE = "db-backup-fixture";

const SEED = [
  "CREATE TABLE _forge_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
  "INSERT INTO _forge_migrations (name) VALUES ('0001_notes.sql')",
  "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)",
  "CREATE UNIQUE INDEX notes_body ON notes (body)",
  "INSERT INTO notes (body) VALUES ('one'), ('two' || char(10) || 'lines'), ('three'), ('four\\nliteral')",
  "ANALYZE",
];

interface Bindings {
  DB: D1Database;
  STANDBY: D1Database;
}

let root: string;
let report: { name: string; key: string; mismatches: string[] };

function forgeDb(args: string[]): { code: number; stdout: string; stderr: string } {
  const run = spawnSync("bun", ["run", BIN, "db", ...args, "--db", "DB", "--target", "local", "--root", root], { cwd: FORGE, encoding: "utf-8" });
  return { code: run.status ?? 1, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

async function withBindings<T>(use: (env: Bindings) => Promise<T>): Promise<T> {
  const proxy = await getPlatformProxy<Bindings>({
    configPath: join(root, "wrangler.jsonc"),
    persist: { path: join(root, ".wrangler", "state", "v3") },
    remoteBindings: false,
    envFiles: [],
  });
  try {
    return await use(proxy.env);
  } finally {
    await proxy.dispose();
  }
}

async function rowsOf<T>(db: D1Database, sql: string): Promise<T[]> {
  return (await db.prepare(sql).all<T>()).results;
}

test.describe.configure({ timeout: 240_000 });

test.beforeAll(async () => {
  test.setTimeout(240_000);
  root = mkdtempSync(join(tmpdir(), "forge-db-backup-"));
  writeFileSync(
    join(root, "wrangler.jsonc"),
    `${JSON.stringify(
      {
        name: "db-backup",
        compatibility_date: "2026-01-01",
        d1_databases: [
          { binding: "DB", database_name: DATABASE, database_id: "db-backup-local", migrations_dir: "config/db/migrations" },
          { binding: "STANDBY", database_name: "db-backup-standby", database_id: "db-backup-standby" },
        ],
        r2_buckets: [{ binding: "BACKUPS", bucket_name: "db-backup-fixture" }],
      },
      null,
      2,
    )}\n`,
  );
  await withBindings(async (env) => {
    await env.DB.batch(SEED.map((sql) => env.DB.prepare(sql)));
  });
});

test.afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

test.describe("forge db backup, then restore --into standby, against real local D1 and R2", () => {
  test.beforeAll(() => {
    const backup = forgeDb(["backup", "--json"]);
    expect(backup.code, `backup failed\n${backup.stdout}\n${backup.stderr}`).toBe(0);
    const { key } = JSON.parse(backup.stdout) as { key: string };
    const restore = forgeDb(["restore", "--from", key, "--into", "standby:STANDBY", "--json"]);
    expect(restore.code, `restore failed\n${restore.stdout}\n${restore.stderr}`).toBe(0);
    report = JSON.parse(restore.stdout) as typeof report;
  });

  test("reports the standby restored from the dump it was given with no mismatch against the dump's sidecar", () => {
    expect([report.name, report.key.startsWith("d1-backups/db-backup-local/"), report.mismatches]).toEqual(["STANDBY", true, []]);
  });

  test("leaves the standby holding every row the source holds, a real newline and a literal backslash-n each intact", async () => {
    const select = "SELECT id, body FROM notes ORDER BY id";
    const [source, standby] = await withBindings(async (env) => [await rowsOf(env.DB, select), await rowsOf(env.STANDBY, select)]);

    expect(standby).toEqual([
      { id: 1, body: "one" },
      { id: 2, body: "two\nlines" },
      { id: 3, body: "three" },
      { id: 4, body: "four\\nliteral" },
    ]);
    expect(standby).toEqual(source);
  });

  test("carries ANALYZE's statistics into the standby", async () => {
    const select = "SELECT tbl, idx, stat FROM sqlite_stat1 WHERE tbl NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY tbl, idx";
    const [source, standby] = await withBindings(async (env) => [await rowsOf(env.DB, select), await rowsOf(env.STANDBY, select)]);

    expect(standby).toEqual([
      { tbl: "_forge_migrations", idx: null, stat: "1" },
      { tbl: "notes", idx: "notes_body", stat: "4 1" },
    ]);
    expect(standby).toEqual(source);
  });
});

test.describe("executeFile() against real local D1", () => {
  test("leaves no row from a local file's first statement when its second fails", async () => {
    const file = join(root, "partial.sql");
    writeFileSync(file, "INSERT INTO notes (id, body) VALUES (5, 'five');\nINSERT INTO missing (id) VALUES (1);\n");
    const home: Home = {
      label: "local",
      database: DATABASE,
      binding: "DB",
      dir: root,
      configPath: join(root, "wrangler.jsonc"),
      persistTo: join(root, ".wrangler", "state"),
      place: "local",
      env: null,
      synthesized: false,
    };
    const io = realDbIo();
    try {
      await expect(executeFile(io, home, file)).rejects.toThrow(`loading ${file} against local (${DATABASE}) failed:`);
    } finally {
      await io.closeD1(null);
    }

    expect(await withBindings((env) => rowsOf(env.DB, "SELECT id FROM notes WHERE id = 5"))).toEqual([]);
  });
});
