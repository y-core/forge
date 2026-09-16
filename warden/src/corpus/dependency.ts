import { readFileSync, realpathSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

import { collectFiles } from "../../../src/tooling/gate/checks/source-scan";
import { libraryPrefix, WARDEN_ROOT } from "../paths";
import type { SourceDoc } from "../types";

/** Retrieval weight for an installed library's document. @public */
export const DEPENDENCY_WEIGHT = 0.9;

/** Retrieval weight for an installed library's namespace README. @public */
export const DEPENDENCY_README_WEIGHT = 0.65;

/** The weight an installed library's document carries, by the kind of document it is. @public */
export function dependencyWeightOf(path: string): number {
  return path.endsWith("README.md") ? DEPENDENCY_README_WEIGHT : DEPENDENCY_WEIGHT;
}

/** Who a document is written for. Declared in its own frontmatter, never derived. @public */
export type Audience = "consumer" | "internal";

/** The audience a document declares, or `undefined` when it declares none. @public */
export function audienceOf(source: string): Audience | undefined {
  if (!source.startsWith("---\n")) return undefined;
  const end = source.indexOf("\n---", 4);
  if (end === -1) return undefined;
  const value = source
    .slice(4, end)
    .match(/^audience:\s*(.+)$/m)?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, "");
  return value === "consumer" || value === "internal" ? value : undefined;
}

/** The installed library's own root, or `undefined` when there is none to serve. @public */
export function libraryRoot(repoRoot: string): string | undefined {
  const root = resolve(WARDEN_ROOT, "..");
  try {
    // Compared through `realpath`: one side routinely arrives through a symlinked `node_modules` entry.
    return realpathSync(root) === realpathSync(repoRoot) ? undefined : root;
  } catch {
    // One of the two is not on disk, so there is nothing to serve and nothing to compare.
    return undefined;
  }
}

/** Audiences already read, keyed by the file's identity rather than its path alone. */
const AUDIENCES = new Map<string, Audience | undefined>();

function cachedAudience(file: string): Audience | undefined {
  const stat = statSync(file) as { size: number; mtimeMs?: number };
  const key = `${file}:${stat.size}:${stat.mtimeMs ?? 0}`;
  if (AUDIENCES.has(key)) return AUDIENCES.get(key);
  const audience = audienceOf(readFileSync(file, "utf-8"));
  AUDIENCES.set(key, audience);
  return audience;
}

/** Where the library's per-namespace READMEs live, relative to its root. */
const SOURCE_DIR = "src";

/** The installed library's consumer-facing documents: its `docs/` and its namespace READMEs. @public */
export function librarySources(root: string, docsDir = "docs"): SourceDoc[] {
  const prefix = libraryPrefix(root);
  // A bare filename collides with the canon on six names and `docs/` with the consuming
  // repository's own, so an id is spelled `<package>/<DOC>.md`.
  const docs = collectFiles(root, docsDir, (name) => name.endsWith(".md")).map((entry) => ({
    entry,
    path: `${prefix}/${entry.slice(docsDir.length + 1)}`,
  }));
  const readmes = collectFiles(root, SOURCE_DIR, (name) => name === "README.md").map((entry) => ({ entry, path: `${prefix}/${entry}` }));
  return [...docs, ...readmes]
    .map(({ entry, path }) => ({ path, file: resolve(root, entry) }))
    .filter(({ file }) => cachedAudience(file) === "consumer")
    .map(({ path, file }) => ({ corpus: "dependency" as const, path, file, weight: dependencyWeightOf(path) }))
    .sort((left, right) => (left.path < right.path ? -1 : 1));
}

/** What a caller asks for by way of the installed library's documents. @public */
export interface DependencyOptions {
  /** Serve the installed library's consumer-facing documents. Defaults to off. */
  dependency?: boolean;
  /** The library root, stated rather than derived. Implies `dependency`. */
  dependencyRoot?: string;
}

/** The library root a caller's options resolve to, or `undefined` when none is asked for. @public */
export function dependencyRootOf(options: DependencyOptions, repoRoot: string): string | undefined {
  if (options.dependencyRoot !== undefined) return options.dependencyRoot;
  return options.dependency === true ? libraryRoot(repoRoot) : undefined;
}

/** The installed library's `docs/` as a citable directory, or `undefined` when there is no library. @public */
export function libraryDocsDir(repoRoot: string, docsDir = "docs"): { dir: string; as: string } | undefined {
  const library = dependencyRootOf({ dependency: true }, repoRoot);
  if (library === undefined) return undefined;
  return { dir: relative(repoRoot, resolve(library, docsDir)), as: libraryPrefix(library) };
}
