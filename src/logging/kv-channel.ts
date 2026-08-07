import { bytesToHex, randomBytes } from "../crypto/mod";
import type { KVNamespaceLike } from "../storage/kv/types";
import type { KvLogChannelOptions, KvLogMetadata, LogChannel, LogQuery, LogReadResult, LogRecord, LogRow } from "./types";

const DEFAULT_PREFIX = "logs";
const DEFAULT_TTL = 60 * 60 * 24 * 7; // 7 days
const DEFAULT_MAX_LOGS = 500;
const DEFAULT_PURGE_PROBABILITY = 0.02;
const PURGE_BATCH = 20;
// A single purge pass only sees the first PURGE_LIST_LIMIT keys under the prefix; the TTL is the
// hard backstop for anything beyond that window.
const PURGE_LIST_LIMIT = 1000;
const DEFAULT_LIMIT = 50;
// Substituted for a value already open on the current path, so a self-referential structure
// terminates instead of recursing until the stack overflows.
const CIRCULAR_MARKER = "[circular]";

/**
 * Deep-clones `value` into a shape `JSON.stringify` preserves, so structured context survives the
 * trip into KV. `Date`, `Map` and `Set` hold their payload outside enumerable own properties — a
 * property-wise clone flattens all three to `{}` — so each gets an explicit form: an ISO 8601
 * string, and tagged lists that rebuild with `new Map(entries)` / `new Set(values)`. A reference
 * that reappears on its own path becomes `CIRCULAR_MARKER`. When `keepStacks` is false, any
 * property named `stack` is dropped along the way so error stacks never reach KV persistence.
 * Never mutates the input. @internal
 */
function toPersistable(value: unknown, keepStacks: boolean): unknown {
  const openPath = new WeakSet<object>();

  function walk(input: unknown): unknown {
    if (input === null || typeof input !== "object") return input;
    // An invalid Date has no representable instant, and `toISOString` would throw on the log path.
    if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input.toISOString();
    if (openPath.has(input)) return CIRCULAR_MARKER;

    openPath.add(input);
    try {
      if (Array.isArray(input)) return input.map((item) => walk(item));
      if (input instanceof Map) return { type: "Map", entries: [...input].map(([key, val]) => [walk(key), walk(val)]) };
      if (input instanceof Set) return { type: "Set", values: [...input].map((item) => walk(item)) };
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .filter(([key]) => keepStacks || key !== "stack")
          .map(([key, val]) => [key, walk(val)]),
      );
    } finally {
      // Released on the way out: the same object appearing twice as siblings is not a cycle.
      openPath.delete(input);
    }
  }

  return walk(value);
}

/**
 * Async log channel that writes records to Cloudflare KV with time-ordered keys and reads
 * them back via the same key convention. Keys are `{prefix}||{isoTimestamp}||{rand}`,
 * enabling lexicographic oldest-first listing. Metadata is stored alongside each entry so
 * the viewer can list rows without per-row reads. A probabilistic high/low-water purge provides
 * a best-effort soft cap; the TTL is the hard backstop. Best-effort means probabilistic and
 * error-swallowing — not untracked: when the purge branch is selected, `write`'s promise covers it,
 * so `flush()`/`waitUntil()` hold the isolate open until the sweep finishes. @public
 */
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

      // Normalize a clone of the record's data for persistence — the caller's record is never
      // mutated (consoleChannel keeps the original, stacks included, for local debugging).
      const persisted =
        record.data === undefined ? record : { ...record, data: toPersistable(record.data, persistStack) as Record<string, unknown> };

      const putPromise = kv.put(key, JSON.stringify(persisted), { expirationTtl: defaultTtl, metadata });

      if (Math.random() >= purgeProbability) {
        return putPromise;
      }

      // The purge joins the returned promise so `Logger.flush()` and `executionCtx.waitUntil()` keep
      // the isolate alive until it settles — a detached purge can be cancelled mid-pass when the
      // tracked work finishes first. Its own rejection stays swallowed: a failed sweep must never
      // reject a log write.
      const purgePromise = purge(kv, listPrefix, maxLogs, highWater).catch(() => {});
      // `allSettled`, not `all`: `all` rejects the instant the put does, which stops the returned
      // promise covering the still-running sweep — the detached-purge cancellation this branch
      // exists to prevent, in the one case a sweep is most likely to be mid-flight. The put's
      // rejection is then rethrown, because only a failure of the record write itself may reject
      // (see README "A promise returned by `write` must cover every operation the write starts").
      const [put] = await Promise.allSettled([putPromise, purgePromise]);
      if (put.status === "rejected") throw put.reason;
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

    async readEntry(key: string): Promise<LogRecord | null> {
      // Only keys under this channel's prefix are readable — the viewer must not become
      // an arbitrary-KV read oracle via a crafted detail key.
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
  // Purge is probabilistic and best-effort; the TTL is the hard backstop against unbounded growth.
  const result = await kv.list({ prefix: listPrefix, limit: PURGE_LIST_LIMIT });
  if (result.keys.length <= highWater) return;

  const deleteCount = result.keys.length - maxLogs;
  if (deleteCount <= 0) return;

  const toDelete = result.keys.slice(0, deleteCount);
  for (let i = 0; i < toDelete.length; i += PURGE_BATCH) {
    const batch = toDelete.slice(i, i + PURGE_BATCH);
    await Promise.all(batch.map((k) => kv.delete(k.name)));
  }
}
