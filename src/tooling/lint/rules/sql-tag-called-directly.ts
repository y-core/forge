import { defineLintRule } from "../report.ts";
import type { AstNode, CallNode } from "../types.ts";

/** A call whose callee is the bare identifier `sql`, which builds a `SqlFragment` from whatever text the caller hands it. */
export const sqlTagCalledDirectly = defineLintRule("forge-sql-tag-called-directly", {
  meta: {
    type: "problem",
    docs: {
      description:
        "`sql` called as a function takes its statement text from the caller rather than from a template literal, so every downstream call site trusts text nothing bound — map a choice onto fixed fragments instead.",
    },
  },
  create(_context, report) {
    return {
      CallExpression(node: AstNode) {
        const callee = (node as CallNode).callee as AstNode & { name?: string };
        if (callee?.type !== "Identifier" || callee.name !== "sql") return;
        report(
          "`sql(…)` called as a function builds a fragment from caller text that no `?` binds — write the statement as a `sql`…`` template, and map a column or direction onto fixed fragments.",
          node.loc,
        );
      },
    };
  },
});
