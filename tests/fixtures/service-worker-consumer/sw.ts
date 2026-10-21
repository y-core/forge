import { PRECACHE_URLS, PRECACHE_VERSION } from "@y-core/forge/assets/precache";

declare const self: ServiceWorkerGlobalScope;

const PREFIX = "/assets/"; // your publicPrefix

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(PRECACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== PRECACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith(PREFIX)) return;
  event.respondWith(
    caches.open(PRECACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached !== undefined) return cached;
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    }),
  );
});
