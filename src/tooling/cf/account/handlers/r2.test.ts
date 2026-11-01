import { describe, expect, it } from "bun:test";

import type { WranglerConfig } from "../../types";
import { r2Handler } from "./r2";
import type { HandlerContext } from "./types";

const AUTH = { apiToken: "tok", accountId: "acc" };

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return { auth: AUTH, scriptName: "worker", prefix: "", dryRun: false, rotate: new Set<string>(), fetch: globalThis.fetch, ...overrides };
}

const ok = (result: unknown, result_info?: unknown): Response =>
  new Response(JSON.stringify({ success: true, errors: [], messages: [], result, ...(result_info ? { result_info } : {}) }));

function makeFetch(buckets: string[], putOk = true): typeof globalThis.fetch {
  return pagedFetch({ "": { buckets } }, putOk).fetchFn;
}

function pagedFetch(
  pages: Record<string, { buckets?: string[]; next?: string; info?: boolean }>,
  putOk = true,
): { fetchFn: typeof globalThis.fetch; cursors: (string | null)[]; puts: string[] } {
  const cursors: (string | null)[] = [];
  const puts: string[] = [];
  const fetchFn: typeof globalThis.fetch = async (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PUT") {
      puts.push(String(url));
      if (!putOk)
        return new Response(JSON.stringify({ success: false, errors: [{ code: 1, message: "fail" }], messages: [], result: null }), {
          status: 400,
        });
      return ok(null);
    }
    const cursor = new URL(String(url)).searchParams.get("cursor");
    cursors.push(cursor);
    const page = pages[cursor ?? ""];
    const result = page?.buckets === undefined ? {} : { buckets: page.buckets.map((name) => ({ name })) };
    const info = page?.next !== undefined ? { cursor: page.next, per_page: 100 } : page?.info ? { per_page: 100 } : undefined;
    return ok(result, info);
  };
  return { fetchFn, cursors, puts };
}

describe("r2Handler.extract()", () => {
  it("returns empty when no r2_buckets", () => {
    expect(r2Handler.extract({ name: "t" } as WranglerConfig)).toEqual([]);
  });
});

describe("r2Handler.reconcile()", () => {
  it("reports exists when bucket found", async () => {
    const res = await r2Handler.reconcile([{ binding: "MY_BUCKET", bucket_name: "my-bucket" }], makeCtx({ fetch: makeFetch(["my-bucket"]) }));
    expect(res.results[0]?.action).toBe("in-sync");
    expect(res.results[0]?.remoteName).toBe("my-bucket");
  });

  it("creates bucket when not found", async () => {
    const res = await r2Handler.reconcile([{ binding: "MY_BUCKET" }], makeCtx({ fetch: makeFetch([]) }));
    expect(res.results[0]?.action).toBe("created");
  });

  it("skips in dry-run", async () => {
    const res = await r2Handler.reconcile([{ binding: "MY_BUCKET" }], makeCtx({ fetch: makeFetch([]), dryRun: true }));
    expect(res.results[0]?.action).toBe("would-create");
    expect([res.results[0]?.local, res.results[0]?.remote]).toEqual([true, false]);
    expect(res.results[0]?.remoteName).toBe("my-bucket");
  });

  it("reports error on creation failure", async () => {
    const res = await r2Handler.reconcile([{ binding: "MY_BUCKET" }], makeCtx({ fetch: makeFetch([], false) }));
    expect(res.results[0]?.action).toBe("error");
  });
});

describe("r2Handler.reconcile() — an explicit bucket_name is the identity", () => {
  it("uses bucket_name even when a prefix is in force", async () => {
    const fetchFn = makeFetch(["existing-bucket"]);
    const res = await r2Handler.reconcile([{ binding: "ASSETS", bucket_name: "existing-bucket" }], makeCtx({ fetch: fetchFn, prefix: "PROJ" }));
    expect(res.results[0]?.action).toBe("in-sync");
    expect(res.results[0]?.remoteName).toBe("existing-bucket");
  });
});

describe("r2Handler.reconcile() — listing follows the cursor", () => {
  it("finds a bucket on the third page by following every cursor", async () => {
    const { fetchFn, cursors } = pagedFetch({
      "": { buckets: ["a"], next: "c1" },
      c1: { buckets: ["b"], next: "c2" },
      c2: { buckets: ["my-bucket"], info: true },
    });
    const res = await r2Handler.reconcile([{ binding: "MY_BUCKET", bucket_name: "my-bucket" }], makeCtx({ fetch: fetchFn }));
    expect(res.results[0]?.action).toBe("in-sync");
    expect(cursors).toEqual([null, "c1", "c2"]);
  });

  it("reads a result without buckets as an empty account rather than throwing", async () => {
    const { fetchFn } = pagedFetch({ "": {} });
    const res = await r2Handler.reconcile([{ binding: "MY_BUCKET" }], makeCtx({ fetch: fetchFn, dryRun: true }));
    expect(res.results[0]?.action).toBe("would-create");
  });

  it("gives an in-sync bucket its name as its remote id, with no id step to report", async () => {
    const res = await r2Handler.reconcile([{ binding: "MY_BUCKET", bucket_name: "my-bucket" }], makeCtx({ fetch: makeFetch(["my-bucket"]) }));
    expect([res.results[0]?.remoteId, res.results[0]?.detail]).toEqual(["my-bucket", undefined]);
  });

  it("reports an error and creates nothing when a full first page carries no paging metadata", async () => {
    const full = Array.from({ length: 100 }, (_, i) => `bucket-${i}`);
    const { fetchFn, puts } = pagedFetch({ "": { buckets: full } });
    const res = await r2Handler.reconcile([{ binding: "MY_BUCKET" }], makeCtx({ fetch: fetchFn }));
    expect(res.results[0]?.action).toBe("error");
    expect(puts).toEqual([]);
  });
});
