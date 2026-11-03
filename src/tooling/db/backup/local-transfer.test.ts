import { describe, expect, it } from "bun:test";

import { CliError } from "../../cli/errors";
import { changedCells, fakeDatabase, stubDatabase } from "./backup.fixture";
import { BASELINE_DUMP } from "./baseline-dump.fixture";
import { BASELINE_SEED } from "./baseline-seed.fixture";
import { takeD1Census } from "./census";
import { localTransfer } from "./local-transfer";
import { meterDump } from "./meter";
import { compareWithSidecar } from "./restore";
import type { BackupDatabase, BackupStatement } from "./types";

const AT = new Date("2026-11-02T03:00:00Z");

const noStandby = (binding: string): Promise<BackupDatabase> => Promise.reject(new Error(`no standby ${binding}`));

describe("localTransfer() — the export", () => {
  it("names the dump by the instant it is given", async () => {
    expect(await localTransfer(stubDatabase([]), noStandby).startExport(AT)).toBe(`local-${AT.getTime()}`);
  });

  it("streams the dumper's statements joined by newlines, announcing their byte length", async () => {
    const source = stubDatabase([], [["PRAGMA defer_foreign_keys=TRUE;", 'INSERT INTO "t" ("a") VALUES(\'é\');']]);
    const opened = await localTransfer(source, noStandby).openExport("B");
    const text = await new Response(opened.body).text();
    expect([text, opened.length]).toEqual([
      'PRAGMA defer_foreign_keys=TRUE;\nINSERT INTO "t" ("a") VALUES(\'é\');',
      new TextEncoder().encode(text).byteLength,
    ]);
  });

  it("refuses a binding that does not answer miniflare's export", async () => {
    for (const dump of [[], [[1, 2]], [["ok", 3]]]) {
      const error = await localTransfer(stubDatabase([], dump), noStandby)
        .openExport("B")
        .catch((thrown: unknown) => thrown);
      expect([error instanceof CliError, (error as CliError).kind]).toEqual([true, "external"]);
    }
  });
});

describe("localTransfer() — the import", () => {
  it("loads every statement of the dump into the standby in one batch, answering their count", async () => {
    const standby = fakeDatabase();
    const transfer = localTransfer(stubDatabase([]), async () => standby);
    const dump = 'CREATE TABLE "t" (a TEXT);\nINSERT INTO "t" ("a") VALUES(\'x;y\');\nINSERT INTO "t" ("a") VALUES(\'z\');';
    const target = await transfer.openTarget({ standby: "STANDBY" });
    const state = await transfer.startImport(target, { body: new Response(dump).body ?? new ReadableStream(), size: 0, md5: "" });

    expect([target, state, standby.batches]).toEqual([
      { databaseId: "STANDBY", name: "STANDBY" },
      { status: "complete", bookmark: null, queries: 3 },
      [3],
    ]);
    expect(await transfer.query(target, "SELECT a FROM t ORDER BY a")).toEqual([{ a: "x;y" }, { a: "z" }]);
  });

  it("refuses a fresh target, which a local database cannot create", async () => {
    const error = await localTransfer(stubDatabase([]), noStandby)
      .openTarget({ fresh: "new" })
      .catch((thrown: unknown) => thrown);
    expect([error instanceof CliError, (error as CliError).kind]).toEqual([true, "invalid-args"]);
  });

  it("refuses a standby whose binding cannot be opened with the very error openStandby threw", async () => {
    const refused = new Error("no binding STANDBY");
    const error = await localTransfer(stubDatabase([]), () => Promise.reject(refused))
      .openTarget({ standby: "STANDBY" })
      .catch((thrown: unknown) => thrown);
    expect(error).toBe(refused);
  });

  it("answers a poll as failed, since a local import finishes where it starts", async () => {
    const state = await localTransfer(stubDatabase([]), noStandby).pollImport({ databaseId: "STANDBY", name: "STANDBY" }, "B");
    expect(state.status).toBe("error");
  });
});

describe("localTransfer() — a round trip of miniflare's baseline dump", () => {
  it("round-trips miniflare's own dump of the baseline seed into an empty standby, the census and every row count matching", async () => {
    const seed = fakeDatabase(BASELINE_SEED.join(";\n"));
    const exported: BackupStatement = { all: async () => ({ results: [] }), bind: () => ({ raw: async () => [BASELINE_DUMP.split("\n")] }) };
    const source: BackupDatabase = {
      batch: seed.batch,
      prepare: (query) => (query === "PRAGMA miniflare_d1_export(?,?,?);" ? exported : seed.prepare(query)),
    };
    const standby = fakeDatabase();
    const transfer = localTransfer(source, async (binding) => (binding === "STANDBY" ? standby : Promise.reject(new Error(binding))));

    const census = await takeD1Census(source);
    const meter = meterDump((await transfer.openExport(await transfer.startExport(AT))).body, 60_000);
    const dump = await new Response(meter.body).text();
    const measured = meter.measure();
    const sidecar = { ...census, ...measured, key: "k", databaseId: "db", bookmark: "b", takenAt: AT.toISOString() };
    const target = await transfer.openTarget({ standby: "STANDBY" });
    await transfer.startImport(target, { body: new Response(dump).body ?? new ReadableStream(), size: measured.size, md5: measured.md5 });
    const seedInserts = (table: string) => BASELINE_SEED.filter((sql) => sql.startsWith(`INSERT INTO ${table} `)).length;

    expect(await compareWithSidecar((sql) => transfer.query(target, sql), sidecar)).toEqual([]);
    expect(measured.rows).toEqual({ _forge_migrations: seedInserts("_forge_migrations"), cases: seedInserts("cases") });
    expect(census.hazards).toEqual([
      { table: "cases", column: "body", kind: "escape", count: 1 },
      { table: "cases", column: "wide", kind: "integer", count: 1 },
      { table: "cases", column: "loose", kind: "real", count: 1 },
    ]);
    expect([changedCells(seed.sqlite, standby.sqlite, "cases"), changedCells(seed.sqlite, standby.sqlite, "_forge_migrations")]).toEqual([
      Object.fromEntries(census.hazards.map((hazard) => [hazard.column, hazard.count])),
      {},
    ]);
  });
});
