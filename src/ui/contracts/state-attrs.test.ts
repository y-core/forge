import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PRESENCE_STATES } from "../../tooling/lint/rules/a11y-aria-beside-data";
import { STATE_ATTR_KEYS } from "../../tooling/lint/rules/a11y-state-attrs-source";
import { ISLAND_STATE_ATTR } from "./island-contract";
import { applyStateAttrs, STATE_ATTRS, stateAttrs } from "./state-attrs";
import type { Align, Orientation, Side, StateAttrsProps } from "./types";
import { PRESENTATION_ATTRS } from "./vocabulary";
import { WIRING_ATTRS, WIRING_PREFIXES } from "./wiring-attrs.fixture";

const UI_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

const DECLARED = new Set<string>([...Object.values(STATE_ATTRS), ...Object.values(PRESENTATION_ATTRS), ISLAND_STATE_ATTR]);

function dataAttrNames(source: string): string[] {
  return [...source.matchAll(/data-\[?([a-z][a-z0-9-]*)/g)].map((match) => `data-${match[1]}`);
}

function unspelledWiringNames(names: readonly string[], files: readonly string[]): string[] {
  const spelled = new Set(files.flatMap((file) => dataAttrNames(readFileSync(file, "utf-8"))));
  return names.filter((name) => !spelled.has(name));
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
    if (/\.(test|browser|fixture)\.tsx?$/.test(entry.name)) continue;
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

  it("carries a component-local state through verbatim", () => {
    expect(stateAttrs({ state: "current" })).toEqual({ "data-state": "current" });
  });

  it("drops an empty valued state rather than emitting it as a presence flag", () => {
    expect(
      stateAttrs({ orientation: "" as unknown as Orientation, side: "" as unknown as Side, align: "" as unknown as Align, state: "" }),
    ).toEqual({});
  });

  // Open, closed, popup-open and the transition phases are the platform's — `:popover-open`,
  // `[open]`, `:has()` and `@starting-style` express every one of them without an attribute.
  it("declares exactly the names of the convention", () => {
    expect(Object.values(STATE_ATTRS).sort()).toEqual(
      [
        "data-align",
        "data-busy",
        "data-checked",
        "data-disabled",
        "data-dismissing",
        "data-instant",
        "data-invalid",
        "data-orientation",
        "data-pressed",
        "data-selected",
        "data-side",
        "data-state",
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

  it("writes a component-local state and removes it once the state is empty", () => {
    const el = fakeElement();
    applyStateAttrs(el, { state: "poor" });
    expect(Object.fromEntries(el.attrs)).toEqual({ "data-state": "poor" });
    applyStateAttrs(el, { state: "" });
    expect(el.attrs.size).toBe(0);
  });

  it("leaves a component-local state alone when the key is omitted or undefined", () => {
    const el = fakeElement();
    applyStateAttrs(el, { state: "poor" });
    applyStateAttrs(el, { pressed: false });
    applyStateAttrs(el, { state: undefined });
    expect(Object.fromEntries(el.attrs)).toEqual({ "data-state": "poor" });
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
    expect(unspelledWiringNames(Object.keys(WIRING_ATTRS), files)).toEqual([]);
  });

  it("reads no fixture, so a row only the fixture spells is reported", () => {
    expect(files.filter((file) => /\.fixture\.tsx?$/.test(file))).toEqual([]);
    expect(unspelledWiringNames(["data-unemitted"], files)).toEqual(["data-unemitted"]);
  });
});

// `tooling/lint` hand-lists these because it is a leaf that may not import `ui` (NAMESPACES.md §4a),
// so this is where its lists are held against `STATE_ATTRS`.
describe("the state names the lint rules hand-list", () => {
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
    state: "current",
  };

  it("emits every attribute in the convention's order", () => {
    expect(Object.keys(stateAttrs(EVERY_STATE))).toEqual([
      "data-pressed",
      "data-checked",
      "data-selected",
      "data-disabled",
      "data-invalid",
      "data-busy",
      "data-orientation",
      "data-side",
      "data-align",
      "data-state",
    ]);
  });

  it("names exactly the flags `stateAttrs` emits with an empty value", () => {
    const emitted = Object.entries(stateAttrs(EVERY_STATE))
      .filter(([, value]) => value === "")
      .map(([name]) => name.slice("data-".length));

    expect([...PRESENCE_STATES].sort()).toEqual(emitted.sort());
  });

  it("names every state `STATE_ATTRS` registers, so the aria-variant rule misses none", () => {
    expect([...STATE_ATTR_KEYS].sort()).toEqual(Object.keys(STATE_ATTRS).sort());
  });
});
