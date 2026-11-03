import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BASELINE_SEED, BASELINE_VIRTUAL_SEED } from "../src/tooling/db/backup/baseline-seed.fixture";
import { localTransfer } from "../src/tooling/db/backup/local-transfer";
import { realDbIo } from "../src/tooling/db/io";
import type { DbIo, Home } from "../src/tooling/db/types";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const FIXTURE = join(ROOT, "src/tooling/db/backup/baseline-dump.fixture.ts");

const EXPORT_REFUSAL = /D1 Export error: [^\n]*/;

async function seededDatabase(io: DbIo, home: Home, binding: string, seed: readonly string[]) {
  const database = await io.database(home, binding);
  await database.batch(seed.map((sql) => database.prepare(sql)));
  return database;
}

/** The dump and the virtual-table refusal the fixture records, taken through `io.database` from bindings `BASELINE` and `VIRTUAL` of `home`'s config. */
export async function captureD1Baseline(io: DbIo, home: Home): Promise<{ readonly dump: string; readonly refusal: string }> {
  const openStandby = (binding: string) => io.database(home, binding);
  const baseline = await seededDatabase(io, home, "BASELINE", BASELINE_SEED);
  const dump = await new Response((await localTransfer(baseline, openStandby).openExport("")).body).text();
  const virtual = await seededDatabase(io, home, "VIRTUAL", BASELINE_VIRTUAL_SEED);
  const answered = await localTransfer(virtual, openStandby)
    .openExport("")
    .then(
      () => null,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
  const refusal = answered === null ? null : EXPORT_REFUSAL.exec(answered)?.[0];
  if (refusal === null || refusal === undefined)
    throw new Error(`miniflare's export did not refuse the virtual table: ${answered ?? "it answered a dump"}`);
  return { dump, refusal };
}

/** The fixture module's text for a capture. */
export function renderD1Baseline(captured: { readonly dump: string; readonly refusal: string }): string {
  return [
    "/** miniflare's export of `BASELINE_SEED`, as `localTransfer` reads it through `io.database`. */",
    `export const BASELINE_DUMP: string = ${JSON.stringify(captured.dump)};`,
    "",
    "/** The `D1 Export error` line miniflare's export answers for `BASELINE_VIRTUAL_SEED`. */",
    `export const BASELINE_VIRTUAL_REFUSAL: string = ${JSON.stringify(captured.refusal)};`,
    "",
  ].join("\n");
}

if (import.meta.main) {
  const dir = mkdtempSync(join(tmpdir(), "forge-d1-baseline-"));
  const io = realDbIo();
  try {
    const config = {
      name: "baseline",
      compatibility_date: "2026-01-01",
      d1_databases: [
        { binding: "BASELINE", database_name: "baseline", database_id: "baseline" },
        { binding: "VIRTUAL", database_name: "virtual", database_id: "virtual" },
      ],
    };
    writeFileSync(join(dir, "wrangler.jsonc"), `${JSON.stringify(config, null, 2)}\n`);
    const home: Home = {
      label: "baseline",
      database: "baseline",
      binding: "BASELINE",
      dir,
      configPath: join(dir, "wrangler.jsonc"),
      persistTo: join(dir, "state"),
      place: "local",
      env: null,
      databaseId: null,
      auth: null,
      synthesized: true,
    };
    writeFileSync(FIXTURE, renderD1Baseline(await captureD1Baseline(io, home)));
    console.log(`wrote ${FIXTURE}`);
  } finally {
    await io.closeD1(null);
    rmSync(dir, { recursive: true, force: true });
  }
}
