import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { INVENTORY_SELECT } from "../../../storage/db/schema";
import { execute } from "../../cli/execute";
import { createDbCommands } from "../commands";
import { OK, argvHas, bufferedIO, composed, fakeDbIo, jsonRows, minimalWranglerConfig } from "../db.fixture";
import { formatComposeHeader } from "../schema/header";
import type { DbHostConfig, FakeDbIo, Spawned } from "../types";
import { RECORDED_CHECKSUM_SELECT } from "./checksum";
import { migrationChecksum, migrationsDigest } from "./files";
import { schemaFingerprint } from "./fingerprint";

const NOW = new Date("2026-09-11T10:00:00Z");
const INIT = composed("CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT;");
const GENERATED_INIT = `${formatComposeHeader({ desired: {}, baseline: migrationsDigest([]), forge: "test" }, INIT)}${INIT}`;
const INVENTORY = [{ type: "table", name: "users", tbl_name: "users", sql: INIT }];
const FINGERPRINT = schemaFingerprint([{ type: "table", name: "users", tblName: "users", sql: INIT }]);

const NO_TABLE: Spawned = { code: 1, stdout: "", stderr: "no such table: _forge_migrations" };

const isJsonQuery = (a: readonly string[]) => argvHas(a, "execute", "--json", "--command");
const isRecordedSelect = (a: readonly string[]) => isJsonQuery(a) && (a.at(-1) ?? "") === RECORDED_CHECKSUM_SELECT;
const isInventorySelect = (a: readonly string[]) => isJsonQuery(a) && (a.at(-1) ?? "") === INVENTORY_SELECT;

/** A temp root with a real `wrangler.jsonc`, since the config is read from the filesystem either way. */
function appRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-db-migrate-"));
  const config = minimalWranglerConfig(root);
  writeFileSync(config.path, config.text, "utf-8");
  return root;
}

/** A temp root whose config carries a preview id too, so every deployed place resolves. */
function deployableRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-db-migrate-"));
  const config = minimalWranglerConfig(root, {
    d1_databases: [
      {
        binding: "DB",
        database_name: "app-db",
        database_id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a",
        preview_database_id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5b",
      },
    ],
  });
  writeFileSync(config.path, config.text, "utf-8");
  return root;
}

function wire(io: FakeDbIo, over: { recorded?: Spawned } = {}): void {
  io.rules.push(
    { match: isRecordedSelect, reply: over.recorded ?? NO_TABLE },
    { match: isInventorySelect, reply: jsonRows(INVENTORY) },
    { match: (a) => argvHas(a, "execute", "--yes", "--command"), reply: OK },
    { match: (a) => argvHas(a, "execute", "--yes", "--file"), reply: OK },
  );
}

async function drive(
  io: FakeDbIo,
  argv: string[],
  host: DbHostConfig = { schemas: ["schema.sql"], seeds: ["seeds"] },
): Promise<{ out: string[]; err: string[]; code: number | null }> {
  const buffer = bufferedIO();
  try {
    await execute(createDbCommands({ io, host }), argv, buffer);
  } catch {
    // `bufferedIO().exit` throws so an in-process run stops where the real CLI would.
  }
  return { out: [...buffer.out], err: [...buffer.err], code: buffer.code };
}

