import { afterEach, describe, expect, it } from "bun:test";
import { verifyTurnstile } from "./turnstile";

const SECRET = "test-secret-key";
const TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

let savedFetch: typeof globalThis.fetch;
let savedSetTimeout: typeof globalThis.setTimeout;
let savedClearTimeout: typeof globalThis.clearTimeout;

afterEach(() => {
  if (savedFetch) globalThis.fetch = savedFetch;
  if (savedSetTimeout) globalThis.setTimeout = savedSetTimeout;
  if (savedClearTimeout) globalThis.clearTimeout = savedClearTimeout;
});

function mockFetch(response: object, status = 200) {
  savedFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(response), { status });
}

function withCapturedRequest(fn: (request: { url: string; body?: string; signal?: AbortSignal }) => Response | Promise<Response>) {
  savedFetch = globalThis.fetch;
  globalThis.fetch = async (url: URL | RequestInfo, init?: RequestInit) => {
    const body = init?.body as string | undefined;
    const signal = init?.signal as AbortSignal | undefined;
    return fn({ url: url.toString(), ...(body !== undefined ? { body } : {}), ...(signal !== undefined ? { signal } : {}) });
  };
}

describe("verifyTurnstile", () => {
  it("returns missing-token when the token is absent", async () => {
    const result = await verifyTurnstile(new FormData(), SECRET);
    expect(result).toEqual({ ok: false, reason: "missing-token" });
  });

  it("returns ok:true when verification passes", async () => {
    mockFetch({ success: true });
    const fd = new FormData();
    fd.append("cf-turnstile-response", "valid-token");
    expect(await verifyTurnstile(fd, SECRET)).toEqual({ ok: true });
  });

  it("returns verification-failed when Turnstile returns success:false", async () => {
    mockFetch({ success: false });
    const fd = new FormData();
    fd.append("cf-turnstile-response", "bad-token");
    expect(await verifyTurnstile(fd, SECRET)).toEqual({ ok: false, reason: "verification-failed" });
  });

  it("posts the secret and token to the Turnstile endpoint", async () => {
    let capturedBody: string | undefined;
    let capturedUrl: string | undefined;

    withCapturedRequest(({ body, url }) => {
      capturedBody = body;
      capturedUrl = url;
      return new Response(JSON.stringify({ success: true }));
    });

    const fd = new FormData();
    fd.append("cf-turnstile-response", "tok");
    await verifyTurnstile(fd, SECRET);

    expect(capturedUrl).toBe(TURNSTILE_URL);
    expect(JSON.parse(capturedBody!)).toEqual({ response: "tok", secret: SECRET });
  });

  it("includes remoteip in the POST body when provided", async () => {
    let capturedBody: string | undefined;

    withCapturedRequest(({ body }) => {
      capturedBody = body;
      return new Response(JSON.stringify({ success: true }));
    });

    const fd = new FormData();
    fd.append("cf-turnstile-response", "tok");
    await verifyTurnstile(fd, SECRET, "cf-turnstile-response", "1.2.3.4");

    expect(JSON.parse(capturedBody!)).toEqual({ remoteip: "1.2.3.4", response: "tok", secret: SECRET });
  });

  it("passes an AbortSignal to fetch", async () => {
    let capturedSignal: AbortSignal | undefined;

    withCapturedRequest(({ signal }) => {
      capturedSignal = signal;
      return new Response(JSON.stringify({ success: true }));
    });

    const fd = new FormData();
    fd.append("cf-turnstile-response", "tok");
    await verifyTurnstile(fd, SECRET);

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);
  });

  it("returns timeout when the request aborts", async () => {
    savedSetTimeout = globalThis.setTimeout;
    savedClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = ((fn: (...args: never[]) => void) => {
      fn();
      return 1 as unknown as number;
    }) as unknown as typeof globalThis.setTimeout;
    globalThis.clearTimeout = (() => {}) as typeof globalThis.clearTimeout;

    withCapturedRequest(async ({ signal }) => {
      throw new DOMException(signal?.aborted ? "aborted" : "failed", "AbortError");
    });

    const fd = new FormData();
    fd.append("cf-turnstile-response", "tok");
    expect(await verifyTurnstile(fd, SECRET, "cf-turnstile-response", undefined, { timeoutMs: 1 })).toEqual({ ok: false, reason: "timeout" });
  });

  it("returns network-error on fetch failures", async () => {
    savedFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("network failure");
    };

    const fd = new FormData();
    fd.append("cf-turnstile-response", "valid-token");
    expect(await verifyTurnstile(fd, SECRET)).toEqual({ ok: false, reason: "network-error" });
  });

  it("returns parse-error when the response body is not valid JSON", async () => {
    savedFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("not json", { status: 200 });

    const fd = new FormData();
    fd.append("cf-turnstile-response", "valid-token");
    expect(await verifyTurnstile(fd, SECRET)).toEqual({ ok: false, reason: "parse-error" });
  });

  it("returns hostname-mismatch when the hostname does not match", async () => {
    mockFetch({ hostname: "other.example.com", success: true });
    const fd = new FormData();
    fd.append("cf-turnstile-response", "valid-token");
    expect(await verifyTurnstile(fd, SECRET, "cf-turnstile-response", undefined, { expectedHostname: "example.com" })).toEqual({
      ok: false,
      reason: "hostname-mismatch",
    });
  });

  it("returns action-mismatch when the action does not match", async () => {
    mockFetch({ action: "other", success: true });
    const fd = new FormData();
    fd.append("cf-turnstile-response", "valid-token");
    expect(await verifyTurnstile(fd, SECRET, "cf-turnstile-response", undefined, { expectedAction: "contact" })).toEqual({
      ok: false,
      reason: "action-mismatch",
    });
  });

  it("returns cdata-mismatch when cdata does not match", async () => {
    mockFetch({ cdata: "other", success: true });
    const fd = new FormData();
    fd.append("cf-turnstile-response", "valid-token");
    expect(await verifyTurnstile(fd, SECRET, "cf-turnstile-response", undefined, { expectedCData: "contact-form" })).toEqual({
      ok: false,
      reason: "cdata-mismatch",
    });
  });
});
