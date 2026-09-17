import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { checkResult, fail, scannedNothing } from "../finding";
import type { CheckResult, Finding } from "../types";
import { validateCommentBudget } from "./comment-budget-parse";
import { resolveSources } from "./source-scan";
import type { CommentBudgetCheckConfig } from "./types";

const SCANNED = (name: string): boolean => name.endsWith(".ts") || name.endsWith(".tsx");

/** Fails on every comment the `CODE_RULES.md` §5a budget does not permit. @public */
export function checkCommentBudget(config: CommentBudgetCheckConfig): CheckResult {
  const licences = config.licences ?? new Map<string, string>();
  const files = resolveSources(config.root, config.sources, SCANNED);
  if (files.length === 0) return scannedNothing(`\`${config.sources.join("`, `")}\` matched no source`, "comment-budget");

  const present = new Set(files);
  const stale = [...licences.keys()]
    .filter((file) => !present.has(file))
    .map((file) => fail(`\`${file}\` is listed as carrying a licence notice but is not a file the check walks — delete the entry`));

  const reasonless = [...licences]
    .filter(([, attribution]) => attribution.trim() === "")
    .map(([file]) => fail(`\`${file}\` is listed as carrying a licence notice with no attribution — name the upstream, or cut the header`));

  // The attribution is what the allowance buys, so a blank one is no listing at all — the same
  // terms the co-location exemption holds an owner to.
  const findings: Finding[] = files.flatMap((file) =>
    validateCommentBudget(file, readFileSync(resolve(config.root, file), "utf-8"), (licences.get(file) ?? "").trim() !== ""),
  );

  return checkResult([...stale, ...reasonless, ...findings], `${files.length} sources stay inside the comment budget`);
}
