import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { err, ok } from "../../../src/result/result";
import type { Result } from "../../../src/result/types";
import { checkResult, fail } from "../../../src/tooling/gate/finding";
import type { CheckResult, Finding } from "../../../src/tooling/gate/types";
import { corpusWords, ruleStats } from "../rules/stats";
import type { RegisteredRule } from "../rules/types";

/** What the ratchet holds a repository to: its rule counts and each owned document's word budget. @public */
export interface RatchetBaseline {
  readonly rules: { readonly total: number; readonly reviewOnly: number };
  /** Keyed by repository-relative path. */
  readonly words: Readonly<Record<string, number>>;
}

/** What the ratchet check measures against its baseline. @public */
export interface RatchetCheckConfig {
  root: string;
  /** Relative to `root`. Defaults to `config/rules-baseline.json`. */
  baseline?: string;
  rules: readonly RegisteredRule[];
  /** Repository-relative; every document the baseline must budget. */
  documents: readonly string[];
}

const DEFAULT_BASELINE = "config/rules-baseline.json";

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

function parseBaseline(text: string): RatchetBaseline | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const { rules, words } = (parsed ?? {}) as { rules?: { total?: unknown; reviewOnly?: unknown }; words?: unknown };
  if (typeof rules !== "object" || rules === null || !isCount(rules.total) || !isCount(rules.reviewOnly)) return undefined;
  if (typeof words !== "object" || words === null || Array.isArray(words) || !Object.values(words).every(isCount)) return undefined;
  return { rules: { total: rules.total, reviewOnly: rules.reviewOnly }, words: words as Record<string, number> };
}

/** The baseline at `path` under `root`: `undefined` when no file is there, err when the file is not a baseline. @internal */
export function readRatchetBaseline(root: string, path = DEFAULT_BASELINE): Result<RatchetBaseline | undefined, string> {
  const file = resolve(root, path);
  if (!existsSync(file)) return ok(undefined);
  const baseline = parseBaseline(readFileSync(file, "utf-8"));
  return baseline === undefined ? err(`${path} could not be read as a ratchet baseline`) : ok(baseline);
}

function reviewOnlyCounts(rules: readonly RegisteredRule[]): RatchetBaseline["rules"] {
  const stats = ruleStats(rules);
  return { total: stats.total, reviewOnly: stats.byClass["review-only"] };
}

function shareRose(from: RatchetBaseline["rules"], to: RatchetBaseline["rules"]): boolean {
  if (to.total === 0) return false;
  if (from.total === 0) return to.reviewOnly > 0;
  return to.reviewOnly * from.total > from.reviewOnly * to.total;
}

function percent({ total, reviewOnly }: RatchetBaseline["rules"]): string {
  return `${total === 0 ? "0.0" : ((reviewOnly / total) * 100).toFixed(1)}% (${reviewOnly}/${total})`;
}

/** Fails where the review-only share rose or a document outgrew its word budget, and where the baseline does not budget exactly the owned documents. @public */
export function checkRatchet(config: RatchetCheckConfig): CheckResult {
  const path = config.baseline ?? DEFAULT_BASELINE;
  const read = readRatchetBaseline(config.root, path);
  if (!read.ok)
    return checkResult(
      [
        fail(`could not be read as a ratchet baseline — repair it by hand, since the \`warden:ratchet\` fixer never overwrites one`, {
          file: path,
        }),
      ],
      "",
    );
  const baseline = read.data;
  if (baseline === undefined) return checkResult([fail(`no ratchet baseline — run the \`warden:ratchet\` fixer to write one`, { file: path })], "");

  const findings: Finding[] = [];
  const counts = reviewOnlyCounts(config.rules);
  if (shareRose(baseline.rules, counts)) {
    findings.push(
      fail(`the review-only share rose to ${percent(counts)}, above the baseline's ${percent(baseline.rules)} — give a rule a detector`, {
        file: path,
      }),
    );
  }

  const words = corpusWords(config.root, config.documents);
  let slack = 0;
  let slackDocuments = 0;
  for (const [document, count] of words) {
    const budget = baseline.words[document];
    if (budget === undefined) findings.push(fail(`has no word budget in ${path}`, { file: document }));
    else if (count > budget) findings.push(fail(`holds ${count} words, over its budget of ${budget}`, { file: document }));
    else if (count < budget) {
      slack += budget - count;
      slackDocuments++;
    }
  }
  for (const document of Object.keys(baseline.words)) {
    if (!words.has(document)) findings.push(fail(`budgets \`${document}\`, which is no longer an owned document`, { file: path }));
  }

  const within = `${counts.total} rules, ${percent(counts)} review-only; ${words.size} documents within budget`;
  const tail = slack === 0 ? "" : `, ${slack} words of slack in ${slackDocuments} — the fixer lowers their budgets`;
  return checkResult(findings, `${within}${tail}`);
}

/** The baseline with every budget lowered to the current count, new documents added and deleted ones dropped; err where the review-only share rose. @public */
export function tightenRatchet(
  baseline: RatchetBaseline | undefined,
  rules: readonly RegisteredRule[],
  words: ReadonlyMap<string, number>,
): Result<RatchetBaseline, string> {
  const counts = reviewOnlyCounts(rules);
  if (baseline !== undefined && shareRose(baseline.rules, counts)) {
    return err(`the review-only share rose to ${percent(counts)}, above the baseline's ${percent(baseline.rules)}; the ratchet only tightens`);
  }
  const budgets: Record<string, number> = {};
  for (const document of [...words.keys()].sort()) {
    const count = words.get(document) ?? 0;
    const budget = baseline?.words[document];
    budgets[document] = budget === undefined ? count : Math.min(budget, count);
  }
  return ok({ rules: counts, words: budgets });
}
