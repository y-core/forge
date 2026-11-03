import { describe, expect, it } from "bun:test";

import { fakeBackupBucket } from "../../../storage/backup/backup.fixture";
import { DEFAULT_BACKUP_PREFIX, readBackupKey, restoreReportKey, sidecarKey } from "../../../storage/backup/list";
import { readD1Backup } from "../../../storage/backup/sidecar";
import type { D1BackupSidecar } from "../../../storage/backup/types";
import { backupKey, pruneD1Backups, writeSidecar } from "./store";

const DB = "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a";

function seed(bucket: ReturnType<typeof fakeBackupBucket>, key: string, size = 1, complete = true): void {
  bucket.objects.set(key, { bytes: new Uint8Array(size) });
  if (complete) bucket.objects.set(sidecarKey(key), { bytes: new Uint8Array(1) });
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

  it("names a key readBackupKey reads back as the record of that dump", () => {
    const key = backupKey(undefined, DB, new Date("2026-11-01T02:00:00Z"), "B");
    expect(readBackupKey(key, 1, undefined, DB, true)).toEqual({
      key,
      databaseId: DB,
      takenAt: "2026-11-01T02:00:00.000Z",
      bookmark: "B",
      size: 1,
      complete: true,
    });
  });
});

const SIDECAR: D1BackupSidecar = {
  key: keyOn("2026-11-01"),
  databaseId: DB,
  bookmark: "B",
  takenAt: "2026-11-01T02:00:00.000Z",
  size: 10,
  md5: "0".repeat(32),
  sha256: "1".repeat(64),
  schemaDigest: "2".repeat(64),
  migrationHead: "0001_init.sql",
  rows: { t: 3 },
  hazards: [{ table: "t", column: "a", kind: "escape", count: 1 }],
};

describe("writeSidecar()", () => {
  it("keeps the sidecar beside the dump, where readD1Backup reads it back", async () => {
    const bucket = fakeBackupBucket();
    await writeSidecar(bucket, SIDECAR);
    expect([[...bucket.objects.keys()], await readD1Backup(bucket, SIDECAR.key)]).toEqual([[sidecarKey(SIDECAR.key)], SIDECAR]);
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

  it("deletes in batches of at most a thousand keys, the most one R2 delete accepts", async () => {
    const bucket = fakeBackupBucket();
    const days = Array.from({ length: 601 }, (_, day) => new Date(Date.UTC(2025, 0, 1 + day, 2)));
    for (const at of days) seed(bucket, backupKey(undefined, DB, at, "B"));

    expect(await pruneD1Backups(bucket, { databaseId: DB }, 1)).toBe(600);
    expect([bucket.deleted.map((batch) => batch.length), bucket.objects.size]).toEqual([[1000, 200], 2]);
  });

  it("never prunes a restore report kept beside the dumps", async () => {
    const bucket = fakeBackupBucket();
    const keys = ["2026-10-30", "2026-10-31", "2026-11-01"].map(keyOn);
    for (const key of keys) seed(bucket, key);
    const report = restoreReportKey(undefined, DB, "9f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a");
    bucket.objects.set(report, { bytes: new Uint8Array(1) });

    expect(await pruneD1Backups(bucket, { databaseId: DB }, 1)).toBe(2);
    expect([...bucket.objects.keys()].sort()).toEqual([sidecarKey(keys[2] ?? ""), keys[2], report]);
  });

  it("deletes nothing while the count is within `keep`", async () => {
    const bucket = fakeBackupBucket();
    seed(bucket, backupKey(undefined, DB, new Date("2026-11-01T02:00:00Z"), "B"));
    expect([await pruneD1Backups(bucket, { databaseId: DB }, 3), bucket.deleted]).toEqual([0, []]);
  });
});
