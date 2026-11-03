import { readD1Backup } from "../../../storage/backup/sidecar";
import type { D1BackupSidecar, D1RestoredDatabase, D1RestoreReport } from "../../../storage/backup/types";
import { CliError } from "../../cli/errors";
import { isDumpedObject, quoteIdentifier, readSchemaRow, SCHEMA_SELECT, schemaDigest } from "./census";
import type { D1ImportState, D1RestoreOptions } from "./types";

function checkOptions(options: D1RestoreOptions): void {
  const missing = [
    ...(options.key === "" ? ["key"] : []),
    ...(("fresh" in options.into ? options.into.fresh : options.into.standby) === "" ? ["into"] : []),
  ];
  if (missing.length > 0) throw new CliError("invalid-args", `${missing.join(", ")} is empty`);
}

async function readSidecar(options: D1RestoreOptions): Promise<D1BackupSidecar> {
  const read = await readD1Backup(options.bucket, options.key);
  if (read === null) throw new CliError("invalid-args", `${options.key} has no sidecar, so its backup never finished`);
  return read;
}

async function appTables(options: D1RestoreOptions, target: D1RestoredDatabase): Promise<string[]> {
  return (await options.transfer.query(target, SCHEMA_SELECT))
    .map(readSchemaRow)
    .filter((row) => row.type === "table" && row.name !== "sqlite_sequence" && isDumpedObject(row.name, row.tableName))
    .map((row) => row.name);
}

async function openEmptyTarget(options: D1RestoreOptions): Promise<D1RestoredDatabase> {
  const target = await options.transfer.openTarget(options.into);
  const held = await appTables(options, target);
  if (held.length > 0) {
    throw new CliError("invalid-args", `${target.name} already holds ${held.join(", ")} — a restore imports only into an empty database`);
  }
  return target;
}

async function startImport(options: D1RestoreOptions, target: D1RestoredDatabase, sidecar: D1BackupSidecar): Promise<D1ImportState> {
  const object = await options.bucket.get(sidecar.key);
  if (object === null) throw new CliError("invalid-args", `${sidecar.key} is gone from the bucket`);
  if (object.size !== sidecar.size) {
    await object.body.cancel().catch(() => {});
    throw new CliError("invalid-args", `${sidecar.key} holds ${object.size} bytes, but its sidecar recorded ${sidecar.size}`);
  }
  return options.transfer.startImport(target, { body: object.body, size: object.size, md5: sidecar.md5 });
}

async function awaitImport(options: D1RestoreOptions, target: D1RestoredDatabase, started: D1ImportState): Promise<D1ImportState> {
  let state = started;
  while (state.status === "active") state = await options.transfer.pollImport(target, state.bookmark);
  if (state.status === "error") throw new CliError("external", `D1 reported the import into ${target.name} failed: ${state.error}`);
  return state;
}

/** Every way a restored database, read through `query`, differs from the sidecar of the dump it was restored from. @internal */
export async function compareWithSidecar(query: (sql: string) => Promise<Record<string, unknown>[]>, sidecar: D1BackupSidecar): Promise<string[]> {
  const mismatches: string[] = [];
  const digest = await schemaDigest((await query(SCHEMA_SELECT)).map(readSchemaRow));
  if (digest !== sidecar.schemaDigest) mismatches.push(`the schema digests ${digest}, but the sidecar recorded ${sidecar.schemaDigest}`);
  for (const [table, rows] of Object.entries(sidecar.rows)) {
    const counted = await query(`SELECT COUNT(*) AS n FROM ${quoteIdentifier(table)}`).catch(() => null);
    const held = counted === null ? null : Number(counted[0]?.n ?? 0);
    if (held !== rows) mismatches.push(`${table} holds ${held === null ? "no such table" : `${held} rows`}, but the dump holds ${rows}`);
  }
  if (sidecar.migrationHead !== null) {
    const head = await query("SELECT name FROM _forge_migrations ORDER BY id DESC LIMIT 1")
      .then((rows) => (rows[0]?.name === undefined ? null : String(rows[0].name)))
      .catch(() => null);
    if (head !== sidecar.migrationHead)
      mismatches.push(`the migration head is ${head ?? "none"}, but the sidecar recorded ${sidecar.migrationHead}`);
  }
  return mismatches;
}

/** Imports one R2 dump into a fresh or empty database and checks it against the dump's sidecar. @internal */
export async function restoreD1Backup(options: D1RestoreOptions): Promise<D1RestoreReport> {
  checkOptions(options);
  const sidecar = await readSidecar(options);
  const target = await openEmptyTarget(options);
  const started = await startImport(options, target, sidecar);
  const finished = await awaitImport(options, target, started);
  const mismatches = await compareWithSidecar((sql) => options.transfer.query(target, sql), sidecar);
  const done = finished.status === "complete" ? finished : { bookmark: null, queries: 0 };
  return { ...target, key: options.key, bookmark: done.bookmark, queries: done.queries, mismatches };
}
