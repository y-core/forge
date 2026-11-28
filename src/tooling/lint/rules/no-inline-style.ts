import { defineLintRule } from "../report.ts";
import type { AstNode, JsxAttributeNode } from "../types.ts";

/** An inline `style=` attribute, which forge's SSR renderer drops rather than serializing. */
export const noInlineStyle = defineLintRule("forge-ui-no-inline-style", {
  meta: { type: "problem", docs: { description: "A visual rule is expressed as a class; the renderer drops an inline `style` attribute." } },
  create(_context, report) {
    return {
      JSXAttribute(node: AstNode): void {
        if ((node as JsxAttributeNode).name?.name !== "style") return;
        report("`style=` attribute — the renderer drops it; express the rule as a class", node.loc);
      },
    };
  },
});
