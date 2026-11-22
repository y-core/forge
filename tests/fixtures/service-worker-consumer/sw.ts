import { attachPrecache } from "@y-core/forge/assets/client";
import { PRECACHE_URLS, PRECACHE_VERSION } from "@y-core/forge/assets/precache";

declare const self: ServiceWorkerGlobalScope;

attachPrecache(self, { urls: PRECACHE_URLS, version: PRECACHE_VERSION, fallback: "/offline" });
