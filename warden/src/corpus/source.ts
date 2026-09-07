import { existsSync } from "node:fs";
import { posix, relative, resolve, sep } from "node:path";

import { collectFiles } from "../../../src/tooling/gate/checks/source-scan";
import { CANON_ROOT } from "../paths";
import type { Corpus, SourceDoc, Tree } from "../types";

const CANON_TREES: readonly Tree[] = ["shared", "libs", "apps"];

/** Retrieval weight by path. Derived rather than declared: a frontmatter field stating the same
 *  thing could drift from where the document actually lives, and this cannot. @public */
export function weightOf(corpus: Corpus, path: string): number {
  if (corpus === "canon") return 1.3;
  if (path === "src/ui/design/floor.md") return 1.3;
  if (path.startsWith("docs/")) return 1.2;
  if (path.startsWith("src/ui/design/")) return 1.0;
  return 0.9;
}

/** The canon documents of the trees a repository of `kind` is subject to — `shared` and its own.
 *  The apps corpus is not law in a library, and indexing it would return two hits per shared rule. @public */
export function canonSources(kind: Tree, canonRoot = CANON_ROOT): SourceDoc[] {
  const trees = CANON_TREES.filter((tree) => tree === "shared" || tree === kind);
  return trees.flatMap((tree) =>
    collectFiles(canonRoot, tree, (name) => name.endsWith(".md")).map((entry) => {
      const path = entry.slice(tree.length + 1);
      return { corpus: "canon" as const, tree, path, file: resolve(canonRoot, entry), weight: weightOf("canon", path) };
    }),
  );
}

/** The repository's own indexable documents: `docs/`, the design corpus, and every README. @public */
export function localSources(root: string, docsDir = "docs"): SourceDoc[] {
  const paths = [
    ...collectFiles(root, docsDir, (name) => name.endsWith(".md")),
    ...collectFiles(root, "src/ui/design", (name) => name.endsWith(".md")),
    ...collectFiles(root, "src", (name) => name === "README.md"),
    ...(existsSync(resolve(root, "README.md")) ? ["README.md"] : []),
  ];
  return [...new Set(paths)].sort().map((path) => ({ corpus: "local" as const, path, file: resolve(root, path), weight: weightOf("local", path) }));
}

/** Every document one index covers, canon first, each path posix-spelled so an id is host-independent. @public */
export function discover(root: string, kind: Tree, options: { canonRoot?: string; docsDir?: string } = {}): SourceDoc[] {
  const canon = canonSources(kind, options.canonRoot ?? CANON_ROOT);
  const local = localSources(root, options.docsDir ?? "docs");
  return [...canon, ...local].map((doc) => ({ ...doc, path: doc.path.split(sep).join(posix.sep) }));
}

/** A repository-relative, posix-spelled path. @public */
export function repoRelative(root: string, file: string): string {
  return relative(root, file).split(sep).join(posix.sep);
}
