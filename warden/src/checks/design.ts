import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { stripJsonc } from "../../../src/tooling/cli/jsonc";
import { parseConsumerExportNames } from "../../../src/tooling/gate/checks/barrel-parse";
import {
  findBarrelImports,
  findCustomPropertyCitations,
  findRuleCitations,
  findRuleMarkers,
  findSplitRuleMarkers,
  isValidRuleId,
  parseDeclaredCustomProperties,
} from "../../../src/tooling/gate/checks/design-parse";
import { collectFiles } from "../../../src/tooling/gate/checks/source-scan";
import type { ExportsMap } from "../../../src/tooling/gate/checks/types";
import { checkResult, fail, scannedNothing } from "../../../src/tooling/gate/finding";
import type { CheckResult, Finding } from "../../../src/tooling/gate/types";
import { lintKeyOf, RULE_CORPUS_PATH, RULE_ENFORCER } from "../../../src/tooling/lint/design-rules";
import { MODERN_CSS_RULES } from "../../../src/tooling/lint/modern-css-rules";
import plugin from "../../../src/tooling/lint/plugin";
import type { RuleId } from "../../../src/tooling/lint/types";
import { findCodeFences } from "./docs";
import { findSubpathCitations } from "./docs-parse";
import { compileFences, type FenceDiagnostic, type FenceSource, isParseDiagnostic, unresolvedName } from "./fence-compile";

// Each states a rule a `docs/` doc owns rather than a corpus file, so neither register names
// one and the round trip would otherwise read them as unrouted.
/** The plugin rules that state no design-corpus rule. */
const STATES_NO_CORPUS_RULE = new Set([
  "suppression-needs-reason",
  "data-slot-before-spread",
  "exact-markup-assertion",
  "sql-delete-authorised",
  "sql-explicit-transaction",
  "type-import-external",
  "type-import-separation",
]);

/** What the design check needs to know about the project. @public */
export interface DesignCheckConfig {
  root: string;
  /** The package name consumers import under. */
  packageName: string;
  /** The `exports` map, verbatim from `package.json`. */
  exports: ExportsMap;
  /** Directory of corpus markdown, relative to `root`. */
  designDir: string;
  /** Directory of stylesheets declaring custom properties, relative to `root`. */
  cssDir: string;
  /** Source root walked for rule violations, relative to `root`. Defaults to `src`. */
  sourceDir?: string;
  /** The oxlint config the plugin's rules must be enabled in, relative to `root`. Defaults to `.oxlintrc.json`. */
  oxlintConfig?: string;
  /** Markdown outside `designDir` whose `tsx` fences compile too, relative to `root`. */
  fencedDocs?: readonly string[];
  /** The compiler options a fence compiles under, relative to `root`. Defaults to `tsconfig.json`. */
  tsconfig?: string;
}

/** The rules an oxlint config turns on, or `undefined` when the file could not be read. */
function readEnabledRules(path: string): Set<string> | undefined {
  type Block = { rules?: Record<string, unknown> };
  let parsed: Block & { overrides?: readonly Block[] };
  try {
    parsed = JSON.parse(stripJsonc(readFileSync(path, "utf-8"))) as Block & { overrides?: readonly Block[] };
  } catch {
    return undefined;
  }
  const entries = [parsed, ...(parsed.overrides ?? [])].flatMap((block) => Object.entries(block.rules ?? {}));
  return new Set(entries.filter(([, level]) => (Array.isArray(level) ? level[0] : level) !== "off").map(([rule]) => rule));
}

