import { describe, expect, it } from "bun:test";

import { BASELINE_SEED, BASELINE_VIRTUAL_SEED } from "../src/tooling/db/backup/baseline-seed.fixture";
import type { BackupDatabase, BackupStatement } from "../src/tooling/db/backup/types";
import { fakeDbIo } from "../src/tooling/db/db.fixture";
import type { Home } from "../src/tooling/db/types";
import { captureD1Baseline, renderD1Baseline } from "./d1-baseline";

const HOME: Home = {
  label: "baseline",
  database: "baseline",
  binding: "BASELINE",
  dir: "/tmp/baseline",
  configPath: "/tmp/baseline/wrangler.jsonc",
  persistTo: "/tmp/baseline/state",
  place: "local",
  env: null,
  databaseId: null,
  auth: null,
  synthesized: true,
};

const STACKED_REFUSAL =
  "D1_ERROR: export failed: D1 Export error: cannot export databases with Virtual Tables (fts5)\n    at dumpSql (worker.js:1:1)";

function recordingDatabase(exported: () => Promise<unknown[][]>): BackupDatabase & { readonly seeded: string[][] } {
  const seeded: string[][] = [];
  const sql = new WeakMap<BackupStatement, string>();
  return {
    seeded,
    prepare(query) {
      const statement: BackupStatement = { all: async () => ({ results: [] }), bind: () => ({ raw: exported }) };
      sql.set(statement, query);
      return statement;
    },
    async batch(statements) {
      seeded.push(statements.map((statement) => sql.get(statement) ?? ""));
      return [];
    },
  };
}

function bindings(virtualExport: () => Promise<unknown[][]>) {
  const io = fakeDbIo();
  const baseline = recordingDatabase(async () => [["A;", "B;"]]);
  const virtual = recordingDatabase(virtualExport);
  io.databases.set("BASELINE", baseline);
  io.databases.set("VIRTUAL", virtual);
  return { io, baseline, virtual };
}

describe("captureD1Baseline()", () => {
  it("seeds each binding through `database()` and answers the dump and the refusal line, never its stack", async () => {
    const { io, baseline, virtual } = bindings(() => Promise.reject(new Error(STACKED_REFUSAL)));

    const captured = await captureD1Baseline(io, HOME);

    expect(captured).toEqual({ dump: "A;\nB;", refusal: "D1 Export error: cannot export databases with Virtual Tables (fts5)" });
    expect(baseline.seeded).toEqual([[...BASELINE_SEED]]);
    expect(virtual.seeded).toEqual([[...BASELINE_VIRTUAL_SEED]]);
  });

  const unrefused: [string, () => Promise<unknown[][]>][] = [
    ["answers a dump", () => Promise.resolve([["C;"]])],
    ["refuses for another reason", () => Promise.reject(new Error("D1_ERROR: no such table: docs"))],
  ];
  for (const [answer, virtualExport] of unrefused) {
    it(`throws when the virtual binding's export ${answer} instead of a D1 Export error`, async () => {
      const { io } = bindings(virtualExport);

      await expect(captureD1Baseline(io, HOME)).rejects.toThrow("miniflare's export did not refuse the virtual table");
    });
  }
});

describe("renderD1Baseline()", () => {
  it("emits both constants with their values as JSON string literals", () => {
    const text = renderD1Baseline({ dump: "A;\nINSERT 'x';", refusal: 'D1 Export error: "fts5"' });

    expect(text).toContain(`export const BASELINE_DUMP: string = ${JSON.stringify("A;\nINSERT 'x';")};`);
    expect(text).toContain(`export const BASELINE_VIRTUAL_REFUSAL: string = ${JSON.stringify('D1 Export error: "fts5"')};`);
  });
});
