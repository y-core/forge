import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { DB_LAYOUT } from "../../storage/db/migrations";
import { v } from "../../validation/mod";
import { loadConfigModule } from "../cli/config-module";
import { CliError } from "../cli/errors";
import { DbHostConfigSchema } from "./types";
import type { DbHostConfig, DbRunContext, DeclaredPath, ForgeSchemaName } from "./types";

/** Where `forge db` looks for an application's optional host config. @internal */
export const DEFAULT_DB_CONFIG = "config/db.config.ts";

/** Types the default export of a `config/db.config.ts`. @public */
export function defineDbConfig(config: DbHostConfig): DbHostConfig {
  return config;
}

/** The host config module at `path` under the root, held to `DbHostConfigSchema` and refused by field; `{}` when a non-explicit path is absent. `option` is what an explicit path is quoted as. @internal */
export async function loadHostConfig(root: string, path: string, explicit: boolean, option?: string): Promise<DbHostConfig> {
  const request = { root, path, explicit, what: "db host config", ...(option === undefined ? {} : { option }) };
  const loaded = (await loadConfigModule<unknown>(request))?.value ?? {};
  const result = v.safeParse(DbHostConfigSchema, loaded);
  if (result.success) return loaded as DbHostConfig;
  const detail = result.issues.map((issue) => `${v.getDotPath(issue) ?? "(root)"}: ${issue.message}`).join("; ");
  throw new CliError("invalid-args", `${path}: ${detail}`);
}

/** Resolves one declared position against the root — or, for an `@scope/package/…` specifier, through that package's exports as the app installed it — keeping the text it was written as. @internal */
export function declaredPath(root: string, declared: string): DeclaredPath {
  if (!declared.startsWith("@")) return { path: isAbsolute(declared) ? declared : resolve(root, declared), declared };
  try {
    return { path: createRequire(join(root, "package.json")).resolve(declared), declared };
  } catch {
    throw new CliError(
      "invalid-args",
      `${declared} names a module which no package installed under ${root} exports — install the package, or name the file by its path`,
    );
  }
}

/** The `schemas` entry for a schema forge ships, as the package specifier that resolves to it wherever forge is installed. @public */
export function forgeSchema(name: ForgeSchemaName): string {
  return `@y-core/forge/${name}/schema.sql`;
}

/** Every desired-state file the app composes from, in the order `config/db.config.ts` names them. @internal */
export function declaredSchemas(run: DbRunContext): DeclaredPath[] {
  return (run.host.schemas ?? []).map((declared) => declaredPath(run.config.root, declared));
}

/** Every seeds directory the app runs, in the order `config/db.config.ts` names them. @internal */
export function declaredSeeds(run: DbRunContext): DeclaredPath[] {
  return (run.host.seeds ?? []).map((declared) => declaredPath(run.config.root, declared));
}

/** Where the migrations live: the host config's `migrations`, else `config/db/migrations` under the root. @internal */
export function declaredMigrations(run: DbRunContext): DeclaredPath {
  return declaredPath(run.config.root, run.host.migrations ?? DB_LAYOUT.migrations);
}

/** Where the composed snapshot lives: the host config's `snapshot`, else `config/db/schema.snapshot.json` under the root. @internal */
export function snapshotPath(run: DbRunContext): string {
  return declaredPath(run.config.root, run.host.snapshot ?? DB_LAYOUT.snapshot).path;
}

/** The refusal for a wrangler entry whose `migrations_dir` is not the directory forge applies from, or whose `migrations_pattern` selects other files than its top-level `.sql`, naming the key to set; `null` when they agree. @internal */
export function migrationsDirRefusal(run: DbRunContext, migrationsDir: string | undefined, migrationsPattern?: string): string | null {
  const forge = declaredMigrations(run);
  const configDir = dirname(run.config.configPath);
  const entry = `${run.config.configPath}: the ${run.config.entry.binding} entry's`;
  const wrangler = resolve(configDir, migrationsDir ?? "migrations");
  if (wrangler !== forge.path) {
    const suggested = relative(configDir, forge.path);
    return `${entry} migrations_dir is ${migrationsDir === undefined ? "unset, so wrangler reads `migrations`" : JSON.stringify(migrationsDir)}, but forge applies from ${forge.declared} — set "migrations_dir": ${JSON.stringify(suggested)} on that entry, so \`wrangler d1 migrations\` and forge read one directory`;
  }
  const topLevel = `${migrationsDir ?? "migrations"}/*.sql`;
  if (migrationsPattern === undefined || migrationsPattern === topLevel) return null;
  return `${entry} migrations_pattern is ${JSON.stringify(migrationsPattern)}, but forge applies only the top-level .sql files of ${forge.declared} — remove "migrations_pattern" from that entry, or set it to ${JSON.stringify(topLevel)}, so \`wrangler d1 migrations\` and forge apply one set of files`;
}

/** What `compose` says when refusing to compose from no schema while history exists. @internal */
export const NO_SCHEMAS =
  "config/db.config.ts names no `schemas` — every desired-state file is declared there, including a library's, so that nothing contributes DDL to this database without being asked for:\n" +
  '  export default defineDbConfig({ schemas: [forgeSchema("auth"), "config/db/schema.sql"] });\n' +
  "Each entry is a file of plain `CREATE TABLE` text stating that schema once — write it, then compose.";
