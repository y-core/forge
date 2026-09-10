import { describe, expect, it } from "bun:test";

import { nextLoc, other, runRule } from "../test-support.ts";
import type { AstNode } from "../types.ts";
import { typeImportExternal } from "./type-import-external.ts";

function declared(type: string, name: string): AstNode {
  return { type, loc: nextLoc(), id: { type: "Identifier", loc: nextLoc(), name } } as unknown as AstNode;
}

function exported(declaration?: AstNode): AstNode {
  return { type: "ExportNamedDeclaration", loc: nextLoc(), declaration, children: [] } as unknown as AstNode;
}

const message = (kind: string, name: string) =>
  `\`export ${kind} ${name}\` is declared outside \`types.ts\` — move it to the \`types.ts\` beside this file and import it with its own \`import type\` line (docs/LIBRARY_ARCHITECTURE.md §8).`;

describe("type-import-external", () => {
  it("reports an exported interface", () => {
    expect(runRule(typeImportExternal, exported(declared("TSInterfaceDeclaration", "SessionRow")))).toEqual([message("interface", "SessionRow")]);
  });

  it("reports an exported type alias", () => {
    expect(runRule(typeImportExternal, exported(declared("TSTypeAliasDeclaration", "FactorId")))).toEqual([message("type", "FactorId")]);
  });

  // The barrel's whole job, and the form a repointed re-export takes after the move.
  it("accepts a bare re-export, which declares nothing", () => {
    expect(runRule(typeImportExternal, exported())).toEqual([]);
  });

  it("accepts an exported value declaration", () => {
    expect(runRule(typeImportExternal, exported(declared("FunctionDeclaration", "sign")))).toEqual([]);
  });

  // A local type is the file's own business; only the exported surface has to be findable.
  it("leaves an unexported declaration alone", () => {
    expect(runRule(typeImportExternal, other("TSInterfaceDeclaration"))).toEqual([]);
  });

  it("names the declaration even when the parser gave it no id", () => {
    const anonymous = {
      type: "ExportNamedDeclaration",
      loc: nextLoc(),
      declaration: { type: "TSTypeAliasDeclaration", loc: nextLoc() },
    } as unknown as AstNode;

    expect(runRule(typeImportExternal, anonymous)).toEqual([message("type", "this type")]);
  });
});
