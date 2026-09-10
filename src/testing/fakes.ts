import type { AssetsFetcher } from "../app/types";
import type { D1DatabaseLike, D1PreparedStatement, D1Result } from "../storage/db/types";
import type { KVListOptions, KVListResult, KVNamespace, KVPutOptions } from "../storage/kv/types";
import { UnsatisfiableRangeError } from "../storage/r2/errors";
import type { R2BucketLike, R2ListLike, R2ObjectBodyLike, R2ObjectLike, R2PutLike } from "../storage/r2/types";
import type { FakeD1Options, FakeKVOptions } from "./types";

/** The floor a real KV binding enforces on `expirationTtl` (STORAGE_BINDINGS §2c). */
const KV_EXPIRATION_TTL_MIN = 60;

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

interface StoredEntry {
  bytes: Uint8Array;
  metadata?: unknown;
  expiration?: number;
}

/** Resolves the absolute unix-seconds expiry a real KV binding would record for a write. */
function resolveExpiration(now: number, options?: KVPutOptions): number | undefined {
  if (options?.expiration !== undefined) return options.expiration;
  if (options?.expirationTtl !== undefined) return now + options.expirationTtl;
  return undefined;
}

/** In-memory `KVNamespace` fake backed by a per-instance `Map` of raw bytes, honouring `expirationTtl` and `expiration` against an injectable clock. @public */
export function fakeKV(seed?: Record<string, string>, { now }: FakeKVOptions = {}): KVNamespace {
  const data = new Map<string, StoredEntry>(Object.entries(seed ?? {}).map(([k, v]) => [k, { bytes: TEXT_ENCODER.encode(v) }]));
  const clock = now ?? Date.now;
  const seconds = (): number => Math.floor(clock() / 1000);

  // An expired key is gone from a real KV, not merely unreadable — dropping it here keeps `list`
  // and every read agreeing on that without a second expiry check per operation.
  function live(key: string): StoredEntry | undefined {
    const entry = data.get(key);
    if (!entry) return undefined;
    if (entry.expiration !== undefined && entry.expiration <= seconds()) {
      data.delete(key);
      return undefined;
    }
    return entry;
  }

  function read(key: string, type: "text" | "arrayBuffer"): string | ArrayBuffer | null {
    const entry = live(key);
    if (!entry) return null;
    return type === "text" ? TEXT_DECODER.decode(entry.bytes) : (entry.bytes.slice().buffer as ArrayBuffer);
  }

  const impl = {
    delete: async (key: string): Promise<void> => {
      data.delete(key);
    },
    get: async (key: string, options: { type: "text" | "arrayBuffer" }) => read(key, options.type),
    getWithMetadata: async (key: string, options: { type: "text" | "arrayBuffer" }) => ({
      value: read(key, options.type),
      metadata: live(key)?.metadata ?? null,
    }),
    put: async (key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream, options?: KVPutOptions): Promise<void> => {
      if (options?.expirationTtl !== undefined && options.expirationTtl < KV_EXPIRATION_TTL_MIN) {
        throw new Error(`KV put: expirationTtl must be at least ${KV_EXPIRATION_TTL_MIN} seconds, received ${options.expirationTtl}`);
      }
      // Decoding to a string here would replace every invalid UTF-8 sequence with U+FFFD
      // and silently corrupt binary values.
      const bytes = await toBytes(value);
      const expiration = resolveExpiration(seconds(), options);
      data.set(key, {
        bytes,
        ...(options?.metadata !== undefined ? { metadata: options.metadata } : {}),
        ...(expiration !== undefined ? { expiration } : {}),
      });
    },
    list: async <M = unknown>(options?: KVListOptions): Promise<KVListResult<M>> => {
      let names = [...data.keys()].sort().filter((n) => live(n) !== undefined);
      if (options?.prefix) names = names.filter((n) => n.startsWith(options.prefix as string));
      const start = options?.cursor !== undefined ? Number.parseInt(options.cursor, 10) : 0;
      const limit = options?.limit ?? names.length;
      const page = names.slice(start, start + limit);
      const next = start + page.length;
      const complete = next >= names.length;
      const keys = page.map((name) => {
        const entry = data.get(name);
        return {
          name,
          metadata: (entry?.metadata ?? undefined) as M,
          ...(entry?.expiration !== undefined ? { expiration: entry.expiration } : {}),
        };
      });
      return complete ? { keys, list_complete: true } : { keys, list_complete: false, cursor: String(next) };
    },
  };
  return impl as unknown as KVNamespace;
}

