import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { type CheckResult, checkResult, type Finding, fail } from "../finding";
import { parseConsumerExportNames } from "./barrel-parse";
import {
  findBarrelImports,
  findCustomPropertyCitations,
  findRuleCitations,
  findRuleMarkers,
  findSourceViolations,
  isValidRuleId,
  parseDeclaredCustomProperties,
  RULE_CORPUS_PATH,
  type RuleId,
} from "./design-parse";
import { findSubpathCitations } from "./docs-parse";
import type { ExportsMap } from "./exports";

/** What the design check needs to know about the project. @public */
export interface DesignCheckConfig {
  /** Application root. */
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
}

/** Every file under `dir` matching `accept`, repo-relative and sorted. */
function collectFiles(root: string, dir: string, accept: (name: string) => boolean): string[] {
  const base = resolve(root, dir);
  if (!existsSync(base)) return [];
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = resolve(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && accept(entry.name)) out.push(relative(root, full));
    }
  };
  walk(base);
  return out.sort();
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
  if (corpusFiles.length === 0) {
    return checkResult([fail("no markdown found — the design corpus is published and cannot be empty", { file: designDir })], "");
  }

  const sources = new Map<string, string>();
  for (const file of corpusFiles) sources.set(file, readFileSync(resolve(root, file), "utf-8"));

  const defined = new Set<string>();
  const origin = new Map<string, string>();
  for (const [file, source] of sources) {
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

  const corpusSet = new Set(corpusFiles);
  const table = "design-parse.ts";
  for (const [ruleId, corpusPath] of Object.entries(RULE_CORPUS_PATH) as [RuleId, string][]) {
    if (!defined.has(ruleId)) {
      findings.push(fail(`RULE_CORPUS_PATH names \`${ruleId}\`, which no corpus file defines with a marker`, { file: table }));
    }
    if (!corpusSet.has(corpusPath)) {
      findings.push(fail(`RULE_CORPUS_PATH routes \`${ruleId}\` to \`${corpusPath}\`, which is not a corpus file`, { file: table }));
    }
  }

  // `*.test.tsx` files assert on rendered HTML, so a class-literal check on them would flag every
  // deliberate arbitrary value the assertion itself requires — hence the exclusion below.
  const srcSources = collectFiles(
    root,
    sourceDir,
    (name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx") && !/\.browser\.tsx?$/.test(name),
  );
  for (const file of srcSources) {
    for (const finding of findSourceViolations(readFileSync(resolve(root, file), "utf-8"), file)) {
      findings.push(fail(`${finding.ruleId}: ${finding.detail}`, { file: finding.file, line: finding.line }));
    }
  }

  return checkResult(findings, `${corpusFiles.length} corpus files and ${srcSources.length} sources agree on ${defined.size} rules.`);
}