/** Every `tsx` fence compiled against the exports, as findings, and how many compiled clean. */
function checkFences(config: DesignCheckConfig, sources: ReadonlyMap<string, string>): { findings: Finding[]; clean: number } {
  const { root, packageName } = config;
  const tsconfig = config.tsconfig ?? "tsconfig.json";
  const findings: Finding[] = [];

  const documents = new Map(sources);
  for (const file of config.fencedDocs ?? []) {
    const path = resolve(root, file);
    if (!existsSync(path)) {
      findings.push(fail("is listed in `fencedDocs` but does not exist", { file }));
      continue;
    }
    documents.set(file, readFileSync(path, "utf-8"));
  }
  const fences: FenceSource[] = [...documents].flatMap(([file, source]) =>
    findCodeFences(source)
      .filter(({ lang }) => lang === "tsx")
      .map(({ line, body }) => ({ file, line, body })),
  );
  if (fences.length === 0) return { findings, clean: 0 };

  const paths: Record<string, string[]> = {};
  const owners = new Map<string, string[]>();
  for (const [key, value] of Object.entries(config.exports)) {
    const target = typeof value === "string" ? value : (value.import ?? value.types);
    if (target === undefined || !/\.tsx?$/.test(target)) continue;
    const specifier = `${packageName}${key.slice(1)}`;
    paths[specifier] = [resolve(root, target)];
    if (key.includes("*") || !existsSync(resolve(root, target))) continue;
    for (const name of parseConsumerExportNames(readFileSync(resolve(root, target), "utf-8"))) {
      owners.set(name, [...(owners.get(name) ?? []), specifier]);
    }
  }
  const project = { tsconfig: resolve(root, tsconfig), paths };
  const describe = (diagnostic: FenceDiagnostic): string => {
    const name = unresolvedName(diagnostic);
    const subpaths = name === undefined ? undefined : owners.get(name);
    if (name !== undefined && subpaths !== undefined) {
      return `\`${name}\` is not imported — ${subpaths.map((subpath) => `\`${subpath}\``).join(" or ")} exports it`;
    }
    return `\`tsx\` fence does not compile: ${diagnostic.message} (TS${diagnostic.code})`;
  };
  const report = (diagnostic: FenceDiagnostic): void => {
    findings.push(fail(describe(diagnostic), { file: diagnostic.file, line: diagnostic.line }));
  };

  const notCompiled = (error: string): { findings: Finding[]; clean: number } => ({
    findings: [...findings, fail(`no \`tsx\` fence was compiled — ${error}`, { file: tsconfig })],
    clean: 0,
  });

  let live = fences;
  let run = compileFences(live, project);
  for (;;) {
    if (!run.ok) return notCompiled(run.error);
    const diagnostics = run.data;
    const broken = new Set(diagnostics.filter(({ code }) => isParseDiagnostic(code)).map(({ fence }) => fence));
    if (broken.size === 0) break;
    for (const diagnostic of diagnostics) if (isParseDiagnostic(diagnostic.code)) report(diagnostic);
    live = live.filter((_, index) => !broken.has(index));
    if (live.length === 0) return { findings, clean: 0 };
    run = compileFences(live, project);
  }

  const ambient = new Map<number, string[]>();
  for (const diagnostic of run.data) {
    const name = unresolvedName(diagnostic);
    if (name === undefined || owners.has(name)) continue;
    const names = ambient.get(diagnostic.fence) ?? [];
    if (!names.includes(name)) ambient.set(diagnostic.fence, [...names, name]);
  }

  const final = compileFences(live, project, ambient);
  if (!final.ok) return notCompiled(final.error);
  const failing = final.data;
  for (const diagnostic of failing) report(diagnostic);
  return { findings, clean: live.length - new Set(failing.map(({ fence }) => fence)).size };
}

