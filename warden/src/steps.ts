/** The gate steps for the checks warden owns. Labels are fixed: they are the `--only` tokens. */

import { checkStep } from "../../src/tooling/gate/builders";
import type { StepOptions } from "../../src/tooling/gate/types";
import type { CheckStep, StepRequirement } from "../../src/tooling/gate/types";
import { type ChangelogCheckConfig, checkChangelog } from "./checks/changelog";
import { checkDesign, type DesignCheckConfig } from "./checks/design";
import { checkDocs, type DocsCheckConfig } from "./checks/docs";
import { checkReadmeExports, type ReadmeExportsCheckConfig } from "./checks/readme-exports";
import { checkDuplicates, type DuplicateCheckConfig } from "./gate/duplicates";
import { checkGoldenQueries, type GoldenCheckConfig } from "./gate/queries";
import { checkWarden, type WardenCheckConfig } from "./gate/warden";

// `bun:sqlite` is a Bun builtin: present wherever the gate runs under Bun, absent under Node.
const SQLITE: StepRequirement = { tool: "bun:sqlite", probe: () => typeof Bun !== "undefined", hint: "run the gate under Bun — `bun run verify`" };

/** Checks the governing documents against the subpaths they are required to cite. @public */
export function docsStep(config: DocsCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-docs", () => checkDocs(config), options);
}

/** Checks a README's per-subpath export tables against the barrels they document. @public */
export function readmeExportsStep(config: ReadmeExportsCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-readme-exports", () => checkReadmeExports(config), options);
}

/** Checks the changelog's headings against the current package version. Defaults to the `full` tier:
 *  requiring a written `[Unreleased]` entry on every inner loop would fail every WIP commit. @public */
export function changelogStep(config: ChangelogCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-changelog", () => checkChangelog(config), options, { tier: "full" });
}

/** Checks the design corpus against the tree it governs. @public */
export function designStep(config: DesignCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-design", () => checkDesign(config), options);
}

/** Rebuilds the knowledge index and asserts what retrieval depends on. `bun:sqlite` is the
 *  prerequisite, so a non-Bun runner reports it skipped below the `full` tier and fails it there. @public */
export function wardenStep(config: WardenCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("warden:index", () => checkWarden(config), options, { requires: SQLITE });
}

/** Runs the golden retrieval set against a freshly built index. A second step rather than a second
 *  assertion inside the first: the two fail for different reasons, and a reader has to be told
 *  which one to fix. @public */
export function wardenQueriesStep(config: GoldenCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("warden:queries", () => checkGoldenQueries(config), options, { requires: SQLITE });
}

/** Reports two sections saying the same thing, which the single-home rule forbids. A third step for
 *  the same reason the second is one — and it needs no index, because the text it compares is never
 *  stored in a column. @public */
export function duplicatesStep(config: DuplicateCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("warden:duplicates", () => checkDuplicates(config), options);
}
