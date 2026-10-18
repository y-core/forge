import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { INVENTORY_SELECT } from "../../../storage/db/schema";
import { execute } from "../../cli/execute";
import { createDbCommands } from "../commands";
import { OK, argvHas, bufferedIO, composed, fakeDbIo, jsonRows, minimalWranglerConfig, schemaModelRows } from "../db.fixture";
import { formatComposeHeader } from "../schema/header";
import type { DbHostConfig, FakeDbIo, Spawned } from "../types";
import { RECORDED_CHECKSUM_SELECT } from "./checksum";
import { migrationChecksum, migrationsDigest } from "./files";
import { schemaFingerprint } from "./fingerprint";

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

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
  roots.push(root);
  const config = minimalWranglerConfig(root);
  writeFileSync(config.path, config.text, "utf-8");
  return root;
}

function wire(io: FakeDbIo, over: { recorded?: Record<string, unknown>[] } = {}): void {
  io.d1Rules.push(
    { match: (statement) => statement === RECORDED_CHECKSUM_SELECT, reply: () => over.recorded ?? (noTable() as never) },
    { match: (statement) => statement === INVENTORY_SELECT, reply: INVENTORY },
  );
  // A deployed place still reads through the CLI, so both effects are wired.
  io.rules.push(
    { match: isRecordedSelect, reply: over.recorded === undefined ? NO_TABLE : jsonRows(over.recorded) },
    { match: isInventorySelect, reply: jsonRows(INVENTORY) },
    { match: (a) => argvHas(a, "execute", "--yes", "--command"), reply: OK },
    { match: (a) => argvHas(a, "execute", "--yes", "--file"), reply: OK },
  );
}

const noTable = () => {
  throw new Error("no such table: _forge_migrations");
};

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
    const io = fakeDbIo({ [join(root, "config", "db", "migrations", "0001_init.sql")]: INIT }, { now: NOW });
    wire(io);

    const result = await drive(io, ["migrate", "apply", "--root", root, "--yes"]);

    expect(result.out).toEqual(["applied 1: 0001_init"]);
    expect(result.code).toBe(null);
  });

  it("applies from the bare verb too, which is `migrate apply` under another name", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "config", "db", "migrations", "0001_init.sql")]: INIT }, { now: NOW });
    wire(io);

    const result = await drive(io, ["migrate", "--root", root, "--yes"]);

    expect(result.out).toEqual(["applied 1: 0001_init"]);
    expect(result.code).toBe(null);
  });

  it("prints one JSON document and nothing else under --json", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "config", "db", "migrations", "0001_init.sql")]: INIT }, { now: NOW });
    wire(io);

    const result = await drive(io, ["migrate", "--root", root, "--yes", "--json"]);

    expect(result.out.length).toBe(1);
    expect(JSON.parse(result.out[0] ?? "")).toEqual({ target: "local", database: "app-db", applied: ["0001_init"], skipped: [], dryRun: false });
  });

  it("changes nothing under --dry-run", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "config", "db", "migrations", "0001_init.sql")]: INIT }, { now: NOW });
    wire(io);

    const result = await drive(io, ["migrate", "--root", root, "--yes", "--dry-run"]);

    expect(result.out).toEqual(["would apply 1 to app-db (local): 0001_init"]);
    expect(io.calls.some((call) => argvHas(call.slice(1), "execute", "--yes", "--file"))).toBe(false);
  });

  it("reports what a --to cut left behind", async () => {
    const root = appRoot();
    const io = fakeDbIo(
      {
        [join(root, "config", "db", "migrations", "0001_init.sql")]: INIT,
        [join(root, "config", "db", "migrations", "0002_next.sql")]: "CREATE TABLE notes (id) STRICT;",
      },
      { now: NOW },
    );
    wire(io);

    const result = await drive(io, ["migrate", "--root", root, "--yes", "--to", "0001"]);

    expect(result.out).toEqual(["applied 1: 0001_init", "left for a later run: 0002_next"]);
  });

  it("exits 1 and says why when a migration will not lint", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "config", "db", "migrations", "0001_init.sql")]: composed("DROP TABLE users;") }, { now: NOW });
    wire(io);

    const result = await drive(io, ["migrate", "--root", root, "--yes"]);

    expect(result.code).toBe(1);
    expect(result.err[0]?.startsWith("Error: 1 lint finding(s) in the pending migrations, so nothing was applied:")).toBe(true);
  });

  for (const flag of ["--no-lint", "--allow-warnings", "--allow-drift"]) {
    it(`rejects ${flag} as an unknown flag, applying nothing`, async () => {
      const root = appRoot();
      const io = fakeDbIo({ [join(root, "config", "db", "migrations", "0001_init.sql")]: composed("DROP TABLE users;") }, { now: NOW });
      wire(io);

      const result = await drive(io, ["migrate", "--root", root, "--yes", flag]);

      expect(result.code).toBe(1);
      expect(result.err[0]?.startsWith(`Error: Unknown flag: ${flag}.`)).toBe(true);
      expect(result.out).toEqual([]);
      expect(io.d1Calls).toEqual([]);
    });
  }

  const unresolvable: [string, Record<string, unknown>[], string[], string][] = [
    [
      "a config declaring two databases when the run names neither",
      [
        { binding: "DB", database_name: "app-db", database_id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a", migrations_dir: "config/db/migrations" },
        { binding: "REPORTS", database_name: "reports-db", database_id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5c" },
      ],
      [],
      "declares 2 d1_databases — name one with --db <binding|database_name>",
    ],
    [
      "--target remote while the database_id is a placeholder",
      [{ binding: "DB", database_name: "app-db", database_id: "app-db-local", migrations_dir: "config/db/migrations" }],
      ["--target", "remote"],
      "remote is refused while wrangler.jsonc's database_id is the placeholder app-db-local",
    ],
  ];
  for (const [what, databases, extra, reason] of unresolvable) {
    it(`refuses ${what}, reading and applying nothing`, async () => {
      const root = appRoot();
      const config = minimalWranglerConfig(root, { d1_databases: databases });
      writeFileSync(config.path, config.text, "utf-8");
      const io = fakeDbIo({ [join(root, "config", "db", "migrations", "0001_init.sql")]: INIT }, { now: NOW });
      wire(io);

      const result = await drive(io, ["migrate", "--root", root, "--yes", ...extra]);

      expect(result.code).toBe(1);
      expect(result.err.join("\n")).toContain(reason);
      expect(io.d1Calls).toEqual([]);
      expect(io.calls).toEqual([]);
    });
  }
});

