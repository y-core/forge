import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { canonical } from "../../../src/tooling/gate/checks/design-system";
import { checkResult, fail, scannedNothing, warn } from "../../../src/tooling/gate/finding";
import type { CheckResult, Finding } from "../../../src/tooling/gate/types";
import { renderCanon } from "../catalogue/render";
import { type DependencyOptions, dependencyRootOf } from "../corpus/dependency";
import { canonSources, discover, repoRelative } from "../corpus/source";
import { type BuildReport, build, load } from "../index/build";
import { gateIndexPath, openDatabase } from "../index/db";
import { CANON_ROOT, packageNameOf } from "../paths";
import { unresolved } from "../search/related";
import { type Corpus, CORPORA, type SourceDoc, type Tree } from "../types";
import { canonVersion } from "../version";

/** What the knowledge check needs to know about the project. @public */
export interface WardenCheckConfig extends DependencyOptions {
  /** Repository root. */
  root: string;
  /** The canon tree this repository is subject to. */
  kind: Tree;
  /** The committed catalogue, relative to `root`. Unset in every repository but the canon's home:
   *  the rendered catalogue is canon-scoped and so byte-identical everywhere, which makes it the
   *  canon owner's to commit; elsewhere the live `knowledge://catalogue` resource is the copy. */
  catalogue?: string;
  /** Directory of this repository's own governing documents. Defaults to `docs`. */
  docsDir?: string;
  /** The canon root. Defaults to the installed one, which is where a consumer's canon comes from. */
  canonRoot?: string;
  /** Where the gate builds its index. Defaults to `.forge/warden/gate.sqlite`. */
  indexPath?: string;
  /** Whether this repository authors the canon. Set, the filename check also reads the canon tree
   *  this repository is not subject to — otherwise a `canon/apps` name colliding with a library's
   *  `docs/` one is invisible everywhere: in an app neither side is a `project` document, and the
   *  library never co-indexes the two. Defaults to `false`. */
  canonHome?: boolean;
}

/** Rebuilds the index from disk and asserts what retrieval depends on.
 *
 *  It builds into its own database rather than the developer's working one, so an index built from
 *  an edit in progress can never change a verdict. @public */
export function checkWarden(config: WardenCheckConfig): CheckResult {
  const { root, kind } = config;
  const dependencyRoot = dependencyRootOf(config, root);
  const sources = discover(root, kind, {
    ...(config.docsDir === undefined ? {} : { docsDir: config.docsDir }),
    ...(config.canonRoot === undefined ? {} : { canonRoot: config.canonRoot }),
    ...(dependencyRoot === undefined ? {} : { dependencyRoot }),
  });

  if (sources.length === 0) {
    return scannedNothing("discovery found no document to index — the corpus roots are wrong", "warden", "read");
  }

  const db = openDatabase(config.indexPath ?? gateIndexPath(root));
  try {
    // A build that throws is a document the gate should name, not a stack trace the gate dies on —
    // a `UNIQUE` violation here means two sections claimed one id, which is a located finding.
    let report;
    try {
      report = build(db, sources, canonVersion(), packageNameOf(root));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const collision = duplicateChunkId(sources);
      return checkResult(
        [
          collision === undefined
            ? fail(`the index could not be built — ${message}`)
            : fail(`two sections claim the id \`${collision.id}\` — give one of them its own number`, { file: collision.file }),
        ],
        "the build failed.",
      );
    }
    const findings: Finding[] = [
      ...emptyDocuments(db),
      ...missingGloss(db, config.docsDir ?? "docs"),
      ...unresolvedRelations(db, config.canonRoot ?? CANON_ROOT),
      ...ambiguousCitations(report),
      ...filenameCollisions(root, collisionSources(config, sources)),
      ...(config.catalogue === undefined ? [] : catalogueDrift(root, config.catalogue, config.canonRoot ?? CANON_ROOT)),
    ];
    const warnings = findings.filter((finding) => finding.level === "warn").length;
    return checkResult(
      findings,
      `${report.documents} documents (${perCorpus(db)}), ${report.chunks} chunks, ${report.relations} relations, ${warnings} warning${warnings === 1 ? "" : "s"}.`,
    );
  } finally {
    db.close();
  }
}

/** The document count per corpus, in the fixed order, omitting a corpus this repository has none of.
 *
 *  **The only cheap defence against a silently empty corpus.** A misconfigured dependency root
 *  discovers nothing, and nothing is indistinguishable from a feature switched off: every check
 *  still passes, every query still answers, and the documents the corpus was added to reach are
 *  simply absent. A total alone cannot say that; a per-corpus count can. */
