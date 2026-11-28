import type { RuleEntry } from "./types";

/** Types the default export of a rule file. @public */
export function defineRules(entries: readonly RuleEntry[]): readonly RuleEntry[] {
  return entries;
}
