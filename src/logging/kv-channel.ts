import { bytesToHex, randomBytes } from "../crypto/mod";
import type { KVNamespace } from "../storage/kv/types";
import type { KvLogChannelOptions, KvLogMetadata, LogChannel, LogQuery, LogReadResult, LogRecord, LogRow } from "./types";

const DEFAULT_PREFIX = "logs";
const DEFAULT_TTL = 60 * 60 * 24 * 7; // 7 days
const DEFAULT_MAX_LOGS = 500;
const DEFAULT_PURGE_PROBABILITY = 0.02;
const PURGE_BATCH = 20;
const DEFAULT_LIMIT = 50;

/**
 * Async log channel that writes records to Cloudflare KV with time-ordered keys and reads
 * them back via the same key convention. Keys are `{prefix}||{isoTimestamp}||{rand}`,
 * enabling lexicographic oldest-first listing. Metadata is stored alongside each entry so
 * the viewer can list rows without per-row reads. A probabilistic high/low-water purge provides
 * a best-effort soft cap; the TTL is the hard backstop. @public
 */
export function kvLogChannel(kv: KVNamespace, options?: KvLogChannelOptions): LogChannel {
  const prefix = options?.prefix ?? DEFAULT_PREFIX;
  const defaultTtl = options?.defaultTtl ?? DEFAULT_TTL;
  const maxLogs = options?.maxLogs ?? DEFAULT_MAX_LOGS;
  const highWater = options?.highWater ?? Math.floor(maxLogs * 1.2);
  const purgeProbability = options?.purgeProbability ?? DEFAULT_PURGE_PROBABILITY;
  const listPrefix = `${prefix}||`;

  return {
    async write(record: LogRecord): Promise<void> {
      // Crypto-random suffix (8 hex chars / 32 bits) so two records written in the same millisecond
      // do not collide on the same KV key — KV is last-write-wins, and a collision silently drops a
      // log line. `Math.random()` (≈31 bits, non-uniform across runtimes) made that more likely.
      const rand = bytesToHex(randomBytes(4));
      const key = `${listPrefix}${record.timestamp}||${rand}`;

      const safeMessage = record.message.slice(0, 256);
      const safeRequestId = (record.data?.requestId != null ? String(record.data.requestId) : "").slice(0, 64);

      const metadata: KvLogMetadata = {
        level: record.level,
        prefix: record.prefix,
        message: safeMessage,
        timestamp: record.timestamp,
        ...(safeRequestId ? { requestId: safeRequestId } : {}),
      };

      const putPromise = kv.put(key, JSON.stringify(record), { expirationTtl: defaultTtl, metadata });

      if (Math.random() >= purgeProbability) {
        return putPromise;
      }

      void purge(kv, listPrefix, maxLogs, highWater).catch(() => {});
      return putPromise;
    },

    async read(query?: LogQuery): Promise<LogReadResult> {
      const limit = query?.limit ?? DEFAULT_LIMIT;
      const result = await kv.list<KvLogMetadata>({ prefix: listPrefix, limit, ...(query?.cursor ? { cursor: query.cursor } : {}) });

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
    },
  };
}

async function purge(kv: KVNamespace, listPrefix: string, maxLogs: number, highWater: number): Promise<void> {
  // Purge is probabilistic and best-effort; the TTL is the hard backstop against unbounded growth.
  const result = await kv.list({ prefix: listPrefix, limit: 1000 });
  if (result.keys.length <= highWater) return;

  const deleteCount = result.keys.length - maxLogs;
  if (deleteCount <= 0) return;

  const toDelete = result.keys.slice(0, deleteCount);
  for (let i = 0; i < toDelete.length; i += PURGE_BATCH) {
    const batch = toDelete.slice(i, i + PURGE_BATCH);
    await Promise.all(batch.map((k) => kv.delete(k.name)));
  }
}
