import { describe, expect, it } from "bun:test";

import { deriveClassGroups, reach, renderClassGroups, SHORTHAND_CLOSURE, signature } from "./class-groups-parse";
import type { ClassGroupTable } from "./types";
import type { CssNode, DesignSystem } from "./types";

const declaration = (property: string): CssNode => ({ kind: "declaration", property });
const rule = (...nodes: CssNode[]): CssNode[] => [{ kind: "rule", nodes }];

describe("signature", () => {
  it("names the CSS properties a utility writes", () => {
    expect(signature(rule(declaration("padding")))).toBe("padding");
  });

  it("sorts the properties, so the id is a function of the set and not of emission order", () => {
    expect(signature(rule(declaration("width"), declaration("height")))).toBe("height,width");
  });

  it("prefers the `--tw-*` variables when a utility sets any, so `ring-2` and `shadow-md` stay apart", () => {
    expect(signature(rule(declaration("--tw-ring-shadow"), declaration("box-shadow")))).toBe("--tw-ring-shadow");
    expect(signature(rule(declaration("--tw-shadow"), declaration("box-shadow")))).toBe("--tw-shadow");
  });

  it("ignores an `@property` block, which describes a variable rather than setting one", () => {
    const nodes = [...rule(declaration("color")), { kind: "at-rule", name: "@property", nodes: [declaration("syntax")] }];
    expect(signature(nodes)).toBe("color");
  });

  it("drops a non-`--tw-` custom property, which names no concern any other utility can claim", () => {
    expect(signature(rule(declaration("--forge-x"), declaration("color")))).toBe("color");
  });
});

describe("SHORTHAND_CLOSURE", () => {
  it("holds the thirty-two rows the CSS shorthands need", () => {
    expect(SHORTHAND_CLOSURE.size).toBe(32);
  });

  it("reaches a logical longhand from a physical shorthand", () => {
    expect(SHORTHAND_CLOSURE.get("padding")).toContain("padding-inline-start");
  });

  it("expands the scroll shorthands the same way as their unprefixed forms", () => {
    expect(SHORTHAND_CLOSURE.get("scroll-padding")).toContain("scroll-padding-left");
    expect(SHORTHAND_CLOSURE.get("scroll-margin")).toContain("scroll-margin-inline-start");
  });

  it("expands the flex and place shorthands", () => {
    expect(SHORTHAND_CLOSURE.get("flex")).toEqual(["flex-grow", "flex-shrink", "flex-basis"]);
    expect(SHORTHAND_CLOSURE.get("place-content")).toEqual(["align-content", "justify-content"]);
    expect(SHORTHAND_CLOSURE.get("place-items")).toEqual(["align-items", "justify-items"]);
    expect(SHORTHAND_CLOSURE.get("place-self")).toEqual(["align-self", "justify-self"]);
  });
});

describe("reach", () => {
  it("expands a shorthand transitively", () => {
    const reached = reach("padding");
    expect(reached.has("padding-inline")).toBe(true);
    expect(reached.has("padding-left")).toBe(true);
  });

  it("returns a property that is nobody's shorthand unchanged", () => {
    expect([...reach("display")]).toEqual(["display"]);
  });

  it("splits a multi-property signature and expands each part", () => {
    const reached = reach("height,width");
    expect(reached.has("height")).toBe(true);
    expect(reached.has("width")).toBe(true);
  });
});

// A stub, so each derivation rule is falsifiable against stated design-system answers.
function fakeDesignSystem(spec: {
  statics?: Record<string, string[]>;
  functional?: Record<string, string[]>;
  classes?: Record<string, string[]>;
  compiles?: Record<string, string[]>;
}): DesignSystem {
  const statics = spec.statics ?? {};
  const functional = spec.functional ?? {};
  const classes = spec.classes ?? {};
  const all: Record<string, string[]> = { ...statics, ...functional, ...classes, ...spec.compiles };

  return {
    candidatesToAst: (candidates) => candidates.map((name) => (all[name] === undefined ? null : rule(...(all[name] as string[]).map(declaration)))),
    parseCandidate: (candidate) => {
      if (statics[candidate] !== undefined) return [{ kind: "static", root: candidate }];
      const root = Object.keys(functional)
        .filter((key) => candidate === key || candidate.startsWith(`${key}-`))
        .sort((a, b) => b.length - a.length)[0];
      if (root === undefined) return [];
      if (candidate === root) return [{ kind: "functional", root, value: null }];
      return [{ kind: "functional", root, value: { kind: "named", value: candidate.slice(root.length + 1) } }];
    },
    candidatesToCss: (candidates) => candidates.map((name) => (all[name] === undefined ? null : `.${name} {}`)),
    getClassList: () => Object.keys(classes).map((name) => [name, {}] as const),
    utilities: { keys: (kind) => Object.keys(kind === "static" ? statics : functional) },
    theme: { entries: () => [] },
  };
}

