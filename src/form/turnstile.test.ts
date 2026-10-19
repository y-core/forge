import { afterEach, describe, expect, it } from "bun:test";

import { devAllowance } from "../dev/allowance";
import { verifyTurnstile } from "./turnstile";

const DEV = devAllowance({ turnstileTestingSecrets: true });
const SECRET = "test-secret-key";
const TESTING_SECRET = "1x0000000000000000000000000000000AA";
const HOSTNAME = "example.com";
const TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

let savedFetch: typeof globalThis.fetch;

afterEach(() => {
  if (savedFetch) globalThis.fetch = savedFetch;
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

function bodyThatNeverCompletes(signal: AbortSignal | undefined): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"success":'));
        signal?.addEventListener("abort", () => controller.error(signal.reason));
      },
    }),
  );
}

describe("verifyTurnstile", () => {
  it("returns missing-token when the token is absent", async () => {
    const result = await verifyTurnstile(new FormData(), SECRET, { expectedHostname: HOSTNAME });
    expect(result).toEqual({ ok: false, error: "missing-token" });
  });

  it("returns ok:true when verification passes", async () => {
    mockFetch({ success: true, hostname: HOSTNAME });
    const fd = new FormData();
    fd.append("cf-turnstile-response", "valid-token");
    expect(await verifyTurnstile(fd, SECRET, { expectedHostname: HOSTNAME })).toEqual({ ok: true });
  });

  it("returns verification-failed when Turnstile returns success:false", async () => {
    mockFetch({ success: false });
    const fd = new FormData();
    fd.append("cf-turnstile-response", "bad-token");
    expect(await verifyTurnstile(fd, SECRET, { expectedHostname: HOSTNAME })).toEqual({ ok: false, error: "verification-failed" });
  });

  it("posts the secret and token to the Turnstile endpoint", async () => {
    let capturedBody: string | undefined;
    let capturedUrl: string | undefined;

    withCapturedRequest(({ body, url }) => {
      capturedBody = body;
      capturedUrl = url;
      return new Response(JSON.stringify({ success: true, hostname: HOSTNAME }));
    });

    const fd = new FormData();
    fd.append("cf-turnstile-response", "tok");
    await verifyTurnstile(fd, SECRET, { expectedHostname: HOSTNAME });

    expect(capturedUrl).toBe(TURNSTILE_URL);
    expect(JSON.parse(capturedBody!)).toEqual({ response: "tok", secret: SECRET });
  });

  it("includes remoteip in the POST body when provided", async () => {
    let capturedBody: string | undefined;

    withCapturedRequest(({ body }) => {
      capturedBody = body;
      return new Response(JSON.stringify({ success: true, hostname: HOSTNAME }));
    });

    const fd = new FormData();
    fd.append("cf-turnstile-response", "tok");
    await verifyTurnstile(fd, SECRET, { expectedHostname: HOSTNAME, remoteIp: "1.2.3.4" });

    expect(JSON.parse(capturedBody!)).toEqual({ remoteip: "1.2.3.4", response: "tok", secret: SECRET });
  });

  it("reads the token from a custom options.tokenField", async () => {
    let capturedBody: string | undefined;

    withCapturedRequest(({ body }) => {
      capturedBody = body;
      return new Response(JSON.stringify({ success: true, hostname: HOSTNAME }));
    });

    const fd = new FormData();
    fd.append("my-token-field", "custom-tok");
    const result = await verifyTurnstile(fd, SECRET, { expectedHostname: HOSTNAME, tokenField: "my-token-field" });

    expect(result).toEqual({ ok: true });
    expect(JSON.parse(capturedBody!)).toEqual({ response: "custom-tok", secret: SECRET });
  });

  it("passes an AbortSignal to fetch", async () => {
    let capturedSignal: AbortSignal | undefined;

    withCapturedRequest(({ signal }) => {
      capturedSignal = signal;
      return new Response(JSON.stringify({ success: true, hostname: HOSTNAME }));
    });

    const fd = new FormData();
    fd.append("cf-turnstile-response", "tok");
    await verifyTurnstile(fd, SECRET, { expectedHostname: HOSTNAME });

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);
  });

  it("returns timeout when the request aborts", async () => {
    withCapturedRequest(
      ({ signal }) =>
        new Promise<Response>((_, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason));
        }),
    );

    const fd = new FormData();
    fd.append("cf-turnstile-response", "tok");
    expect(await verifyTurnstile(fd, SECRET, { expectedHostname: HOSTNAME, timeoutMs: 1 })).toEqual({ ok: false, error: "timeout" });
  });

  it("returns timeout when the response arrives but its body never completes", async () => {
    withCapturedRequest(({ signal }) => bodyThatNeverCompletes(signal));

    const fd = new FormData();
    fd.append("cf-turnstile-response", "tok");
    expect(await verifyTurnstile(fd, SECRET, { expectedHostname: HOSTNAME, timeoutMs: 5 })).toEqual({ ok: false, error: "timeout" });
  });

  it("returns network-error on fetch failures", async () => {
    savedFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("network failure");
    };

    const fd = new FormData();
    fd.append("cf-turnstile-response", "valid-token");
    expect(await verifyTurnstile(fd, SECRET, { expectedHostname: HOSTNAME })).toEqual({ ok: false, error: "network-error" });
  });

  it("returns parse-error when the response body is not valid JSON", async () => {
    savedFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("not json", { status: 200 });

    const fd = new FormData();
    fd.append("cf-turnstile-response", "valid-token");
    expect(await verifyTurnstile(fd, SECRET, { expectedHostname: HOSTNAME })).toEqual({ ok: false, error: "parse-error" });
  });

  it("returns hostname-mismatch when the hostname does not match", async () => {
    mockFetch({ hostname: "other.example.com", success: true });
    const fd = new FormData();
    fd.append("cf-turnstile-response", "valid-token");
    expect(await verifyTurnstile(fd, SECRET, { expectedHostname: HOSTNAME })).toEqual({ ok: false, error: "hostname-mismatch" });
  });

  it("skips the hostname comparison when both locks are open — the dev allowance and a testing secret", async () => {
    mockFetch({ hostname: "example.com", success: true });
    const fd = new FormData();
    fd.append("cf-turnstile-response", "XXXX.DUMMY.TOKEN.XXXX");
    expect(await verifyTurnstile(fd, TESTING_SECRET, { expectedHostname: "localhost", dev: DEV })).toEqual({ ok: true });
  });

  it("skips it under each of the three published testing secrets", async () => {
    mockFetch({ hostname: "example.com", success: true });
    const fd = new FormData();
    fd.append("cf-turnstile-response", "XXXX.DUMMY.TOKEN.XXXX");
    for (const secret of ["1x0000000000000000000000000000000AA", "2x0000000000000000000000000000000AA", "3x0000000000000000000000000000000AA"]) {
      expect(await verifyTurnstile(fd, secret, { expectedHostname: "localhost", dev: DEV })).toEqual({ ok: true });
    }
  });

  it("does not skip on the testing secret alone, so a production bundle that never sets the option is unreachable", async () => {
    mockFetch({ hostname: "example.com", success: true });
    const fd = new FormData();
    fd.append("cf-turnstile-response", "XXXX.DUMMY.TOKEN.XXXX");
    expect(await verifyTurnstile(fd, TESTING_SECRET, { expectedHostname: "localhost" })).toEqual({ ok: false, error: "hostname-mismatch" });
  });

  it("does not skip on the allowance alone, so the token cannot relax a real deployment", async () => {
    mockFetch({ hostname: "example.com", success: true });
    const fd = new FormData();
    fd.append("cf-turnstile-response", "valid-token");
    expect(await verifyTurnstile(fd, SECRET, { expectedHostname: "localhost", dev: DEV })).toEqual({ ok: false, error: "hostname-mismatch" });
  });

  it("still compares the hostname under a production secret", async () => {
    mockFetch({ hostname: "example.com", success: true });
    const fd = new FormData();
    fd.append("cf-turnstile-response", "valid-token");
    expect(await verifyTurnstile(fd, SECRET, { expectedHostname: "localhost" })).toEqual({ ok: false, error: "hostname-mismatch" });
  });

  it("still fails a success:false answer with both locks open", async () => {
    mockFetch({ success: false });
    const fd = new FormData();
    fd.append("cf-turnstile-response", "XXXX.DUMMY.TOKEN.XXXX");
    expect(await verifyTurnstile(fd, TESTING_SECRET, { expectedHostname: "localhost", dev: DEV })).toEqual({
      ok: false,
      error: "verification-failed",
    });
  });

  it("skips the action and cdata comparisons with both locks open", async () => {
    mockFetch({ success: true, hostname: HOSTNAME, metadata: { result_with_testing_key: true } });
    const fd = new FormData();
    fd.append("cf-turnstile-response", "XXXX.DUMMY.TOKEN.XXXX");
    const options = { expectedHostname: HOSTNAME, expectedAction: "contact", expectedCData: "contact-form", dev: DEV };
    expect(await verifyTurnstile(fd, TESTING_SECRET, options)).toEqual({ ok: true });
  });

  it("still compares the action under a testing secret alone", async () => {
    mockFetch({ success: true, hostname: HOSTNAME, metadata: { result_with_testing_key: true } });
    const fd = new FormData();
    fd.append("cf-turnstile-response", "XXXX.DUMMY.TOKEN.XXXX");
    expect(await verifyTurnstile(fd, TESTING_SECRET, { expectedHostname: HOSTNAME, expectedAction: "contact" })).toEqual({
      ok: false,
      error: "action-mismatch",
    });
  });

  it("still compares the action under the allowance alone", async () => {
    mockFetch({ success: true, hostname: HOSTNAME });
    const fd = new FormData();
    fd.append("cf-turnstile-response", "valid-token");
    expect(await verifyTurnstile(fd, SECRET, { expectedHostname: HOSTNAME, expectedAction: "contact", dev: DEV })).toEqual({
      ok: false,
      error: "action-mismatch",
    });
  });

  it("returns hostname-mismatch with both locks open when expectedHostname is empty, the guard being untouched", async () => {
    let fetchCalled = false;
    withCapturedRequest(() => {
      fetchCalled = true;
      return new Response(JSON.stringify({ success: true, hostname: HOSTNAME }));
    });
    const fd = new FormData();
    fd.append("cf-turnstile-response", "XXXX.DUMMY.TOKEN.XXXX");
    expect(await verifyTurnstile(fd, TESTING_SECRET, { expectedHostname: "", dev: DEV })).toEqual({ ok: false, error: "hostname-mismatch" });
    expect(fetchCalled).toBe(false);
  });

  it("returns hostname-mismatch without calling fetch when expectedHostname is empty (fail-closed runtime guard)", async () => {
    let fetchCalled = false;
    withCapturedRequest(() => {
      fetchCalled = true;
      return new Response(JSON.stringify({ success: true, hostname: HOSTNAME }));
    });
    const fd = new FormData();
    fd.append("cf-turnstile-response", "tok");
    const result = await verifyTurnstile(fd, SECRET, { expectedHostname: "" });
    expect(result).toEqual({ ok: false, error: "hostname-mismatch" });
    expect(fetchCalled).toBe(false);
  });

  it("returns action-mismatch when the action does not match", async () => {
    mockFetch({ action: "other", success: true, hostname: HOSTNAME });
    const fd = new FormData();
    fd.append("cf-turnstile-response", "valid-token");
    expect(await verifyTurnstile(fd, SECRET, { expectedHostname: HOSTNAME, expectedAction: "contact" })).toEqual({
      ok: false,
      error: "action-mismatch",
    });
  });

  it("returns cdata-mismatch when cdata does not match", async () => {
    mockFetch({ cdata: "other", success: true, hostname: HOSTNAME });
    const fd = new FormData();
    fd.append("cf-turnstile-response", "valid-token");
    expect(await verifyTurnstile(fd, SECRET, { expectedHostname: HOSTNAME, expectedCData: "contact-form" })).toEqual({
      ok: false,
      error: "cdata-mismatch",
    });
  });
});

