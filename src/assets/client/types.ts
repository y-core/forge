/** What `attachPrecache` caches and serves: the build's precache constants, plus the page a navigation falls back to offline. @public */
export interface PrecachePlan {
  /** Resolved against the worker's location; normally `PRECACHE_URLS`. */
  readonly urls: readonly string[];
  /** Names the cache, so a new version installs beside the old one and activation drops it; normally `PRECACHE_VERSION`. */
  readonly version: string;
  /** Precached with `urls`, and served to a navigation the network cannot answer. */
  readonly fallback?: string;
}

/** The part of a `Cache` that `attachPrecache` uses. @public */
export interface CacheLike {
  addAll(requests: readonly (Request | string)[]): Promise<void>;
  match(request: Request | string): Promise<Response | undefined>;
}

/** The part of a `CacheStorage` that `attachPrecache` uses. @public */
export interface CacheStorageLike {
  open(cacheName: string): Promise<CacheLike>;
  keys(): Promise<string[]>;
  delete(cacheName: string): Promise<boolean>;
}

/** The part of an `ExtendableEvent` that the `install` and `activate` handlers use. @public */
export interface ExtendableEventLike {
  waitUntil(promise: Promise<unknown>): void;
}

/** The part of a `FetchEvent` that the `fetch` handler uses. @public */
export interface FetchEventLike extends ExtendableEventLike {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}

/** The part of a `ServiceWorkerGlobalScope` that `attachPrecache` uses, so a worker typechecks under the app's own `tsconfig`. @public */
export interface ServiceWorkerScope {
  readonly caches: CacheStorageLike;
  readonly clients: { claim(): Promise<void> };
  readonly registration: { readonly scope: string };
  readonly location: { readonly href: string };
  fetch(request: Request): Promise<Response>;
  addEventListener(type: "install" | "activate", listener: (event: ExtendableEventLike) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchEventLike) => void): void;
}
