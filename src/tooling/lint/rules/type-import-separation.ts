import type { AstNode, LintRule } from "../types.ts";

/** One name of an import statement; `importKind` is `"type"` for an inline `type X` specifier. */
interface SpecifierNode extends AstNode {
  importKind?: string | undefined;
  local?: { name?: string | undefined } | undefined;
}

/** An `import …` statement, `"type"` when the whole statement is `import type`. */
interface ImportNode extends AstNode {
  importKind?: string | undefined;
  specifiers?: readonly SpecifierNode[] | undefined;
}

/** A type smuggled into a value import as an inline `type` specifier. */
export const typeImportSeparation: LintRule = {
  meta: {
    type: "problem",
    docs: {
      description: "A type is imported on its own `import type` line, so what a file needs at runtime is legible from the import block alone.",
    },
  },
  create(context) {
    return {
      ImportDeclaration(node: AstNode) {
        const statement = node as ImportNode;
        if (statement.importKind === "type") return;
        const inline = (statement.specifiers ?? []).filter((specifier) => specifier.importKind === "type");
        if (inline.length === 0) return;
        const named = inline.map((specifier) => `\`${specifier.local?.name ?? "?"}\``).join(", ");
        context.report({
          message: `${named} rides in on a value import as an inline \`type\` specifier — give the type its own \`import type { … }\` line, so what this file needs at runtime is legible from the import block alone (docs/LIBRARY_ARCHITECTURE.md §8).`,
          loc: node.loc,
        });
      },
    };
  },
};
