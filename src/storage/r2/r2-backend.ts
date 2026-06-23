import type { ObjectBody, ObjectStorageBackend, R2BucketLike, R2ObjectBodyLike, R2ObjectLike, StoredObject, StorePutOptions } from "./types";

function toStoredObject(obj: R2ObjectLike): StoredObject {
  return {
    key: obj.key,
    size: obj.size,
    etag: obj.etag,
    httpEtag: obj.httpEtag,
    uploaded: obj.uploaded,
    ...(obj.httpMetadata?.contentType ? { contentType: obj.httpMetadata.contentType } : {}),
    ...(obj.httpMetadata?.contentEncoding ? { contentEncoding: obj.httpMetadata.contentEncoding } : {}),
    ...(obj.httpMetadata?.contentDisposition ? { contentDisposition: obj.httpMetadata.contentDisposition } : {}),
    ...(obj.httpMetadata?.contentLanguage ? { contentLanguage: obj.httpMetadata.contentLanguage } : {}),
    ...(obj.httpMetadata?.cacheControl ? { cacheControl: obj.httpMetadata.cacheControl } : {}),
    ...(obj.customMetadata ? { metadata: obj.customMetadata } : {}),
  };
}

function toObjectBody(obj: R2ObjectBodyLike): ObjectBody {
  return {
    ...toStoredObject(obj),
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

/** Creates an ObjectStorageBackend backed by a Cloudflare R2 bucket. Accepts any binding that
 *  meets the structural contract `R2BucketLike` — forge's neutral `R2Bucket` or the platform's
 *  runtime bucket — so consumers never cast at the resolve site. @public */
export function r2Backend(bucket: R2BucketLike): ObjectStorageBackend {
  return {
    name: "r2",

    async put(key, value, options?: StorePutOptions): Promise<StoredObject> {
      const obj = await bucket.put(key, value, {
        httpMetadata: {
          ...(options?.contentType ? { contentType: options.contentType } : {}),
          ...(options?.contentEncoding ? { contentEncoding: options.contentEncoding } : {}),
          ...(options?.contentDisposition ? { contentDisposition: options.contentDisposition } : {}),
          ...(options?.contentLanguage ? { contentLanguage: options.contentLanguage } : {}),
          ...(options?.cacheControl ? { cacheControl: options.cacheControl } : {}),
        },
        ...(options?.metadata ? { customMetadata: options.metadata } : {}),
      });
      return toStoredObject(obj);
    },

    async get(key, options?): Promise<ObjectBody | null> {
      const obj = await bucket.get(key, options);
      return obj ? toObjectBody(obj) : null;
    },

    async head(key): Promise<StoredObject | null> {
      const obj = await bucket.head(key);
      return obj ? toStoredObject(obj) : null;
    },

    async delete(key): Promise<void> {
      await bucket.delete(key);
    },

    async list(options?): Promise<{ objects: StoredObject[]; truncated: boolean; cursor?: string; delimitedPrefixes?: string[] }> {
      const res = await bucket.list(options);
      return {
        objects: res.objects.map(toStoredObject),
        truncated: res.truncated,
        ...(res.cursor !== undefined ? { cursor: res.cursor } : {}),
        ...(res.delimitedPrefixes !== undefined ? { delimitedPrefixes: res.delimitedPrefixes } : {}),
      };
    },
  };
}
