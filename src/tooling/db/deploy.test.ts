import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { INVENTORY_SELECT } from "../../storage/db/schema";
import { execute } from "../cli/execute";
import { createDbCommands } from "./commands";
import { OK, argvHas, bufferedIO, composed, fakeDbIo, jsonRows, minimalWranglerConfig, onStdin, schemaModelRows } from "./db.fixture";
import { deployRefusals } from "./deploy";
import { RECORDED_CHECKSUM_SELECT } from "./migrate/checksum";
import { migrationChecksum } from "./migrate/files";
import { schemaFingerprint } from "./migrate/fingerprint";
import type { FakeDbIo, Spawned, StatusReport } from "./types";

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const INIT = composed("CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT;");
const INVENTORY = [{ type: "table", name: "users", tbl_name: "users", sql: INIT }];
const FINGERPRINT = schemaFingerprint([{ type: "table", name: "users", tblName: "users", sql: INIT }]);
const APPLIED = { name: "0001_init", sha256: migrationChecksum(INIT), applied_at: 1, fingerprint: FINGERPRINT };
const HAND_APPLIED_INVENTORY = [
  ...INVENTORY,
  {
    type: "table",
    name: "d1_migrations",
    tbl_name: "d1_migrations",
    sql: "CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)",
  },
  { type: "table", name: "hand", tbl_name: "hand", sql: "CREATE TABLE hand (id INTEGER PRIMARY KEY)" },
];
const wranglerHistory = (table: string) => `SELECT name FROM "${table}" ORDER BY id`;

const noSuchTable = (table: string): Spawned => ({ code: 1, stdout: "", stderr: `no such table: ${table}` });
const asked = (statement: string) => (a: readonly string[]) => argvHas(a, "execute", "--json", "--command") && (a.at(-1) ?? "") === statement;

/** A temp root whose deployed database has a real id, so `--target remote` resolves. */
function deployableRoot(over: Record<string, unknown> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "forge-db-deploy-"));
  roots.push(root);
  const config = minimalWranglerConfig(root, over);
  writeFileSync(config.path, config.text, "utf-8");
  return root;
}

interface Deployed {
  recorded?: readonly Record<string, unknown>[];
  inventory?: readonly Record<string, unknown>[];
  wrangler?: readonly string[];
  wranglerTable?: string;
  deploy?: Spawned;
}

/** The deployed database as wrangler reports it: forge's history, the live inventory, and wrangler's own history table. */
function wire(io: FakeDbIo, over: Deployed) {
  const table = over.wranglerTable ?? "d1_migrations";
  io.rules.push(
    {
      match: asked(RECORDED_CHECKSUM_SELECT),
      reply: over.recorded === undefined ? noSuchTable("_forge_migrations") : jsonRows([...over.recorded]),
    },
    { match: asked(INVENTORY_SELECT), reply: jsonRows([...(over.inventory ?? INVENTORY)]) },
    {
      match: asked(wranglerHistory(table)),
      reply: over.wrangler === undefined ? noSuchTable(table) : jsonRows(over.wrangler.map((name) => ({ name }))),
    },
    { match: asked(wranglerHistory("d1_migrations")), reply: noSuchTable("d1_migrations") },
    { match: (a) => argvHas(a, "time-travel", "info"), reply: { code: 0, stdout: '{"bookmark":"bm-1"}', stderr: "" } },
    { match: (a) => a[0] === "deploy", reply: over.deploy ?? { code: 0, stdout: "Deployed app", stderr: "" } },
    { match: (a) => argvHas(a, "execute", "--yes"), reply: OK },
  );
}

async function drive(io: FakeDbIo, argv: string[]) {
  const buffer = bufferedIO();
  try {
    await execute(createDbCommands({ io, host: {} }), argv, buffer);
  } catch {
    // `bufferedIO().exit` throws so an in-process run stops where the real CLI would.
  }
  return { out: [...buffer.out], err: [...buffer.err], code: buffer.code };
}

