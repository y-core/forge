import { v } from "../../validation/mod";
import { D1BackupError } from "./errors";
import type { D1BackupOptions, D1ExportState } from "./types";

const API = "https://api.cloudflare.com/client/v4";

const REQUEST_TIMEOUT_MS = 30_000;

const EXPORT_REPLY = v.object({
  success: v.boolean(),
  result: v.nullish(
    v.variant("status", [
      v.object({ status: v.literal("active"), at_bookmark: v.string() }),
      v.object({
        status: v.literal("complete"),
        at_bookmark: v.optional(v.string()),
        result: v.object({ filename: v.string(), signed_url: v.string() }),
      }),
      v.object({ status: v.literal("error"), error: v.optional(v.string(), "") }),
    ]),
  ),
});

function refusal(status: number): D1BackupError {
  if (status === 401 || status === 403) {
    return new D1BackupError("auth", `Cloudflare refused the API token (HTTP ${status}) — it is invalid, or lacks Account → D1 → Edit`, { status });
  }
  if (status === 404) return new D1BackupError("not-found", "no D1 database with that id in that account (HTTP 404)", { status });
  return new D1BackupError("refused", `the D1 export request failed (HTTP ${status})`, { status });
}

// Neither the token nor a signed URL ever reaches an error message: a Workflow records them.
/** Starts a D1 export, or polls the one running at `bookmark`. @internal */
export async function requestD1Export(options: D1BackupOptions, bookmark: string | null): Promise<D1ExportState> {
  const fetchFn = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const url = `${API}/accounts/${encodeURIComponent(options.accountId)}/d1/database/${encodeURIComponent(options.databaseId)}/export`;
  const body = { output_format: "polling", ...(bookmark === null ? {} : { current_bookmark: bookmark }) };
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${options.apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new D1BackupError("refused", "the D1 export request failed: network error");
  }
  if (!res.ok) throw refusal(res.status);
  const parsed = v.safeParse(EXPORT_REPLY, await res.json().catch(() => null));
  if (!parsed.success || !parsed.output.success || parsed.output.result == null) {
    throw new D1BackupError("malformed", "the D1 export reply was not the shape Cloudflare documents", { status: res.status });
  }
  const state = parsed.output.result;
  if (state.status === "active") return { status: "active", bookmark: state.at_bookmark };
  if (state.status === "error") return { status: "error", error: state.error };
  return { status: "complete", bookmark: state.at_bookmark ?? null, signedUrl: state.result.signed_url };
}
