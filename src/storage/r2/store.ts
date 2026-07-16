import { createLogger } from "../../logging/logger";
import { result } from "../../result/result";
import { inferContentType } from "./content-type";
import { serveObject } from "./serve";
import type { ListObjectsResult, ObjectBody, ObjectStorageBackend, ObjectStore, ObjectStoreOptions, StoredObject } from "./types";

const PREFIX_SEP = "/";

/** Rejects keys with leading '/' or any '.' / '..' path segment to prevent path-traversal. */
function normalizeKey(key: string): string {
  if (key.startsWith("/")) throw new Error(`Object key must not start with '/': ${key}`);
  for (const seg of key.split("/")) {
    if (seg === "." || seg === "..") throw new Error(`Object key must not contain '.' or '..' segments: ${key}`);
  }
  return key;
}

/**
 * Creates an ObjectStore wrapping any ObjectStorageBackend, with an optional key prefix. The data
 * operations (`get`/`put`/`delete`/`head`/`list`) return `Result`; `serveObject` is an HTTP-boundary
 * method that returns a `Response` directly (not a `Result`), per ERROR_HANDLING.md §2/§5b. @public
 */
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
      return result(() => {
        const prefixed = Array.isArray(key) ? key.map((k) => prefixKey(normalizeKey(k))) : prefixKey(normalizeKey(key));
        return backend.delete(prefixed);
      });
    },

    get(key, opts?) {
      return result(() =>
        backend.get(prefixKey(normalizeKey(key)), opts).then((obj): ObjectBody | null => {
          if (!obj) return null;
          return prefix ? { ...obj, key: stripPrefix(obj.key) } : obj;
        }),
      );
    },

    head(key) {
      return result(() => backend.head(prefixKey(normalizeKey(key))).then((obj) => (obj ? stripObjectPrefix(obj) : null)));
    },

    list(opts?) {
      return result(() => {
        const userPrefix = opts?.prefix !== undefined ? normalizeKey(opts.prefix) : undefined;
        const listPrefix = prefix ? (userPrefix ? `${prefix}${PREFIX_SEP}${userPrefix}` : `${prefix}${PREFIX_SEP}`) : userPrefix;
        return backend
          .list({ ...opts, ...(listPrefix !== undefined ? { prefix: listPrefix } : {}) })
          .then((res): ListObjectsResult => ({ ...res, objects: res.objects.map(stripObjectPrefix) }));
      });
    },

    put(key, value, opts) {
      return result(() => {
        const fullKey = prefixKey(normalizeKey(key));
        const contentType = opts?.contentType ?? inferContentType(key);
        return backend.put(fullKey, value, { ...opts, contentType }).then(stripObjectPrefix);
      });
    },

    async serveObject(request, key, opts?) {
      let fullKey: string;
      try {
        // The only synchronous throw: an invalid/traversal key. Reject before touching the backend.
        fullKey = prefixKey(normalizeKey(key));
      } catch {
        return new Response(null, { status: 400 });
      }
      try {
        return await serveObject(backend, request, fullKey, opts);
      } catch {
        // Unexpected backend failure. This method serves HTTP directly (Response, not Result),
        // so an async rejection must resolve to a status rather than leak as an unhandled rejection.
        return new Response(null, { status: 500 });
      }
    },
  };
}
