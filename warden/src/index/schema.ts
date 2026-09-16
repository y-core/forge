/** Bumped whenever the tables change shape, a mismatch rebuilding rather than migrating. @public */
export const SCHEMA_VERSION = "4";

/** Bumped whenever chunking, glossing or weighting changes what the same documents would produce. @public */
export const INDEXER_VERSION = "9";

// Without `-_/.§` in `tokenchars` the tokenizer splits `ui/core`, `Result<T,E>` and `§5c` into
// pieces; `porter` wraps it so `returning` and `Return` are one term.
/** The FTS5 tokenizer chain. @public */
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
  body         TEXT NOT NULL,
  ordinal      INTEGER NOT NULL,
  searchable   INTEGER NOT NULL,
  line         INTEGER NOT NULL,
  end_line     INTEGER NOT NULL
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

-- \`search_body\` is the stripped prose the tokenizer sees, and \`chunk\` deliberately does not store
-- it: it is a near-duplicate of \`body\` worth a third of the file, and the FTS row is written from
-- the in-memory chunk instead. The cost is that the two fts5 operations which read the content
-- table back now fail loudly with "no such column": \`'rebuild'\`, \`snippet()\`/\`highlight()\`, and any
-- scan of \`chunk_fts\` not restricted by \`MATCH\` (count the rows in \`chunk\` instead). None is used;
-- \`MATCH\`, \`bm25()\` and \`rowid\` resolve without touching the content table.
CREATE VIRTUAL TABLE chunk_fts USING fts5(
  title, heading_path, gloss, rules, search_body,
  content = 'chunk',
  content_rowid = 'rowid',
  tokenize = "${TOKENIZE}"
);
`;

/** Column weights for `bm25()`, in the FTS5 column order. @public */
export const COLUMN_WEIGHTS = [8, 4, 6, 10, 1] as const;
