import { describe, expect, it } from "bun:test";

import { appendForgeDev, DEV_CONDITION, WRANGLER_CONDITIONS } from "./conditions";

describe("appendForgeDev", () => {
  it("starts from wrangler's default conditions when the variable is unset", () => {
    expect(appendForgeDev(undefined)).toBe("workerd,worker,browser,forge-dev");
  });

  it("keeps an existing list in its order and appends forge-dev after it", () => {
    expect(appendForgeDev("workerd,custom")).toBe("workerd,custom,forge-dev");
  });

  it("does not repeat forge-dev when the list already carries it", () => {
    expect(appendForgeDev("workerd,forge-dev,custom")).toBe("workerd,custom,forge-dev");
  });

  it("drops the empty entries a stray comma or whitespace leaves", () => {
    expect(appendForgeDev(" workerd, ,worker ,")).toBe("workerd,worker,forge-dev");
  });

  it("treats a set but empty variable as an empty list rather than as unset", () => {
    expect(appendForgeDev("")).toBe("forge-dev");
  });
});

describe("the condition constants", () => {
  it("name wrangler's module-Worker defaults and forge's development condition", () => {
    expect([WRANGLER_CONDITIONS, DEV_CONDITION]).toEqual([["workerd", "worker", "browser"], "forge-dev"]);
  });
});
