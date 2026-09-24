import { RULE_CORPUS_PATH } from "./design-rules.ts";
import { MODERN_CSS_RULES } from "./modern-css-rules.ts";
import type { RuleId } from "./types.ts";
import type { ModernCssRuleId } from "./types.ts";
import type { RuleContext, SourceLocation } from "./types.ts";
import type { ReportedId } from "./types.ts";

const corpusPathOf = (id: ReportedId): string =>
  id in RULE_CORPUS_PATH ? RULE_CORPUS_PATH[id as RuleId] : MODERN_CSS_RULES[id as ModernCssRuleId].corpus;

/** Reports under one corpus id, in the format every forge rule prints. */
export function reporter(context: RuleContext, corpusId: ReportedId): (detail: string, loc: SourceLocation) => void {
  return (detail, loc) => {
    context.report({ message: `${detail} (${corpusId} — ${corpusPathOf(corpusId)})`, loc });
  };
}
