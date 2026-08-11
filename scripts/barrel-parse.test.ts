import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findPublicSymbols, parseBarrelExportNames, parseBarrelExports, parseConsumerExportNames } from "./barrel-parse";

// The parsers read from disk, so every fixture is a real file. Written under tmpdir rather than
// `src/` so a deliberately-invalid barrel can never be picked up by the gate it is testing.
const FIXTURE_DIR = join(tmpdir(), `forge-barrel-parse-${Date.now()}-${Math.random().toString(36).slice(2)}`);
let counter = 0;

function fixture(source: string): string {
  const path = join(FIXTURE_DIR, `fixture-${counter++}.ts`);
  writeFileSync(path, source, "utf-8");
  return path;
}

/** A set compares exactly only as an ordered list, so an extra name fails as loudly as a missing one. */
function sorted(names: Set<string>): string[] {
  return [...names].sort();
}

beforeAll(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

describe("parseBarrelExports() — export star ban", () => {
  it("flags the namespaced `export * as ns from` form", () => {
    const path = fixture(['export * as patterns from "./patterns";', 'export { hxAttrs } from "./htmx-attrs";', ""].join("\n"));

    expect(parseBarrelExports(path).hasExportStar).toBe(true);
  });

  it("flags the bare `export * from` form", () => {
    const path = fixture(['export * from "./patterns";', ""].join("\n"));

    expect(parseBarrelExports(path).hasExportStar).toBe(true);
  });

  it("leaves a barrel of named exports unflagged", () => {
    const path = fixture(
      [
        'export { hxAttrs } from "./htmx-attrs";',
        'export type { HxAttrs } from "./htmx-attrs";',
        'export { isHxRequest } from "./hx-request";',
        "",
      ].join("\n"),
    );
    const result = parseBarrelExports(path);

    expect(result.hasExportStar).toBe(false);
    expect(result.values).toEqual(["hxAttrs", "isHxRequest"]);
    expect(result.hasTypeExports).toBe(true);
  });

  it("leaves an identifier that merely contains the words unflagged", () => {
    const path = fixture(['export { exportStarFrom } from "./names";', "export const starFromRatio = 1;", ""].join("\n"));

    expect(parseBarrelExports(path).hasExportStar).toBe(false);
  });

  it("leaves a star re-export that is commented out unflagged", () => {
    const path = fixture(['// export * as patterns from "./patterns";', 'export { hxAttrs } from "./htmx-attrs";', ""].join("\n"));

    expect(parseBarrelExports(path).hasExportStar).toBe(false);
  });

  // Banned as of the §1b amendment. Erasure at emit removes only the circular-dependency harm;
  // the surface leak and the ungreppable API remain, and a barrel of nothing but `export type *`
  // used to fail as "no value exports found in barrel" — true, but not what is wrong with it.
  it("flags the type-only `export type * from` form", () => {
    const path = fixture(['export type * from "./types";', 'export { hxAttrs } from "./htmx-attrs";', ""].join("\n"));

    expect(parseBarrelExports(path).hasExportStar).toBe(true);
  });

  it("flags the type-only namespaced `export type * as ns from` form", () => {
    const path = fixture(['export type * as types from "./types";', 'export { hxAttrs } from "./htmx-attrs";', ""].join("\n"));

    expect(parseBarrelExports(path).hasExportStar).toBe(true);
  });

  it("leaves a named type re-export unflagged — only the star form is banned", () => {
    const path = fixture(['export type { HxAttrs, HxRequest } from "./types";', 'export { hxAttrs } from "./htmx-attrs";', ""].join("\n"));
    const result = parseBarrelExports(path);

    expect(result.hasExportStar).toBe(false);
    expect(result.hasTypeExports).toBe(true);
  });

  it("leaves a type-only star re-export that is commented out unflagged", () => {
    const path = fixture(['// export type * from "./types";', 'export { hxAttrs } from "./htmx-attrs";', ""].join("\n"));

    expect(parseBarrelExports(path).hasExportStar).toBe(false);
  });
});

describe("findPublicSymbols() — TSDoc block extent", () => {
  it("finds the symbol when the tag sits more than nine lines above the declaration", () => {
    const path = fixture(
      [
        "/**",
        " * Renders a fragment.",
        " *",
        " * @public",
        " * @param one - first",
        " * @param two - second",
        " * @param three - third",
        " * @param four - fourth",
        " * @param five - fifth",
        " * @param six - sixth",
        " * @param seven - seventh",
        " * @returns the fragment",
        " */",
        "export function renderFragment(): string {",
        '  return "";',
        "}",
        "",
      ].join("\n"),
    );

    expect(findPublicSymbols(path)).toEqual(["renderFragment"]);
  });

  it("finds the symbol behind a one-line TSDoc block", () => {
    const path = fixture(["/** Reads a field. @public */", 'export const readField = (): string => "";', ""].join("\n"));

    expect(findPublicSymbols(path)).toEqual(["readField"]);
  });

  it("finds the symbol behind a short multi-line TSDoc block", () => {
    const path = fixture(["/**", " * Reads a field.", " * @public", " */", 'export const readField = (): string => "";', ""].join("\n"));

    expect(findPublicSymbols(path)).toEqual(["readField"]);
  });

  it("skips an intervening biome-ignore comment line", () => {
    const path = fixture(
      [
        "/** Reads a field. @public */",
        "// biome-ignore lint/suspicious/noExplicitAny: fixture",
        "export const readField = (value: any): string => value;",
        "",
      ].join("\n"),
    );

    expect(findPublicSymbols(path)).toEqual(["readField"]);
  });

  it("binds to the declaration rather than to an export inside the block's @example", () => {
    const path = fixture(
      [
        "/**",
        " * Builds a config.",
        " *",
        " * @public",
        " * @example",
        " * ```ts",
        " * export const example = buildConfig();",
        " * ```",
        " */",
        "export function buildConfig(): string {",
        '  return "";',
        "}",
        "",
      ].join("\n"),
    );

    expect(findPublicSymbols(path)).toEqual(["buildConfig"]);
  });

  it("finds nothing in a file with no @public tag", () => {
    const path = fixture(["/**", " * Reads a field.", " */", 'export const readField = (): string => "";', ""].join("\n"));

    expect(findPublicSymbols(path)).toEqual([]);
  });

  it("finds nothing when a @public tag is followed by no declaration at all", () => {
    const path = fixture(["/**", " * A module of constants. @public", " */", "", "const INTERNAL = 1;", ""].join("\n"));

    expect(findPublicSymbols(path)).toEqual([]);
  });
});

describe("parseConsumerExportNames() — the exported side of a re-export", () => {
  // The pair is asserted in one case on purpose: the divergence is the reason both functions
  // exist, and split across two tests each half reads as an arbitrary choice rather than a
  // contract. `validate-exports` matches a `@public` symbol as declared, so it needs both sides;
  // `validate-design` matches what a corpus `import { … }` may name, so it needs only the right.
  it("registers only the aliased name, where parseBarrelExportNames registers both sides", () => {
    const path = fixture(['export { Skeleton as SkeletonRenamed } from "./skeleton";', ""].join("\n"));

    expect(sorted(parseBarrelExportNames(path))).toEqual(["Skeleton", "SkeletonRenamed"]);
    expect(sorted(parseConsumerExportNames(path))).toEqual(["SkeletonRenamed"]);
  });

  it("yields the same single name from both for a plain re-export", () => {
    const path = fixture(['export { Card } from "./card";', ""].join("\n"));

    expect(sorted(parseBarrelExportNames(path))).toEqual(["Card"]);
    expect(sorted(parseConsumerExportNames(path))).toEqual(["Card"]);
  });

  it("collects a type re-export in the block form", () => {
    const path = fixture(['export type { AlertVariant } from "./alert";', ""].join("\n"));

    expect(sorted(parseBarrelExportNames(path))).toEqual(["AlertVariant"]);
    expect(sorted(parseConsumerExportNames(path))).toEqual(["AlertVariant"]);
  });

  it("collects a type re-export in the inline form alongside its value sibling", () => {
    const path = fixture(['export { Alert, type AlertVariant } from "./alert";', ""].join("\n"));

    expect(sorted(parseBarrelExportNames(path))).toEqual(["Alert", "AlertVariant"]);
    expect(sorted(parseConsumerExportNames(path))).toEqual(["Alert", "AlertVariant"]);
  });

  it("registers only the aliased name for an inline type specifier with `as`", () => {
    const path = fixture(['export { type ToggleGroupType as TGType } from "./toggle-group";', ""].join("\n"));

    expect(sorted(parseBarrelExportNames(path))).toEqual(["TGType", "ToggleGroupType"]);
    expect(sorted(parseConsumerExportNames(path))).toEqual(["TGType"]);
  });

  // No alias is possible in a declaration position, so the two functions cannot diverge here.
  it("collects inline declarations identically from both", () => {
    const path = fixture(
      ["export const cn = (value: string): string => value;", "export function foo(): void {}", "export interface Bar {}", ""].join("\n"),
    );

    expect(sorted(parseBarrelExportNames(path))).toEqual(["Bar", "cn", "foo"]);
    expect(sorted(parseConsumerExportNames(path))).toEqual(["Bar", "cn", "foo"]);
  });

  it("collects a multi-line brace group mixing plain, aliased and type specifiers", () => {
    const path = fixture(
      [
        "export {",
        "  Button,",
        "  Skeleton as SkeletonRenamed,",
        "  type CardProps,",
        "  type ToggleGroupType as TGType,",
        '} from "./ui";',
        "",
      ].join("\n"),
    );

    expect(sorted(parseBarrelExportNames(path))).toEqual(["Button", "CardProps", "Skeleton", "SkeletonRenamed", "TGType", "ToggleGroupType"]);
    expect(sorted(parseConsumerExportNames(path))).toEqual(["Button", "CardProps", "SkeletonRenamed", "TGType"]);
  });

  it("ignores an export that appears only inside a line comment", () => {
    const path = fixture(
      ['// export { Ghost } from "./ghost";', "// export const ghostConst = 1;", 'export { Card } from "./card";', ""].join("\n"),
    );

    expect(sorted(parseBarrelExportNames(path))).toEqual(["Card"]);
    expect(sorted(parseConsumerExportNames(path))).toEqual(["Card"]);
  });
});
