import type { AstNode, TemplateLiteralNode } from "../types.ts";
import type { LintRule } from "../types.ts";

/** A `tag\`…\`` expression: the tag it calls, and the template it hands over. */
interface TaggedTemplateNode extends AstNode {
  tag: AstNode & { name?: string | undefined };
  quasi: TemplateLiteralNode;
}

const TRANSACTION_KEYWORD = /^(BEGIN|COMMIT|ROLLBACK|END|SAVEPOINT|RELEASE)\b/i;
const LEADING_NOISE = /^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/;

/** The first statement's leading keyword, when it opens or closes a transaction. */
function transactionKeywordOf(node: TaggedTemplateNode): string | undefined {
  const first = node.quasi.quasis[0];
  if (first === undefined) return undefined;
  const text = (first.value.cooked ?? first.value.raw).replace(LEADING_NOISE, "");
  return TRANSACTION_KEYWORD.exec(text)?.[1]?.toUpperCase();
}

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
        const tagged = node as TaggedTemplateNode;
        if (tagged.tag.type !== "Identifier" || tagged.tag.name !== "sql") return;
        const keyword = transactionKeywordOf(tagged);
        if (keyword === undefined) return;
        context.report({
          message: `\`sql\`${keyword} …\`\` opens an explicit transaction, which D1 refuses inside the implicit one it already holds — put the statements in one \`batch()\` instead (docs/STORAGE_BINDINGS.md §1g).`,
          loc: node.loc,
        });
      },
    };
  },
};
