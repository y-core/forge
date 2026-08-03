import type { AssetsFetcher } from "../app/types";
import type { D1DatabaseLike, D1PreparedStatement, D1Result } from "../storage/db/types";
import type { KVListOptions, KVListResult, KVNamespace, KVPutOptions } from "../storage/kv/types";
import type { R2BucketLike, R2ListLike, R2ObjectBodyLike, R2ObjectLike, R2PutLike } from "../storage/r2/types";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

interface StoredEntry {
  bytes: Uint8Array;
  metadata?: unknown;
  expiration?: number;
}

/**
 * Resolves the absolute expiry a real KV binding would record for a write: an explicit
 * `expiration` is stored as given, while a relative `expirationTtl` is converted to unix
 * seconds at write time — the same translation the platform performs before surfacing the
 * value on `list`.
 */
function resolveExpiration(options?: KVPutOptions): number | undefined {
  if (options?.expiration !== undefined) return options.expiration;
  if (options?.expirationTtl !== undefined) return Math.floor(Date.now() / 1000) + options.expirationTtl;
  return undefined;
}

/**
 * In-memory `KVNamespace` fake for tests — implements the full structural contract
 * (`get`/`getWithMetadata` in both `text` and `arrayBuffer` modes, `put`, `delete`,
 * `list` with prefix filtering and offset-based cursor pagination). Data lives in a
 * per-instance `Map` and is held as raw bytes, so an `arrayBuffer` round-trip is
 * byte-identical for values that are not valid UTF-8. TTLs are recorded as an absolute
 * `expiration` and surfaced on `list`, but expiry is never enforced — tests should not
 * depend on wall-clock expiry.
 *
 * @example
 * ```typescript
 * const kv = fakeKV({ "settings||user-1": JSON.stringify({ theme: "dark" }) });
 * const store = createKVStore<Settings>(kv, { prefix: "settings" });
 * const r = await store.get("user-1");
 * ```
 * @public
 */
