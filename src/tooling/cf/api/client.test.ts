import { describe, expect, it } from "bun:test";

import { v } from "../../../validation/validation";
import { createCfClient, readRetryAfterMs } from "./client";
import { classifyCfError, describeCfFailure } from "./errors";
import { CfApiClientError } from "./types";
import type { CfListOperation, CfOperation } from "./types";

const AUTH = { apiToken: "test-token", accountId: "acc-123" };

const ANY: CfOperation<unknown> = { name: "GET /test", result: v.unknown() };
const PAGED: CfListOperation<string> = { name: "GET /test", paging: "page", result: v.array(v.string()) };
const CURSORED: CfListOperation<string> = { name: "GET /test", paging: "cursor", result: v.array(v.string()) };

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
    const r = await client.get("/accounts/acc/kv", { name: "GET /test", result: v.object({ id: v.string() }) });
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
    await client.get("/path", ANY);
    const headers = new Headers(capturedHeaders as HeadersInit);
    expect(headers.get("Authorization")).toBe("Bearer test-token");
  });

  it("returns network error on fetch throw", async () => {
    const client = createCfClient(AUTH, makeNetworkError());
    const r = await client.get("/path", ANY);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(CfApiClientError);
      expect(r.error.kind).toBe("network");
    }
  });

  it("returns parse error on bad JSON", async () => {
    const client = createCfClient(AUTH, makeBadJson());
    const r = await client.get("/path", ANY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("parse");
  });

  it("returns api error when success=false", async () => {
    const fetchFn = makeFetch(400, { success: false, errors: [{ code: 10000, message: "Authentication error" }], messages: [], result: null });
    const client = createCfClient(AUTH, fetchFn);
    const r = await client.get("/path", ANY);
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
    await client.post("/path", { name: "my-kv" }, ANY);
    expect(JSON.parse(capturedBody!)).toEqual({ name: "my-kv" });
  });

  it("sends a PATCH with its JSON body and content type, and parses the result through the operation", async () => {
    const sent: { method: string | undefined; contentType: string | null; body: unknown }[] = [];
    const fetchFn: typeof globalThis.fetch = async (_url, init) => {
      sent.push({ method: init?.method, contentType: new Headers(init?.headers).get("Content-Type"), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: { id: "patched" } }), { status: 200 });
    };
    const r = await createCfClient(AUTH, fetchFn).patch("/path", { a: { b: 1 } }, { name: "PATCH /test", result: v.object({ id: v.string() }) });
    expect(r).toEqual({ ok: true, data: { id: "patched" } });
    expect(sent).toEqual([{ method: "PATCH", contentType: "application/json", body: { a: { b: 1 } } }]);
  });

  it("refuses a PATCH result the operation's schema rejects, naming the operation", async () => {
    const r = await createCfClient(AUTH, makeFetch(200, { success: true, result: { id: 7 } })).patch(
      "/path",
      {},
      { name: "PATCH /test", result: v.object({ id: v.string() }) },
    );
    expect(r.ok ? null : r.error.message).toBe("PATCH /test: unexpected response shape at id (expected string)");
  });
});

