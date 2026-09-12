import { join, resolve } from "node:path";

import { CliError } from "../../cli/errors";
import { sharedD1Databases } from "../config";
import { sha256 } from "../digest";
import { INVENTORY_SELECT, rowCountSelect, toSchemaObjects } from "../sql";
import { isRemotePlace } from "../target";
import type { BackupManifest, DbRunContext } from "../types";
import { queryOne, queryRows } from "../wrangler";
import { classifyTable, isVerifiedBackupOf, validateManifest, verifyBackupArtifact } from "./artifact";
import { resolveBackupsDir } from "./backup";
import { describeTable, readWholeTable } from "./read";
import { readBackupManifest } from "./restore";
import type { ResetOptions, ResetOutcome, ResetPlan } from "./types";

interface BackupSelection {
  readonly directory: string;
  readonly path: string;
  readonly manifest: BackupManifest;
}

function latestVerified(run: DbRunContext, database: string): BackupSelection | null {
  const root = resolveBackupsDir(run);
  if (!run.io.exists(root)) return null;
  let found: BackupSelection | null = null;
  for (const entry of run.io.readDir(root).sort()) {
    const path = join(root, entry, "manifest.json");
    if (!run.io.exists(path)) continue;
    try {
      const parsed: unknown = JSON.parse(run.io.readText(path));
      if (validateManifest(parsed).length > 0) continue;
      if (isVerifiedBackupOf(parsed as BackupManifest, database)) {
        found = { directory: entry, path: join(root, entry), manifest: parsed as BackupManifest };
      }
    } catch {
      continue;
    }
  }
  return found;
}

/** The most recent artifact naming this database whose own run proved it rebuilds. @public */
export function findVerifiedBackup(run: DbRunContext, database: string): string | null {
  return latestVerified(run, database)?.directory ?? null;
}

function selectBackup(run: DbRunContext, database: string, rows: number, artifact: string | undefined): BackupSelection {
  if (artifact === undefined) {
    const found = latestVerified(run, database);
    if (found === null) {
      throw new CliError(
        "invalid-args",
        `${database} holds ${rows} rows and no verified backup of it exists under ${resolveBackupsDir(run)} — run \`forge db backup\` first, or pass --allow-unbacked if this database is genuinely disposable`,
      );
    }
    return found;
  }

  const directory = resolve(run.config.root, artifact);
  const manifest = readBackupManifest(run, directory);
  if (!isVerifiedBackupOf(manifest, database)) {
    throw new CliError(
      "invalid-args",
      manifest.database.name === database
        ? `${directory} was taken from ${database} and its own run never proved it rebuilds — a reset relies on an artifact that did`
        : `${directory} was taken from ${manifest.database.name} and this target is ${database}`,
    );
  }
  return { directory, path: directory, manifest };
}

function compareCounts(manifest: BackupManifest, counts: ReadonlyMap<string, number>): string[] {
  const problems: string[] = [];
  const declared = new Map(manifest.tables.map((table) => [table.name, table.rows]));
  for (const [name, count] of [...counts].sort()) {
    const held = declared.get(name);
    if (held === undefined) problems.push(`${name} holds ${count} row(s) and the artifact does not carry it at all`);
    else if (held !== count) problems.push(`${name}: the artifact holds ${held} row(s) and the database now holds ${count}`);
  }
  for (const table of manifest.tables) {
    if (!counts.has(table.name)) problems.push(`${table.name} is in the artifact and this database no longer declares it`);
  }
  return problems;
}

/** Everything a reset checks before it asks: the target, the state directory, its rows, and the artifact that proves them recoverable. @public */
export function prepareReset(run: DbRunContext, options: ResetOptions): ResetPlan {
  const { io, home, config } = run;
  if (isRemotePlace(config.target.place)) {
    throw new CliError(
      "invalid-args",
      `${config.target.place} cannot be reset from here — return a deployed database to a point in time with \`forge db bookmark restore\`, or replace it with \`wrangler d1 create\``,
    );
  }

  // Every environment's local database shares one state directory, and the miniflare filename is a
  // hash, so one of several cannot be told from another; refusing beats guessing which to remove.
  const declared = sharedD1Databases(config.config);
  if (config.target.place === "local" && declared.length > 1) {
    throw new CliError(
      "invalid-args",
      `${config.configPath} declares ${declared.length} d1 databases across its environments (${declared.join(", ")}) and the miniflare state filename is a hash — this tool cannot reset one of several`,
    );
  }

  if (options.expect !== home.database) {
    throw new CliError("invalid-args", `--expect ${options.expect} does not name this target, which is ${home.database}`);
  }

  const state = join(home.persistTo ?? home.dir, "v3", "d1", "miniflare-D1DatabaseObject");
  if (!io.exists(state)) return { database: home.database, state: null, rows: 0, backedUpBy: null };

  const objects = toSchemaObjects(queryRows(io, home, INVENTORY_SELECT));
  const counts = new Map<string, number>();
  for (const object of objects) {
    if (object.type !== "table" || classifyTable(object.name, config.entry.migrationsTable) !== "app") continue;
    counts.set(object.name, Number(queryOne(io, home, rowCountSelect(object.name)).rows ?? 0));
  }
  const rows = [...counts.values()].reduce((total, count) => total + count, 0);

  let backedUpBy: string | null = null;
  if (rows > 0 && !options.allowUnbacked) {
    const selected = selectBackup(run, home.database, rows, options.backup);
    verifyBackupArtifact(io, selected.path, selected.manifest);
    const stale = compareCounts(selected.manifest, counts);
    if (stale.length === 0) {
      const digests = new Map(selected.manifest.tables.map((table) => [table.name, table.digest]));
      for (const name of [...counts.keys()].sort()) {
        const read = readWholeTable(io, home, describeTable(io, home, name));
        if (digests.get(name) !== sha256(read.rows.map((row) => row.canonical).join("\n"))) {
          stale.push(`${name}: ${read.rows.length} row(s) in both, and their contents differ`);
        }
      }
    }
    if (stale.length > 0) {
      throw new CliError(
        "invalid-args",
        `${selected.directory} no longer describes ${home.database}, so it does not prove these ${rows} rows are recoverable:\n  ${stale.join("\n  ")}\nRun \`forge db backup\` first, or pass --allow-unbacked if this database is genuinely disposable`,
      );
    }
    backedUpBy = selected.directory;
  }

  return { database: home.database, state, rows, backedUpBy };
}

/** Removes the state directory a prepared reset named, if any, and reports. @public */
export function executeReset(run: DbRunContext, plan: ResetPlan): ResetOutcome {
  if (plan.state !== null) run.io.remove(plan.state);
  return { database: plan.database, rows: plan.rows, removed: plan.state, backedUpBy: plan.backedUpBy };
}
