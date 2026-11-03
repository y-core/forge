import type { D1BackupCensus, D1BackupSidecar } from "../../../storage/backup/types";
import { CliError } from "../../cli/errors";
import { takeD1Census } from "./census";
import { meterDump } from "./meter";
import { restPutRefusal } from "./rest-bucket";
import { backupKey, pruneD1Backups, writeSidecar } from "./store";
import type { D1BackupOptions } from "./types";

/** A backup that stored its dump and sidecar, then failed to prune past `keep`, so running it again would take a second dump. @internal */
export class D1PruneError extends CliError {
  constructor(message: string, options?: ErrorOptions) {
    super("external", message, options);
  }
}

function checkOptions(options: D1BackupOptions): void {
  if (options.databaseId === "") throw new CliError("invalid-args", "databaseId is empty");
  if (Number.isNaN(options.at.getTime())) throw new CliError("invalid-args", "`at` is not a valid date");
  if (options.keep !== undefined && (!Number.isInteger(options.keep) || options.keep < 1)) {
    throw new CliError("invalid-args", `\`keep\` is ${options.keep}; keep at least one dump, or omit it to keep every one`);
  }
  if (options.idleTimeoutMs !== undefined && !(options.idleTimeoutMs > 0)) {
    throw new CliError("invalid-args", `\`idleTimeoutMs\` is ${options.idleTimeoutMs}; give a positive number of milliseconds`);
  }
}

async function exportAndStore(options: D1BackupOptions, bookmark: string, census: D1BackupCensus): Promise<D1BackupSidecar> {
  const key = backupKey(options.prefix, options.databaseId, options.at, bookmark);
  const dump = await options.transfer.openExport(bookmark);
  const meter = meterDump(dump.body, options.idleTimeoutMs ?? 60_000);
  const httpMetadata = { contentType: "application/sql" };
  if (options.upload === "whole") {
    await options.bucket.put(key, await new Response(meter.body).bytes(), { httpMetadata });
  } else {
    if (dump.length === null) {
      await meter.body.cancel();
      throw restPutRefusal(key, null);
    }
    await options.bucket.put(key, meter.body, { httpMetadata, contentLength: dump.length });
  }
  const { size, md5, sha256, rows } = meter.measure();
  if (size === 0 || (dump.length !== null && size !== dump.length)) {
    await options.bucket.delete(key);
    throw new CliError(
      "external",
      size === 0
        ? "the D1 export downloaded as an empty file"
        : `the D1 export downloaded ${size} bytes of the ${dump.length} its Content-Length announced`,
    );
  }
  const sidecar: D1BackupSidecar = {
    key,
    databaseId: options.databaseId,
    bookmark,
    takenAt: options.at.toISOString(),
    size,
    md5,
    sha256,
    rows,
    ...census,
  };
  await writeSidecar(options.bucket, sidecar);
  return sidecar;
}

/** Exports one D1 database into R2 beside its sidecar, pruning past `keep`, and answers the sidecar. @internal */
export async function takeD1Backup(options: D1BackupOptions): Promise<D1BackupSidecar> {
  checkOptions(options);
  const census = await takeD1Census(options.database);
  const bookmark = await options.transfer.startExport(options.at);
  const sidecar = await exportAndStore(options, bookmark, census);
  const keep = options.keep;
  if (keep !== undefined) {
    const listed = options.prefix === undefined ? { databaseId: options.databaseId } : { databaseId: options.databaseId, prefix: options.prefix };
    try {
      await pruneD1Backups(options.bucket, listed, keep);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      throw new D1PruneError(
        `${sidecar.key} and its sidecar are stored, but pruning to the newest ${keep} failed: ${why} — the next \`forge db backup --keep ${keep}\` prunes again`,
        { cause: error },
      );
    }
  }
  return sidecar;
}