describe("verifyTurnstile — caller cancellation", () => {
  it("combines the caller's signal with its own timeout", async () => {
    let seen: AbortSignal | undefined;
    withCapturedRequest(({ signal }) => {
      seen = signal;
      return new Response(JSON.stringify({ success: true, hostname: HOSTNAME }));
    });
    const fd = new FormData();
    fd.append("cf-turnstile-response", "valid-token");
    const controller = new AbortController();

    expect(await verifyTurnstile(fd, SECRET, { expectedHostname: HOSTNAME, signal: controller.signal })).toEqual({ ok: true });
    expect(seen?.aborted).toBe(false);
    controller.abort();
    expect(seen?.aborted).toBe(true);
  });

  it("rejects rather than resolving to a Result when the caller's signal aborts", async () => {
    savedFetch = globalThis.fetch;
    globalThis.fetch = async (_url: URL | RequestInfo, init?: RequestInit) => {
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject((init.signal as AbortSignal).reason));
      });
      return new Response("unreachable");
    };
    const fd = new FormData();
    fd.append("cf-turnstile-response", "valid-token");
    const controller = new AbortController();
    queueMicrotask(() => controller.abort());

    await expect(verifyTurnstile(fd, SECRET, { expectedHostname: HOSTNAME, signal: controller.signal })).rejects.toThrow();
  });

  it("rejects with the caller's reason when the caller aborts while the body is being read", async () => {
    const controller = new AbortController();
    withCapturedRequest(({ signal }) => {
      queueMicrotask(() => controller.abort(new Error("client disconnected")));
      return bodyThatNeverCompletes(signal);
    });
    const fd = new FormData();
    fd.append("cf-turnstile-response", "valid-token");

    await expect(verifyTurnstile(fd, SECRET, { expectedHostname: HOSTNAME, signal: controller.signal })).rejects.toThrow("client disconnected");
  });

  it("still returns parse-error for a malformed body while the caller's signal is live", async () => {
    savedFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("not json", { status: 200 });
    const fd = new FormData();
    fd.append("cf-turnstile-response", "valid-token");

    expect(await verifyTurnstile(fd, SECRET, { expectedHostname: HOSTNAME, signal: new AbortController().signal })).toEqual({
      ok: false,
      error: "parse-error",
    });
  });

  it("still resolves to timeout when it is the timeout that fired", async () => {
    savedFetch = globalThis.fetch;
    globalThis.fetch = async (_url: URL | RequestInfo, init?: RequestInit) => {
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject((init.signal as AbortSignal).reason));
      });
      return new Response("unreachable");
    };
    const fd = new FormData();
    fd.append("cf-turnstile-response", "valid-token");
    const controller = new AbortController();

    expect(await verifyTurnstile(fd, SECRET, { expectedHostname: HOSTNAME, timeoutMs: 1, signal: controller.signal })).toEqual({
      ok: false,
      error: "timeout",
    });
  });
});
