import { classLiteralVisitor } from "../ast.ts";
import { reporter } from "../report.ts";
import type { LintRule } from "../types.ts";

const BARE_FOCUS = /(?<![\w-])focus:(?=[a-z[])[a-z0-9#%[\]/.-]+/g;

/** A bare `focus:` variant, which paints on a pointer press as well as on a keyboard focus. */
export const interactionFocusVisible: LintRule = {
  meta: {
    type: "problem",
    docs: { description: "Focus styling is written with `focus-visible:`, so a pointer press does not paint a focus ring." },
  },
  create(context) {
    const report = reporter(context, "forge-ui-interaction-focus-visible");
    return classLiteralVisitor((found) => {
      const hits = new Set<string>();
      for (const match of found.text.matchAll(BARE_FOCUS)) hits.add(match[0]);
      for (const hit of hits) report(`\`${hit}\` styles every focus including pointer focus — use \`focus-visible:\``, found.loc);
    });
  },
};
