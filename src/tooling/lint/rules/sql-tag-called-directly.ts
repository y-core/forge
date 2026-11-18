import type { AstNode, CallNode, LintRule } from "../types.ts";

/** A call whose callee is the bare identifier `sql`, which builds a `SqlFragment` from whatever text the caller hands it. */
export const sqlTagCalledDirectly: LintRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "`sql` called as a function takes its statement text from the caller rather than from a template literal, so every downstream call site trusts text nothing bound — map a choice onto fixed fragments instead.",
    },
  },
  create(context) {
    return {
      CallExpression(node: AstNode) {
        const callee = (node as CallNode).callee as AstNode & { name?: string };
        if (callee?.type !== "Identifier" || callee.name !== "sql") return;
        context.report({
          message:
            "`sql(…)` called as a function builds a fragment from caller text that no `?` binds — write the statement as a `sql`…`` template, and map a column or direction onto fixed fragments (docs/STORAGE_BINDINGS.md §1b).",
          loc: node.loc,
        });
      },
    };
  },
};
