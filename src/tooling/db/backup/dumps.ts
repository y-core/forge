import { DEFAULT_BACKUP_PREFIX, latestD1Backup } from "../../../storage/backup/list";
import { readD1Backup } from "../../../storage/backup/sidecar";
import type { BackupBucket, D1BackupSidecar } from "../../../storage/backup/types";
import { readCfAuth } from "../../cf/auth";
import { readDeployment } from "../../cf/config/environment";
import { resolveLifecycleBucket } from "../../cf/lifecycle/commands";
import { CliError } from "../../cli/errors";
import { queryRows } from "../d1";
import { queryDeployed } from "../remote";
import { rowCountSelect } from "../sql";
import { isRemotePlace } from "../target";
import type { DbIo, DbRunContext, Home } from "../types";
import { isDumpedObject, readSchemaRow, SCHEMA_SELECT } from "./census";
import { localTransfer } from "./local-transfer";
import { restBackupBucket } from "./rest-bucket";
import { restTransfer } from "./rest-transfer";
import { splitDumpStatements } from "./split";
import type { BackupPorts, CensusDatabase, DumpSource } from "./types";

/** The R2 binding the dumps are in when no --bucket names one. @internal */
export const DEFAULT_BACKUP_BINDING = "BACKUPS";

/** The database id a dump of the run's target is kept under: the deployed id, or locally the binding's configured id or name. @internal */
export function dumpDatabaseId(run: Pick<DbRunContext, "home" | "config">): string {
  return run.home.databaseId ?? run.config.entry.databaseId ?? run.config.entry.databaseName;
}

/** Where the dumps of the run's database live: the R2 binding and its bucket, the prefix, and the database id `forge db backup` was given. @internal */
export function resolveDumpSource(
  run: Pick<DbRunContext, "home" | "config">,
  flags: { readonly bucket?: string | undefined; readonly prefix?: string | undefined },
): DumpSource {
  const { config } = run;
  const read = readDeployment(config.config, config.env);
  const declared = read.ok ? read.data.effective.r2_buckets : undefined;
  const bindings = (declared ?? []).map((bucket) => bucket.binding);
  const at = (binding: string): DumpSource => ({
    binding,
    bucketName: resolveLifecycleBucket(declared, binding),
    prefix: (flags.prefix ?? DEFAULT_BACKUP_PREFIX).replace(/\/+$/, ""),
    databaseId: dumpDatabaseId(run),
  });
  if (flags.bucket !== undefined) return at(flags.bucket);
  if (bindings.includes(DEFAULT_BACKUP_BINDING)) return at(DEFAULT_BACKUP_BINDING);
  const others = bindings.length === 0 ? "" : ` (it binds ${bindings.join(", ")})`;
  throw new CliError(
    "invalid-args",
    `${config.configPath} binds no R2 bucket named ${DEFAULT_BACKUP_BINDING}${others} — declare one in r2_buckets to keep the dumps apart from other data, or pass --bucket`,
  );
}

/** The bucket the dumps are in: the dev session's own R2 for a local target, else the deployed bucket over REST. @internal */
export async function openDumpBucket(run: DbRunContext, source: DumpSource): Promise<BackupBucket> {
  if (run.home.persistTo !== null) return run.io.bucket(run.home, source.binding);
  return restBackupBucket(run.io, run.home.auth ?? readCfAuth({}), source.bucketName);
}

/** A deployed home read for the census over D1's REST query, one request per statement. @internal */
export function deployedCensusDatabase(io: DbIo, home: Home): CensusDatabase {
  return { prepare: (query) => ({ all: async () => ({ results: (await queryDeployed(io, home, [query], "the backup census"))[0] ?? [] }) }) };
}

/** The bucket, census and D1 transport a backup or restore of the run's database goes through, picked by its place. @internal */
export async function openBackupPorts(run: DbRunContext, source: DumpSource): Promise<BackupPorts> {
  const bucket = await openDumpBucket(run, source);
  if (isRemotePlace(run.config.target.place)) {
    if (run.home.databaseId === null) throw new CliError("invalid-args", `${run.home.label} (${run.home.database}) has no D1 id to address`);
    return {
      bucket,
      database: deployedCensusDatabase(run.io, run.home),
      transfer: restTransfer(run.io, run.home.auth ?? readCfAuth({}), run.home.databaseId),
      upload: "stream",
    };
  }
  const database = await run.io.database(run.home, run.home.binding);
  return { bucket, database, transfer: localTransfer(database, (binding) => run.io.database(run.home, binding)), upload: "whole" };
}

function where(source: DumpSource): string {
  return `${source.binding}:${source.prefix}/${source.databaseId}/`;
}

/** The sidecar of the named dump, else of the newest complete one, read from the local R2 bucket. @internal */
export async function readLocalDump(run: DbRunContext, source: DumpSource, key: string | undefined): Promise<D1BackupSidecar> {
  const bucket = await run.io.bucket(run.home, source.binding);
  if (key !== undefined) {
    const sidecar = await readD1Backup(bucket, key);
    if (sidecar === null) throw new CliError("invalid-args", `${key} has no sidecar in ${source.binding}, so its backup never finished`);
    if (sidecar.databaseId !== source.databaseId) {
      throw new CliError("invalid-args", `${key} was taken from database ${sidecar.databaseId} and this target is ${source.databaseId}`);
    }
    return sidecar;
  }
  const latest = await latestD1Backup(bucket, { databaseId: source.databaseId, prefix: source.prefix });
  const sidecar = latest === null ? null : await readD1Backup(bucket, latest.key);
  if (sidecar === null) {
    throw new CliError("invalid-args", `no complete dump of ${run.home.database} under ${where(source)} — run \`forge db backup\` first`);
  }
  return sidecar;
}

/** Loads a dump from the local R2 bucket into an empty local home, in one transaction. @internal */
export async function loadLocalDump(run: DbRunContext, source: DumpSource, sidecar: D1BackupSidecar, into: Home): Promise<void> {
  const object = await (await run.io.bucket(run.home, source.binding)).get(sidecar.key);
  if (object === null) throw new CliError("invalid-args", `${sidecar.key} is gone from ${source.binding}`);
  await run.io.d1(into, splitDumpStatements(await object.text()));
}

/** Every table D1's dumper would write, with the rows it holds now. @internal */
export async function liveRowCounts(run: DbRunContext, home: Home): Promise<Map<string, number>> {
  const tables = (await queryRows(run.io, home, SCHEMA_SELECT))
    .map(readSchemaRow)
    .filter((row) => row.type === "table" && isDumpedObject(row.name, row.tableName))
    .map((row) => row.name)
    .sort();
  const counts = new Map<string, number>();
  for (const table of tables) {
    const [row] = await queryRows(run.io, home, rowCountSelect(table));
    counts.set(table, Number(row?.rows ?? 0));
  }
  return counts;
}

/** Each table whose live row count differs from the dump's, an empty table matching one the dump holds no row of. @internal */
export function compareRowCounts(sidecar: D1BackupSidecar, live: ReadonlyMap<string, number>): string[] {
  const names = [...new Set([...live.keys(), ...Object.keys(sidecar.rows)])].sort();
  return names.flatMap((name) => {
    const held = sidecar.rows[name] ?? 0;
    const now = live.get(name);
    if (now === undefined) return [`${name} is in the dump and this database no longer declares it`];
    return held === now ? [] : [`${name}: the dump holds ${held} row(s) and the database now holds ${now}`];
  });
}
