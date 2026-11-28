import { classExpressionVisitor } from "../ast.ts";
import { defineLintRule } from "../report.ts";

const PROSE_CLASS = /(?<![\w-])(?:prose|max-w-prose|leading-relaxed)(?![\w-])/;

const PRETTY = /(?<![\w-])text-pretty(?![\w-])/;

/** A run of prose with no `text-pretty`, which is what leaves an orphan on the last line. */
export const platformTextPretty = defineLintRule("forge-ui-platform-text-pretty", {
  meta: {
    type: "problem",
    docs: { description: "A run of prose avoids the orphan with `text-wrap: pretty` rather than leaving the last line to the browser." },
  },
  create(_context, report) {
    return classExpressionVisitor((found) => {
      const prose = PROSE_CLASS.exec(found.text);
      if (prose === null || PRETTY.test(found.text)) return;
      report(`\`${prose[0]}\` prose with no \`text-pretty\` — avoid the orphan with \`text-wrap: pretty\``, found.loc);
    });
  },
});