describe("createCfClient() — the response shape", () => {
  const BUCKETS: CfOperation<{ name: string }[]> = {
    name: "GET /buckets",
    result: v.pipe(
      v.object({ buckets: v.array(v.object({ name: v.string() })) }),
      v.transform((r) => r.buckets),
    ),
  };
  const refusal = (r: { ok: true } | { ok: false; error: CfApiClientError }) =>
    r.ok ? null : { kind: r.error.kind, message: r.error.message, statusCode: r.error.statusCode };

  it("refuses a 2xx body that is not an envelope as a schema error naming the operation and the field", async () => {
    const r = await createCfClient(AUTH, makeFetch(200, { success: "yes", result: {} })).get("/path", ANY);
    expect(refusal(r)).toEqual({ kind: "schema", message: "GET /test: unexpected response shape at success (expected boolean)", statusCode: 200 });
  });

  it("reads a non-envelope body on a 404 as an api error, so the status still classifies it", async () => {
    const r = await createCfClient(AUTH, makeFetch(404, { message: "not here" })).get("/path", ANY);
    expect(refusal(r)).toEqual({ kind: "api", message: "API error (HTTP 404)", statusCode: 404 });
    expect(r.ok ? null : classifyCfError(r.error)).toBe("not-found");
  });

  it("takes the message from a codeless error item and keeps it out of cfErrors", async () => {
    const r = await createCfClient(AUTH, makeFetch(400, { success: false, errors: [{ message: "bad input" }], result: null })).get("/path", ANY);
    expect(r.ok ? null : [r.error.kind, r.error.message, r.error.cfErrors]).toEqual(["api", "bad input", []]);
  });

  it("names the result itself when the root has the wrong type", async () => {
    const r = await createCfClient(AUTH, makeFetch(200, { success: true, result: "nope" })).get("/path", BUCKETS);
    expect(r.ok ? null : r.error.message).toBe("GET /buckets: unexpected response shape at result (expected Object)");
  });

  it("names the nested path of a wrong-typed field", async () => {
    const r = await createCfClient(AUTH, makeFetch(200, { success: true, result: { buckets: [{ name: 7 }] } })).get("/path", BUCKETS);
    expect(r.ok ? null : r.error.message).toBe("GET /buckets: unexpected response shape at buckets.0.name (expected string)");
  });

  it("never quotes the received value of a wrong-typed field", async () => {
    const r = await createCfClient(AUTH, makeFetch(200, { success: true, result: { buckets: [{ name: { leak: "SENTINEL-7f3a" } }] } })).get(
      "/path",
      BUCKETS,
    );
    expect(r.ok ? null : r.error.kind).toBe("schema");
    expect(r.ok ? null : r.error.message).not.toContain("SENTINEL-7f3a");
  });

  const LIMITS: CfOperation<{ limit: number }> = { name: "GET /limits", result: v.object({ limit: v.number() }) };

  for (const { label, body, operation, message } of [
    {
      label: "a result field",
      body: { success: true, result: { limit: "SENTINEL-7f3a" } },
      operation: LIMITS,
      message: "GET /limits: unexpected response shape at limit (expected number)",
    },
    {
      label: "the envelope",
      body: { success: "SENTINEL-7f3a", result: {} },
      operation: ANY,
      message: "GET /test: unexpected response shape at success (expected boolean)",
    },
  ]) {
    it(`never quotes a wrong-typed string in ${label}, which valibot's own issue text would`, async () => {
      const r = await createCfClient(AUTH, makeFetch(200, body)).get("/path", operation);
      expect(refusal(r)).toEqual({ kind: "schema", message, statusCode: 200 });
    });
  }

  it("names the body itself when the reply is not an object at all", async () => {
    const r = await createCfClient(AUTH, makeFetch(200, null)).get("/path", ANY);
    expect(refusal(r)).toEqual({ kind: "schema", message: "GET /test: unexpected response shape at body (expected Object)", statusCode: 200 });
  });

  it("names a field once, and with no expected type, when only checks refused it", async () => {
    const checked: CfOperation<string> = {
      name: "GET /checked",
      result: v.pipe(
        v.string(),
        v.check(() => false, "first"),
        v.check(() => false, "second"),
      ),
    };
    const r = await createCfClient(AUTH, makeFetch(200, { success: true, result: "x" })).get("/path", checked);
    expect(r.ok ? null : r.error.message).toBe("GET /checked: unexpected response shape at result");
  });

  it("lists every refused field, in order, separated by commas", async () => {
    const r = await createCfClient(AUTH, makeFetch(200, { success: true, result: { buckets: [{ name: 7 }, { name: false }] } })).get(
      "/path",
      BUCKETS,
    );
    expect(r.ok ? null : r.error.message).toBe(
      "GET /buckets: unexpected response shape at buckets.0.name (expected string), buckets.1.name (expected string)",
    );
  });

  it("passes a correctly typed value through as data", async () => {
    const r = await createCfClient(AUTH, makeFetch(200, { success: true, result: { buckets: [{ name: "SENTINEL-7f3a" }] } })).get("/path", BUCKETS);
    expect(r).toEqual({ ok: true, data: [{ name: "SENTINEL-7f3a" }] });
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
    const r = await createCfClient(AUTH, honouringSignal(), 5).get("/path", ANY);
    expect(r.ok ? null : { kind: r.error.kind, message: r.error.message }).toEqual({ kind: "network", message: "timed out after 5ms" });
  });

  it("reports a body that stalls past the deadline as a network timeout, not a parse failure", async () => {
    const r = await createCfClient(AUTH, bodyStallingUntilAbort(), 5).get("/path", ANY);
    expect(r.ok ? null : { kind: r.error.kind, message: r.error.message }).toEqual({ kind: "network", message: "timed out after 5ms" });
  });

  it("gives each request its own deadline, so two calls whose sum exceeds it both succeed", async () => {
    const client = createCfClient(AUTH, answeringAfter(150), 250);
    const first = await client.get("/one", ANY);
    const second = await client.get("/two", ANY);
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
    const r = await createCfClient(AUTH, fetchFn).list("/accounts/acc/storage/kv/namespaces", PAGED);
    expect(r).toEqual({ ok: true, data: ["a", "b", "c"] });
    expect(asked).toEqual(["1", "2"]);
  });

  const PATH = "/accounts/acc/storage/kv/namespaces";

  function envelope(result: unknown, result_info?: unknown): Response {
    return new Response(JSON.stringify({ success: true, errors: [], messages: [], result, ...(result_info ? { result_info } : {}) }), {
      status: 200,
    });
  }

  function recordingFetch(answer: (query: URLSearchParams) => Response): { fetchFn: typeof globalThis.fetch; queries: string[] } {
    const queries: string[] = [];
    const fetchFn: typeof globalThis.fetch = async (url) => {
      const parsed = new URL(String(url));
      queries.push(parsed.search);
      return answer(parsed.searchParams);
    };
    return { fetchFn, queries };
  }

  const names = (count: number, from = 0): string[] => Array.from({ length: count }, (_, i) => `n${from + i}`);

  it("reads every page by total_pages when total_count is absent, gathered in order", async () => {
    const pages: Record<string, string[]> = { "1": ["a", "b"], "2": ["c", "d"], "3": ["e"] };
    const { fetchFn, queries } = recordingFetch((q) => envelope(pages[q.get("page") ?? ""] ?? [], { per_page: 2, total_pages: 3 }));
    const r = await createCfClient(AUTH, fetchFn).list(PATH, PAGED);
    expect(r).toEqual({ ok: true, data: ["a", "b", "c", "d", "e"] });
    expect(queries).toEqual(["?per_page=100&page=1", "?per_page=100&page=2", "?per_page=100&page=3"]);
  });

  it("counts pages by the per_page the API reports, not the one it was asked for", async () => {
    const { fetchFn, queries } = recordingFetch((q) => envelope(Number(q.get("page")) < 3 ? ["x", "y"] : ["z"], { per_page: 2, total_count: 5 }));
    const r = await createCfClient(AUTH, fetchFn).list(PATH, PAGED);
    expect(r.ok ? r.data.length : null).toBe(5);
    expect(queries.length).toBe(3);
  });

  for (const { label, info } of [
    { label: "absent", info: { total_count: 150 } },
    { label: "0", info: { per_page: 0, total_count: 150 } },
  ]) {
    it(`counts pages by the requested 100 when the reported per_page is ${label}`, async () => {
      const pages: Record<string, string[]> = { "1": names(100), "2": names(50, 100) };
      const { fetchFn, queries } = recordingFetch((q) => envelope(pages[q.get("page") ?? ""] ?? [], info));
      const r = await createCfClient(AUTH, fetchFn).list(PATH, PAGED);
      expect(r.ok ? r.data.length : null).toBe(150);
      expect(queries).toEqual(["?per_page=100&page=1", "?per_page=100&page=2"]);
    });
  }

  it("refuses a full page whose result_info carries no count to page by", async () => {
    const { fetchFn, queries } = recordingFetch(() => envelope(names(100), { page: 1, per_page: 100, count: 100 }));
    const r = await createCfClient(AUTH, fetchFn).list(PATH, PAGED);
    expect(r.ok ? null : { kind: r.error.kind, message: r.error.message }).toEqual({
      kind: "paging",
      message: "GET /test: page 1 came back full with no paging metadata, so the listing may be incomplete",
    });
    expect(queries.length).toBe(1);
  });

  it("refuses a null result rather than reading it as an empty listing", async () => {
    const { fetchFn } = recordingFetch(() => envelope(null, { per_page: 100, total_count: 0 }));
    const r = await createCfClient(AUTH, fetchFn).list(PATH, PAGED);
    expect(r.ok ? null : { kind: r.error.kind, message: r.error.message }).toEqual({
      kind: "schema",
      message: "GET /test: unexpected response shape at result (expected Array)",
    });
  });

  it("makes one request and returns nothing when total_count is 0", async () => {
    const { fetchFn, queries } = recordingFetch(() => envelope([], { page: 1, per_page: 100, count: 0, total_count: 0 }));
    expect(await createCfClient(AUTH, fetchFn).list(PATH, PAGED)).toEqual({ ok: true, data: [] });
    expect(queries.length).toBe(1);
  });

  it("treats a short page with no result_info as the last page", async () => {
    const { fetchFn, queries } = recordingFetch(() => envelope(names(99)));
    const r = await createCfClient(AUTH, fetchFn).list(PATH, PAGED);
    expect(r.ok ? r.data.length : null).toBe(99);
    expect(queries.length).toBe(1);
  });

  it("refuses a full page with no result_info rather than reading it as the last", async () => {
    const { fetchFn, queries } = recordingFetch(() => envelope(names(100)));
    const r = await createCfClient(AUTH, fetchFn).list(PATH, PAGED);
    expect(r.ok ? null : { kind: r.error.kind, statusCode: r.error.statusCode }).toEqual({ kind: "paging", statusCode: undefined });
    expect(r.ok ? null : r.error.message).toBe(`${PAGED.name}: page 1 came back full with no paging metadata, so the listing may be incomplete`);
    expect(queries.length).toBe(1);
  });

  it("refuses an empty page that comes before the declared last", async () => {
    const { fetchFn } = recordingFetch((q) => envelope(q.get("page") === "1" ? ["a", "b"] : [], { per_page: 2, total_pages: 3 }));
    const r = await createCfClient(AUTH, fetchFn).list(PATH, PAGED);
    expect(r.ok ? null : r.error.message).toBe(`${PAGED.name}: page 2 of 3 came back empty`);
  });

  it("returns a failure on a later page and none of the items gathered before it", async () => {
    const { fetchFn } = recordingFetch((q) =>
      q.get("page") === "1"
        ? envelope(["a", "b"], { per_page: 2, total_count: 3 })
        : new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: "Authentication error" }], messages: [], result: null }), {
            status: 403,
          }),
    );
    const r = await createCfClient(AUTH, fetchFn).list(PATH, PAGED);
    expect(r.ok ? null : { kind: r.error.kind, message: r.error.message, statusCode: r.error.statusCode }).toEqual({
      kind: "api",
      message: "Authentication error",
      statusCode: 403,
    });
  });

  it("fails the whole listing when a later page has the wrong shape", async () => {
    const { fetchFn } = recordingFetch((q) => envelope(q.get("page") === "1" ? ["a", "b"] : [7], { per_page: 2, total_count: 3 }));
    const r = await createCfClient(AUTH, fetchFn).list(PATH, PAGED);
    expect(r.ok ? null : { kind: r.error.kind, message: r.error.message }).toEqual({
      kind: "schema",
      message: "GET /test: unexpected response shape at 0 (expected string)",
    });
  });

  it("starts a paging refusal with the operation name rather than the request path", async () => {
    const named: CfListOperation<string> = { ...PAGED, name: "GET /accounts/{account_id}/things" };
    const { fetchFn } = recordingFetch(() => envelope(names(100)));
    const r = await createCfClient(AUTH, fetchFn).list(PATH, named);
    expect(r.ok ? null : r.error.message.startsWith("GET /accounts/{account_id}/things: ")).toBe(true);
  });

  it("gathers the items the operation's result schema picks out of a wrapped result", async () => {
    const { fetchFn } = recordingFetch(() => envelope({ wrapped: ["a", "b"] }, { per_page: 100, total_count: 2 }));
    const wrapped: CfListOperation<string> = {
      name: "GET /test",
      paging: "page",
      result: v.pipe(
        v.object({ wrapped: v.array(v.string()) }),
        v.transform((r) => r.wrapped),
      ),
    };
    const r = await createCfClient(AUTH, fetchFn).list(PATH, wrapped);
    expect(r).toEqual({ ok: true, data: ["a", "b"] });
  });
});

