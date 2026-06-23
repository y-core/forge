import type { AppContext } from "../../context/types";
import type { Logger } from "../../logging/types";
import type { Result } from "../../result/result";

/** Options for serveObject. @public */
export interface ServeOptions {
  cacheControl?: string;
  contentDisposition?: "inline" | "attachment";
}

/** Options for createSignedObjectUrl. @public */
export interface SignedUrlOptions {
  /** Seconds until the URL expires. Default: 3600. */
  expiresInSeconds?: number;
}

/** Successful verification result. @public */
export interface SignedUrlOk {
  ok: true;
  key: string;
}

/** Failed verification result. @public */
export interface SignedUrlError {
  ok: false;
  reason: "expired" | "invalid-signature" | "invalid-format";
}

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

// ── R2 structural contract (the consumed surface) ──────────────────────────
//
// The `*Like` shapes below describe *only* what `r2Backend` reads off a bucket —
// 5 methods plus a handful of object fields. They are deliberately a structural
// **supertype** of both forge's own neutral `R2Bucket` (above) AND Cloudflare's
// runtime `R2Bucket` (abstract-class `R2Object` with extra members, overloaded
// `put`/`get`, discriminated-union `list` return). Constraining a binding
// resolver to `B extends R2BucketLike` lets the compiler prove each concrete
// platform binding meets the contract — no cast at the call site. `get`/`list`
// options are `unknown` (the adapter passes them straight through), sidestepping
// the divergent branded option/range types.

/** Read surface of an R2 object the adapter consumes (a structural supertype of
 *  Cloudflare's `R2Object`). @public */
export interface R2ObjectLike {
  key: string;
  size: number;
  etag: string;
  httpEtag: string;
  uploaded: Date;
  httpMetadata?: R2HttpMetadata;
  customMetadata?: Record<string, string>;
}

/** Read surface of an R2 object body the adapter consumes. @public */
export interface R2ObjectBodyLike extends R2ObjectLike {
  readonly body: ReadableStream;
  readonly bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  blob(): Promise<Blob>;
}

/** List-result surface the adapter consumes. @public */
export interface R2ListLike {
  objects: R2ObjectLike[];
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes?: string[];
}

/** Put-options surface the adapter constructs. @public */
export interface R2PutLike {
  httpMetadata?: R2HttpMetadata;
  customMetadata?: Record<string, string>;
}

/** Structural contract — the consumed surface of an R2 bucket binding. Both forge's
 *  neutral `R2Bucket` and Cloudflare's runtime `R2Bucket` satisfy it. @public */
export interface R2BucketLike {
  put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob, options?: R2PutLike): Promise<R2ObjectLike>;
  get(key: string, options?: unknown): Promise<R2ObjectBodyLike | null>;
  head(key: string): Promise<R2ObjectLike | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: unknown): Promise<R2ListLike>;
}

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

/** Options for resolving an R2 binding from context. The binding return is constrained to the
 *  structural contract `B extends R2BucketLike` so any platform bucket (forge's neutral type or
 *  Cloudflare's runtime type) is accepted cast-free. @public */
export interface R2BindingOptions<Bindings = Record<string, unknown>, B extends R2BucketLike = R2Bucket> {
  binding: (c: AppContext<Bindings>) => B | undefined;
  /** When true (default), throws if the binding is absent. Set false to return null instead. */
  required?: boolean;
  store?: ObjectStoreOptions;
}
