import { describe, expect, it } from "bun:test";

import { D1BackupError, isPermanentBackupFailure } from "./errors";

describe("D1BackupError", () => {
  it("carries its kind and status", () => {
    const error = new D1BackupError("auth", "refused", { status: 403 });
    expect([error.name, error.kind, error.status, error.message]).toEqual(["D1BackupError", "auth", 403, "refused"]);
  });
});

describe("isPermanentBackupFailure()", () => {
  it("holds options, auth and not-found as failures no retry changes", () => {
    for (const kind of ["options", "auth", "not-found"] as const) expect(isPermanentBackupFailure(new D1BackupError(kind, "x"))).toBe(true);
  });

  it("leaves every other failure, and any foreign error, to be retried", () => {
    for (const kind of ["refused", "malformed", "export", "download"] as const) {
      expect(isPermanentBackupFailure(new D1BackupError(kind, "x"))).toBe(false);
    }
    expect(isPermanentBackupFailure(new Error("x"))).toBe(false);
  });
});
