import { containsTag, enclosingElement, openingTag } from "../jsx.ts";
import { reporter } from "../report.ts";
import type { AstNode, LintRule } from "../types.ts";

/** A `<Card>` opened inside a `<Card.Content>` — a nesting the surface has no way to express. */
export const noNestedCard: LintRule = {
  meta: { type: "problem", docs: { description: "A card is not nested inside another card's content, where the two borders compound." } },
  create(context) {
    const report = reporter(context, "forge-ui-no-nested-card");
    return {
      JSXOpeningElement(node: AstNode): void {
        if (openingTag(node) !== "Card.Content") return;
        const element = enclosingElement(node);
        if (element === undefined || !containsTag(element, (tag) => tag === "Card")) return;
        report("`<Card>` nested inside `<Card.Content>` — the borders compound rather than nest", node.loc);
      },
    };
  },
};
