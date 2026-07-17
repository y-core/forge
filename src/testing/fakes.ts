import type { AssetsFetcher } from "../app/types";
import type { D1DatabaseLike, D1PreparedStatement, D1Result } from "../storage/db/types";
import type { KVListOptions, KVListResult, KVNamespace, KVPutOptions } from "../storage/kv/types";
import type { R2BucketLike, R2ListLike, R2ObjectBodyLike, R2ObjectLike, R2PutLike } from "../storage/r2/types";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

interface StoredEntry {
  value: string;
  metadata?: unknown;
  expiration?: number;
}

/**
 * In-memory `KVNamespace` fake for tests — implements the full structural contract
 * (`get`/`getWithMetadata` in both `text` and `arrayBuffer` modes, `put`, `delete`,
 * `list` with prefix filtering and offset-based cursor pagination). Data lives in a
 * per-instance `Map`; TTLs are accepted but not enforced (tests should not depend on
 * wall-clock expiry), though an explicit `expiration` is tracked and surfaced on `list`.
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
  const data = new Map<string, StoredEntry>(Object.entries(seed ?? {}).map(([k, v]) => [k, { value: v }]));

  function read(key: string, type: "text" | "arrayBuffer"): string | ArrayBuffer | null {
    const entry = data.get(key);
    if (!entry) return null;
    return type === "text" ? entry.value : TEXT_ENCODER.encode(entry.value).buffer;
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
      const text = typeof value === "string" ? value : TEXT_DECODER.decode(value);
      data.set(key, {
        value: text,
        ...(options?.metadata !== undefined ? { metadata: options.metadata } : {}),
        ...(options?.expiration !== undefined ? { expiration: options.expiration } : {}),
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

/**
 * Functional in-memory `R2BucketLike` fake for tests — a per-instance `Map` backs `put`/`get`/
 * `head`/`delete`/`list`. `put` stores the body bytes plus optional http/custom metadata; `get`
 * returns an `R2ObjectBodyLike` with working `arrayBuffer()`/`text()`/`blob()` and a `body`
 * stream; `list` honors `prefix`/`limit`/`cursor` with offset-encoded cursors.
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
    get: async (key: string): Promise<R2ObjectBodyLike | null> => {
      const entry = data.get(key);
      if (!entry) return null;
      const bytes = entry.bytes;
      let used = false;
      return {
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

/**
 * Programmable `D1DatabaseLike` stub for tests. `query` is a responder invoked with the executed
 * SQL and bound params; its return becomes the `results` of `all`/`first` (default `[]`). Every
 * bound statement is appended to the returned `calls` array for assertions. Mirrors how
 * `createD1Client` drives `prepare`→`bind`→`run`/`all`/`first`/`batch`.
 *
 * @example
 * ```typescript
 * const db = fakeD1((sql) => (sql.includes("users") ? [{ id: 1 }] : []));
 * const client = createD1Client(db);
 * const r = await client.query(sql`SELECT * FROM users`);
 * expect(db.calls).toHaveLength(1);
 * ```
 * @public
 */
export function fakeD1(
  query: (sql: string, params: unknown[]) => unknown[] = () => [],
): D1DatabaseLike & { calls: { sql: string; params: unknown[] }[] } {
  const calls: { sql: string; params: unknown[] }[] = [];

  function statement(sql: string, params: unknown[]): FakeD1Statement {
    return {
      sql,
      params,
      bind: (...values: unknown[]): D1PreparedStatement => {
        calls.push({ sql, params: values });
        return statement(sql, values);
      },
      all: async <T = unknown>(): Promise<D1Result<T>> => {
        const results = query(sql, params) as T[];
        return { results, success: true, meta: { duration: 0, rows_read: results.length } };
      },
      first: async <T = unknown>(column?: string): Promise<T | null> => {
        const row = query(sql, params)[0];
        if (row === undefined || row === null) return null;
        return (column !== undefined ? (row as Record<string, unknown>)[column] : row) as T;
      },
      run: async (): Promise<D1Result<unknown>> => ({
        results: [],
        success: true,
        meta: { rows_written: 0, changes: 0, last_row_id: 0, duration: 0 },
      }),
    };
  }

  return {
    calls,
    prepare: (sql: string): D1PreparedStatement => statement(sql, []),
    batch: async <T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> =>
      statements.map((s) => {
        const fs = s as FakeD1Statement;
        return { results: query(fs.sql, fs.params) as T[], success: true, meta: { duration: 0 } };
      }),
    exec: async (): Promise<{ count: number; duration: number }> => ({ count: 0, duration: 0 }),
  };
}
