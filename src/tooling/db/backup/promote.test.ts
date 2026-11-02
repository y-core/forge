import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import type { D1RestoreReport } from "../../../storage/backup/types";
import type { WranglerConfig } from "../../cf/types";
import { execute } from "../../cli/execute";
import { PLAIN } from "../../term/color";
import { createDbCommands } from "../commands";
import { bufferedIO, cfEnvelope, fakeDbIo, onStdin, REMOTE_ARGS } from "../db.fixture";
import { appHome } from "../home";
import type { DbConfig, DbRunContext, FakeDbIo } from "../types";
import { executePromotion } from "./promote";
import type { PromotionPlan } from "./types";

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const OLD_ID = "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a";

const CONFIG = `{
  // The app's own Worker.
  "name": "app",
  "compatibility_date": "2026-01-01",
  "d1_databases": [
    { "binding": "LOGS", "database_name": "log-db", "database_id": "1f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a" },
    {
      "binding": "DB",
      "database_name": "app-db", // the live database
      "database_id": "${OLD_ID}",
      "migrations_dir": "config/db/migrations",
    },
  ],
  "workflows": [{ "name": "d1-restore", "binding": "D1_RESTORE", "class_name": "D1Restore" }],
}
`;

const REPORT: D1RestoreReport = {
  databaseId: "9f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a",
  name: "app-db-restore-1",
  key: `d1-backups/${OLD_ID}/2026-11-02T03:00:00.000Z-B1.sql`,
  bookmark: "B9",
  queries: 4,
  mismatches: [],
};

const INSTANCE = "https://api.cloudflare.com/client/v4/accounts/acct/workflows/d1-restore/instances/i-7";

function appRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-db-promote-"));
  roots.push(root);
  writeFileSync(join(root, "wrangler.jsonc"), CONFIG);
  return root;
}

/** A fake io over the real config file, so the edit lands on disk where the assertion reads it. */
function diskIo(instance: unknown, renames: [string, string][] = []): FakeDbIo {
  const io = fakeDbIo();
  io.readText = (path) => readFileSync(path, "utf-8");
  io.writeText = (path, text) => writeFileSync(path, text);
  io.rename = (from, to) => {
    renames.push([from, to]);
    renameSync(from, to);
  };
  io.restRules.push({ match: (url) => url === INSTANCE, reply: () => cfEnvelope(instance) });
  return io;
}

async function runCli(io: FakeDbIo, argv: string[]): Promise<{ out: string[]; err: string[]; code: number | null }> {
  const buffer = bufferedIO();
  try {
    await execute(createDbCommands({ io }), argv, buffer);
  } catch {
    // `bufferedIO().exit` throws so a failing run stops here rather than ending the process.
  }
  return buffer;
}

const REMOTE = ["--target", "remote", "--db", "DB", ...REMOTE_ARGS];

