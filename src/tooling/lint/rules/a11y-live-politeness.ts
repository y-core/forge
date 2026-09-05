import { attributeNamed, statedString } from "../jsx.ts";
import { reporter } from "../report.ts";
import type { AstNode, LintRule } from "../types.ts";

/** An `aria-live` that is not `polite`, or an `assertive` that has not stated why it interrupts. */
export const a11yLivePoliteness: LintRule = {
  meta: { type: "problem", docs: { description: "A live region announces politely unless it has stated why it interrupts the reader." } },
  create(context) {
    const report = reporter(context, "forge-ui-a11y-live-politeness");
    return {
      JSXOpeningElement(node: AstNode): void {
        // Only a stated literal is judgeable; a `{expr}` value is resolved at render time.
        const value = statedString(attributeNamed(node, "aria-live")?.value);
        if (value === undefined || value === "polite") return;
        report(
          value === "assertive"
            ? '`aria-live="assertive"` interrupts the reader — state why in a suppression, or use `polite`'
            : `\`aria-live="${value}"\` is neither \`polite\` nor \`assertive\``,
          node.loc,
        );
      },
    };
  },
};