describe("deriveClassGroups", () => {
  it("claims a static utility by its own name", () => {
    const table = deriveClassGroups(fakeDesignSystem({ statics: { block: ["display"] } }));
    expect(table.statics.get("block")).toBe("display");
  });

  it("claims a functional root that is a utility on its own, which the class list may not list", () => {
    const table = deriveClassGroups(fakeDesignSystem({ functional: { rounded: ["border-radius"] } }));
    expect(table.statics.get("rounded")).toBe("border-radius");
  });

  it("folds a negative utility onto its positive form, because `cn` strips the sign before lookup", () => {
    const table = deriveClassGroups(fakeDesignSystem({ statics: { "-mt-2": ["margin-top"], "mt-2": ["margin-top"] } }));
    expect(table.statics.get("mt-2")).toBe("margin-top");
    expect(table.statics.has("-mt-2")).toBe(false);
  });

  it("refuses a fold that would change the group, because that would make sign-stripping unsound", () => {
    const ds = fakeDesignSystem({ statics: { "-x": ["color"], x: ["display"] } });
    expect(() => deriveClassGroups(ds)).toThrow(/resolves to two signatures/);
  });

  it("takes the majority signature as a root's default", () => {
    const table = deriveClassGroups(
      fakeDesignSystem({
        functional: { bg: ["background-color"] },
        classes: { "bg-red": ["background-color"], "bg-blue": ["background-color"], "bg-none": ["background-image"] },
      }),
    );
    expect(table.roots.get("bg")?.named).toBe("background-color");
  });

  it("enumerates the minority values as the root's exceptions", () => {
    const table = deriveClassGroups(
      fakeDesignSystem({
        functional: { bg: ["background-color"] },
        classes: { "bg-red": ["background-color"], "bg-blue": ["background-color"], "bg-none": ["background-image"] },
      }),
    );
    expect(table.roots.get("bg")?.exceptions).toEqual({ values: ["none"], group: "background-image" });
  });

  it("reserves `text-size` for the size group `text` itself states, so an app's own step is not read as a colour", () => {
    const table = deriveClassGroups(
      fakeDesignSystem({
        functional: { text: ["color"] },
        classes: { "text-red": ["color"], "text-blue": ["color"], "text-2xl": ["font-size", "line-height"] },
      }),
    );
    expect(table.roots.get("text-size")).toEqual({ named: "font-size,line-height" });
  });

  it("gives `text-size` the group an arbitrary length takes under `text`, so its two spellings meet", () => {
    const table = deriveClassGroups(
      fakeDesignSystem({
        functional: { text: ["color"] },
        classes: { "text-red": ["color"], "text-blue": ["color"], "text-2xl": ["font-size", "line-height"] },
        compiles: { "text-[#abcdef]": ["color"], "text-[3px]": ["font-size"] },
      }),
    );
    expect(table.roots.get("text-size")).toEqual({ named: "font-size,line-height", arbitrary: "font-size" });
  });

  it("takes a root's named group from a scale probe when the class list enumerates none, as with `start-*`", () => {
    const table = deriveClassGroups(
      fakeDesignSystem({
        functional: { start: ["inset-inline-start"] },
        compiles: { "start-0": ["inset-inline-start"], "start-4": ["inset-inline-start"] },
      }),
    );
    expect(table.roots.get("start")?.named).toBe("inset-inline-start");
  });

  it("leaves a root without a named group when it compiles no scale value, so a bespoke class survives", () => {
    const table = deriveClassGroups(fakeDesignSystem({ functional: { cursor: ["cursor"] }, compiles: { "cursor-[foo]": ["cursor"] } }));
    expect(table.roots.get("cursor")).toEqual({ arbitrary: "cursor" });
  });

  it("leaves a root without a named group when its scale probes disagree", () => {
    const table = deriveClassGroups(fakeDesignSystem({ functional: { x: ["a"] }, compiles: { "x-0": ["a"], "x-4": ["b"] } }));
    expect(table.roots.has("x")).toBe(false);
  });

  it("refuses two groups whose reach is equal, because the override edge between them would run both ways", () => {
    const ds = fakeDesignSystem({
      statics: { a: ["padding-inline"], b: ["padding-inline", "padding-left", "padding-right", "padding-inline-start", "padding-inline-end"] },
    });
    expect(() => deriveClassGroups(ds)).toThrow(/reach the same properties/);
  });

  it("reserves nothing when the design system states no size group under `text`", () => {
    const table = deriveClassGroups(fakeDesignSystem({ functional: { text: ["color"] }, classes: { "text-red": ["color"] } }));
    expect(table.roots.has("text-size")).toBe(false);
  });

  it("refuses a root that spans three signatures, which the emitted row cannot encode", () => {
    const ds = fakeDesignSystem({ functional: { x: ["a"] }, classes: { "x-1": ["a"], "x-2": ["a"], "x-3": ["b"], "x-4": ["c"] } });
    expect(() => deriveClassGroups(ds)).toThrow(/spans 3 signatures/);
  });

  it("merges `sr-only` with `not-sr-only`, and gives the merged group no override edges", () => {
    const table = deriveClassGroups(
      fakeDesignSystem({ statics: { "sr-only": ["position", "width"], "not-sr-only": ["position"], "w-4": ["width"] } }),
    );
    expect(table.statics.get("sr-only")).toBe("sr-only");
    expect(table.statics.get("not-sr-only")).toBe("sr-only");
    expect(table.overrides.get("sr-only")).toBeUndefined();
  });

  it("derives an override edge wherever one signature's reach contains another's", () => {
    const table = deriveClassGroups(fakeDesignSystem({ statics: { a: ["padding"], b: ["padding-left"] } }));
    expect(table.overrides.get("padding")).toEqual(["padding-left"]);
  });

  it("derives no edge between partially overlapping signatures, so both utilities survive", () => {
    const table = deriveClassGroups(
      fakeDesignSystem({
        statics: { a: ["border-top-left-radius", "border-top-right-radius"], b: ["border-top-left-radius", "border-bottom-left-radius"] },
      }),
    );
    expect(table.overrides.get("border-top-left-radius,border-top-right-radius")).toBeUndefined();
  });
});

