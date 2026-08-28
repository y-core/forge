import type { ModernCssRuleId } from "./modern-css-rules";

/** One rule a path is not yet held to, and the task that owes the migration. @public */
export interface DeferredFinding {
  /** Repo-relative file, or the directory prefix, the deferral covers. */
  path: string;
  ruleId: ModernCssRuleId;
  /** The ledger task that closes it. Mandatory and non-empty. */
  owner: string;
}

/** The rules forge's own tree does not yet satisfy, each owned by a task. The list only shrinks. @public */
export const MODERN_CSS_DEFERRED: readonly DeferredFinding[] = [];
