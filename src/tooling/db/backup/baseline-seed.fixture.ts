/** The database the baseline dump is taken from: `cases` holds one row per value the census must judge, `label` naming it. */
export const BASELINE_SEED: readonly string[] = [
  "CREATE TABLE _forge_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
  "INSERT INTO _forge_migrations (name) VALUES ('0001_baseline.sql')",
  "CREATE TABLE cases (id INTEGER PRIMARY KEY, label TEXT NOT NULL, body TEXT, wide INTEGER, loose)",
  "INSERT INTO cases (label, body) VALUES ('real newline', 'two' || char(10) || 'lines')",
  "INSERT INTO cases (label, body) VALUES ('literal escape', 'four\\nliteral')",
  "INSERT INTO cases (label, body) VALUES ('escape beside a newline', 'a\\nb' || char(10) || 'c')",
  "INSERT INTO cases (label, body) VALUES ('multi-line string', 'one' || char(10) || 'two;' || char(10) || 'INSERT INTO \"cases\" x')",
  "INSERT INTO cases (label, wide) VALUES ('integer past 2^53', 9007199254740993)",
  "INSERT INTO cases (label, loose) VALUES ('integral real', 2.0)",
];

/** A database holding a virtual table, which miniflare's export refuses whole. */
export const BASELINE_VIRTUAL_SEED: readonly string[] = ["CREATE VIRTUAL TABLE docs USING fts5(body)", "INSERT INTO docs (body) VALUES ('x')"];
