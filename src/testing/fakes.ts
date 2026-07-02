import type { AssetsFetcher } from "../app/types";
import type { KVListOptions, KVListResult, KVNamespace, KVPutOptions } from "../storage/kv/types";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

interface StoredEntry {
  value: string;
  metadata?: unknown;
}

/**
 * In-memory `KVNamespace` fake for tests — implements the full structural contract
 * (`get`/`getWithMetadata` in both `text` and `arrayBuffer` modes, `put`, `delete`,
 * `list` with prefix filtering). Data lives in a per-instance `Map`; TTLs are accepted
 * but not enforced (tests should not depend on wall-clock expiry).
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
      data.set(key, { value: text, ...(options?.metadata !== undefined ? { metadata: options.metadata } : {}) });
    },
    list: async <M = unknown>(options?: KVListOptions): Promise<KVListResult<M>> => {
      let names = [...data.keys()].sort();
      if (options?.prefix) names = names.filter((n) => n.startsWith(options.prefix as string));
      if (options?.limit !== undefined) names = names.slice(0, options.limit);
      return { keys: names.map((name) => ({ name, metadata: (data.get(name)?.metadata ?? undefined) as M })), list_complete: true };
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
