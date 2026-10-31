import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, posix, resolve } from "node:path";

import { CliError } from "../../cli/errors";
import { featureGraph } from "../../curate/graph";
import type { FeatureGraph, FeatureManifest } from "../../curate/types";
import { checkResult, fail, scannedNothing } from "../finding";
import type { CheckResult, Finding } from "../types";
import { parseImports, publishedSubpaths, resolveSpecifier } from "./namespace-graph-parse";
import { importTargets, readPackageImports } from "./package-imports";
import { collectFiles, isTestSource, resolveModuleFile, unresolvedSourceEntries } from "./source-scan";
import type { ImportBoundaryCheckConfig, PackageImports } from "./types";

const MODULE_EXTENSIONS = [".ts", ".tsx"] as const;

const SCANNED = (name: string): boolean => MODULE_EXTENSIONS.some((ext) => name.endsWith(ext)) && !isTestSource(name);

/** Whether `file` is, or lives under, one of the guarded paths. @public */
export function isGuarded(file: string, guarded: readonly string[]): boolean {
  return guarded.some((dir) => file === dir || file.startsWith(`${dir}/`));
}

/** Every published subpath whose target is a guarded module, as a consumer would spell it. @public */
export function guardedSubpaths(config: Pick<ImportBoundaryCheckConfig, "packageName" | "exports" | "guarded">): Map<string, string> {
  return new Map([...publishedSubpaths(config.packageName, config.exports)].filter(([, target]) => isGuarded(target, config.guarded)));
}

function isCanonicalDir(dir: string): boolean {
  return dir !== "." && !isAbsolute(dir) && !dir.endsWith("/") && posix.normalize(dir) === dir && !dir.split("/").includes("..");
}

function checkGuardedEntry(root: string, entry: string): Finding | null {
  if (!isCanonicalDir(entry)) {
    return fail(`guarded \`${entry}\` is not spelled as the walk reports it`, {
      detail: ["a guarded path must be root-relative, spelled as the walk reports it — no leading `./`, no trailing `/`, no `..`"],
    });
  }
  const full = resolve(root, entry);
  const stat = existsSync(full) ? statSync(full) : null;
  if (stat?.isDirectory() || (stat?.isFile() && SCANNED(entry))) return null;
  return fail(`guarded \`${entry}\` names no directory or source file under the root`, {
    detail: ["a guarded directory or source file must exist, or the boundary it declares holds nothing"],
  });
}

/** What a source's specifier reaches: the guarded paths, the guarded subpaths a self-import names, and the `imports` map a `#` specifier goes through. */
interface CrossingScope {
  guarded: readonly string[];
  published: Map<string, string>;
  imports: PackageImports;
}

/** Every guarded module a source's specifier resolves to, empty when it stays outside every guarded tree. */
function crossingTargets(root: string, scope: CrossingScope, file: string, specifier: string): string[] {
  const module = resolveSpecifier(file, specifier);
  if (module !== null) {
    const target = resolveModuleFile(root, module) ?? module;
    return isGuarded(target, scope.guarded) ? [target] : [];
  }
  const mapped = importTargets(scope.imports, specifier).filter((target) => isGuarded(target, scope.guarded));
  if (mapped.length > 0) return mapped;
  const published = scope.published.get(specifier);
  return published === undefined ? [] : [published];
}

interface FeatureDir {
  feature: string;
  dir: string;
}

function featureDirs(features: FeatureManifest, sources: readonly string[]): FeatureDir[] {
  const walked = sources.map((source) => source.replace(/\/+$/, ""));
  return Object.entries(features).flatMap(([feature, { directories }]) =>
    directories.map((directory) => ({ feature, dir: directory.replace(/\/+$/, "") })).filter(({ dir }) => isGuarded(dir, walked)),
  );
}

function owningFeature(dirs: readonly FeatureDir[], path: string): string | undefined {
  return dirs.find(({ dir }) => isGuarded(path, [dir]))?.feature;
}

