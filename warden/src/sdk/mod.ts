import type { Result } from "../../../src/result/types";
// The Code Mode surface: what `warden_query` and `warden_check` serve over MCP, importable from a script or a REPL.
import { openIndex } from "../index/open";
import { resolveRepoRoot } from "../paths";
import { type CheckOptions, type CheckReport, sweepRules } from "../rules/check";
import type { RegisteredRule } from "../rules/types";
import { resolveKind } from "../sync/kind";
import type { Kind } from "../types";
import { canonVersion } from "../version";
import { type CorpusSection, corpusSections, loadSteps, rulesInScope, type StepSummary } from "./data";

export type { CheckedRule, CheckFinding, CheckReport } from "../rules/check";
export type { RegisteredRule, RgDetector, RuleDetector } from "../rules/types";
export type { CorpusSection, StepSummary } from "./data";
export type { QueryData } from "./query";
export { corpusSections, loadSteps, rulesInScope } from "./data";
export { QUERY_OUTPUT_LIMIT, QUERY_TIMEOUT_MS, runQuery } from "./query";

/** Which repository a call reads. @public */
export interface SdkOptions {
  /** Defaults to the repository warden is installed in, or `WARDEN_REPO_ROOT`. */
  root?: string;
  /** Defaults to `package.json`'s `warden.kind`. */
  kind?: Kind;
}

function target(options: SdkOptions): { root: string; kind: Kind } {
  const root = resolveRepoRoot(options.root);
  return { root, kind: options.kind ?? resolveKind(root) };
}

/** The rules in the repository's scope, each with its statement, detectors and rationale chunk id. @public */
export function rules(options: SdkOptions = {}): Result<RegisteredRule[], string> {
  const { root, kind } = target(options);
  return rulesInScope(root, kind);
}

/** Every section of the repository's knowledge index, refreshed first, with its relations; needs Bun, for `bun:sqlite`. @public */
export function corpus(options: SdkOptions & { dependency?: boolean } = {}): CorpusSection[] {
  const { root, kind } = target(options);
  const knowledge = openIndex(root, kind, { canonVersion: canonVersion(), dependency: options.dependency === true });
  try {
    knowledge.refresh();
    return corpusSections(knowledge.db);
  } finally {
    knowledge.close();
  }
}

/** The register's rg patterns over the tree, a file list or a diff — what `warden check` and `warden_check` run. @public */
export function check(options: SdkOptions & Pick<CheckOptions, "files" | "diff" | "ids" | "level"> = {}): Result<CheckReport, string> {
  const { root, kind } = target(options);
  const inScope = rulesInScope(root, kind);
  if (!inScope.ok) return inScope;
  const { files, diff, ids, level } = options;
  return sweepRules({
    root,
    rules: inScope.data,
    ...(files === undefined ? {} : { files }),
    ...(diff === undefined ? {} : { diff }),
    ...(ids === undefined ? {} : { ids }),
    ...(level === undefined ? {} : { level }),
  });
}

/** The rows of the repository's step table, tier by tier. @public */
export function steps(options: SdkOptions = {}): Promise<Result<StepSummary[], string>> {
  return loadSteps(target(options).root);
}
