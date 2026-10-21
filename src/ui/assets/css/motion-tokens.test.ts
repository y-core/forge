import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const forgeUi = readFileSync(resolve(import.meta.dir, "forge-ui.css"), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every innermost rule that sets an opacity other than 1, as `[selector, opacity]`, in source order. */
function hidingRules(css: string): [string, string][] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, selector = "", body = ""]) => {
    const opacity = /(?:^|;)\s*opacity:\s*([^;]+);/.exec(body)?.[1]?.trim();
    return opacity === undefined || opacity === "1" ? [] : [[selector.trim().replace(/\s+/g, " "), opacity] as [string, string]];
  });
}

const TOKEN = "var(--forge-motion-opacity)";
const ANCHORED = ':is([data-slot~="popover-content"], [data-slot~="menu-popup"], [data-slot~="tooltip-content"], [data-slot~="toolbar-flyout"])';

describe("--forge-motion-opacity in forge-ui.css", () => {
  it("defaults to 0", () => {
    expect(/--forge-motion-opacity:\s*([^;]+);/.exec(forgeUi)?.[1]).toBe("0");
  });

  it("is the closed and starting opacity of every motion panel, while backdrops and the htmx indicator stay at 0", () => {
    expect(hidingRules(forgeUi)).toEqual([
      [".htmx-indicator", "0"],
      [ANCHORED, TOKEN],
      [`${ANCHORED}:popover-open`, TOKEN],
      [':is([data-slot~="toast"], [data-slot~="alert"])[data-dismissing]', TOKEN],
      ['[data-slot~="toast"]', TOKEN],
      ['[data-slot~="drawer"]:not([open])', TOKEN],
      ['[data-slot~="drawer"]:modal', TOKEN],
      ['[data-slot~="drawer"]:not([open])::backdrop', "0"],
      ['[data-slot~="drawer"]:modal::backdrop', "0"],
      ['[data-slot~="dialog"]:not([open])', TOKEN],
      ['[data-slot~="dialog"]:not([open])::backdrop', "0"],
      ['[data-slot~="dialog"]:modal', TOKEN],
      ['[data-slot~="dialog"]:modal::backdrop', "0"],
    ]);
  });
});