/** `AssetsFetcher` fake serving from an in-memory path→body map, `404` for anything else. @public */
export function fakeAssetsFetcher(files: Record<string, string>): AssetsFetcher {
  return {
    fetch: async (req: Request): Promise<Response> => {
      const path = new URL(req.url).pathname;
      const body = files[path];
      return body !== undefined ? new Response(body, { status: 200 }) : new Response("Not Found", { status: 404 });
    },
  };
}

interface StoredR2Entry {
  bytes: Uint8Array;
  etag: string;
  uploaded: Date;
  httpMetadata?: R2PutLike["httpMetadata"];
  customMetadata?: Record<string, string>;
}

/** Deterministic djb2 content hash rendered as hex — a stand-in for an R2 etag. */
function hashBytes(bytes: Uint8Array): string {
  let h = 5381;
  for (const b of bytes) h = ((h << 5) + h + b) >>> 0;
  return h.toString(16).padStart(8, "0");
}

async function toBytes(value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob): Promise<Uint8Array> {
  if (value === null) return new Uint8Array();
  if (typeof value === "string") return TEXT_ENCODER.encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  if (value instanceof ReadableStream) {
    const reader = value.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      chunks.push(chunk);
      total += chunk.length;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function toR2Object(key: string, entry: StoredR2Entry): R2ObjectLike {
  return {
    key,
    size: entry.bytes.byteLength,
    etag: entry.etag,
    httpEtag: `"${entry.etag}"`,
    uploaded: entry.uploaded,
    ...(entry.httpMetadata ? { httpMetadata: entry.httpMetadata } : {}),
    ...(entry.customMetadata ? { customMetadata: entry.customMetadata } : {}),
  };
}

interface R2GetLike {
  range?: { offset?: number; length?: number; suffix?: number };
}

/** Resolves an R2 range option to a `[start, end)` byte window clamped to the object size. */
function resolveRange(key: string, size: number, range?: R2GetLike["range"]): { start: number; end: number } {
  if (!range) return { start: 0, end: size };
  if (range.suffix !== undefined) return { start: Math.max(0, size - range.suffix), end: size };
  const offset = Math.max(range.offset ?? 0, 0);
  // A range wholly outside the object is what R2 refuses; an overrun is what it clamps.
  if (offset >= size && !(offset === 0 && size === 0)) throw new UnsatisfiableRangeError(key, { size });
  const start = Math.min(offset, size);
  const end = range.length !== undefined ? Math.min(start + range.length, size) : size;
  return { start, end: Math.max(start, end) };
}

/** Functional in-memory `R2BucketLike` fake supporting `put`/`get`/`head`/`delete`/`list` with ranged reads and cursor pagination. @public */
export function fakeR2(seed?: Record<string, string>): R2BucketLike {
  const data = new Map<string, StoredR2Entry>(
    Object.entries(seed ?? {}).map(([k, v]) => {
      const bytes = TEXT_ENCODER.encode(v);
      return [k, { bytes, etag: hashBytes(bytes), uploaded: new Date() }];
    }),
  );

  const impl = {
    put: async (
      key: string,
      value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
      options?: R2PutLike,
    ): Promise<R2ObjectLike> => {
      const bytes = await toBytes(value);
      const entry: StoredR2Entry = {
        bytes,
        etag: hashBytes(bytes),
        uploaded: new Date(),
        ...(options?.httpMetadata ? { httpMetadata: options.httpMetadata } : {}),
        ...(options?.customMetadata ? { customMetadata: options.customMetadata } : {}),
      };
      data.set(key, entry);
      return toR2Object(key, entry);
    },
    get: async (key: string, options?: R2GetLike): Promise<R2ObjectBodyLike | null> => {
      const entry = data.get(key);
      if (!entry) return null;
      const { start, end } = resolveRange(key, entry.bytes.byteLength, options?.range);
      const bytes = entry.bytes.subarray(start, end);
      let used = false;
      return {
        // R2 reports `size` as the whole object even for a ranged read, and `serveObject`
        // builds the `Content-Range` total from it.
        ...toR2Object(key, entry),
        get body(): ReadableStream {
          used = true;
          return new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(bytes));
              controller.close();
            },
          });
        },
        get bodyUsed(): boolean {
          return used;
        },
        arrayBuffer: async (): Promise<ArrayBuffer> => {
          used = true;
          return new Uint8Array(bytes).buffer;
        },
        text: async (): Promise<string> => {
          used = true;
          return TEXT_DECODER.decode(bytes);
        },
        blob: async (): Promise<Blob> => {
          used = true;
          return new Blob([new Uint8Array(bytes)]);
        },
      };
    },
    head: async (key: string): Promise<R2ObjectLike | null> => {
      const entry = data.get(key);
      return entry ? toR2Object(key, entry) : null;
    },
    delete: async (keys: string | string[]): Promise<void> => {
      for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
    },
    list: async (options?: {
      prefix?: string;
      limit?: number;
      cursor?: string;
      delimiter?: string;
      include?: readonly ("httpMetadata" | "customMetadata")[];
    }): Promise<R2ListLike> => {
      const prefix = options?.prefix ?? "";
      let names = [...data.keys()].sort().filter((n) => n.startsWith(prefix));

      const prefixes: string[] = [];
      if (options?.delimiter !== undefined && options.delimiter !== "") {
        const delimiter = options.delimiter;
        const collapsed = new Set<string>();
        names = names.filter((name) => {
          const at = name.indexOf(delimiter, prefix.length);
          if (at === -1) return true;
          collapsed.add(name.slice(0, at + delimiter.length));
          return false;
        });
        prefixes.push(...[...collapsed].sort());
      }

      // A page spans keys and collapsed prefixes together, which is how R2 pages a delimited list.
      const entries: { name: string; isPrefix: boolean }[] = [
        ...names.map((name) => ({ name, isPrefix: false })),
        ...prefixes.map((name) => ({ name, isPrefix: true })),
      ];
      const start = options?.cursor !== undefined ? Number.parseInt(options.cursor, 10) : 0;
      const limit = options?.limit ?? entries.length;
      const page = entries.slice(start, start + limit);
      const next = start + page.length;
      const truncated = next < entries.length;

      const include = options?.include ?? ["httpMetadata", "customMetadata"];
      const objects = page
        .filter((entry) => !entry.isPrefix)
        .map((entry) => {
          const obj = toR2Object(entry.name, data.get(entry.name) as StoredR2Entry);
          if (!include.includes("httpMetadata")) delete obj.httpMetadata;
          if (!include.includes("customMetadata")) delete obj.customMetadata;
          return obj;
        });
      const delimitedPrefixes = page.filter((entry) => entry.isPrefix).map((entry) => entry.name);

      return {
        objects,
        ...(truncated ? { truncated: true as const, cursor: String(next) } : { truncated: false as const }),
        ...(delimitedPrefixes.length > 0 ? { delimitedPrefixes } : {}),
      };
    },
  };
  return impl as unknown as R2BucketLike;
}

