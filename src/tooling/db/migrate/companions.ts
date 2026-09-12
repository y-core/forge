import type { DbIo, Home } from "../types";
import { executeSql } from "../wrangler";

// Two columns and no second index: wrangler's own table records that a name was applied and when,
// and this one records the bytes, which is the whole of what `d1_migrations` cannot say.
// `applied_name` joins the two, and is the primary key rather than a unique index because a backup's
// keyset read orders by one column and a composite key offers none.
/** The table forge records a checksum per applied migration in, beside wrangler's own. @internal */
export const FORGE_MIGRATIONS_DDL = [
  "CREATE TABLE IF NOT EXISTS forge_migrations (",
  "  applied_name TEXT PRIMARY KEY,",
  "  sha256 TEXT NOT NULL",
  ") STRICT;",
].join("\n");

/** The table a seed run records itself in, keyed by the seeds directory that declared it and the file name. @internal */
export const FORGE_SEED_HISTORY_DDL = [
  // The identity is the declared directory and the file name, carried as a unique index rather than
  // the primary key: a backup's keyset read orders by one column, so the key has to be single.
  "CREATE TABLE IF NOT EXISTS forge_seed_history (",
  "  id INTEGER PRIMARY KEY,",
  "  source TEXT NOT NULL,",
  "  name TEXT NOT NULL,",
  "  sha256 TEXT NOT NULL,",
  "  applied_at INTEGER NOT NULL",
  ") STRICT;",
  "CREATE UNIQUE INDEX IF NOT EXISTS forge_seed_history_source_name ON forge_seed_history (source, name);",
].join("\n");

/** The key-value table forge records the migrations digest and the schema fingerprint in. @internal */
export const FORGE_SCHEMA_META_DDL = "CREATE TABLE IF NOT EXISTS forge_schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;";

/** The companion tables by name, which is what an artifact's rows may name beside the app's own. @internal */
export const COMPANION_TABLES = ["forge_migrations", "forge_schema_meta", "forge_seed_history"];

/** Creates the companion tables, so every path after it can read and write them without checking. @internal */
export function ensureCompanionTables(io: DbIo, home: Home): void {
  executeSql(io, home, [FORGE_MIGRATIONS_DDL, FORGE_SEED_HISTORY_DDL, FORGE_SCHEMA_META_DDL].join("\n"));
}
