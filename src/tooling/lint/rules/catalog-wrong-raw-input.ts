import { openingTag } from "../jsx.ts";
import { reporter } from "../report.ts";
import type { AstNode, LintRule } from "../types.ts";

const RAW_CONTROLS = new Set(["select", "input", "textarea", "button"]);

/** A raw form control written where a `ui/core` component is the thing being demonstrated. */
export const catalogWrongRawInput: LintRule = {
  meta: { type: "problem", docs: { description: "The showcase renders the component the corpus points at, never the raw control it wraps." } },
  create(context) {
    const report = reporter(context, "forge-ui-catalog-wrong-raw-input");
    return {
      JSXOpeningElement(node: AstNode): void {
        const tag = openingTag(node);
        if (!RAW_CONTROLS.has(tag)) return;
        report(`raw \`<${tag}>\` in the showcase — render the \`ui/core\` component the corpus points at`, node.loc);
      },
    };
  },
};