describe("forge db migrate", () => {
  it("mounts the three verbs under migrate", () => {
    const migrate = createDbCommands().commands.find((c) => c.name === "migrate");
    expect(migrate?.commands.map((c) => c.name)).toEqual(["apply", "compose", "status"]);
  });

  it("applies the pending migrations and names them", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "migrations", "0001_init.sql")]: INIT }, { now: NOW });
    wire(io);

    const result = await drive(io, ["migrate", "apply", "--root", root, "--yes"]);

    expect(result.out).toEqual(["applied 1: 0001_init"]);
    expect(result.code).toBe(null);
  });

  it("applies from the bare verb too, which is `migrate apply` under another name", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "migrations", "0001_init.sql")]: INIT }, { now: NOW });
    wire(io);

    const result = await drive(io, ["migrate", "--root", root, "--yes"]);

    expect(result.out).toEqual(["applied 1: 0001_init"]);
    expect(result.code).toBe(null);
  });

  it("prints one JSON document and nothing else under --json", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "migrations", "0001_init.sql")]: INIT }, { now: NOW });
    wire(io);

    const result = await drive(io, ["migrate", "--root", root, "--yes", "--json"]);

    expect(result.out.length).toBe(1);
    expect(JSON.parse(result.out[0] ?? "")).toEqual({ target: "local", database: "app-db", applied: ["0001_init"], skipped: [], dryRun: false });
  });

  it("changes nothing under --dry-run", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "migrations", "0001_init.sql")]: INIT }, { now: NOW });
    wire(io);

    const result = await drive(io, ["migrate", "--root", root, "--yes", "--dry-run"]);

    expect(result.out).toEqual(["would apply 1 to app-db (local): 0001_init"]);
    expect(io.calls.some((call) => argvHas(call.slice(1), "execute", "--yes", "--file"))).toBe(false);
  });

  it("reports what a --to cut left behind", async () => {
    const root = appRoot();
    const io = fakeDbIo(
      { [join(root, "migrations", "0001_init.sql")]: INIT, [join(root, "migrations", "0002_next.sql")]: "CREATE TABLE notes (id) STRICT;" },
      { now: NOW },
    );
    wire(io);

    const result = await drive(io, ["migrate", "--root", root, "--yes", "--to", "0001"]);

    expect(result.out).toEqual(["applied 1: 0001_init", "left for a later run: 0002_next"]);
  });

  it("exits 1 and says why when a migration will not lint", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "migrations", "0001_init.sql")]: composed("DROP TABLE users;") }, { now: NOW });
    wire(io);

    const result = await drive(io, ["migrate", "--root", root, "--yes"]);

    expect(result.code).toBe(1);
    expect(result.err[0]?.startsWith("Error: 1 lint error(s) in the migrations:")).toBe(true);
  });

  it("applies it anyway under --no-lint", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "migrations", "0001_init.sql")]: composed("DROP TABLE users;") }, { now: NOW });
    wire(io);

    const result = await drive(io, ["migrate", "--root", root, "--yes", "--no-lint"]);

    expect(result.out).toEqual(["applied 1: 0001_init"]);
  });

  it("refuses --no-lint against a deployed target, naming the flag that accepts warnings there", async () => {
    for (const place of ["remote", "preview"]) {
      const root = deployableRoot();
      const io = fakeDbIo({ [join(root, "migrations", "0001_init.sql")]: INIT }, { now: NOW });
      wire(io);

      const result = await drive(io, ["migrate", "--root", root, "--yes", "--no-lint", "--target", place]);

      expect(result.err).toEqual(["Error: --no-lint is local-only; on a deployed target use --allow-warnings to accept warnings."]);
      expect(result.code).toBe(1);
      expect(io.calls.some((call) => argvHas(call.slice(1), "execute", "--yes", "--file"))).toBe(false);
    }
  });
});

describe("forge db migrate compose --custom", () => {
  it("allocates the next number from the migrations directory and writes the custom stamp", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "migrations", "0003_earlier.sql")]: INIT }, { now: NOW });
    wire(io);

    const result = await drive(io, ["migrate", "compose", "add_notes", "--custom", "--root", root]);

    expect(result.out).toEqual([`wrote ${join(root, "migrations", "0004_add_notes.sql")} — fill it in, then \`forge db lint\``]);
    expect(io.files.get(join(root, "migrations", "0004_add_notes.sql"))).toBe(
      "-- Custom migration, hand-written: a data move or a step compose cannot express.\n-- forge:custom {}\n\n",
    );
  });

  it("refuses --custom without a name", async () => {
    const root = appRoot();
    const io = fakeDbIo({}, { now: NOW });
    wire(io);
    const result = await drive(io, ["migrate", "compose", "--custom", "--root", root]);
    expect(result.code).toBe(1);
    expect(result.err).toEqual(["Error: a custom migration needs a name — `forge db migrate compose --custom <name>`"]);
  });

  it("takes --allow-destructive as a digest, and refuses the bare flag", async () => {
    const compose = createDbCommands()
      .commands.find((c) => c.name === "migrate")
      ?.commands.find((c) => c.name === "compose");
    expect(compose?.flags["allow-destructive"]?.type).toBe("string");

    const root = appRoot();
    const io = fakeDbIo({}, { now: NOW });
    wire(io);
    const result = await drive(io, ["migrate", "compose", "x", "--allow-destructive", "--root", root]);
    expect(result.code).toBe(1);
    expect(result.err).toEqual(["Error: Flag --allow-destructive requires a value"]);
  });

  it("refuses to compose when config/db.ts names no schemas, and says what to write", async () => {
    const root = appRoot();
    const io = fakeDbIo({}, { now: NOW });
    wire(io);
    const result = await drive(io, ["migrate", "compose", "--root", root]);
    expect(result.code).toBe(1);
    expect(result.err[0]).toContain("config/db.ts names no `schemas`");
  });
});

