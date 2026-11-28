import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseConsumerExportNames } from "../../../src/tooling/gate/checks/barrel-parse";
import {
  findBarrelImports,
  findCustomPropertyCitations,
  findRuleCitations,
  findRuleMarkers,
  parseDeclaredCustomProperties,
} from "../../../src/tooling/gate/checks/design-parse";
import { collectFiles } from "../../../src/tooling/gate/checks/source-scan";
import type { ExportsMap } from "../../../src/tooling/gate/checks/types";
import { checkResult, fail, scannedNothing } from "../../../src/tooling/gate/finding";
import type { CheckResult, Finding } from "../../../src/tooling/gate/types";
import { findCodeFences } from "./docs";
import { findSubpathCitations } from "./docs-parse";
import {
  bareRelativeImports,
  compileFences,
  type FenceDiagnostic,
  type FenceLang,
  type FenceSource,
  isParseDiagnostic,
  missingRuntimeGlobal,
  unresolvedModule,
  unresolvedName,
} from "./fence-compile";

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
  /** Markdown outside `designDir` whose `tsx` fences compile too, relative to `root`. */
  fencedDocs?: readonly string[];
  /** The compiler options a fence compiles under, relative to `root`. Defaults to `tsconfig.json`. */
  tsconfig?: string;
  /** The Floor document, relative to `designDir`, and each rule id's register statement; a marker elsewhere whose statement does not open `Default:` fails. */
  floor?: { file: string; statements: ReadonlyMap<string, string> };
}

/** What a fence check needs to know about the project. */
type FenceCheckConfig = Pick<DesignCheckConfig, "root" | "packageName" | "exports" | "fencedDocs" | "tsconfig">;

/** Which fences a fence check compiles. */
interface FenceSelection {
  langs: readonly FenceLang[];
  /** Whether a fence flagged `nocheck` is skipped, and a module outside the package or a runtime global passes as app context. */
  docs: boolean;
  /** Subpaths, as `exports` keys, a fence imports as `any` rather than through their sources. */
  untypedSubpaths?: readonly string[];
}

/** Every fence in `langs` compiled against the exports, as findings, and how many compiled clean or were skipped. */
function checkFences(
  config: FenceCheckConfig,
  sources: ReadonlyMap<string, string>,
  { langs, docs, untypedSubpaths = [] }: FenceSelection,
): { findings: Finding[]; clean: number; skipped: number } {
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
  const isCompiled = (lang: string): lang is FenceLang => (langs as readonly string[]).includes(lang);
  const selected = [...documents].flatMap(([file, source]) =>
    findCodeFences(source).flatMap(({ lang, flags, line, body }) => (isCompiled(lang) ? [{ file, line, body, lang, flags }] : [])),
  );
  const fences: FenceSource[] = selected
    .filter(({ flags }) => !(docs && flags.includes("nocheck")))
    .map(({ file, line, body, lang }) => ({ file, line, body: docs ? bareRelativeImports(body) : body, lang }));
  const skipped = selected.length - fences.length;
  if (fences.length === 0) return { findings, clean: 0, skipped };
  const named = langs.map((lang) => `\`${lang}\``).join(" or ");

  const untyped = new Set(untypedSubpaths);
  const paths: Record<string, string[]> = {};
  const owners = new Map<string, string[]>();
  for (const [key, value] of Object.entries(config.exports)) {
    const target = (typeof value === "string" ? [value] : [value.import, value.types]).find((path) => path !== undefined && /\.tsx?$/.test(path));
    if (target === undefined) continue;
    const specifier = `${packageName}${key.slice(1)}`;
    if (!untyped.has(key)) paths[specifier] = [resolve(root, target)];
    if (key.includes("*") || target.endsWith(".d.ts") || !existsSync(resolve(root, target))) continue;
    for (const name of parseConsumerExportNames(readFileSync(resolve(root, target), "utf-8"))) {
      owners.set(name, [...(owners.get(name) ?? []), specifier]);
    }
  }
  const project = { tsconfig: resolve(root, tsconfig), paths };
  const describe = (diagnostic: FenceDiagnostic, lang: FenceLang): string => {
    const name = unresolvedName(diagnostic);
    const subpaths = name === undefined ? undefined : owners.get(name);
    if (name !== undefined && subpaths !== undefined) {
      return `\`${name}\` is not imported — ${subpaths.map((subpath) => `\`${subpath}\``).join(" or ")} exports it`;
    }
    return `\`${lang}\` fence does not compile: ${diagnostic.message} (TS${diagnostic.code})`;
  };
  const report = (diagnostic: FenceDiagnostic, compiled: readonly FenceSource[]): void => {
    const lang = compiled[diagnostic.fence]?.lang ?? "tsx";
    findings.push(fail(describe(diagnostic, lang), { file: diagnostic.file, line: diagnostic.line }));
  };

  const notCompiled = (error: string): { findings: Finding[]; clean: number; skipped: number } => ({
    findings: [...findings, fail(`no ${named} fence was compiled — ${error}`, { file: tsconfig })],
    clean: 0,
    skipped,
  });

  const modules = new Set(untypedSubpaths.filter((key) => key in config.exports).map((key) => `${packageName}${key.slice(1)}`));
  let live = fences;
  let run = compileFences(live, project, new Map(), [...modules]);
  for (;;) {
    if (!run.ok) return notCompiled(run.error);
    const diagnostics = run.data;
    const broken = new Set(diagnostics.filter(({ code }) => isParseDiagnostic(code)).map(({ fence }) => fence));
    if (broken.size === 0) break;
    for (const diagnostic of diagnostics) if (isParseDiagnostic(diagnostic.code)) report(diagnostic, live);
    live = live.filter((_, index) => !broken.has(index));
    if (live.length === 0) return { findings, clean: 0, skipped };
    run = compileFences(live, project, new Map(), [...modules]);
  }

  const ambient = new Map<number, string[]>();
  for (const diagnostic of run.data) {
    const specifier = docs ? unresolvedModule(diagnostic) : undefined;
    if (specifier !== undefined && specifier !== packageName && !specifier.startsWith(`${packageName}/`)) modules.add(specifier);
    const name = unresolvedName(diagnostic) ?? (docs ? missingRuntimeGlobal(diagnostic) : undefined);
    if (name === undefined || owners.has(name)) continue;
    const names = ambient.get(diagnostic.fence) ?? [];
    if (!names.includes(name)) ambient.set(diagnostic.fence, [...names, name]);
  }

  const final = compileFences(live, project, ambient, [...modules]);
  if (!final.ok) return notCompiled(final.error);
  const failing = final.data;
  for (const diagnostic of failing) report(diagnostic, live);
  return { findings, clean: live.length - new Set(failing.map(({ fence }) => fence)).size, skipped };
}