function perCorpus(db: Database): string {
  const rows = db.query<{ corpus: string; n: number }>("SELECT corpus, count(*) AS n FROM source GROUP BY corpus").all();
  const counted = new Map(rows.map((row) => [row.corpus, row.n]));
  return CORPORA.filter((corpus) => counted.has(corpus))
    .map((corpus) => `${counted.get(corpus) ?? 0} ${corpus}`)
    .join(", ");
}

/** The first chunk id two sections claim, when a failed build has one to name. Re-reads the corpus
 *  rather than the half-written database, which the failure has already rolled back. */
function duplicateChunkId(sources: readonly SourceDoc[]): { id: string; file: string } | undefined {
  try {
    const seen = new Set<string>();
    for (const entry of load(sources)) {
      for (const chunk of entry.chunks) {
        if (seen.has(chunk.id)) return { id: chunk.id, file: entry.doc.path };
        seen.add(chunk.id);
      }
    }
  } catch {
    // The read itself is what failed, so there is no id to name and the raw message stands.
  }
  return undefined;
}

/** The corpora a repository owns the files of, and may therefore be failed over.
 *
 *  **A gate may only fail a repository for a file that repository can edit.** A dependency document
 *  lives inside `node_modules`, is read-only in every practical sense, and is named by a path that
 *  does not exist in the consumer's tree — so a finding against one is a build the reader cannot
 *  fix and a location they cannot open. Every check below is scoped by corpus rather than by how a
 *  path happens to be spelled, so a change to that spelling cannot quietly widen them. */
const OWNED: readonly Corpus[] = ["canon", "project"];

/** A document that produced no chunk is a document nothing can retrieve. */
function emptyDocuments(db: Database): Finding[] {
  return db
    .query<{ path: string }>(
      `SELECT path FROM source WHERE corpus IN (${OWNED.map(() => "?").join(", ")})
         AND id NOT IN (SELECT source_id FROM chunk) ORDER BY path`,
    )
    .all(...OWNED)
    .map((row) => fail("produced no chunk — nothing in this document is retrievable", { file: row.path }));
}

/** Stricter than the docs check's warning, and earned: a section with no Quick Reference line has
 *  lost the corpus's own one-line summary, which is the highest-weighted retrieval column there is.
 *
 *  Governing documents only. A README numbers its headings too, but the Quick Reference convention
 *  is a rule about governing documents, and holding a README to it would be inventing one.
 *
 *  The `docsDir` prefix now narrows `project` alone. Spelled as a path test over every corpus, it
 *  would fail a consumer's gate over a document in the installed library — citing a path that does
 *  not exist in their tree, for prose they cannot edit. */
function missingGloss(db: Database, docsDir: string): Finding[] {
  return db
    .query<{ id: string; path: string }>(
      `SELECT chunk.id, source.path FROM chunk JOIN source ON source.id = chunk.source_id
       WHERE chunk.gloss = '' AND chunk.section NOT LIKE '~%'
         AND (source.corpus = 'canon' OR (source.corpus = 'project' AND source.path LIKE ? ESCAPE '\\')) ORDER BY chunk.id`,
    )
    .all(`${docsDir}/%`)
    .map((row) =>
      fail(`\`§${row.id.split("#")[1] ?? ""}\` has no Quick Reference line — retrieval loses its best signal for that section`, { file: row.path }),
    );
}

/** A citation into a canon tree this repository is not subject to — `apps/` in a library. The link
 *  is correct and resolves on disk; the tree is excluded from the index on purpose (`canonSources`),
 *  so nothing is wrong and nothing is for the reader to fix. */
function outOfIndex(raw: string, canonRoot: string): boolean {
  const cited = raw.split(" §")[0] ?? "";
  return cited.includes("/") && existsSync(resolve(canonRoot, cited));
}

/** A citation whose target resolved to nothing. A warning, not a failure: the docs check already
 *  fails an unresolvable `§N`, and this sees citations that check does not scan.
 *
 *  A citation into a non-indexed canon tree is not one of these. Counting the two together said a
 *  correct link was broken, and the only fix it left was to delete the link. */
function unresolvedRelations(db: Database, canonRoot: string): Finding[] {
  const rows = unresolved(db, OWNED).filter((row) => !outOfIndex(row.raw, canonRoot));
  if (rows.length === 0) return [];
  const sample = rows.slice(0, 5).map((row) => `${row.id ?? ""} → ${row.raw}`);
  return [
    warn(
      `${rows.length} citation${rows.length === 1 ? "" : "s"} resolved to no indexed document: ${sample.join(", ")}${rows.length > 5 ? ", …" : ""}`,
      { file: "warden" },
    ),
  ];
}

/** A citation that named more than one indexed document.
 *
 *  Distinguished from an unresolved one because the two are different defects and the fix differs:
 *  one is a typo or a renamed document, the other is a citation that needs a path. Both used to
 *  arrive as a null target, counted together and reported as naming nothing. The wording mirrors
 *  `validate-docs`, which fails the same shape where it can see it. */
