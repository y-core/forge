import type { Database } from "bun:sqlite";

/** One section, read whole. @public */
export interface Section {
  id: string;
  corpus: string;
  tree?: string;
  path: string;
  section: string;
  title: string;
  headingPath: string;
  gloss: string;
  body: string;
  ordinal: number;
}

/** One line of a document's outline. @public */
export interface OutlineEntry {
  id: string;
  section: string;
  title: string;
  gloss: string;
  level: number;
}

interface Row {
  id: string;
  corpus: string;
  tree: string | null;
  path: string;
  section: string;
  title: string;
  heading_path: string;
  gloss: string;
  body: string;
  ordinal: number;
}

const SELECT = `
  SELECT chunk.id, source.corpus, source.tree, source.path, chunk.section, chunk.title,
         chunk.heading_path, chunk.gloss, chunk.body, chunk.ordinal
  FROM chunk JOIN source ON source.id = chunk.source_id`;

function toSection(row: Row): Section {
  return {
    id: row.id,
    corpus: row.corpus,
    ...(row.tree === null ? {} : { tree: row.tree }),
    path: row.path,
    section: row.section,
    title: row.title,
    headingPath: row.heading_path,
    gloss: row.gloss,
    body: row.body,
    ordinal: row.ordinal,
  };
}

/** One section by chunk id, with its immediate neighbours when asked for. A neighbour is what makes
 *  a `### Na.` hit readable: the rule above it is usually the one that scopes it. @public */
export function readSection(db: Database, id: string, neighbours = 0): Section[] {
  const own = db.query<Row>(`${SELECT} WHERE chunk.id = ?`).get(id);
  if (own === null) return [];
  if (neighbours <= 0) return [toSection(own)];
  const rows = db
    .query<Row>(
      `${SELECT} WHERE chunk.source_id = (SELECT source_id FROM chunk WHERE id = ?) AND chunk.ordinal BETWEEN ? AND ? ORDER BY chunk.ordinal`,
    )
    .all(id, own.ordinal - neighbours, own.ordinal + neighbours);
  return rows.map(toSection);
}

/** Every section of one document, by path — the answer to "this file is 62 KB and I need one
 *  section". A path may name a document in either corpus; both are returned in that order. @public */
export function outline(db: Database, path: string): OutlineEntry[] {
  return db
    .query<Row>(`${SELECT} WHERE source.path = ? ORDER BY source.corpus, chunk.ordinal`)
    .all(path)
    .map((row) => ({
      id: row.id,
      section: row.section,
      title: row.title,
      gloss: row.gloss,
      // A `§Na` refines a `§N`, and the indent is what tells a reader which is which.
      level: /^\d+$/.test(row.section) ? 1 : 2,
    }));
}

/** Every section of one document, whole. @public */
export function readDocument(db: Database, path: string): Section[] {
  return db.query<Row>(`${SELECT} WHERE source.path = ? ORDER BY source.corpus, chunk.ordinal`).all(path).map(toSection);
}
