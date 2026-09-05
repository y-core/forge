import { attributeNamed, containsTag, enclosingElement, openingTag } from "../jsx.ts";
import { reporter } from "../report.ts";
import type { AstNode, LintRule } from "../types.ts";

const LABEL_CONTROLS = new Set([
  "input",
  "select",
  "textarea",
  "button",
  "meter",
  "progress",
  "Input",
  "Select",
  "Textarea",
  "Switch",
  "Slider",
  "NumberField",
  "Toggle",
]);

/** A `<label>` that neither carries `for` nor wraps its control — styled text that focuses nothing. */
export const a11yLabelAssociation: LintRule = {
  meta: { type: "problem", docs: { description: "A label names a control, by `for` or by wrapping it; otherwise it labels nothing." } },
  create(context) {
    const report = reporter(context, "forge-ui-a11y-label-association");
    return {
      JSXOpeningElement(node: AstNode): void {
        if (openingTag(node) !== "label") return;
        if (attributeNamed(node, "for") !== undefined || attributeNamed(node, "htmlFor") !== undefined) return;
        // A self-closing label has no children, so wrapping cannot be what associates it.
        const element = enclosingElement(node);
        if (element !== undefined && containsTag(element, (tag) => LABEL_CONTROLS.has(tag))) return;
        report("`<label>` with neither a `for` nor a wrapped control — it labels nothing", node.loc);
      },
    };
  },
};
