import { renderTable } from "../../cf/table";
import type { Colorize } from "../../term/types";
import type { StatusReport, StatusRow } from "../types";
import type { StatusRowsRequest } from "./types";

/** One line per migration on disk, then one per applied name that is no longer there. @internal */
export function statusRows(request: StatusRowsRequest): StatusRow[] {
  const appliedAt = new Map(request.applied.map((a) => [a.name, a.appliedAt]));
  const mismatched = new Set(request.mismatched);
  const onDisk = new Set(request.discovered.map((m) => m.name));

  const rows = request.discovered.map<StatusRow>((migration) => {
    const row = { name: migration.name };
    if (!appliedAt.has(migration.name)) return { ...row, state: "pending", appliedAt: null };
    const at = appliedAt.get(migration.name) ?? null;
    if (mismatched.has(migration.name)) return { ...row, state: "mismatch", appliedAt: at };
    return { ...row, state: "applied", appliedAt: at };
  });

  const drift = request.applied
    .filter((a) => !onDisk.has(a.name))
    .map<StatusRow>((a) => ({ name: a.name, state: "drift", appliedAt: a.appliedAt }));
  return [...rows, ...drift];
}

/** Applied migrations, and no fingerprint certified over them — where a restore lands, and an apply whose certifying write failed. @internal */
export function uncertifiedSchema(report: StatusReport): boolean {
  return report.fingerprint.recorded === null && report.rows.some((row) => row.state !== "pending");
}

/** `1` when anything a reader would have to act on is outstanding, `0` when the database is in step. @internal */
export function migrationStatusExitCode(report: StatusReport): 0 | 1 {
  if (report.pending > 0) return 1;
  if (report.checksums.mismatched.length > 0) return 1;
  if (report.drift.length > 0) return 1;
  if (report.fingerprint.recorded !== null && !report.fingerprint.matches) return 1;
  // The note this pairs with names one remedy, `forge db migrate` — so the code says outstanding too,
  // rather than leaving a line that asks for action under an exit CI reads as nothing to do.
  if (uncertifiedSchema(report)) return 1;
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
  if (report.drift.length > 0) notes.push(`applied but no longer on disk: ${report.drift.join(", ")}`);
  if (uncertifiedSchema(report)) {
    notes.push("applied, but no schema fingerprint was ever certified — the next apply certifies one");
  }
  if (report.fingerprint.recorded !== null && !report.fingerprint.matches) {
    notes.push(`schema fingerprint ${report.fingerprint.actual} does not match the certified ${report.fingerprint.recorded}`);
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
