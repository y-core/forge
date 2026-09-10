import { describe, expect, it } from "bun:test";

import { deriveDesignScale, renderDesignScale } from "./design-scale-parse";
import type { DesignSystem } from "./types";

/** A design system that answers only what `deriveDesignScale` asks. */
function fakeDesignSystem(classes: Record<string, string>, theme: Record<string, string>): DesignSystem {
  return {
    candidatesToAst: () => [],
    candidatesToCss: (candidates) => candidates.map((name) => classes[name] ?? null),
    parseCandidate: (candidate) => {
      const cut = candidate.lastIndexOf("-");
      if (cut === -1) return [{ kind: "static", root: candidate }];
      return [{ kind: "functional", root: candidate.slice(0, cut), value: { kind: "named", value: candidate.slice(cut + 1) } }];
    },
    getClassList: () => Object.keys(classes).map((name) => [name, {}] as const),
    utilities: { keys: () => [] },
    theme: { entries: () => Object.entries(theme).map(([name, value]) => [name, { value }] as const) },
  };
}

describe("deriveDesignScale()", () => {
  it("reads a spacing root off the compiled CSS, not off the root's name", () => {
    const ds = fakeDesignSystem(
      { "p-4": ".p-4 { padding: calc(var(--spacing) * 4) }", "p-px": ".p-px { padding: 1px }" },
      { "--spacing": "0.25rem" },
    );

    expect(deriveDesignScale(ds)).toMatchObject({ spacingUnit: "0.25rem", spacingRoots: ["p"], spacingSteps: ["4"] });
  });

  it("orders the steps by value, not as strings", () => {
    const css = (n: string): string => `.m-${n} { margin: calc(var(--spacing) * ${n}) }`;
    const ds = fakeDesignSystem({ "m-2": css("2"), "m-10": css("10"), "m-0.5": css("0.5") }, {});

    expect(deriveDesignScale(ds).spacingSteps).toEqual(["0.5", "2", "10"]);
  });

  it("folds a negative root onto its positive form, which is how `cn` looks a utility up", () => {
    const ds = fakeDesignSystem({ "-mt-4": ".x { margin-top: calc(var(--spacing) * -4) }" }, {});

    expect(deriveDesignScale(ds).spacingRoots).toEqual(["mt"]);
  });

  it("leaves a named value that is not a multiple of the scale out of the steps", () => {
    const ds = fakeDesignSystem({ "w-full": ".w-full { width: 100% }", "w-4": ".w-4 { width: calc(var(--spacing) * 4) }" }, {});

    expect(deriveDesignScale(ds).spacingSteps).toEqual(["4"]);
  });

  it("reads a colour root off the compiled CSS", () => {
    const ds = fakeDesignSystem({ "bg-primary": ".bg-primary { background: var(--color-primary) }", "p-4": ".p-4 { padding: 1rem }" }, {});

    expect(deriveDesignScale(ds).colorRoots).toEqual(["bg"]);
  });

  it("strips the `--color-` prefix off every token and sorts them", () => {
    const ds = fakeDesignSystem({}, { "--color-ring": "oklch(0 0 0)", "--color-accent": "oklch(1 0 0)", "--radius-lg": "1rem" });

    expect(deriveDesignScale(ds).colorTokens).toEqual(["accent", "ring"]);
  });
});

describe("renderDesignScale()", () => {
  const rendered = renderDesignScale({
    spacingUnit: "0.25rem",
    spacingRoots: ["p"],
    spacingSteps: ["4"],
    colorRoots: ["bg"],
    colorTokens: ["accent"],
  });

  it("emits a module that imports nothing, which is what lets the plugin read it", () => {
    expect(rendered.match(/^\s*import\b/m)).toBeNull();
  });

  it("names the generator in its banner, so the file says how to regenerate it", () => {
    expect(rendered.includes("bun run gen:design-scale")).toBe(true);
  });

  it("emits every derived list as a named export", () => {
    for (const name of ["SPACING_UNIT", "SPACING_ROOTS", "SPACING_STEPS", "COLOR_ROOTS", "COLOR_TOKENS"]) {
      expect(rendered.includes(`export const ${name}`)).toBe(true);
    }
  });
});
