import { describe, expect, it } from "bun:test";

import { D1BackupError, isPermanentBackupFailure, permanentFailures } from "./errors";

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

describe("permanentFailures()", () => {
  class Final extends Error {}
  const nonRetryable = (message: string) => new Final(message);

  it("hands a failure no retry can change to nonRetryable, and throws any other as it was", async () => {
    const auth = permanentFailures({ nonRetryable }, async () => Promise.reject(new D1BackupError("auth", "refused")));
    const outage = permanentFailures({ nonRetryable }, async () => Promise.reject(new D1BackupError("refused", "503")));
    expect(await auth().catch((thrown: unknown) => thrown)).toBeInstanceOf(Final);
    expect(((await outage().catch((thrown: unknown) => thrown)) as D1BackupError).kind).toBe("refused");
  });

  it("throws a permanent failure as it was when no nonRetryable is given", async () => {
    const run = permanentFailures({}, async () => Promise.reject(new D1BackupError("auth", "refused")));
    expect(await run().catch((thrown: unknown) => thrown)).toBeInstanceOf(D1BackupError);
  });
});
