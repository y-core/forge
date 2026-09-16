import { isAbsolute, join, resolve } from "node:path";

import { CliError } from "../../cli/errors";
import { sha256 } from "../digest";
import { schemaDrift } from "../drift";
import { clearLocalState, scratchHome } from "../home";
import { applyMigrations } from "../migrate/applier";
import { RECORDED_CHECKSUM_SELECT, toRecordedChecksums } from "../migrate/checksum";
import { COMPANION_TABLES, ensureCompanionTables } from "../migrate/companions";
import { discoverMigrations, migrationsDigest, readMigrationFiles, readMigrations } from "../migrate/files";
import { acquireApplyLock } from "../migrate/lock";
import { localScratchConfig } from "../schema/scratch";
import { INVENTORY_SELECT, rowCountSelect, toSchemaObjects } from "../sql";
import { isRemotePlace } from "../target";
import type { BackupManifest, DbIo, DbRunContext, Home, RestoreRoute, SchemaFacts } from "../types";
import { executeFile, exportSql, queryBatches, queryRows, queryRowsIfTable, wranglerVersion } from "../wrangler";
import {
  appSchemaDigestInput,
  BACKUP_FORMAT_VERSION,
  checkDataArtifact,
  checkInventory,
  checkSchemaArtifact,
  formatBackupDirectory,
  insertStatement,
  manifestSelfDigest,
  UnsupportedValue,
} from "./artifact";
import { formatDivergence } from "./compare";
import { compareTable, describeTables, discoverAppTables, readWholeTable } from "./read";
import type { BackupOptions, BackupOutcome, SourceTable } from "./types";

const DATA_PREAMBLE = "PRAGMA defer_foreign_keys=TRUE;";

// Load order: route `full` declares the tables from the first and fills them from the second.
const ARTIFACT_FILES = ["schema.sql", "data.sql"];

/** Where backups go: the host config's `backupsDir`, or `.forge/backups`, resolved against the root. @internal */
export function resolveBackupsDir(run: DbRunContext, out: string | null = null): string {
  const dir = out ?? run.host.backupsDir ?? ".forge/backups";
  return isAbsolute(dir) ? dir : resolve(run.config.root, dir);
}

// The artifact file appears whole or not at all: a reader that finds `manifest.json` — which is
// written last — finds every file it declares, rather than the prefix a torn write left behind.
function writeArtifactFile(io: DbIo, path: string, text: string): void {
  const temporary = `${path}.tmp`;
  io.writeText(temporary, text);
  io.rename(temporary, path);
}

function tableInserts(source: SourceTable): string[] {
  try {
    return source.raw.map((row) => insertStatement(source.table.name, source.columns, row));
  } catch (error) {
    if (!(error instanceof UnsupportedValue)) throw error;
    throw new CliError("invalid-args", `${source.table.name}.${error.message}`);
  }
}

function restoreInto(run: DbRunContext, scratch: Home, directory: string, route: RestoreRoute, name: string): void {
  if (route === "full") {
    // D1 accepts `PRAGMA defer_foreign_keys=TRUE` without honouring it, so the order below is what
    // carries the foreign keys instead.
    executeFile(run.io, scratch, join(directory, "schema.sql"));
    executeFile(run.io, scratch, join(directory, "data.sql"));
    return;
  }
  // `record: false`: `data.sql` carries the artifact's own `_forge_migrations` rows, with their
  // original ids, `applied_at` and `fingerprint`, so recording here would collide with every one.
  applyMigrations(run, scratch, discoverMigrations(readMigrationFiles(run.io, join(directory, "migrations"))), {
    label: `restore-${name}`,
    record: false,
  });
  // The migrations build the app's tables and no companion: `data.sql` carries the companion rows,
  // so the tables holding them have to exist before it is loaded.
  ensureCompanionTables(run.io, scratch);
  executeFile(run.io, scratch, join(directory, "data.sql"));
}

/** Restores one artifact into a throwaway database of its own, so a claim can be tried against real rows without touching anything live. @internal */
export function restoreScratch(run: DbRunContext, directory: string, name: string, route: RestoreRoute): Home {
  // Route `migrations` replays the artifact's own embedded copy, which is the property being proven.
  // The scratch is local whatever the run's target: a remote artifact is proven here, never there.
  const scratch = scratchHome(localScratchConfig(run.config), run.io, name, `${run.home.database}-${name}`);
  // A restore into a non-empty target is refused by design, and nothing in this tool removes a row.
  clearLocalState(run.io, scratch);
  restoreInto(run, scratch, directory, route, name);
  return scratch;
}