describe("forge db migrate against the deployed database", () => {
  /** Replaces `globalThis.fetch` with a recorder for the length of `body`, answering every request as an accepted D1 create. */
  async function recordingGlobalFetch<T>(body: () => Promise<T>): Promise<{ sent: string[]; value: T }> {
    const sent: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(`${init?.method ?? "GET"} ${String(input)}`);
      return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: { uuid: "x", name: "" } }));
    }) as typeof globalThis.fetch;
    try {
      return { sent, value: await body() };
    } finally {
      globalThis.fetch = original;
    }
  }

  for (const [flag, last] of [
    ["--yes", "applied 1: 0001_init"],
    ["--dry-run", "would apply 1 to app-db (remote): 0001_init"],
  ] as const) {
    it(`sends Cloudflare no request under ${flag} with API credentials set, reaching the database only through wrangler`, async () => {
      const root = appRoot();
      const io = fakeDbIo(
        { [join(root, "config", "db", "migrations", "0001_init.sql")]: GENERATED_INIT },
        { now: NOW, env: { CLOUDFLARE_API_TOKEN: "tok", CLOUDFLARE_ACCOUNT_ID: "acc" } },
      );
      io.rules.push({ match: (a) => argvHas(a, "time-travel", "info"), reply: { code: 0, stdout: '{"bookmark":"bm-1"}', stderr: "" } });
      wire(io);

      const { sent, value: result } = await recordingGlobalFetch(() => drive(io, ["migrate", "--root", root, "--target", "remote", flag]));

      expect([result.code, result.err, result.out.at(-1), sent]).toEqual([null, [], last, []]);
    });
  }
});

