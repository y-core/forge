import { classExpressionVisitor } from "../ast.ts";
import { reporter } from "../report.ts";
import type { LintRule } from "../types.ts";

const MOTION_BASE = /^(?:animate-|transition)/;

// `-none` is the settled state the rule asks for, not motion that needs gating.
const SETTLED = new Set(["animate-none", "transition-none"]);

// Gated at the whole class expression, not the token: `motion-reduce:transition-none` beside a
// `transition-*` is how the settled state is given, and forge splits one class list across several
// `cn()` arguments — so the gate and the motion it governs need not sit in the same literal.
const GATED = /(?<![\w-])motion-(?:safe|reduce):/;

/** An `animate-*` or `transition*` utility in a class expression that names neither `motion-safe:`
 *  nor `motion-reduce:` — which is what makes it run whatever the reader has asked for. */
export const reducedMotion: LintRule = {
  meta: {
    type: "problem",
    docs: { description: "Authored motion is written inside `motion-safe:`, with `motion-reduce:` given the settled state." },
  },
  create(context) {
    const report = reporter(context, "forge-ui-reduced-motion");
    return classExpressionVisitor((found) => {
      if (GATED.test(found.text)) return;
      const hits = new Set<string>();
      for (const token of found.text.split(/\s+/)) {
        const base = token.slice(token.lastIndexOf(":") + 1);
        if (MOTION_BASE.test(base) && !SETTLED.has(base)) hits.add(token);
      }
      for (const hit of hits) {
        report(
          `\`${hit}\` runs whatever the reader has asked for — author it inside \`motion-safe:\` and give \`motion-reduce:\` the settled state`,
          found.loc,
        );
      }
    });
  },
};
