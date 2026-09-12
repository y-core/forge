import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { CliError } from "../../cli/errors";
import { sha256 } from "../digest";
import { clearLocalState, synthesizeHome } from "../home";
import type { DbConfig, DbIo, DbRunContext, Home, Migration } from "../types";
import { executeFile, migrationsApply, wranglerVersion } from "../wrangler";
import { readSchemaModel } from "./introspect";
import { isSchemaModel } from "./snapshot";
import { SCHEMA_MODEL_VERSION } from "./types";
import type { DesiredState, SchemaModel, ScratchSide } from "./types";

/** The config every compose scratch is synthesized from: the app's, with the target forced to `local` so no run can aim at Cloudflare. @internal */
export function localScratchConfig(config: DbConfig): DbConfig {
  return { ...config, target: { place: "local", database: null } };
}

function scratchDir(config: DbConfig, side: ScratchSide): string {
  return join(config.root, ".forge", "scratch", "compose", side);
}

/** A fresh, empty scratch database for one side, with its migrations directory pointed where the caller says. @internal */
export function composeScratchHome(run: DbRunContext, side: ScratchSide, migrationsDir: string): Home {
  const config = localScratchConfig(run.config);
  const home = synthesizeHome(config, run.io, {
    label: `scratch:compose-${side}`,
    database: `${run.config.entry.databaseName}-compose-${side}`,
    dir: scratchDir(config, side),
    migrationsDir,
  });
  clearLocalState(run.io, home);
  return home;
}

/** Replays the merged migrations into an empty scratch database exactly as an apply would, naming the file that fails. @internal */
export function replayBaseline(run: DbRunContext, migrations: readonly Migration[]): Home {
  const migrationsDir = join(scratchDir(localScratchConfig(run.config), "baseline"), "migrations");
  run.io.remove(migrationsDir);
  run.io.mkdir(migrationsDir);
  for (const migration of migrations) run.io.writeText(join(migrationsDir, `${migration.name}.sql`), migration.sql);
  const home = composeScratchHome(run, "baseline", migrationsDir);
  try {
    migrationsApply(run.io, home);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliError("invalid-args", `the baseline replay failed — a migration on disk does not apply to an empty database:\n${detail}`);
  }
  return home;
}

/** Loads every declared schema into one empty scratch database in the order `config/db.ts` names them, naming the one that does not execute. @internal */
export function loadDesired(run: DbRunContext, desired: readonly DesiredState[]): Home {
  const dir = scratchDir(localScratchConfig(run.config), "desired");
  const filesDir = join(dir, "files");
  run.io.remove(filesDir);
  run.io.mkdir(filesDir);
  const home = composeScratchHome(run, "desired", join(dir, "migrations"));
  for (const state of desired) {
    const file = join(filesDir, `${state.source.replace(/[^A-Za-z0-9_-]+/g, "_")}.sql`);
    run.io.writeText(file, state.text);
    try {
      executeFile(run.io, home, file);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new CliError("invalid-args", `${state.path} does not execute against an empty database:\n${detail}`);
    }
  }
  return home;
}

/** The installed forge's version, for the compose stamp. @internal */
export function forgeVersion(io: DbIo): string {
  try {
    const manifest = JSON.parse(io.readText(fileURLToPath(new URL("../../../../package.json", import.meta.url)))) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : "unknown";
  } catch {
    return "unknown";
  }
}

/** The cache key for one side's model: the model version, the wrangler that built it, and a digest of that side's inputs. @internal */
export function scratchModelKey(wrangler: string, inputsDigest: string): string {
  return sha256(`${SCHEMA_MODEL_VERSION}\0${wrangler}\0${inputsDigest}`).slice(0, 16);
}

/** A side's model from its cache when the key matches, else from `produce`, which is then cached; one model is kept per side. @internal */
export function cachedSchemaModel(run: DbRunContext, side: ScratchSide, key: string, cache: boolean, produce: () => SchemaModel): SchemaModel {
  const cacheDir = join(scratchDir(localScratchConfig(run.config), side), "cache");
  const path = join(cacheDir, key, "model.json");
  if (cache && run.io.exists(path)) {
    try {
      const parsed: unknown = JSON.parse(run.io.readText(path));
      if (isSchemaModel(parsed)) return parsed;
    } catch {
      // An unreadable cache entry is rebuilt below and overwritten.
    }
  }
  const model = produce();
  if (run.io.exists(cacheDir)) for (const entry of run.io.readDir(cacheDir)) if (entry !== key) run.io.remove(join(cacheDir, entry));
  run.io.mkdir(join(cacheDir, key));
  run.io.writeText(path, `${JSON.stringify(model)}\n`);
  return model;
}

const versions = new WeakMap<DbRunContext, string>();

/** The wrangler version, read once per run, which every cache key carries. @internal */
export function scratchWranglerVersion(run: DbRunContext): string {
  const known = versions.get(run);
  if (known !== undefined) return known;
  const version = wranglerVersion(run.io, run.home);
  versions.set(run, version);
  return version;
}

/** Reads a scratch home's model with the app's migrations table filtered out. @internal */
export function readScratchModel(run: DbRunContext, home: Home): SchemaModel {
  return readSchemaModel(run.io, home, run.config.entry.migrationsTable);
}
