import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Align, applyStateAttrs, type Orientation, type Side, STATE_ATTRS, stateAttrs } from "./state-attrs";

/** `src/ui/`, the whole tree the conformance sweep below covers — the *parent* of this file's own
 * directory. Resolving it from `import.meta.url` without stepping up would narrow the sweep to
 * `contracts/`, which holds no component markup at all: the test would pass while asserting
 * nothing. */
const UI_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * **Structural** `data-*` attributes — anatomy, wiring and component-specific metadata, none of
 * which is a state hook. Every `data-*` name in `src/ui/` must be either one of these or a member of
 * `STATE_ATTRS`; nothing may be neither. That is what stops a new component from inventing a private
 * styling hook that no stylesheet and no controller knows about.
 *
 * Prefixes cover generated families: `data-on-<event>` (the delegated-action vocabulary in
 * `scope-events.ts`) and Tailwind's own `data-slot`-scoped variants.
 */
const STRUCTURAL_ATTRS = new Set([
  // Anatomy and wiring.
  "data-slot",
  "data-ref",
  "data-scope",
  "data-state",
  "data-field",
  // Component-specific metadata, each read by its own consumer rather than by CSS.
  "data-variant",
  "data-content",
  "data-position",
  "data-sitekey",
  "data-size",
  "data-label-position",
  "data-theme",
  "data-nav",
  "data-setting",
  "data-tool",
  "data-duration",
  // Controller wiring: the value a bound group reports, and the filter pair `ui/show` drives.
  // `data-composite-item-active` is an *authoring input*, not a state hook: the server names which
  // item should hold the roving tab stop on mount, and the controller reads it once and never writes
  // it. The live state is `tabindex="0"`, which the platform already owns.
  "data-composite-item-active",
  // `data-multiple` is a ToggleGroup *configuration* — how many items may be pressed at once — read
  // by `bindGroup` to decide how to reconcile a click. `data-toolbar-item` marks a roving-focus stop.
  // Both are inputs to a controller, not states a stylesheet reacts to.
  "data-multiple",
  "data-toolbar-item",
  // `data-activation` is a Tabs configuration — whether selection follows focus — read once by the
  // controller at mount. It never changes in response to interaction.
  "data-activation",
  "data-value",
  "data-filter",
  "data-filter-item",
  // Chrome configuration, fixed at render time rather than reacting to interaction. `data-placement`
  // is a layout position (which edge the bar sits on), NOT `data-side`, which is a popup's position
  // relative to its anchor.
  "data-theme-preference",
  "data-compact",
  "data-placement",
  // `data-coords` selects a *placement mode*, not a state: it says this popup is positioned at a
  // coordinate rather than against an invoker, which is a fact about how the panel is used and not
  // about what it is currently doing. Sibling to `data-placement`, not to `data-side`.
  "data-coords",

  // ── The theme customiser's wiring ──────────────────────────────────────────────────────────────
  //
  // Every one of these is a **handle the customiser's own effect writes into**, not a state a
  // stylesheet reacts to — which is the distinction this table exists to hold. The page cannot ship
  // colour in a `style` attribute (forge sends `style-src 'self'` with no nonce, and the renderer
  // drops `style` outright), so the browser scope finds each target by attribute and writes through
  // CSSOM. They are named in `contracts/theme-contract.ts` where both sides can see them, for the
  // same reason `data-coords` is: an attribute shared across the SSR/client boundary is a contract.
  //
  // `data-scale-row` and `data-swatch` address the preview table — which generated scale a row
  // draws, and which step a swatch is. `data-hex` marks the printed hex under a swatch, valued with
  // the same step index: a *second* handle on the same column, because the effect writes paint on
  // one and text on the other, and it exists at all because a hex the effect never rewrote sat
  // under a swatch it no longer described. `data-readout` marks the `<output>` beside each slider,
  // which is an effect's job here because `Slider` ships no client controller.
  "data-scale-row",
  "data-swatch",
  "data-hex",
  "data-readout",
  // The WCAG table. `data-pair` names the audited token a row reports on and `data-ratio` the cell
  // for one mode. `data-live` is *configuration*, not state: whether a pair is computable from a
  // generated scheme is fixed by which side sits on a Tailwind stop, decided at render and never
  // changing in response to anything.
  "data-pair",
  "data-ratio",
  "data-live",
  // The copyable scheme block and the shareable URL, both rewritten as the dials move.
  "data-scheme-output",
  "data-share-url",
]);

