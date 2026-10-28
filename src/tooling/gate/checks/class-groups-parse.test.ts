import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { deriveClassGroups, reach, renderClassGroups, SHORTHAND_CLOSURE, signature } from "./class-groups-parse";
import type { ClassGroupTable } from "./types";
import type { CssNode, DesignSystem } from "./types";

const declaration = (property: string): CssNode => ({ kind: "declaration", property });
const rule = (...nodes: CssNode[]): CssNode[] => [{ kind: "rule", nodes }];
const scoped = (selector: string, ...nodes: CssNode[]): CssNode[] => [{ kind: "rule", selector, nodes }];

describe("signature", () => {
  it("names the CSS properties a utility writes", () => {
    expect(signature(rule(declaration("padding")))).toBe("padding");
  });

  it("sorts the properties, so the id is a function of the set and not of emission order", () => {
    expect(signature(rule(declaration("width"), declaration("height")))).toBe("height,width");
  });

  it("unions the `--tw-*` variables with the CSS properties, so `ring-2` and `shadow-md` stay apart", () => {
    expect(signature(rule(declaration("--tw-ring-shadow"), declaration("box-shadow")))).toBe("--tw-ring-shadow,box-shadow");
    expect(signature(rule(declaration("--tw-shadow"), declaration("box-shadow")))).toBe("--tw-shadow,box-shadow");
  });

  it("keeps the CSS property beside a variable, so `border-dashed` and `divide-solid` are told apart by scope", () => {
    expect(signature(scoped(".border-dashed", declaration("--tw-border-style"), declaration("border-style")))).toBe(
      "--tw-border-style,border-style",
    );
  });

  it("tags a property set under a selector other than the utility's own class with that selector", () => {
    const nodes = scoped(":where(.space-x-4 > :not(:last-child))", declaration("margin-inline-start"));
    expect(signature(nodes)).toBe("margin-inline-start@:where(& > :not(:last-child))");
  });

  it("leaves a property set under the utility's own escaped class untagged", () => {
    expect(signature(scoped(".bg-\\[linear-gradient\\(red\\,blue\\)\\]", declaration("background-image")))).toBe("background-image");
  });

  it("tags a property set inside a wrapping at-rule with its prelude, outermost first and before the selector", () => {
    const media: CssNode = { kind: "at-rule", name: "@media", params: "(forced-colors: active)", nodes: [declaration("outline-offset")] };
    const supports: CssNode = { kind: "at-rule", name: "@supports", params: "(a: b), (c: d)", nodes: scoped("&:hover", declaration("color")) };
    expect(signature(scoped(".outline-hidden", declaration("outline-style"), media))).toBe(
      "outline-offset@@media (forced-colors: active),outline-style",
    );
    expect(signature([{ kind: "at-rule", name: "@media", params: "print", nodes: [supports] }])).toBe(
      "color@@media print;@supports (a: b)|(c: d);&:hover",
    );
  });

  it("joins a selector list with `|`, so the context never splits on the signature's own comma", () => {
    expect(signature(scoped(".x:focus, .x:hover", declaration("color")))).toBe("color@&:focus|.x:hover");
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

  it("expands the property part of a scoped token and keeps its selector context", () => {
    const reached = reach("margin-inline@:where(&)");
    expect(reached.has("margin-inline-start@:where(&)")).toBe(true);
    expect(reached.has("margin-inline-start")).toBe(false);
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

  it("reserves `font-face` for the family group `font` itself states, so an app's own face is not read as a weight", () => {
    const table = deriveClassGroups(
      fakeDesignSystem({
        functional: { font: ["--tw-font-weight"] },
        classes: { "font-bold": ["--tw-font-weight"], "font-semibold": ["--tw-font-weight"], "font-sans": ["font-family"] },
      }),
    );
    expect(table.roots.get("font-face")).toEqual({ named: "font-family" });
  });

  it("gives `font-face` the group an arbitrary family takes under `font`, so its two spellings meet", () => {
    const table = deriveClassGroups(
      fakeDesignSystem({
        functional: { font: ["--tw-font-weight"] },
        classes: { "font-bold": ["--tw-font-weight"], "font-semibold": ["--tw-font-weight"], "font-sans": ["font-family"] },
        compiles: { "font-[3]": ["--tw-font-weight"], "font-[foo]": ["font-family"] },
      }),
    );
    expect(table.roots.get("font-face")).toEqual({ named: "font-family", arbitrary: "font-family" });
  });

  it("reserves nothing when the design system states no family group under `font`", () => {
    const table = deriveClassGroups(
      fakeDesignSystem({ functional: { font: ["--tw-font-weight"] }, classes: { "font-bold": ["--tw-font-weight"] } }),
    );
    expect(table.roots.has("font-face")).toBe(false);
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

  it("derives no edge onto a group whose every property is a `--tw-*` variable, so `space-x-reverse` survives `space-x-4`", () => {
    const table = deriveClassGroups(
      fakeDesignSystem({ statics: { reverse: ["--tw-space-x-reverse"], space: ["--tw-space-x-reverse", "margin-inline-start"] } }),
    );
    expect(table.statics.get("space")).toBe("--tw-space-x-reverse,margin-inline-start");
    expect(table.overrides.get("--tw-space-x-reverse,margin-inline-start")).toBeUndefined();
  });

  it("takes an integer group when two integer probes beyond the class list agree and differ from the named default", () => {
    const table = deriveClassGroups(
      fakeDesignSystem({
        functional: { border: ["border-width"] },
        classes: { "border-red": ["border-color"], "border-blue": ["border-color"] },
        compiles: { "border-3": ["border-width"], "border-13": ["border-width"] },
      }),
    );
    expect(table.roots.get("border")?.integer).toBe("border-width");
  });

  it("takes no integer group when the integer probes disagree", () => {
    const table = deriveClassGroups(
      fakeDesignSystem({
        functional: { border: ["border-width"] },
        classes: { "border-red": ["border-color"] },
        compiles: { "border-3": ["border-width"], "border-13": ["border-style"] },
      }),
    );
    expect(table.roots.get("border")?.integer).toBeUndefined();
  });

  it("takes no integer group when an integer resolves to the named default already", () => {
    const table = deriveClassGroups(
      fakeDesignSystem({ functional: { p: ["padding"] }, classes: { "p-1": ["padding"] }, compiles: { "p-3": ["padding"], "p-13": ["padding"] } }),
    );
    expect(table.roots.get("p")?.integer).toBeUndefined();
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

describe("the rendered resolver", () => {
  const dirs: string[] = [];

  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  async function loadResolver(table: ClassGroupTable): Promise<(utility: string) => string | undefined> {
    const dir = mkdtempSync(resolve(tmpdir(), "forge-class-groups-parse-"));
    dirs.push(dir);
    const path = resolve(dir, "class-groups.ts");
    writeFileSync(path, renderClassGroups(table), "utf-8");
    return ((await import(path)) as { classGroup: (utility: string) => string | undefined }).classGroup;
  }

  const table: ClassGroupTable = {
    statics: new Map([["block", "display"]]),
    roots: new Map([
      ["bg", { named: "background-color", arbitrary: "background-color", kinds: { image: "background-image" } }],
      ["border", { named: "border-color", integer: "border-width", exceptions: { values: ["2"], group: "border-width" } }],
    ]),
    overrides: new Map([["border-width", ["border-top-width"]]]),
  };

  for (const value of [
    "linear-gradient(red,blue)",
    "radial-gradient(red,blue)",
    "conic-gradient(red,blue)",
    "repeating-linear-gradient(red,blue)",
  ]) {
    it(`reads \`bg-[${value}]\` as an image`, async () => {
      expect((await loadResolver(table))(`bg-[${value}]`)).toBe("background-image");
    });
  }

  it("reads a bare integer the class list does not enumerate through the integer group", async () => {
    expect((await loadResolver(table))("border-3")).toBe("border-width");
  });

  it("reads a named value through the named group still", async () => {
    expect((await loadResolver(table))("border-red-500")).toBe("border-color");
  });
});
