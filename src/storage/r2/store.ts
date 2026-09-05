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

/** Creates an ObjectStore wrapping any ObjectStorageBackend, with an optional key prefix. @public */
export function createObjectStore(backend: ObjectStorageBackend, options?: ObjectStoreOptions): ObjectStore {
  const prefix = options?.prefix;

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

  // Copied field by field, never spread: a spread *reads* the body getters, freezing `bodyUsed` at
  // false and locking a real `R2ObjectBody`'s stream before the caller ever asks for it.
  function rekeyBody(obj: ObjectBody): ObjectBody {
    return {
      key: stripPrefix(obj.key),
      size: obj.size,
      etag: obj.etag,
      httpEtag: obj.httpEtag,
      uploaded: obj.uploaded,
      ...(obj.contentType !== undefined ? { contentType: obj.contentType } : {}),
      ...(obj.contentEncoding !== undefined ? { contentEncoding: obj.contentEncoding } : {}),
      ...(obj.contentDisposition !== undefined ? { contentDisposition: obj.contentDisposition } : {}),
      ...(obj.contentLanguage !== undefined ? { contentLanguage: obj.contentLanguage } : {}),
      ...(obj.cacheControl !== undefined ? { cacheControl: obj.cacheControl } : {}),
      ...(obj.metadata !== undefined ? { metadata: obj.metadata } : {}),
      get body() {
        return obj.body;
      },
      get bodyUsed() {
        return obj.bodyUsed;
      },
      arrayBuffer: () => obj.arrayBuffer(),
      text: () => obj.text(),
      blob: () => obj.blob(),
    };
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
      return result(() => backend.get(prefixKey(normalizeKey(key)), opts).then((obj): ObjectBody | null => (obj ? rekeyBody(obj) : null)));
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
          .then((res): ListObjectsResult => ({
            ...res,
            objects: res.objects.map(stripObjectPrefix),
            ...(res.delimitedPrefixes !== undefined ? { delimitedPrefixes: res.delimitedPrefixes.map(stripPrefix) } : {}),
          }));
      });
    },

    put(key, value, opts) {
      return result(() => {
        const fullKey = prefixKey(normalizeKey(key));
        const contentType = opts?.contentType ?? inferContentType(key);
        return backend.put(fullKey, value, { ...opts, contentType }).then(stripObjectPrefix);
      });
    },

    serveObject(request, key, opts?) {
      return result(() => serveObject(backend, request, prefixKey(normalizeKey(key)), opts));
    },
  };
}
