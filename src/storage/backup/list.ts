import type { BackupBucket, D1BackupListOptions, D1BackupRecord } from "./types";

/** The prefix dumps live under when none is given. @internal */
export const DEFAULT_BACKUP_PREFIX = "d1-backups";

const NAME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)-([A-Za-z0-9_-]+)\.sql$/;

function databasePrefix(prefix: string | undefined, databaseId: string): string {
  return `${(prefix ?? DEFAULT_BACKUP_PREFIX).replace(/\/+$/, "")}/${databaseId}/`;
}

// The timestamp leads, so lexical order is age order and a listing needs no metadata read to sort.
/** The object key a dump of `databaseId` taken at `at`, at `bookmark`, is kept under. @internal */
export function backupKey(prefix: string | undefined, databaseId: string, at: Date, bookmark: string): string {
  return `${databasePrefix(prefix, databaseId)}${at.toISOString()}-${bookmark}.sql`;
}

/** The record a key names, or `null` for an object `runD1Backup` did not write. @internal */
export function readBackupKey(key: string, size: number, prefix: string | undefined, databaseId: string): D1BackupRecord | null {
  const under = databasePrefix(prefix, databaseId);
  if (!key.startsWith(under)) return null;
  const match = NAME.exec(key.slice(under.length));
  if (match === null) return null;
  return { key, databaseId, takenAt: match[1] ?? "", bookmark: match[2] ?? "", size };
}

/** Every dump of one database the bucket holds, newest first. @public */
export async function listD1Backups(bucket: BackupBucket, options: D1BackupListOptions): Promise<D1BackupRecord[]> {
  const prefix = databasePrefix(options.prefix, options.databaseId);
  const records: D1BackupRecord[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await bucket.list(cursor === undefined ? { prefix } : { prefix, cursor });
    for (const object of page.objects) {
      const record = readBackupKey(object.key, object.size, options.prefix, options.databaseId);
      if (record !== null) records.push(record);
    }
    if (!page.truncated || page.cursor === undefined) break;
    cursor = page.cursor;
  }
  return records.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
}

/** Deletes every dump of one database past the newest `keep`, answering how many went. @internal */
export async function pruneD1Backups(bucket: BackupBucket, options: D1BackupListOptions, keep: number): Promise<number> {
  const stale = (await listD1Backups(bucket, options)).slice(keep).map((record) => record.key);
  for (let start = 0; start < stale.length; start += 1000) await bucket.delete(stale.slice(start, start + 1000));
  return stale.length;
}
