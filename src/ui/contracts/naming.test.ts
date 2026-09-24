import { describe, expect, it } from "bun:test";

import { tabId, titleId, triggerId } from "./naming";

describe("derived naming ids", () => {
  it("gives each pairing its own suffix, so one root can carry more than one without collision", () => {
    expect({ title: titleId("confirm"), tab: tabId("confirm"), trigger: triggerId("confirm") }).toEqual({
      title: "confirm-title",
      tab: "confirm-tab",
      trigger: "confirm-trigger",
    });
  });
});
