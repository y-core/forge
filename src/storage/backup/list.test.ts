import { describe, expect, it } from "bun:test";

import { fakeBackupBucket } from "./backup.fixture";
import { databasePrefix, DEFAULT_BACKUP_PREFIX, latestD1Backup, listD1Backups, readBackupKey, restoreReportKey, sidecarKey } from "./list";

const DB = "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a";

const RESTORED = "9f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a";

function seed(bucket: ReturnType<typeof fakeBackupBucket>, key: string, size = 1, complete = true): void {
  bucket.objects.set(key, { bytes: new Uint8Array(size) });
  if (complete) bucket.objects.set(sidecarKey(key), { bytes: new Uint8Array(1) });
}

const keyOn = (day: string, bookmark = "B") => `${databasePrefix(undefined, DB)}${day}T02:00:00.000Z-${bookmark}.sql`;

describe("databasePrefix()", () => {
  it("keeps a database's objects under its id, the default prefix standing in for none", () => {
    expect(databasePrefix(undefined, DB)).toBe(`${DEFAULT_BACKUP_PREFIX}/${DB}/`);
  });

  it("trims a trailing slash from a given prefix", () => {
    expect(databasePrefix("ops/backups/", DB)).toBe(`ops/backups/${DB}/`);
  });
});

describe("restoreReportKey()", () => {
  it("files a restore's report under restores/ beside the dumps, the default prefix standing in for none", () => {
    expect(restoreReportKey(undefined, DB, RESTORED)).toBe(`d1-backups/${DB}/restores/${RESTORED}.json`);
  });

  it("trims a trailing slash from a given prefix", () => {
    expect(restoreReportKey("ops/backups/", DB, RESTORED)).toBe(`ops/backups/${DB}/restores/${RESTORED}.json`);
  });
});

describe("readBackupKey()", () => {
  it("reads back the record a key names", () => {
    const key = keyOn("2026-11-01", "00000085-0000024c");
    expect(readBackupKey(key, 42, undefined, DB, true)).toEqual({
      key,
      databaseId: DB,
      takenAt: "2026-11-01T02:00:00.000Z",
      bookmark: "00000085-0000024c",
      size: 42,
      complete: true,
    });
  });

  it("answers null for an object forge db backup did not write, or another database's", () => {
    expect(readBackupKey(`${DEFAULT_BACKUP_PREFIX}/${DB}/notes.txt`, 1, undefined, DB, false)).toBeNull();
    expect(readBackupKey(`${DEFAULT_BACKUP_PREFIX}/other/2026-11-01T02:00:00.000Z-B.sql`, 1, undefined, DB, false)).toBeNull();
    expect(readBackupKey(`${DEFAULT_BACKUP_PREFIX}/${DB}/2026-11-01T02:00:00.000Z-B.json`, 1, undefined, DB, false)).toBeNull();
  });

  it("answers null for a restore report kept beside the dumps", () => {
    expect(readBackupKey(restoreReportKey(undefined, DB, RESTORED), 1, undefined, DB, false)).toBeNull();
  });

  it("answers null for a bookmark outside D1's grammar", () => {
    expect(readBackupKey(`${DEFAULT_BACKUP_PREFIX}/${DB}/2026-11-01T02:00:00.000Z-_B.sql`, 1, undefined, DB, false)).toBeNull();
  });
});

describe("listD1Backups()", () => {
  it("lists newest first across every page, skipping foreign objects", async () => {
    const bucket = fakeBackupBucket(2);
    const keys = ["2026-10-30", "2026-11-01", "2026-10-31"].map((day) => keyOn(day));
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

  it("skips the restore reports kept beside the dumps", async () => {
    const bucket = fakeBackupBucket();
    seed(bucket, keyOn("2026-11-01"));
    bucket.objects.set(restoreReportKey(undefined, DB, RESTORED), { bytes: new Uint8Array(1) });

    expect((await listD1Backups(bucket, { databaseId: DB })).map((record) => record.key)).toEqual([keyOn("2026-11-01")]);
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