function proveRoute(run: DbRunContext, directory: string, route: RestoreRoute, sources: readonly SourceTable[], appDigest: string): number {
  const scratch = restoreScratch(run, directory, `verify-${route}`, route);

  let divergent = 0;
  run.io.log(`  route ${route}:`);
  const restored = sha256(appSchemaDigestInput(toSchemaObjects(queryRows(run.io, scratch, INVENTORY_SELECT))));
  if (restored !== appDigest) {
    divergent += 1;
    run.io.log(`    ✗ schema — the app objects digest ${appDigest} at the source and ${restored} once restored`);
  }
  for (const source of sources) {
    const comparison = compareTable(run.io, source, scratch);
    divergent += comparison.divergent;
    run.io.log(
      `    ${comparison.divergent === 0 ? "✓" : "✗"} ${source.table.name} — ${comparison.sourceRows} rows, ${comparison.divergent} divergent`,
    );
    for (const divergence of comparison.divergences) run.io.log(`        ${formatDivergence(divergence, 60)}`);
    if (comparison.truncated) run.io.log(`        … ${comparison.divergent - comparison.divergences.length} further divergences not shown`);
  }
  clearLocalState(run.io, scratch);
  return divergent;
}

/** Writes a verified backup artifact directory, proving by both restore routes unless `verify` is false. @public */
export function runBackup(run: DbRunContext, options: BackupOptions): BackupOutcome {
  // Taken against the app's own home, never a scratch one, because `lock.ts` keys on `home.dir`; it
  // is a file under the checkout, so a deployed database is excluded by nothing and takes none.
  const release = isRemotePlace(run.config.target.place) ? () => {} : acquireApplyLock(run.io, run.home, "backup");
  try {
    return takeBackup(run, options);
  } finally {
    release();
  }
}

