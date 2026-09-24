import { quoteSqlLiteral } from "../sql";
import type { Migration, RecordedChecksum } from "../types";

/** Every migration forge recorded, in the order it applied them. @internal */
export const RECORDED_CHECKSUM_SELECT = "SELECT name, sha256, applied_at, fingerprint FROM _forge_migrations ORDER BY id";

/** The statement that records one migration as applied, which a duplicate name is refused by. @internal */
export function recordMigrationSql(migration: Migration, appliedAtMs: number): string {
  const values = [migration.name, migration.sha256].map(quoteSqlLiteral).join(", ");
  return `INSERT INTO _forge_migrations (name, sha256, applied_at) VALUES (${values}, ${quoteSqlLiteral(appliedAtMs)});`;
}

/** The statement that certifies the schema the last applied migration produced. @internal */
export function certifyFingerprintSql(fingerprint: string): string {
  return `UPDATE _forge_migrations SET fingerprint = ${quoteSqlLiteral(fingerprint)} WHERE id = (SELECT id FROM _forge_migrations ORDER BY id DESC LIMIT 1);`;
}

/** Reads `RECORDED_CHECKSUM_SELECT` rows into recorded checksums. @internal */
export function toRecordedChecksums(rows: readonly Record<string, unknown>[]): RecordedChecksum[] {
  return rows.map((row) => ({
    appliedName: String(row.name ?? ""),
    sha256: String(row.sha256 ?? ""),
    appliedAt: Number(row.applied_at ?? 0),
    fingerprint: row.fingerprint === null || row.fingerprint === undefined ? null : String(row.fingerprint),
  }));
}

/** The newest fingerprint any recorded migration certified, skipping the rows a part-applied batch left uncertified. @internal */
export function certifiedFingerprint(recorded: readonly RecordedChecksum[]): string | null {
  return recorded.findLast((record) => record.fingerprint !== null)?.fingerprint ?? null;
}

/** The applied migrations whose file no longer hashes to what forge recorded when it ran. @internal */
export function compareChecksums(recorded: readonly RecordedChecksum[], discovered: readonly Migration[]): string[] {
  const onDisk = new Map(discovered.map((m) => [m.name, m.sha256]));
  return recorded.filter((r) => onDisk.has(r.appliedName) && onDisk.get(r.appliedName) !== r.sha256).map((r) => r.appliedName);
}
