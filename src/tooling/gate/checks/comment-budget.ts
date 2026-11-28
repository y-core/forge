import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { worktreeFiles } from "../../cli/worktree";
import { checkResult, fail, scannedNothing } from "../finding";
import type { CheckResult, Finding } from "../types";
import { validateCommentBudget } from "./comment-budget-parse";
import { resolveSources, unresolvedSourceEntries } from "./source-scan";
import type { CommentBudgetCheckConfig } from "./types";

/** Whether the comment budget walks a file of this name. @internal */
export function isBudgetedSource(name: string): boolean {
  return name.endsWith(".ts") || name.endsWith(".tsx") || name.endsWith(".css");
}

/** A finding for each budgeted file the work tree holds that the scan never reads, or one when git cannot list the tree. */
function uncoveredFiles(root: string, scanned: ReadonlySet<string>): Finding[] {
  const tree = worktreeFiles(root);
  if (tree === undefined) return [fail("could not list the git work tree — `coverTracked` needs a checkout to hold the sources against")];
  return tree
    .filter((file) => isBudgetedSource(file) && !scanned.has(file))
    .map((file) => fail("is outside the comment budget's sources, so nothing reads its comments — add its tree to `sources`", { file }));
}

/** Fails on every comment the `CODE_RULES.md` §5a budget does not permit. @public */
export function checkCommentBudget(config: CommentBudgetCheckConfig): CheckResult {
  const licences = config.licences ?? new Map<string, string>();
  const files = resolveSources(config.root, config.sources, isBudgetedSource);
  if (files.length === 0) return scannedNothing(`\`${config.sources.join("`, `")}\` matched no source`, "comment-budget");
  const unresolved = unresolvedSourceEntries(config.root, config.sources, "file or directory");
  if (unresolved.length > 0) return checkResult(unresolved, "");

  const present = new Set(files);
  const stale = [...licences.keys()]
    .filter((file) => !present.has(file))
    .map((file) => fail(`\`${file}\` is listed as carrying a licence notice but is not a file the check walks — delete the entry`));

  const reasonless = [...licences]
    .filter(([, attribution]) => attribution.trim() === "")
    .map(([file]) => fail(`\`${file}\` is listed as carrying a licence notice with no attribution — name the upstream, or cut the header`));

  const uncovered = config.coverTracked === true ? uncoveredFiles(config.root, present) : [];

  const findings: Finding[] = files.flatMap((file) =>
    validateCommentBudget(file, readFileSync(resolve(config.root, file), "utf-8"), (licences.get(file) ?? "").trim() !== ""),
  );

  return checkResult([...uncovered, ...stale, ...reasonless, ...findings], `${files.length} sources stay inside the comment budget`);
}