const STRUCTURAL_PREFIXES = ["data-on-"];

const DECLARED = new Set<string>(Object.values(STATE_ATTRS));

/** Every `data-…` token in a source file: JSX attributes, string keys, and Tailwind's
 * `data-[name=value]` / `group-data-[name]` arbitrary variants alike. */
function dataAttrNames(source: string): string[] {
  return [...source.matchAll(/data-\[?([a-z][a-z0-9-]*)/g)].map((match) => `data-${match[1]}`);
}

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "assets") continue; // retained untouched; its CSS is not component markup
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

  it("treats open as an exhaustive pair: data-open when open, data-closed when not", () => {
    expect(stateAttrs({ open: true })).toEqual({ "data-open": "" });
    expect(stateAttrs({ open: false })).toEqual({ "data-closed": "" });
  });

  it("carries the four valued states through verbatim", () => {
    expect(stateAttrs({ orientation: "vertical", side: "top", align: "end", transition: "starting" })).toEqual({
      "data-orientation": "vertical",
      "data-side": "top",
      "data-align": "end",
      "data-starting-style": "",
    });
  });

  it("maps the ending transition to its own attribute", () => {
    expect(stateAttrs({ transition: "ending" })).toEqual({ "data-ending-style": "" });
  });

  it("drops an empty valued state rather than emitting it as a presence flag", () => {
    // The valued three are guarded by truthiness, so `""` is dropped. That is the right answer and
    // not the falsy-value trap: `""` is not a member of Orientation / Side / Align — the cast below
    // is the only way to reach this at all — and emitting `data-orientation=""` would make a valued
    // attribute indistinguishable from a presence flag to every `[data-orientation]` selector.
    // Every legal value is a non-empty string, so no legal value can be lost this way.
    expect(stateAttrs({ orientation: "" as unknown as Orientation, side: "" as unknown as Side, align: "" as unknown as Align })).toEqual({});
  });

  it("declares exactly the thirteen names of the convention", () => {
    expect(Object.values(STATE_ATTRS).sort()).toEqual(
      [
        "data-align",
        "data-checked",
        "data-closed",
        "data-disabled",
        "data-ending-style",
        "data-invalid",
        "data-open",
        "data-orientation",
        "data-popup-open",
        "data-pressed",
        "data-selected",
        "data-side",
        "data-starting-style",
      ].sort(),
    );
  });
});

describe("applyStateAttrs", () => {
  /** Minimal element stand-in: `applyStateAttrs` takes the element as a parameter and touches no
   * global, which is exactly what makes it safe to ship in the same module as the SSR builder. */
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
    applyStateAttrs(el, { open: true, side: "bottom" });
    expect(Object.fromEntries(el.attrs)).toEqual(stateAttrs({ open: true, side: "bottom" }));
  });

  it("reconciles a paired state in one call: closing clears data-open and writes data-closed", () => {
    const el = fakeElement();
    applyStateAttrs(el, { open: true });
    applyStateAttrs(el, { open: false });
    expect(Object.fromEntries(el.attrs)).toEqual({ "data-closed": "" });
  });

  it("clears a presence state that has become false", () => {
    const el = fakeElement();
    applyStateAttrs(el, { pressed: true });
    applyStateAttrs(el, { pressed: false });
    expect(el.attrs.size).toBe(0);
  });

  /**
   * Keyed by `Side` rather than listed as an array, so the table is exhaustive **at compile time**:
   * widening the union without adding a row fails `tsgo`, and a row for a value the union does not
   * carry fails it too. That is what makes this a witness of the widened union under `check` rather
   * than a restatement of eight strings.
   */
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

    // The client mutator must write exactly the value the SSR builder did, which is what keeps a
    // controller from disagreeing with the markup a stylesheet's `:dir()` rules are keyed on.
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
        if (STRUCTURAL_ATTRS.has(name)) continue;
        if (STRUCTURAL_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
        offenders.push(`${file.slice(UI_DIR.length + 1)}: ${name}`);
      }
    }
    expect([...new Set(offenders)].sort()).toEqual([]);
  });
});
