import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

import { collectFiles } from "../../../src/tooling/gate/checks/source-scan";
import { packageNameOf, WARDEN_ROOT } from "../paths";
import type { SourceDoc } from "../types";

/** Retrieval weight for an installed library's document.
 *
 *  **Below this repository's own `docs/` at 1.2 and above the library's own READMEs.** The consuming
 *  repository's own answer must outrank the library's wherever both address the question, and the
 *  library's rule must still beat its own usage page. It now sits level with this repository's
 *  README at 0.9: a library rule and a local usage page are different kinds of answer, and the
 *  sweep found no order between them that the golden sets prefer.
 *
 *  **0.9, measured rather than asserted.** It started at 1.1, the value the margin argument alone
 *  suggests. At 1.1 the library's `ROUTING_AND_MIDDLEWARE.md` §1b took top-1 from
 *  `canon:APP_ARCHITECTURE.md` §5a in both consumer repositories and cost three golden queries their
 *  threshold; a sweep found 0.95 the highest weight at which none of them moves.
 *
 *  **0.95 was calibrated against a sixteen-document dependency corpus, and serving the namespace
 *  READMEs more than doubled it.** At that size the same `ROUTING_AND_MIDDLEWARE.md` §1b took the
 *  first three ranks in cornellaw and pushed `canon:APP_ARCHITECTURE.md` §5a to fourth — the same
 *  displacement, at a weight that used to clear it. Re-swept over the grown corpus: 0.9 is the
 *  highest weight at which no golden entry in any of the three consuming repositories moves.
 *  `warden:queries` fails on any golden regression, so a later move is measured too.
 *
 *  It lives here rather than beside the other weights so the module that discovers these documents
 *  is the one nothing else imports from — `weightOf` reads it, not the reverse. @public */
export const DEPENDENCY_WEIGHT = 0.9;

/** Retrieval weight for an installed library's namespace README.
 *
 *  **Below the consuming repository's own README at 0.9** (`source.ts`). A library README is a usage page for
 *  somebody else's code; the repository's own README describes the thing being worked on, and a
 *  question about either has to reach that one first. Without a weight of its own these rows take
 *  `DEPENDENCY_WEIGHT` — `weightOf` returns on the corpus test before any path test — which would
 *  rank the library's usage page above the consumer's own README.
 *
 *  **0.65, swept rather than argued.** The ratio the margin suggests is 0.9 × (0.9 / 1.2) ≈ 0.68.
 *  Swept from 0.9 down against all three consuming repositories' golden sets: 0.67 is the highest
 *  value at which no golden entry moves, and at 0.68 the library's `src/result/README.md` takes
 *  three ranks in starter and pushes `canon:CODE_RULES.md` §2a past its `within: 6`. 0.67 is one
 *  hundredth from that cliff, so the committed value is 0.65 — the same reading of the sweep with
 *  room for the next document to enter the corpus. @public */
export const DEPENDENCY_README_WEIGHT = 0.65;

/** The weight an installed library's document carries, by the kind of document it is. @public */
export function dependencyWeightOf(path: string): number {
  return path.endsWith("README.md") ? DEPENDENCY_README_WEIGHT : DEPENDENCY_WEIGHT;
}

/** Who a document is written for. Declared in its own frontmatter, never derived. @public */
export type Audience = "consumer" | "internal";

/** The audience a document declares, or `undefined` when it declares none.
 *
 *  **Read here rather than stored.** It decides discovery — whether a document enters the index at
 *  all — and never ranking or rendering, so it reaches no column and `SCHEMA_VERSION` is untouched
 *  by it. A document with no key is not served: a new one must fail closed rather than default into
 *  a consuming repository's answers. @public */
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

/** The installed library's own root, or `undefined` when there is none to serve.
 *
 *  **`resolve(WARDEN_ROOT, "..")`, never `installedAppRoot()`** — that one answers with the
 *  *consumer's* root, which is the repository already being indexed. This is the package warden
 *  itself was loaded from, which is the only thing that tracks the consumer's pin.
 *
 *  **Undefined when it is the repository itself.** Run inside the library, the two are the same
 *  tree, and indexing it would put every consumer-facing document in twice — surfacing not as a
 *  duplicate but as an unrelated-looking `catalogueDrift` failure against the committed
 *  `warden/CATALOGUE.md`. Compared through `realpath`, because one side routinely arrives through a
 *  symlinked `node_modules` entry. @public */
export function libraryRoot(repoRoot: string): string | undefined {
  const root = resolve(WARDEN_ROOT, "..");
  try {
    return realpathSync(root) === realpathSync(repoRoot) ? undefined : root;
  } catch {
    // One of the two is not on disk, so there is nothing to serve and nothing to compare.
    return undefined;
  }
}

/** Audiences already read, keyed by the file's identity rather than its path alone.
 *
 *  **Measured, not assumed.** `openIndex.refresh()` runs on every content-serving MCP request, and
 *  reading twenty-one whole documents to filter on one frontmatter key cost 6.9 ms against 0.8 ms
 *  without them — every request, whether or not anything had changed. Keyed on `(size, mtime)`, so
 *  an edited document is re-read and nothing has to remember to invalidate this. */
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

/** The installed library's consumer-facing documents: its `docs/` and its namespace READMEs.
 *
 *  **A `docs/` path is spelled `<package>/<DOC>.md`.** A bare filename collides with the canon on
 *  six names; `docs/` collides with the consuming repository's own. This spelling collides with
 *  neither, keeps `docs/TESTING.md` unambiguous in a consumer, leaves any path test keyed on
 *  `docs/%` clear of these rows, and makes `--path forge` a scope a reader can actually use.
 *
 *  **A README keeps its directory: `<package>/src/<ns>/README.md`.** `forge/ui/README.md` would
 *  resolve just as well — `DEFERRED_DOC` captures one leading segment, so a document deferring to
 *  `src/ui/README.md` cites `ui/README.md` and either spelling matches on `endsWith`. This one is
 *  the file's real on-disk path under `node_modules/@y-core/forge/`, so every path warden prints
 *  names something the reader can open and `--path forge/src` stays a usable scope. @public */
export function librarySources(root: string, docsDir = "docs"): SourceDoc[] {
  const prefix = (packageNameOf(root) ?? basename(root)).split("/").pop() ?? basename(root);
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
  /** The library root, stated rather than derived. For a test, and for a repository whose install
   *  shape `libraryRoot` cannot see. Implies `dependency`. */
  dependencyRoot?: string;
}

/** The library root a caller's options resolve to, or `undefined` when none is asked for.
 *
 *  **Off unless asked, in one place.** Four configs and an open-options bag carry the same pair, and
 *  a default that differed between them would serve a corpus in the gate that no query answers
 *  from — or the reverse. @public */
export function dependencyRootOf(options: DependencyOptions, repoRoot: string): string | undefined {
  if (options.dependencyRoot !== undefined) return options.dependencyRoot;
  return options.dependency === true ? libraryRoot(repoRoot) : undefined;
}
