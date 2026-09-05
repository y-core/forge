import { attributeNamed, openingTag, statedString } from "../jsx.ts";
import { reporter } from "../report.ts";
import type { AstNode, LintRule } from "../types.ts";

/** `aria-readonly` on a `<button>` or a `role="button"` element, which supports no such state. */
export const a11yNoAriaReadonlyOnButton: LintRule = {
  meta: { type: "problem", docs: { description: "The button role carries no readonly state, so the attribute states nothing a reader hears." } },
  create(context) {
    const report = reporter(context, "forge-ui-a11y-no-aria-readonly-on-button");
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
};
