import { attributeNamed, openingTag, statedString } from "../jsx.ts";
import { defineLintRule } from "../report.ts";
import type { AstNode } from "../types.ts";

/** `aria-readonly` on a `<button>` or a `role="button"` element, which supports no such state. */
export const a11yNoAriaReadonlyOnButton = defineLintRule("forge-ui-a11y-no-aria-readonly-on-button", {
  meta: { type: "problem", docs: { description: "The button role carries no readonly state, so the attribute states nothing a reader hears." } },
  create(_context, report) {
    return {
      JSXOpeningElement(node: AstNode): void {
        if (attributeNamed(node, "aria-readonly") === undefined) return;
        const tag = openingTag(node);
        if (tag !== "button" && tag !== "Button" && statedString(attributeNamed(node, "role")?.value) !== "button") return;
        report(
          `\`aria-readonly\` on \`<${tag}>\` — the button role does not support it; carry the state on the control the button acts on`,
          node.loc,
        );
      },
    };
  },
});