function ambiguousCitations(report: BuildReport): Finding[] {
  return report.ambiguous
    .filter((entry) => OWNED.some((corpus) => entry.from.startsWith(`${corpus}:`)))
    .map((entry) =>
      warn(`\`${entry.raw}\` is ambiguous — ${entry.ids.join(" and ")} both match; cite the path`, {
        file: entry.from.split("#")[0] ?? entry.from,
      }),
    );
}

/** The documents the filename rule is about: the ones a citation addresses **by name**, so two of
 *  them sharing one makes `TESTING.md §2a` two different rules. A canon document is named alone, a
 *  governing document one directory deep is named by its file — and a README is not name-addressed
 *  at all, since every namespace has one and a citation always carries its path. */
function nameAddressed(doc: SourceDoc): boolean {
  const segments = doc.path.split("/");
  return segments.length <= 2 && segments.at(-1) !== "README.md";
}

/** The set the filename rule is computed over: everything this index covers, plus — in the canon's
 *  home — the canon tree this repository is not subject to. */
function collisionSources(config: WardenCheckConfig, sources: readonly SourceDoc[]): readonly SourceDoc[] {
  if (config.canonHome !== true) return sources;
  const other: Tree = config.kind === "apps" ? "libs" : "apps";
  // The other tree alone: `canonSources` also returns `shared`, which this index already holds.
  return [...sources, ...canonSources(other, config.canonRoot ?? CANON_ROOT).filter((doc) => doc.tree === other)];
}

/** How a colliding document is named in the finding that cites it, since a canon path is
 *  tree-stripped and two trees would otherwise read as the same file. */
function cite(doc: SourceDoc): string {
  return doc.corpus === "canon" ? `canon/${doc.tree ?? ""}/${doc.path}` : `${doc.corpus}:${doc.path}`;
}

/** `canon/libs/X.md` and `canon/apps/X.md` may share a name: a repository takes one kind or the
 *  other, so the two are never in one index and no citation can mean both. */
function exemptPair(left: SourceDoc, right: SourceDoc): boolean {
  return left.corpus === "canon" && right.corpus === "canon" && left.tree !== right.tree && left.tree !== "shared" && right.tree !== "shared";
}

/** Which side of a collision yields. **The specialising side renames, never the canon**: the canon's
 *  name is what every other repository already cites, and an installed library's is what its own
 *  readers cite. A repository's own document is the one free to move, so it is last. */
function precedence(corpus: Corpus): number {
  return corpus === "canon" ? 0 : corpus === "dependency" ? 1 : 2;
}

/** Two name-addressed documents in one index sharing a filename.
 *
 *  **Uniqueness is per index, not global.** The same name in two repositories that never see each
 *  other's documents costs nothing; the same name twice in one index makes every citation of it
 *  ambiguous, and no chunk id can disambiguate what a reader is holding in their head.
 *
 *  **The specialising side renames, never the canon** — the canon's name is the one every other
 *  repository already cites. And where the specialising document only restates what the canon says,
 *  the answer is to delete it rather than to rename it.
 *
 *  Scoped by `OWNED`, like every check here: a finding names a document this repository can edit and
 *  cites the one it collides with as context. */
function filenameCollisions(root: string, sources: readonly SourceDoc[]): Finding[] {
  const groups = new Map<string, SourceDoc[]>();
  for (const doc of sources.filter(nameAddressed)) {
    const name = doc.path.split("/").at(-1) ?? doc.path;
    groups.set(name, [...(groups.get(name) ?? []), doc]);
  }

  const findings: Finding[] = [];
  for (const [name, group] of [...groups].sort(([left], [right]) => (left < right ? -1 : 1))) {
    for (const doc of group) {
      if (!OWNED.includes(doc.corpus)) continue;
      const others = group.filter((other) => other !== doc && !exemptPair(doc, other) && precedence(other.corpus) <= precedence(doc.corpus));
      if (others.length === 0) continue;
      findings.push(
        fail(
          `\`${name}\` is already the name of ${others.map(cite).join(" and ")} — rename this document, or delete it where it restates that one`,
          { file: repoRelative(root, doc.file) },
        ),
      );
    }
  }
  return findings;
}

/** The committed catalogue against the one the corpus produces now. Compared through `canonical`,
 *  so a formatter's own whitespace can never fail the gate. */
function catalogueDrift(root: string, cataloguePath: string, canonRoot: string): Finding[] {
  const rendered = renderCanon(canonRoot);
  const file = resolve(root, cataloguePath);
  if (!existsSync(file)) {
    return [fail("does not exist — run `warden catalogue --write`", { file: cataloguePath })];
  }
  return canonical(readFileSync(file, "utf-8")) === canonical(rendered)
    ? []
    : [fail("is out of step with the corpus — run `warden catalogue --write`", { file: cataloguePath })];
}
