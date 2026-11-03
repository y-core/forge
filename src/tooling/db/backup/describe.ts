import type { D1BackupHazard, D1BackupSidecar, D1RestoreReport } from "../../../storage/backup/types";

function describeHazard(hazard: D1BackupHazard): string {
  const at = hazard.column === null ? hazard.table : `${hazard.table}.${hazard.column}`;
  switch (hazard.kind) {
    case "escape":
      return `${at}: ${hazard.count} text value(s) holding a \\n or \\r escape beside a real newline or carriage return, which D1's dumper doubles`;
    case "integer":
      return `${at}: ${hazard.count} integer(s) past ±2^53, which D1's dumper rounds`;
    case "real":
      return `${at}: ${hazard.count} REAL(s) with no fraction in a column without REAL affinity, which D1's dumper restores as INTEGER`;
    case "unscanned":
      return `${at}: not scanned for hazards, because the scan failed`;
  }
}

/** The lines `forge db backup` prints for a stored dump, its hazards last. @internal */
export function describeSidecar(sidecar: D1BackupSidecar): string[] {
  const rows = Object.entries(sidecar.rows).map(([table, count]) => `${table} ${count}`);
  const lines = [
    `✓ ${sidecar.key}`,
    `  ${sidecar.size} bytes at bookmark ${sidecar.bookmark}, migration head ${sidecar.migrationHead ?? "none"}`,
    `  rows: ${rows.join(", ") || "none"}`,
  ];
  if (sidecar.hazards.length === 0) return lines;
  const timeTravel = sidecar.bookmark.startsWith("local-")
    ? "local D1 keeps no Time Travel, so no exact restore exists"
    : `forge db bookmark restore --bookmark ${sidecar.bookmark} restores them exactly while Time Travel keeps that bookmark`;
  return [...lines, ...sidecar.hazards.map((hazard) => `  ! ${describeHazard(hazard)}`), `  ! the dump will not reproduce these — ${timeTravel}`];
}

/** The lines `forge db restore --from` prints for a restore, each mismatch last. @internal */
export function describeRestore(report: D1RestoreReport): string[] {
  const head = `${report.key} into ${report.name} (${report.databaseId})${report.bookmark === null ? "" : ` at bookmark ${report.bookmark}`}`;
  if (report.mismatches.length === 0) return [`✓ restored ${head}`, "  it holds what the dump's sidecar recorded"];
  return [`✗ restored ${head}, but it differs from the dump's sidecar:`, ...report.mismatches.map((mismatch) => `  ! ${mismatch}`)];
}
