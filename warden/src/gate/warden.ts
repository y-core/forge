import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { canonical } from "../../../src/tooling/gate/checks/design-system";
import { type CheckResult, checkResult, type Finding, fail, scannedNothing, warn } from "../../../src/tooling/gate/finding";
import { renderCatalogue } from "../catalogue/render";
import { discover } from "../corpus/source";
import { build, load } from "../index/build";
import { gateIndexPath, openDatabase } from "../index/db";
import { packageNameOf } from "../paths";
import { unresolved } from "../search/related";
import type { SourceDoc, Tree } from "../types";
import { canonVersion } from "../version";

/** What the knowledge check needs to know about the project. @public */
export interface WardenCheckConfig {
  /** Repository root. */
  root: string;
  /** The canon tree this repository is subject to. */
  kind: Tree;
  /** The committed catalogue, relative to `root`. Defaults to `warden/CATALOGUE.md`. */
  catalogue?: string;
  /** Directory of this repository's own governing documents. Defaults to `docs`. */
  docsDir?: string;
  /** The canon root. Defaults to the installed one, which is where a consumer's canon comes from. */
  canonRoot?: string;
  /** Where the gate builds its index. Defaults to `.forge/warden/gate.sqlite`. */
  indexPath?: string;
}

/** Rebuilds the index from disk and asserts what retrieval depends on.
 *
 *  It builds into its own database rather than the developer's working one, so an index built from
 *  an edit in progress can never change a verdict. @public */
export function checkWarden(config: WardenCheckConfig): CheckResult {
  const { root, kind } = config;
  const cataloguePath = config.catalogue ?? "warden/CATALOGUE.md";
  const sources = discover(root, kind, {
    ...(config.docsDir === undefined ? {} : { docsDir: config.docsDir }),
    ...(config.canonRoot === undefined ? {} : { canonRoot: config.canonRoot }),
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
      ...unresolvedRelations(db),
      ...catalogueDrift(db, root, cataloguePath),
    ];
    const warnings = findings.filter((finding) => finding.level === "warn").length;
    return checkResult(
      findings,
      `${report.documents} documents, ${report.chunks} chunks, ${report.relations} relations, ${warnings} warning${warnings === 1 ? "" : "s"}.`,
    );
  } finally {
    db.close();
  }
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

/** A document that produced no chunk is a document nothing can retrieve. */
function emptyDocuments(db: Database): Finding[] {
  return db
    .query<{ path: string }>("SELECT path FROM source WHERE id NOT IN (SELECT source_id FROM chunk) ORDER BY path")
    .all()
    .map((row) => fail("produced no chunk — nothing in this document is retrievable", { file: row.path }));
}

/** Stricter than the docs check's warning, and earned: a section with no Quick Reference line has
 *  lost the corpus's own one-line summary, which is the highest-weighted retrieval column there is.
 *
 *  Governing documents only. A README numbers its headings too, but the Quick Reference convention
 *  is a rule about governing documents, and holding a README to it would be inventing one. */
function missingGloss(db: Database, docsDir: string): Finding[] {
  return db
    .query<{ id: string; path: string }>(
      `SELECT chunk.id, source.path FROM chunk JOIN source ON source.id = chunk.source_id
       WHERE chunk.gloss = '' AND chunk.section NOT LIKE '~%'
         AND (source.corpus = 'canon' OR source.path LIKE ?) ORDER BY chunk.id`,
    )
    .all(`${docsDir}/%`)
    .map((row) =>
      fail(`\`§${row.id.split("#")[1] ?? ""}\` has no Quick Reference line — retrieval loses its best signal for that section`, { file: row.path }),
    );
}

/** A citation whose target resolved to nothing. A warning, not a failure: the docs check already
 *  fails an unresolvable `§N`, and this sees citations that check does not scan. */
function unresolvedRelations(db: Database): Finding[] {
  const rows = unresolved(db);
  if (rows.length === 0) return [];
  const sample = rows.slice(0, 5).map((row) => `${row.id ?? ""} → ${row.raw}`);
  return [
    warn(
      `${rows.length} citation${rows.length === 1 ? "" : "s"} resolved to no indexed document: ${sample.join(", ")}${rows.length > 5 ? ", …" : ""}`,
      { file: "warden" },
    ),
  ];
}

/** The committed catalogue against the one the corpus produces now. Compared through `canonical`,
 *  so a formatter's own whitespace can never fail the gate. */
function catalogueDrift(db: Database, root: string, cataloguePath: string): Finding[] {
  const rendered = renderCatalogue(db);
  const file = resolve(root, cataloguePath);
  if (!existsSync(file)) {
    return [fail("does not exist — run `warden catalogue --write`", { file: cataloguePath })];
  }
  return canonical(readFileSync(file, "utf-8")) === canonical(rendered)
    ? []
    : [fail("is out of step with the corpus — run `warden catalogue --write`", { file: cataloguePath })];
}
