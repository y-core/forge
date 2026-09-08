import { describe, expect, it } from "bun:test";

import {
  findPublicSymbols,
  parseBarrelExportNames,
  parseBarrelExports,
  parseCallableExports,
  parseConsumerExportNames,
  parseTypeExportNames,
} from "./barrel-parse";

function fixture(source: string): string {
  return source;
}

function sorted(names: Set<string>): string[] {
  return [...names].sort();
}

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

  it("skips an intervening lint-suppression comment line", () => {
    const path = fixture(
      [
        "/** Reads a field. @public */",
        "// oxlint-disable-next-line typescript/no-explicit-any -- fixture",
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

  it("ignores an export that appears only inside a block comment", () => {
    const path = fixture(['/* export { Ghost } from "./ghost"; */', 'export { Card } from "./card";', ""].join("\n"));

    expect(sorted(parseBarrelExportNames(path))).toEqual(["Card"]);
    expect(sorted(parseConsumerExportNames(path))).toEqual(["Card"]);
  });

  it("ignores an export that appears only inside a line comment", () => {
    const path = fixture(
      ['// export { Ghost } from "./ghost";', "// export const ghostConst = 1;", 'export { Card } from "./card";', ""].join("\n"),
    );

    expect(sorted(parseBarrelExportNames(path))).toEqual(["Card"]);
    expect(sorted(parseConsumerExportNames(path))).toEqual(["Card"]);
  });
});

describe("parseTypeExportNames() — the type half of a barrel", () => {
  it("reads a `export type { … }` block, alias resolved", () => {
    const path = fixture(['export type { CardProps, ToggleGroupType as TGType } from "./ui";', ""].join("\n"));

    expect(sorted(parseTypeExportNames(path))).toEqual(["CardProps", "TGType"]);
  });

  it("reads a `type` marker inside a value block and leaves the values out", () => {
    const path = fixture(['export { Button, type CardProps, type Size as ControlSize } from "./ui";', ""].join("\n"));

    expect(sorted(parseTypeExportNames(path))).toEqual(["CardProps", "ControlSize"]);
  });

  it("reads a local `interface` and `type` declaration and no other declaration form", () => {
    const path = fixture(
      ["export interface GlyphEntry {}", "export type GlyphSource = string;", "export const NAMES = [];", "export function parse() {}", ""].join(
        "\n",
      ),
    );

    expect(sorted(parseTypeExportNames(path))).toEqual(["GlyphEntry", "GlyphSource"]);
  });

  it("names nothing a plain value barrel exports, so the values are the difference", () => {
    const path = fixture(['export { Card } from "./card";', ""].join("\n"));

    expect(sorted(parseTypeExportNames(path))).toEqual([]);
    expect(sorted(parseConsumerExportNames(path))).toEqual(["Card"]);
  });
});

describe("parseCallableExports() — the claim a declaration file makes", () => {
  const callable: [string, string, string][] = [
    ["a function declaration", "export function alpha(): void {}", "alpha"],
    ["an async function declaration", "export async function alpha(): Promise<void> {}", "alpha"],
    ["a class declaration", "export class Alpha {}", "Alpha"],
    ["a default function", "export default function alpha(): void {}", "alpha"],
    ["a default class", "export default class Alpha {}", "Alpha"],
    ["a const bound to an arrow", "export const alpha = () => {};", "alpha"],
    ["a const bound to an async arrow", "export const alpha = async () => {};", "alpha"],
    ["an annotated const bound to an arrow", "export const alpha: Handler = (a) => a;", "alpha"],
    ["a const bound to a function expression", "export const alpha = function () {};", "alpha"],
    ["a const bound to an async function expression", "export const alpha = async function () {};", "alpha"],
    ["a const bound to a single-parameter arrow", "export const alpha = (a) => a;", "alpha"],
    ["a const whose annotation is itself a function type", "export const alpha: (a: number) => void = (a) => {};", "alpha"],
  ];

  for (const [label, source, name] of callable) {
    it(`finds ${label}`, () => {
      expect([...parseCallableExports(fixture(source))]).toEqual([name]);
    });
  }

  const declared: [string, string][] = [
    ["an object literal", "export const TABLE = { a: 1 };"],
    ["an object literal holding a method", "export const rule: LintRule = { create() {} };"],
    ["an interface", "export interface Thing {\n  a: number;\n}"],
    ["a type alias of a function", "export type Handler = (a: number) => void;"],
    ["a string constant", 'export const NAME = "alpha";'],
    ["an array of records", "export const PAIRS = [{ a: 1 }];"],
  ];

  for (const [label, source] of declared) {
    it(`finds nothing in ${label}`, () => {
      expect([...parseCallableExports(fixture(source))]).toEqual([]);
    });
  }

  it("finds nothing in a callable that is commented out", () => {
    expect([...parseCallableExports(fixture("// export function alpha(): void {}\n/* export class Alpha {} */\n"))]).toEqual([]);
  });

  it("finds an unnamed default export by its kind, so it is still reported", () => {
    expect([...parseCallableExports(fixture("export default function () {}"))]).toEqual(["default function"]);
  });
});
