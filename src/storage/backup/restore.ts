import { d1Transfer } from "#relax/d1-transfer";

import { isDumpedObject, quoteIdentifier, readSchemaRow, SCHEMA_SELECT, schemaDigest } from "./census";
import { D1BackupError, permanentFailures, wait } from "./errors";
import { readD1Backup } from "./sidecar";
import type {
  BackupStepConfig,
  BackupWorkflowStep,
  D1BackupSidecar,
  D1ImportState,
  D1RestoredDatabase,
  D1RestoreOptions,
  D1RestoreReport,
  D1Transfer,
} from "./types";

const OPEN: BackupStepConfig = { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" }, timeout: "5 minutes" };

const AWAIT: BackupStepConfig = { retries: { limit: 5, delay: "30 seconds", backoff: "exponential" }, timeout: "1 hour" };

const VALIDATE: BackupStepConfig = { retries: { limit: 3, delay: "30 seconds", backoff: "exponential" }, timeout: "10 minutes" };

// D1 starts processing an already-uploaded file at `init`, so a retried start could import the
// dump twice: the step runs once, and a failure fails the restore into a target that is disposable.
function importConfig(options: D1RestoreOptions): BackupStepConfig {
  return { retries: { limit: 0, delay: "1 second", backoff: "constant" }, timeout: options.timeout ?? "1 hour" };
}

function checkOptions(transfer: D1Transfer, options: D1RestoreOptions): void {
  const missing = [...transfer.credentials].filter((field) => options[field] === "");
  if (options.key === "") missing.push("key" as never);
  if ("fresh" in options.into ? options.into.fresh === "" : options.into.standby === "") missing.push("into" as never);
  if (missing.length > 0) throw new D1BackupError("options", `${missing.join(", ")} is empty`);
}

async function appTables(transfer: D1Transfer, options: D1RestoreOptions, target: D1RestoredDatabase): Promise<string[]> {
  return (await transfer.query(options, target, SCHEMA_SELECT))
    .map(readSchemaRow)
    .filter((row) => row.type === "table" && row.name !== "sqlite_sequence" && isDumpedObject(row.name, row.tableName))
    .map((row) => row.name);
}

async function openEmptyTarget(transfer: D1Transfer, options: D1RestoreOptions): Promise<D1RestoredDatabase> {
  const target = await transfer.openTarget(options);
  const held = await appTables(transfer, options, target);
  if (held.length > 0) {
    throw new D1BackupError("target", `${target.name} already holds ${held.join(", ")} — a restore imports only into an empty database`);
  }
  return target;
}

async function startImport(
  transfer: D1Transfer,
  options: D1RestoreOptions,
  target: D1RestoredDatabase,
  sidecar: D1BackupSidecar,
): Promise<D1ImportState> {
  const object = await options.bucket.get(sidecar.key);
  if (object === null) throw new D1BackupError("incomplete", `${sidecar.key} is gone from the bucket`);
  if (object.size !== sidecar.size) {
    await object.body.cancel().catch(() => {});
    throw new D1BackupError("incomplete", `${sidecar.key} holds ${object.size} bytes, but its sidecar recorded ${sidecar.size}`);
  }
  return transfer.startImport(options, target, { body: object.body, size: object.size, md5: sidecar.md5 });
}

async function awaitImport(
  transfer: D1Transfer,
  options: D1RestoreOptions,
  target: D1RestoredDatabase,
  started: D1ImportState,
): Promise<D1ImportState> {
  let state = started;
  while (state.status === "active") {
    await wait(options.pollIntervalMs ?? 1000);
    state = await transfer.pollImport(options, target, state.bookmark);
  }
  if (state.status === "error") throw new D1BackupError("import", `D1 reported the import into ${target.name} failed: ${state.error}`);
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

/** Imports one R2 dump into a fresh or empty database as Workflow steps and checks it against the dump's sidecar. Call it from a `WorkflowEntrypoint`'s `run`. @public */
export async function runD1Restore(step: BackupWorkflowStep, options: D1RestoreOptions): Promise<D1RestoreReport> {
  const transfer = d1Transfer();
  await permanentFailures(options, async () => checkOptions(transfer, options))();
  const sidecar = await step.do(
    "read d1 dump sidecar",
    OPEN,
    permanentFailures(options, async () => {
      const read = await readD1Backup(options.bucket, options.key);
      if (read === null) throw new D1BackupError("incomplete", `${options.key} has no sidecar, so its backup never finished`);
      return read;
    }),
  );
  const target = await step.do(
    "open restore target",
    OPEN,
    permanentFailures(options, () => openEmptyTarget(transfer, options)),
  );
  const started = await step.do(
    "start d1 import",
    importConfig(options),
    permanentFailures(options, () => startImport(transfer, options, target, sidecar)),
  );
  const finished = await step.do(
    "await d1 import",
    AWAIT,
    permanentFailures(options, () => awaitImport(transfer, options, target, started)),
  );
  const mismatches = await step.do(
    "compare restore with sidecar",
    VALIDATE,
    permanentFailures(options, () => compareWithSidecar((sql) => transfer.query(options, target, sql), sidecar)),
  );
  const done = finished.status === "complete" ? finished : { bookmark: null, queries: 0 };
  return { ...target, key: options.key, bookmark: done.bookmark, queries: done.queries, mismatches };
}
