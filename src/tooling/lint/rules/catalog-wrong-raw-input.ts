import { attributeNamed, openingTag, statedString } from "../jsx.ts";
import { defineLintRule } from "../report.ts";
import type { AstNode } from "../types.ts";

const RAW_CONTROLS = new Set(["select", "input", "textarea", "button"]);

/** A raw form control in composed markup, where the `ui/core` component wrapping it belongs. */
export const catalogWrongRawInput = defineLintRule("forge-ui-catalog-wrong-raw-input", {
  meta: { type: "problem", docs: { description: "Composed markup renders the component the corpus points at, never the raw control it wraps." } },
  create(_context, report) {
    return {
      JSXOpeningElement(node: AstNode): void {
        const tag = openingTag(node);
        if (!RAW_CONTROLS.has(tag)) return;
        if (tag === "input" && statedString(attributeNamed(node, "type")?.value) === "hidden") return;
        report(`raw \`<${tag}>\` in composed markup — render the \`ui/core\` component the corpus points at`, node.loc);
      },
    };
  },
});