describe("forge db migrate status", () => {
  it("reports a pending migration and exits 0 without --check", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "migrations", "0001_init.sql")]: INIT }, { now: NOW });
    wire(io);

    const result = await drive(io, ["migrate", "status", "--root", root]);

    expect(result.code).toBe(null);
    expect(result.out[0]?.split("\n").at(-1)).toBe("1 pending — apply with `forge db migrate`");
  });

  it("exits 1 under --check while anything is pending", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "migrations", "0001_init.sql")]: INIT }, { now: NOW });
    wire(io);

    const result = await drive(io, ["migrate", "status", "--root", root, "--check"]);

    expect(result.code).toBe(1);
    expect(result.err).toEqual(["Error: app-db (local) is not in step with its migrations — see the report above."]);
  });

  it("exits 0 under --check when every migration is applied and its fingerprint certified", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "migrations", "0001_init.sql")]: INIT }, { now: NOW });
    wire(io, { recorded: jsonRows([{ name: "0001_init", sha256: migrationChecksum(INIT), applied_at: 1, fingerprint: FINGERPRINT }]) });

    const result = await drive(io, ["migrate", "status", "--root", root, "--check"]);

    expect(result.code).toBe(null);
    expect(result.err).toEqual([]);
  });

  it("exits 1 under --check when the schema fingerprint has moved since it was certified", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "migrations", "0001_init.sql")]: INIT }, { now: NOW });
    wire(io, { recorded: jsonRows([{ name: "0001_init", sha256: migrationChecksum(INIT), applied_at: 1, fingerprint: "ff" }]) });

    const result = await drive(io, ["migrate", "status", "--root", root, "--check"]);

    expect(result.code).toBe(1);
  });

  it("exits 1 under --check when an applied file was edited since", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "migrations", "0001_init.sql")]: INIT }, { now: NOW });
    wire(io, { recorded: jsonRows([{ name: "0001_init", sha256: "stale-hash", applied_at: 1, fingerprint: FINGERPRINT }]) });

    const result = await drive(io, ["migrate", "status", "--root", root, "--check"]);

    expect(result.code).toBe(1);
  });

  it("prints the report as one JSON document under --json", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "migrations", "0001_init.sql")]: INIT }, { now: NOW });
    wire(io);

    const result = await drive(io, ["migrate", "status", "--root", root, "--json"]);

    expect(result.out.length).toBe(1);
    const report = JSON.parse(result.out[0] ?? "");
    expect(report.target).toBe("local");
    expect(report.database).toBe("app-db");
    expect(report.pending).toBe(1);
    expect(report.rows).toEqual([{ name: "0001_init", state: "pending", appliedAt: null }]);
    expect(report.fingerprint.recorded).toBe(null);
  });
});