function takeBackup(run: DbRunContext, options: BackupOptions): BackupOutcome {
  const { io, home, config } = run;

  const objects = toSchemaObjects(queryRows(io, home, INVENTORY_SELECT));
  const inventory = checkInventory(objects);
  if (inventory.length > 0) {
    throw new CliError("invalid-args", `${home.database} is not a database this tool can back up:\n  ${inventory.join("\n  ")}`);
  }

  const appTables = discoverAppTables(io, home);
  const companionNames = objects
    .filter((object) => object.type === "table" && COMPANION_TABLES.includes(object.name))
    .map((object) => object.name)
    .sort();

  const recorded = queryRowsIfTable(io, home, RECORDED_CHECKSUM_SELECT);
  const onDisk = readMigrations(run);
  // Both reads are already in hand, so the state costs nothing. An artifact taken from a drifted
  // database is still worth having — what it may not do is pass its own schema off as the certified one.
  const drift = schemaDrift(recorded === null ? null : toRecordedChecksums(recorded), objects);
  if (drift.state === "mismatch") {
    io.log(
      `! ${home.database} schema fingerprint ${drift.actual} is not the ${drift.recorded} the last apply certified — backing up the database as found`,
    );
  }
  const appDigest = sha256(appSchemaDigestInput(objects));
  const schema: SchemaFacts = {
    migrations: (recorded ?? []).map((row) => String(row.name ?? "")),
    digest: appDigest,
    migrationsDigest: migrationsDigest(onDisk),
  };

  const sources = appTables.map((table) => readWholeTable(io, home, table));
  const companions = describeTables(io, home, companionNames).map((table) => readWholeTable(io, home, table));
  io.log(`read ✓ ${sources.reduce((total, source) => total + source.rows.length, 0)} rows across ${sources.length} tables`);

  const directory = join(resolveBackupsDir(run, options.out), formatBackupDirectory(home.database, io.now()));
  if (io.exists(directory)) {
    throw new CliError("invalid-args", `${directory} already exists — a backup a second ago took this name; wait a second and take it again`);
  }
  io.mkdir(directory);
  // Exported to a temporary name and renamed, like every other file here: route `full` loads this one,
  // so a torn export must not be left under the name the manifest declares.
  const schemaPath = join(directory, "schema.sql");
  exportSql(io, home, `${schemaPath}.tmp`, ["--no-data"]);
  const schemaSql = io.readText(`${schemaPath}.tmp`);
  io.rename(`${schemaPath}.tmp`, schemaPath);

  const rows = [...sources.flatMap(tableInserts), ...companions.flatMap(tableInserts)];
  const dataSql = `${DATA_PREAMBLE}\n${rows.join("\n")}\n`;
  writeArtifactFile(io, join(directory, "data.sql"), dataSql);

  const schemaFaults = checkSchemaArtifact(schemaSql);
  if (schemaFaults.length > 0) {
    throw new CliError(
      "invalid-args",
      `schema.sql is not what a schema-only artifact must be:\n  ${schemaFaults.map((fault) => `line ${fault.line}: ${fault.reason}`).join("\n  ")}`,
    );
  }
  const dataFaults = checkDataArtifact(dataSql, [...appTables.map((table) => table.name), ...companionNames]);
  if (dataFaults.length > 0) {
    throw new CliError(
      "invalid-args",
      `data.sql is not what a data-only artifact must be:\n  ${dataFaults.map((fault) => `line ${fault.line}: ${fault.reason}`).join("\n  ")}`,
    );
  }
  io.log(`artifacts ✓ ${ARTIFACT_FILES.join(", ")}`);

  const migrationsDir = join(directory, "migrations");
  io.mkdir(migrationsDir);
  for (const migration of onDisk) io.writeText(join(migrationsDir, `${migration.name}.sql`), migration.sql);

  const routes: readonly RestoreRoute[] = ["full", "migrations"];
  const proved = [...sources, ...companions];
  const verified = options.verify ? routes.map((route) => ({ route, divergent: proveRoute(run, directory, route, proved, appDigest) })) : [];

  // Counted after the reads and after the proof, which is the widest window a concurrent write can
  // be caught in: the manifest records the rows the artifact holds, and this says they are all of them.
  const counted = queryBatches(
    io,
    home,
    proved.map((source) => rowCountSelect(source.table.name)),
  );
  const counts = new Map<string, number>(proved.map((source, index) => [source.table.name, Number(counted[index]?.[0]?.rows ?? 0)]));
  const torn = proved
    .filter((source) => counts.get(source.table.name) !== source.rows.length)
    .map((source) => `${source.table.name}: ${source.rows.length} rows read and ${counts.get(source.table.name) ?? 0} now in the table`);
  if (torn.length > 0) {
    throw new CliError(
      "invalid-args",
      `${home.database} changed while it was being read, so this artifact is not a snapshot of any one instant:\n  ${torn.join("\n  ")}\nStop whatever is writing to it and take the backup again — ${directory} is incomplete and holds no manifest, so no verb will read it.`,
    );
  }
  const failed = verified.filter((route) => route.divergent > 0);
  if (failed.length > 0) {
    throw new CliError("invalid-args", failed.map((route) => `route ${route.route} left ${route.divergent} divergence(s)`).join("; "));
  }

  const manifest: BackupManifest = {
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: io.now().toISOString(),
    label: options.label,
    dumper: { tool: "forge db backup (schema via wrangler d1 export --no-data)", version: wranglerVersion(io, home) },
    database: { name: home.database, id: config.entry.databaseId, target: config.target.place, persistPath: home.persistTo },
    schema,
    drift: drift.state,
    migrations: onDisk.map((migration) => ({ name: migration.name, sha256: migration.sha256 })),
    tables: sources.map((source) => ({
      name: source.table.name,
      rows: source.rows.length,
      digest: sha256(source.rows.map((row) => row.canonical).join("\n")),
    })),
    artifacts: ARTIFACT_FILES.map((file) => {
      const text = io.readText(join(directory, file));
      return { file, bytes: new TextEncoder().encode(text).length, sha256: sha256(text) };
    }),
    warnings: [
      ...(options.verify ? [] : ["--no-verify: nothing in this artifact has been proven to rebuild"]),
      ...(drift.state === "mismatch"
        ? [
            `taken from a schema no migration certified: the fingerprint is ${drift.actual} and the last apply certified ${drift.recorded} — every digest here describes the database as found, not as the migrations build it`,
          ]
        : []),
      ...(isRemotePlace(config.target.place)
        ? [
            `taken from ${config.target.place}: restore is refused for remote and preview — this artifact restores into local, standby, or a rehearsal scratch`,
          ]
        : []),
    ],
    verified,
    selfDigest: "",
  };
  const stamped: BackupManifest = { ...manifest, selfDigest: manifestSelfDigest(manifest) };
  writeArtifactFile(io, join(directory, "manifest.json"), `${JSON.stringify(stamped, null, 2)}\n`);
  return { directory, manifest: stamped };
}
