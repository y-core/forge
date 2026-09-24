import { attributeNamed, statedString } from "../jsx.ts";
import { reporter } from "../report.ts";
import type { AstNode, LintRule } from "../types.ts";

/** A live region opened outside the page's one announcer, whose utterances would then interleave. */
export const a11yOneLiveRegion: LintRule = {
  meta: { type: "problem", docs: { description: "A page has one live region; a second one interleaves its announcements with the first." } },
  create(context) {
    const report = reporter(context, "forge-ui-a11y-one-live-region");
    return {
      JSXOpeningElement(node: AstNode): void {
        const value = statedString(attributeNamed(node, "aria-live")?.value);
        if (value === undefined || value === "off") return;
        report(
          `\`aria-live="${value}"\` opens a second live region — route the announcement into \`Toast.Container\` or \`FlashContainer\``,
          node.loc,
        );
      },
    };
  },
};
