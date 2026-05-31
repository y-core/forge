import { createLogger } from "../../logging/logger";
import type { Logger } from "../../logging/types";
import type { Result } from "../../result/result";
import { result } from "../../result/result";
import { inferContentType } from "./content-type";
import type { ServeOptions } from "./serve";
import { serveObject } from "./serve";
import type { ListObjectsResult, ObjectBody, ObjectStorageBackend, StoredObject, StoreGetOptions, StoreListOptions, StorePutOptions } from "./types";

/** @public */
export interface ObjectStoreOptions {
  prefix?: string;
  logger?: Logger;
}

/** @public */
export interface ObjectStore {
  readonly backend: ObjectStorageBackend;
  delete(key: string | string[]): Promise<Result<void>>;
  get(key: string, options?: StoreGetOptions): Promise<Result<ObjectBody | null>>;
  head(key: string): Promise<Result<StoredObject | null>>;
  list(options?: StoreListOptions): Promise<Result<ListObjectsResult>>;
  put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null, options?: StorePutOptions): Promise<Result<StoredObject>>;
  serveObject(request: Request, key: string, options?: ServeOptions): Promise<Response>;
}

const PREFIX_SEP = "/";

/** Creates an ObjectStore wrapping any ObjectStorageBackend with Result-wrapped ops and optional key prefix. @public */
export function createObjectStore(backend: ObjectStorageBackend, options?: ObjectStoreOptions): ObjectStore {
  const prefix = options?.prefix;
  const _logger = options?.logger ?? createLogger("storage/r2");

  function prefixKey(key: string): string {
    return prefix ? `${prefix}${PREFIX_SEP}${key}` : key;
  }

  function stripPrefix(key: string): string {
    if (!prefix) return key;
    const pfx = `${prefix}${PREFIX_SEP}`;
    return key.startsWith(pfx) ? key.slice(pfx.length) : key;
  }

  function stripObjectPrefix(obj: StoredObject): StoredObject {
    return prefix ? { ...obj, key: stripPrefix(obj.key) } : obj;
  }

  return {
    backend,

    delete(key) {
      const prefixed = Array.isArray(key) ? key.map(prefixKey) : prefixKey(key);
      return result(() => backend.delete(prefixed));
    },

    get(key, opts?) {
      return result(() =>
        backend.get(prefixKey(key), opts).then((obj): ObjectBody | null => {
          if (!obj) return null;
          return prefix ? { ...obj, key: stripPrefix(obj.key) } : obj;
        }),
      );
    },

    head(key) {
      return result(() =>
        backend.head(prefixKey(key)).then((obj) => (obj ? stripObjectPrefix(obj) : null)),
      );
    },

    list(opts?) {
      const listPrefix = prefix
        ? opts?.prefix ? `${prefix}${PREFIX_SEP}${opts.prefix}` : `${prefix}${PREFIX_SEP}`
        : opts?.prefix;
      return result(() =>
        backend.list({ ...opts, prefix: listPrefix }).then((res): ListObjectsResult => ({
          ...res,
          objects: res.objects.map(stripObjectPrefix),
        })),
      );
    },

    put(key, value, opts) {
      const fullKey = prefixKey(key);
      const contentType = opts?.contentType ?? inferContentType(key);
      return result(() => backend.put(fullKey, value, { ...opts, contentType }).then(stripObjectPrefix));
    },

    serveObject(request, key, opts?) {
      return serveObject(backend, request, prefixKey(key), opts);
    },
  };
}
