/** Neutral stored object — metadata only (from put/head). @public */
export interface StoredObject {
  key: string;
  size: number;
  etag: string;
  httpEtag: string;
  contentType?: string;
  contentEncoding?: string;
  contentDisposition?: string;
  contentLanguage?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
  uploaded: Date;
}

/** Neutral object with body (from get). @public */
export interface ObjectBody extends StoredObject {
  readonly body: ReadableStream;
  readonly bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  blob(): Promise<Blob>;
}

/** @public */
export interface ListObjectsResult {
  objects: StoredObject[];
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes?: string[];
}

/** @public */
export interface StorePutOptions {
  contentType?: string;
  contentEncoding?: string;
  contentDisposition?: string;
  contentLanguage?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
}

/** @public */
export interface StoreGetOptions {
  range?: { offset?: number; length?: number; suffix?: number };
}

/** @public */
export interface StoreListOptions {
  prefix?: string;
  limit?: number;
  cursor?: string;
  delimiter?: string;
}

/**
 * Pluggable backend interface — every adapter (R2, Dropbox, Cloudinary) implements this.
 * The consumer API (ObjectStore) never changes when backends are swapped. @public
 */
export interface ObjectStorageBackend {
  readonly name: string;
  put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null, options?: StorePutOptions): Promise<StoredObject>;
  get(key: string, options?: StoreGetOptions): Promise<ObjectBody | null>;
  head(key: string): Promise<StoredObject | null>;
  delete(key: string | string[]): Promise<void>;
  list(options?: StoreListOptions): Promise<ListObjectsResult>;
}

// ── R2 structural interfaces (type-only) ───────────────────────────────────

/** @public */
export interface R2HttpMetadata {
  contentType?: string;
  contentEncoding?: string;
  contentDisposition?: string;
  contentLanguage?: string;
  cacheControl?: string;
}

/** @public */
export interface R2Object {
  key: string;
  version: string;
  size: number;
  etag: string;
  httpEtag: string;
  uploaded: Date;
  httpMetadata?: R2HttpMetadata;
  customMetadata?: Record<string, string>;
}

/** @public */
export interface R2ObjectBody extends R2Object {
  readonly body: ReadableStream;
  readonly bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  blob(): Promise<Blob>;
}

/** @public */
export interface R2PutOptions {
  httpMetadata?: R2HttpMetadata;
  customMetadata?: Record<string, string>;
}

/** @public */
export interface R2GetOptions {
  range?: { offset?: number; length?: number; suffix?: number };
}

/** @public */
export interface R2ListOptions {
  prefix?: string;
  limit?: number;
  cursor?: string;
  delimiter?: string;
}

/** @public */
export interface R2ListResult {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes?: string[];
}

/** Minimal structural R2Bucket — type-only, erases at runtime. @public */
export interface R2Bucket {
  put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null, options?: R2PutOptions): Promise<R2Object>;
  get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | null>;
  head(key: string): Promise<R2Object | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: R2ListOptions): Promise<R2ListResult>;
}
