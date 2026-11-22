import { describe, expect, it } from "bun:test";

import * as formBarrel from "./mod";

describe("form barrel", () => {
  it("exports CSRF_HEADER_DEFAULT under that name, holding the X-CSRF-Token header consumers send", () => {
    expect(formBarrel.CSRF_HEADER_DEFAULT).toBe("X-CSRF-Token");
  });

  it("exports CSRF_MAX_AGE_MS_DEFAULT under that name, holding a token lifetime of 24 hours", () => {
    expect(formBarrel.CSRF_MAX_AGE_MS_DEFAULT).toBe(24 * 60 * 60 * 1000);
  });
});
