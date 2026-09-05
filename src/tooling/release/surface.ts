import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseConsumerExportNames } from "../gate/checks/barrel-parse";
import { readFileAtRef } from "./git";
import { ReleaseError } from "./types";

/** Reads a barrel's source at a repo-relative path, or `null` when it is absent. */
export type BarrelReader = (relPath: string) => string | null;

function targetOf(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (entry === null || typeof entry !== "object") return undefined;
  const conditions = entry as { import?: unknown; types?: unknown };
  const chosen = conditions.import ?? conditions.types;
  return typeof chosen === "string" ? chosen : undefined;
}

function exportsMapOf(packageJsonSource: string, manifestOrigin: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJsonSource);
  } catch (err) {
    throw new ReleaseError("manifest-malformed", `${manifestOrigin} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (parsed === null || typeof parsed !== "object") return {};
  const map = (parsed as { exports?: unknown }).exports;
  return map !== null && typeof map === "object" ? (map as Record<string, unknown>) : {};
}

/** The `<specifier>#<exportName>` set an exports map and its barrels publish. */
export function collectSurface(packageJsonSource: string, readBarrel: BarrelReader, manifestOrigin = "package.json"): Set<string> {
  const surface = new Set<string>();

  for (const [specifier, entry] of Object.entries(exportsMapOf(packageJsonSource, manifestOrigin))) {
    if (specifier.includes("*")) continue;
    const target = targetOf(entry);
    if (target === undefined) continue;

    const source = readBarrel(target.startsWith("./") ? target.slice(2) : target);
    if (source === null) continue;
    for (const name of parseConsumerExportNames(source)) surface.add(`${specifier}#${name}`);
  }

  return surface;
}

/** Entries present in `before` and gone from `after`, sorted. */
export function diffSurface(before: Set<string>, after: Set<string>): string[] {
  return [...before].filter((entry) => !after.has(entry)).sort();
}

function readWorkingTree(cwd: string): BarrelReader {
  return (relPath) => {
    try {
      return readFileSync(resolve(cwd, relPath), "utf-8");
    } catch {
      return null;
    }
  };
}

/** Public-surface entries lost between `ref` and the working tree. */
export function removedSurfaceSince(cwd: string, ref: string, readAtRef: BarrelReader = (relPath) => readFileAtRef(cwd, ref, relPath)): string[] {
  const beforeManifest = readAtRef("package.json");
  if (beforeManifest === null) return [];

  const readTree = readWorkingTree(cwd);
  const afterManifest = readTree("package.json");
  if (afterManifest === null) throw new ReleaseError("manifest-malformed", "package.json in the working tree could not be read");

  const before = collectSurface(beforeManifest, readAtRef, `package.json at ${ref}`);
  const after = collectSurface(afterManifest, readTree, "package.json in the working tree");

  return diffSurface(before, after);
}
