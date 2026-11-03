import { databasePrefix, listD1Backups, sidecarKey } from "../../../storage/backup/list";
import type { BackupBucket, D1BackupListOptions, D1BackupSidecar } from "../../../storage/backup/types";

// The timestamp leads, so lexical order is age order and a listing needs no metadata read to sort.
/** The object key a dump of `databaseId` taken at `at`, at `bookmark`, is kept under. @internal */
export function backupKey(prefix: string | undefined, databaseId: string, at: Date, bookmark: string): string {
  return `${databasePrefix(prefix, databaseId)}${at.toISOString()}-${bookmark}.sql`;
}

/** Writes a dump's sidecar beside it, which marks the dump complete. @internal */
export async function writeSidecar(bucket: BackupBucket, sidecar: D1BackupSidecar): Promise<void> {
  await bucket.put(sidecarKey(sidecar.key), JSON.stringify(sidecar), { httpMetadata: { contentType: "application/json" } });
}

/** Deletes every dump, with its sidecar, older than the newest `keep` complete ones, answering how many dumps went. @internal */
export async function pruneD1Backups(bucket: BackupBucket, options: D1BackupListOptions, keep: number): Promise<number> {
  const records = await listD1Backups(bucket, options);
  const oldestKept = records.filter((record) => record.complete)[keep - 1];
  if (oldestKept === undefined) return 0;
  const stale = records.filter((record) => record.key < oldestKept.key);
  const keys = stale.flatMap((record) => (record.complete ? [record.key, sidecarKey(record.key)] : [record.key]));
  for (let start = 0; start < keys.length; start += 1000) await bucket.delete(keys.slice(start, start + 1000));
  return stale.length;
}
