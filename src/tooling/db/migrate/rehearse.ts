import { join, resolve } from "node:path";

import { CliError } from "../../cli/errors";
import { resolveBackupsDir, restoreScratch } from "../backup/backup";
import { findVerifiedBackup } from "../backup/reset";
import { readBackupManifest } from "../backup/restore";
import { clearLocalState } from "../home";
import { isRemotePlace } from "../target";
import type { DbRunContext, Home, Migration } from "../types";
import { queryRowsIfTable } from "../wrangler";
import { applyMigrations } from "./applier";
import { RECORDED_CHECKSUM_SELECT, toRecordedChecksums } from "./checksum";
import type { RehearsalOutcome } from "./types";

/** The artifact a rehearsal restores: the one named, else the most recent verified backup of this database. */
function selectArtifact(run: DbRunContext, artifact: string | undefined): string {
  if (artifact !== undefined) return resolve(run.config.root, artifact);
  const found = findVerifiedBackup(run, run.home.database);
  if (found === null) {
    throw new CliError(
      "invalid-args",
      `--rehearse needs an artifact and no verified backup of ${run.home.database} exists under ${resolveBackupsDir(run)} — run \`forge db backup\` first, or name one with --artifact`,
    );
  }
  return join(resolveBackupsDir(run), found);
}

/** Which pending migration wrangler stopped on: the first one the rehearsal did not record. */
function failedMigration(run: DbRunContext, home: Home, pending: readonly Migration[]): string | null {
  const recorded = toRecordedChecksums(queryRowsIfTable(run.io, home, RECORDED_CHECKSUM_SELECT) ?? []);
  const applied = new Set(recorded.map((record) => record.appliedName));
  return pending.find((migration) => !applied.has(migration.name))?.name ?? null;
}

/** Applies the pending migrations to a database restored from a backup artifact — the one check that runs them over rows — and reports. @internal */
export function rehearseMigrations(
  run: DbRunContext,
  pending: readonly Migration[],
  artifact: string | undefined,
  applied: readonly string[],
): RehearsalOutcome {
  if (isRemotePlace(run.config.target.place)) {
    throw new CliError(
      "invalid-args",
      `--rehearse restores an artifact into a local scratch database, and ${run.config.target.place} is deployed — rehearse the same migrations against \`--target local\` or \`--target standby\`, then apply here`,
    );
  }

  const directory = selectArtifact(run, artifact);
  const manifest = readBackupManifest(run, directory);
  if (manifest.database.name !== run.home.database) {
    throw new CliError("invalid-args", `${directory} was taken from ${manifest.database.name} and this target is ${run.home.database}`);
  }
  const takenNames = manifest.schema.migrations;
  const taken = new Set(takenNames);
  const here = new Set(applied);
  const missing = applied.filter((name) => !taken.has(name));
  const extra = takenNames.filter((name) => !here.has(name));
  if (missing.length > 0 || extra.length > 0) {
    throw new CliError(
      "invalid-args",
      `${directory} was taken with [${takenNames.join(", ")}] applied and this target has [${applied.join(", ")}] (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}) — a rehearsal needs an artifact of this target as it stands; run \`forge db backup\` first, or name one with --artifact`,
    );
  }
  const rows = manifest.tables.reduce((total, table) => total + table.rows, 0);

  const scratch = restoreScratch(run, directory, "rehearse", "migrations");
  try {
    applyMigrations(run, scratch, pending, { label: "rehearse-apply", record: true });
  } catch (error) {
    const failed = failedMigration(run, scratch, pending);
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliError(
      "invalid-args",
      `the rehearsal failed${failed === null ? "" : ` on ${failed}`} — these migrations do not apply to the ${rows} row(s) ${directory} holds, and the target is unchanged:\n${detail}`,
    );
  }
  clearLocalState(run.io, scratch);
  return { artifact: directory, rows, applied: pending.map((migration) => migration.name) };
}
