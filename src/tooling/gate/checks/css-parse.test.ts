import { describe, expect, it } from "bun:test";

import { findClassDeclarations, findSourceDirectives, isClassAnchor } from "./css-parse";

describe("isClassAnchor() — what reads as a utility", () => {
  it("accepts a bare layout keyword", () => {
    expect(isClassAnchor("flex")).toBe(true);
  });

  it("accepts a familied utility and a variant-prefixed one", () => {
    expect(isClassAnchor("px-4")).toBe(true);
    expect(isClassAnchor("hover:bg-red-500")).toBe(true);
  });

  it("rejects a path-shaped token, which is an import specifier and not a class", () => {
    expect(isClassAnchor("./text-utils")).toBe(false);
    expect(isClassAnchor("p-4/5")).toBe(false);
  });
});

describe("findClassDeclarations() — the literals it reads", () => {
  it("reports a literal carrying at least two anchors", () => {
    expect(findClassDeclarations('const a = "flex items-center gap-2";')).toEqual([
      { literal: "flex items-center gap-2", anchors: ["flex", "gap-2"] },
    ]);
  });

  it("ignores a literal inside a comment", () => {
    expect(findClassDeclarations('// const a = "flex gap-2";\nconst b = 1;')).toEqual([]);
  });

  it("keeps the literal on a line whose comment holds a URL, which a `//` strip would have eaten", () => {
    expect(findClassDeclarations('const a = "flex gap-2"; // see https://x.test/y')).toEqual([
      { literal: "flex gap-2", anchors: ["flex", "gap-2"] },
    ]);
  });

  it("keeps a literal that a string-borne `/*` would otherwise have blanked", () => {
    const source = 'const open = "/* start";\nconst a = "flex gap-2";\nconst close = "end */";';

    expect(findClassDeclarations(source).map((found) => found.literal)).toEqual(["flex gap-2"]);
  });
});

describe("findSourceDirectives()", () => {
  it("returns each included path and drops the `not` exclusions", () => {
    expect(findSourceDirectives('@source "../../ui";\n@source not "../../ui/show";\n')).toEqual(["../../ui"]);
  });
});
