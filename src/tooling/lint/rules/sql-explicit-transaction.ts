import type { AstNode } from "../types.ts";
import type { LintRule } from "../types.ts";
import { sqlTemplateText } from "./sql-text.ts";

const TRANSACTION_KEYWORD = /^(BEGIN|COMMIT|ROLLBACK|END|SAVEPOINT|RELEASE)\b/i;

/** A `sql` fragment whose first statement is `BEGIN`, `COMMIT`, `ROLLBACK`, `END`, `SAVEPOINT` or `RELEASE`. */
export const sqlExplicitTransaction: LintRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "D1 runs every statement inside an implicit transaction and refuses a nested one, so a runtime `sql` fragment never opens or closes a transaction — `batch()` is the boundary.",
    },
  },
  create(context) {
    return {
      TaggedTemplateExpression(node: AstNode) {
        const text = sqlTemplateText(node);
        const keyword = text === undefined ? undefined : TRANSACTION_KEYWORD.exec(text)?.[1]?.toUpperCase();
        if (keyword === undefined) return;
        context.report({
          message: `\`sql\`${keyword} …\`\` opens an explicit transaction, which D1 refuses inside the implicit one it already holds — put the statements in one \`batch()\` instead (docs/STORAGE_BINDINGS.md §1g).`,
          loc: node.loc,
        });
      },
    };
  },
};
