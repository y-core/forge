import { describe, expect, it } from "bun:test";

import { fakeAssetsFetcher, fakeCacheStorage } from "../../testing/fakes";
import { buildRequest } from "../../testing/request";
import { attachPrecache } from "./service-worker";
import type { ExtendableEventLike, FetchEventLike, PrecachePlan, ServiceWorkerScope } from "./types";

const PLAN: PrecachePlan = { urls: ["/assets/app.abc.css", "/assets/app.def.js"], version: "v2", fallback: "/offline" };

const SCOPE = "http://test/";

function precacheName(version: string, scope = SCOPE): string {
  return `forge-precache ${scope} ${version}`;
}

function browser() {
  const assets: Record<string, string | { body: string; type: string }> = {
    "/assets/app.abc.css": "body{margin:0}",
    "/assets/app.def.js": "export {};",
    "/offline": { body: "<p>offline</p>", type: "text/html" },
  };
  const server = fakeAssetsFetcher(assets);
  let online = true;
  const credentials: string[] = [];
  const network = async (request: Request): Promise<Response> => {
    if (!online) throw new TypeError("Failed to fetch");
    credentials.push(request.credentials);
    return server.fetch(request);
  };
  const caches = fakeCacheStorage({ fetch: network });
  const claims: string[][] = [];

  function worker(plan: PrecachePlan = PLAN, registration = SCOPE) {
    const lifecycleListeners = new Map<string, (event: ExtendableEventLike) => void>();
    let fetchListener: ((event: FetchEventLike) => void) | undefined;
    function addEventListener(type: "install" | "activate", listener: (event: ExtendableEventLike) => void): void;
    function addEventListener(type: "fetch", listener: (event: FetchEventLike) => void): void;
    function addEventListener(type: string, listener: (event: FetchEventLike) => void): void {
      if (type === "fetch") fetchListener = listener;
      else lifecycleListeners.set(type, listener as (event: ExtendableEventLike) => void);
    }
    const scope: ServiceWorkerScope = {
      caches,
      clients: { claim: async () => void claims.push(await caches.keys()) },
      registration: { scope: registration },
      location: { href: "http://test/sw.js" },
      fetch: network,
      addEventListener,
    };
    attachPrecache(scope, plan);

    async function lifecycle(type: "install" | "activate"): Promise<void> {
      const listener = lifecycleListeners.get(type);
      if (listener === undefined) throw new Error(`no ${type} listener registered`);
      const pending: Promise<unknown>[] = [];
      listener({ waitUntil: (promise) => void pending.push(promise) });
      if (pending.length !== 1) throw new Error(`${type} called waitUntil ${pending.length} times`);
      await Promise.all(pending);
    }

    function fetchThrough(request: Request): Promise<Response> | undefined {
      if (fetchListener === undefined) throw new Error("no fetch listener registered");
      const answers: Promise<Response>[] = [];
      fetchListener({ request, waitUntil: () => {}, respondWith: (response) => void answers.push(response) });
      if (answers.length > 1) throw new Error(`respondWith called ${answers.length} times`);
      return answers[0];
    }

    return { lifecycle, fetchThrough };
  }

  return { assets, caches, claims, credentials, server, worker, offline: () => void (online = false) };
}

async function cachedText(caches: ReturnType<typeof browser>["caches"], cacheName: string, url: string): Promise<string | undefined> {
  return (await (await caches.open(cacheName)).match(url))?.text();
}

