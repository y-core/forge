import { createLogger } from "../../logging/logger";
import { result } from "../../result/result";
import { jsonCodec } from "./codec";
import type { KVEntry, KVListEntry, KVListOptions, KVNamespace, KVSetOptions, KVStore, KVStoreOptions, KvCodec } from "./types";

const KV_PREFIX_SEPARATOR = "||";

/** Creates a typed KV store wrapping a KVNamespace with codec, prefix, and Result-wrapped ops. @public */
export function createKVStore<T = unknown>(kv: KVNamespace, options?: KVStoreOptions<T>): KVStore<T> {
  const prefix = options?.prefix;
  const codec: KvCodec<T> = (options?.codec ?? jsonCodec()) as KvCodec<T>;
  const defaultTtl = options?.defaultTtl;
  const logger = options?.logger ?? createLogger("storage/kv");

  function prefixKey(key: string): string {
    return prefix ? `${prefix}${KV_PREFIX_SEPARATOR}${key}` : key;
  }

  function stripPrefix(name: string): string {
    if (!prefix) return name;
    const pfx = `${prefix}${KV_PREFIX_SEPARATOR}`;
    return name.startsWith(pfx) ? name.slice(pfx.length) : name;
  }

  function putOptions(opts?: KVSetOptions): { expirationTtl?: number; expiration?: number; metadata?: unknown } | undefined {
    const ttl = opts?.ttl ?? defaultTtl;
    if (ttl === undefined && opts?.expiration === undefined && opts?.metadata === undefined) return undefined;
    return {
      ...(ttl !== undefined ? { expirationTtl: ttl } : {}),
      ...(opts?.expiration !== undefined ? { expiration: opts.expiration } : {}),
      ...(opts?.metadata !== undefined ? { metadata: opts.metadata } : {}),
    };
  }

  async function getRaw(fullKey: string): Promise<string | ArrayBuffer | null> {
    if (codec.type === "arrayBuffer") return kv.get(fullKey, { type: "arrayBuffer" });
    return kv.get(fullKey, { type: "text" });
  }

  return {
    get(key) {
      return result(async () => {
        const raw = await getRaw(prefixKey(key));
        if (raw === null) return null;
        try {
          return codec.decode(raw);
        } catch (err) {
          logger.warn("kv.decode-error", { key, error: String(err) });
          throw err;
        }
      });
    },

    getWithMeta<M = unknown>(key: string) {
      return result(async (): Promise<KVEntry<T, M>> => {
        const fullKey = prefixKey(key);
        const { value, metadata } =
          codec.type === "arrayBuffer"
            ? await kv.getWithMetadata<M>(fullKey, { type: "arrayBuffer" })
            : await kv.getWithMetadata<M>(fullKey, { type: "text" });
        return { value: value !== null ? codec.decode(value) : null, metadata };
      });
    },

    set(key, value, opts) {
      return result(async () => {
        await kv.put(prefixKey(key), codec.encode(value), putOptions(opts));
      });
    },

    delete(key) {
      return result(async () => {
        await kv.delete(prefixKey(key));
      });
    },

    getOrSet(key, factory, opts) {
      return result(async () => {
        const raw = await getRaw(prefixKey(key));
        if (raw !== null) return codec.decode(raw);
        logger.debug("kv.miss", { key });
        const value = await factory();
        await kv.put(prefixKey(key), codec.encode(value), putOptions(opts));
        return value;
      });
    },

    list<M = unknown>(listOpts?: KVListOptions) {
      return result(async () => {
        const listPrefix = prefix
          ? listOpts?.prefix
            ? `${prefix}${KV_PREFIX_SEPARATOR}${listOpts.prefix}`
            : `${prefix}${KV_PREFIX_SEPARATOR}`
          : listOpts?.prefix;
        const res = await kv.list<M>({ ...listOpts, ...(listPrefix !== undefined ? { prefix: listPrefix } : {}) });
        const keys: KVListEntry<M>[] = res.keys.map(({ name, expiration, metadata }) => ({
          name: stripPrefix(name),
          ...(expiration !== undefined ? { expiration } : {}),
          ...(metadata !== undefined ? { metadata } : {}),
        }));
        return { keys, ...(res.cursor !== undefined ? { cursor: res.cursor } : {}), complete: res.list_complete };
      });
    },
  };
}
