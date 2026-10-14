import { describe, expect, it } from "bun:test";

import { createCfClient } from "./client";
import { describeCfFailure } from "./errors";
import { CfApiClientError } from "./types";

const AUTH = { apiToken: "test-token", accountId: "acc-123" };

function makeFetch(status: number, body: unknown): typeof globalThis.fetch {
  return async (_url, _init) => new Response(JSON.stringify(body), { status });
}

function makeNetworkError(): typeof globalThis.fetch {
  return async () => {
    throw new Error("connection refused");
  };
}

function makeBadJson(): typeof globalThis.fetch {
  return async () => new Response("not json", { status: 200 });
}

describe("createCfClient()", () => {
  it("returns data on success", async () => {
    const fetchFn = makeFetch(200, { success: true, errors: [], messages: [], result: { id: "abc" } });
    const client = createCfClient(AUTH, fetchFn);
    const r = await client.get<{ id: string }>("/accounts/acc/kv");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.id).toBe("abc");
  });

  it("sends Authorization header", async () => {
    let capturedHeaders: HeadersInit | undefined;
    const fetchFn: typeof globalThis.fetch = async (_url, init) => {
      capturedHeaders = init?.headers;
      return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: null }), { status: 200 });
    };
    const client = createCfClient(AUTH, fetchFn);
    await client.get("/path");
    const headers = new Headers(capturedHeaders as HeadersInit);
    expect(headers.get("Authorization")).toBe("Bearer test-token");
  });

  it("returns network error on fetch throw", async () => {
    const client = createCfClient(AUTH, makeNetworkError());
    const r = await client.get("/path");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(CfApiClientError);
      expect(r.error.kind).toBe("network");
    }
  });

  it("returns parse error on bad JSON", async () => {
    const client = createCfClient(AUTH, makeBadJson());
    const r = await client.get("/path");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("parse");
  });

  it("returns api error when success=false", async () => {
    const fetchFn = makeFetch(400, { success: false, errors: [{ code: 10000, message: "Authentication error" }], messages: [], result: null });
    const client = createCfClient(AUTH, fetchFn);
    const r = await client.get("/path");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("api");
      expect(r.error.message).toContain("Authentication error");
      expect(r.error.cfErrors?.[0]?.code).toBe(10000);
    }
  });

  it("sends body for POST requests", async () => {
    let capturedBody: string | null = null;
    const fetchFn: typeof globalThis.fetch = async (_url, init) => {
      capturedBody = init?.body as string;
      return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: { id: "new" } }), { status: 200 });
    };
    const client = createCfClient(AUTH, fetchFn);
    await client.post("/path", { name: "my-kv" });
    expect(JSON.parse(capturedBody!)).toEqual({ name: "my-kv" });
  });
});

describe("an auth failure names the permission the surface needs", () => {
  const rejected = new CfApiClientError("api", "Authentication error", {
    statusCode: 403,
    cfErrors: [{ code: 10000, message: "Authentication error" }],
  });

  it("names the Workers permission on a worker target", () => {
    expect(describeCfFailure(rejected, "w")).toContain('lacks "Workers Scripts"');
  });

  it("states both possibilities, because Cloudflare returns one code for both", () => {
    expect(describeCfFailure(rejected, "w")).toContain("is rejected or lacks");
  });

  it("carries the code into a redacted row, since a code cannot echo a payload", () => {
    const detail = describeCfFailure(rejected, "w", { redactMessage: true });
    expect(detail).toContain("code 10000");
    expect(detail).not.toContain("Authentication error");
  });
});

function honouringSignal(): typeof globalThis.fetch {
  return (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    });
}

function bodyStallingUntilAbort(): typeof globalThis.fetch {
  return async (_url, init) =>
    new Response(
      new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
        },
      }),
      { status: 200 },
    );
}

function answeringAfter(ms: number): typeof globalThis.fetch {
  return (_url, init) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => resolve(new Response(JSON.stringify({ success: true, errors: [], messages: [], result: "answered" }), { status: 200 })),
        ms,
      );
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(init.signal?.reason);
      });
    });
}

describe("createCfClient() — the request deadline", () => {
  it("reports a request that never answers as a network timeout naming the deadline", async () => {
    const r = await createCfClient(AUTH, honouringSignal(), 5).get("/path");
    expect(r.ok ? null : { kind: r.error.kind, message: r.error.message }).toEqual({ kind: "network", message: "timed out after 5ms" });
  });

  it("reports a body that stalls past the deadline as a network timeout, not a parse failure", async () => {
    const r = await createCfClient(AUTH, bodyStallingUntilAbort(), 5).get("/path");
    expect(r.ok ? null : { kind: r.error.kind, message: r.error.message }).toEqual({ kind: "network", message: "timed out after 5ms" });
  });

  it("gives each request its own deadline, so two calls whose sum exceeds it both succeed", async () => {
    const client = createCfClient(AUTH, answeringAfter(150), 250);
    const first = await client.get<string>("/one");
    const second = await client.get<string>("/two");
    expect([first, second]).toEqual([
      { ok: true, data: "answered" },
      { ok: true, data: "answered" },
    ]);
  });
});

describe("createCfClient().list()", () => {
  it("follows result_info pagination and gathers every page into one array", async () => {
    const pages: Record<string, string[]> = { "1": ["a", "b"], "2": ["c"] };
    const asked: (string | null)[] = [];
    const fetchFn: typeof globalThis.fetch = async (url) => {
      const page = new URL(String(url)).searchParams.get("page");
      asked.push(page);
      const result = pages[page ?? ""] ?? [];
      return new Response(
        JSON.stringify({
          success: true,
          errors: [],
          messages: [],
          result,
          result_info: { page: Number(page), per_page: 2, count: result.length, total_count: 3 },
        }),
        { status: 200 },
      );
    };
    const r = await createCfClient(AUTH, fetchFn).list<string>("/accounts/acc/storage/kv/namespaces");
    expect(r).toEqual({ ok: true, data: ["a", "b", "c"] });
    expect(asked).toEqual(["1", "2"]);
  });
});
