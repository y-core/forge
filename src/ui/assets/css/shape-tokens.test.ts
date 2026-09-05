import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const CSS_DIR = resolve(import.meta.dir);

/** The `--name` of every custom property declared in `css`, in declaration order. */
function declaredProperties(css: string): string[] {
  return [...css.matchAll(/^\s*(--[a-z0-9]+(?:-[a-z0-9]+)*)\s*:/gm)].map((match) => match[1] as string);
}

function shapeBlock(css: string): string {
  const start = css.indexOf("── Shape tokens");
  const end = css.indexOf("/* ──", start + 1);
  return css.slice(start, end === -1 ? undefined : end);
}

const themeBase = readFileSync(resolve(CSS_DIR, "theme-base.css"), "utf-8");
const SHAPE_TOKENS = declaredProperties(shapeBlock(themeBase));

const shapeFiles = readdirSync(CSS_DIR).filter((name) => name.startsWith("shape-") && name.endsWith(".css"));

describe("the shape tokens `theme-base.css` owns", () => {
  it("is a non-empty set, so an unparsed block cannot make every assertion below vacuous", () => {
    expect(SHAPE_TOKENS.length).toBeGreaterThan(0);
  });

  it("is exactly the eight the docs and the showcase both count", () => {
    expect(SHAPE_TOKENS).toEqual([
      "--radius",
      "--radius-field",
      "--radius-box",
      "--radius-selector",
      "--control-h-sm",
      "--control-h-md",
      "--control-h-lg",
      "--border-width",
    ]);
  });

  it("appears in no colour scheme, which is what lets any scheme compose with any shape", () => {
    const offenders = readdirSync(CSS_DIR)
      .filter((name) => name.startsWith("theme-") && name !== "theme-base.css")
      .flatMap((name) => {
        const declared = new Set(declaredProperties(readFileSync(resolve(CSS_DIR, name), "utf-8")));
        return SHAPE_TOKENS.filter((token) => declared.has(token)).map((token) => `${name}: ${token}`);
      });

    expect(offenders).toEqual([]);
  });
});

describe("every shipped shape file re-declares that set exactly", () => {
  it("ships at least one, so the set equality below is asserted against something", () => {
    expect(shapeFiles).toEqual(["shape-compact.css"]);
  });

  for (const name of shapeFiles) {
    it(`${name} declares neither more nor less than the eight`, () => {
      const declared = declaredProperties(readFileSync(resolve(CSS_DIR, name), "utf-8"));

      expect([...declared].sort()).toEqual([...SHAPE_TOKENS].sort());
    });
  }
});
