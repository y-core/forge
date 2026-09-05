import { describe, expect, it } from "bun:test";

import type { WranglerConfig } from "../../types";
import { kvHandler } from "./kv";
import type { HandlerContext } from "./types";

const AUTH = { apiToken: "tok", accountId: "acc" };

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    auth: AUTH,
    scriptName: "my-worker",
    prefix: "",
    dryRun: false,
    rotate: new Set<string>(),
    fetch: globalThis.fetch,
    target: { kind: "worker", name: "my-worker" },
    ...overrides,
  };
}

function makeFetch(namespaces: unknown[], createResult?: unknown): typeof globalThis.fetch {
  let callCount = 0;
  return async (_url: string | URL | Request, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET") {
      return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: namespaces }));
    }
    callCount++;
    return new Response(
      JSON.stringify({ success: true, errors: [], messages: [], result: createResult ?? { id: `new-id-${callCount}`, title: "created" } }),
    );
  };
}

describe("kvHandler.extract()", () => {
  it("returns empty array when kv_namespaces absent", () => {
    const config = { name: "test" } as WranglerConfig;
    expect(kvHandler.extract(config)).toEqual([]);
  });

  it("returns kv_namespaces array", () => {
    const config: WranglerConfig = { name: "test", kv_namespaces: [{ binding: "MY_KV" }] };
    expect(kvHandler.extract(config)).toEqual([{ binding: "MY_KV" }]);
  });
});

describe("kvHandler.reconcile()", () => {
  it("returns empty results for empty entries", async () => {
    const ctx = makeCtx();
    const res = await kvHandler.reconcile([], ctx);
    expect(res.results).toHaveLength(0);
  });

  it("reports exists when remote namespace found", async () => {
    const fetchFn = makeFetch([{ id: "ns-1", title: "MY_KV" }]);
    const ctx = makeCtx({ fetch: fetchFn });
    const res = await kvHandler.reconcile([{ binding: "MY_KV" }], ctx);
    expect(res.results[0]?.action).toBe("in-sync");
    expect(res.results[0]?.remoteId).toBe("ns-1");
    expect(res.results[0]?.remoteName).toBe("MY_KV");
  });

  it("creates namespace when not found", async () => {
    const fetchFn = makeFetch([], { id: "new-ns", title: "MY_KV" });
    const ctx = makeCtx({ fetch: fetchFn });
    const res = await kvHandler.reconcile([{ binding: "MY_KV" }], ctx);
    expect(res.results[0]?.action).toBe("created");
    expect(res.results[0]?.remoteId).toBe("new-ns");
    expect(res.entries[0]?.id).toBe("new-ns");
  });

  it("skips creation in dry-run mode", async () => {
    const fetchFn = makeFetch([]);
    const ctx = makeCtx({ fetch: fetchFn, dryRun: true });
    const res = await kvHandler.reconcile([{ binding: "MY_KV" }], ctx);
    expect(res.results[0]?.action).toBe("would-create");
    expect([res.results[0]?.local, res.results[0]?.remote]).toEqual([true, false]);
    expect(res.results[0]?.remoteName).toBe("MY_KV");
  });

  it("applies prefix to remote name", async () => {
    let capturedBody: string | null = null;
    const fetchFn: typeof globalThis.fetch = async (_url, init) => {
      if ((init?.method ?? "GET") === "POST") {
        capturedBody = init?.body as string;
        return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: { id: "x", title: "PROJ_MY_KV" } }));
      }
      return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: [] }));
    };
    const ctx = makeCtx({ fetch: fetchFn, prefix: "PROJ" });
    const res = await kvHandler.reconcile([{ binding: "MY_KV" }], ctx);
    expect(JSON.parse(capturedBody!).title).toBe("PROJ_MY_KV");
    expect(res.results[0]?.remoteName).toBe("PROJ_MY_KV");
  });

  it("reports error when list API fails", async () => {
    const errFetch: typeof globalThis.fetch = async () => {
      return new Response(JSON.stringify({ success: false, errors: [{ code: 1, message: "auth failed" }], messages: [], result: null }), {
        status: 403,
      });
    };
    const ctx = makeCtx({ fetch: errFetch });
    const res = await kvHandler.reconcile([{ binding: "MY_KV" }], ctx);
    expect(res.results[0]?.action).toBe("error");
    expect(res.results[0]?.detail).toBe(
      'worker script · auth failed — CLOUDFLARE_API_TOKEN is rejected or lacks "Workers Scripts" (Read to report, Edit to change) · code 1',
    );
  });

  it("reports a list that 404s as unavailable, not as an error", async () => {
    const notFound: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ success: false, errors: [{ code: 7003, message: "Could not route" }], messages: [], result: null }), {
        status: 404,
      });
    const res = await kvHandler.reconcile([{ binding: "MY_KV" }], makeCtx({ fetch: notFound }));
    expect(res.results[0]?.action).toBe("unavailable");
  });
});

