import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { type CheckResult, checkResult, type Finding, fail, scannedNothing } from "../finding";
import type { ExportsMap } from "./exports";
import { parseImports, resolveSpecifier } from "./namespace-graph-parse";
import { collectFiles } from "./source-scan";

/** What the build-time-boundary check needs to know about the project. @public */
export interface BuildTimeBoundaryCheckConfig {
  /** Repository root; every reported path is relative to it. */
  root: string;
  /** The package name consumers import under, e.g. `@y-core/forge`. */
  packageName: string;
  /** The `exports` map, verbatim from `package.json` — which subpaths are build-time is *derived* from it. */
  exports: ExportsMap;
  /** Directories whose modules run on a developer's machine, relative to `root`. */
  buildTimeDirs: readonly string[];
  /** Directories walked for source files, relative to `root`. Defaults to `["src"]`. */
  sources?: readonly string[];
}

const MODULE_EXTENSIONS = [".ts", ".tsx"] as const;

// A spec is not shipped, and a `.browser.ts` spec runs under Playwright — neither reaches a Worker.
const SCANNED = (name: string): boolean => MODULE_EXTENSIONS.some((ext) => name.endsWith(ext)) && !/\.(test|browser)\.tsx?$/.test(name);

/** Whether `file` lives under one of the build-time directories. @public */
export function isBuildTime(file: string, buildTimeDirs: readonly string[]): boolean {
  return buildTimeDirs.some((dir) => file === dir || file.startsWith(`${dir}/`));
}

// `resolveSpecifier` returns a module path with the extension stripped, because the graph check it
// serves only needs the directory. A finding has to name a file, so the extension — and the
// `mod.ts` a directory specifier means — is put back.
function resolveModuleFile(root: string, modulePath: string): string | null {
  const candidates = [...MODULE_EXTENSIONS.map((ext) => `${modulePath}${ext}`), ...MODULE_EXTENSIONS.map((ext) => `${modulePath}/mod${ext}`)];
  return candidates.find((candidate) => existsSync(resolve(root, candidate))) ?? null;
}

/** Every published subpath whose target is a build-time module, as a consumer would spell it. @public */
export function buildTimeSubpaths(config: Pick<BuildTimeBoundaryCheckConfig, "packageName" | "exports" | "buildTimeDirs">): Map<string, string> {
  const found = new Map<string, string>();
  for (const [subpath, value] of Object.entries(config.exports)) {
    const target = typeof value === "string" ? value : (value.import ?? value.types);
    if (target === undefined) continue;
    const normalized = target.startsWith("./") ? target.slice(2) : target;
    if (!isBuildTime(normalized, config.buildTimeDirs)) continue;
    found.set(`${config.packageName}${subpath.slice(1)}`, normalized);
  }
  return found;
}

/** What a build-time module a source names resolves to, or `null` when the specifier stays inside the runtime tree. */
function crossingTarget(config: BuildTimeBoundaryCheckConfig, file: string, specifier: string, published: Map<string, string>): string | null {
  const module = resolveSpecifier(file, specifier);
  if (module !== null) return isBuildTime(module, config.buildTimeDirs) ? (resolveModuleFile(config.root, module) ?? module) : null;
  // A self-import by package name resolves to nothing relative, so it would otherwise walk straight
  // past both the graph check and this one.
  return published.get(specifier) ?? null;
}

/** Fails when a source outside the build-time directories imports one of their modules at value. @public */
export function checkBuildTimeBoundary(config: BuildTimeBoundaryCheckConfig): CheckResult {
  const sources = config.sources ?? ["src"];
  const files = sources.flatMap((dir) => collectFiles(config.root, dir, SCANNED));
  if (files.length === 0) return scannedNothing(`\`${sources.join("`, `")}\` matched no source`, "build-time-boundary");

  const published = buildTimeSubpaths(config);
  const findings: Finding[] = [];
  let judged = 0;

  for (const file of files) {
    if (isBuildTime(file, config.buildTimeDirs)) continue;
    judged++;
    for (const ref of parseImports(readFileSync(resolve(config.root, file), "utf-8"))) {
      // A type import is erased at emit, so it puts nothing in a Worker's bundle. The layering it
      // still represents is `validate-namespace-graph`'s to judge, against a declared edge.
      if (ref.kind === "type") continue;
      const target = crossingTarget(config, file, ref.specifier, published);
      if (target === null) continue;
      findings.push(
        fail(`build-time boundary crossed — \`${ref.specifier}\` resolves to \`${target}\``, {
          file,
          line: ref.line,
          detail: [
            "membership in a build-time directory *is* the Web-APIs-only exemption, so no module outside one may import it",
            "move the module to the namespace that owns its artifact, or drop the import",
          ],
        }),
      );
    }
  }

  const dirs = config.buildTimeDirs.map((dir) => `\`${dir}\``).join(", ");
  return checkResult(findings, `${judged} sources outside ${dirs} import nothing inside them`);
}
