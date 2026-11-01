import { D1BackupError, isPermanentBackupFailure } from "./errors";
import { requestD1Export } from "./export";
import { backupKey, pruneD1Backups } from "./list";
import type { BackupStepConfig, BackupWorkflowStep, D1BackupOptions, D1BackupRecord } from "./types";
import { storeMultipart } from "./upload";

const BOOKMARK = /^[A-Za-z0-9_-]{1,128}$/;

const START: BackupStepConfig = { retries: { limit: 5, delay: "10 seconds", backoff: "exponential" }, timeout: "2 minutes" };

const PRUNE: BackupStepConfig = { retries: { limit: 3, delay: "30 seconds", backoff: "linear" }, timeout: "5 minutes" };

function storeConfig(options: D1BackupOptions): BackupStepConfig {
  return { retries: { limit: 3, delay: "1 minute", backoff: "exponential" }, timeout: options.timeout ?? "1 hour" };
}

function checkOptions(options: D1BackupOptions): void {
  const missing = (["accountId", "databaseId", "apiToken"] as const).filter((field) => options[field] === "");
  if (missing.length > 0) throw new D1BackupError("options", `${missing.join(", ")} is empty`);
  if (Number.isNaN(options.at.getTime())) throw new D1BackupError("options", "`at` is not a valid date");
  if (options.keep !== undefined && (!Number.isInteger(options.keep) || options.keep < 1)) {
    throw new D1BackupError("options", `\`keep\` is ${options.keep}; keep at least one dump, or omit it to keep every one`);
  }
}

function checkedBookmark(bookmark: string): string {
  if (!BOOKMARK.test(bookmark)) throw new D1BackupError("malformed", "D1 answered a bookmark outside its documented grammar");
  return bookmark;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Polls the export running at `bookmark` until D1 hands back its signed URL. */
async function awaitExport(options: D1BackupOptions, bookmark: string): Promise<string> {
  for (;;) {
    const state = await requestD1Export(options, bookmark);
    if (state.status === "error") throw new D1BackupError("export", `D1 reported the export failed: ${state.error || "no detail"}`);
    if (state.status === "complete") {
      if (state.bookmark !== null && state.bookmark !== bookmark) throw new D1BackupError("export", "D1 moved the export's bookmark while it ran");
      if (!state.signedUrl.startsWith("https://")) throw new D1BackupError("malformed", "D1 answered a signed URL that is not HTTPS");
      return state.signedUrl;
    }
    if (state.bookmark !== bookmark) throw new D1BackupError("export", "D1 moved the export's bookmark while it ran");
    await wait(options.pollIntervalMs ?? 1000);
  }
}

// The signed URL is a bearer credential valid for an hour: it lives inside this one step and is
// never returned from it, so it never lands in the instance's persisted state.
async function exportAndStore(options: D1BackupOptions, bookmark: string): Promise<D1BackupRecord> {
  const signedUrl = await awaitExport(options, bookmark);
  const fetchFn = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  let res: Response;
  try {
    res = await fetchFn(signedUrl);
  } catch {
    throw new D1BackupError("download", "downloading the D1 export failed: network error");
  }
  if (!res.ok || res.body === null)
    throw new D1BackupError("download", `downloading the D1 export failed (HTTP ${res.status})`, { status: res.status });
  const key = backupKey(options.prefix, options.databaseId, options.at, bookmark);
  const takenAt = options.at.toISOString();
  const size = await storeMultipart(options.bucket, key, res.body, { bookmark, databaseId: options.databaseId, takenAt });
  return { key, databaseId: options.databaseId, bookmark, takenAt, size };
}

function permanent<T>(options: D1BackupOptions, run: () => Promise<T>): () => Promise<T> {
  return async () => {
    try {
      return await run();
    } catch (error) {
      if (options.nonRetryable !== undefined && isPermanentBackupFailure(error)) throw options.nonRetryable((error as Error).message);
      throw error;
    }
  };
}

/** Exports a deployed D1 database into R2 as Workflow steps, pruning past `keep`, and answers the dump it stored. Call it from a `WorkflowEntrypoint`'s `run`. @public */
export async function runD1Backup(step: BackupWorkflowStep, options: D1BackupOptions): Promise<D1BackupRecord> {
  await permanent(options, async () => checkOptions(options))();
  const bookmark = await step.do(
    "start d1 export",
    START,
    permanent(options, async () => {
      const state = await requestD1Export(options, null);
      if (state.status === "error") throw new D1BackupError("export", `D1 refused to start the export: ${state.error || "no detail"}`);
      if (state.bookmark === null) throw new D1BackupError("malformed", "D1 started the export without naming its bookmark");
      return checkedBookmark(state.bookmark);
    }),
  );
  const record = await step.do(
    "export and store d1 dump",
    storeConfig(options),
    permanent(options, () => exportAndStore(options, bookmark)),
  );
  const keep = options.keep;
  if (keep !== undefined) {
    const listed = options.prefix === undefined ? { databaseId: options.databaseId } : { databaseId: options.databaseId, prefix: options.prefix };
    await step.do("prune old d1 dumps", PRUNE, () => pruneD1Backups(options.bucket, listed, keep));
  }
  return record;
}
