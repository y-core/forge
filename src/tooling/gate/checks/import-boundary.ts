import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, posix, resolve } from "node:path";

import { CliError } from "../../cli/errors";
import { featureGraph } from "../../curate/graph";
import type { FeatureGraph, FeatureManifest } from "../../curate/types";
import { checkResult, fail, scannedNothing } from "../finding";
import type { CheckResult, Finding } from "../types";
import { parseImports, resolveSpecifier } from "./namespace-graph-parse";
import { collectFiles, isTestSource, unresolvedSourceEntries } from "./source-scan";
import type { ImportBoundaryCheckConfig } from "./types";

const MODULE_EXTENSIONS = [".ts", ".tsx"] as const;

const SCANNED = (name: string): boolean => MODULE_EXTENSIONS.some((ext) => name.endsWith(ext)) && !isTestSource(name);

/** Whether `file` lives under one of the guarded directories. @public */
export function isGuarded(file: string, guarded: readonly string[]): boolean {
  return guarded.some((dir) => file === dir || file.startsWith(`${dir}/`));
}

// `resolveSpecifier` strips the extension, because the graph check it serves needs only the directory.
// A finding has to name a file, so the extension — and the `mod.ts` a directory specifier means — is put back.
function resolveModuleFile(root: string, modulePath: string): string | null {
  const candidates = [...MODULE_EXTENSIONS.map((ext) => `${modulePath}${ext}`), ...MODULE_EXTENSIONS.map((ext) => `${modulePath}/mod${ext}`)];
  return candidates.find((candidate) => existsSync(resolve(root, candidate))) ?? null;
}

/** Every published subpath whose target is a guarded module, as a consumer would spell it. @public */
export function guardedSubpaths(config: Pick<ImportBoundaryCheckConfig, "packageName" | "exports" | "guarded">): Map<string, string> {
  const found = new Map<string, string>();
  if (config.packageName === undefined || config.exports === undefined) return found;
  for (const [subpath, value] of Object.entries(config.exports)) {
    const target = typeof value === "string" ? value : (value.import ?? value.types);
    if (target === undefined) continue;
    const normalized = target.startsWith("./") ? target.slice(2) : target;
    if (!isGuarded(normalized, config.guarded)) continue;
    found.set(`${config.packageName}${subpath.slice(1)}`, normalized);
  }
  return found;
}

function isCanonicalDir(dir: string): boolean {
  return dir !== "." && !isAbsolute(dir) && !dir.endsWith("/") && posix.normalize(dir) === dir && !dir.split("/").includes("..");
}

function checkGuardedDir(root: string, dir: string): Finding | null {
  if (!isCanonicalDir(dir)) {
    return fail(`guarded \`${dir}\` is not spelled as the walk reports it`, {
      detail: ["a guarded directory must be root-relative, spelled as the walk reports it — no leading `./`, no trailing `/`, no `..`"],
    });
  }
  const full = resolve(root, dir);
  if (existsSync(full) && statSync(full).isDirectory()) return null;
  return fail(`guarded \`${dir}\` names no directory under the root`, {
    detail: ["a guarded directory must exist, or the boundary it declares holds nothing"],
  });
}

/** What a guarded module a source names resolves to, or `null` when the specifier stays outside every guarded tree. */
function crossingTarget(root: string, guarded: readonly string[], file: string, specifier: string, published: Map<string, string>): string | null {
  const module = resolveSpecifier(file, specifier);
  if (module !== null) return isGuarded(module, guarded) ? (resolveModuleFile(root, module) ?? module) : null;
  // A self-import by package name resolves to nothing relative, so it would otherwise walk straight
  // past both the graph check and this one.
  return published.get(specifier) ?? null;
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
  guarded: readonly string[],
  published: Map<string, string>,
): Finding[] {
  const required = graph.closure.get(feature) ?? new Set<string>();
  return parseImports(readFileSync(resolve(root, file), "utf-8")).flatMap((ref) => {
    if (ref.kind === "type") return [];
    const target = crossingTarget(root, guarded, file, ref.specifier, published);
    const reached = target === null ? undefined : owningFeature(dirs, target);
    if (target === null || reached === undefined || reached === feature || required.has(reached)) return [];
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
}

/** Fails when a source outside the guarded directories, save a named crossing, imports one of their modules at value, or a feature's source imports a feature it does not require. @public */
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
          fail("`guarded` names no directory", {
            detail: ["an import boundary that guards nothing holds nothing, so an empty list fails rather than passing"],
          }),
        ]
      : guarded.flatMap((dir) => checkGuardedDir(config.root, dir) ?? []);
  if (misconfigured.length > 0) return checkResult(misconfigured, "");

  const published = guardedSubpaths({ ...config, guarded });
  const dirs = guarded.map((dir) => `\`${dir}\``).join(", ");
  const named = crossings.map((crossing) => `\`${crossing}\``).join(", ");
  const findings: Finding[] = [];
  const judgedFiles = new Set<string>();
  let judged = 0;

  for (const file of files) {
    const feature = owningFeature(slices, file);
    if (graph !== undefined && feature !== undefined) {
      findings.push(...judgeSliceSource(config.root, file, feature, graph, slices, guarded, published));
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
      const target = crossingTarget(config.root, guarded, file, ref.specifier, published);
      if (target === null) continue;
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

  for (const crossing of crossings) {
    if (judgedFiles.has(crossing)) continue;
    findings.push(
      fail(`crossing \`${crossing}\` names no source the walk judges`, {
        detail: [
          "a crossing must be a scanned file outside every guarded directory, spelled as the walk reports it — root-relative, with its extension",
        ],
      }),
    );
  }

  const save = crossings.length === 0 ? "" : `, save ${named}`;
  const sliced = graph === undefined ? "" : "; feature sources import only what they require";
  return checkResult(findings, `${judged} sources outside ${dirs} import nothing inside them${save}${sliced}`);
}
