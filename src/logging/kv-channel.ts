import { bytesToHex, randomBytes } from "../crypto/primitives/mod";
import type { KVNamespaceLike } from "../storage/kv/types";
import { cloneLogValue } from "./log-clone";
import type { KvLogChannelOptions, KvLogMetadata, LogChannel, LogQuery, LogReadResult, LogRecord, LogRow } from "./types";
import { parseLogLevel } from "./types";

const DEFAULT_PREFIX = "logs";
const DEFAULT_TTL = 60 * 60 * 24 * 7;
const DEFAULT_MAX_LOGS = 500;
const DEFAULT_PURGE_PROBABILITY = 0.02;
const PURGE_BATCH = 20;
const PURGE_LIST_LIMIT = 1000;
const DEFAULT_LIMIT = 50;

const INVERSION_BASE = 999_999_999_999_999;
const INVERTED_WIDTH = 15;

function invertTimestamp(iso: string): string {
  const parsed = Date.parse(iso);
  const ms = Number.isNaN(parsed) ? Date.now() : parsed;
  const bounded = Math.min(Math.max(ms, 0), INVERSION_BASE);
  return String(INVERSION_BASE - bounded).padStart(INVERTED_WIDTH, "0");
}

function toPersistable(value: unknown, keepStacks: boolean): unknown {
  return cloneLogValue(value, (key) => (keepStacks || key !== "stack" ? "keep" : "remove"));
}

const METADATA_BYTE_LIMIT = 1024;
const MESSAGE_CODE_POINTS_MAX = 256;
const PREFIX_CODE_POINTS_MAX = 128;
const REQUEST_ID_CODE_POINTS_MAX = 64;

function truncateCodePoints(value: string, max: number): string {
  return [...value].slice(0, max).join("");
}

function serializedBytes(metadata: KvLogMetadata): number {
  return new TextEncoder().encode(JSON.stringify(metadata)).length;
}

function largestFitting(build: (count: number) => KvLogMetadata, max: number): number {
  let low = 0;
  let high = max;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (serializedBytes(build(mid)) <= METADATA_BYTE_LIMIT) low = mid;
    else high = mid - 1;
  }
  return low;
}

function boundMetadata(record: LogRecord): KvLogMetadata {
  const requestId = truncateCodePoints(record.data?.requestId != null ? String(record.data.requestId) : "", REQUEST_ID_CODE_POINTS_MAX);

  const build = (messageCount: number, prefixCount: number, withRequestId: boolean): KvLogMetadata => ({
    level: record.level,
    prefix: truncateCodePoints(record.prefix, prefixCount),
    message: truncateCodePoints(record.message, messageCount),
    timestamp: record.timestamp,
    ...(withRequestId && requestId ? { requestId } : {}),
  });

  const full = build(MESSAGE_CODE_POINTS_MAX, PREFIX_CODE_POINTS_MAX, true);
  if (serializedBytes(full) <= METADATA_BYTE_LIMIT) return full;

  const messageCount = largestFitting((count) => build(count, PREFIX_CODE_POINTS_MAX, true), MESSAGE_CODE_POINTS_MAX);
  const shrunkMessage = build(messageCount, PREFIX_CODE_POINTS_MAX, true);
  if (serializedBytes(shrunkMessage) <= METADATA_BYTE_LIMIT) return shrunkMessage;

  const prefixCount = largestFitting((count) => build(0, count, true), PREFIX_CODE_POINTS_MAX);
  const shrunkPrefix = build(0, prefixCount, true);
  if (serializedBytes(shrunkPrefix) <= METADATA_BYTE_LIMIT) return shrunkPrefix;

  return { level: record.level, timestamp: record.timestamp };
}

/** Log channel that writes records to Cloudflare KV under time-ordered keys and reads them back. @public */
export function kvLogChannel<NS extends KVNamespaceLike = KVNamespaceLike>(kv: NS, options?: KvLogChannelOptions): LogChannel {
  const prefix = options?.prefix ?? DEFAULT_PREFIX;
  const defaultTtl = options?.defaultTtl ?? DEFAULT_TTL;
  const maxLogs = options?.maxLogs ?? DEFAULT_MAX_LOGS;
  const highWater = options?.highWater ?? Math.floor(maxLogs * 1.2);
  const purgeProbability = options?.purgeProbability ?? DEFAULT_PURGE_PROBABILITY;
  const persistStack = options?.persistStack ?? false;
  const listPrefix = `${prefix}||`;

  return {
    async write(record: LogRecord): Promise<void> {
      // KV is last-write-wins: a same-millisecond key collision silently drops a log line.
      const rand = bytesToHex(randomBytes(4));
      const key = `${listPrefix}${invertTimestamp(record.timestamp)}||${rand}`;

      const metadata = boundMetadata(record);

      const persisted =
        record.data === undefined ? record : { ...record, data: toPersistable(record.data, persistStack) as Record<string, unknown> };

      const putPromise = kv.put(key, JSON.stringify(persisted), { expirationTtl: defaultTtl, metadata });

      if (Math.random() >= purgeProbability) {
        return putPromise;
      }

      const purgePromise = purge(kv, listPrefix, maxLogs, highWater);
      // `allSettled`, not `all`: `all` would settle on the put's rejection and let the isolate cancel the in-flight purge.
      const [put, purged] = await Promise.allSettled([putPromise, purgePromise]);
      if (put.status === "rejected") throw put.reason;
      if (purged.status === "rejected") throw purged.reason;
    },

    async read(query?: LogQuery): Promise<LogReadResult> {
      const limit = query?.limit ?? DEFAULT_LIMIT;
      const result = await kv.list<KvLogMetadata>({ prefix: listPrefix, limit, ...(query?.cursor ? { cursor: query.cursor } : {}) });

      let rows: LogRow[] = result.keys
        .filter((k) => k.metadata !== undefined && k.metadata !== null)
        .map((k) => ({
          key: k.name,
          level: parseLogLevel(k.metadata?.level, "info"),
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
    },

    async readEntry(key: string): Promise<LogRecord | null> {
      // Prefix-scoped: without this the viewer is an arbitrary-KV read oracle via a crafted key.
      if (!key.startsWith(listPrefix)) return null;
      const value = await kv.get(key, { type: "text" });
      if (value === null) return null;
      try {
        return JSON.parse(value) as LogRecord;
      } catch {
        return null;
      }
    },
  };
}

async function purge(kv: KVNamespaceLike, listPrefix: string, maxLogs: number, highWater: number): Promise<void> {
  const result = await kv.list({ prefix: listPrefix, limit: PURGE_LIST_LIMIT });
  if (result.keys.length <= highWater) return;

  const deleteCount = result.keys.length - maxLogs;
  if (deleteCount <= 0) return;

  const toDelete = result.keys.slice(maxLogs);
  const failed: { name: string; reason: unknown }[] = [];
  for (let i = 0; i < toDelete.length; i += PURGE_BATCH) {
    const batch = toDelete.slice(i, i + PURGE_BATCH);
    const settled = await Promise.allSettled(batch.map((k) => kv.delete(k.name)));
    settled.forEach((outcome, j) => {
      if (outcome.status === "rejected") failed.push({ name: batch[j]?.name ?? "", reason: outcome.reason });
    });
  }
  if (failed.length === 0) return;
  throw new AggregateError(
    failed.map((f) => f.reason),
    `kvLogChannel: purge could not delete ${failed.map((f) => f.name).join(", ")}`,
  );
}
