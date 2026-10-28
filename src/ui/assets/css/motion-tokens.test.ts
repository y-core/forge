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
const ANCHORED = ':is([data-slot~="popover-content"], [data-slot~="menu-popup"], [data-slot~="tooltip-content"])';

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

  it("places and grows the toolbar flyout through Popover's side rules, with no flyout-only side rule of its own", () => {
    expect(forgeUi).not.toContain('toolbar-flyout"][data-side');
  });
});

/** Every innermost rule that sets `transition` or `transition-duration`, as `[selector, durations]`, in source order. */
function timingRules(css: string): [string, string[]][] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, selector = "", body = ""]) => {
    const declared = [...body.matchAll(/(?:^|;)\s*transition(?:-duration)?:\s*([^;]+);/g)].map(([, value = ""]) => value);
    const durations = declared.flatMap((value) => value.match(/var\(--forge-motion-(?:enter|exit)\)|\b\d+(?:\.\d+)?m?s\b/g) ?? []);
    return durations.length === 0 ? [] : [[selector.trim().replace(/\s+/g, " "), durations] as [string, string[]]];
  });
}

const ENTER = "var(--forge-motion-enter)";
const EXIT = "var(--forge-motion-exit)";
const DRAWER = '[data-slot~="drawer"]';

describe("motion durations in forge-ui.css", () => {
  it("no transition hard-codes a duration but the htmx indicator's", () => {
    const literal = timingRules(forgeUi).flatMap(([selector, durations]): [string, string[]][] => {
      const fixed = durations.filter((duration) => !duration.startsWith("var("));
      return fixed.length === 0 ? [] : [[selector, fixed]];
    });

    expect(literal).toEqual([[".htmx-indicator", ["200ms"]]]);
  });

  it("the disclosure and the Drawer open on --forge-motion-enter and close on --forge-motion-exit", () => {
    expect(timingRules(forgeUi).filter(([selector]) => /drawer|details-content/.test(selector))).toEqual([
      ['[data-slot~="collapsible"]::details-content, [data-slot~="accordion-item"]::details-content', [EXIT, EXIT]],
      ['[data-slot~="collapsible"][open]::details-content, [data-slot~="accordion-item"][open]::details-content', [ENTER]],
      [`${DRAWER}:not([open]), ${DRAWER}:modal`, [ENTER, ENTER, ENTER]],
      [`${DRAWER}:not([open])`, [EXIT]],
      [`${DRAWER}:not([open])::backdrop, ${DRAWER}:modal::backdrop`, [ENTER, ENTER, ENTER]],
      [`${DRAWER}:not([open])::backdrop`, [EXIT]],
      [`${DRAWER}:not([open]), ${DRAWER}:modal`, [ENTER, ENTER, ENTER]],
      [`${DRAWER}:not([open])`, [EXIT]],
    ]);
  });
});
