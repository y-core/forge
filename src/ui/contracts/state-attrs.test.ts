import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PRESENCE_STATES } from "../../tooling/lint/rules/a11y-aria-beside-data";
import { ISLAND_STATE_ATTR } from "./island-contract";
import { type Align, applyStateAttrs, type Orientation, type Side, STATE_ATTRS, stateAttrs, type StateAttrsProps } from "./state-attrs";
import { PRESENTATION_ATTRS } from "./vocabulary";
import { WIRING_ATTRS, WIRING_PREFIXES } from "./wiring-attrs";

const UI_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

const DECLARED = new Set<string>([...Object.values(STATE_ATTRS), ...Object.values(PRESENTATION_ATTRS), ISLAND_STATE_ATTR]);

function dataAttrNames(source: string): string[] {
  return [...source.matchAll(/data-\[?([a-z][a-z0-9-]*)/g)].map((match) => `data-${match[1]}`);
}

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "assets") continue;
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.(test|browser)\.tsx?$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

describe("stateAttrs", () => {
  it('emits boolean states by presence with an empty value, never "true"', () => {
    expect(stateAttrs({ pressed: true, disabled: true, invalid: true, checked: true })).toEqual({
      "data-pressed": "",
      "data-disabled": "",
      "data-invalid": "",
      "data-checked": "",
    });
  });

  it("emits nothing for a falsy presence state", () => {
    expect(stateAttrs({ pressed: false, disabled: false, invalid: false, checked: false })).toEqual({});
  });

  it("emits nothing at all for an empty state", () => {
    expect(stateAttrs({})).toEqual({});
  });

  it("carries the three valued states through verbatim", () => {
    expect(stateAttrs({ orientation: "vertical", side: "top", align: "end" })).toEqual({
      "data-orientation": "vertical",
      "data-side": "top",
      "data-align": "end",
    });
  });

  it("drops an empty valued state rather than emitting it as a presence flag", () => {
    expect(stateAttrs({ orientation: "" as unknown as Orientation, side: "" as unknown as Side, align: "" as unknown as Align })).toEqual({});
  });

  // Open, closed, popup-open and the two transition phases are the platform's now — `:popover-open`,
  // `[open]`, `:has()` and `@starting-style` express every one of them without an attribute.
  it("declares exactly the nine names of the convention", () => {
    expect(Object.values(STATE_ATTRS).sort()).toEqual(
      [
        "data-align",
        "data-busy",
        "data-checked",
        "data-disabled",
        "data-invalid",
        "data-orientation",
        "data-pressed",
        "data-selected",
        "data-side",
      ].sort(),
    );
  });
});

describe("applyStateAttrs", () => {
  function fakeElement() {
    const attrs = new Map<string, string>();
    return {
      attrs,
      setAttribute: (name: string, value: string) => {
        attrs.set(name, value);
      },
      removeAttribute: (name: string) => {
        attrs.delete(name);
      },
    } as unknown as Element & { attrs: Map<string, string> };
  }

  it("writes the same attributes the SSR builder would", () => {
    const el = fakeElement();
    applyStateAttrs(el, { pressed: true, side: "bottom" });
    expect(Object.fromEntries(el.attrs)).toEqual(stateAttrs({ pressed: true, side: "bottom" }));
  });

  it("clears a presence state that has become false", () => {
    const el = fakeElement();
    applyStateAttrs(el, { pressed: true });
    applyStateAttrs(el, { pressed: false });
    expect(el.attrs.size).toBe(0);
  });

  const EVERY_SIDE: Record<Side, string> = {
    top: "top",
    right: "right",
    bottom: "bottom",
    left: "left",
    "block-start": "block-start",
    "block-end": "block-end",
    "inline-start": "inline-start",
    "inline-end": "inline-end",
  };

  it("round-trips every side of the union, logical spellings included, through both writers", () => {
    const sides = Object.keys(EVERY_SIDE) as Side[];

    expect(sides.map((side) => stateAttrs({ side })["data-side"])).toEqual(Object.values(EVERY_SIDE));

    expect(
      sides.map((side) => {
        const el = fakeElement();
        applyStateAttrs(el, { side });
        return el.attrs.get("data-side");
      }),
    ).toEqual(Object.values(EVERY_SIDE));
  });

  it("leaves attributes owned by keys the caller did not name", () => {
    const el = fakeElement();
    applyStateAttrs(el, { orientation: "vertical", pressed: true });
    applyStateAttrs(el, { pressed: false });
    expect(Object.fromEntries(el.attrs)).toEqual({ "data-orientation": "vertical" });
  });
});

describe("state-attribute conformance", () => {
  const files = collectSourceFiles(UI_DIR);

  it("scans a meaningful number of ui source files", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it("emits no data-* attribute that is neither declared state nor declared structure", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const name of dataAttrNames(readFileSync(file, "utf-8"))) {
        if (DECLARED.has(name)) continue;
        if (name in WIRING_ATTRS) continue;
        if (WIRING_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
        offenders.push(`${file.slice(UI_DIR.length + 1)}: ${name}`);
      }
    }
    expect([...new Set(offenders)].sort()).toEqual([]);
  });

  it("holds no wiring name the source no longer spells, so the allowlist can only shrink", () => {
    const spelled = new Set(files.flatMap((file) => dataAttrNames(readFileSync(file, "utf-8"))));

    expect(Object.keys(WIRING_ATTRS).filter((name) => !spelled.has(name))).toEqual([]);
  });
});

// `forge/a11y-aria-beside-data` hand-lists these because `tooling/lint` is a leaf that may not
// import `ui` (NAMESPACES.md §3c). This is where the two lists are held together, so a seventh
// presence flag fails here rather than going unenforced in the linter.
describe("the presence hooks the lint rule forbids by hand", () => {
  const EVERY_STATE: Required<StateAttrsProps> = {
    pressed: true,
    checked: true,
    selected: true,
    disabled: true,
    invalid: true,
    busy: true,
    orientation: "horizontal",
    side: "top",
    align: "start",
  };

  it("names exactly the flags `stateAttrs` emits with an empty value", () => {
    const emitted = Object.entries(stateAttrs(EVERY_STATE))
      .filter(([, value]) => value === "")
      .map(([name]) => name.slice("data-".length));

    expect([...PRESENCE_STATES].sort()).toEqual(emitted.sort());
  });
});