/** Every wrangler invocation in order, reduced to what it was for. */
function sequence(io: FakeDbIo): string[] {
  return io.calls.flatMap((call) => {
    const args = call.slice(1);
    if (args[0] === "deploy") return [`deploy ${args.slice(1).join(" ")}`];
    if (argvHas(args, "time-travel", "info")) return ["bookmark"];
    if (argvHas(args, "execute", "--file")) return ["apply"];
    return [];
  });
}

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

const isWrite = (a: readonly string[]) => argvHas(a, "execute", "--file") || argvHas(a, "execute", "--yes");

function pendingIo(root: string, over: Deployed = {}, env: Record<string, string> = {}): FakeDbIo {
  const io = fakeDbIo({ [join(root, "config", "db", "migrations", "0001_init.sql")]: INIT }, { env });
  wire(io, { inventory: [], ...over });
  return io;
}

describe("deployRefusals()", () => {
  const report = (over: Partial<StatusReport> = {}): StatusReport => ({
    target: "remote",
    database: "app-db",
    rows: [{ name: "0001_init", state: "applied", appliedAt: null }],
    pending: 0,
    checksums: { mismatched: [] },
    drift: [],
    fingerprint: { recorded: "aa", actual: "aa", matches: true },
    ...over,
  });

  it("finds nothing in a database in step with forge that wrangler never migrated", () => {
    expect(deployRefusals(report(), [], "d1_migrations")).toEqual([]);
  });

  it("finds nothing when wrangler's history names only what forge applied, its table already under the certified fingerprint", () => {
    expect(deployRefusals(report(), ["0001_init.sql"], "d1_migrations")).toEqual([]);
  });

  it("names a wrangler-applied migration forge never applied, a pending one included", () => {
    const pending = report({ rows: [{ name: "0002_next", state: "pending", appliedAt: null }] });
    expect(deployRefusals(pending, ["0002_next.sql"], "d1_migrations")).toEqual([
      "d1_migrations records 0002_next, which forge never applied — `wrangler d1 migrations apply` ran against this database",
    ]);
  });
});

