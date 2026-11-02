import { compareWithSidecar } from "../../../storage/backup/restore";
import { CliError } from "../../cli/errors";
import { loadLocalDump, readLocalDump, resolveDumpSource } from "../backup/dumps";
import { queryRows, queryRowsIfTable } from "../d1";
import { clearLocalState, scratchHome } from "../home";
import { localScratchConfig } from "../schema/scratch";
import { isRemotePlace } from "../target";
import type { DbRunContext, Home, Migration } from "../types";
import { applyMigrations } from "./applier";
import { RECORDED_CHECKSUM_SELECT, toRecordedChecksums } from "./checksum";
import { ensureCompanionTables } from "./companions";
import type { MigrateOptions, RehearsalOutcome } from "./types";

/** Which pending migration the rehearsal stopped on: the first one it did not record. */
async function failedMigration(run: DbRunContext, home: Home, pending: readonly Migration[]): Promise<string | null> {
  const recorded = toRecordedChecksums((await queryRowsIfTable(run.io, home, RECORDED_CHECKSUM_SELECT)) ?? []);
  const applied = new Set(recorded.map((record) => record.appliedName));
  return pending.find((migration) => !applied.has(migration.name))?.name ?? null;
}

/** Applies the pending migrations to a scratch database restored from a local R2 dump — the one check that runs them over rows — and reports. @internal */
export async function rehearseMigrations(
  run: DbRunContext,
  pending: readonly Migration[],
  options: Pick<MigrateOptions, "dump" | "bucket" | "prefix">,
  applied: readonly string[],
): Promise<RehearsalOutcome> {
  if (isRemotePlace(run.config.target.place)) {
    throw new CliError(
      "invalid-args",
      `--rehearse restores a dump into a local scratch database, and ${run.config.target.place} is deployed — rehearse the same migrations against \`--target local\` or \`--target standby\`, then apply here`,
    );
  }

  const source = resolveDumpSource(run, { bucket: options.bucket, prefix: options.prefix });
  const sidecar = await readLocalDump(run, source, options.dump);
  const head = applied.at(-1) ?? null;
  if (sidecar.migrationHead !== head) {
    throw new CliError(
      "invalid-args",
      `${sidecar.key} was taken at migration ${sidecar.migrationHead ?? "none"} and this target is at ${head ?? "none"} — a rehearsal needs a dump of this target as it stands; run \`forge db backup\` first, or name one with --dump`,
    );
  }
  const rows = Object.values(sidecar.rows).reduce((total, count) => total + count, 0);

  const scratch = scratchHome(localScratchConfig(run.config), run.io, "rehearse", `${run.home.database}-rehearse`);
  await clearLocalState(run.io, scratch);
  await loadLocalDump(run, source, sidecar, scratch);
  const mismatches = await compareWithSidecar((sql) => queryRows(run.io, scratch, sql), sidecar);
  if (mismatches.length > 0) {
    throw new CliError(
      "invalid-args",
      `${sidecar.key} did not restore to what its sidecar records, so it cannot rehearse:\n  ${mismatches.join("\n  ")}`,
    );
  }
  // A dump of a database no migration has run on carries no history table for the recorded apply to write to.
  await ensureCompanionTables(run.io, scratch);
  try {
    await applyMigrations(run, scratch, pending, { label: "rehearse-apply", record: true });
  } catch (error) {
    const failed = await failedMigration(run, scratch, pending);
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliError(
      "invalid-args",
      `the rehearsal failed${failed === null ? "" : ` on ${failed}`} — these migrations do not apply to the ${rows} row(s) ${sidecar.key} holds, and the target is unchanged:\n${detail}`,
    );
  }
  await clearLocalState(run.io, scratch);
  return { dump: sidecar.key, rows, applied: pending.map((migration) => migration.name) };
}
