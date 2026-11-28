import { classExpressionVisitor } from "../ast.ts";
import { defineLintRule } from "../report.ts";

const HEADING_SIZE = /(?<![\w-])text-[2-9]xl(?![\w-])/;

const BALANCED = /(?<![\w-])text-balance(?![\w-])/;

/** A display-sized heading with no `text-balance`, whose last line is left to fall where it may. */
export const platformTextBalance = defineLintRule("forge-ui-platform-text-balance", {
  meta: {
    type: "problem",
    docs: {
      description: "A display-sized heading balances its line breaks with `text-wrap: balance` rather than breaking wherever the width lands.",
    },
  },
  create(_context, report) {
    return classExpressionVisitor((found) => {
      const heading = HEADING_SIZE.exec(found.text);
      if (heading === null || BALANCED.test(found.text)) return;
      report(`\`${heading[0]}\` heading with no \`text-balance\` — balance the line breaks with \`text-wrap: balance\``, found.loc);
    });
  },
});
