import { resolve } from "node:path";

import { v } from "../../validation/mod";
import { loadWranglerConfig } from "../cf/config/parse";
import type { D1DatabaseConfig, WranglerConfig } from "../cf/types";
import { CliError } from "../cli/errors";
import { DATABASE_NAME, describeTargetGrammar, parseTarget, refuseRemote } from "./target";
import { D1EntrySchema } from "./types";
import type { D1Entry, DbConfig, DbConfigRequest } from "./types";

/** Holds each entry to `D1EntrySchema`, naming the config, the block and the field of the first one that is not. */
function checkD1Entries(entries: readonly D1DatabaseConfig[], configPath: string, block: string): D1DatabaseConfig[] {
  return entries.map((entry, index) => {
    const result = v.safeParse(D1EntrySchema, entry);
    if (result.success) return entry;
    const detail = result.issues.map((issue) => `${block}[${index}].${v.getDotPath(issue) ?? "(root)"}: ${issue.message}`).join("; ");
    throw new CliError("invalid-args", `${configPath}: ${detail}`);
  });
}

/** The d1 entries an environment sees: its own list when it declares one, the top level otherwise. @internal */
export function d1Entries(config: WranglerConfig, env: string | null, configPath = "wrangler.jsonc"): D1DatabaseConfig[] {
  if (env !== null) {
    const envs = config.env as Record<string, { d1_databases?: D1DatabaseConfig[] } | undefined> | undefined;
    // Own keys only: a bare index answers `toString` and every other prototype member, so the
    // refusal below would not fire and the run would fall through to the top-level entry.
    const scoped = envs !== undefined && Object.hasOwn(envs, env) ? envs[env] : undefined;
    if (scoped === undefined) throw new CliError("invalid-args", `--env ${env} names no \`env.${env}\` block in the wrangler config`);
    if (scoped.d1_databases !== undefined) return checkD1Entries(scoped.d1_databases, configPath, `env.${env}.d1_databases`);
  }
  return checkD1Entries(config.d1_databases ?? [], configPath, "d1_databases");
}

/** Every distinct database name the config declares across the top level and every environment — what one local state directory holds. @internal */
export function sharedD1Databases(config: WranglerConfig): string[] {
  const envs = (config.env ?? {}) as Record<string, { d1_databases?: D1DatabaseConfig[] } | undefined>;
  const entries = [...(config.d1_databases ?? []), ...Object.values(envs).flatMap((scoped) => scoped?.d1_databases ?? [])];
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
  // The name reaches `wrangler d1 execute <name>` as an argv positional and a backup directory name.
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
  const entries = d1Entries(loaded.config, env, configPath);
  // `standby:<name>` names the standby database, not a config entry; every other place's suffix does.
  const chosen = selectD1Entry(entries, request.db ?? (target.place === "standby" ? null : target.database), configPath);
  const entry = toD1Entry(chosen, configPath);

  const refusal = refuseRemote(target.place, target.place === "preview" ? entry.previewDatabaseId : entry.databaseId);
  if (refusal !== null) throw new CliError("invalid-args", refusal);

  return { root, configPath, config: loaded.config, env, entry, target };
}
