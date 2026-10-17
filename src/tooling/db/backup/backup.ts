import { isAbsolute, join, resolve } from "node:path";

import { CliError } from "../../cli/errors";
import { timeTravelInfo } from "../bookmark";
import { sha256 } from "../digest";
import { schemaDrift } from "../drift";
import { clearLocalState, scratchHome } from "../home";
import { applyMigrations } from "../migrate/applier";
import { RECORDED_CHECKSUM_SELECT, toRecordedChecksums } from "../migrate/checksum";
import { COMPANION_TABLES, ensureCompanionTables } from "../migrate/companions";
import { discoverMigrations, migrationsDigest, readMigrationFiles, readMigrations } from "../migrate/files";
import { acquireApplyLock } from "../migrate/lock";
import { localScratchConfig } from "../schema/scratch";
import { INVENTORY_SELECT, rowCountSelect, sqlColumnAffinity, toSchemaObjects } from "../sql";
import { isRemotePlace } from "../target";
import type { BackupManifest, DbIo, DbRunContext, Home, RestoreRoute, SchemaFacts } from "../types";
import { executeFile, exportSql, queryBatches, queryRows, queryRowsIfTable, wranglerVersion } from "../wrangler";
import {
  appSchemaDigestInput,
  BACKUP_FORMAT_VERSION,
  checkDataArtifact,
  checkInventory,
  checkSchemaArtifact,
  declaredTypesSelect,
  exportHazards,
  exportHazardSelect,
  formatBackupDirectory,
  insertStatement,
  manifestSelfDigest,
  UnsupportedValue,
} from "./artifact";
import { formatDivergence } from "./compare";
import { compareHomes, compareTable, describeTables, digestWholeTable, discoverAppTables, readWholeTable } from "./read";
import type { BackupOptions, BackupOutcome, SourceTable, TableComparison } from "./types";

const DATA_PREAMBLE = "PRAGMA defer_foreign_keys=TRUE;";

// Load order: route `full` declares the tables from the first and fills them from the second.
const ARTIFACT_FILES = ["schema.sql", "data.sql"] as const;

