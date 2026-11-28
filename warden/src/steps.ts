import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { checkStep } from "../../src/tooling/gate/builders";
import { checkResult, fail, warn } from "../../src/tooling/gate/finding";
import type { StepOptions } from "../../src/tooling/gate/types";
import type { CheckResult, CheckStep, Finding, StepRequirement, StepTiers } from "../../src/tooling/gate/types";
import { type ChangelogCheckConfig, checkChangelog } from "./checks/changelog";
import { checkDesign, checkDocFences, type DesignCheckConfig, type DocFencesCheckConfig } from "./checks/design";
import { checkDocs, type DocsCheckConfig } from "./checks/docs";
import { checkRatchet, type RatchetCheckConfig, readRatchetBaseline, tightenRatchet } from "./checks/ratchet";
import { checkRules, type RulesCheckConfig } from "./checks/rules";
import { libraryDocsDir } from "./corpus/dependency";
import { checkDuplicates, type DuplicateCheckConfig } from "./gate/duplicates";
import { GOLDEN, NEGATIVE } from "./gate/golden";
import { checkGoldenQueries, type GoldenCheckConfig } from "./gate/queries";
import { GOLDEN_STEP_LABEL, type GoldenStep } from "./gate/step-sets";
import { checkWarden, type WardenCheckConfig } from "./gate/warden";
import { CANON_ROOT } from "./paths";
import { type CheckFinding, sweepRules } from "./rules/check";
import { loadRegister, loadRuleSources, registerTrees, type RuleSourcesOptions } from "./rules/load";
import { corpusWords, ownedDocuments } from "./rules/stats";
import type { Tree } from "./types";

const SQLITE: StepRequirement = { tool: "bun:sqlite", probe: () => "Bun" in globalThis, hint: "run the gate under Bun — `bun run verify`" };

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

/** What the design step needs: the check's config, with the Floor named by its file and its statements read from the register when the step runs. @public */
export interface DesignStepConfig extends Omit<DesignCheckConfig, "floor">, Pick<RuleSourcesOptions, "rulesFile"> {
  /** The Floor document, relative to `designDir`. */
  floor?: string;
}

/** Checks the design corpus against the tree it governs. @public */
export function designStep(config: DesignStepConfig, options: StepOptions = {}): CheckStep {
  return checkStep(
    "validate-design",
    () => {
      const { floor, rulesFile, ...check } = config;
      if (floor === undefined) return checkDesign(check);
      const sources = loadRuleSources({ root: config.root, trees: [], ...(rulesFile === undefined ? {} : { rulesFile }) });
      if (!sources.ok) return checkResult([fail(sources.error)], "");
      const statements = new Map(sources.data.flatMap(({ entries }) => entries.map(({ id, statement }) => [id, statement] as const)));
      return checkDesign({ ...check, floor: { file: floor, statements } });
    },
    options,
  );
}

/** Compiles the code fences of the listed documentation against the exports. @public */
export function docFencesStep(config: DocFencesCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-doc-fences", () => checkDocFences(config), options);
}

/** What the rules step needs: the check's config, less what the step loads or reads when it runs. @public */
export interface RulesStepConfig
  extends Omit<RulesCheckConfig, "sources" | "stepLabels">, Pick<RuleSourcesOptions, "rulesFile" | "canonRulesRoot"> {
  /** Called when the step runs, so the table declaring this step can supply its own labels. */
  stepLabels: () => readonly string[];
}

/** Loads the rule register and holds it to the prose, the lint configs, the gate and the finding sources. @public */
export function rulesStep(config: RulesStepConfig, options: StepOptions = {}): CheckStep {
  return checkStep(
    "validate-rules",
    () => {
      const { stepLabels, rulesFile, canonRulesRoot, ...check } = config;
      const trees = config.trees ?? registerTrees(config.root, config.kind, config.canonRoot);
      const sources = loadRuleSources({
        root: config.root,
        trees,
        ...(rulesFile === undefined ? {} : { rulesFile }),
        ...(canonRulesRoot === undefined ? {} : { canonRulesRoot }),
      });
      if (!sources.ok) return checkResult([fail(sources.error)], "");
      return checkRules({ ...check, trees, sources: sources.data, stepLabels: stepLabels() });
    },
    options,
  );
}

/** What the ratchet step needs to load the register and find the documents it budgets. @public */
export interface RatchetStepConfig
  extends
    Pick<RatchetCheckConfig, "root" | "baseline">,
    Pick<RulesCheckConfig, "kind" | "canonRoot">,
    Pick<RuleSourcesOptions, "rulesFile" | "canonRulesRoot"> {
  /** Defaults to `registerTrees(root, kind, canonRoot)`; both `libs` and `apps` make this repository the canon's home, whose words it budgets. */
  trees?: readonly Tree[];
}