describe("forge db migrate compose", () => {
  it("refuses --custom as a flag it does not know, writing nothing", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "config", "db", "migrations", "0001_init.sql")]: INIT }, { now: NOW });
    wire(io);

    const result = await drive(io, ["migrate", "compose", "add_notes", "--custom", "--root", root]);

    expect(result.code).toBe(1);
    expect(result.err.join("\n")).toContain("--custom");
    expect(io.files.has(join(root, "config", "db", "migrations", "0002_add_notes.sql"))).toBe(false);
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

  it("refuses to compose when a declared schema's file is missing, and names it", async () => {
    const root = appRoot();
    const io = fakeDbIo({}, { now: NOW });
    wire(io);
    const result = await drive(io, ["migrate", "compose", "--root", root]);
    expect(result).toEqual({ out: [], err: ["Error: schema.sql is declared in config/db.ts and no file is there to read"], code: 1 });
  });

  it("refuses to compose when one of two declared schemas is missing, names only that one, and writes nothing", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "a.sql")]: "CREATE TABLE a (id INTEGER PRIMARY KEY) STRICT;\n" }, { now: NOW });
    wire(io);
    const before = [...io.files.keys()];
    const result = await drive(io, ["migrate", "compose", "--root", root], { schemas: ["a.sql", "b.sql"] });
    expect(result).toEqual({ out: [], err: ["Error: b.sql is declared in config/db.ts and no file is there to read"], code: 1 });
    expect([...io.files.keys()]).toEqual(before);
  });

  it("exits 0 with nothing to compose when config/db.ts names no schemas and there is no history", async () => {
    const root = appRoot();
    const io = fakeDbIo({}, { now: NOW });
    wire(io);
    const result = await drive(io, ["migrate", "compose", "--root", root], {});
    expect(result).toEqual({
      out: ["config/db.ts names no `schemas`, and there is no snapshot and no migration — nothing to compose"],
      err: [],
      code: null,
    });
  });

  it("exits 1 when config/db.ts names no schemas and a migration is on disk", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "config", "db", "migrations", "0001_init.sql")]: INIT }, { now: NOW });
    wire(io);
    const result = await drive(io, ["migrate", "compose", "--root", root], {});
    expect(result.code).toBe(1);
    expect(result.err[0]).toStartWith(
      "Error: the migrations reach 0001_init — there is history to hold in step, so composing from no schema is refused:",
    );
  });
});

