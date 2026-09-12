import { MIGRATIONS_DIGEST_KEY, SCHEMA_FINGERPRINT_KEY } from "../../../storage/db/schema";
import { quoteSqlLiteral } from "../sql";
import type { ChecksumComparison, Migration, RecordedChecksum } from "../types";
import type { RepairPlan } from "./types";

export { MIGRATIONS_DIGEST_KEY, SCHEMA_FINGERPRINT_KEY, SCHEMA_META_SELECT, toSchemaMeta } from "../../../storage/db/schema";

/** Reads every recorded migration checksum. @internal */
export const RECORDED_CHECKSUM_SELECT = "SELECT applied_name, sha256 FROM forge_migrations ORDER BY applied_name";

/** The `INSERT OR REPLACE` statements that record one checksum per migration, one to a line. @internal */
export function recordChecksumSql(migrations: readonly Migration[]): string {
  return migrations
    .map((m) => {
      const values = [m.name, m.sha256].map(quoteSqlLiteral).join(", ");
      return `INSERT OR REPLACE INTO forge_migrations (applied_name, sha256) VALUES (${values});`;
    })
    .join("\n");
}

// `migrations_digest` is a rollup of the same bytes the `sha256` rows hold, kept because one
// equality answers "is this database in step" where a set difference is what the rows answer.
// `status` compares both against the files on disk, so a rollup that drifted from them is reported.
/** The `INSERT OR REPLACE` statements that record the schema facts an apply leaves behind: the two digests. @internal */
export function recordMetaSql(facts: { migrationsDigest: string; schemaFingerprint: string }): string {
  const rows: (readonly [string, string])[] = [
    [MIGRATIONS_DIGEST_KEY, facts.migrationsDigest],
    [SCHEMA_FINGERPRINT_KEY, facts.schemaFingerprint],
  ];
  return rows
    .map(([key, value]) => `INSERT OR REPLACE INTO forge_schema_meta (key, value) VALUES (${quoteSqlLiteral(key)}, ${quoteSqlLiteral(value)});`)
    .join("\n");
}

/** The name wrangler recorded, without the `.sql` it keeps and forge does not. @internal */
export function appliedMigrationName(recorded: unknown): string {
  const name = String(recorded ?? "");
  return name.endsWith(".sql") ? name.slice(0, -".sql".length) : name;
}

/** Reads `RECORDED_CHECKSUM_SELECT` rows into recorded checksums. @internal */
export function toRecordedChecksums(rows: readonly Record<string, unknown>[]): RecordedChecksum[] {
  return rows.map((row) => ({ appliedName: String(row.applied_name ?? ""), sha256: String(row.sha256 ?? "") }));
}

/** Compares what the migrations table says was applied against what forge recorded and what is on disk. @internal */
export function compareChecksums(
  applied: readonly string[],
  recorded: readonly RecordedChecksum[],
  discovered: readonly Migration[],
): ChecksumComparison {
  // `d1_migrations` knows only the applied name, so that is the column the two records join on.
  const recordedByApplied = new Map(recorded.map((r) => [r.appliedName, r]));
  const onDisk = new Map(discovered.map((m) => [m.name, m.sha256]));
  const appliedNames = new Set(applied);
  return {
    mismatched: applied.filter((name) => {
      const was = recordedByApplied.get(name)?.sha256;
      const now = onDisk.get(name);
      return was !== undefined && now !== undefined && was !== now;
    }),
    unrecorded: applied.filter((name) => !recordedByApplied.has(name)),
    orphaned: recorded.map((r) => r.appliedName).filter((name) => !appliedNames.has(name)),
  };
}

/** Which applied-but-unrecorded migrations a run can record from their files, and which have no file and stay drift. @internal */
export function planRepair(applied: readonly string[], recorded: readonly RecordedChecksum[], discovered: readonly Migration[]): RepairPlan {
  const onDisk = new Map(discovered.map((m) => [m.name, m]));
  const recordable: Migration[] = [];
  for (const name of compareChecksums(applied, recorded, discovered).unrecorded) {
    const migration = onDisk.get(name);
    if (migration !== undefined) recordable.push(migration);
  }
  return { recordable };
}

/** The one write that records repaired checksums and the migrations digest — never the fingerprint, which only an apply may certify. @internal */
export function repairSql(recordable: readonly Migration[], migrationsDigestValue: string): string {
  const digest = `INSERT OR REPLACE INTO forge_schema_meta (key, value) VALUES (${quoteSqlLiteral(MIGRATIONS_DIGEST_KEY)}, ${quoteSqlLiteral(migrationsDigestValue)});`;
  return `${recordChecksumSql(recordable)}\n${digest}`;
}

/** The one write an apply leaves behind: every checksum and both schema facts, so a crash cannot part them. @internal */
export function recordAppliedSql(migrations: readonly Migration[], facts: { migrationsDigest: string; schemaFingerprint: string }): string {
  return `${recordChecksumSql(migrations)}\n${recordMetaSql(facts)}`;
}
