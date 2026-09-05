import { classExpressionVisitor } from "../ast.ts";
import { reporter } from "../report.ts";
import type { LintRule } from "../types.ts";

const OUTLINE_SUPPRESSOR = /(?<![\w-])(outline-none|outline-hidden)(?![\w-])/;

// `focus-ring` and its `-outset` twin are the `@utility` pair carrying the `focus-visible:` ring;
// `ring-0` draws nothing and `ring-offset-*` carries no width, so neither replaces the outline.
const FOCUS_VISIBLE_RING = /focus-visible[^\s]*:ring(?:-(?!0(?![\w-])|offset)[\w-]+)?(?![\w-])|(?<![\w-])focus-ring(?:-outset)?(?![\w-])/;

const POINTER_TARGET = /(?<![\w-])cursor-pointer(?![\w-])/;

/** `outline-none` on a pointer target with no `focus-visible:` ring put back in its place. */
export const focusRing: LintRule = {
  meta: {
    type: "problem",
    docs: { description: "An outline a class list suppresses is replaced by a `focus-visible:` ring, not simply removed." },
  },
  create(context) {
    const report = reporter(context, "forge-ui-focus-ring");
    return classExpressionVisitor((found) => {
      // `cursor-pointer` is what separates a focus target from a surface: a popup panel suppresses
      // its outline and owes no ring, because nothing focuses it.
      if (!POINTER_TARGET.test(found.text)) return;
      const suppressor = OUTLINE_SUPPRESSOR.exec(found.text);
      if (suppressor === null || FOCUS_VISIBLE_RING.test(found.text)) return;
      report(
        `\`${suppressor[1]}\` on a pointer target with no \`focus-visible:ring-*\` beside it — the affordance is removed, not replaced`,
        found.loc,
      );
    });
  },
};