describe("forge db migrate status", () => {
  it("reports a pending migration and exits 0 without --check", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "config", "db", "migrations", "0001_init.sql")]: INIT }, { now: NOW });
    wire(io);

    const result = await drive(io, ["migrate", "status", "--root", root]);

    expect(result.code).toBe(null);
    expect(result.out[0]?.split("\n").at(-1)).toBe("1 pending — apply with `forge db migrate`");
  });

  it("exits 1 under --check while anything is pending", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "config", "db", "migrations", "0001_init.sql")]: INIT }, { now: NOW });
    wire(io);

    const result = await drive(io, ["migrate", "status", "--root", root, "--check"]);

    expect(result.code).toBe(1);
    expect(result.err).toEqual(["Error: app-db (local) is not in step with its migrations — see the report above."]);
  });

  it("exits 0 under --check when every migration is applied and its fingerprint certified", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "config", "db", "migrations", "0001_init.sql")]: INIT }, { now: NOW });
    wire(io, { recorded: [{ name: "0001_init", sha256: migrationChecksum(INIT), applied_at: 1, fingerprint: FINGERPRINT }] });

    const result = await drive(io, ["migrate", "status", "--root", root, "--check"]);

    expect(result.code).toBe(null);
    expect(result.err).toEqual([]);
  });

  it("exits 1 under --check when the schema fingerprint has moved since it was certified", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "config", "db", "migrations", "0001_init.sql")]: INIT }, { now: NOW });
    wire(io, { recorded: [{ name: "0001_init", sha256: migrationChecksum(INIT), applied_at: 1, fingerprint: "ff" }] });

    const result = await drive(io, ["migrate", "status", "--root", root, "--check"]);

    expect(result.code).toBe(1);
  });

  it("exits 1 under --check when an applied file was edited since", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "config", "db", "migrations", "0001_init.sql")]: INIT }, { now: NOW });
    wire(io, { recorded: [{ name: "0001_init", sha256: "stale-hash", applied_at: 1, fingerprint: FINGERPRINT }] });

    const result = await drive(io, ["migrate", "status", "--root", root, "--check"]);

    expect(result.code).toBe(1);
  });

  describe("over a history wrangler wrote", () => {
    const HISTORY_ROW = {
      type: "table",
      name: "d1_migrations",
      tbl_name: "d1_migrations",
      sql: "CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY, name TEXT)",
    };
    const WITH_HISTORY = [...INVENTORY, HISTORY_ROW];
    const certified = schemaFingerprint(WITH_HISTORY.map(({ type, name, tbl_name, sql }) => ({ type, name, tblName: tbl_name, sql })));

    function historyIo(root: string, names: readonly string[]): FakeDbIo {
      const io = fakeDbIo({ [join(root, "config", "db", "migrations", "0001_init.sql")]: INIT }, { now: NOW });
      wire(io, { recorded: [{ name: "0001_init", sha256: migrationChecksum(INIT), applied_at: 1, fingerprint: certified }] });
      io.d1Rules.unshift(
        { match: (statement) => statement === INVENTORY_SELECT, reply: WITH_HISTORY },
        { match: (statement) => statement === 'SELECT name FROM "d1_migrations" ORDER BY id', reply: names.map((name) => ({ name })) },
      );
      return io;
    }

    it("exits 1 under --check when wrangler's history records a migration forge never applied, and names it in the report", async () => {
      const root = appRoot();

      const checked = await drive(historyIo(root, ["0001_init.sql", "0002_hand.sql"]), ["migrate", "status", "--root", root, "--check"]);
      const report = JSON.parse(
        (await drive(historyIo(root, ["0001_init.sql", "0002_hand.sql"]), ["migrate", "status", "--root", root, "--json"])).out[0] ?? "",
      );

      expect([checked.code, checked.err]).toEqual([1, ["Error: app-db (local) is not in step with its migrations — see the report above."]]);
      expect(checked.out[0]?.split("\n").at(-1)).toBe(
        "d1_migrations records 0002_hand, which forge never applied — `wrangler d1 migrations apply` ran against this database",
      );
      expect([report.pending, report.fingerprint.matches, report.wranglerHistory]).toEqual([
        0,
        true,
        { table: "d1_migrations", unapplied: ["0002_hand"] },
      ]);
    });

    it("exits 0 under --check when wrangler's history records only migrations forge applied", async () => {
      const root = appRoot();

      const checked = await drive(historyIo(root, ["0001_init.sql"]), ["migrate", "status", "--root", root, "--check"]);

      expect([checked.code, checked.err]).toEqual([null, []]);
    });
  });

  it("prints the report as one JSON document under --json", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, "config", "db", "migrations", "0001_init.sql")]: INIT }, { now: NOW });
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
  const migration = (root: string, name: string) => join(root, "config", "db", "migrations", `${name}.sql`);
  const APPLIED_INIT = { name: "0001_init", sha256: migrationChecksum(INIT), applied_at: 1, fingerprint: null };

  it("lints the migrations the local database does not hold yet, failing on a finding", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [migration(root, "0001_init")]: composed("DELETE FROM users;") }, { now: NOW });
    wire(io);

    const result = await drive(io, ["lint", "--root", root]);

    expect(result.out).toEqual([`${migration(root, "0001_init")}:3 unbounded-delete — DELETE with no WHERE empties the table`]);
    expect(result.code).toBe(1);
    expect(result.err).toEqual(["Error: lint found 1 finding(s) in the migrations app-db (local) does not hold yet."]);
  });

  it("judges only the files absent from the target's history", async () => {
    const root = appRoot();
    const applied = composed("DELETE FROM users;");
    const io = fakeDbIo({ [migration(root, "0001_init")]: applied, [migration(root, "0002_next")]: GENERATED_INIT }, { now: NOW });
    wire(io, { recorded: [{ ...APPLIED_INIT, sha256: migrationChecksum(applied) }] });

    const result = await drive(io, ["lint", "--root", root]);

    expect([result.code, result.out]).toEqual([null, ["1 pending migration(s) on app-db (local) — no findings"]]);
  });

  const uncomposed: [string, string][] = [
    ["with no compose stamp", "CREATE TABLE strays (id INTEGER PRIMARY KEY) STRICT;\n"],
    ["whose body digest fails", `${INIT}SELECT 1;\n`],
  ];
  for (const [what, sql] of uncomposed) {
    it(`fails on a migration ${what}, naming the file and telling the developer to compose it`, async () => {
      const root = appRoot();
      const path = migration(root, "0001_init");
      const io = fakeDbIo({ [path]: sql }, { now: NOW });
      wire(io);

      const result = await drive(io, ["lint", "--root", root]);

      expect(result.code).toBe(1);
      expect(result.out).toHaveLength(1);
      expect(result.out[0]).toStartWith(`${path}:`);
      expect(result.out[0]).toContain(" generated-edited — ");
      expect(result.out[0]).toContain("compose");
    });
  }

  for (const [what, extra] of [
    ["a file argument", ["sql/one.sql"]],
    ["--strict", ["--strict"]],
  ] as const) {
    it(`refuses ${what}, as the CLI refuses any input a verb does not take, reading nothing`, async () => {
      const root = appRoot();
      const io = fakeDbIo({ [migration(root, "0001_init")]: INIT }, { now: NOW });
      wire(io);

      const result = await drive(io, ["lint", ...extra, "--root", root]);

      expect(result.code).toBe(1);
      expect(result.err.join("\n")).toStartWith("Error: ");
      expect(io.d1Calls).toEqual([]);
      expect(io.calls).toEqual([]);
    });
  }

  it("refuses a config declaring two databases when the run names neither", async () => {
    const root = appRoot();
    const config = minimalWranglerConfig(root, {
      d1_databases: [
        { binding: "DB", database_name: "app-db", database_id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a", migrations_dir: "config/db/migrations" },
        { binding: "REPORTS", database_name: "reports-db", database_id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5c" },
      ],
    });
    writeFileSync(config.path, config.text, "utf-8");
    const io = fakeDbIo({ [migration(root, "0001_init")]: INIT }, { now: NOW });
    wire(io);

    const result = await drive(io, ["lint", "--root", root]);

    expect(result.code).toBe(1);
    expect(result.err.join("\n")).toContain("declares 2 d1_databases — name one with --db <binding|database_name>");
    expect(io.d1Calls).toEqual([]);
  });

  it("refuses --target remote while the database_id is a placeholder", async () => {
    const root = appRoot();
    const config = minimalWranglerConfig(root, {
      d1_databases: [{ binding: "DB", database_name: "app-db", database_id: "app-db-local", migrations_dir: "config/db/migrations" }],
    });
    writeFileSync(config.path, config.text, "utf-8");
    const io = fakeDbIo({ [migration(root, "0001_init")]: INIT }, { now: NOW });
    wire(io);

    const result = await drive(io, ["lint", "--root", root, "--target", "remote"]);

    expect(result.code).toBe(1);
    expect(result.err.join("\n")).toContain("remote is refused while wrangler.jsonc's database_id is the placeholder app-db-local");
    expect(io.calls).toEqual([]);
  });

  it("reads a remote target through wrangler", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [migration(root, "0001_init")]: GENERATED_INIT }, { now: NOW });
    wire(io);

    const result = await drive(io, ["lint", "--root", root, "--target", "remote"]);

    expect([result.code, result.out]).toEqual([null, ["1 pending migration(s) on app-db (remote) — no findings"]]);
    expect(io.calls.some((call) => isInventorySelect(call.slice(1)) && call.includes("--remote"))).toBe(true);
  });

  it("refuses a drop its file does not approve, and names each one it does", async () => {
    const root = appRoot();
    const drop = "DROP TABLE IF EXISTS users;";
    const users = {
      inventory: [{ type: "table", name: "users", tbl_name: "users", sql: "CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT" }],
      columns: [{ tbl: "users", cid: 0, name: "id", type: "INTEGER", notnull: 0, dflt_value: null, pk: 1, hidden: 0 }],
    };
    const lintWith = async (sql: string) => {
      const io = fakeDbIo({ [migration(root, "0001_init")]: INIT, [migration(root, "0002_drop")]: sql }, { now: NOW });
      wire(io, { recorded: [APPLIED_INIT] });
      const staged = () =>
        io.d1Calls.some(
          (call) => call.home === "scratch:compose-analysis" && call.statements.some((statement) => statement.includes(drop.slice(0, -1))),
        );
      io.d1Rules.unshift({
        match: (_statement, home) => home.label === "scratch:compose-analysis",
        reply: (statement) => schemaModelRows(statement, staged() ? {} : users),
      });
      return drive(io, ["lint", "--root", root]);
    };

    const refused = await lintWith(composed(drop));
    expect(refused.code).toBe(1);
    expect(refused.err.join("\n")).toContain("0002_drop does not match the lines compose wrote for it on app-db (local), so nothing was applied");

    const approved = await lintWith(composed(`-- forge:drops table "users"\n${drop}`));
    expect([approved.code, approved.out]).toEqual([
      null,
      ["1 pending migration(s) on app-db (local) — no findings", 'approved 0002_drop: drops table "users"'],
    ]);
  });

  it("prints one JSON document naming the target, the pending files, the findings and the approved ones", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [migration(root, "0001_init")]: composed("DELETE FROM users;") }, { now: NOW });
    wire(io);

    const result = await drive(io, ["lint", "--root", root, "--json"]);

    expect(result.out.length).toBe(1);
    const outcome = JSON.parse(result.out[0] ?? "") as Record<string, unknown>;
    expect(Object.keys(outcome)).toEqual(["target", "database", "pending", "findings", "approved"]);
    expect(outcome).toMatchObject({ target: "local", database: "app-db", pending: ["0001_init"], approved: [] });
    expect(result.code).toBe(1);
  });

  it("checks the seeds instead of the migrations under --seeds, and exits 1 on a finding", async () => {
    const root = appRoot();
    const io = fakeDbIo(
      {
        [join(root, "config", "db", "migrations", "0001_init.sql")]: "DELETE FROM users;",
        [join(root, "seeds", "0001_users.sql")]: "INSERT INTO users (id) VALUES (1);",
      },
      { now: NOW },
    );
    wire(io);

    const result = await drive(io, ["lint", "--root", root, "--seeds"]);

    expect(result.out).toEqual([
      `${join(root, "seeds", "0001_users.sql")}:1 seed-insert-not-idempotent — INSERT without OR IGNORE, OR REPLACE or ON CONFLICT is not safe to run twice — a re-run duplicates the row or fails on its key`,
    ]);
    expect(result.err).toEqual(["Error: lint found 1 finding(s) in the seeds."]);
    expect(result.code).toBe(1);
  });

  it("refuses an unbounded DELETE in a seed, and prints one JSON document holding only the findings", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [migration(root, "0001_init")]: INIT, [join(root, "seeds", "0001_wipe.sql")]: "DELETE FROM users;" }, { now: NOW });
    wire(io);

    const result = await drive(io, ["lint", "--root", root, "--seeds"]);
    expect(result.out).toEqual([`${join(root, "seeds", "0001_wipe.sql")}:1 unbounded-delete — DELETE with no WHERE empties the table`]);
    expect(result.code).toBe(1);

    const json = await drive(io, ["lint", "--root", root, "--seeds", "--json"]);
    const outcome = JSON.parse(json.out[0] ?? "") as Record<string, unknown>;
    expect(Object.keys(outcome)).toEqual(["findings"]);
    expect(json.code).toBe(1);
  });

  it("lints a seed holding an unset variable with no environment at all", async () => {
    const root = appRoot();
    const io = fakeDbIo(
      {
        [join(root, "config", "db", "migrations", "0001_init.sql")]: INIT,
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
        [join(root, "config", "db", "migrations", "0001_init.sql")]: INIT,
        [join(root, "seeds", "0001_users.sql")]: "INSERT INTO users (id) VALUES (1) ON CONFLICT DO NOTHING;",
      },
      { now: NOW },
    );
    wire(io);

    const result = await drive(io, ["lint", "--root", root, "--seeds"]);

    expect(result.out).toEqual(["no findings"]);
    expect(result.code).toBe(null);
  });
});
