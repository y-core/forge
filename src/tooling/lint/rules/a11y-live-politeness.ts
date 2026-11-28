import { attributeNamed, statedString } from "../jsx.ts";
import { defineLintRule } from "../report.ts";
import type { AstNode } from "../types.ts";

/** An `aria-live` that is not `polite`, or an `assertive` that has not stated why it interrupts. */
export const a11yLivePoliteness = defineLintRule("forge-ui-a11y-live-politeness", {
  meta: { type: "problem", docs: { description: "A live region announces politely unless it has stated why it interrupts the reader." } },
  create(_context, report) {
    return {
      JSXOpeningElement(node: AstNode): void {
        // Only a stated literal is judgeable; a `{expr}` value is resolved at render time.
        const value = statedString(attributeNamed(node, "aria-live")?.value);
        if (value === undefined || value === "polite" || value === "off") return;
        report(
          value === "assertive"
            ? '`aria-live="assertive"` interrupts the reader — state why in a suppression, or use `polite`'
            : `\`aria-live="${value}"\` is neither \`polite\` nor \`assertive\``,
          node.loc,
        );
      },
    };
  },
});
