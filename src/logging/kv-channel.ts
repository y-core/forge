import type { KVNamespace } from "../storage/kv/types";
import type { LogChannel, LogRecord } from "./types";

/** @public */
export interface KvLogChannelOptions {
  prefix?: string;
  defaultTtl?: number;
  maxLogs?: number;
  highWater?: number;
  purgeProbability?: number;
}

/** Metadata stored alongside each KV log entry for zero-cost viewer listing. @public */
export interface KvLogMetadata {
  level: string;
  prefix: string;
  requestId?: string;
  message: string;
  timestamp: string;
}

const DEFAULT_PREFIX = "logs";
const DEFAULT_TTL = 60 * 60 * 24 * 7; // 7 days
const DEFAULT_MAX_LOGS = 500;
const DEFAULT_PURGE_PROBABILITY = 0.02;
const PURGE_BATCH = 20;

/**
 * Async log channel that writes records to Cloudflare KV with time-ordered keys.
 * Keys are `{prefix}||{isoTimestamp}||{rand}`, enabling lexicographic oldest-first listing.
 * Metadata is stored alongside each entry so the viewer can list rows without per-row reads.
 * A probabilistic high/low-water purge keeps total entry count bounded. @public
 */
export function kvLogChannel(kv: KVNamespace, options?: KvLogChannelOptions): LogChannel {
  const prefix = options?.prefix ?? DEFAULT_PREFIX;
  const defaultTtl = options?.defaultTtl ?? DEFAULT_TTL;
  const maxLogs = options?.maxLogs ?? DEFAULT_MAX_LOGS;
  const highWater = options?.highWater ?? Math.floor(maxLogs * 1.2);
  const purgeProbability = options?.purgeProbability ?? DEFAULT_PURGE_PROBABILITY;
  const listPrefix = `${prefix}||`;

  return async (record: LogRecord): Promise<void> => {
    const rand = Math.random().toString(36).slice(2, 8);
    const key = `${listPrefix}${record.timestamp}||${rand}`;

    const metadata: KvLogMetadata = {
      level: record.level,
      prefix: record.prefix,
      message: record.message,
      timestamp: record.timestamp,
      ...(record.data?.requestId !== undefined
        ? { requestId: String(record.data.requestId) }
        : {}),
    };

    const putPromise = kv.put(key, JSON.stringify(record), {
      expirationTtl: defaultTtl,
      metadata,
    });

    if (Math.random() >= purgeProbability) {
      return putPromise;
    }

    await Promise.all([putPromise, purge(kv, listPrefix, maxLogs, highWater)]);
    return undefined;
  };
}

async function purge(
  kv: KVNamespace,
  listPrefix: string,
  maxLogs: number,
  highWater: number,
): Promise<void> {
  const result = await kv.list({ prefix: listPrefix });
  if (result.keys.length <= highWater) return;

  const deleteCount = result.keys.length - maxLogs;
  if (deleteCount <= 0) return;

  const toDelete = result.keys.slice(0, deleteCount);
  for (let i = 0; i < toDelete.length; i += PURGE_BATCH) {
    const batch = toDelete.slice(i, i + PURGE_BATCH);
    await Promise.all(batch.map((k) => kv.delete(k.name)));
  }
}