/** An export's data without the `sqlite_stat*` rows `ANALYZE` and `PRAGMA optimize` leave, which describe no app data and are outside every backup. @internal */
export function withoutPlannerStatistics(dump: string): string {
  return dump
    .replace(/\n[^\S\n]*INSERT[^\S\n]+INTO[^\S\n]+"?sqlite_stat\d"?(?:[^\S\n]|\()[^\n]*/gi, "")
    .replace(/^[^\S\n]*INSERT[^\S\n]+INTO[^\S\n]+"?sqlite_stat\d"?(?:[^\S\n]|\()[^\n]*\n?/i, "");
}

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

async function restoreInto(run: DbRunContext, scratch: Home, directory: string, route: RestoreRoute, name: string): Promise<void> {
  if (route === "full") {
    // `defer_foreign_keys` lasts only until its transaction commits, and two files are two transactions,
    // so the order below is what carries the foreign keys.
    await executeFile(run.io, scratch, join(directory, "schema.sql"));
    await executeFile(run.io, scratch, join(directory, "data.sql"));
    return;
  }
  // `record: false`: `data.sql` carries the artifact's own `_forge_migrations` rows, with their
  // original ids, `applied_at` and `fingerprint`, so recording here would collide with every one.
  await applyMigrations(run, scratch, discoverMigrations(readMigrationFiles(run.io, join(directory, "migrations"))), {
    label: `restore-${name}`,
    record: false,
  });
  // The migrations build the app's tables and no companion: `data.sql` carries the companion rows,
  // so the tables holding them have to exist before it is loaded.
  await ensureCompanionTables(run.io, scratch);
  await executeFile(run.io, scratch, join(directory, "data.sql"));
}

/** Restores one artifact into a throwaway database of its own, so a claim can be tried against real rows without touching anything live. @internal */
export async function restoreScratch(run: DbRunContext, directory: string, name: string, route: RestoreRoute): Promise<Home> {
  // Route `migrations` replays the artifact's own embedded copy, which is the property being proven.
  // The scratch is local whatever the run's target: a remote artifact is proven here, never there.
  const scratch = scratchHome(localScratchConfig(run.config), run.io, name, `${run.home.database}-${name}`);
  // A restore into a non-empty target is refused by design, and nothing in this tool removes a row.
  await clearLocalState(run.io, scratch);
  await restoreInto(run, scratch, directory, route, name);
  return scratch;
}

type ProveTable = (scratch: Home) => Promise<TableComparison>;

async function appDigestOf(io: DbIo, home: Home): Promise<string> {
  return sha256(appSchemaDigestInput(toSchemaObjects(await queryRows(io, home, INVENTORY_SELECT))));
}

async function proveRestored(
  run: DbRunContext,
  scratch: Home,
  route: RestoreRoute,
  tables: readonly ProveTable[],
  appDigest: string,
): Promise<number> {
  let divergent = 0;
  run.io.log(`  route ${route}:`);
  const restored = await appDigestOf(run.io, scratch);
  if (restored !== appDigest) {
    divergent += 1;
    run.io.log(`    ✗ schema — the app objects digest ${appDigest} at the source and ${restored} once restored`);
  }
  for (const prove of tables) {
    const comparison = await prove(scratch);
    divergent += comparison.divergent;
    run.io.log(
      `    ${comparison.divergent === 0 ? "✓" : "✗"} ${comparison.table} — ${comparison.sourceRows} rows, ${comparison.divergent} divergent`,
    );
    for (const divergence of comparison.divergences) run.io.log(`        ${formatDivergence(divergence, 60)}`);
    if (comparison.truncated) run.io.log(`        … ${comparison.divergent - comparison.divergences.length} further divergences not shown`);
  }
  return divergent;
}

async function proveRoute(
  run: DbRunContext,
  directory: string,
  route: RestoreRoute,
  tables: readonly ProveTable[],
  appDigest: string,
): Promise<number> {
  const scratch = await restoreScratch(run, directory, `verify-${route}`, route);
  const divergent = await proveRestored(run, scratch, route, tables, appDigest);
  await clearLocalState(run.io, scratch);
  return divergent;
}

/** Writes a verified backup artifact directory, proving by both restore routes unless `verify` is false. @public */
export async function runBackup(run: DbRunContext, options: BackupOptions): Promise<BackupOutcome> {
  // Taken against the app's own home, never a scratch one, because `lock.ts` keys on `home.dir`; it
  // is a file under the checkout, so a deployed database is excluded by nothing and takes none.
  const release = isRemotePlace(run.config.target.place) ? () => {} : acquireApplyLock(run.io, run.home, "backup");
  try {
    return await takeBackup(run, options);
  } finally {
    release();
  }
}

async function takeBackup(run: DbRunContext, options: BackupOptions): Promise<BackupOutcome> {
  const { io, home, config } = run;

  const objects = toSchemaObjects(await queryRows(io, home, INVENTORY_SELECT));
  const inventory = checkInventory(objects);
  if (inventory.length > 0) {
    throw new CliError("invalid-args", `${home.database} is not a database this tool can back up:\n  ${inventory.join("\n  ")}`);
  }

  const appTables = await discoverAppTables(io, home);
  const companionNames = objects
    .filter((object) => object.type === "table" && COMPANION_TABLES.includes(object.name))
    .map((object) => object.name)
    .sort();

  const recorded = await queryRowsIfTable(io, home, RECORDED_CHECKSUM_SELECT);
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

  const via = options.via ?? "read";
  const companionTables = await describeTables(io, home, companionNames);
  const tables = [...appTables, ...companionTables];
  const sources: SourceTable[] = [];
  if (via === "read") {
    for (const table of tables) sources.push(await readWholeTable(io, home, table));
    const app = sources.slice(0, appTables.length);
    io.log(`read ✓ ${app.reduce((total, source) => total + source.rows.length, 0)} rows across ${app.length} tables`);
  }
  let exportedCounts = new Map<string, number>();
  if (via === "export") {
    const types = await queryBatches(io, home, tables.map(declaredTypesSelect));
    const real = (index: number) =>
      new Set((types[index] ?? []).filter((row) => sqlColumnAffinity(String(row.type ?? "")) === "REAL").map((row) => String(row.name ?? "")));
    const counted = await queryBatches(io, home, [
      ...tables.map((table, index) => exportHazardSelect(table, real(index))),
      ...tables.map((table) => rowCountSelect(table.name)),
    ]);
    const hazards = tables.flatMap((table, index) => exportHazards(table, counted[index]?.[0]));
    if (hazards.length > 0) {
      throw new CliError(
        "invalid-args",
        `${home.database} holds values wrangler d1 export would not reproduce, so --via export is refused — back it up without --via:\n  ${hazards.join("\n  ")}`,
      );
    }
    exportedCounts = new Map(tables.map((table, index) => [table.name, Number(counted[tables.length + index]?.[0]?.rows ?? 0)]));
  }
  const bookmark = via === "export" && isRemotePlace(config.target.place) ? timeTravelInfo(io, home, undefined, config).bookmark : null;

  const directory = join(resolveBackupsDir(run, options.out), formatBackupDirectory(home.database, io.now()));
  if (io.exists(directory)) {
    throw new CliError("invalid-args", `${directory} already exists — a backup a second ago took this name; wait a second and take it again`);
  }
  io.mkdir(directory);
  const incomplete = `${directory} is incomplete and holds no manifest, so no verb will read it.`;
  const schemaExport = join(directory, "schema.export.sql");
  await exportSql(io, home, schemaExport, ["--no-data"]);
  const schemaSql = io.readText(schemaExport);
  writeArtifactFile(io, join(directory, "schema.sql"), schemaSql);
  io.remove(schemaExport);

  let dataSql: string;
  if (via === "read") {
    const exportedDigest = await appDigestOf(io, home);
    if (exportedDigest !== appDigest) {
      throw new CliError(
        "invalid-args",
        `${home.database}'s schema changed between reading the rows and exporting the schema: its app objects digest ${appDigest} before and ${exportedDigest} after, so schema.sql and data.sql need not describe one schema.\nStop whatever is changing it and take the backup again — ${incomplete}`,
      );
    }
    dataSql = `${DATA_PREAMBLE}\n${sources.flatMap(tableInserts).join("\n")}\n`;
  } else {
    const dataExport = join(directory, "data.export.sql");
    await exportSql(io, home, dataExport, ["--no-schema"]);
    dataSql = withoutPlannerStatistics(io.readText(dataExport));
    io.remove(dataExport);
    const exportedDigest = await appDigestOf(io, home);
    if (exportedDigest !== appDigest) {
      throw new CliError(
        "invalid-args",
        `${home.database}'s schema changed between the schema export and the data export: its app objects digest ${appDigest} before and ${exportedDigest} after, so schema.sql and data.sql need not describe one schema.\nStop whatever is changing it and take the backup again — ${incomplete}`,
      );
    }
  }
  writeArtifactFile(io, join(directory, "data.sql"), dataSql);
  const written: Record<(typeof ARTIFACT_FILES)[number], string> = { "schema.sql": schemaSql, "data.sql": dataSql };

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

  const torn = (lines: readonly string[], activity: string) =>
    new CliError(
      "invalid-args",
      `${home.database} changed while it was being ${activity}, so this artifact is not a snapshot of any one instant:\n  ${lines.join("\n  ")}\nStop whatever is writing to it and take the backup again — ${incomplete}`,
    );
  const verified: { route: RestoreRoute; divergent: number }[] = [];
  let tableDigests: { name: string; rows: number; digest: string }[];
  if (via === "read") {
    const routes: readonly RestoreRoute[] = ["full", "migrations"];
    const proofs = sources.map(
      (source): ProveTable =>
        (scratch) =>
          compareTable(io, source, scratch),
    );
    if (options.verify) {
      for (const route of routes) verified.push({ route, divergent: await proveRoute(run, directory, route, proofs, appDigest) });
    }
    // Counted after the reads and after the proof, which is the widest window a concurrent write can
    // be caught in: the manifest records the rows the artifact holds, and this says they are all of them.
    const counted = await queryBatches(
      io,
      home,
      sources.map((source) => rowCountSelect(source.table.name)),
    );
    const changed = sources.flatMap((source, index) => {
      const now = Number(counted[index]?.[0]?.rows ?? 0);
      return now === source.rows.length ? [] : [`${source.table.name}: ${source.rows.length} rows read and ${now} now in the table`];
    });
    if (changed.length > 0) throw torn(changed, "read");
    tableDigests = sources
      .slice(0, appTables.length)
      .map((source) => ({ name: source.table.name, rows: source.rows.length, digest: sha256(source.rows.map((row) => row.canonical).join("\n")) }));
  } else {
    const reference = await restoreScratch(run, directory, "export-read", "full");
    try {
      const digested: { name: string; rows: number; digest: string }[] = [];
      for (const table of tables) digested.push({ name: table.name, ...(await digestWholeTable(io, reference, table)) });
      const app = digested.slice(0, appTables.length);
      io.log(`read ✓ ${app.reduce((total, table) => total + table.rows, 0)} rows across ${app.length} tables, from the export`);
      const changed = digested
        .filter((table) => exportedCounts.get(table.name) !== table.rows)
        .map((table) => `${table.name}: ${exportedCounts.get(table.name) ?? 0} rows counted just before the export and ${table.rows} in it`);
      if (changed.length > 0) throw torn(changed, "exported");
      if (options.verify) {
        verified.push({ route: "full", divergent: await proveRestored(run, reference, "full", [], appDigest) });
        const proofs = tables.map(
          (table): ProveTable =>
            (scratch) =>
              compareHomes(io, table, reference, scratch),
        );
        verified.push({ route: "migrations", divergent: await proveRoute(run, directory, "migrations", proofs, appDigest) });
      }
      tableDigests = app;
    } finally {
      await clearLocalState(io, reference);
    }
  }
  const failed = verified.filter((route) => route.divergent > 0);
  if (failed.length > 0) {
    throw new CliError("invalid-args", failed.map((route) => `route ${route.route} left ${route.divergent} divergence(s)`).join("; "));
  }

  const manifest: BackupManifest = {
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: io.now().toISOString(),
    label: options.label,
    dumper: {
      tool: via === "read" ? "forge db backup (schema via wrangler d1 export --no-data)" : "forge db backup --via export (wrangler d1 export)",
      version: wranglerVersion(io, home),
    },
    via,
    bookmark,
    database: { name: home.database, id: config.entry.databaseId, target: config.target.place, persistPath: home.persistTo },
    schema,
    drift: drift.state,
    migrations: onDisk.map((migration) => ({ name: migration.name, sha256: migration.sha256 })),
    tables: tableDigests,
    artifacts: ARTIFACT_FILES.map((file) => {
      const text = written[file];
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
