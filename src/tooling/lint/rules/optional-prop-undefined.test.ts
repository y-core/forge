import { describe, expect, it } from "bun:test";

import { nextLoc, runRule } from "../test-support.ts";
import type { AstNode } from "../types.ts";
import { optionalPropUndefined } from "./optional-prop-undefined.ts";

const CORPUS = "(forge-ui-optional-prop-undefined — src/ui/design/reference/10-accessibility.md)";

function keyword(type: string): AstNode {
  return { type, loc: nextLoc() } as AstNode;
}

function union(...types: AstNode[]): AstNode {
  return { type: "TSUnionType", loc: nextLoc(), types } as unknown as AstNode;
}

function property(name: string, annotation: AstNode | undefined, optional = true): AstNode {
  return {
    type: "TSPropertySignature",
    loc: nextLoc(),
    optional,
    key: { type: "Identifier", loc: nextLoc(), name },
    typeAnnotation: annotation === undefined ? undefined : { typeAnnotation: annotation },
  } as unknown as AstNode;
}

const message = (name: string) =>
  `\`${name}?:\` omits \`| undefined\` — a consumer must then spread it conditionally, which no a11y rule can see through ${CORPUS}`;

describe("optional-prop-undefined", () => {
  it("reports an optional property whose type is a bare keyword", () => {
    expect(runRule(optionalPropUndefined, property("size", keyword("TSStringKeyword")))).toEqual([message("size")]);
  });

  it("reports an optional property whose union omits undefined", () => {
    expect(runRule(optionalPropUndefined, property("tone", union(keyword("TSStringKeyword"), keyword("TSNumberKeyword"))))).toEqual([
      message("tone"),
    ]);
  });

  it("accepts a union that admits undefined", () => {
    expect(runRule(optionalPropUndefined, property("label", union(keyword("TSStringKeyword"), keyword("TSUndefinedKeyword"))))).toEqual([]);
  });

  it("accepts a nested union that admits undefined one level down", () => {
    const nested = union(keyword("TSStringKeyword"), union(keyword("TSNumberKeyword"), keyword("TSUndefinedKeyword")));

    expect(runRule(optionalPropUndefined, property("align", nested))).toEqual([]);
  });

  it("leaves a required property alone, which the flag does not reach", () => {
    expect(runRule(optionalPropUndefined, property("name", keyword("TSStringKeyword"), false))).toEqual([]);
  });

  // `any` and `unknown` already include `undefined`, so demanding the union would be noise.
  it("accepts any and unknown", () => {
    expect(runRule(optionalPropUndefined, property("a", keyword("TSAnyKeyword")))).toEqual([]);
    expect(runRule(optionalPropUndefined, property("b", keyword("TSUnknownKeyword")))).toEqual([]);
  });

  it("accepts a property with no annotation at all, which states no type to widen", () => {
    expect(runRule(optionalPropUndefined, property("c", undefined))).toEqual([]);
  });
});
