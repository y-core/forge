import { describe, expect, it } from "bun:test";
import type { RateLimitConfig, WranglerConfig } from "../types";
import { rateLimitsHandler } from "./ratelimits";
import type { HandlerContext } from "./types";

const AUTH = { apiToken: "tok", accountId: "acc" };

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    auth: AUTH,
    scriptName: "cornellaw",
    prefix: "",
    dryRun: false,
    rotate: new Set<string>(),
    fetch: globalThis.fetch,
    target: { kind: "worker", name: "cornellaw" },
    ...overrides,
  };
}

const pagesCtx = (overrides: Partial<HandlerContext> = {}) => makeCtx({ target: { kind: "pages", name: "cornellaw" }, ...overrides });

function settingsFetch(bindings: unknown[]): typeof globalThis.fetch {
  return async () => new Response(JSON.stringify({ success: true, errors: [], messages: [], result: { bindings } }));
}

const MAIN_LIMITER: RateLimitConfig = { name: "MAIN_LIMITER", namespace_id: "1001", simple: { limit: 60, period: 60 } };

describe("rateLimitsHandler.extract()", () => {
  it("extracts ratelimits from config", () => {
    const config: WranglerConfig = { name: "t", ratelimits: [MAIN_LIMITER] };
    expect(rateLimitsHandler.extract(config)).toHaveLength(1);
  });

  it("returns empty when none are declared", () => {
    expect(rateLimitsHandler.extract({ name: "t" })).toEqual([]);
  });
});

describe("rateLimitsHandler — pages project", () => {
  it("reports the binding as inert, because Pages rejects ratelimits outright", async () => {
    // cornellaw's wrangler.jsonc is a Pages config declaring MAIN_LIMITER. wrangler's
    // supportedPagesConfigFields has no "ratelimits", so the block binds nothing.
    const res = await rateLimitsHandler.reconcile([MAIN_LIMITER], pagesCtx());
    expect(res.results[0]?.action).toBe("unavailable");
    expect(res.results[0]?.action).not.toBe("in-sync");
    expect(res.results[0]?.detail).toMatch(/not supported/);
    expect(res.results[0]?.detail).toMatch(/inert/);
  });

  it("makes no API call to reach that conclusion", async () => {
    let calls = 0;
    const counting: typeof globalThis.fetch = async () => {
      calls++;
      return new Response("{}");
    };
    await rateLimitsHandler.reconcile([MAIN_LIMITER], pagesCtx({ fetch: counting }));
    expect(calls).toBe(0);
  });
});

describe("rateLimitsHandler — worker script", () => {
  it("verifies a binding that matches the deployed worker", async () => {
    const fetchFn = settingsFetch([{ type: "ratelimit", name: "MAIN_LIMITER", namespace_id: "1001", simple: { limit: 60, period: 60 } }]);
    const res = await rateLimitsHandler.reconcile([MAIN_LIMITER], makeCtx({ fetch: fetchFn }));
    expect(res.results[0]?.action).toBe("in-sync");
    expect(res.results[0]?.detail).toBe("60/60s");
  });

  it("reports a limiter absent from the deployed worker as one the deploy adds", async () => {
    const res = await rateLimitsHandler.reconcile([MAIN_LIMITER], makeCtx({ fetch: settingsFetch([]) }));
    expect(res.results[0]?.action).toBe("deploy-pushes");
    expect([res.results[0]?.local, res.results[0]?.remote]).toEqual([true, false]);
  });

  it("reports drift in the limit with both sides shown", async () => {
    const fetchFn = settingsFetch([{ type: "ratelimit", name: "MAIN_LIMITER", namespace_id: "1001", simple: { limit: 1000, period: 60 } }]);
    const res = await rateLimitsHandler.reconcile([MAIN_LIMITER], makeCtx({ fetch: fetchFn }));
    expect(res.results[0]?.action).toBe("drift");
    expect(res.results[0]?.detail).toContain("1000/60s");
    expect(res.results[0]?.detail).toContain("60/60s");
  });

  it("reports drift in the namespace id", async () => {
    const fetchFn = settingsFetch([{ type: "ratelimit", name: "MAIN_LIMITER", namespace_id: "2002", simple: { limit: 60, period: 60 } }]);
    const res = await rateLimitsHandler.reconcile([MAIN_LIMITER], makeCtx({ fetch: fetchFn }));
    expect(res.results[0]?.action).toBe("drift");
    expect(res.results[0]?.detail).toContain("ns 2002");
  });

  it("ignores non-ratelimit bindings of the same name", async () => {
    const fetchFn = settingsFetch([{ type: "plain_text", name: "MAIN_LIMITER", text: "x" }]);
    const res = await rateLimitsHandler.reconcile([MAIN_LIMITER], makeCtx({ fetch: fetchFn }));
    expect(res.results[0]?.action).toBe("deploy-pushes");
    expect(res.results[0]?.remote).toBe(false);
  });

  it("separates a missing worker from an auth failure", async () => {
    const notFound: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ success: false, errors: [{ code: 7003, message: "no route" }], messages: [], result: null }), { status: 404 });
    const badAuth: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ success: false, errors: [{ code: 9106, message: "auth" }], messages: [], result: null }), { status: 400 });

    const missing = await rateLimitsHandler.reconcile([MAIN_LIMITER], makeCtx({ fetch: notFound }));
    const auth = await rateLimitsHandler.reconcile([MAIN_LIMITER], makeCtx({ fetch: badAuth }));

    expect(missing.results[0]?.action).toBe("unavailable");
    expect(auth.results[0]?.action).toBe("error");
  });

  it("never claims in-sync without having queried", async () => {
    let calls = 0;
    const fetchFn: typeof globalThis.fetch = async () => {
      calls++;
      return new Response(
        JSON.stringify({
          success: true,
          errors: [],
          messages: [],
          result: { bindings: [{ type: "ratelimit", name: "MAIN_LIMITER", namespace_id: "1001", simple: { limit: 60, period: 60 } }] },
        }),
      );
    };
    const res = await rateLimitsHandler.reconcile([MAIN_LIMITER], makeCtx({ fetch: fetchFn }));
    expect(res.results[0]?.action).toBe("in-sync");
    expect(calls).toBeGreaterThan(0);
  });
});
