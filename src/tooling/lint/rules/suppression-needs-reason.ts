import type { DisableDirective, LintRule } from "../types.ts";

const named = (directive: DisableDirective): string => (directive.value === "" ? "every rule" : `\`${directive.value}\``);

/** Reports any lint suppression written without a reason. */
export const suppressionNeedsReason: LintRule = {
  meta: {
    type: "problem",
    docs: { description: "Every `oxlint-disable` directive states why, so a suppression can be judged rather than only counted." },
  },
  create(context) {
    return {
      Program(): void {
        for (const directive of context.sourceCode.getDisableDirectives().directives) {
          if (directive.justification.trim() !== "") continue;
          context.report({
            message: `\`oxlint-${directive.type}\` for ${named(directive)} with no reason — append \` -- <why>\`, so the next reader can judge the suppression rather than only count it.`,
            node: directive.node,
          });
        }
      },
    };
  },
};
