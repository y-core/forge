import { attributeNamed, attributesOf, openingTag, statedString } from "../jsx.ts";
import { defineLintRule } from "../report.ts";
import type { AstNode } from "../types.ts";

const LIVE_ROLES = new Set(["alert", "status", "log"]);

const ROUTE = "speak through `announce()` into the page's one `<Announcer />`";

/** A live region opened outside the page's one announcer, whose utterances would then interleave. */
export const a11yOneLiveRegion = defineLintRule("forge-ui-a11y-one-live-region", {
  meta: { type: "problem", docs: { description: "A page has one live region; a second one interleaves its announcements with the first." } },
  create(_context, report) {
    return {
      JSXOpeningElement(node: AstNode): void {
        const liveAttribute = attributeNamed(node, "aria-live");
        if (liveAttribute) {
          const live = statedString(liveAttribute.value);
          if (live !== undefined && live !== "off") report(`\`aria-live="${live}"\` opens a second live region — ${ROUTE}`, node.loc);
          return;
        }
        const roleAttribute = attributeNamed(node, "role");
        if (roleAttribute) {
          const role = statedString(roleAttribute.value);
          if (role !== undefined && LIVE_ROLES.has(role)) report(`\`role="${role}"\` opens a second live region — ${ROUTE}`, node.loc);
          return;
        }
        if (openingTag(node) === "output" && !attributesOf(node).some((attribute) => attribute.type === "JSXSpreadAttribute")) {
          report(
            `\`<output>\` is an implicit \`role="status"\` and opens a second live region — give a readout \`aria-live="off"\`, or ${ROUTE}`,
            node.loc,
          );
        }
      },
    };
  },
});