/** What the documentation fence check needs to know about the project. @public */
export interface DocFencesCheckConfig {
  root: string;
  /** The package name consumers import under. */
  packageName: string;
  /** The `exports` map, verbatim from `package.json`. */
  exports: ExportsMap;
  /** Markdown whose fences compile, relative to `root`. */
  fencedDocs: readonly string[];
  /** The compiler options a fence compiles under, relative to `root`. Defaults to `tsconfig.json`. */
  tsconfig?: string;
  /** The fence languages compiled. Defaults to `["ts"]`. */
  langs?: readonly FenceLang[];
  /** Subpaths, as `exports` keys, that are never Worker-reachable, so a fence imports them as `any` rather than compiling their sources. */
  untypedSubpaths?: readonly string[];
}

/** Compiles every documentation fence against the exports, skipping one marked `nocheck` and passing app modules and runtime globals as app context. @public */
export function checkDocFences(config: DocFencesCheckConfig): CheckResult {
  const langs = config.langs ?? ["ts"];
  if (config.fencedDocs.length === 0) return scannedNothing("`fencedDocs` names no markdown", "doc-fences");
  const { findings, clean, skipped } = checkFences(config, new Map(), { langs, docs: true, untypedSubpaths: config.untypedSubpaths ?? [] });
  return checkResult(
    findings,
    `${clean} ${langs.join("/")} fences in ${config.fencedDocs.length} documents compile; ${skipped} marked \`nocheck\` were skipped.`,
  );
}

/** Every marker outside the Floor document whose register statement does not open `Default:`. */
function misfiledFloorFindings(sources: ReadonlyMap<string, string>, floorPath: string, statements: ReadonlyMap<string, string>): Finding[] {
  const findings: Finding[] = [];
  for (const [file, source] of sources) {
    if (file === floorPath) continue;
    for (const { line, id } of findRuleMarkers(source)) {
      const statement = statements.get(id);
      if (statement === undefined || statement.startsWith("Default:")) continue;
      findings.push(
        fail(
          `rule marker \`${id}\` is a Floor rule outside \`${floorPath}\` — move it into the Floor's Verify or Refuse half and cite its id here, or open its statement \`Default:\` with an \`unless …\` clause`,
          { file, line },
        ),
      );
    }
  }
  return findings;
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
  for (const source of sources.values()) {
    for (const { id } of findRuleMarkers(source)) defined.add(id);
  }
  if (config.floor !== undefined) findings.push(...misfiledFloorFindings(sources, `${designDir}/${config.floor.file}`, config.floor.statements));

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

  const fenceCheck = checkFences(config, sources, { langs: ["tsx"], docs: false });
  findings.push(...fenceCheck.findings);

  return checkResult(
    findings,
    `${corpusFiles.length} corpus files and ${srcSources.length} sources agree on ${defined.size} rules; ${fenceCheck.clean} tsx fences compile.`,
  );
}