describe("attachPrecache", () => {
  describe("install", () => {
    it("precaches every plan URL and the fallback under a versioned cache", async () => {
      const b = browser();
      await b.worker().lifecycle("install");
      expect(await b.caches.keys()).toEqual([precacheName("v2")]);
      expect(await cachedText(b.caches, precacheName("v2"), "/assets/app.abc.css")).toBe("body{margin:0}");
      expect(await cachedText(b.caches, precacheName("v2"), "/assets/app.def.js")).toBe("export {};");
      expect(await cachedText(b.caches, precacheName("v2"), "/offline")).toBe("<p>offline</p>");
    });

    it("fetches a fallback that is also a plan URL once, since Cache.addAll refuses duplicate requests", async () => {
      const b = browser();
      await b.worker({ ...PLAN, urls: [...PLAN.urls, "/offline"] }).lifecycle("install");
      expect(b.server.requests.toSorted()).toEqual(["/assets/app.abc.css", "/assets/app.def.js", "/offline"]);
    });

    it("precaches only the plan URLs when the plan has no fallback", async () => {
      const b = browser();
      await b.worker({ urls: PLAN.urls, version: "v2" }).lifecycle("install");
      expect(b.server.requests.toSorted()).toEqual(["/assets/app.abc.css", "/assets/app.def.js"]);
      expect(await cachedText(b.caches, precacheName("v2"), "/offline")).toBeUndefined();
    });

    it("rejects the install and caches nothing when one plan URL is not ok", async () => {
      const b = browser();
      const install = b.worker({ ...PLAN, urls: [...PLAN.urls, "/assets/missing.js"] }).lifecycle("install");
      await expect(install).rejects.toThrow(TypeError);
      for (const url of [...PLAN.urls, "/offline", "/assets/missing.js"]) {
        expect(await cachedText(b.caches, precacheName("v2"), url)).toBeUndefined();
      }
    });

    it("fetches every precached entry without credentials, so no signed-in page outlives sign-out in the cache", async () => {
      const b = browser();
      const platformRequest = globalThis.Request;
      // Bun's Request reads every `credentials` back as "include", so this one keeps the mode it was built with.
      globalThis.Request = class extends platformRequest {
        readonly #credentials: RequestCredentials;
        constructor(input: RequestInfo | URL, init?: RequestInit) {
          super(input, init);
          this.#credentials = init?.credentials ?? "same-origin";
        }
        override get credentials(): RequestCredentials {
          return this.#credentials;
        }
      };
      try {
        await b.worker().lifecycle("install");
      } finally {
        globalThis.Request = platformRequest;
      }
      expect(b.credentials).toEqual(["omit", "omit", "omit"]);
    });

    it("claims no clients before activation", async () => {
      const b = browser();
      await b.worker().lifecycle("install");
      expect(b.claims).toEqual([]);
    });
  });

  describe("activate", () => {
    it("drops older precaches, keeps caches it does not own and the current version, then claims clients", async () => {
      const b = browser();
      await b.caches.open(precacheName("v1"));
      await b.caches.open("app-images");
      const sw = b.worker();
      await sw.lifecycle("install");
      await sw.lifecycle("activate");
      expect(await b.caches.keys()).toEqual(["app-images", precacheName("v2")]);
      expect(b.claims).toEqual([["app-images", precacheName("v2")]]);
      expect(await cachedText(b.caches, precacheName("v2"), "/assets/app.abc.css")).toBe("body{margin:0}");
    });

    it("keeps the precaches of a service worker at another scope on the same origin", async () => {
      const b = browser();
      const admin = b.worker({ urls: ["/assets/app.abc.css"], version: "v1" }, "http://test/admin/");
      await admin.lifecycle("install");
      await admin.lifecycle("activate");
      const sw = b.worker();
      await sw.lifecycle("install");
      await sw.lifecycle("activate");
      expect(await b.caches.keys()).toEqual([precacheName("v1", "http://test/admin/"), precacheName("v2")]);
      expect(await cachedText(b.caches, precacheName("v1", "http://test/admin/"), "/assets/app.abc.css")).toBe("body{margin:0}");
    });

    it("leaves the old version serving until the new version activates", async () => {
      const b = browser();
      const v1 = b.worker({ urls: ["/assets/app.abc.css"], version: "v1" });
      await v1.lifecycle("install");
      await v1.lifecycle("activate");
      b.assets["/assets/app.abc.css"] = "body{margin:1px}";
      const v2 = b.worker({ urls: ["/assets/app.abc.css"], version: "v2" });

      await v2.lifecycle("install");
      expect(await b.caches.keys()).toEqual([precacheName("v1"), precacheName("v2")]);
      expect(await v1.fetchThrough(buildRequest("/assets/app.abc.css"))?.then((r) => r.text())).toBe("body{margin:0}");

      await v2.lifecycle("activate");
      expect(await b.caches.keys()).toEqual([precacheName("v2")]);
      expect(await v2.fetchThrough(buildRequest("/assets/app.abc.css"))?.then((r) => r.text())).toBe("body{margin:1px}");
    });
  });

  describe("fetch", () => {
    it("serves a precached asset from cache without touching the network", async () => {
      const b = browser();
      const sw = b.worker();
      await sw.lifecycle("install");
      b.offline();
      const response = await sw.fetchThrough(buildRequest("/assets/app.def.js"));
      expect(await response?.text()).toBe("export {};");
    });

    it.each([
      { name: "a relative plan URL, requested absolutely", url: "/assets/app.js", request: "http://test/assets/app.js" },
      { name: "an absolute plan URL, requested by path", url: "http://test/assets/app.js", request: "/assets/app.js" },
      { name: "a plan URL carrying a query string, requested with the same query", url: "/assets/app.js?v=3", request: "/assets/app.js?v=3" },
    ])("serves $name from cache", async ({ url, request }) => {
      const b = browser();
      b.assets["/assets/app.js"] = "cached();";
      const sw = b.worker({ urls: [url], version: "v1" });
      await sw.lifecycle("install");
      b.offline();
      expect(await sw.fetchThrough(buildRequest(request))?.then((r) => r.text())).toBe("cached();");
    });

    it.each([
      { name: "a POST to a precached URL", request: () => buildRequest("/assets/app.def.js", { method: "POST", body: "x" }) },
      {
        name: "a POST navigation, as a form submission is",
        request: () => buildRequest("/settings", { method: "POST", body: "x", mode: "navigate" }),
      },
      { name: "a HEAD to a precached URL", request: () => buildRequest("/assets/app.def.js", { method: "HEAD" }) },
      { name: "an asset outside the plan", request: () => buildRequest("/assets/other.png") },
      { name: "a precached path with a query string the plan does not carry", request: () => buildRequest("/assets/app.def.js?v=9") },
      { name: "a precached path on another origin", request: () => buildRequest("/assets/app.def.js", { baseUrl: "http://cdn.test" }) },
    ])("leaves $name to the browser, offline as online", async ({ request }) => {
      const b = browser();
      const sw = b.worker();
      await sw.lifecycle("install");
      expect(sw.fetchThrough(request())).toBeUndefined();
      b.offline();
      expect(sw.fetchThrough(request())).toBeUndefined();
    });

    it("fetches a precached URL missing from the cache from the network", async () => {
      const b = browser();
      const response = await b.worker().fetchThrough(buildRequest("/assets/app.def.js"));
      expect(await response?.text()).toBe("export {};");
      expect(b.server.requests).toEqual(["/assets/app.def.js"]);
    });

    it("propagates the network error for a precached URL missing from the cache while offline", async () => {
      const b = browser();
      const sw = b.worker();
      b.offline();
      await expect(sw.fetchThrough(buildRequest("/assets/app.def.js")) as Promise<Response>).rejects.toThrow("Failed to fetch");
    });
  });

  describe("navigation", () => {
    it("answers from the network while it is reachable", async () => {
      const b = browser();
      const sw = b.worker({ ...PLAN, urls: [] });
      await sw.lifecycle("install");
      const response = await sw.fetchThrough(buildRequest("/assets/app.abc.css", { mode: "navigate" }));
      expect(await response?.text()).toBe("body{margin:0}");
    });

    it("passes a network error status through rather than falling back", async () => {
      const b = browser();
      const sw = b.worker();
      await sw.lifecycle("install");
      const response = await sw.fetchThrough(buildRequest("/settings", { mode: "navigate" }));
      expect({ status: response?.status, body: await response?.text() }).toEqual({ status: 404, body: "Not Found" });
    });

    it("falls back to the precached page when the network cannot be reached", async () => {
      const b = browser();
      const sw = b.worker();
      await sw.lifecycle("install");
      b.offline();
      const response = await sw.fetchThrough(buildRequest("/settings", { mode: "navigate" }));
      expect({ status: response?.status, type: response?.headers.get("content-type"), body: await response?.text() }).toEqual({
        status: 200,
        type: "text/html",
        body: "<p>offline</p>",
      });
    });

    it("answers a network error response offline when the fallback was never cached", async () => {
      const b = browser();
      const sw = b.worker();
      b.offline();
      const response = await sw.fetchThrough(buildRequest("/settings", { mode: "navigate" }));
      expect({ type: response?.type, status: response?.status }).toEqual({ type: "error", status: 0 });
    });

    it("never falls back for a request that is not a navigation", async () => {
      const b = browser();
      const sw = b.worker();
      await sw.lifecycle("install");
      b.offline();
      expect(sw.fetchThrough(buildRequest("/api/settings"))).toBeUndefined();
    });

    it("leaves an offline navigation to the browser when the plan has no fallback", async () => {
      const b = browser();
      const sw = b.worker({ urls: PLAN.urls, version: "v2" });
      await sw.lifecycle("install");
      b.offline();
      expect(sw.fetchThrough(buildRequest("/settings", { mode: "navigate" }))).toBeUndefined();
    });

    it("serves an offline navigation to a precached URL from cache rather than the fallback", async () => {
      const b = browser();
      const sw = b.worker();
      await sw.lifecycle("install");
      b.offline();
      const response = await sw.fetchThrough(buildRequest("/assets/app.abc.css", { mode: "navigate" }));
      expect(await response?.text()).toBe("body{margin:0}");
    });

    it("falls back offline for a navigation to a precached URL missing from the cache", async () => {
      const b = browser();
      await b.worker({ ...PLAN, urls: [] }).lifecycle("install");
      const sw = b.worker();
      b.offline();
      const response = await sw.fetchThrough(buildRequest("/assets/app.abc.css", { mode: "navigate" }));
      expect(await response?.text()).toBe("<p>offline</p>");
    });

    it("serves a navigation to a precached URL from cache when the plan has no fallback", async () => {
      const b = browser();
      const sw = b.worker({ urls: PLAN.urls, version: "v2" });
      await sw.lifecycle("install");
      b.offline();
      const response = await sw.fetchThrough(buildRequest("/assets/app.abc.css", { mode: "navigate" }));
      expect(await response?.text()).toBe("body{margin:0}");
    });
  });
});
