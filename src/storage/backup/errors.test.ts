import { describe, expect, it } from "bun:test";

import { D1BackupError } from "./errors";

describe("D1BackupError", () => {
  it("carries its kind", () => {
    const error = new D1BackupError("malformed", "refused");
    expect([error.name, error.kind, error.message]).toEqual(["D1BackupError", "malformed", "refused"]);
  });
});
