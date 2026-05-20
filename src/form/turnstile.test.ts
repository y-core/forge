import { afterEach, describe, expect, it } from "bun:test";
import { verifyTurnstile } from "./turnstile";

const SECRET = "test-secret-key";
const TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

let savedFetch: typeof globalThis.fetch;

afterEach(() => {
  if (savedFetch) globalThis.fetch = savedFetch;
});

function mockFetch(response: object, status = 200) {
  savedFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(response), { status });
}

function mockFetchThrows() {
  savedFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network failure");
  };
}

function mockFetchBadJson(status = 200) {
  savedFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("not json", { status });
}

describe("verifyTurnstile", () => {
  it("returns missing-token when cf-turnstile-response is absent", async () => {
    const fd = new FormData();
    const result = await verifyTurnstile(fd, SECRET);
    expect(result).toEqual({ ok: false, reason: "missing-token" });
  });

  it("returns missing-token when cf-turnstile-response is empty", async () => {
    const fd = new FormData();
    fd.append("cf-turnstile-response", "");
    const result = await verifyTurnstile(fd, SECRET);
    expect(result).toEqual({ ok: false, reason: "missing-token" });
  });

  it("returns ok:true when Turnstile verification passes", async () => {
    mockFetch({ success: true });
    const fd = new FormData();
    fd.append("cf-turnstile-response", "valid-token");
    const result = await verifyTurnstile(fd, SECRET);
    expect(result).toEqual({ ok: true });
  });

  it("returns verification-failed when Turnstile returns success:false", async () => {
    mockFetch({ success: false });
    const fd = new FormData();
    fd.append("cf-turnstile-response", "bad-token");
    const result = await verifyTurnstile(fd, SECRET);
    expect(result).toEqual({ ok: false, reason: "verification-failed" });
  });

  it("posts the secret and token to the Turnstile endpoint", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: string | undefined;
    savedFetch = globalThis.fetch;
    globalThis.fetch = async (url: URL | RequestInfo, init?: RequestInit) => {
      capturedUrl = url.toString();
      capturedBody = init?.body as string;
      return new Response(JSON.stringify({ success: true }));
    };

    const fd = new FormData();
    fd.append("cf-turnstile-response", "tok");
    await verifyTurnstile(fd, SECRET);

    expect(capturedUrl).toBe(TURNSTILE_URL);
    expect(JSON.parse(capturedBody!)).toEqual({ secret: SECRET, response: "tok" });
  });

  it("supports a custom token field name", async () => {
    mockFetch({ success: true });
    const fd = new FormData();
    fd.append("my-token", "valid-token");
    const result = await verifyTurnstile(fd, SECRET, "my-token");
    expect(result).toEqual({ ok: true });
  });

  it("returns network-error when fetch throws", async () => {
    mockFetchThrows();
    const fd = new FormData();
    fd.append("cf-turnstile-response", "valid-token");
    const result = await verifyTurnstile(fd, SECRET);
    expect(result).toEqual({ ok: false, reason: "network-error" });
  });

  it("returns network-error on a non-2xx response", async () => {
    mockFetch({ error: "bad_request" }, 400);
    const fd = new FormData();
    fd.append("cf-turnstile-response", "valid-token");
    const result = await verifyTurnstile(fd, SECRET);
    expect(result).toEqual({ ok: false, reason: "network-error" });
  });

  it("returns parse-error when response body is not valid JSON", async () => {
    mockFetchBadJson();
    const fd = new FormData();
    fd.append("cf-turnstile-response", "valid-token");
    const result = await verifyTurnstile(fd, SECRET);
    expect(result).toEqual({ ok: false, reason: "parse-error" });
  });

  it("includes remoteip in the POST body when provided", async () => {
    let capturedBody: string | undefined;
    savedFetch = globalThis.fetch;
    globalThis.fetch = async (_url: URL | RequestInfo, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return new Response(JSON.stringify({ success: true }));
    };

    const fd = new FormData();
    fd.append("cf-turnstile-response", "tok");
    await verifyTurnstile(fd, SECRET, "cf-turnstile-response", "1.2.3.4");

    expect(JSON.parse(capturedBody!)).toEqual({
      secret: SECRET,
      response: "tok",
      remoteip: "1.2.3.4",
    });
  });
});
