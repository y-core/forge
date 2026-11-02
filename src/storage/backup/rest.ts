import { v } from "../../validation/mod";
import { D1BackupError } from "./errors";
import type { CloudflareAccess } from "./types";

const API = "https://api.cloudflare.com/client/v4";

const REQUEST_TIMEOUT_MS = 30_000;

const ENVELOPE = v.object({ success: v.boolean(), result: v.unknown(), errors: v.optional(v.array(v.object({ message: v.string() })), []) });

function refusal(status: number, what: string): D1BackupError {
  if (status === 401 || status === 403) {
    return new D1BackupError("auth", `Cloudflare refused the API token (HTTP ${status}) — it is invalid, or lacks Account → D1 → Edit`, { status });
  }
  if (status === 404) return new D1BackupError("not-found", "no D1 database with that id in that account (HTTP 404)", { status });
  return new D1BackupError("refused", `the D1 ${what} request failed (HTTP ${status})`, { status });
}

// The token never reaches an error message, and neither does a reply's body: a Workflow records both.
/** Calls one D1 REST endpoint under the account, answering the envelope's `result`. @internal */
export async function callD1Api(access: CloudflareAccess, what: string, path: string, body?: unknown): Promise<unknown> {
  const fetchFn = access.fetch ?? ((input, init) => globalThis.fetch(input, init));
  let res: Response;
  try {
    res = await fetchFn(`${API}/accounts/${encodeURIComponent(access.accountId)}/d1/database${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${access.apiToken}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new D1BackupError("refused", `the D1 ${what} request failed: network error`);
  }
  if (!res.ok) throw refusal(res.status, what);
  const parsed = v.safeParse(ENVELOPE, await res.json().catch(() => null));
  if (!parsed.success || !parsed.output.success) {
    throw new D1BackupError("malformed", `the D1 ${what} reply was not the shape Cloudflare documents`, { status: res.status });
  }
  return parsed.output.result;
}

/** The path of one database under the account's D1 API. @internal */
export function databasePath(databaseId: string, action = ""): string {
  return `/${encodeURIComponent(databaseId)}${action === "" ? "" : `/${action}`}`;
}
