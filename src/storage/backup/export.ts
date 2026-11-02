import { v } from "../../validation/mod";
import { checkedBookmark } from "./bookmark";
import { D1BackupError, wait } from "./errors";
import { createRestoreDatabase, pollD1Import, queryD1, readRestoreDatabase, startD1Import } from "./import";
import { callD1Api, databasePath } from "./rest";
import type { D1BackupOptions, D1ExportState, D1Transfer } from "./types";

const EXPORT_STATE = v.variant("status", [
  v.object({ status: v.literal("active"), at_bookmark: v.string() }),
  v.object({
    status: v.literal("complete"),
    at_bookmark: v.optional(v.string()),
    result: v.object({ filename: v.string(), signed_url: v.string() }),
  }),
  v.object({ status: v.literal("error"), error: v.optional(v.string(), "") }),
]);

// A signed URL never reaches an error message: a Workflow records it.
/** Starts a D1 export, or polls the one running at `bookmark`. @internal */
export async function requestD1Export(options: D1BackupOptions, bookmark: string | null): Promise<D1ExportState> {
  const body = { output_format: "polling", ...(bookmark === null ? {} : { current_bookmark: bookmark }) };
  const parsed = v.safeParse(EXPORT_STATE, await callD1Api(options, "export", databasePath(options.databaseId, "export"), body));
  if (!parsed.success) throw new D1BackupError("malformed", "the D1 export reply was not the shape Cloudflare documents");
  const state = parsed.output;
  if (state.status === "active") return { status: "active", bookmark: state.at_bookmark };
  if (state.status === "error") return { status: "error", error: state.error };
  return { status: "complete", bookmark: state.at_bookmark ?? null, signedUrl: state.result.signed_url };
}

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

function announcedLength(res: Response): number | null {
  const header = res.headers.get("Content-Length");
  return header !== null && /^\d+$/.test(header) ? Number(header) : null;
}

/** Reaches a deployed database's export and import over D1's REST API. @internal */
export const restTransfer: D1Transfer = {
  credentials: ["accountId", "apiToken"],
  async startExport(options) {
    const state = await requestD1Export(options, null);
    if (state.status === "error") throw new D1BackupError("export", `D1 refused to start the export: ${state.error || "no detail"}`);
    if (state.bookmark === null) throw new D1BackupError("malformed", "D1 started the export without naming its bookmark");
    return checkedBookmark(state.bookmark);
  },
  // The signed URL is a bearer credential valid for an hour: it never leaves this call, so it never
  // lands in a Workflow instance's persisted state.
  async openExport(options, bookmark) {
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
    return { body: res.body, length: announcedLength(res) };
  },
  openTarget: async (options) =>
    "fresh" in options.into ? createRestoreDatabase(options, options.into.fresh) : readRestoreDatabase(options, options.into.standby),
  startImport: startD1Import,
  pollImport: pollD1Import,
  query: queryD1,
};