function measureRatchet(config: RatchetStepConfig): { rules: ReturnType<typeof loadRegister>; documents: string[] } {
  const { root, kind, rulesFile, canonRulesRoot } = config;
  const canonRoot = config.canonRoot ?? CANON_ROOT;
  const trees = config.trees ?? registerTrees(root, kind, canonRoot);
  const rules = loadRegister({
    root,
    kind,
    trees,
    canonRoot,
    ...(rulesFile === undefined ? {} : { rulesFile }),
    ...(canonRulesRoot === undefined ? {} : { canonRulesRoot }),
  });
  const canonHome = trees.includes("libs") && trees.includes("apps");
  return { rules, documents: ownedDocuments(root, kind, canonHome, canonRoot) };
}

/** Holds the review-only share and each owned document's words to the baseline, with a fixer that only lowers it. @public */
export function ratchetStep(config: RatchetStepConfig, options: StepOptions = {}): CheckStep {
  const baseline = config.baseline ?? "config/rules-baseline.json";
  return checkStep(
    "warden:ratchet",
    () => {
      const { rules, documents } = measureRatchet(config);
      if (!rules.ok) return checkResult([fail(rules.error)], "");
      return checkRatchet({ root: config.root, baseline, rules: rules.data, documents });
    },
    options,
    {
      fix: () => {
        const { rules, documents } = measureRatchet(config);
        if (!rules.ok) throw new Error(rules.error);
        const current = readRatchetBaseline(config.root, baseline);
        if (!current.ok) throw new Error(current.error);
        const tightened = tightenRatchet(current.data, rules.data, corpusWords(config.root, documents));
        if (!tightened.ok) throw new Error(tightened.error);
        writeFileSync(resolve(config.root, baseline), `${JSON.stringify(tightened.data, null, 2)}\n`, "utf-8");
        // The repository's formatter has the last word on the file's layout, so a fixed tree passes `format` too.
        const formatted = spawnSync("bun", ["fmt", "--no-script", baseline], { cwd: config.root, encoding: "utf-8" });
        if (formatted.status !== 0)
          throw new Error(`\`bun fmt ${baseline}\` failed after writing the baseline: ${formatted.stderr || formatted.stdout}`);
      },
    },
  );
}

/** What the pattern step needs to load the register; the repository's kind picks the rules in scope. @public */
export interface PatternStepConfig
  extends Pick<RuleSourcesOptions, "root" | "rulesFile" | "canonRulesRoot">, Pick<RulesCheckConfig, "kind" | "canonRoot"> {
  /** Defaults to `registerTrees(root, kind, canonRoot)`. */
  trees?: readonly Tree[];
}

/** Runs every in-scope `rg` detector over the tree: a `fail` hit fails it, and each `warn` rule with hits is one warning naming the command that lists them. @internal */
export function checkPatterns(config: PatternStepConfig): CheckResult {
  const { root, kind } = config;
  const canonRoot = config.canonRoot ?? CANON_ROOT;
  const rules = loadRegister({
    root,
    kind,
    trees: config.trees ?? registerTrees(root, kind, canonRoot),
    canonRoot,
    ...(config.rulesFile === undefined ? {} : { rulesFile: config.rulesFile }),
    ...(config.canonRulesRoot === undefined ? {} : { canonRulesRoot: config.canonRulesRoot }),
  });
  if (!rules.ok) return checkResult([fail(rules.error)], "");
  const inScope = rules.data.filter((rule) => rule.scope.includes(kind));
  const report = sweepRules({ root, rules: inScope });
  if (!report.ok) return checkResult([fail(report.error)], "");

  const statements = new Map(inScope.map((rule) => [rule.id, rule.statement]));
  const findings: Finding[] = [];
  const warned = new Map<string, CheckFinding[]>();
  for (const hit of report.data.findings) {
    if (hit.level === "fail") {
      findings.push(fail(statements.get(hit.rule) ?? hit.rule, { file: hit.file, line: hit.line, rule: hit.rule, detail: [hit.match] }));
    } else warned.set(hit.rule, [...(warned.get(hit.rule) ?? []), hit]);
  }
  for (const [rule, hits] of warned) {
    const first = hits[0];
    findings.push(
      warn(`${hits.length} hit(s) to triage — \`warden check --rules ${rule}\` lists them with the triage`, {
        rule,
        ...(first === undefined ? {} : { file: first.file, line: first.line }),
      }),
    );
  }
  const patterns = inScope.flatMap((rule) => rule.detectors.filter((detector) => detector.kind === "rg")).length;
  return checkResult(findings, `${patterns} patterns over ${report.data.scanned} files`);
}

/** Holds the tree to the register's line patterns, so a rule a pattern decides never waits for a reviewer. @public */
export function patternStep(config: PatternStepConfig, options: StepOptions = {}): CheckStep {
  return checkStep("warden:check", () => checkPatterns(config), options);
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
      ...(kind === "shared" ? [] : [patternStep({ root, kind })]),
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
