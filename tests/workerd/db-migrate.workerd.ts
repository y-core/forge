import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { checkSchemaHealth } from "../../src/storage/db/health";
import { formatComposeHeader } from "../../src/tooling/db/schema/header";
import { type D1Handle, openD1 } from "./d1";
import { wrangler } from "./wrangler";

const FORGE = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURE = join(FORGE, "tests", "fixtures", "db-migrate");
const BIN = join(FORGE, "src", "tooling", "root", "bin.ts");

let root: string;
let migrations: string;

function forgeDb(args: string[]): { code: number; stdout: string; stderr: string } {
  const run = spawnSync("bun", ["run", BIN, "db", ...args, "--root", root], { cwd: FORGE, encoding: "utf-8" });
  return { code: run.status ?? 1, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

// Closed before any `forge db` or `wrangler` call starts: two workerd processes on one database file can
// meet SQLITE_BUSY, and copying a file a live handle holds open can copy it torn.
async function withD1<T>(use: (db: D1Handle) => Promise<T>): Promise<T> {
  const db = await openD1(root);
  try {
    return await use(db);
  } finally {
    await db.dispose();
  }
}

test.describe.configure({ timeout: 240_000 });

test.beforeAll(async () => {
  test.setTimeout(240_000);
  root = mkdtempSync(join(tmpdir(), "forge-db-migrate-"));
  migrations = join(root, "config", "db", "migrations");
  cpSync(join(FIXTURE, "wrangler.jsonc"), join(root, "wrangler.jsonc"));
  mkdirSync(join(root, "config"));
  writeFileSync(join(root, "config", "db.ts"), `export default { schemas: ${JSON.stringify([join(FORGE, "src", "auth", "schema.sql")])} };\n`);
  // Exit status first: it carries the command's own error, where the output assertion reports only
  // that a string is absent and throws the diagnostic away.
  const compose = forgeDb(["migrate", "compose", "init"]);
  expect(compose.code, `compose init failed\n${compose.stdout}\n${compose.stderr}`).toBe(0);
  expect(`${compose.stdout}\n${compose.stderr}`.includes("create table auth_users")).toBe(true);
  const migrate = forgeDb(["migrate", "--target", "local", "--yes"]);
  expect(migrate.code, `migrate failed\n${migrate.stdout}\n${migrate.stderr}`).toBe(0);
  expect(`${migrate.stdout}\n${migrate.stderr}`.includes("0001_init")).toBe(true);
});

test.afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

test.describe("forge db migrate --target local against real D1", () => {
  test("creates the auth tables and both companion tables, and neither the wrangler history table nor the deleted meta table", async () => {
    const tables = await withD1(async (db) =>
      (await db.rows<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map((row) => row.name),
    );
    for (const name of ["auth_users", "auth_credentials", "_forge_migrations", "_forge_seed_history"]) {
      expect(tables.includes(name)).toBe(true);
    }
    for (const name of ["d1_migrations", "forge_migrations", "forge_schema_meta"]) {
      expect(tables.includes(name)).toBe(false);
    }
  });

  test("records the applied migration under its checksum, with the fingerprint it certified on the same row", async () => {
    const migrations = await withD1((db) =>
      db.rows<{ name: string; sha256: string; applied_at: number; fingerprint: string | null }>(
        "SELECT name, sha256, applied_at, fingerprint FROM _forge_migrations ORDER BY id",
      ),
    );
    expect(migrations.map((m) => m.name)).toEqual(["0001_init"]);
    expect(migrations[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(migrations[0]?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(Number.isInteger(migrations[0]?.applied_at)).toBe(true);
  });

  test("is a no-op the second time, and status --check exits 0", () => {
    const again = forgeDb(["migrate", "--target", "local", "--yes"]);
    expect(again.code).toBe(0);
    const status = forgeDb(["migrate", "status", "--check", "--target", "local"]);
    expect(status.stderr).toBe("");
    expect(status.code).toBe(0);
  });

  test("lets migrate through a stamp edit and a restamp, since a migration's sha256 is over stamp-blanked bytes", () => {
    const file = join(migrations, "0001_init.sql");
    const composed = readFileSync(file, "utf-8");
    writeFileSync(
      file,
      composed.replace(/"baseline":"[0-9a-f]*"/, '"baseline":"0000000000000000000000000000000000000000000000000000000000000000"'),
    );
    expect(readFileSync(file, "utf-8")).not.toBe(composed);
    const edited = forgeDb(["migrate", "status", "--check", "--target", "local"]);
    expect(edited.stderr).toBe("");
    expect(edited.code).toBe(0);

    const restamp = forgeDb(["migrate", "compose", "--restamp", "0001_init"]);
    expect(restamp.stderr).toBe("");
    expect(restamp.code).toBe(0);
    expect(readFileSync(file, "utf-8")).toBe(composed);
    const status = forgeDb(["migrate", "status", "--check", "--target", "local"]);
    expect(status.stderr).toBe("");
    expect(status.code).toBe(0);
    expect(status.stdout.includes("mismatch")).toBe(false);

    const migrate = forgeDb(["migrate", "--target", "local", "--yes"]);
    expect(migrate.stderr.includes("edited after they were applied")).toBe(false);
    expect(migrate.code).toBe(0);
  });

  test("makes status --check exit 1 when an applied migration's file has been edited", () => {
    const tampered = mkdtempSync(join(tmpdir(), "forge-db-tampered-"));
    cpSync(root, tampered, { recursive: true });
    const file = join(tampered, "config", "db", "migrations", "0001_init.sql");
    writeFileSync(file, `${readFileSync(file, "utf-8")}\n-- edited after apply\n`);
    try {
      const status = spawnSync("bun", ["run", BIN, "db", "migrate", "status", "--check", "--target", "local", "--root", tampered], {
        cwd: FORGE,
        encoding: "utf-8",
      });
      expect(status.status).toBe(1);
      expect(`${status.stdout}\n${status.stderr}`.includes("0001_init")).toBe(true);
    } finally {
      rmSync(tampered, { recursive: true, force: true });
    }
  });

  test("makes migrate refuse the edited history, naming the file and the repair", () => {
    const tampered = mkdtempSync(join(tmpdir(), "forge-db-tampered-"));
    cpSync(root, tampered, { recursive: true });
    const file = join(tampered, "config", "db", "migrations", "0001_init.sql");
    writeFileSync(file, `${readFileSync(file, "utf-8")}\n-- edited after apply\n`);
    try {
      const migrate = spawnSync("bun", ["run", BIN, "db", "migrate", "--target", "local", "--yes", "--root", tampered], {
        cwd: FORGE,
        encoding: "utf-8",
      });
      expect(migrate.status).toBe(1);
      expect(
        migrate.stderr.includes(
          "has applied migrations whose files were edited after they were applied:\n  0001_init\nRestore each file from version control to the bytes _forge_migrations recorded, or reset the database; forge will not apply over an edited history.",
        ),
      ).toBe(true);
    } finally {
      rmSync(tampered, { recursive: true, force: true });
    }
  });

  test("finds the composed migration to be exactly what every declared schema builds", () => {
    const compose = forgeDb(["migrate", "compose", "--dry-run"]);
    expect(compose.stderr).toBe("");
    expect(compose.code).toBe(0);
    expect(compose.stdout.trim()).toBe(`no changes — ${migrations} already produces every declared schema`);
    const check = forgeDb(["schema", "check", "--replay"]);
    expect(check.code).toBe(0);
  });

  test("reports match through the schema health read", async () => {
    const health = await withD1((db) => checkSchemaHealth(db.binding));
    expect(health.state).toBe("match");
    expect(health.actual).toMatch(/^[0-9a-f]{64}$/);
    expect(health.actual).toBe(health.recorded);
    expect(Object.keys(health).sort()).toEqual(["actual", "recorded", "state"]);
  });

  test("refuses a migration that only fails on data, on a copy restored from a backup, leaving the target alone", async () => {
    const user = (id: string, key: string) =>
      `INSERT INTO auth_users (id, email, email_key, is_admin, created_at, updated_at) VALUES (X'${id}', 'ada@example.com', '${key}', 0, 1, 1)`;
    await withD1(async (db) => {
      await db.exec(user("01010101010101010101010101010101", "one@example.com"));
      await db.exec(user("02020202020202020202020202020202", "two@example.com"));
    });

    const backup = forgeDb(["backup", "--target", "local", "--yes"]);
    expect(backup.code, `backup failed\n${backup.stdout}\n${backup.stderr}`).toBe(0);

    const rehearsed = mkdtempSync(join(tmpdir(), "forge-db-rehearse-"));
    cpSync(root, rehearsed, { recursive: true });
    const body = "CREATE UNIQUE INDEX auth_users_email ON auth_users (email);\n";
    writeFileSync(
      join(rehearsed, "config", "db", "migrations", "0002_email_unique.sql"),
      `${formatComposeHeader({ desired: {}, baseline: "", forge: "0.0.0" }, body)}${body}`,
    );
    let copy: D1Handle | null = null;
    try {
      const migrate = spawnSync("bun", ["run", BIN, "db", "migrate", "--target", "local", "--yes", "--rehearse", "--root", rehearsed], {
        cwd: FORGE,
        encoding: "utf-8",
      });
      expect(migrate.status).toBe(1);
      expect(migrate.stderr.includes("the rehearsal failed on 0002_email_unique")).toBe(true);

      copy = await openD1(rehearsed);
      const indexes = await copy.rows<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'auth_users_email'");
      expect(indexes.length).toBe(0);
    } finally {
      await copy?.dispose();
      rmSync(rehearsed, { recursive: true, force: true });
    }
  });

  test("backs up through wrangler d1 export, and restores the artifact through forge db restore", async () => {
    const backup = forgeDb(["backup", "--target", "local", "--via", "export", "--yes", "--json", "--out", join(root, "exports")]);
    expect(backup.code, `export backup failed\n${backup.stdout}\n${backup.stderr}`).toBe(0);
    const { directory, manifest } = JSON.parse(backup.stdout.trim().split("\n").at(-1) ?? "{}") as {
      directory: string;
      manifest: { via: string; bookmark: string | null; tables: { name: string; rows: number }[]; verified: { divergent: number }[] };
    };
    expect([manifest.via, manifest.bookmark, manifest.verified.map((route) => route.divergent)]).toEqual(["export", null, [0, 0]]);
    expect(manifest.tables.find((table) => table.name === "auth_users")?.rows).toBe(2);

    const restore = forgeDb(["restore", "--target", "standby", "--artifact", directory, "--route", "full", "--yes"]);
    expect(restore.code, `restore failed\n${restore.stdout}\n${restore.stderr}`).toBe(0);
    expect(restore.stdout).toContain("✓ auth_users — 2 rows");
  });

  test("refuses --via export, naming each column, for every value wrangler's dumper would not reproduce", async () => {
    await withD1((db) =>
      db.exec(
        "CREATE TABLE probe_hazard (id INTEGER PRIMARY KEY, crlf, lflf, plain, num);" +
          "INSERT INTO probe_hazard VALUES (1, 'a\\ry' || char(13), 'a\\ny' || char(10), 'a\\ny', 1.0);",
      ),
    );
    try {
      const backup = forgeDb(["backup", "--target", "local", "--via", "export", "--yes", "--out", join(root, "refused")]);
      expect(backup.code).toBe(1);
      const named = ["crlf", "lflf", "plain", "num"].filter((column) => backup.stderr.includes(`probe_hazard.${column}:`));
      expect(named).toEqual(["crlf", "lflf", "num"]);
    } finally {
      await withD1((db) => db.exec("DROP TABLE probe_hazard"));
    }
  });

  test("exports a backslash-n with no real newline byte for byte, past the sqlite_stat1 rows ANALYZE leaves", async () => {
    const row = "X'04040404040404040404040404040404'";
    await withD1((db) =>
      db.exec(
        `INSERT INTO auth_users (id, email, email_key, is_admin, created_at, updated_at) VALUES (${row}, 'a\\ny@example.com', 'k4', 0, 1, 1);ANALYZE;`,
      ),
    );
    const standby = join(root, ".forge", "standby", "probe");
    let copy: D1Handle | null = null;
    try {
      const stats = await withD1((db) => db.rows<{ n: number }>("SELECT count(*) AS n FROM sqlite_stat1"));
      expect(stats[0]?.n).toBeGreaterThan(0);

      const backup = forgeDb(["backup", "--target", "local", "--via", "export", "--yes", "--json", "--out", join(root, "plain")]);
      expect(backup.code, `export backup failed\n${backup.stdout}\n${backup.stderr}`).toBe(0);
      const { directory } = JSON.parse(backup.stdout.trim().split("\n").at(-1) ?? "{}") as { directory: string };
      const restore = forgeDb(["restore", "--target", "standby:probe", "--artifact", directory, "--route", "full", "--yes"]);
      expect(restore.code, `restore failed\n${restore.stdout}\n${restore.stderr}`).toBe(0);

      const read = `SELECT hex(email) AS email, typeof(email) AS kind FROM auth_users WHERE id = ${row}`;
      const source = await withD1((db) => db.rows(read));
      copy = await openD1(standby, join(standby, ".wrangler", "state", "v3"));
      expect(await copy.rows(read)).toEqual(source);
      expect(source).toEqual([{ email: "615C6E79406578616D706C652E636F6D", kind: "text" }]);
    } finally {
      await copy?.dispose();
      await withD1((db) => db.exec(`DELETE FROM auth_users WHERE id = ${row}`));
    }
  });

  test("reports mismatch once DDL is run by hand", async () => {
    const args = ["d1", "execute", "db-migrate-fixture", "--local", "--persist-to", join(root, ".wrangler", "state"), "--yes"];
    const stray = await wrangler([...args, "--command", "CREATE TABLE stray (id INTEGER)"], root);
    expect(stray.code).toBe(0);
    await withD1(async (db) => {
      expect((await checkSchemaHealth(db.binding)).state).toBe("mismatch");
      // The CLI and the handle are one database, and the handle reads the table the CLI wrote — which
      // cannot hold if the handle's persist path has lost the `v3` segment wrangler wrote under.
      expect((await db.rows("SELECT name FROM sqlite_master WHERE name = 'stray'")).length).toBe(1);
    });
  });

  test("reads nothing through a handle pointed at the `--persist-to` parent of the state wrangler wrote", async () => {
    const parent = await openD1(root, join(root, ".wrangler", "state"));
    try {
      await expect(parent.rows("SELECT name FROM _forge_migrations")).rejects.toThrow(/no such table/i);
    } finally {
      await parent.dispose();
    }
  });

  test("lets D1's authorizer describe a table named with a leading underscore", async () => {
    await withD1(async (db) => {
      await db.exec(
        "CREATE TABLE IF NOT EXISTS _forge_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, sha256 TEXT NOT NULL, applied_at INTEGER NOT NULL, fingerprint TEXT) STRICT;",
      );

      const columns = await db.rows<{ name: string }>("SELECT name FROM pragma_table_info('_forge_migrations') ORDER BY cid");
      expect(columns.map((column) => column.name)).toEqual(["id", "name", "sha256", "applied_at", "fingerprint"]);

      const rows = await db.rows<{ tbl: string }>(
        "SELECT m.name AS tbl, x.name FROM sqlite_master m JOIN pragma_table_xinfo(m.name) x WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND m.name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY m.name, x.cid",
      );
      expect(rows.some((row) => row.tbl === "_forge_migrations")).toBe(true);
    });
  });

  test("filters _forge_migrations out of the model read and leaves a decoy named xforge_decoy in it", async () => {
    await withD1(async (db) => {
      await db.exec("CREATE TABLE IF NOT EXISTS xforge_decoy (id INTEGER PRIMARY KEY) STRICT;");

      const tables = await db.rows<{ tbl: string }>(
        "SELECT m.name AS tbl FROM sqlite_master m JOIN pragma_table_xinfo(m.name) x WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND m.name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND m.name NOT LIKE '\\_forge\\_%' ESCAPE '\\' ORDER BY m.name, x.cid",
      );
      expect(tables.some((row) => row.tbl === "_forge_migrations")).toBe(false);
      expect(tables.some((row) => row.tbl === "xforge_decoy")).toBe(true);
    });
  });
});
