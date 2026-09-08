import { describe, expect, it } from "bun:test";

import { hasWorkerd } from "./workerd";

describe("hasWorkerd()", () => {
  // The probe must answer for the runtime, not for the test runner: `bun` is always present, so a
  // probe that passed vacuously would let every workerd spec fail at server start instead.
  it("reports the runtime present exactly when wrangler resolves", () => {
    let resolvable = true;
    try {
      import.meta.resolve("wrangler");
    } catch {
      resolvable = false;
    }

    expect(hasWorkerd()).toBe(resolvable);
  });

  it("reports true in this repository, where wrangler is a devDependency", () => {
    expect(hasWorkerd()).toBe(true);
  });
});
