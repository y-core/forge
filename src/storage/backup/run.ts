import { d1Transfer } from "#relax/d1-transfer";

import { takeD1Census } from "./census";
import { D1BackupError, permanentFailures } from "./errors";
import { backupKey, pruneD1Backups } from "./list";
import { meterDump } from "./meter";
import { writeSidecar } from "./sidecar";
import type { BackupStepConfig, BackupWorkflowStep, D1BackupCensus, D1BackupOptions, D1BackupSidecar, D1Transfer } from "./types";
import { storeMultipart } from "./upload";

const CENSUS: BackupStepConfig = { retries: { limit: 3, delay: "30 seconds", backoff: "exponential" }, timeout: "10 minutes" };

const START: BackupStepConfig = { retries: { limit: 5, delay: "10 seconds", backoff: "exponential" }, timeout: "2 minutes" };

const PRUNE: BackupStepConfig = { retries: { limit: 3, delay: "30 seconds", backoff: "linear" }, timeout: "5 minutes" };

function storeConfig(options: D1BackupOptions): BackupStepConfig {
  return { retries: { limit: 3, delay: "1 minute", backoff: "exponential" }, timeout: options.timeout ?? "1 hour" };
}

function checkOptions(transfer: D1Transfer, options: D1BackupOptions): void {
  const missing = (["databaseId", ...transfer.credentials] as const).filter((field) => options[field] === "");
  if (missing.length > 0) throw new D1BackupError("options", `${missing.join(", ")} is empty`);
  if (Number.isNaN(options.at.getTime())) throw new D1BackupError("options", "`at` is not a valid date");
  if (options.keep !== undefined && (!Number.isInteger(options.keep) || options.keep < 1)) {
    throw new D1BackupError("options", `\`keep\` is ${options.keep}; keep at least one dump, or omit it to keep every one`);
  }
  if (options.idleTimeoutMs !== undefined && !(options.idleTimeoutMs > 0)) {
    throw new D1BackupError("options", `\`idleTimeoutMs\` is ${options.idleTimeoutMs}; give a positive number of milliseconds`);
  }
}

async function exportAndStore(transfer: D1Transfer, options: D1BackupOptions, bookmark: string, census: D1BackupCensus): Promise<D1BackupSidecar> {
  const dump = await transfer.openExport(options, bookmark);
  const key = backupKey(options.prefix, options.databaseId, options.at, bookmark);
  const takenAt = options.at.toISOString();
  const meter = meterDump(dump.body, options.idleTimeoutMs ?? 60_000);
  await storeMultipart(options.bucket, key, meter.chunks, { bookmark, databaseId: options.databaseId, takenAt }, dump.length);
  const { size, md5, sha256, rows } = await meter.measure();
  const sidecar: D1BackupSidecar = { key, databaseId: options.databaseId, bookmark, takenAt, size, md5, sha256, rows, ...census };
  await writeSidecar(options.bucket, sidecar);
  return sidecar;
}

/** Exports a deployed D1 database into R2 with its sidecar as Workflow steps, pruning past `keep`, and answers the sidecar. Call it from a `WorkflowEntrypoint`'s `run`. @public */
export async function runD1Backup(step: BackupWorkflowStep, options: D1BackupOptions): Promise<D1BackupSidecar> {
  const transfer = d1Transfer();
  await permanentFailures(options, async () => checkOptions(transfer, options))();
  const census = await step.do(
    "take d1 census",
    CENSUS,
    permanentFailures(options, () => takeD1Census(options.database)),
  );
  const bookmark = await step.do(
    "start d1 export",
    START,
    permanentFailures(options, () => transfer.startExport(options)),
  );
  const sidecar = await step.do(
    "export and store d1 dump",
    storeConfig(options),
    permanentFailures(options, () => exportAndStore(transfer, options, bookmark, census)),
  );
  const keep = options.keep;
  if (keep !== undefined) {
    const listed = options.prefix === undefined ? { databaseId: options.databaseId } : { databaseId: options.databaseId, prefix: options.prefix };
    await step.do("prune old d1 dumps", PRUNE, () => pruneD1Backups(options.bucket, listed, keep));
  }
  return sidecar;
}
