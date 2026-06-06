import type { AppContext } from "../../context/types";
import type { Logger } from "../../logging/types";
import type { Result } from "../../result/result";

/** Determines which KV get overload to call and how to encode/decode the value. @public */
export type KvValueType = "text" | "arrayBuffer";

/** Codec for encoding/decoding values stored in KV. @public */
export interface KvCodec<T> {
  readonly type: KvValueType;
  encode(value: T): string | ArrayBuffer;
  decode(raw: string | ArrayBuffer): T;
}

/** Minimal structural KV namespace — type-only, erases at runtime. @public */
export interface KVNamespace {
  delete(key: string): Promise<void>;
  get(key: string, options: { type: "text" }): Promise<string | null>;
  get(key: string, options: { type: "arrayBuffer" }): Promise<ArrayBuffer | null>;
  getWithMetadata<M = unknown>(key: string, options: { type: "text" }): Promise<{ value: string | null; metadata: M | null }>;
  getWithMetadata<M = unknown>(key: string, options: { type: "arrayBuffer" }): Promise<{ value: ArrayBuffer | null; metadata: M | null }>;
  put(key: string, value: string | ArrayBuffer, options?: KVPutOptions): Promise<void>;
  list<M = unknown>(options?: KVListOptions): Promise<KVListResult<M>>;
}

/** @public */
export interface KVPutOptions {
  expirationTtl?: number;
  expiration?: number;
  metadata?: unknown;
}

/** @public */
export interface KVListOptions {
  prefix?: string;
  limit?: number;
  cursor?: string;
}

/** @public */
export interface KVListResult<M = unknown> {
  keys: Array<{ name: string; expiration?: number; metadata?: M }>;
  list_complete: boolean;
  cursor?: string;
}

/** @public */
export interface KVStoreOptions<T = unknown> {
  prefix?: string;
  codec?: KvCodec<T>;
  defaultTtl?: number;
  logger?: Logger;
}

/** @public */
export interface KVSetOptions {
  ttl?: number;
  expiration?: number;
  metadata?: unknown;
}

/** @public */
export interface KVEntry<T = unknown, M = unknown> {
  value: T | null;
  metadata: M | null;
}

/** @public */
export interface KVListEntry<M = unknown> {
  name: string;
  expiration?: number;
  metadata?: M;
}

/** @public */
export interface KVStore<T = unknown> {
  delete(key: string): Promise<Result<void>>;
  get(key: string): Promise<Result<T | null>>;
  getWithMeta<M = unknown>(key: string): Promise<Result<KVEntry<T, M>>>;
  set(key: string, value: T, options?: KVSetOptions): Promise<Result<void>>;
  getOrSet(key: string, factory: () => T | Promise<T>, options?: KVSetOptions): Promise<Result<T>>;
  list<M = unknown>(options?: KVListOptions): Promise<Result<{ keys: KVListEntry<M>[]; cursor?: string; complete: boolean }>>;
}

/** Options for resolving a KV binding from context. @public */
export interface KVBindingOptions<Bindings = Record<string, unknown>, T = unknown> {
  binding: (c: AppContext<Bindings>) => KVNamespace | undefined;
  /** When true (default), throws if the binding is absent. Set false to return null instead. */
  required?: boolean;
  store?: KVStoreOptions<T>;
}