export function fakeKV(seed?: Record<string, string>): KVNamespace {
  const data = new Map<string, StoredEntry>(Object.entries(seed ?? {}).map(([k, v]) => [k, { bytes: TEXT_ENCODER.encode(v) }]));

  function read(key: string, type: "text" | "arrayBuffer"): string | ArrayBuffer | null {
    const entry = data.get(key);
    if (!entry) return null;
    // Hand out a copy so a caller mutating the result cannot reach back into the store.
    return type === "text" ? TEXT_DECODER.decode(entry.bytes) : (entry.bytes.slice().buffer as ArrayBuffer);
  }

  const impl = {
    delete: async (key: string): Promise<void> => {
      data.delete(key);
    },
    get: async (key: string, options: { type: "text" | "arrayBuffer" }) => read(key, options.type),
    getWithMetadata: async (key: string, options: { type: "text" | "arrayBuffer" }) => ({
      value: read(key, options.type),
      metadata: data.get(key)?.metadata ?? null,
    }),
    put: async (key: string, value: string | ArrayBuffer, options?: KVPutOptions): Promise<void> => {
      // Bytes are stored verbatim — decoding to a string here would replace every invalid
      // UTF-8 sequence with U+FFFD and silently corrupt binary values.
      const bytes = typeof value === "string" ? TEXT_ENCODER.encode(value) : new Uint8Array(value).slice();
      const expiration = resolveExpiration(options);
      data.set(key, {
        bytes,
        ...(options?.metadata !== undefined ? { metadata: options.metadata } : {}),
        ...(expiration !== undefined ? { expiration } : {}),
      });
    },
    list: async <M = unknown>(options?: KVListOptions): Promise<KVListResult<M>> => {
      let names = [...data.keys()].sort();
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
  // The structural contract declares overloaded get/getWithMetadata signatures, which an object
  // literal cannot express — the implementation covers both modes, so the cast is sound.
  return impl as unknown as KVNamespace;
}

/**
 * `AssetsFetcher` fake serving from an in-memory path→body map. Requests whose pathname is a
 * key return `200` with that body; everything else returns `404` — mirroring the `ASSETS`
 * binding contract that `serveAssets` consumes.
 *
 * @example
 * ```typescript
 * const env = { ASSETS: fakeAssetsFetcher({ "/assets/css/main.css": "body{}" }) };
 * const res = await app.request("/assets/css/main.css", {}, env);
 * ```
 * @public
 */
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

/** The range shapes an R2 `get` accepts: a forward `offset`/`length` window, or a `suffix`
 *  byte count measured back from the end of the object. */
interface R2GetLike {
  range?: { offset?: number; length?: number; suffix?: number };
}

/** Resolves an R2 range option to a `[start, end)` byte window clamped to the object size. A
 *  missing `length` runs to the end; an out-of-range `offset` yields an empty window rather than
 *  throwing, leaving the 416 decision to the caller that serves HTTP. */
function resolveRange(size: number, range?: R2GetLike["range"]): { start: number; end: number } {
  if (!range) return { start: 0, end: size };
  if (range.suffix !== undefined) return { start: Math.max(0, size - range.suffix), end: size };
  const start = Math.min(Math.max(range.offset ?? 0, 0), size);
  const end = range.length !== undefined ? Math.min(start + range.length, size) : size;
  return { start, end: Math.max(start, end) };
}

/**
 * Functional in-memory `R2BucketLike` fake for tests — a per-instance `Map` backs `put`/`get`/
 * `head`/`delete`/`list`. `put` stores the body bytes plus optional http/custom metadata; `get`
 * returns an `R2ObjectBodyLike` with working `arrayBuffer()`/`text()`/`blob()` and a `body`
 * stream, honouring the `range` option in both its `offset`/`length` and `suffix` forms; `list`
 * honors `prefix`/`limit`/`cursor` with offset-encoded cursors.
 *
 * @example
 * ```typescript
 * const bucket = fakeR2({ "logo.svg": "<svg/>" });
 * const backend = r2Backend(bucket);
 * const obj = await backend.get("logo.svg");
 * ```
 * @public
 */
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
      const { start, end } = resolveRange(entry.bytes.byteLength, options?.range);
      const bytes = entry.bytes.subarray(start, end);
      let used = false;
      return {
        // `size` stays the whole object's size even for a ranged read — R2 reports the object,
        // not the slice, and `serveObject` builds the `Content-Range` total from it.
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
    list: async (options?: { prefix?: string; limit?: number; cursor?: string }): Promise<R2ListLike> => {
      let names = [...data.keys()].sort();
      if (options?.prefix) names = names.filter((n) => n.startsWith(options.prefix as string));
      const start = options?.cursor !== undefined ? Number.parseInt(options.cursor, 10) : 0;
      const limit = options?.limit ?? names.length;
      const page = names.slice(start, start + limit);
      const next = start + page.length;
      const truncated = next < names.length;
      const objects = page.map((name) => toR2Object(name, data.get(name) as StoredR2Entry));
      return truncated ? { objects, truncated: true, cursor: String(next) } : { objects, truncated: false };
    },
  };
  return impl as unknown as R2BucketLike;
}

interface FakeD1Statement extends D1PreparedStatement {
  readonly sql: string;
  readonly params: unknown[];
}

/** Options for `fakeD1`. @public */
export interface FakeD1Options {
  /**
   * Opt-in failure injector, consulted before every executed statement (`all`, `first`, `run`,
   * `exec`, and each statement of a `batch`). Return an `Error` to make that operation reject —
   * the shape a consumer's `Result` error branch sees — or `null` to let it succeed. Omitted,
   * the fake never fails.
   */
  failOn?: (sql: string, params: unknown[]) => Error | null;
}

/**
 * Programmable `D1DatabaseLike` stub for tests. `query` is a responder invoked with the executed
 * SQL and bound params; its return becomes the `results` of `all`/`first` (default `[]`). Every
 * bound statement is appended to the returned `calls` array for assertions. Mirrors how
 * `createD1Client` drives `prepare`→`bind`→`run`/`all`/`first`/`batch`. Pass `options.failOn` to
 * drive a consumer's error branch; without it the fake always succeeds.
 *
 * @example
 * ```typescript
 * const db = fakeD1((sql) => (sql.includes("users") ? [{ id: 1 }] : []));
 * const client = createD1Client(db);
 * const r = await client.query(sql`SELECT * FROM users`);
 * expect(db.calls).toHaveLength(1);
 * ```
 * @example
 * ```typescript
 * const db = fakeD1(() => [], { failOn: () => new Error("D1_ERROR: no such table") });
 * const r = await createD1Client(db).query(sql`SELECT 1`);
 * expect(r.ok).toBe(false);
 * ```
 * @public
 */
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
        return (column !== undefined ? (row as Record<string, unknown>)[column] : row) as T;
      },
      run: async (): Promise<D1Result<unknown>> => {
        failIfInjected(sql, params);
        return { results: [], success: true, meta: { rows_written: 0, changes: 0, last_row_id: 0, duration: 0 } };
      },
    };
  }

  return {
    calls,
    prepare: (sql: string): D1PreparedStatement => statement(sql, []),
    // A D1 batch is atomic, so one injected failure rejects the whole batch.
    batch: async <T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> =>
      statements.map((s) => {
        const fs = s as FakeD1Statement;
        failIfInjected(fs.sql, fs.params);
        return { results: query(fs.sql, fs.params) as T[], success: true, meta: { duration: 0 } };
      }),
    exec: async (sql: string): Promise<{ count: number; duration: number }> => {
      failIfInjected(sql, []);
      return { count: 0, duration: 0 };
    },
  };
}