describe("kvHandler.reconcile() — the id is the identity", () => {
  it("matches by id even when the namespace is titled something else", async () => {
    // The duplicate-creation bug: a title-only lookup misses a namespace provisioned
    // outside this tool, and --commit would create a second namespace beside it.
    const fetchFn = makeFetch([{ id: "ns-legacy", title: "hand-made-cache" }]);
    const ctx = makeCtx({ fetch: fetchFn, prefix: "PROJ" });

    const res = await kvHandler.reconcile([{ binding: "CACHE", id: "ns-legacy" }], ctx);

    expect(res.results[0]?.action).toBe("in-sync");
    expect(res.results[0]?.remoteId).toBe("ns-legacy");
    expect(res.results[0]?.remoteName).toBe("hand-made-cache");
  });

  it("creates nothing when the id resolves", async () => {
    const methods: string[] = [];
    const fetchFn: typeof globalThis.fetch = async (_url, init) => {
      methods.push((init?.method ?? "GET").toUpperCase());
      return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: [{ id: "ns-1", title: "other" }] }));
    };
    const res = await kvHandler.reconcile([{ binding: "CACHE", id: "ns-1" }], makeCtx({ fetch: fetchFn, prefix: "PROJ" }));
    expect(methods).toEqual(["GET"]);
    expect(res.entries[0]).toEqual({ binding: "CACHE", id: "ns-1" });
  });

  it("prefers the id over a namespace whose title happens to match", async () => {
    const fetchFn = makeFetch([
      { id: "ns-bound", title: "unrelated" },
      { id: "ns-namesake", title: "MY_KV" },
    ]);
    const res = await kvHandler.reconcile([{ binding: "MY_KV", id: "ns-bound" }], makeCtx({ fetch: fetchFn }));
    expect(res.results[0]?.remoteId).toBe("ns-bound");
    expect(res.entries[0]?.id).toBe("ns-bound");
  });

  it("falls back to the name when the id is stale, and says so", async () => {
    const fetchFn = makeFetch([{ id: "ns-current", title: "MY_KV" }]);
    const res = await kvHandler.reconcile([{ binding: "MY_KV", id: "ns-deleted" }], makeCtx({ fetch: fetchFn }));
    expect(res.results[0]?.action).toBe("in-sync");
    expect(res.results[0]?.remoteId).toBe("ns-current");
    expect(res.results[0]?.detail).toBe("local id ns-deleted not found on this account");
    expect(res.entries[0]?.id).toBe("ns-current");
  });

  it("names the stale id on the row that creates a replacement", async () => {
    const fetchFn = makeFetch([], { id: "ns-new", title: "MY_KV" });
    const res = await kvHandler.reconcile([{ binding: "MY_KV", id: "ns-deleted" }], makeCtx({ fetch: fetchFn }));
    expect(res.results[0]?.action).toBe("created");
    expect(res.results[0]?.detail).toBe("local id ns-deleted not found on this account");
  });
});