describe("forge db deploy", () => {
  it("applies the pending migrations under a bookmark, then runs wrangler deploy with -c and -e forwarded", async () => {
    const root = deployableRoot({
      env: {
        staging: {
          d1_databases: [
            { binding: "DB", database_name: "app-db", database_id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a", migrations_dir: "config/db/migrations" },
          ],
        },
      },
    });
    const io = pendingIo(root);

    const result = await drive(io, ["deploy", "--root", root, "-e", "staging", "--yes"]);

    expect([result.code, result.err]).toEqual([null, []]);
    expect(sequence(io)).toEqual(["bookmark", "apply", `deploy -c ${join(root, "wrangler.jsonc")} -e staging`]);
    expect(result.out.at(-1)).toBe("app-db: 1 migration(s) applied, then deployed");
  });

  it("deploys with nothing to apply when the database is in step", async () => {
    const root = deployableRoot();
    const io = pendingIo(root, { recorded: [APPLIED], inventory: INVENTORY });

    const result = await drive(io, ["deploy", "--root", root, "--json"]);

    expect(sequence(io)).toEqual([`deploy -c ${join(root, "wrangler.jsonc")}`]);
    const outcome = JSON.parse(result.out.at(-1) ?? "{}") as Record<string, unknown>;
    expect(outcome).toMatchObject({ pending: [], applied: [], deployed: true });
    expect("writeAccess" in outcome).toBe(false);
  });

  for (const [what, over, reason] of [
    [
      "an applied migration no longer on disk",
      { recorded: [APPLIED, { ...APPLIED, name: "0002_gone" }] },
      "applied but no longer on disk: 0002_gone",
    ],
    ["an applied migration edited since", { recorded: [{ ...APPLIED, sha256: "stale" }] }, "edited since it was applied: 0001_init"],
    ["a schema that moved outside the migrations", { recorded: [{ ...APPLIED, fingerprint: "ff" }] }, "does not match the certified ff"],
  ] as const) {
    it(`refuses ${what}, applying and deploying nothing`, async () => {
      const root = deployableRoot();
      const io = pendingIo(root, { inventory: INVENTORY, ...over });

      const result = await drive(io, ["deploy", "--root", root]);

      expect(result.code).toBe(1);
      expect(result.err.join("\n")).toContain("is not safe to migrate forward, so nothing was applied or deployed");
      expect(result.err.join("\n")).toContain(reason);
      expect(sequence(io)).toEqual([]);
    });
  }

  it("refuses a hand-applied wrangler migration by both the moved fingerprint and d1_migrations, applying and deploying nothing", async () => {
    const root = deployableRoot();
    const io = pendingIo(root, { recorded: [APPLIED], inventory: HAND_APPLIED_INVENTORY, wrangler: ["0001_init.sql", "0002_hand.sql"] });
    const moved = schemaFingerprint(HAND_APPLIED_INVENTORY.map(({ type, name, tbl_name, sql }) => ({ type, name, tblName: tbl_name, sql })));

    const result = await drive(io, ["deploy", "--root", root]);

    expect([result.code, result.err, sequence(io)]).toEqual([
      1,
      [
        "Error: app-db (remote) is not safe to migrate forward, so nothing was applied or deployed:\n" +
          `  schema fingerprint ${moved} does not match the certified ${FINGERPRINT} — the schema moved outside the migrations\n` +
          "  d1_migrations records 0002_hand, which forge never applied — `wrangler d1 migrations apply` ran against this database",
      ],
      [],
    ]);
  });

  it("reads wrangler's history from the entry's migrations_table, refusing a migration it records even with no certified fingerprint", async () => {
    const root = deployableRoot({
      d1_databases: [
        {
          binding: "DB",
          database_name: "app-db",
          database_id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a",
          migrations_dir: "config/db/migrations",
          migrations_table: "schema_migrations",
        },
      ],
    });
    const io = pendingIo(root, {
      inventory: [
        ...INVENTORY,
        {
          type: "table",
          name: "schema_migrations",
          tbl_name: "schema_migrations",
          sql: "CREATE TABLE schema_migrations(id INTEGER PRIMARY KEY, name TEXT)",
        },
      ],
      wrangler: ["0001_init.sql"],
      wranglerTable: "schema_migrations",
    });

    const result = await drive(io, ["deploy", "--root", root]);

    expect([result.code, result.err, sequence(io)]).toEqual([
      1,
      [
        "Error: app-db (remote) is not safe to migrate forward, so nothing was applied or deployed:\n" +
          "  schema_migrations records 0001_init, which forge never applied — `wrangler d1 migrations apply` ran against this database",
      ],
      [],
    ]);
  });

  it("fails naming D1_WRITE_PERMISSION, with nothing applied and no wrangler deploy run, when the token cannot write D1", async () => {
    const root = deployableRoot();
    const io = pendingIo(root);
    io.rules.unshift({
      match: isWrite,
      reply: {
        code: 1,
        stdout: "",
        stderr: "✘ [ERROR] A request to the Cloudflare API (/accounts/acc/d1/database/x/query) failed.\n\n  Authentication error [code: 10000]",
      },
    });

    const result = await drive(io, ["deploy", "--root", root, "--yes"]);

    expect([result.code, result.out, result.err]).toEqual([
      1,
      [],
      ["Error: the API token cannot write D1 — add Account → D1 → Edit to it, then run again. Nothing was applied."],
    ]);
    expect(sequence(io)).toEqual([]);
    expect(io.calls.filter((call) => isWrite(call.slice(1)))).toHaveLength(1);
  });

  it("names D1_WRITE_PERMISSION without claiming nothing was applied when the token is refused on a later file", async () => {
    const root = deployableRoot();
    const io = pendingIo(root);
    io.files.set(join(root, "config", "db", "migrations", "0002_posts.sql"), composed("CREATE TABLE posts (id INTEGER PRIMARY KEY) STRICT;"));
    io.rules.unshift({
      match: (a) => isWrite(a) && (a.at(-1) ?? "").endsWith("0002_posts.sql"),
      reply: { code: 1, stdout: "", stderr: "Authentication error [code: 10000]" },
    });

    const result = await drive(io, ["deploy", "--root", root, "--yes"]);

    expect([result.code, result.err]).toEqual([
      1,
      [
        "Error: the API token cannot write D1 — add Account → D1 → Edit to it, then run again. The migrations before the refused write may be applied.",
      ],
    ]);
    expect(result.out.at(-1)).toStartWith("the database may be part-migrated — undo with: ");
    expect(sequence(io)).toEqual(["bookmark", "apply", "apply"]);
  });

  it("keeps a write failure's own message when it carries no auth code, naming no D1 permission", async () => {
    const root = deployableRoot();
    const io = pendingIo(root);
    io.rules.unshift({ match: isWrite, reply: { code: 1, stdout: "", stderr: "D1_ERROR: database is locked" } });

    const result = await drive(io, ["deploy", "--root", root, "--yes"]);

    expect([result.code, result.err.length, sequence(io)]).toEqual([1, 1, []]);
    expect(result.err[0]).toMatch(/^Error: [\s\S]+ against remote \(app-db\) failed \(exit 1\):\nD1_ERROR: database is locked$/);
    expect(result.err[0]).not.toContain("D1 → Edit");
  });

  it("sends Cloudflare no request during a full deploy with credentials set", async () => {
    const root = deployableRoot();
    const io = pendingIo(root, {}, { CLOUDFLARE_API_TOKEN: "tok", CLOUDFLARE_ACCOUNT_ID: "acc" });

    const { sent, value: result } = await recordingGlobalFetch(() => drive(io, ["deploy", "--root", root, "--yes"]));

    expect([result.code, result.err, sequence(io), sent]).toEqual([
      null,
      [],
      ["bookmark", "apply", `deploy -c ${join(root, "wrangler.jsonc")}`],
      [],
    ]);
  });

  for (const pending of [true, false]) {
    it(`sends Cloudflare nothing under --check-only with credentials set, ${pending ? "a migration pending" : "nothing pending"}`, async () => {
      const root = deployableRoot();
      const io = pendingIo(root, pending ? {} : { recorded: [APPLIED], inventory: INVENTORY }, {
        CLOUDFLARE_API_TOKEN: "tok",
        CLOUDFLARE_ACCOUNT_ID: "acc",
      });

      const { sent, value: result } = await recordingGlobalFetch(() => drive(io, ["deploy", "--root", root, "--check-only"]));

      expect([result.code, sent]).toEqual([pending ? 1 : null, []]);
    });
  }

  for (const argv of [["--yes"], ["--check-only"]]) {
    it(`refuses a lint finding in a pending migration under ${argv[0]}, bookmarking, applying and deploying nothing`, async () => {
      const root = deployableRoot();
      const io = fakeDbIo({ [join(root, "config", "db", "migrations", "0001_init.sql")]: composed("DELETE FROM users;") });
      wire(io, { inventory: [] });

      const result = await drive(io, ["deploy", "--root", root, ...argv]);

      expect(result.code).toBe(1);
      expect(result.err.join("\n")).toContain("1 lint finding(s) in the pending migrations, so nothing was applied:");
      expect(sequence(io)).toEqual([]);
    });
  }

  it("stops after the checks under --check-only, exiting 1 while a migration is pending", async () => {
    const root = deployableRoot();
    const io = pendingIo(root);

    const result = await drive(io, ["deploy", "--root", root, "--check-only"]);

    expect([result.code, result.out, sequence(io)]).toEqual([1, ["would apply 1 to app-db (remote): 0001_init"], []]);
    expect(result.err).toEqual(["Error: app-db (remote) has 1 pending migration(s) — deploy applies them before `wrangler deploy`"]);
  });

  it("exits 0 under --check-only when nothing is pending, deploying nothing", async () => {
    const root = deployableRoot();
    const io = pendingIo(root, { recorded: [APPLIED], inventory: INVENTORY });

    const result = await drive(io, ["deploy", "--root", root, "--check-only"]);

    expect([result.code, result.out, sequence(io)]).toEqual([null, ["app-db (remote) is up to date"], []]);
  });

  for (const [what, sql] of [
    ["with no compose stamp", "CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT;\n"],
    ["whose body digest fails", `${INIT}SELECT 1;\n`],
  ] as const) {
    for (const flags of [[], ["--check-only"]]) {
      it(`refuses a pending migration ${what}${flags.length > 0 ? " under --check-only" : ""}, applying and deploying nothing`, async () => {
        const root = deployableRoot();
        const io = fakeDbIo({ [join(root, "config", "db", "migrations", "0001_init.sql")]: sql });
        wire(io, { inventory: [] });

        const result = await drive(io, ["deploy", "--root", root, ...flags]);

        expect(result.code).toBe(1);
        expect(result.err.join("\n")).toContain("app-db (remote) has 1 pending migration(s) compose did not write");
        expect(result.err.join("\n")).toContain(`${join(root, "config", "db", "migrations", "0001_init.sql")}:`);
        expect(result.err.join("\n")).toContain("generated-edited");
        expect(sequence(io)).toEqual([]);
        expect(io.calls.some((call) => isWrite(call.slice(1)))).toBe(false);
      });
    }
  }

  it("prints the bookmark's whole undo command when wrangler deploy fails after the apply", async () => {
    const root = deployableRoot();
    const io = pendingIo(root, { deploy: { code: 1, stdout: "", stderr: "✘ build failed" } });

    const result = await drive(io, ["deploy", "--root", root, "--yes"]);

    expect([result.code, result.err]).toEqual([
      1,
      [
        "Error: wrangler deploy failed (exit 1):\n✘ build failed\n" +
          "1 migration(s) were applied before the deploy failed, so the Worker still running is the previous one. Undo the schema with: " +
          `forge db bookmark restore --target remote --bookmark bm-1 --root '${root}' --config '${join(root, "wrangler.jsonc")}' --db 'DB'`,
      ],
    ]);
  });

  it("carries -e into the undo command of a failed environment deploy", async () => {
    const root = deployableRoot({
      env: {
        staging: {
          d1_databases: [
            { binding: "DB", database_name: "app-db", database_id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a", migrations_dir: "config/db/migrations" },
          ],
        },
      },
    });
    const io = pendingIo(root, { deploy: { code: 1, stdout: "", stderr: "✘ build failed" } });

    const result = await drive(io, ["deploy", "--root", root, "-e", "staging", "--yes"]);

    expect(result.err.join("\n").split("Undo the schema with: ")[1]).toBe(
      `forge db bookmark restore --target remote --bookmark bm-1 --root '${root}' --config '${join(root, "wrangler.jsonc")}' --db 'DB' -e 'staging'`,
    );
  });

  for (const [what, databases, reason] of [
    [
      "a config declaring two databases when the run names neither",
      [
        { binding: "DB", database_name: "app-db", database_id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a", migrations_dir: "config/db/migrations" },
        { binding: "REPORTS", database_name: "reports-db", database_id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5c" },
      ],
      "declares 2 d1_databases — name one with --db <binding|database_name>",
    ],
    [
      "its default remote target while the database_id is a placeholder",
      [{ binding: "DB", database_name: "app-db", database_id: "app-db-local", migrations_dir: "config/db/migrations" }],
      "remote is refused while wrangler.jsonc's database_id is the placeholder app-db-local",
    ],
  ] as const) {
    it(`refuses ${what}, before any read, apply or deploy`, async () => {
      const root = deployableRoot({ d1_databases: databases });
      const io = pendingIo(root);

      const result = await drive(io, ["deploy", "--root", root]);

      expect(result.code).toBe(1);
      expect(result.err.join("\n")).toContain(reason);
      expect(io.calls).toEqual([]);
    });
  }

  for (const target of ["local", "preview", "standby"]) {
    it(`refuses --target ${target} before any read, apply or deploy, since wrangler deploy ships the Worker bound to the remote database`, async () => {
      const root = deployableRoot({
        d1_databases: [
          {
            binding: "DB",
            database_name: "app-db",
            database_id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a",
            preview_database_id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5b",
            migrations_dir: "config/db/migrations",
          },
        ],
      });
      const io = pendingIo(root);

      const result = await drive(io, ["deploy", "--root", root, "--target", target]);

      expect([result.code, result.err]).toEqual([
        1,
        [
          `Error: deploy migrates the database the deployed Worker binds, and --target names ${target} — pass --target remote, or leave --target unset`,
        ],
      ]);
      expect(io.calls).toEqual([]);
    });
  }
});

describe("forge db deploy over a pending drop", () => {
  const DROP = "DROP TABLE IF EXISTS users;";
  const USERS_ROWS = {
    inventory: [{ type: "table", name: "users", tbl_name: "users", sql: "CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT" }],
    columns: [{ tbl: "users", cid: 0, name: "id", type: "INTEGER", notnull: 0, dflt_value: null, pk: 1, hidden: 0 }],
  };

  function droppingIo(root: string, sql: string): FakeDbIo {
    const io = fakeDbIo({
      [join(root, "config", "db", "migrations", "0001_init.sql")]: INIT,
      [join(root, "config", "db", "migrations", "0002_drop.sql")]: sql,
    });
    wire(io, { recorded: [APPLIED], inventory: INVENTORY });
    const staged = () =>
      io.d1Calls.some(
        (call) => call.home === "scratch:compose-analysis" && call.statements.some((statement) => statement.includes(DROP.slice(0, -1))),
      );
    io.d1Rules.push({
      match: (_statement, home) => home.label === "scratch:compose-analysis",
      reply: (statement) => schemaModelRows(statement, staged() ? {} : USERS_ROWS),
    });
    return io;
  }

  for (const flags of [[], ["--check-only"]]) {
    it(`refuses a drop no line approves${flags.length > 0 ? " under --check-only" : ""}, naming it, with no bookmark, apply or deploy`, async () => {
      const root = deployableRoot();
      const io = droppingIo(root, composed(DROP));

      const result = await drive(io, ["deploy", "--root", root, ...flags]);

      expect(result.code).toBe(1);
      expect(result.err.join("\n")).toContain(
        '0002_drop does not match the lines compose wrote for it on app-db (remote), so nothing was applied:\n  drops table "users" — no `-- forge:drops table "users"` line approves it',
      );
      expect(sequence(io)).toEqual([]);
    });
  }

  it("applies a drop its line approves, then deploys", async () => {
    const root = deployableRoot();
    const io = droppingIo(root, composed(`-- forge:drops table "users"\n${DROP}`));

    const result = await drive(io, ["deploy", "--root", root, "--yes"]);

    expect([result.code, result.err, sequence(io)]).toEqual([null, [], ["bookmark", "apply", `deploy -c ${join(root, "wrangler.jsonc")}`]]);
  });

  it("exits 1 under --check-only once the analysis passes an approved drop, applying and deploying nothing", async () => {
    const root = deployableRoot();
    const io = droppingIo(root, composed(`-- forge:drops table "users"\n${DROP}`));

    const result = await drive(io, ["deploy", "--root", root, "--check-only"]);

    expect([result.code, result.out, sequence(io)]).toEqual([1, ["would apply 1 to app-db (remote): 0002_drop"], []]);
    expect(result.err).toEqual(["Error: app-db (remote) has 1 pending migration(s) — deploy applies them before `wrangler deploy`"]);
  });
});

describe("forge db deploy's confirmation", () => {
  const POSTS = composed("CREATE TABLE posts (id INTEGER PRIMARY KEY) STRICT;");
  const REFUSED =
    "Error: Refusing to migrate app-db (remote) without a terminal to confirm at: 0002_posts.\nMigrations are forward-only; the undo is `forge db bookmark restore`. Pass --yes to say so deliberately.";
  const PROMPT = "About to migrate app-db (remote): 0002_posts";

  function postsIo(root: string): FakeDbIo {
    const io = pendingIo(root, { recorded: [APPLIED], inventory: INVENTORY });
    io.files.set(join(root, "config", "db", "migrations", "0002_posts.sql"), POSTS);
    return io;
  }

  const appliedNothing = (io: FakeDbIo) => [sequence(io), io.calls.some((call) => isWrite(call.slice(1)))];

  it("refuses a non-interactive run without --yes before any bookmark, migration or wrangler deploy", async () => {
    const root = deployableRoot();
    const io = postsIo(root);

    const { value: result } = await onStdin(false, "", () => drive(io, ["deploy", "--root", root]));

    expect([result.code, result.err]).toEqual([1, [REFUSED]]);
    expect(appliedNothing(io)).toEqual([[], false]);
  });

  it("asks at a terminal, and applies then deploys on y", async () => {
    const root = deployableRoot();
    const io = postsIo(root);

    const { prompted, value: result } = await onStdin(true, "y", () => drive(io, ["deploy", "--root", root]));

    expect([result.code, result.err, sequence(io)]).toEqual([null, [], ["bookmark", "apply", `deploy -c ${join(root, "wrangler.jsonc")}`]]);
    expect(result.out).toContain(PROMPT);
    expect(prompted).toBe("Continue? [y/N] ");
  });

  it("cancels on n before any bookmark, migration or wrangler deploy", async () => {
    const root = deployableRoot();
    const io = postsIo(root);

    const { value: result } = await onStdin(true, "n", () => drive(io, ["deploy", "--root", root]));

    expect([result.code, result.err]).toEqual([1, ["Error: Migration cancelled; the database is unchanged."]]);
    expect(appliedNothing(io)).toEqual([[], false]);
  });

  it("applies and deploys under --yes without a terminal, printing no prompt", async () => {
    const root = deployableRoot();
    const io = postsIo(root);

    const { prompted, value: result } = await onStdin(false, "", () => drive(io, ["deploy", "--root", root, "--yes"]));

    expect([result.code, result.err, sequence(io)]).toEqual([null, [], ["bookmark", "apply", `deploy -c ${join(root, "wrangler.jsonc")}`]]);
    expect([result.out.filter((line) => line.startsWith("About to")), prompted]).toEqual([[], ""]);
  });

  it("deploys without --yes or a terminal when nothing is pending, asking nothing", async () => {
    const root = deployableRoot();
    const io = pendingIo(root, { recorded: [APPLIED], inventory: INVENTORY });

    const { prompted, value: result } = await onStdin(false, "", () => drive(io, ["deploy", "--root", root]));

    expect([result.code, result.err, sequence(io), prompted]).toEqual([null, [], [`deploy -c ${join(root, "wrangler.jsonc")}`], ""]);
  });

  it("never asks under --check-only, which runs a dry run, even at a terminal that would decline", async () => {
    const root = deployableRoot();
    const io = postsIo(root);

    const { prompted, value: result } = await onStdin(true, "n", () => drive(io, ["deploy", "--root", root, "--check-only"]));

    expect([result.code, result.out, prompted, sequence(io)]).toEqual([1, ["would apply 1 to app-db (remote): 0002_posts"], "", []]);
  });
});
