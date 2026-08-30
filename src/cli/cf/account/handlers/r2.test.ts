import { describe, expect, it } from "bun:test";
import type { WranglerConfig } from "../../types";
import { r2Handler } from "./r2";
import type { HandlerContext } from "./types";

const AUTH = { apiToken: "tok", accountId: "acc" };

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    auth: AUTH,
    scriptName: "worker",
    prefix: "",
    dryRun: false,
    rotate: new Set<string>(),
    fetch: globalThis.fetch,
    target: { kind: "worker", name: "worker" },
    ...overrides,
  };
}

function makeFetch(buckets: string[], putOk = true): typeof globalThis.fetch {
  return async (_url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PUT") {
      if (!putOk)
        return new Response(JSON.stringify({ success: false, errors: [{ code: 1, message: "fail" }], messages: [], result: null }), {
          status: 400,
        });
      return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: null }));
    }
    return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: { buckets: buckets.map((name) => ({ name })) } }));
  };
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
    // A bucket has no id, so its name is the only handle on it; overriding an
    // explicit name with the computed one created a second, empty bucket.
    const fetchFn = makeFetch(["existing-bucket"]);
    const res = await r2Handler.reconcile([{ binding: "ASSETS", bucket_name: "existing-bucket" }], makeCtx({ fetch: fetchFn, prefix: "PROJ" }));
    expect(res.results[0]?.action).toBe("in-sync");
    expect(res.results[0]?.remoteName).toBe("existing-bucket");
  });
});