describe("forge db promote", () => {
  it("points the binding at the restored database the instance reports, changing nothing else in the file", async () => {
    const root = appRoot();
    const renames: [string, string][] = [];
    const buffer = await runCli(diskIo({ status: "complete", output: REPORT }, renames), [
      "promote",
      "--root",
      root,
      ...REMOTE,
      "--instance",
      "i-7",
      "--yes",
    ]);

    expect(buffer.err).toEqual([]);
    expect(readFileSync(join(root, "wrangler.jsonc"), "utf-8")).toBe(
      CONFIG.replace(`"database_name": "app-db", // the live database`, `"database_name": "app-db-restore-1", // the live database`).replace(
        `"database_id": "${OLD_ID}"`,
        `"database_id": "${REPORT.databaseId}"`,
      ),
    );
    expect(renames).toEqual([[`${join(root, "wrangler.jsonc")}.${process.pid}.promote`, join(root, "wrangler.jsonc")]]);
    expect(buffer.out).toEqual([
      `✓ DB names app-db-restore-1 (${REPORT.databaseId}) in ${join(root, "wrangler.jsonc")}`,
      `  app-db (${OLD_ID}) is kept as it was — swap back with: forge db promote --target remote --db DB --database-id ${OLD_ID} --database-name app-db`,
      "  the deployed app still reads the old database until you deploy",
    ]);
  });

  it("refuses a restore whose report holds a mismatch, writing nothing", async () => {
    const root = appRoot();
    const report = { ...REPORT, mismatches: ["notes holds 1 rows, but the dump holds 2"] };
    const buffer = await runCli(diskIo({ status: "complete", output: report }), [
      "promote",
      "--root",
      root,
      ...REMOTE,
      "--instance",
      "i-7",
      "--yes",
    ]);

    expect(buffer.err.join("\n")).toContain(
      "app-db-restore-1 differs from the dump it was restored from, so it is not promoted:\n  notes holds 1 rows",
    );
    expect(readFileSync(join(root, "wrangler.jsonc"), "utf-8")).toBe(CONFIG);
  });

  it("refuses, writing nothing, a restore of another database's dump and a report whose id is not a D1 id", async () => {
    for (const [report, message] of [
      [
        { ...REPORT, key: "d1-backups/1f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a/2026-11-02T03:00:00.000Z-B1.sql" },
        "was restored from a dump of database 1f8c2a5e",
      ],
      [{ ...REPORT, databaseId: "x; rm -rf /" }, `names database id "x; rm -rf /", which is not a D1 id`],
      [{ ...REPORT, name: "a b" }, `names database "a b", which is not a D1 database name`],
    ] as const) {
      const root = appRoot();
      const buffer = await runCli(diskIo({ status: "complete", output: report }), [
        "promote",
        "--root",
        root,
        ...REMOTE,
        "--instance",
        "i-7",
        "--yes",
      ]);
      expect([buffer.err.join("\n").includes(message), readFileSync(join(root, "wrangler.jsonc"), "utf-8")]).toEqual([true, CONFIG]);
    }
  });

  it("refuses an instance that has not completed, or returned no report", async () => {
    for (const [instance, message] of [
      [{ status: "running" }, "d1-restore instance i-7 is running, so it restored nothing to promote"],
      [{ status: "complete", output: { key: "k" } }, "d1-restore instance i-7 returned no runD1Restore report"],
    ] as const) {
      const buffer = await runCli(diskIo(instance), ["promote", "--root", appRoot(), ...REMOTE, "--instance", "i-7", "--yes"]);
      expect(buffer.err.join("\n")).toContain(message);
    }
  });

  it("writes nothing when the confirmation is declined", async () => {
    const root = appRoot();
    const io = diskIo({ status: "complete", output: REPORT });
    await onStdin(true, "n", () => runCli(io, ["promote", "--root", root, ...REMOTE, "--instance", "i-7"]));
    expect(readFileSync(join(root, "wrangler.jsonc"), "utf-8")).toBe(CONFIG);
  });

  it("swaps back to a named database without a report", async () => {
    const root = appRoot();
    const argv = [
      "promote",
      "--root",
      root,
      ...REMOTE,
      "--database-id",
      "2f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a",
      "--database-name",
      "app-db-old",
      "--yes",
    ];
    const buffer = await runCli(diskIo(null), argv);
    expect(buffer.err).toEqual([]);
    expect(readFileSync(join(root, "wrangler.jsonc"), "utf-8")).toContain(`"database_id": "2f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a"`);
  });

  it("refuses a local target, both sources or neither, half an explicit database, and the database the binding already names", async () => {
    for (const [argv, message] of [
      [["--db", "DB", "--instance", "i-7"], "local has no binding to promote onto"],
      [[...REMOTE], "promote takes --instance <restore instance id>, or --database-id and --database-name"],
      [[...REMOTE, "--instance", "i-7", "--database-id", "x"], "promote takes --instance <restore instance id>"],
      [[...REMOTE, "--database-id", "x"], "--database-id and --database-name go together"],
      [[...REMOTE, "--database-id", "x", "--database-name", "y"], `names database id "x", which is not a D1 id`],
      [[...REMOTE, "--database-id", OLD_ID, "--database-name", "app-db"], `DB already points at app-db (${OLD_ID})`],
    ] as const) {
      const root = appRoot();
      const buffer = await runCli(diskIo(null), ["promote", "--root", root, ...argv, "--yes"]);
      expect([buffer.err.join("\n").includes(message), readFileSync(join(root, "wrangler.jsonc"), "utf-8")]).toEqual([true, CONFIG]);
    }
  });

  it("refuses, leaving the file untouched, an edit that would not point the binding at the promoted database", () => {
    const io = fakeDbIo();
    const configPath = "/app/wrangler.jsonc";
    io.writeText(configPath, CONFIG);
    const config: DbConfig = {
      root: "/app",
      configPath,
      config: { name: "app", compatibility_date: "2026-01-01" } as WranglerConfig,
      env: null,
      entry: { binding: "DB", databaseName: "app-db", databaseId: OLD_ID, previewDatabaseId: null },
      target: { place: "remote", database: null },
    };
    const run: DbRunContext = { config, home: appHome(config), io, host: {}, json: false, yes: true, style: PLAIN, print: () => {} };
    const to = { databaseId: REPORT.databaseId, name: REPORT.name };
    const plan: PromotionPlan = {
      configPath,
      binding: "DB",
      env: null,
      from: { databaseId: OLD_ID, name: "app-db" },
      to,
      edits: [
        { path: ["d1_databases", 0, "database_id"], value: to.databaseId },
        { path: ["d1_databases", 0, "database_name"], value: to.name },
      ],
    };

    expect(() => executePromotion(run, plan)).toThrow(`would not point DB at ${to.name} (${to.databaseId}), so it is left as it was`);
    expect([io.readText(configPath), io.exists(`${configPath}.${process.pid}.promote`)]).toEqual([CONFIG, false]);
  });
});
