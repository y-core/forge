import { createCommand } from "../../../src/tooling/cli/command";
import { CliError } from "../../../src/tooling/cli/errors";
import type { CommandBase } from "../../../src/tooling/cli/types";
import { resolveRepoRoot } from "../paths";
import { loadRegister, registerTrees } from "../rules/load";
import { corpusWords, detectorClass, ownedDocuments, ruleStats } from "../rules/stats";
import type { DetectorClass, RegisteredRule } from "../rules/types";
import { resolveKind } from "../sync/kind";
import type { Kind } from "../types";
import { KIND_FLAG, ROOT_FLAG, STATS_FLAG } from "./flags";

const CLASSES: readonly DetectorClass[] = ["automated", "test", "triaged", "runtime", "review-only"];

function listing(rules: readonly RegisteredRule[]): string[] {
  const lines = rules.flatMap((rule) => [`${rule.id}  ${detectorClass(rule)}  ${rule.rationale.chunk}`, `  ${rule.statement}`]);
  return [...lines, `${rules.length} rules`];
}

function coverage(root: string, kind: Kind, canonHome: boolean, rules: readonly RegisteredRule[]): string[] {
  const stats = ruleStats(rules);
  const reviewOnly = stats.byClass["review-only"];
  const share = stats.total === 0 ? "0.0" : ((reviewOnly / stats.total) * 100).toFixed(1);
  const classLines = CLASSES.map((name) => `${name.padEnd(12)} ${stats.byClass[name]}`);

  const words = [...corpusWords(root, ownedDocuments(root, kind, canonHome))].sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
  const total = words.reduce((sum, [, count]) => sum + count, 0);
  const width = String(total).length;
  const wordLines = words.map(([path, count]) => `${String(count).padStart(width)}  ${path}`);

  return [
    `${"rules".padEnd(12)} ${stats.total}`,
    ...classLines,
    `review share ${share}% (${reviewOnly}/${stats.total})`,
    "",
    "words",
    ...wordLines,
    `${String(total).padStart(width)}  total, ${words.length} documents`,
  ];
}

/** Builds `warden rules`: every registered rule with its detector class, rationale and statement, or with `--stats` the coverage report. @public */
export function createRulesCommand(): CommandBase {
  return createCommand({
    name: "rules",
    description: "Print every registered rule with its statement, or with --stats its coverage by detector class and the words per document",
    flags: { root: ROOT_FLAG, kind: KIND_FLAG, stats: STATS_FLAG },
    run: (_args, flags) => {
      const root = resolveRepoRoot(flags.root);
      const kind = resolveKind(root, flags.kind);
      const trees = registerTrees(root, kind);
      const rules = loadRegister({ root, kind, trees });
      if (!rules.ok) throw new CliError("invalid-args", rules.error);
      const canonHome = trees.includes("libs") && trees.includes("apps");
      console.log((flags.stats ? coverage(root, kind, canonHome, rules.data) : listing(rules.data)).join("\n"));
    },
  });
}
