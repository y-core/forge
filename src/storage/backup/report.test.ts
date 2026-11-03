import { describe, expect, it } from "bun:test";

import { fakeBackupBucket } from "./backup.fixture";
import { D1BackupError } from "./errors";
import { readRestoreReport, readRestoreReportValue } from "./report";

const REPORT = { databaseId: "id", name: "n", key: "k.sql", bookmark: null, queries: 3, mismatches: [] };

const KEY = "d1-backups/db/restores/id.json";

describe("readRestoreReportValue()", () => {
  it("answers a report forge db restore returned", () => {
    expect(readRestoreReportValue(REPORT)).toEqual(REPORT);
  });

  it("answers null for anything else", () => {
    expect([readRestoreReportValue(null), readRestoreReportValue({ ...REPORT, mismatches: "none" })]).toEqual([null, null]);
  });
});

async function refusal(stored: string): Promise<unknown> {
  const bucket = fakeBackupBucket();
  await bucket.put(KEY, stored);
  return readRestoreReport(bucket, KEY).catch((thrown: unknown) => thrown);
}

describe("readRestoreReport()", () => {
  it("answers the report stored at the key", async () => {
    const bucket = fakeBackupBucket();
    const stored = { ...REPORT, bookmark: "B9", mismatches: ["notes holds 1 rows, but the dump holds 2"] };
    await bucket.put(KEY, JSON.stringify(stored));
    expect(await readRestoreReport(bucket, KEY)).toEqual(stored);
  });

  it("answers null when the bucket holds nothing at the key", async () => {
    expect(await readRestoreReport(fakeBackupBucket(), KEY)).toBeNull();
  });

  it("refuses text that is not JSON, and JSON of another shape, as malformed, naming the key", async () => {
    const refusals = [];
    for (const stored of ["{ not json", JSON.stringify({ ...REPORT, queries: -1 })]) {
      const error = await refusal(stored);
      refusals.push(error instanceof D1BackupError ? [error.kind, error.message] : error);
    }
    const malformed = ["malformed", `${KEY} is not a restore report forge db restore wrote`];
    expect(refusals).toEqual([malformed, malformed]);
  });
});
