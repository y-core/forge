import { RULE_CORPUS_PATH, type RuleId } from "../gate/checks/design-rules.ts";
import { MODERN_CSS_RULES, type ModernCssRuleId } from "../gate/checks/modern-css-rules.ts";
import type { RuleContext, SourceLocation } from "./types.ts";

/** Any id a plugin rule reports under: a corpus rule, or one of the modern-platform rules. */
export type ReportedId = RuleId | ModernCssRuleId;

const corpusPathOf = (id: ReportedId): string =>
  id in RULE_CORPUS_PATH ? RULE_CORPUS_PATH[id as RuleId] : MODERN_CSS_RULES[id as ModernCssRuleId].corpus;

/** Reports under one corpus id, in the format every forge rule prints. */
export function reporter(context: RuleContext, corpusId: ReportedId): (detail: string, loc: SourceLocation) => void {
  return (detail, loc) => {
    context.report({ message: `${detail} (${corpusId} — ${corpusPathOf(corpusId)})`, loc });
  };
}
