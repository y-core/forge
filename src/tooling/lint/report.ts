import type { ForgeLintRule, ForgeLintRuleSpec, LintReport } from "./types.ts";

/** Binds a rule to its register id, so every message it reports prints as `[id] detail`. */
export function defineLintRule(id: string, spec: ForgeLintRuleSpec): ForgeLintRule {
  return {
    id,
    ...(spec.meta === undefined ? {} : { meta: spec.meta }),
    create(context) {
      const report: LintReport = (detail, at) => {
        const message = `[${id}] ${detail}`;
        context.report("node" in at ? { message, node: at.node } : { message, loc: at });
      };
      return spec.create(context, report);
    },
  };
}
