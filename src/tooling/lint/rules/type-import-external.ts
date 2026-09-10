import type { AstNode, LintRule } from "../types.ts";

/** An `export …` statement, whose `declaration` is absent when it only re-exports names. */
interface ExportNode extends AstNode {
  declaration?: (AstNode & { id?: { name?: string | undefined } | undefined }) | null | undefined;
}

const DECLARED = new Set(["TSInterfaceDeclaration", "TSTypeAliasDeclaration"]);

const kindOf = (type: string): string => (type === "TSInterfaceDeclaration" ? "interface" : "type");

/** An exported interface or type alias declared somewhere other than a `types.ts`. */
export const typeImportExternal: LintRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "A namespace's exported types are declared in one `types.ts` per directory, so a shape can be found from its name rather than from the file that happens to use it.",
    },
  },
  create(context) {
    return {
      ExportNamedDeclaration(node: AstNode) {
        const declaration = (node as ExportNode).declaration;
        if (declaration === undefined || declaration === null || !DECLARED.has(declaration.type)) return;
        const name = declaration.id?.name ?? "this type";
        context.report({
          message: `\`export ${kindOf(declaration.type)} ${name}\` is declared outside \`types.ts\` — move it to the \`types.ts\` beside this file and import it with its own \`import type\` line (docs/LIBRARY_ARCHITECTURE.md §8).`,
          loc: node.loc,
        });
      },
    };
  },
};
