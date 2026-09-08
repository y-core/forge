import type { Database } from "bun:sqlite";

import type { Corpus } from "../types";

/** One edge out of, or into, a chunk or document. @public */
export interface Related {
  /** `defers`, `cites`, `governs`, or the same with `-by` for an inbound edge. A `governs` edge
   *  points at a `code:<subpath>` id rather than a document. */
  kind: string;
  /** The id at the other end; absent when the citation resolved to nothing. */
  id?: string;
  /** What the document actually wrote. */
  raw: string;
}

interface Row {
  kind: string;
  from_id: string;
  to_id: string | null;
  raw: string;
}

/** Every relation touching `id`, outbound first, then inbound.
 *
 *  Inbound matters more than it looks: "what else depends on this rule" is the question a reader
 *  asks before changing one, and a one-way graph cannot answer it. @public */
export function related(db: Database, id: string, kinds?: readonly string[], depth = 1): Related[] {
  const seen = new Set<string>([id]);
  const found: Related[] = [];
  // `seen` guards re-queueing a node; it cannot guard emission. A mutual pair of edges is one row
  // reached from both ends, and widening a section to its document re-reaches every document-level
  // edge once per section on the frontier.
  const emitted = new Set<string>();
  let frontier = [id];

  for (let level = 0; level < Math.max(1, depth); level++) {
    const next: string[] = [];
    for (const current of frontier) {
      // A section id also matches by its document prefix, so a `defers` edge declared on the
      // document reaches every section of it.
      const docId = current.split("#")[0] ?? current;
      const out = db
        .query<Row>("SELECT kind, from_id, to_id, raw FROM relation WHERE from_id = ? OR from_id = ? ORDER BY kind, raw")
        .all(current, docId);
      const inbound = db
        .query<Row>("SELECT kind, from_id, to_id, raw FROM relation WHERE to_id = ? OR to_id = ? ORDER BY kind, from_id")
        .all(current, docId);

      for (const row of out) {
        if (kinds !== undefined && !kinds.includes(row.kind)) continue;
        const key = `${row.kind}|${row.to_id ?? ""}|${row.raw}`;
        if (emitted.has(key)) continue;
        emitted.add(key);
        found.push({ kind: row.kind, ...(row.to_id === null ? {} : { id: row.to_id }), raw: row.raw });
        // A `code:` target is a leaf. Traversing one would fan a depth-2 walk out to every document
        // that happens to govern the same subpath — a real relation, but not the one asked for, and
        // it would arrive unlabelled among the citation edges.
        if (row.to_id !== null && !row.to_id.startsWith("code:") && !seen.has(row.to_id)) {
          seen.add(row.to_id);
          next.push(row.to_id);
        }
      }
      for (const row of inbound) {
        const kind = `${row.kind}-by`;
        if (kinds !== undefined && !kinds.includes(kind)) continue;
        const key = `${kind}|${row.from_id}|${row.raw}`;
        if (emitted.has(key)) continue;
        emitted.add(key);
        found.push({ kind, id: row.from_id, raw: row.raw });
        if (!seen.has(row.from_id)) {
          seen.add(row.from_id);
          next.push(row.from_id);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  return found;
}

/** Every relation whose target resolved to nothing — the gate warns on these. @public */
export function unresolved(db: Database, corpora?: readonly Corpus[]): Related[] {
  // The corpus is read off the id's own prefix rather than joined back to `source`: an edge's
  // `from_id` is a chunk id in one corpus and a source id in another, and both spell the corpus
  // first. A caller naming none sees every edge, which is what a raw listing means.
  const scope = corpora === undefined ? "" : ` AND (${corpora.map(() => "from_id LIKE ? ESCAPE '\\'").join(" OR ")})`;
  return db
    .query<Row>(`SELECT kind, from_id, to_id, raw FROM relation WHERE to_id IS NULL${scope} ORDER BY from_id, raw`)
    .all(...(corpora ?? []).map((corpus) => `${corpus}:%`))
    .map((row) => ({ kind: row.kind, id: row.from_id, raw: row.raw }));
}