/** Run every check. @public */
export function checkDesign(config: DesignCheckConfig): CheckResult {
  const { root, packageName, designDir, cssDir } = config;
  const sourceDir = config.sourceDir ?? "src";
  const findings: Finding[] = [];

  const exact = new Set(Object.keys(config.exports).filter((key) => !key.includes("*")));
  const patterns = Object.entries(config.exports)
    .filter(([key]) => key.includes("*"))
    .map(([key, value]) => {
      const target = typeof value === "string" ? value : (value.import ?? value.types);
      const [keyPrefix = "", keySuffix = ""] = key.split("*");
      const [targetPrefix = "", targetSuffix = ""] = (target ?? "").split("*");
      return { keyPrefix, keySuffix, targetPrefix, targetSuffix };
    });

  const targetForSubpath = (subpath: string): string | undefined => {
    const entry = config.exports[subpath];
    if (entry !== undefined) return typeof entry === "string" ? entry : (entry.import ?? entry.types);
    for (const { keyPrefix, keySuffix, targetPrefix, targetSuffix } of patterns) {
      if (!subpath.startsWith(keyPrefix) || !subpath.endsWith(keySuffix)) continue;
      if (subpath.length < keyPrefix.length + keySuffix.length) continue;
      const star = subpath.slice(keyPrefix.length, subpath.length - keySuffix.length);
      return `${targetPrefix}${star}${targetSuffix}`;
    }
    return undefined;
  };

  const isExportSubpath = (subpath: string): boolean => {
    if (exact.has(subpath)) return true;
    const target = targetForSubpath(subpath);
    return target !== undefined && existsSync(resolve(root, target));
  };

  const corpusFiles = collectFiles(root, designDir, (name) => name.endsWith(".md"));
  if (corpusFiles.length === 0) return scannedNothing(`\`${designDir}\` matched no markdown`, "design");

  // `*.test.tsx` files assert on rendered HTML, so a class-literal check on them would flag every
  // deliberate arbitrary value the assertion itself requires — hence the exclusion below.
  const srcSources = collectFiles(
    root,
    sourceDir,
    (name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx") && !/\.browser\.tsx?$/.test(name),
  );
  if (srcSources.length === 0) return scannedNothing(`\`${sourceDir}\` matched no \`.tsx\` source`, "design");

  const sources = new Map<string, string>();
  for (const file of corpusFiles) sources.set(file, readFileSync(resolve(root, file), "utf-8"));

  const defined = new Set<string>();
  const origin = new Map<string, string>();
  for (const [file, source] of sources) {
    for (const { line, id } of findSplitRuleMarkers(source)) {
      findings.push(
        fail(`rule marker \`${id}\` is split across lines — keep \`<!-- rule:… -->\` on one line, or the id drops out of the defined set`, {
          file,
          line,
        }),
      );
    }
    for (const { line, id } of findRuleMarkers(source)) {
      if (!isValidRuleId(id)) {
        findings.push(
          fail(`rule id \`${id}\` is malformed — ids are \`forge-ui-\` prefixed, kebab-case, and carry no trailing punctuation`, { file, line }),
        );
        continue;
      }
      const first = origin.get(id);
      if (first !== undefined) {
        findings.push(fail(`duplicate rule id \`${id}\` — already defined at ${first}`, { file, line }));
        continue;
      }
      origin.set(id, `${file}:${line}`);
      defined.add(id);
    }
  }

  const declared = new Set<string>();
  for (const file of collectFiles(root, cssDir, (name) => name.endsWith(".css"))) {
    for (const name of parseDeclaredCustomProperties(readFileSync(resolve(root, file), "utf-8"))) declared.add(name);
  }

  for (const [file, source] of sources) {
    for (const { line, raw, subpath } of findSubpathCitations(source, packageName, { strict: true })) {
      if (!isExportSubpath(subpath)) {
        findings.push(fail(`\`${packageName}${raw}\` is not reachable through package.json exports`, { file, line }));
      }
    }

    for (const { line, subpath, symbols } of findBarrelImports(source, packageName)) {
      const target = targetForSubpath(subpath);
      const modulePath = target === undefined ? undefined : resolve(root, target);
      if (modulePath === undefined || !existsSync(modulePath)) continue;

      const exported = parseConsumerExportNames(readFileSync(modulePath, "utf-8"));
      const missing = symbols.filter((symbol) => !exported.has(symbol));
      if (missing.length > 0) {
        findings.push(
          fail(`\`${packageName}${subpath.slice(1)}\` does not export ${missing.map((name) => `\`${name}\``).join(", ")}`, { file, line }),
        );
      }
    }

    for (const { line, property, family } of findCustomPropertyCitations(source)) {
      if (family) {
        if ([...declared].some((name) => name.startsWith(`${property}-`))) continue;
        findings.push(fail(`\`${property}-*\` matches no property declared in ${cssDir}/`, { file, line }));
        continue;
      }
      if (!declared.has(property)) findings.push(fail(`\`${property}\` is declared by no stylesheet in ${cssDir}/`, { file, line }));
    }

    for (const { line, id } of findRuleCitations(source)) {
      if (!defined.has(id)) findings.push(fail(`cites rule \`${id}\`, which no corpus file defines`, { file, line }));
    }
  }

  const fenceCheck = checkFences(config, sources);
  findings.push(...fenceCheck.findings);

  const registered = new Set(Object.keys(plugin.rules));
  const oxlintConfig = config.oxlintConfig ?? ".oxlintrc.json";
  const enabled = readEnabledRules(resolve(root, oxlintConfig));

  const corpusSet = new Set(corpusFiles);
  const table = "design-rules.ts";
  for (const [ruleId, corpusPath] of Object.entries(RULE_CORPUS_PATH) as [RuleId, string][]) {
    if (!defined.has(ruleId)) {
      findings.push(fail(`RULE_CORPUS_PATH names \`${ruleId}\`, which no corpus file defines with a marker`, { file: table }));
    }
    if (!corpusSet.has(corpusPath)) {
      findings.push(fail(`RULE_CORPUS_PATH routes \`${ruleId}\` to \`${corpusPath}\`, which is not a corpus file`, { file: table }));
    }

    if (!RULE_ENFORCER[ruleId].includes("lint")) continue;

    const key = lintKeyOf(ruleId);
    if (!registered.has(key))
      findings.push(fail(`RULE_ENFORCER calls \`${ruleId}\` a lint rule, but the plugin registers no \`${key}\``, { file: table }));
    if (enabled !== undefined && !enabled.has(`forge/${key}`)) {
      findings.push(fail(`\`forge/${key}\` is not enabled — a registered rule that no config turns on reports nothing`, { file: oxlintConfig }));
    }
  }
  const routed = new Set<string>();
  for (const [ruleId, rule] of Object.entries(MODERN_CSS_RULES)) {
    if (rule.enforcer !== "lint") continue;
    const key = lintKeyOf(ruleId);
    routed.add(key);
    if (!registered.has(key))
      findings.push(
        fail(`MODERN_CSS_RULES calls \`${ruleId}\` a lint rule, but the plugin registers no \`${key}\``, { file: "modern-css-rules.ts" }),
      );
    if (enabled !== undefined && !enabled.has(`forge/${key}`)) {
      findings.push(fail(`\`forge/${key}\` is not enabled — a registered rule that no config turns on reports nothing`, { file: oxlintConfig }));
    }
  }

  for (const [ruleId, enforcers] of Object.entries(RULE_ENFORCER)) if (enforcers.includes("lint")) routed.add(lintKeyOf(ruleId));
  for (const key of registered) {
    if (STATES_NO_CORPUS_RULE.has(key) || routed.has(key)) continue;
    findings.push(fail(`the plugin registers \`forge/${key}\`, which no rule register routes to it`, { file: "lint.ts" }));
  }

  if (enabled === undefined) findings.push(fail("could not be read, so no plugin rule could be held against it", { file: oxlintConfig }));

  return checkResult(
    findings,
    `${corpusFiles.length} corpus files and ${srcSources.length} sources agree on ${defined.size} rules; ${fenceCheck.clean} tsx fences compile.`,
  );
}
