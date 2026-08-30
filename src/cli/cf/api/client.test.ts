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

  it("names the Pages permission on a Pages target", () => {
    // A Workers token template does not grant Pages, so "check your scopes" left the
    // reader with the one question the row could have answered.
    expect(describeCfFailure(rejected, { kind: "pages", name: "cornellaw" })).toBe(
      'auth failed — CLOUDFLARE_API_TOKEN is rejected or lacks "Cloudflare Pages" (Read to report, Edit to change) · code 10000',
    );
  });

  it("names the Workers permission on a worker target", () => {
    expect(describeCfFailure(rejected, { kind: "worker", name: "w" })).toContain('lacks "Workers Scripts"');
  });

  it("states both possibilities, because Cloudflare returns one code for both", () => {
    expect(describeCfFailure(rejected, { kind: "pages", name: "p" })).toContain("is rejected or lacks");
  });

  it("carries the code into a redacted row, since a code cannot echo a payload", () => {
    const detail = describeCfFailure(rejected, { kind: "pages", name: "p" }, { redactMessage: true });
    expect(detail).toContain("code 10000");
    expect(detail).not.toContain("Authentication error");
  });
});