function judgeSliceSource(
  root: string,
  file: string,
  feature: string,
  graph: FeatureGraph,
  dirs: readonly FeatureDir[],
  scope: CrossingScope,
): Finding[] {
  const required = graph.closure.get(feature) ?? new Set<string>();
  return parseImports(readFileSync(resolve(root, file), "utf-8")).flatMap((ref) => {
    if (ref.kind === "type") return [];
    return crossingTargets(root, scope, file, ref.specifier).flatMap((target) => {
      const reached = owningFeature(dirs, target);
      if (reached === undefined || reached === feature || required.has(reached)) return [];
      return [
        fail(
          `slice boundary crossed — \`${ref.specifier}\` resolves to \`${target}\`, inside feature \`${reached}\`, which \`${feature}\` does not require`,
          {
            file,
            line: ref.line,
            detail: [
              "a feature's directory may import only the features it requires, directly or through another",
              `add \`${reached}\` to \`${feature}\`'s \`requires\` in the feature manifest, or drop the import`,
            ],
          },
        ),
      ];
    });
  });
}

/** Fails when a source outside the guarded paths, save a named crossing, imports one of their modules at value, or a feature's source imports a feature it does not require. @public */
export function checkImportBoundary(config: ImportBoundaryCheckConfig): CheckResult {
  const sources = config.sources ?? ["src"];
  const crossings = config.crossings ?? [];
  const files = sources.flatMap((dir) => collectFiles(config.root, dir, SCANNED));
  if (files.length === 0) return scannedNothing(`\`${sources.join("`, `")}\` matched no source`, "import-boundary");
  const unresolved = unresolvedSourceEntries(config.root, sources);
  if (unresolved.length > 0) return checkResult(unresolved, "");

  let graph: FeatureGraph | undefined;
  try {
    graph = config.features === undefined ? undefined : featureGraph(config.features);
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    return checkResult([fail(error.message)], "");
  }
  const slices = config.features === undefined ? [] : featureDirs(config.features, sources);
  const guarded = [...new Set([...config.guarded, ...slices.map(({ dir }) => dir)])];

  const misconfigured =
    guarded.length === 0
      ? [
          fail("`guarded` names no path", {
            detail: ["an import boundary that guards nothing holds nothing, so an empty list fails rather than passing"],
          }),
        ]
      : guarded.flatMap((entry) => checkGuardedEntry(config.root, entry) ?? []);
  if (misconfigured.length > 0) return checkResult(misconfigured, "");

  const scope: CrossingScope = { guarded, published: guardedSubpaths({ ...config, guarded }), imports: readPackageImports(config.root) };
  const dirs = guarded.map((dir) => `\`${dir}\``).join(", ");
  const named = crossings.map((crossing) => `\`${crossing}\``).join(", ");
  const findings: Finding[] = [];
  const judgedFiles = new Set<string>();
  let judged = 0;

  for (const file of files) {
    const feature = owningFeature(slices, file);
    if (graph !== undefined && feature !== undefined) {
      findings.push(...judgeSliceSource(config.root, file, feature, graph, slices, scope));
      continue;
    }
    if (isGuarded(file, guarded)) continue;
    judgedFiles.add(file);
    if (crossings.includes(file)) continue;
    judged++;
    for (const ref of parseImports(readFileSync(resolve(config.root, file), "utf-8"))) {
      // A type import is erased at emit, so it puts nothing in a Worker's bundle. The layering it
      // still represents is `validate-namespace-graph`'s to judge, against a declared edge.
      if (ref.kind === "type") continue;
      for (const target of crossingTargets(config.root, scope, file, ref.specifier)) {
        findings.push(
          fail(`import boundary crossed — \`${ref.specifier}\` resolves to \`${target}\``, {
            file,
            line: ref.line,
            detail: [
              `nothing outside ${dirs}${crossings.length === 0 ? "" : `, or the named crossing(s) ${named},`} may import from inside them at value`,
              "move the importing module inside the guarded tree, or drop the import",
            ],
          }),
        );
      }
    }
  }

  for (const crossing of crossings) {
    if (judgedFiles.has(crossing)) continue;
    findings.push(
      fail(`crossing \`${crossing}\` names no source the walk judges`, {
        detail: [
          "a crossing must be a scanned file outside every guarded path, spelled as the walk reports it — root-relative, with its extension",
        ],
      }),
    );
  }

  const save = crossings.length === 0 ? "" : `, save ${named}`;
  const sliced = graph === undefined ? "" : "; feature sources import only what they require";
  return checkResult(findings, `${judged} sources outside ${dirs} import nothing inside them${save}${sliced}`);
}
