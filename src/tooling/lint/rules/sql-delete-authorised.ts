import type { AstNode, LintRule } from "../types.ts";
import { sqlStatementVerb, sqlTemplateText } from "./sql-text.ts";

const AUTHORISATION = /^\s*row-removal-authorised-by:\s*\S/;

/** A `sql` fragment whose statement is a `DELETE`, with no `// row-removal-authorised-by: <who or why>` on the line before it. */
export const sqlDeleteAuthorised: LintRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "An application DELETE removes rows for good, so each one names who authorised it on the line before the `sql` fragment that runs it.",
    },
  },
  create(context) {
    const authorisedLines = new Set(
      (context.sourceCode.getAllComments?.() ?? [])
        .filter((comment) => comment.type === "Line" && AUTHORISATION.test(comment.value))
        .map((comment) => comment.loc.end.line),
    );
    return {
      TaggedTemplateExpression(node: AstNode) {
        const text = sqlTemplateText(node);
        if (text === undefined || sqlStatementVerb(text) !== "DELETE") return;
        if (authorisedLines.has(node.loc.start.line - 1)) return;
        context.report({
          message:
            "a `sql` DELETE removes rows for good — say who authorised it in a `// row-removal-authorised-by: <who or why>` comment on the line before the fragment.",
          loc: node.loc,
        });
      },
    };
  },
};
