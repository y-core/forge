import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { type DevServer, startDevServer } from "@y-core/forge/testing/workerd";

const FORGE = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURE = join(FORGE, "tests", "fixtures", "db-migrate");
const CONFIG = join(FIXTURE, "wrangler.jsonc");
const BIN = join(FORGE, "src", "tooling", "root", "bin.ts");
const MIGRATIONS = join(FIXTURE, "migrations");

function forgeDb(args: string[]): { code: number; stdout: string; stderr: string } {
  const run = spawnSync("bun", ["run", BIN, "db", ...args, "--root", FIXTURE], { cwd: FORGE, encoding: "utf-8" });
  return { code: run.status ?? 1, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

let server: DevServer;

beforeAll(async () => {
  rmSync(join(FIXTURE, ".wrangler"), { recursive: true, force: true });
  rmSync(join(FIXTURE, ".forge"), { recursive: true, force: true });
  rmSync(MIGRATIONS, { recursive: true, force: true });
  rmSync(join(FIXTURE, "schema.snapshot.json"), { force: true });
  const compose = forgeDb(["migrate", "compose", "init"]);
  expect(`${compose.stdout}\n${compose.stderr}`.includes("create table auth_users")).toBe(true);
  expect(compose.code).toBe(0);
  const migrate = forgeDb(["migrate", "--target", "local", "--yes"]);
  expect(`${migrate.stdout}\n${migrate.stderr}`.includes("0001_init")).toBe(true);
  expect(migrate.code).toBe(0);
  server = await startDevServer({ config: CONFIG, readyPath: "/tables" });
}, 240_000);

afterAll(() => {
  server?.stop();
  rmSync(MIGRATIONS, { recursive: true, force: true });
  rmSync(join(FIXTURE, "schema.snapshot.json"), { force: true });
});

function get<T>(path: string): Promise<T> {
  return fetch(`${server.origin}${path}`).then((res) => res.json() as Promise<T>);
}

describe("forge db migrate --target local against real D1", () => {
  it("creates the auth tables and both companion tables", async () => {
    const tables = await get<string[]>("/tables");
    for (const name of ["auth_users", "auth_credentials", "forge_migrations", "forge_schema_meta", "d1_migrations"]) {
      expect(tables.includes(name)).toBe(true);
    }
  });

  it("records the applied migration under its checksum, and the digest and fingerprint beside it", async () => {
    const migrations = await get<{ applied_name: string; sha256: string }[]>("/migrations");
    expect(migrations.map((m) => m.applied_name)).toEqual(["0001_init"]);
    expect(migrations[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    const meta = await get<Record<string, string>>("/meta");
    expect(Object.keys(meta).sort()).toEqual(["migrations_digest", "schema_fingerprint"]);
  });

  it("is a no-op the second time, and status --check exits 0", () => {
    const again = forgeDb(["migrate", "--target", "local", "--yes"]);
    expect(again.code).toBe(0);
    const status = forgeDb(["migrate", "status", "--check", "--target", "local"]);
    expect(status.stderr).toBe("");
    expect(status.code).toBe(0);
  }, 60_000);

  it("keeps status --check green across a stamp edit and a restamp, since the stamp is not part of the checksum", () => {
    const file = join(MIGRATIONS, "0001_init.sql");
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
  }, 60_000);

  it("makes status --check exit 1 when an applied migration's file has been edited", () => {
    const tampered = mkdtempSync(join(tmpdir(), "forge-db-tampered-"));
    cpSync(FIXTURE, tampered, { recursive: true });
    const file = join(tampered, "migrations", "0001_init.sql");
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
  }, 60_000);

  it("makes migrate refuse the edited history, naming the file and the repair", () => {
    const tampered = mkdtempSync(join(tmpdir(), "forge-db-tampered-"));
    cpSync(FIXTURE, tampered, { recursive: true });
    const file = join(tampered, "migrations", "0001_init.sql");
    writeFileSync(file, `${readFileSync(file, "utf-8")}\n-- edited after apply\n`);
    try {
      const migrate = spawnSync("bun", ["run", BIN, "db", "migrate", "--target", "local", "--yes", "--root", tampered], {
        cwd: FORGE,
        encoding: "utf-8",
      });
      expect(migrate.status).toBe(1);
      expect(
        migrate.stderr.includes(
          "has applied migrations whose files were edited after they were applied:\n  0001_init\nRestore each file from version control to the bytes forge_migrations recorded, or reset the database; forge will not apply over an edited history.",
        ),
      ).toBe(true);
    } finally {
      rmSync(tampered, { recursive: true, force: true });
    }
  }, 60_000);

  it("finds the composed migration to be exactly what every declared schema builds", () => {
    const compose = forgeDb(["migrate", "compose", "--dry-run"]);
    expect(compose.stderr).toBe("");
    expect(compose.code).toBe(0);
    expect(compose.stdout.trim()).toBe(`no changes — ${MIGRATIONS} already produces every declared schema`);
    const check = forgeDb(["schema", "check", "--replay"]);
    expect(check.code).toBe(0);
  }, 240_000);

  it("reports match through the Worker's schema health read", async () => {
    const health = await get<{ state: string; recorded: string | null; actual: string | null }>("/schema-health");
    expect(health.state).toBe("match");
    expect(health.actual).toMatch(/^[0-9a-f]{64}$/);
    expect(health.actual).toBe(health.recorded);
    expect(Object.keys(health).sort()).toEqual(["actual", "recorded", "state"]);
  });

  it("refuses a migration that only fails on data, on a copy restored from a backup, leaving the target alone", () => {
    const execute = (command: string) =>
      spawnSync(
        "bunx",
        [
          "wrangler",
          "d1",
          "execute",
          "db-migrate-fixture",
          "--local",
          "--persist-to",
          join(FIXTURE, ".wrangler", "state"),
          "--yes",
          "--command",
          command,
        ],
        { cwd: FIXTURE, encoding: "utf-8" },
      );
    const user = (id: string, key: string) =>
      `INSERT INTO auth_users (id, email, email_key, is_admin, created_at, updated_at) VALUES (X'${id}', 'ada@example.com', '${key}', 0, 1, 1)`;
    expect(execute(user("01010101010101010101010101010101", "one@example.com")).status).toBe(0);
    expect(execute(user("02020202020202020202020202020202", "two@example.com")).status).toBe(0);

    const backup = forgeDb(["backup", "--target", "local", "--yes"]);
    expect(backup.code).toBe(0);

    const rehearsed = mkdtempSync(join(tmpdir(), "forge-db-rehearse-"));
    cpSync(FIXTURE, rehearsed, { recursive: true });
    writeFileSync(join(rehearsed, "migrations", "0002_email_unique.sql"), "CREATE UNIQUE INDEX auth_users_email ON auth_users (email);\n");
    try {
      const migrate = spawnSync("bun", ["run", BIN, "db", "migrate", "--target", "local", "--yes", "--rehearse", "--root", rehearsed], {
        cwd: FORGE,
        encoding: "utf-8",
      });
      expect(migrate.status).toBe(1);
      expect(migrate.stderr.includes("the rehearsal failed on 0002_email_unique")).toBe(true);

      const indexes = spawnSync(
        "bunx",
        [
          "wrangler",
          "d1",
          "execute",
          "db-migrate-fixture",
          "--local",
          "--persist-to",
          join(rehearsed, ".wrangler", "state"),
          "--json",
          "--command",
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'auth_users_email'",
        ],
        { cwd: rehearsed, encoding: "utf-8" },
      );
      expect(indexes.stdout.includes("auth_users_email")).toBe(false);
    } finally {
      rmSync(rehearsed, { recursive: true, force: true });
    }
  }, 240_000);

  it("reports mismatch once DDL is run by hand", async () => {
    const args = ["wrangler", "d1", "execute", "db-migrate-fixture", "--local", "--persist-to", join(FIXTURE, ".wrangler", "state"), "--yes"];
    const stray = spawnSync("bunx", [...args, "--command", "CREATE TABLE stray (id INTEGER)"], { cwd: FIXTURE, encoding: "utf-8" });
    expect(stray.status).toBe(0);
    const health = await get<{ state: string }>("/schema-health");
    expect(health.state).toBe("mismatch");
  }, 60_000);
});