interface FakeD1Statement extends D1PreparedStatement {
  readonly sql: string;
  readonly params: unknown[];
}

/** Programmable `D1DatabaseLike` stub whose `query` responder supplies results and whose `calls` array records every bound statement. @public */
export function fakeD1(
  query: (sql: string, params: unknown[]) => unknown[] = () => [],
  options?: FakeD1Options,
): D1DatabaseLike & { calls: { sql: string; params: unknown[] }[] } {
  const calls: { sql: string; params: unknown[] }[] = [];

  function failIfInjected(sql: string, params: unknown[]): void {
    const failure = options?.failOn?.(sql, params);
    if (failure) throw failure;
  }

  function statement(sql: string, params: unknown[]): FakeD1Statement {
    return {
      sql,
      params,
      bind: (...values: unknown[]): D1PreparedStatement => {
        calls.push({ sql, params: values });
        return statement(sql, values);
      },
      all: async <T = unknown>(): Promise<D1Result<T>> => {
        failIfInjected(sql, params);
        const results = query(sql, params) as T[];
        return { results, success: true, meta: { duration: 0, rows_read: results.length } };
      },
      first: async <T = unknown>(column?: string): Promise<T | null> => {
        failIfInjected(sql, params);
        const row = query(sql, params)[0];
        if (row === undefined || row === null) return null;
        if (column === undefined) return row as T;
        // A real D1 rejects an unknown column; returning `undefined` would be doubly wrong, since
        // the declared return is `T | null`.
        if (typeof row !== "object" || !Object.hasOwn(row as object, column)) {
          throw new Error(`D1_ERROR: no such column: ${column}`);
        }
        return (row as Record<string, unknown>)[column] as T;
      },
      run: async (): Promise<D1Result<unknown>> => {
        failIfInjected(sql, params);
        const written = options?.rowsWritten?.(sql, params) ?? 0;
        return { results: [], success: true, meta: { rows_written: written, changes: written, last_row_id: 0, duration: 0 } };
      },
    };
  }

  return {
    calls,
    prepare: (sql: string): D1PreparedStatement => statement(sql, []),
    batch: async <T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> =>
      statements.map((s) => {
        const fs = s as FakeD1Statement;
        failIfInjected(fs.sql, fs.params);
        const written = options?.rowsWritten?.(fs.sql, fs.params) ?? 0;
        return { results: query(fs.sql, fs.params) as T[], success: true, meta: { duration: 0, rows_written: written, changes: written } };
      }),
    exec: async (sql: string): Promise<{ count: number; duration: number }> => {
      failIfInjected(sql, []);
      return { count: 0, duration: 0 };
    },
  };
}
