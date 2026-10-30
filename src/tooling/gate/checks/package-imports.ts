import { readFileSync } from "node:fs";
import { posix, resolve } from "node:path";

import { WRANGLER_CONDITIONS } from "../../cf/dev/conditions";
import type { PackageImports } from "./types";

const DEPLOY_CONDITIONS: ReadonlySet<string> = new Set([...WRANGLER_CONDITIONS, "import", "default"]);

type ImportsValue = PackageImports[string];

interface ImportsMatch {
  value: ImportsValue;
  star: string | null;
}

function isConditions(value: unknown): value is PackageImports {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The `imports` map of `<root>/package.json`, or an empty one when the manifest is absent, unreadable or has none. @internal */
export function readPackageImports(root: string): PackageImports {
  try {
    const manifest: unknown = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));
    if (!isConditions(manifest)) return {};
    return isConditions(manifest.imports) ? manifest.imports : {};
  } catch {
    return {};
  }
}

function patternMatch(key: string, specifier: string): string | null {
  const star = key.indexOf("*");
  if (star < 0 || key.indexOf("*", star + 1) >= 0) return null;
  const prefix = key.slice(0, star);
  const suffix = key.slice(star + 1);
  if (specifier === prefix || !specifier.startsWith(prefix)) return null;
  if (suffix.length > 0 && (!specifier.endsWith(suffix) || specifier.length < key.length)) return null;
  return specifier.slice(prefix.length, specifier.length - suffix.length);
}

function byPatternPrecedence(a: string, b: string): number {
  const prefixDelta = b.indexOf("*") - a.indexOf("*");
  return prefixDelta === 0 ? b.length - a.length : prefixDelta;
}

function matchImports(imports: PackageImports, specifier: string): ImportsMatch | null {
  if (!specifier.startsWith("#")) return null;
  if (Object.hasOwn(imports, specifier)) return { value: imports[specifier] as ImportsValue, star: null };
  const key = Object.keys(imports)
    .filter((candidate) => patternMatch(candidate, specifier) !== null)
    .sort(byPatternPrecedence)[0];
  if (key === undefined) return null;
  return { value: imports[key] as ImportsValue, star: patternMatch(key, specifier) };
}

function toRepoFile(target: string, star: string | null): string | null {
  if (!target.startsWith("./")) return null;
  return posix.normalize(star === null ? target : target.replaceAll("*", star));
}

function everyTarget(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return isConditions(value) ? Object.values(value).flatMap(everyTarget) : [];
}

function activeTarget(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!isConditions(value)) return null;
  for (const [condition, nested] of Object.entries(value)) {
    if (!DEPLOY_CONDITIONS.has(condition)) continue;
    const target = activeTarget(nested);
    if (target !== null) return target;
  }
  return null;
}

/** Every repo-relative file a `#` specifier resolves to under any condition, or none when no `imports` key matches it. @internal */
export function importTargets(imports: PackageImports, specifier: string): string[] {
  const match = matchImports(imports, specifier);
  if (match === null) return [];
  const files = everyTarget(match.value).flatMap((target) => toRepoFile(target, match.star) ?? []);
  return [...new Set(files)];
}

function namesCondition(value: unknown, condition: string): boolean {
  if (!isConditions(value)) return false;
  return Object.entries(value).some(([name, nested]) => name === condition || namesCondition(nested, condition));
}

/** Whether the `imports` entry `key` names `condition` at any depth of its conditions. @internal */
export function importsCondition(imports: PackageImports, key: string, condition: string): boolean {
  return Object.hasOwn(imports, key) && namesCondition(imports[key], condition);
}

/** The repo-relative file a `#` specifier resolves to in the deployed Worker bundle, or `null` when none does. @internal */
export function deployTarget(imports: PackageImports, specifier: string): string | null {
  const match = matchImports(imports, specifier);
  if (match === null) return null;
  const target = activeTarget(match.value);
  return target === null ? null : toRepoFile(target, match.star);
}
