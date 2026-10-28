import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { CLASS_SHAPED, stringLiterals } from "../../tooling/gate/checks/class-tokens";
import { loadDesignSystem } from "../../tooling/gate/checks/design-system";
import { utilityOf } from "./utils/cn";

const UI_DIR = resolve(import.meta.dir, "..");
const CSS_DIR = resolve(UI_DIR, "assets/css");

// `class-groups.ts` is the table of utility names `cn` merges by, not a recipe anything renders.
const SCANNED = (name: string): boolean => /\.tsx?$/.test(name) && !/\.(test|browser)\.tsx?$/.test(name) && !name.endsWith("class-groups.ts");

function shapeBlock(css: string): string {
  const start = css.indexOf("── Shape tokens");
  const end = css.indexOf("/* ──", start + 1);
  return css.slice(start, end === -1 ? undefined : end);
}

const SHAPE_RADII = new Set(
  [...shapeBlock(readFileSync(resolve(CSS_DIR, "theme-base.css"), "utf-8")).matchAll(/^\s*(--radius[a-z0-9-]*)\s*:/gm)].map(
    (match) => match[1] as string,
  ),
);

const designSystem = await loadDesignSystem(resolve(CSS_DIR, "tailwind.css"));

// `rounded-full` is the one literal a shape theme must not reach: a pill stays a pill when corners go square.
// `inherit` passes on the parent's corner, which this same check governs.
function followsShape(value: string): boolean {
  if (value === "0" || value === "calc(infinity * 1px)" || value === "inherit") return true;
  const read = [...value.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1] as string);
  return read.length > 0 && read.every((name) => SHAPE_RADII.has(name));
}

/** `file:line token` for every radius utility in `source` that compiles to a corner no shape token sets. */
function radiusOffenders(file: string, source: string): string[] {
  return stringLiterals(source).flatMap(({ line, text }) =>
    text
      .split(/\s+/)
      .filter((token) => /^-?rounded(-|$)/.test(utilityOf(token)))
      .filter((token) => {
        const [css] = designSystem.candidatesToCss([utilityOf(token)]);
        if (typeof css !== "string") return false;
        return [...css.matchAll(/border(?:-[a-z]+)*-radius\s*:\s*([^;]+);/g)].some((match) => !followsShape((match[1] as string).trim()));
      })
      .map((token) => `${file}:${line} ${token}`),
  );
}

function readsBorderToken(value: string): boolean {
  return value === "0" || value === "0px" || value.includes("var(--border-width");
}

/** `file:line token` for every all-sides border width in `source` that no shape token sets. */
function borderOffenders(file: string, source: string): string[] {
  return stringLiterals(source).flatMap(({ line, text }) => {
    const compiled = text
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => ({ token, css: designSystem.candidatesToCss([utilityOf(token)])[0] }));
    const isClassString =
      compiled.some(({ css }) => typeof css === "string") &&
      compiled.every(({ token, css }) => typeof css === "string" || CLASS_SHAPED.test(token));
    if (!isClassString) return [];
    return compiled
      .filter(
        ({ css }) =>
          typeof css === "string" &&
          [...css.matchAll(/(?:^|[\s;{])border-width\s*:\s*([^;]+);/g)].some((match) => !readsBorderToken((match[1] as string).trim())),
      )
      .map(({ token }) => `${file}:${line} ${token}`);
  });
}

// Scope is string literals in TypeScript: forge's CSS carries no `@apply rounded…`, so none is parsed.
const sources = (readdirSync(UI_DIR, { recursive: true }) as string[])
  .filter(SCANNED)
  .map((path) => ({ file: relative(UI_DIR, resolve(UI_DIR, path)), source: readFileSync(resolve(UI_DIR, path), "utf-8") }));

describe("the radius a ui recipe reads", () => {
  it("derives a non-empty shape set, so an unparsed block cannot pass every token", () => {
    expect([...SHAPE_RADII].sort()).toEqual(["--radius", "--radius-box", "--radius-field", "--radius-selector"]);
  });

  it("scans the recipes, so an empty walk cannot pass vacuously", () => {
    expect(sources.some(({ file }) => file === "core/accordion.tsx")).toBe(true);
  });

  it("comes from a shape token in every shipped source", () => {
    expect(sources.flatMap(({ file, source }) => radiusOffenders(file, source))).toEqual([]);
  });

  it("refuses bare `rounded`, a literal 0.25rem, naming the token", () => {
    expect(radiusOffenders("fixture.tsx", `const recipe = "flex rounded px-1";`)).toEqual(["fixture.tsx:1 rounded"]);
  });

  it("refuses `rounded-2xl`, which reads a radius no shape file declares", () => {
    expect(radiusOffenders("fixture.tsx", "const recipe = `p-4\n  hover:rounded-2xl`;")).toEqual(["fixture.tsx:1 hover:rounded-2xl"]);
  });

  it("refuses an arbitrary radius", () => {
    expect(radiusOffenders("fixture.tsx", `const recipe = "rounded-[3px]";`)).toEqual(["fixture.tsx:1 rounded-[3px]"]);
  });

  it("passes the bridged, the derived and the fixed radii", () => {
    expect(
      radiusOffenders("fixture.tsx", `const recipe = "rounded-field rounded-sm rounded-full rounded-none rounded-s-field rounded-[inherit]";`),
    ).toEqual([]);
  });
});

describe("the border width a ui recipe reads", () => {
  it("comes from `--border-width` in every shipped source", () => {
    expect(sources.flatMap(({ file, source }) => borderOffenders(file, source))).toEqual([]);
  });

  it("refuses bare `border`, a fixed 1px, naming the token", () => {
    expect(borderOffenders("fixture.tsx", `const r = "flex border px-1";`)).toEqual(["fixture.tsx:1 border"]);
  });

  it("refuses `border-2`, an arbitrary width and a variant-prefixed `border`", () => {
    expect(borderOffenders("fixture.tsx", `const r = "border-2 border-[3px] hover:border";`)).toEqual([
      "fixture.tsx:1 border-2",
      "fixture.tsx:1 border-[3px]",
      "fixture.tsx:1 hover:border",
    ]);
  });

  it("passes the shape's width, zero, one-sided dividers and border colours", () => {
    expect(
      borderOffenders("fixture.tsx", `const r = "border-field border-0 border-b border-e-2 border-s border-input border-transparent";`),
    ).toEqual([]);
  });

  it("leaves a prose sentence that says border alone", () => {
    expect(borderOffenders("fixture.tsx", `const reason = "the border only bounds them";`)).toEqual([]);
  });
});