describe("renderClassGroups", () => {
  const table: ClassGroupTable = deriveClassGroups(
    fakeDesignSystem({
      statics: { block: ["display"] },
      functional: { bg: ["background-color"] },
      classes: { "bg-red": ["background-color"], "bg-none": ["background-image"] },
    }),
  );
  const rendered = renderClassGroups(table);

  it("opens with the generated banner naming the command that rewrites it", () => {
    expect(rendered.startsWith("/** class-groups.ts — GENERATED — do not edit; run `bun run gen:class-groups`.")).toBe(true);
  });

  it("exports the two symbols `cn` imports", () => {
    expect(rendered).toContain("export const GROUP_OVERRIDES: ReadonlyMap<string, readonly string[]>");
    expect(rendered).toContain("export function classGroup(utility: string): string | undefined");
  });

  it("emits the static table sorted, so the output is a function of the design system alone", () => {
    expect(rendered).toContain('["block", "display"]');
  });

  it("is deterministic across two renders of the same table", () => {
    expect(renderClassGroups(table)).toBe(rendered);
  });

  it("breaks a tie on the group id, so the table is a function of the stylesheet and never of enumeration order", () => {
    const emit = (classes: Record<string, string[]>): string =>
      renderClassGroups(deriveClassGroups(fakeDesignSystem({ functional: { x: ["a"] }, classes })));
    expect(emit({ "x-1": ["a"], "x-2": ["b"] })).toBe(emit({ "x-2": ["b"], "x-1": ["a"] }));
  });
});
