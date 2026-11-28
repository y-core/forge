import { openingTag } from "../jsx.ts";
import { defineLintRule } from "../report.ts";
import type { AstNode } from "../types.ts";

/** The `Filter` element a chip sits in, taking the nearest of the two so a wrapped chip reports its group. */
function enclosingFilterTag(node: AstNode): string | undefined {
  for (let current = node.parent ?? undefined; current !== undefined; current = current.parent ?? undefined) {
    if (current.type !== "JSXElement") continue;
    const tag = openingTag((current as unknown as { openingElement: AstNode }).openingElement);
    if (tag === "Filter" || tag === "Filter.Group") return tag;
  }
  return undefined;
}

/** A `<Filter.Item>` reached from a `<Filter>` with no `<Filter.Group>` between them. */
export const interactionFilterGroupRequired = defineLintRule("forge-ui-interaction-filter-group-required", {
  meta: {
    type: "problem",
    docs: { description: "A filter chip sits in a `Filter.Group`, which is the element carrying the radiogroup and its name." },
  },
  create(_context, report) {
    return {
      JSXOpeningElement(node: AstNode): void {
        if (openingTag(node) !== "Filter.Item") return;
        if (enclosingFilterTag(node) !== "Filter") return;
        report("`<Filter.Item>` outside a `<Filter.Group>` — the chips are loose radios named by nothing", node.loc);
      },
    };
  },
});
