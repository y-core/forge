import { describe, expect, it } from "bun:test";

import { fakeBackupBucket } from "./backup.fixture";
import { D1BackupError } from "./errors";
import { sidecarKey } from "./list";
import { parseSidecar, readD1Backup, writeSidecar } from "./sidecar";
import type { D1BackupSidecar } from "./types";

const KEY = "d1-backups/db/2026-11-01T02:00:00.000Z-B.sql";

const SIDECAR: D1BackupSidecar = {
  key: KEY,
  databaseId: "db",
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

describe("readD1Backup()", () => {
  it("reads back the sidecar writeSidecar kept beside the dump", async () => {
    const bucket = fakeBackupBucket();
    await writeSidecar(bucket, SIDECAR);
    expect([[...bucket.objects.keys()], await readD1Backup(bucket, KEY)]).toEqual([[sidecarKey(KEY)], SIDECAR]);
  });

  it("answers null for a dump with no sidecar", async () => {
    expect(await readD1Backup(fakeBackupBucket(), KEY)).toBeNull();
  });

  it("refuses a sidecar that is not JSON, is the wrong shape, or names another dump", async () => {
    for (const text of ["{", JSON.stringify({ ...SIDECAR, md5: "nope" }), JSON.stringify({ ...SIDECAR, key: "other.sql" })]) {
      const bucket = fakeBackupBucket();
      await bucket.put(sidecarKey(KEY), text);
      const error = (await readD1Backup(bucket, KEY).catch((thrown: unknown) => thrown)) as D1BackupError;
      expect([error instanceof D1BackupError, error.kind]).toEqual([true, "malformed"]);
    }
  });
});

describe("parseSidecar()", () => {
  it("reads the sidecar text a dump keeps, and refuses one naming another dump", () => {
    expect(parseSidecar(JSON.stringify(SIDECAR), KEY)).toEqual(SIDECAR);
    expect(() => parseSidecar(JSON.stringify(SIDECAR), "other.sql")).toThrow("the sidecar of other.sql is not one runD1Backup wrote");
  });
});