describe("createCfClient().list() — cursor paging", () => {
  const PATH = "/accounts/acc/r2/buckets";

  function envelope(result: unknown, result_info?: unknown): Response {
    return new Response(JSON.stringify({ success: true, errors: [], messages: [], result, ...(result_info ? { result_info } : {}) }), {
      status: 200,
    });
  }

  function cursorFetch(answer: (cursor: string | null) => Response): { fetchFn: typeof globalThis.fetch; queries: string[] } {
    const queries: string[] = [];
    const fetchFn: typeof globalThis.fetch = async (url) => {
      const parsed = new URL(String(url));
      queries.push(parsed.search);
      return answer(parsed.searchParams.get("cursor"));
    };
    return { fetchFn, queries };
  }

  it("follows each cursor to a page without one, and never sends a page number", async () => {
    const chain: Record<string, { items: string[]; next?: string }> = {
      "": { items: ["a"], next: "c1" },
      c1: { items: ["b"], next: "c2" },
      c2: { items: ["c"] },
    };
    const { fetchFn, queries } = cursorFetch((cursor) => {
      const step = chain[cursor ?? ""];
      return envelope(step?.items ?? [], { per_page: 100, ...(step?.next ? { cursor: step.next } : {}) });
    });
    const r = await createCfClient(AUTH, fetchFn).list(PATH, CURSORED);
    expect(r).toEqual({ ok: true, data: ["a", "b", "c"] });
    expect(queries).toEqual(["?per_page=100", "?per_page=100&cursor=c1", "?per_page=100&cursor=c2"]);
    expect(queries.filter((q) => /[?&]page=/.test(q))).toEqual([]);
  });

  it("encodes a cursor before sending it", async () => {
    const { fetchFn, queries } = cursorFetch((cursor) => envelope([], cursor === null ? { cursor: "a/b+c" } : { cursor: null }));
    await createCfClient(AUTH, fetchFn).list(PATH, CURSORED);
    expect(queries[1]).toBe("?per_page=100&cursor=a%2Fb%2Bc");
  });

  for (const last of ["", null]) {
    it(`ends on a cursor of ${JSON.stringify(last)}`, async () => {
      const { fetchFn, queries } = cursorFetch((cursor) => envelope([cursor ?? "first"], { cursor: cursor === null ? "c1" : last }));
      const r = await createCfClient(AUTH, fetchFn).list(PATH, CURSORED);
      expect(r).toEqual({ ok: true, data: ["first", "c1"] });
      expect(queries.length).toBe(2);
    });
  }

  it("treats a short page with no result_info as the last", async () => {
    const { fetchFn, queries } = cursorFetch(() => envelope(["a"]));
    expect(await createCfClient(AUTH, fetchFn).list(PATH, CURSORED)).toEqual({ ok: true, data: ["a"] });
    expect(queries).toEqual(["?per_page=100"]);
  });

  it("refuses a full page with no result_info", async () => {
    const { fetchFn, queries } = cursorFetch(() => envelope(Array.from({ length: 100 }, (_, i) => `b${i}`)));
    const r = await createCfClient(AUTH, fetchFn).list(PATH, CURSORED);
    expect(r.ok ? null : { kind: r.error.kind, message: r.error.message }).toEqual({
      kind: "paging",
      message: `${CURSORED.name}: page 1 came back full with no paging metadata, so the listing may be incomplete`,
    });
    expect(queries.length).toBe(1);
  });

  it("refuses a cursor the API returns twice, after exactly two requests", async () => {
    const { fetchFn, queries } = cursorFetch(() => envelope(["x"], { cursor: "c1" }));
    const r = await createCfClient(AUTH, fetchFn).list(PATH, CURSORED);
    expect(r.ok ? null : { kind: r.error.kind, message: r.error.message }).toEqual({
      kind: "paging",
      message: `${CURSORED.name}: page 2 returned cursor c1, which an earlier page already returned`,
    });
    expect(queries.length).toBe(2);
  });

  it("refuses a cursor cycle A, B, A at the third page", async () => {
    const next: Record<string, string> = { "": "A", A: "B", B: "A" };
    const { fetchFn, queries } = cursorFetch((cursor) => envelope([cursor ?? "first"], { cursor: next[cursor ?? ""] }));
    const r = await createCfClient(AUTH, fetchFn).list(PATH, CURSORED);
    expect(r.ok ? null : { kind: r.error.kind, message: r.error.message }).toEqual({
      kind: "paging",
      message: `${CURSORED.name}: page 3 returned cursor A, which an earlier page already returned`,
    });
    expect(queries).toEqual(["?per_page=100", "?per_page=100&cursor=A", "?per_page=100&cursor=B"]);
  });

  it("returns every item of an ordinary two-page cursor listing", async () => {
    const { fetchFn, queries } = cursorFetch((cursor) =>
      cursor === null ? envelope(["a", "b"], { cursor: "c1" }) : envelope(["c"], { cursor: null }),
    );
    expect(await createCfClient(AUTH, fetchFn).list(PATH, CURSORED)).toEqual({ ok: true, data: ["a", "b", "c"] });
    expect(queries.length).toBe(2);
  });

  it("refuses a cursor listing that never ends at the page cap, naming it", async () => {
    let issued = 0;
    const { fetchFn, queries } = cursorFetch(() => envelope(["x"], { cursor: `c${++issued}` }));
    const r = await createCfClient(AUTH, fetchFn).list(PATH, CURSORED);
    expect(r.ok ? null : { kind: r.error.kind, message: r.error.message }).toEqual({
      kind: "paging",
      message: `${CURSORED.name}: the listing reached the 1000-page cap, so it may be incomplete`,
    });
    expect(queries.length).toBe(1000);
  });

  it("refuses a cursor cycle A, B, C, A at the fourth page", async () => {
    const next: Record<string, string> = { "": "A", A: "B", B: "C", C: "A" };
    const { fetchFn, queries } = cursorFetch((cursor) => envelope([cursor ?? "first"], { cursor: next[cursor ?? ""] }));
    const r = await createCfClient(AUTH, fetchFn).list(PATH, CURSORED);
    expect(r.ok ? null : { kind: r.error.kind, message: r.error.message }).toEqual({
      kind: "paging",
      message: `${CURSORED.name}: page 4 returned cursor A, which an earlier page already returned`,
    });
    expect(queries).toEqual(["?per_page=100", "?per_page=100&cursor=A", "?per_page=100&cursor=B", "?per_page=100&cursor=C"]);
  });

  it("refuses the page cap with a CfApiClientError", async () => {
    let issued = 0;
    const { fetchFn } = cursorFetch(() => envelope(["x"], { cursor: `c${++issued}` }));
    const r = await createCfClient(AUTH, fetchFn).list(PATH, CURSORED);
    expect(r.ok ? null : r.error).toBeInstanceOf(CfApiClientError);
  });

  it("returns every item of a cursor listing that ends on the cap page", async () => {
    const { fetchFn, queries } = cursorFetch((cursor) => {
      const page = cursor === null ? 1 : Number(cursor.slice(1));
      return envelope([`i${page}`], { cursor: page < 1000 ? `c${page + 1}` : null });
    });
    const r = await createCfClient(AUTH, fetchFn).list(PATH, CURSORED);
    expect(r).toEqual({ ok: true, data: Array.from({ length: 1000 }, (_, i) => `i${i + 1}`) });
    expect(queries.length).toBe(1000);
  });

  it("returns every item of a page-number listing of exactly the cap", async () => {
    const { fetchFn, queries } = cursorFetch(() => envelope([`i${queries.length}`], { per_page: 1, total_pages: 1000 }));
    const r = await createCfClient(AUTH, fetchFn).list(PATH, PAGED);
    expect(r).toEqual({ ok: true, data: Array.from({ length: 1000 }, (_, i) => `i${i + 1}`) });
    expect(queries.length).toBe(1000);
  });

  it("refuses a page-number listing whose total_pages keeps growing at the page cap", async () => {
    const { fetchFn, queries } = cursorFetch(() => envelope(["x"], { per_page: 1, total_pages: queries.length + 1 }));
    const r = await createCfClient(AUTH, fetchFn).list(PATH, PAGED);
    expect(r.ok ? null : { kind: r.error.kind, message: r.error.message }).toEqual({
      kind: "paging",
      message: `${PAGED.name}: the listing reached the 1000-page cap, so it may be incomplete`,
    });
    expect(queries.length).toBe(1000);
  });
});

