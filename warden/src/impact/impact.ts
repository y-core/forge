import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { SourceDoc } from "../types";
import type { ChangedFile } from "./git";

/** One section a diff touched, what depends on it, and what it governs. @public */
export interface Touched {
  /** The chunk id — `<corpus>:<path>#<section>`. */
  id: string;
  /** The `## N. Parent › ### Na. Child` trail. */
  headingPath: string;
  /** The changed lines inside this section, clamped to it. */
  lines: readonly { start: number; end: number }[];
  /** Ids of the sections that cite or defer to this one. */
  dependents: readonly string[];
  /** Subpaths this section's prose binds, each with the barrel its exports key names. */
  governs: readonly { subpath: string; target?: string }[];
}

/** What one ref changed, section by section. @public */
export interface Impact {
  ref: string;
  /** Files the diff touched that the index does not hold — reported so a silent miss is not one. */
  unindexed: readonly string[];
  touched: readonly Touched[];
}

interface ChunkRow {
  id: string;
  heading_path: string;
  line: number;
  end_line: number;
}

/** Every published subpath mapped to the module its exports entry names. */
function barrels(root: string): Map<string, string> {
  const targets = new Map<string, string>();
  try {
    const parsed: unknown = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));
    const map = (parsed as { exports?: Record<string, unknown> }).exports ?? {};
    for (const [key, value] of Object.entries(map)) {
      const target =
        typeof value === "string" ? value : ((value as { import?: string; types?: string }).import ?? (value as { types?: string }).types);
      if (typeof target === "string") targets.set(key, target);
    }
  } catch {
    // A repository with no readable package.json still gets an impact report; it just names the
    // subpath a rule governs rather than the barrel behind it.
  }
  return targets;
}

/** Which sections a diff touched, what depends on them, and what code they govern.
 *
 *  Spans come out of the same build as the ids, so a changed line and the section it names can
 *  never disagree — which is why they are stored rather than re-derived from the working tree. @public */
export function impact(db: Database, root: string, sources: readonly SourceDoc[], ref: string, files: readonly ChangedFile[]): Impact {
  const byFile = new Map(sources.map((doc) => [doc.file, doc] as const));
  const targets = barrels(root);
  const touched: Touched[] = [];
  const unindexed: string[] = [];

  const chunksOf = db.query<ChunkRow>(
    `SELECT chunk.id, chunk.heading_path, chunk.line, chunk.end_line
       FROM chunk JOIN source ON source.id = chunk.source_id
      WHERE source.corpus = ? AND source.path = ?
      ORDER BY chunk.ordinal`,
  );
  const inbound = db.query<{ from_id: string }>(
    "SELECT DISTINCT from_id FROM relation WHERE to_id = ? AND kind IN ('cites', 'defers') ORDER BY from_id",
  );
  const outbound = db.query<{ to_id: string }>("SELECT DISTINCT to_id FROM relation WHERE from_id = ? AND kind = 'governs' ORDER BY to_id");

  for (const file of files) {
    const doc = byFile.get(resolve(root, file.path));
    if (doc === undefined) {
      unindexed.push(file.path);
      continue;
    }

    for (const row of chunksOf.all(doc.corpus, doc.path)) {
      const lines = file.ranges
        .map((range) => ({ start: Math.max(range.start, row.line), end: Math.min(range.end, row.end_line) }))
        .filter((range) => range.start <= range.end);
      if (lines.length === 0) continue;

      touched.push({
        id: row.id,
        headingPath: `${doc.path} § ${row.heading_path}`,
        lines,
        dependents: inbound.all(row.id).map((edge) => edge.from_id),
        governs: outbound.all(row.id).map((edge) => {
          const subpath = edge.to_id.slice("code:".length);
          const target = targets.get(subpath);
          return { subpath, ...(target === undefined ? {} : { target }) };
        }),
      });
    }
  }

  return { ref, unindexed, touched };
}
