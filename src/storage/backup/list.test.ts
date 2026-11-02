import { describe, expect, it } from "bun:test";

import { fakeBackupBucket } from "./backup.fixture";
import { backupKey, DEFAULT_BACKUP_PREFIX, latestD1Backup, listD1Backups, pruneD1Backups, readBackupKey, sidecarKey } from "./list";

const DB = "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a";

function seed(bucket: ReturnType<typeof fakeBackupBucket>, key: string, size = 1, complete = true): void {
  bucket.objects.set(key, { bytes: new Uint8Array(size), customMetadata: {} });
  if (complete) bucket.objects.set(sidecarKey(key), { bytes: new Uint8Array(1), customMetadata: {} });
}

const keyOn = (day: string) => backupKey(undefined, DB, new Date(`${day}T02:00:00Z`), "B");

describe("backupKey()", () => {
  it("leads with the instant so lexical order is age order, under the default prefix", () => {
    expect(backupKey(undefined, DB, new Date("2026-11-01T02:00:00Z"), "00000085-0000024c")).toBe(
      `${DEFAULT_BACKUP_PREFIX}/${DB}/2026-11-01T02:00:00.000Z-00000085-0000024c.sql`,
    );
  });

  it("trims a trailing slash from a given prefix", () => {
    expect(backupKey("ops/backups/", DB, new Date("2026-11-01T02:00:00Z"), "B")).toBe(`ops/backups/${DB}/2026-11-01T02:00:00.000Z-B.sql`);
  });
});

describe("readBackupKey()", () => {
  it("reads back the record a key names", () => {
    const key = backupKey(undefined, DB, new Date("2026-11-01T02:00:00Z"), "00000085-0000024c");
    expect(readBackupKey(key, 42, undefined, DB, true)).toEqual({
      key,
      databaseId: DB,
      takenAt: "2026-11-01T02:00:00.000Z",
      bookmark: "00000085-0000024c",
      size: 42,
      complete: true,
    });
  });

  it("answers null for an object runD1Backup did not write, or another database's", () => {
    expect(readBackupKey(`${DEFAULT_BACKUP_PREFIX}/${DB}/notes.txt`, 1, undefined, DB, false)).toBeNull();
    expect(readBackupKey(`${DEFAULT_BACKUP_PREFIX}/other/2026-11-01T02:00:00.000Z-B.sql`, 1, undefined, DB, false)).toBeNull();
    expect(readBackupKey(`${DEFAULT_BACKUP_PREFIX}/${DB}/2026-11-01T02:00:00.000Z-B.json`, 1, undefined, DB, false)).toBeNull();
  });

  it("answers null for a bookmark outside D1's grammar", () => {
    expect(readBackupKey(`${DEFAULT_BACKUP_PREFIX}/${DB}/2026-11-01T02:00:00.000Z-_B.sql`, 1, undefined, DB, false)).toBeNull();
  });
});

describe("listD1Backups()", () => {
  it("lists newest first across every page, skipping foreign objects", async () => {
    const bucket = fakeBackupBucket(2);
    const keys = ["2026-10-30", "2026-11-01", "2026-10-31"].map((day) => backupKey(undefined, DB, new Date(`${day}T02:00:00Z`), "B"));
    for (const key of keys) seed(bucket, key);
    seed(bucket, `${DEFAULT_BACKUP_PREFIX}/${DB}/README`);

    const listed = await listD1Backups(bucket, { databaseId: DB });
    expect(listed.map((record) => record.takenAt)).toEqual(["2026-11-01T02:00:00.000Z", "2026-10-31T02:00:00.000Z", "2026-10-30T02:00:00.000Z"]);
  });

  it("marks a dump complete only when its sidecar sits beside it, even across a page boundary", async () => {
    const bucket = fakeBackupBucket(1);
    seed(bucket, keyOn("2026-11-01"), 1, false);
    seed(bucket, keyOn("2026-10-31"));
    expect((await listD1Backups(bucket, { databaseId: DB })).map((record) => record.complete)).toEqual([false, true]);
  });
});

describe("latestD1Backup()", () => {
  it("answers the newest complete dump, passing over one still without its sidecar", async () => {
    const bucket = fakeBackupBucket();
    seed(bucket, keyOn("2026-11-01"), 1, false);
    seed(bucket, keyOn("2026-10-31"));
    expect((await latestD1Backup(bucket, { databaseId: DB }))?.key).toBe(keyOn("2026-10-31"));
  });

  it("answers null when no dump is complete", async () => {
    const bucket = fakeBackupBucket();
    seed(bucket, keyOn("2026-11-01"), 1, false);
    expect(await latestD1Backup(bucket, { databaseId: DB })).toBeNull();
  });
});

describe("pruneD1Backups()", () => {
  it("deletes every dump past the newest `keep`, with its sidecar, answering how many went", async () => {
    const bucket = fakeBackupBucket();
    const keys = ["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"].map(keyOn);
    for (const key of keys) seed(bucket, key);

    expect(await pruneD1Backups(bucket, { databaseId: DB }, 2)).toBe(2);
    expect([...bucket.objects.keys()].sort()).toEqual([keys[2], keys[3]].flatMap((key = "") => [sidecarKey(key), key]));
  });

  it("counts only complete dumps toward `keep`, keeping a newer incomplete one and deleting an older one", async () => {
    const bucket = fakeBackupBucket();
    seed(bucket, keyOn("2026-10-29"), 1, false);
    seed(bucket, keyOn("2026-10-30"));
    seed(bucket, keyOn("2026-10-31"));
    seed(bucket, keyOn("2026-11-01"), 1, false);

    expect(await pruneD1Backups(bucket, { databaseId: DB }, 1)).toBe(2);
    expect([...bucket.objects.keys()].sort()).toEqual([sidecarKey(keyOn("2026-10-31")), keyOn("2026-10-31"), keyOn("2026-11-01")]);
  });

  it("deletes nothing while the count is within `keep`", async () => {
    const bucket = fakeBackupBucket();
    seed(bucket, backupKey(undefined, DB, new Date("2026-11-01T02:00:00Z"), "B"));
    expect([await pruneD1Backups(bucket, { databaseId: DB }, 3), bucket.deleted]).toEqual([0, []]);
  });
});
