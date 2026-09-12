import { renderTable } from "../../cf/table";
import type { Colorize } from "../../term/types";
import type { StatusReport, StatusRow } from "../types";
import type { StatusRowsRequest } from "./types";

/** One line per migration on disk, then one per applied name that is no longer there. @internal */
export function statusRows(request: StatusRowsRequest): StatusRow[] {
  const appliedAt = new Map(request.applied.map((a) => [a.name, a.appliedAt]));
  const mismatched = new Set(request.checksums.mismatched);
  const unrecorded = new Set(request.checksums.unrecorded);
  const onDisk = new Set(request.discovered.map((m) => m.name));

  const rows = request.discovered.map<StatusRow>((migration) => {
    const row = { name: migration.name };
    if (!appliedAt.has(migration.name)) return { ...row, state: "pending", appliedAt: null };
    const at = appliedAt.get(migration.name) ?? null;
    if (mismatched.has(migration.name)) return { ...row, state: "mismatch", appliedAt: at };
    if (unrecorded.has(migration.name)) return { ...row, state: "unrecorded", appliedAt: at };
    return { ...row, state: "applied", appliedAt: at };
  });

  const drift = request.applied
    .filter((a) => !onDisk.has(a.name))
    .map<StatusRow>((a) => ({ name: a.name, state: "drift", appliedAt: a.appliedAt }));
  return [...rows, ...drift];
}

/** `1` when anything a reader would have to act on is outstanding, `0` when the database is in step. @internal */
export function migrationStatusExitCode(report: StatusReport): 0 | 1 {
  if (report.pending > 0) return 1;
  if (report.checksums.mismatched.length > 0 || report.checksums.unrecorded.length > 0 || report.checksums.orphaned.length > 0) return 1;
  if (report.drift.length > 0) return 1;
  if (report.fingerprint.recorded !== null && !report.fingerprint.matches) return 1;
  return 0;
}

function stateCell(state: StatusRow["state"], style: Colorize): string {
  if (state === "applied") return style.green(state);
  if (state === "pending") return style.cyan(state);
  return style.yellow(state);
}

/** What every state other than `applied` and `pending` means, and what to do about it. */
function anomalies(report: StatusReport): string[] {
  const notes: string[] = [];
  if (report.pending > 0) notes.push(`${report.pending} pending — apply with \`forge db migrate\``);
  if (report.checksums.mismatched.length > 0) notes.push(`edited since it was applied: ${report.checksums.mismatched.join(", ")}`);
  if (report.checksums.unrecorded.length > 0) notes.push(`applied without a forge checksum: ${report.checksums.unrecorded.join(", ")}`);
  if (report.checksums.orphaned.length > 0)
    notes.push(`recorded by forge but absent from the migrations table: ${report.checksums.orphaned.join(", ")}`);
  if (report.drift.length > 0) notes.push(`applied but no longer on disk: ${report.drift.join(", ")}`);
  if (report.fingerprint.recorded !== null && !report.fingerprint.matches) {
    notes.push(`schema fingerprint ${report.fingerprint.actual} does not match the recorded ${report.fingerprint.recorded}`);
  }
  return notes;
}

/** Renders a status report as the table and the notes `forge db migrate status` prints. @internal */
export function formatStatus(report: StatusReport, style: Colorize): string {
  const heading = `${style.bold(report.database)} (${report.target})`;
  const body =
    report.rows.length === 0
      ? "no migrations on disk and none recorded"
      : renderTable(report.rows.map((row) => ({ Migration: row.name, State: stateCell(row.state, style), Applied: row.appliedAt ?? "" })));
  const notes = anomalies(report);
  return [heading, body, ...(notes.length === 0 ? ["up to date"] : notes)].join("\n");
}