describe("createCfClient() — retrying an idempotent operation", () => {
  const IDEMPOTENT: CfOperation<unknown> = { name: "GET /test", result: v.unknown(), idempotent: true };
  const okReply = () => Response.json({ success: true, errors: [], messages: [], result: "done" });
  const unavailable = (headers: Record<string, string> = {}) =>
    Response.json({ success: false, errors: [{ code: 7500, message: "unavailable" }], result: null }, { status: 503, headers });

  function queuedFetch(...replies: (() => Response)[]): { fetchFn: typeof globalThis.fetch; sent: () => number } {
    let sent = 0;
    const fetchFn: typeof globalThis.fetch = async () => {
      const reply = replies[Math.min(sent, replies.length - 1)];
      sent += 1;
      if (reply === undefined) throw new Error("no reply queued");
      return reply();
    };
    return { fetchFn, sent: () => sent };
  }

  function recordingSleep(): { sleep: (ms: number) => Promise<void>; slept: number[] } {
    const slept: number[] = [];
    return { sleep: async (ms) => void slept.push(ms), slept };
  }

  it("succeeds on the second attempt after a 503", async () => {
    const { fetchFn, sent } = queuedFetch(unavailable, okReply);
    const { sleep, slept } = recordingSleep();
    expect(await createCfClient(AUTH, fetchFn, 30_000, sleep).get("/p", IDEMPOTENT)).toEqual({ ok: true, data: "done" });
    expect(sent()).toBe(2);
    expect(slept).toEqual([1_000]);
  });

  it("retries a 429", async () => {
    const { fetchFn, sent } = queuedFetch(() => Response.json({ success: false, errors: [], result: null }, { status: 429 }), okReply);
    const { sleep } = recordingSleep();
    expect((await createCfClient(AUTH, fetchFn, 30_000, sleep).get("/p", IDEMPOTENT)).ok).toBe(true);
    expect(sent()).toBe(2);
  });

  it("retries a 502 whose body is not JSON", async () => {
    const { fetchFn, sent } = queuedFetch(() => new Response("<html>bad gateway</html>", { status: 502 }), okReply);
    const { sleep } = recordingSleep();
    expect((await createCfClient(AUTH, fetchFn, 30_000, sleep).get("/p", IDEMPOTENT)).ok).toBe(true);
    expect(sent()).toBe(2);
  });

  it("retries a transport failure", async () => {
    const { fetchFn, sent } = queuedFetch(() => {
      throw new Error("connection reset");
    }, okReply);
    const { sleep } = recordingSleep();
    expect(await createCfClient(AUTH, fetchFn, 30_000, sleep).get("/p", IDEMPOTENT)).toEqual({ ok: true, data: "done" });
    expect(sent()).toBe(2);
  });

  it("doubles the wait between attempts and gives up at the attempt cap, naming the last status", async () => {
    const { fetchFn, sent } = queuedFetch(unavailable);
    const { sleep, slept } = recordingSleep();
    const r = await createCfClient(AUTH, fetchFn, 30_000, sleep).get("/p", IDEMPOTENT);
    expect(r.ok ? null : { kind: r.error.kind, statusCode: r.error.statusCode, message: r.error.message }).toEqual({
      kind: "api",
      statusCode: 503,
      message: "GET /test: gave up after 4 attempts; the last answered HTTP 503: unavailable",
    });
    expect(r.ok ? null : r.error.cfErrors).toEqual([{ code: 7500, message: "unavailable" }]);
    expect(sent()).toBe(4);
    expect(slept).toEqual([1_000, 2_000, 4_000]);
  });

  it("gives up on repeated transport failures as a network error", async () => {
    const { fetchFn, sent } = queuedFetch(() => {
      throw new Error("connection reset");
    });
    const { sleep } = recordingSleep();
    const r = await createCfClient(AUTH, fetchFn, 30_000, sleep).get("/p", IDEMPOTENT);
    expect(r.ok ? null : { kind: r.error.kind, message: r.error.message }).toEqual({
      kind: "network",
      message: "GET /test: gave up after 4 attempts; the last failed in transport: Network error: connection reset",
    });
    expect(sent()).toBe(4);
  });

  it("waits the seconds a Retry-After names", async () => {
    const { fetchFn } = queuedFetch(() => unavailable({ "Retry-After": "7" }), okReply);
    const { sleep, slept } = recordingSleep();
    await createCfClient(AUTH, fetchFn, 30_000, sleep).get("/p", IDEMPOTENT);
    expect(slept).toEqual([7_000]);
  });

  it("waits until the HTTP date a Retry-After names", async () => {
    const at = new Date(Date.now() + 10_000).toUTCString();
    const { fetchFn } = queuedFetch(() => unavailable({ "Retry-After": at }), okReply);
    const { sleep, slept } = recordingSleep();
    await createCfClient(AUTH, fetchFn, 30_000, sleep).get("/p", IDEMPOTENT);
    expect(slept).toHaveLength(1);
    expect(slept[0]).toBeGreaterThan(8_000);
    expect(slept[0]).toBeLessThanOrEqual(10_000);
  });

  it("caps a Retry-After past the longest wait", async () => {
    const { fetchFn } = queuedFetch(() => unavailable({ "Retry-After": "3600" }), okReply);
    const { sleep, slept } = recordingSleep();
    await createCfClient(AUTH, fetchFn, 30_000, sleep).get("/p", IDEMPOTENT);
    expect(slept).toEqual([30_000]);
  });

  it("retries at once on a Retry-After of 0", async () => {
    const { fetchFn, sent } = queuedFetch(() => unavailable({ "Retry-After": "0" }), okReply);
    const { sleep, slept } = recordingSleep();
    expect(await createCfClient(AUTH, fetchFn, 30_000, sleep).get("/p", IDEMPOTENT)).toEqual({ ok: true, data: "done" });
    expect(sent()).toBe(2);
    expect(slept).toEqual([0]);
  });

  it("retries at once on a Retry-After HTTP date already past", async () => {
    const { fetchFn } = queuedFetch(() => unavailable({ "Retry-After": "Thu, 01 Jan 1970 00:00:00 GMT" }), okReply);
    const { sleep, slept } = recordingSleep();
    await createCfClient(AUTH, fetchFn, 30_000, sleep).get("/p", IDEMPOTENT);
    expect(slept).toEqual([0]);
  });

  it("caps a Retry-After HTTP date past the longest wait", async () => {
    const { fetchFn } = queuedFetch(() => unavailable({ "Retry-After": "Fri, 31 Dec 9999 23:59:59 GMT" }), okReply);
    const { sleep, slept } = recordingSleep();
    await createCfClient(AUTH, fetchFn, 30_000, sleep).get("/p", IDEMPOTENT);
    expect(slept).toEqual([30_000]);
  });

  it("retries a failed page of an idempotent cursor listing on the same cursor, and finishes the listing", async () => {
    const LISTING: CfListOperation<string> = { ...CURSORED, idempotent: true };
    const queries: string[] = [];
    let failedOnce = false;
    const fetchFn: typeof globalThis.fetch = async (url) => {
      const cursor = new URL(String(url)).searchParams.get("cursor");
      queries.push(new URL(String(url)).search);
      if (cursor === "c1" && !failedOnce) {
        failedOnce = true;
        return unavailable();
      }
      const next = cursor === null ? "c1" : cursor === "c1" ? "c2" : null;
      return Response.json({ success: true, errors: [], messages: [], result: [cursor ?? "first"], result_info: { cursor: next } });
    };
    const { sleep, slept } = recordingSleep();
    expect(await createCfClient(AUTH, fetchFn, 30_000, sleep).list("/p", LISTING)).toEqual({ ok: true, data: ["first", "c1", "c2"] });
    expect(queries).toEqual(["?per_page=100", "?per_page=100&cursor=c1", "?per_page=100&cursor=c1", "?per_page=100&cursor=c2"]);
    expect(slept).toEqual([1_000]);
  });

  it("falls back to the backoff on a Retry-After it cannot read, a signed or fractional one included", async () => {
    for (const header of ["soon", "-5", "-1", "1.5", "2001-01-01"]) {
      const { fetchFn } = queuedFetch(() => unavailable({ "Retry-After": header }), okReply);
      const { sleep, slept } = recordingSleep();
      await createCfClient(AUTH, fetchFn, 30_000, sleep).get("/p", IDEMPOTENT);
      expect({ header, slept }).toEqual({ header, slept: [1_000] });
    }
  });

  it("does not retry a 4xx other than 429", async () => {
    const { fetchFn, sent } = queuedFetch(() =>
      Response.json({ success: false, errors: [{ code: 7003, message: "nope" }], result: null }, { status: 404 }),
    );
    const { sleep, slept } = recordingSleep();
    expect((await createCfClient(AUTH, fetchFn, 30_000, sleep).get("/p", IDEMPOTENT)).ok).toBe(false);
    expect(sent()).toBe(1);
    expect(slept).toEqual([]);
  });

  it("sends an operation not marked idempotent once, whatever it is answered", async () => {
    const { fetchFn, sent } = queuedFetch(unavailable, okReply);
    const { sleep, slept } = recordingSleep();
    const r = await createCfClient(AUTH, fetchFn, 30_000, sleep).post("/p", {}, ANY);
    expect(r.ok ? null : { statusCode: r.error.statusCode, message: r.error.message }).toEqual({ statusCode: 503, message: "unavailable" });
    expect(sent()).toBe(1);
    expect(slept).toEqual([]);
  });

  it("sends an operation not marked idempotent once after a transport failure", async () => {
    const { fetchFn, sent } = queuedFetch(() => {
      throw new Error("connection reset");
    }, okReply);
    const { sleep } = recordingSleep();
    expect((await createCfClient(AUTH, fetchFn, 30_000, sleep).post("/p", {}, ANY)).ok).toBe(false);
    expect(sent()).toBe(1);
  });
});

