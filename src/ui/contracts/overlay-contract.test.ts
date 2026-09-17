import { describe, expect, it } from "bun:test";

import { invokerAttrs } from "./overlay-contract";

describe("invokerAttrs", () => {
  it("keys the expanded state to the popup it controls, closed at SSR", () => {
    expect(invokerAttrs("file-menu", "menu")).toEqual({ "aria-controls": "file-menu", "aria-expanded": "false", "aria-haspopup": "menu" });
  });

  it("says dialog for a popover-kind popup, so the value never claims a role the popup lacks", () => {
    expect(invokerAttrs("share-panel", "dialog")).toEqual({ "aria-controls": "share-panel", "aria-expanded": "false", "aria-haspopup": "dialog" });
  });
});
