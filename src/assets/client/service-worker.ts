import type { PrecachePlan, ServiceWorkerScope } from "./types";

/** Registers the `install`, `activate` and `fetch` handlers that precache `plan`, drop older precaches and serve from cache. @public */
export function attachPrecache(scope: ServiceWorkerScope, plan: PrecachePlan): void {
  // A serialized URL holds no space, so one scope's prefix never begins the name of a cache another scope owns.
  const cachePrefix = `forge-precache ${scope.registration.scope} `;
  const cacheName = `${cachePrefix}${plan.version}`;
  const toHref = (url: string): string => new URL(url, scope.location.href).href;
  const installed = [...new Set([...plan.urls, ...(plan.fallback === undefined ? [] : [plan.fallback])])];
  const precached = new Set(installed.map(toHref));

  scope.addEventListener("install", (event) => {
    const requests = installed.map((url) => new Request(toHref(url), { credentials: "omit" }));
    event.waitUntil(scope.caches.open(cacheName).then((cache) => cache.addAll(requests)));
  });

  scope.addEventListener("activate", (event) => {
    event.waitUntil(
      scope.caches
        .keys()
        .then((keys) => Promise.all(keys.filter((key) => key.startsWith(cachePrefix) && key !== cacheName).map((key) => scope.caches.delete(key))))
        .then(() => scope.clients.claim()),
    );
  });

  scope.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET") return;
    const isPrecached = precached.has(toHref(request.url));
    const fallback = request.mode === "navigate" ? plan.fallback : undefined;
    if (!isPrecached && fallback === undefined) return;
    event.respondWith(answer(scope, cacheName, request, isPrecached, fallback === undefined ? undefined : toHref(fallback)));
  });
}

/** A precached URL comes from the cache first; a navigation the cache and the network both miss gets the fallback. */
async function answer(
  scope: ServiceWorkerScope,
  cacheName: string,
  request: Request,
  isPrecached: boolean,
  fallback: string | undefined,
): Promise<Response> {
  const cached = isPrecached ? await fromCache(scope, cacheName, request) : undefined;
  if (cached !== undefined) return cached;
  if (fallback === undefined) return scope.fetch(request);
  try {
    return await scope.fetch(request);
  } catch {
    return (await fromCache(scope, cacheName, fallback)) ?? Response.error();
  }
}

async function fromCache(scope: ServiceWorkerScope, cacheName: string, request: Request | string): Promise<Response | undefined> {
  return (await scope.caches.open(cacheName)).match(request);
}