describe("createCfClient() — a refusal's Retry-After", () => {
  const rateLimited = (headers: Record<string, string>) =>
    Response.json({ success: false, errors: [{ code: 971, message: "slow down" }], result: null }, { status: 429, headers });

  it("carries the header on the refusal, as sent", async () => {
    const r = await createCfClient(AUTH, async () => rateLimited({ "Retry-After": "90" })).post("/p", {}, ANY);
    expect(r.ok ? null : { statusCode: r.error.statusCode, retryAfter: r.error.retryAfter }).toEqual({ statusCode: 429, retryAfter: "90" });
  });

  it("carries it on a refusal whose body is not an envelope", async () => {
    const fetchFn = async () => new Response("busy", { status: 429, headers: { "Retry-After": "5" } });
    const r = await createCfClient(AUTH, fetchFn).post("/p", {}, ANY);
    expect(r.ok ? null : r.error.retryAfter).toBe("5");
  });

  it("carries none when the refusal sent none", async () => {
    const r = await createCfClient(AUTH, async () => rateLimited({})).post("/p", {}, ANY);
    expect(r.ok ? "ok" : r.error.retryAfter).toBeUndefined();
  });

  it("keeps it on the refusal an idempotent operation gives up with", async () => {
    const IDEMPOTENT: CfOperation<unknown> = { name: "GET /test", result: v.unknown(), idempotent: true };
    const r = await createCfClient(
      AUTH,
      async () => rateLimited({ "Retry-After": "0" }),
      30_000,
      async () => {},
    ).get("/p", IDEMPOTENT);
    expect(r.ok ? null : r.error.retryAfter).toBe("0");
  });
});

describe("readRetryAfterMs()", () => {
  const NOW = Date.parse("2026-09-11T10:00:00Z");

  it("reads seconds", () => {
    expect(readRetryAfterMs("90", NOW)).toBe(90_000);
  });

  it("reads an HTTP date as the wait from now, never below zero", () => {
    expect(readRetryAfterMs("Fri, 11 Sep 2026 10:00:30 GMT", NOW)).toBe(30_000);
    expect(readRetryAfterMs("Thu, 01 Jan 1970 00:00:00 GMT", NOW)).toBe(0);
  });

  it("answers undefined for no header, or one it cannot read", () => {
    expect([null, "-1", "1.5", "soon"].map((header) => readRetryAfterMs(header, NOW))).toEqual([undefined, undefined, undefined, undefined]);
  });
});
