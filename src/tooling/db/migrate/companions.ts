import type { DbIo, Home } from "../types";
import { executeSql } from "../wrangler";

/** The table forge records every applied migration in: its stamp-blanked bytes, when it ran, and the fingerprint it certified. @internal */
export const FORGE_MIGRATIONS_DDL = [
  // The identity is the name, carried as a unique index rather than the primary key: a backup's
  // keyset read orders by one column, so the key has to be single.
  "CREATE TABLE IF NOT EXISTS _forge_migrations (",
  "  id INTEGER PRIMARY KEY,",
  "  name TEXT NOT NULL,",
  "  sha256 TEXT NOT NULL,",
  "  applied_at INTEGER NOT NULL,",
  "  fingerprint TEXT",
  ") STRICT;",
  "CREATE UNIQUE INDEX IF NOT EXISTS _forge_migrations_name ON _forge_migrations (name);",
].join("\n");

/** The table a seed run records itself in, keyed by the seeds directory that declared it and the file name. @internal */
export const FORGE_SEED_HISTORY_DDL = [
  // The identity is the declared directory and the file name, carried as a unique index rather than
  // the primary key: a backup's keyset read orders by one column, so the key has to be single.
  "CREATE TABLE IF NOT EXISTS _forge_seed_history (",
  "  id INTEGER PRIMARY KEY,",
  "  source TEXT NOT NULL,",
  "  name TEXT NOT NULL,",
  "  sha256 TEXT NOT NULL,",
  "  applied_at INTEGER NOT NULL",
  ") STRICT;",
  "CREATE UNIQUE INDEX IF NOT EXISTS _forge_seed_history_source_name ON _forge_seed_history (source, name);",
].join("\n");

/** The companion tables by name, which is what an artifact's rows may name beside the app's own. @internal */
export const COMPANION_TABLES = ["_forge_migrations", "_forge_seed_history"];

/** Creates the companion tables, so every path after it can read and write them without checking. @internal */
export async function ensureCompanionTables(io: DbIo, home: Home): Promise<void> {
  await executeSql(io, home, [FORGE_MIGRATIONS_DDL, FORGE_SEED_HISTORY_DDL].join("\n"));
}
