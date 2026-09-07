/** The index schema, and the two versions that invalidate it. */

/** Bumped whenever the tables change shape. A mismatch rebuilds rather than migrates: the index is
 *  a derived artifact under `.forge/`, never committed, and a full build is under a second. @public */
export const SCHEMA_VERSION = "1";

/** Bumped whenever chunking, glossing or weighting changes what the same documents would produce. @public */
export const INDEXER_VERSION = "3";

/** `tokenchars` is the highest-leverage knob here: without `-_/.§` the tokenizer splits
 *  `Result<T,E>`, `ui/core`, `forge-ui-focus-ring`, `@y-core/forge/ui/show` and `§5c` into pieces,
 *  and every one of those is a query a reader actually types.
 *
 *  `porter` wraps it because a reader asks "when do I throw instead of **returning** a Result" and
 *  the section is titled "**Return** Result" — without stemming those are different terms, and the
 *  exact answer ranked twelfth. The wrapper stems only what `unicode61` hands it, so `§5c` and
 *  `ui/core` survive intact. @public */
export const TOKENIZE = "porter unicode61 remove_diacritics 2 tokenchars '-_/.§'";

/** The full DDL, run inside one transaction on a fresh database. @public */
export const SCHEMA = `
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE source (
  id          INTEGER PRIMARY KEY,
  corpus      TEXT NOT NULL,
  tree        TEXT,
  path        TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  weight      REAL NOT NULL,
  size        INTEGER NOT NULL,
  mtime       REAL NOT NULL,
  hash        TEXT NOT NULL,
  UNIQUE (corpus, tree, path)
);

CREATE TABLE chunk (
  rowid        INTEGER PRIMARY KEY,
  id           TEXT NOT NULL UNIQUE,
  source_id    INTEGER NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  section      TEXT NOT NULL,
  title        TEXT NOT NULL,
  heading_path TEXT NOT NULL,
  gloss        TEXT NOT NULL,
  rules        TEXT NOT NULL,
  search_body  TEXT NOT NULL,
  body         TEXT NOT NULL,
  ordinal      INTEGER NOT NULL
);

CREATE INDEX chunk_by_source ON chunk (source_id, ordinal);

CREATE TABLE relation (
  from_id TEXT NOT NULL,
  kind    TEXT NOT NULL,
  to_id   TEXT,
  raw     TEXT NOT NULL
);

CREATE INDEX relation_from ON relation (from_id);
CREATE INDEX relation_to ON relation (to_id);

CREATE VIRTUAL TABLE chunk_fts USING fts5(
  title, heading_path, gloss, rules, search_body,
  content = 'chunk',
  content_rowid = 'rowid',
  tokenize = "${TOKENIZE}"
);
`;

/** Column weights for `bm25()`, in the FTS5 column order.
 *
 *  `rules` leads because a bolded clause is where a governing document states its rule; `title`
 *  next because a reader who names a section usually means it; `gloss` next because it is the
 *  corpus's own one-line summary; `search_body` last because length normalisation already rewards
 *  a short section and prose repeats itself. @public */
export const COLUMN_WEIGHTS = [8, 4, 6, 10, 1] as const;
