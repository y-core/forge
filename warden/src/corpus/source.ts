import { existsSync } from "node:fs";
import { posix, relative, resolve, sep } from "node:path";

import { collectFiles } from "../../../src/tooling/gate/checks/source-scan";
import { CANON_ROOT } from "../paths";
import type { Corpus, SourceDoc, Tree } from "../types";
import { dependencyWeightOf, librarySources } from "./dependency";

const CANON_TREES: readonly Tree[] = ["shared", "libs", "apps"];

/** Retrieval weight by path. Derived rather than declared: a frontmatter field stating the same
 *  thing could drift from where the document actually lives, and this cannot.
 *
 *  **Canon sits above `docs/` deliberately, and the margin is small on purpose.** The canon states
 *  the rule and `docs/` states this repository's answer to it, so where both match, the rule leads.
 *  Inverting it was measured rather than argued: it moves a repository-specific question up about
 *  three ranks and costs the golden set five, because most queries want the rule. The weight is also
 *  a weaker lever than it looks — a scoped search finds a `docs/` section far higher than an
 *  unscoped one does, and that is the ~1,000 competing chunks, not this multiplier.
 *
 *  **The 0.9 README weight was re-examined after the duplication sweep and left alone.** The premise
 *  for raising it was that a README chunk no longer competes with the doc it copied; the measurement
 *  did not support acting on it. The noise the sweep was meant to clear — heading stubs at ranks 2-4
 *  of "how many comments am I allowed to write" — is mostly `src/ui/design/` routing tables at 1.0
 *  and 1.3, which a README weight does not reach, and raising 0.9 would lift the one README stub
 *  among them rather than sink it. The floor margin widened on its own (0.392/0.308 before the sweep,
 *  0.390/0.271 after), which is the sweep's real effect. The sweep itself is no longer a manual one:
 *  `warden:duplicates` measures it every run, so a later re-examination starts from that step's
 *  output rather than from this paragraph. @public */
export function weightOf(corpus: Corpus, path: string): number {
  if (corpus === "canon") return 1.3;
  if (corpus === "dependency") return dependencyWeightOf(path);
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

/** The repository's own indexable documents: `docs/`, the design corpus, every README, and warden's own. @public */
export function localSources(root: string, docsDir = "docs"): SourceDoc[] {
  const paths = [
    ...collectFiles(root, docsDir, (name) => name.endsWith(".md")),
    ...collectFiles(root, "src/ui/design", (name) => name.endsWith(".md")),
    ...collectFiles(root, "src", (name) => name === "README.md"),
    ...(existsSync(resolve(root, "README.md")) ? ["README.md"] : []),
    ...(existsSync(resolve(root, "warden/README.md")) ? ["warden/README.md"] : []),
  ];
  return [...new Set(paths)]
    .sort()
    .map((path) => ({ corpus: "project" as const, path, file: resolve(root, path), weight: weightOf("project", path) }));
}

/** Every document one index covers, canon first, each path posix-spelled so an id is host-independent.
 *
 *  `dependencyRoot` defaults to undefined and nothing supplies it by default: the installed
 *  library's documents are served only where a repository has asked for them. @public */
export function discover(root: string, kind: Tree, options: { canonRoot?: string; docsDir?: string; dependencyRoot?: string } = {}): SourceDoc[] {
  const canon = canonSources(kind, options.canonRoot ?? CANON_ROOT);
  const local = localSources(root, options.docsDir ?? "docs");
  const library = options.dependencyRoot === undefined ? [] : librarySources(options.dependencyRoot);
  return [...canon, ...local, ...library].map((doc) => ({ ...doc, path: doc.path.split(sep).join(posix.sep) }));
}

/** A repository-relative, posix-spelled path. @public */
export function repoRelative(root: string, file: string): string {
  return relative(root, file).split(sep).join(posix.sep);
}
