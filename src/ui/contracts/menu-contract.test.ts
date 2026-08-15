import { describe, expect, it } from "bun:test";
import { menuItemAttrs } from "./menu-contract";

describe("menuItemAttrs", () => {
  it("describes a plain row with its role and slot, and nothing it does not need", () => {
    expect(menuItemAttrs()).toEqual({ role: "menuitem", "data-slot": "menu-item" });
  });

  it("closes the named popup on select, which is what makes a row dismiss the menu", () => {
    expect(menuItemAttrs({ closes: "file-menu" })).toEqual({
      role: "menuitem",
      "data-slot": "menu-item",
      command: "hide-popover",
      commandfor: "file-menu",
    });
  });

  it("omits the command for a row that opted out, so a submenu header keeps its menu open", () => {
    expect(menuItemAttrs({ closes: false })).not.toHaveProperty("command");
  });

  it("gives a checkbox row its own slot, an initial aria-checked, and the check action", () => {
    expect(menuItemAttrs({ role: "menuitemcheckbox" })).toEqual({
      role: "menuitemcheckbox",
      "data-slot": "menu-checkbox-item",
      "aria-checked": "false",
      "data-on-click": "check",
    });
  });

  it("gives a radio row the select action instead, which clears its siblings", () => {
    expect(menuItemAttrs({ role: "menuitemradio" })).toMatchObject({ "data-slot": "menu-radio-item", "data-on-click": "select" });
  });

  it("carries an initial checked state through for either checkable role", () => {
    expect(menuItemAttrs({ role: "menuitemcheckbox", checked: true })["aria-checked"]).toBe("true");
    expect(menuItemAttrs({ role: "menuitemradio", checked: true })["aria-checked"]).toBe("true");
  });

  it("never puts aria-checked or an action on a plain row, which has no checked state", () => {
    const attrs = menuItemAttrs({ checked: true });

    expect(attrs).not.toHaveProperty("aria-checked");
    expect(attrs).not.toHaveProperty("data-on-click");
  });

  // The platform runs an invoker command regardless of `aria-disabled`, so a disabled row that also
  // carried `hide-popover` would dismiss a menu it was never allowed to act in.
  it("marks a disabled row without taking it out of the navigation ring", () => {
    expect(menuItemAttrs({ disabled: true })["aria-disabled"]).toBe("true");
  });
});
