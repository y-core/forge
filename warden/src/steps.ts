import { join, relative } from "node:path";

import { checkStep } from "../../src/tooling/gate/builders";
import type { StepOptions } from "../../src/tooling/gate/types";
import type { CheckStep, StepRequirement, StepTiers } from "../../src/tooling/gate/types";
import { type ChangelogCheckConfig, checkChangelog } from "./checks/changelog";
import { checkDesign, type DesignCheckConfig } from "./checks/design";
import { checkDocs, type DocsCheckConfig } from "./checks/docs";
import { libraryDocsDir } from "./corpus/dependency";
import { checkDuplicates, type DuplicateCheckConfig } from "./gate/duplicates";
import { GOLDEN, NEGATIVE } from "./gate/golden";
import { checkGoldenQueries, type GoldenCheckConfig } from "./gate/queries";
import { GOLDEN_STEP_LABEL, type GoldenStep } from "./gate/step-sets";
import { checkWarden, type WardenCheckConfig } from "./gate/warden";
import { CANON_ROOT } from "./paths";

const SQLITE: StepRequirement = { tool: "bun:sqlite", probe: () => typeof Bun !== "undefined", hint: "run the gate under Bun — `bun run verify`" };

/** Checks the governing documents against the subpaths they are required to cite. @public */
export function docsStep(config: DocsCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-docs", () => checkDocs(config), options);
}

/** Checks the changelog's headings against the current package version, and its released sections against their recorded digests. @public */
export function changelogStep(config: ChangelogCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-changelog", () => checkChangelog(config), options, {
    watches: [config.file ?? "CHANGELOG.md", config.sectionsFile ?? "config/changelog-sections.json"],
  });
}

/** Checks the design corpus against the tree it governs. @public */
export function designStep(config: DesignCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-design", () => checkDesign(config), options);
}

/** Rebuilds the knowledge index and asserts what retrieval depends on. @public */
export function wardenStep(config: WardenCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("warden:index", () => checkWarden(config), options, { requires: SQLITE });
}

/** Runs the golden retrieval set against a freshly built index. @public */
export function wardenQueriesStep(config: GoldenCheckConfig, options: StepOptions = {}): GoldenStep {
  return {
    ...checkStep(GOLDEN_STEP_LABEL, (tier) => checkGoldenQueries(config, tier), options, { requires: SQLITE }),
    golden: config.queries ?? GOLDEN,
    negative: config.negative ?? NEGATIVE,
  };
}

/** Reports two sections saying the same thing, which the single-home rule forbids. @public */
export function duplicatesStep(config: DuplicateCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("warden:duplicates", () => checkDuplicates(config), options);
}

/** What a consuming application needs to state to take the warden rows. @public */
export interface WardenAppStepOptions {
  /** Repository root that every check resolves and reports its paths against. */
  root: string;
  /** The consuming package's name, for the subpath half of the docs check. */
  packageName: string;
  /** The golden retrieval set `warden:queries` holds the index to. */
  queries: NonNullable<GoldenCheckConfig["queries"]>;
  /** Questions the corpus must refuse; omit where the set declares none. */
  negative?: GoldenCheckConfig["negative"];
  /** The corpus tree this repository clones. Defaults to `"apps"`. */
  kind?: DocsCheckConfig["kind"];
  /** Directories a citation may name. Defaults to `canonCitableDirs`; the installed library's own `docs/` is appended, so never list it. */
  citableDirs?: NonNullable<DocsCheckConfig["citableDirs"]>;
  /** This repository's own `docs/`; omit where it keeps none. */
  decisionsDir?: string;
  /** Subpaths the docs check holds citations against. Defaults to `{}` — an app publishes none. */
  exports?: DocsCheckConfig["exports"];
  /** Frontmatter keys a document must declare; omit to require none. */
  requiredFrontmatter?: DocsCheckConfig["requiredFrontmatter"];
}

/** The installed canon's `shared` tree and the `kind` tree, relative to `root`, as a citation names them. @public */
export function canonCitableDirs(root: string, kind: NonNullable<DocsCheckConfig["kind"]>, canonRoot = CANON_ROOT): string[] {
  return [relative(root, join(canonRoot, "shared")), relative(root, join(canonRoot, kind))];
}

/** The rows every consuming application merges into its table with `mergeTiers`. @public */
export function wardenAppSteps(options: WardenAppStepOptions): StepTiers {
  const { root, queries } = options;
  const kind = options.kind ?? "apps";
  const scope = { root, kind, dependency: true } as const;
  const libraryDocs = libraryDocsDir(root);
  const citableDirs = options.citableDirs ?? canonCitableDirs(root, kind);
  return {
    static: [
      docsStep({
        root,
        packageName: options.packageName,
        exports: options.exports ?? {},
        kind,
        citableDirs: libraryDocs === undefined ? citableDirs : [...citableDirs, libraryDocs],
        ...(options.decisionsDir === undefined ? {} : { decisionsDir: options.decisionsDir }),
        ...(options.requiredFrontmatter === undefined ? {} : { requiredFrontmatter: options.requiredFrontmatter }),
      }),
    ],
    unit: [
      wardenStep(scope),
      wardenQueriesStep({ ...scope, queries, ...(options.negative === undefined ? {} : { negative: options.negative }) }),
      duplicatesStep(scope),
    ],
  };
}
