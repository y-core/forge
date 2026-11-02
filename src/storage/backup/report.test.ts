import { describe, expect, it } from "bun:test";

import { readRestoreReportValue } from "./report";

const REPORT = { databaseId: "id", name: "n", key: "k.sql", bookmark: null, queries: 3, mismatches: [] };

describe("readRestoreReportValue()", () => {
  it("answers a report runD1Restore returned", () => {
    expect(readRestoreReportValue(REPORT)).toEqual(REPORT);
  });

  it("answers null for anything else", () => {
    expect([readRestoreReportValue(null), readRestoreReportValue({ ...REPORT, mismatches: "none" })]).toEqual([null, null]);
  });
});