describe("forge db lint", () => {
  it("lints the whole migrations directory when no file is named", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "migrations", "0001_init.sql")]: "DELETE FROM users;" }, { now: NOW });
    wire(io);

    const result = await drive(io, ["lint", "--root", root]);

    expect(result.out).toEqual([`error ${join(root, "migrations", "0001_init.sql")}:1 unbounded-delete — DELETE with no WHERE empties the table`]);
    expect(result.code).toBe(1);
    expect(result.err).toEqual(["Error: lint found 1 error(s) and 0 warning(s)."]);
  });

  it("lints only the files it was given", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "sql", "one.sql")]: "DROP TABLE users;", [join(root, "migrations", "0001_init.sql")]: INIT }, { now: NOW });
    wire(io);

    const result = await drive(io, ["lint", "sql/one.sql", "--root", root]);

    expect(result.out.every((line) => line.includes(join(root, "sql", "one.sql")))).toBe(true);
    expect(result.out.some((line) => line.includes("drop-no-if-exists"))).toBe(true);
  });

  it("says so and exits 0 when there is nothing to report", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "migrations", "0001_init.sql")]: GENERATED_INIT }, { now: NOW });
    wire(io);

    const result = await drive(io, ["lint", "--root", root]);

    expect(result.out).toEqual(["no findings"]);
    expect(result.code).toBe(null);
  });

  it("passes a warning by default and fails on it under --strict", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "migrations", "0001_init.sql")]: composed("ALTER TABLE users DROP COLUMN nickname;") }, { now: NOW });
    wire(io);

    expect((await drive(io, ["lint", "--root", root])).code).toBe(null);

    const strict = await drive(io, ["lint", "--root", root, "--strict"]);
    expect(strict.code).toBe(1);
    expect(strict.err).toEqual(["Error: lint found 0 error(s) and 1 warning(s), and --strict fails on both."]);
  });

  it("checks the seeds instead of the migrations under --seeds", async () => {
    const root = appRoot();
    const io = fakeDbIo(
      {
        [join(root, "migrations", "0001_init.sql")]: "DELETE FROM users;",
        [join(root, "seeds", "0001_users.sql")]: "INSERT INTO users (id) VALUES (1);",
      },
      { now: NOW },
    );
    wire(io);

    const result = await drive(io, ["lint", "--root", root, "--seeds"]);

    expect(result.out).toEqual([
      `warning ${join(root, "seeds", "0001_users.sql")}:1 seed-insert-not-idempotent — INSERT without OR IGNORE, OR REPLACE or ON CONFLICT is not safe to run twice — a re-run duplicates the row or fails on its key`,
    ]);
    expect(result.code).toBe(null);
  });

  it("warns on an unbounded DELETE in a seed, and fails it under --strict", async () => {
    const root = appRoot();
    const io = fakeDbIo(
      { [join(root, "migrations", "0001_init.sql")]: INIT, [join(root, "seeds", "0001_wipe.sql")]: "DELETE FROM users;" },
      { now: NOW },
    );
    wire(io);

    const result = await drive(io, ["lint", "--root", root, "--seeds"]);
    expect(result.out).toEqual([`warning ${join(root, "seeds", "0001_wipe.sql")}:1 unbounded-delete — DELETE with no WHERE empties the table`]);
    expect(result.code).toBe(null);

    const strict = await drive(io, ["lint", "--root", root, "--seeds", "--strict"]);
    expect(strict.code).toBe(1);
    expect(strict.err).toEqual(["Error: lint found 0 error(s) and 1 warning(s), and --strict fails on both."]);
  });

  it("lints a seed holding an unset variable with no environment at all", async () => {
    const root = appRoot();
    const io = fakeDbIo(
      {
        [join(root, "migrations", "0001_init.sql")]: INIT,
        [join(root, "seeds", "0001_users.sql")]: "INSERT OR IGNORE INTO users (id, email) VALUES (1, '${UNSET}');",
      },
      { now: NOW },
    );
    wire(io);

    const result = await drive(io, ["lint", "--root", root, "--seeds"]);

    expect(result.out).toEqual(["no findings"]);
    expect(result.code).toBe(null);
  });

  it("passes a seed whose INSERT is safe to run twice", async () => {
    const root = appRoot();
    const io = fakeDbIo(
      {
        [join(root, "migrations", "0001_init.sql")]: INIT,
        [join(root, "seeds", "0001_users.sql")]: "INSERT INTO users (id) VALUES (1) ON CONFLICT DO NOTHING;",
      },
      { now: NOW },
    );
    wire(io);

    const result = await drive(io, ["lint", "--root", root, "--seeds"]);

    expect(result.out).toEqual(["no findings"]);
    expect(result.code).toBe(null);
  });

  it("prints the findings as one JSON document under --json", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "migrations", "0001_init.sql")]: "DELETE FROM users;" }, { now: NOW });
    wire(io);

    const result = await drive(io, ["lint", "--root", root, "--json"]);

    expect(result.out.length).toBe(1);
    expect(JSON.parse(result.out[0] ?? "").errors).toBe(1);
  });
});
