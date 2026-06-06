import type { KVNamespace } from "../../storage/kv/types";
import type { KvLogMetadata, LogLevel } from "../types";

/** A single log row as returned by the viewer reader. @public */
export interface LogRow {
  key: string;
  level: string;
  prefix: string;
  requestId?: string;
  message: string;
  timestamp: string;
}

/** Query parameters for reading logs. @public */
export interface LogQuery {
  prefix?: string;
  level?: LogLevel;
  q?: string;
  cursor?: string;
  limit?: number;
}

/** Result of a readLogs call including rows and an optional pagination cursor. @public */
export interface LogReadResult {
  rows: LogRow[];
  cursor?: string;
  complete: boolean;
}

const DEFAULT_LIMIT = 50;

/**
 * Reads log rows from KV using list metadata (no per-row get).
 * Filters (level, q) are applied page-locally since KV only lists by key prefix. @public
 */
export async function readLogs(kv: KVNamespace, query?: LogQuery): Promise<LogReadResult> {
  const kvPrefix = query?.prefix ? `${query.prefix}||` : "logs||";
  const limit = query?.limit ?? DEFAULT_LIMIT;

  const result = await kv.list<KvLogMetadata>({ prefix: kvPrefix, limit, ...(query?.cursor ? { cursor: query.cursor } : {}) });

  let rows: LogRow[] = result.keys
    .filter((k) => k.metadata !== undefined && k.metadata !== null)
    .map((k) => ({
      key: k.name,
      level: k.metadata?.level ?? "info",
      prefix: k.metadata?.prefix ?? "",
      message: k.metadata?.message ?? "",
      timestamp: k.metadata?.timestamp ?? "",
      ...(k.metadata?.requestId ? { requestId: k.metadata.requestId } : {}),
    }));

  if (query?.level) {
    const level = query.level;
    rows = rows.filter((r) => r.level === level);
  }

  if (query?.q) {
    const term = query.q.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.message.toLowerCase().includes(term) || r.prefix.toLowerCase().includes(term) || (r.requestId?.toLowerCase().includes(term) ?? false),
    );
  }

  return { rows, complete: result.list_complete, ...(result.cursor ? { cursor: result.cursor } : {}) };
}
