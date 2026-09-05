import { classExpressionVisitor } from "../ast.ts";
import { reporter } from "../report.ts";
import type { AstNode, IdentifierNode, LintRule } from "../types.ts";

const HEADING_TAG = /^h[1-6]$/;

const TEXT_SIZE = /(?<![\w-])text-(?:xs|sm|base|lg|xl|[2-9]xl)(?![\w-])/;

/** The `h1`–`h6` tag a class position sits on, or `undefined` when it sits on anything else. */
function headingTag(position: AstNode): string | undefined {
  if (position.type !== "JSXAttribute") return undefined;
  const element = position.parent ?? undefined;
  if (element?.type !== "JSXOpeningElement") return undefined;
  const name = (element as unknown as { name: IdentifierNode }).name;
  return name.type === "JSXIdentifier" && HEADING_TAG.test(name.name) ? name.name : undefined;
}

/** An `<h1>`–`<h6>` whose size comes from the tag, which is what turns a size choice into a skip. */
export const a11yHeadingSizeByClass: LintRule = {
  meta: {
    type: "problem",
    docs: {
      description: "A heading's size comes from a `text-*` class, so its level can follow the section's position rather than the size wanted.",
    },
  },
  create(context) {
    const report = reporter(context, "forge-ui-a11y-heading-size-by-class");
    return classExpressionVisitor((found) => {
      const tag = headingTag(found.node);
      if (tag === undefined || TEXT_SIZE.test(found.text)) return;
      report(
        `\`<${tag}>\` takes its size from the tag — set the size with a \`text-*\` class and the level from the section's position`,
        found.loc,
      );
    });
  },
};
