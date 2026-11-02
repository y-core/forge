import { D1_BOOKMARK_PATTERN } from "./bookmark";
import type { BackupBucket, D1BackupListOptions, D1BackupRecord } from "./types";

/** The prefix dumps live under when none is given. @internal */
export const DEFAULT_BACKUP_PREFIX = "d1-backups";

const NAME = new RegExp(`^(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z)-(${D1_BOOKMARK_PATTERN})\\.sql$`);

function databasePrefix(prefix: string | undefined, databaseId: string): string {
  return `${(prefix ?? DEFAULT_BACKUP_PREFIX).replace(/\/+$/, "")}/${databaseId}/`;
}

// The timestamp leads, so lexical order is age order and a listing needs no metadata read to sort.
/** The object key a dump of `databaseId` taken at `at`, at `bookmark`, is kept under. @internal */
export function backupKey(prefix: string | undefined, databaseId: string, at: Date, bookmark: string): string {
  return `${databasePrefix(prefix, databaseId)}${at.toISOString()}-${bookmark}.sql`;
}

/** The key of the `.json` sidecar kept beside the dump at `key`. @internal */
export function sidecarKey(key: string): string {
  return `${key.slice(0, -".sql".length)}.json`;
}

/** The record a key names, or `null` for an object `runD1Backup` did not write. @internal */
export function readBackupKey(key: string, size: number, prefix: string | undefined, databaseId: string, complete: boolean): D1BackupRecord | null {
  const under = databasePrefix(prefix, databaseId);
  if (!key.startsWith(under)) return null;
  const match = NAME.exec(key.slice(under.length));
  if (match === null) return null;
  return { key, databaseId, takenAt: match[1] ?? "", bookmark: match[2] ?? "", size, complete };
}

/** Every dump of one database the bucket holds, newest first, each marked by whether its sidecar was written. @public */
export async function listD1Backups(bucket: BackupBucket, options: D1BackupListOptions): Promise<D1BackupRecord[]> {
  const prefix = databasePrefix(options.prefix, options.databaseId);
  const objects: { key: string; size: number }[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await bucket.list(cursor === undefined ? { prefix } : { prefix, cursor });
    objects.push(...page.objects);
    if (!page.truncated || page.cursor === undefined) break;
    cursor = page.cursor;
  }
  const keys = new Set(objects.map((object) => object.key));
  return objects
    .map((object) => readBackupKey(object.key, object.size, options.prefix, options.databaseId, keys.has(sidecarKey(object.key))))
    .filter((record): record is D1BackupRecord => record !== null)
    .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
}

/** The newest dump of one database whose sidecar was written, or `null` when there is none. @public */
export async function latestD1Backup(bucket: BackupBucket, options: D1BackupListOptions): Promise<D1BackupRecord | null> {
  return (await listD1Backups(bucket, options)).find((record) => record.complete) ?? null;
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
