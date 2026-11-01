import { resolve } from "node:path";

import { listDeployments, readDeployment } from "../cf/config/environment";
import { loadWranglerConfig } from "../cf/config/parse";
import type { D1DatabaseConfig, WranglerConfig } from "../cf/types";
import { CliError } from "../cli/errors";
import { DATABASE_NAME, describeTargetGrammar, parseTarget, refuseRemote } from "./target";
import type { D1Entry, DbConfig, DbConfigRequest } from "./types";

/** The refusal for an `--env` naming no `env.<name>` block. @internal */
export function createUndeclaredEnvError(env: string): CliError {
  return new CliError("invalid-args", `--env ${env} names no \`env.${env}\` block in the wrangler config`);
}

/** The d1 entries wrangler binds for an environment, refusing one that declares none since wrangler does not inherit them. @internal */
export function d1Entries(config: WranglerConfig, env: string | null): D1DatabaseConfig[] {
  const read = readDeployment(config, env);
  if (env === null) return read.ok ? (read.data.effective.d1_databases ?? []) : [];
  // Stricter than wrangler, which falls back to the top level with no `env` table: a mistyped name must never reach the top-level database.
  if (!read.ok || config.env === undefined) throw createUndeclaredEnvError(env);
  const entries = read.data.effective.d1_databases;
  if (entries === undefined) {
    throw new CliError(
      "invalid-args",
      `--env ${env} names an environment that declares no d1_databases, and wrangler does not inherit the top level's — restate the entries under \`env.${env}.d1_databases\``,
    );
  }
  return entries;
}

/** The table wrangler records its own applied migrations in for the run's entry: its `migrations_table`, else `d1_migrations`. @internal */
export function wranglerHistoryTable(config: DbConfig): string {
  return d1Entries(config.config, config.env).find((c) => c.binding === config.entry.binding)?.migrations_table ?? "d1_migrations";
}

/** Every distinct database name the config declares across the top level and every environment — what one local state directory holds. @internal */
export function sharedD1Databases(config: WranglerConfig): string[] {
  const entries = listDeployments(config).flatMap((deployment) => deployment.effective.d1_databases ?? []);
  return [...new Set(entries.map((entry) => entry.database_name ?? entry.binding))];
}

/** Picks the d1 entry a run acts on, refusing an ambiguous choice rather than taking the first. */
export function selectD1Entry(entries: readonly D1DatabaseConfig[], db: string | null, configPath: string): D1DatabaseConfig {
  if (entries.length === 0) throw new CliError("invalid-args", `${configPath} declares no d1_databases — nothing for forge db to manage`);
  if (db === null) {
    const [only] = entries;
    if (entries.length === 1 && only !== undefined) return only;
    const names = entries.map((e) => `${e.binding}${e.database_name ? ` (${e.database_name})` : ""}`).join(", ");
    throw new CliError(
      "invalid-args",
      `${configPath} declares ${entries.length} d1_databases — name one with --db <binding|database_name>: ${names}`,
    );
  }
  const match = entries.find((e) => e.binding === db || e.database_name === db);
  if (match === undefined) {
    throw new CliError("invalid-args", `--db ${db} matches no d1_databases binding or database_name in ${configPath}`);
  }
  return match;
}

/** Normalises one config entry into the shape every verb reads, with paths made absolute. */
export function toD1Entry(entry: D1DatabaseConfig, configPath: string): D1Entry {
  const databaseName = entry.database_name ?? entry.binding;
  // The name reaches `wrangler d1 export <name>` as an argv positional and a backup directory name.
  if (!DATABASE_NAME.test(databaseName)) {
    throw new CliError(
      "invalid-args",
      `${configPath} declares database_name ${JSON.stringify(databaseName)} on binding ${entry.binding}, which is not a database name — 1 to 64 characters of letters, digits, underscore and hyphen, starting with a letter or a digit`,
    );
  }
  return { binding: entry.binding, databaseName, databaseId: entry.database_id ?? null, previewDatabaseId: entry.preview_database_id ?? null };
}

/** Loads the wrangler config, picks the database and target, and refuses a remote place with no real id. @internal */
export function resolveDbConfig(request: DbConfigRequest): DbConfig {
  const target = parseTarget(request.target);
  if (target === null) throw new CliError("invalid-args", describeTargetGrammar(request.target));

  const root = resolve(request.root);
  const configPath = resolve(root, request.config);
  const loaded = loadWranglerConfig(configPath);
  const env = request.env ?? null;
  const entries = d1Entries(loaded.config, env);
  // `standby:<name>` names the standby database, not a config entry; every other place's suffix does.
  const chosen = selectD1Entry(entries, request.db ?? (target.place === "standby" ? null : target.database), configPath);
  const entry = toD1Entry(chosen, configPath);

  const refusal = refuseRemote(target.place, target.place === "preview" ? entry.previewDatabaseId : entry.databaseId);
  if (refusal !== null) throw new CliError("invalid-args", refusal);

  return { root, configPath, config: loaded.config, env, entry, target };
}
