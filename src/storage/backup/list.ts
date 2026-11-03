import { D1_BOOKMARK_PATTERN } from "./bookmark";
import type { BackupBucket, D1BackupListOptions, D1BackupRecord } from "./types";

/** The prefix dumps live under when none is given. @internal */
export const DEFAULT_BACKUP_PREFIX = "d1-backups";

const NAME = new RegExp(`^(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z)-(${D1_BOOKMARK_PATTERN})\\.sql$`);

/** The prefix every object kept for `databaseId` lives under. @internal */
export function databasePrefix(prefix: string | undefined, databaseId: string): string {
  return `${(prefix ?? DEFAULT_BACKUP_PREFIX).replace(/\/+$/, "")}/${databaseId}/`;
}

/** The key a restore's report is kept under, beside the dumps of the database it restored: `<prefix>/<database id>/restores/<restored id>.json`. @internal */
export function restoreReportKey(prefix: string | undefined, databaseId: string, restoredId: string): string {
  return `${databasePrefix(prefix, databaseId)}restores/${restoredId}.json`;
}

/** The key of the `.json` sidecar kept beside the dump at `key`. @internal */
export function sidecarKey(key: string): string {
  return `${key.slice(0, -".sql".length)}.json`;
}

/** The record a key names, or `null` for an object `forge db backup` did not write. @internal */
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
