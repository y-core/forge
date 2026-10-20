import { describe, expect, it } from "bun:test";

import { devExtraOrigins } from "./url.strict";

describe("devExtraOrigins", () => {
  it("admits no extra origin even when the binding names one", () => {
    expect(devExtraOrigins({ FORGE_DEV_ORIGINS: "https://x.example" })).toEqual([]);
  });
});
