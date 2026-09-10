import { describe, expect, it } from "bun:test";

import { nextLoc, runRule } from "../test-support.ts";
import type { AstNode } from "../types.ts";
import { typeImportSeparation } from "./type-import-separation.ts";

function specifier(name: string, importKind = "value"): AstNode {
  return { type: "ImportSpecifier", loc: nextLoc(), importKind, local: { type: "Identifier", loc: nextLoc(), name } } as unknown as AstNode;
}

function statement(importKind: string, ...specifiers: AstNode[]): AstNode {
  return { type: "ImportDeclaration", loc: nextLoc(), importKind, specifiers, children: [] } as unknown as AstNode;
}

const message = (named: string) =>
  `${named} rides in on a value import as an inline \`type\` specifier — give the type its own \`import type { … }\` line, so what this file needs at runtime is legible from the import block alone (docs/LIBRARY_ARCHITECTURE.md §8).`;

describe("type-import-separation", () => {
  it("reports a type specifier mixed into a value import", () => {
    expect(runRule(typeImportSeparation, statement("value", specifier("parse"), specifier("Options", "type")))).toEqual([message("`Options`")]);
  });

  it("names every inline type specifier of the statement", () => {
    const mixed = statement("value", specifier("parse"), specifier("Options", "type"), specifier("Result", "type"));

    expect(runRule(typeImportSeparation, mixed)).toEqual([message("`Options`, `Result`")]);
  });

  // The form the rule exists to produce.
  it("accepts a standalone `import type` statement", () => {
    expect(runRule(typeImportSeparation, statement("type", specifier("Options"), specifier("Result")))).toEqual([]);
  });

  it("accepts a value-only import", () => {
    expect(runRule(typeImportSeparation, statement("value", specifier("parse")))).toEqual([]);
  });

  it("accepts a side-effect import, which names nothing", () => {
    expect(runRule(typeImportSeparation, statement("value"))).toEqual([]);
  });
});
