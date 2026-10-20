import { afterEach, describe, expect, it, spyOn } from "bun:test";

import { Forge } from "../app/forge-app";
import { mapHandler } from "../testing/route";
import * as securityBarrel from "./mod";
import { limitRequests, rateLimit } from "./rate-limit";
import type { RateLimitBinding } from "./types";

type Env = { LIMITER?: RateLimitBinding };

function makeApp(opts?: Partial<Parameters<typeof rateLimit>[0]>) {
  const app = new Forge<Env>();
  app.use("*", rateLimit<Env>({ limiter: (c) => c.env.LIMITER, ...opts }));
  mapHandler(app, "POST", "/test", () => new Response("ok"));
  return app;
}

function makeRelaxedApp() {
  const app = new Forge<Env>();
  app.use(
    "*",
    limitRequests<Env>({ limiter: (c) => c.env.LIMITER, trustCfHeaders: true }, () => true),
  );
  mapHandler(app, "POST", "/test", () => new Response("ok"));
  return app;
}

describe("rateLimit middleware", () => {
  it("returns 429 when rate limit is exceeded", async () => {
    const app = makeApp({ trustCfHeaders: true });
    const res = await app.request(
      "/test",
      { method: "POST", headers: { "CF-Connecting-IP": "1.2.3.4" } },
      { LIMITER: { limit: async () => ({ success: false }) } },
    );
    expect(res.status).toBe(429);
    expect(await res.text()).toBe("Too many requests. Please try again later.");
  });

  it("passes through when rate limit allows", async () => {
    const app = makeApp({ trustCfHeaders: true });
    const res = await app.request(
      "/test",
      { method: "POST", headers: { "CF-Connecting-IP": "1.2.3.4" } },
      { LIMITER: { limit: async () => ({ success: true }) } },
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("keys by CF-Connecting-IP when trustCfHeaders is true", async () => {
    const app = makeApp({ trustCfHeaders: true });
    let capturedKey: string | undefined;
    await app.request(
      "/test",
      { method: "POST", headers: { "CF-Connecting-IP": "5.6.7.8" } },
      {
        LIMITER: {
          limit: async ({ key }: { key: string }) => {
            capturedKey = key;
            return { success: true };
          },
        },
      },
    );
    expect(capturedKey).toBe("5.6.7.8");
  });

  it("returns 503 by default (no trustCfHeaders, no key) even when CF-Connecting-IP is present", async () => {
    const app = makeApp();
    const res = await app.request(
      "/test",
      { method: "POST", headers: { "CF-Connecting-IP": "1.2.3.4" } },
      { LIMITER: { limit: async () => ({ success: true }) } },
    );
    expect(res.status).toBe(503);
  });

  it("returns 503 when CF-Connecting-IP is absent under trustCfHeaders (fail-closed)", async () => {
    const app = makeApp({ trustCfHeaders: true });
    const res = await app.request("/test", { method: "POST" }, { LIMITER: { limit: async () => ({ success: true }) } });
    expect(res.status).toBe(503);
  });

  it("returns 503 when binding is undefined in a build not armed for development", async () => {
    const app = makeApp();
    const res = await app.request("/test", { method: "POST" });
    expect(res.status).toBe(503);
  });

  it("skips when binding is undefined under a relaxation that admits its absence", async () => {
    const res = await makeRelaxedApp().request("/test", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("still enforces a present binding under a relaxation that admits an absent one", async () => {
    const res = await makeRelaxedApp().request(
      "/test",
      { method: "POST", headers: { "CF-Connecting-IP": "1.2.3.4" } },
      { LIMITER: { limit: async () => ({ success: false }) } },
    );
    expect({ status: res.status, body: await res.text() }).toEqual({ status: 429, body: "Too many requests. Please try again later." });
  });

  it("returns 503 when a relaxing `dev` is smuggled into the options past the type", async () => {
    const app = makeApp({ dev: () => true } as never);
    const res = await app.request("/test", { method: "POST" });
    expect(res.status).toBe(503);
  });

  it("takes no `dev` option, so only a development build relaxes it", () => {
    // @ts-expect-error — `rateLimit` takes no `dev` option
    rateLimit<Env>({ limiter: (c) => c.env.LIMITER, dev: true });
  });

  it("uses custom key function regardless of trustCfHeaders", async () => {
    const app = makeApp({ key: () => "custom" });
    let capturedKey: string | undefined;
    await app.request(
      "/test",
      { method: "POST" },
      {
        LIMITER: {
          limit: async ({ key }: { key: string }) => {
            capturedKey = key;
            return { success: true };
          },
        },
      },
    );
    expect(capturedKey).toBe("custom");
  });

  it("uses custom onLimit response", async () => {
    const app = makeApp({ trustCfHeaders: true, onLimit: () => Response.json({ error: "rate limited" }, { status: 429 }) });
    const res = await app.request(
      "/test",
      { method: "POST", headers: { "CF-Connecting-IP": "1.2.3.4" } },
      { LIMITER: { limit: async () => ({ success: false }) } },
    );
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate limited" });
  });
});

describe("rateLimit — a failing binding or key", () => {
  let consoleLog: ReturnType<typeof spyOn<Console, "log">> | undefined;

  afterEach(() => {
    consoleLog?.mockRestore();
    consoleLog = undefined;
  });

  function loggedLines(): Record<string, unknown>[] {
    return (consoleLog?.mock.calls ?? []).map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
  }

  function countingApp(opts: Partial<Parameters<typeof rateLimit>[0]>) {
    const app = new Forge<Env>();
    const reached: string[] = [];
    app.use("*", rateLimit<Env>({ limiter: (c) => c.env.LIMITER, ...opts }));
    mapHandler(app, "POST", "/test", () => {
      reached.push("handler");
      return new Response("ok");
    });
    return { app, reached };
  }

  const outage = new Error("rate limiter unreachable");
  for (const { name, limit } of [
    {
      name: "throws",
      limit: (): Promise<{ success: boolean }> => {
        throw outage;
      },
    },
    { name: "rejects", limit: (): Promise<{ success: boolean }> => Promise.reject(outage) },
  ]) {
    it(`refuses with 503 and logs an error when the binding's limit ${name}`, async () => {
      consoleLog = spyOn(console, "log").mockImplementation(() => {});
      const { app, reached } = countingApp({ key: () => "client-1" });
      const res = await app.request("/test", { method: "POST" }, { LIMITER: { limit } });
      expect(res.status).toBe(503);
      expect(await res.text()).toBe("Service unavailable");
      expect(reached).toEqual([]);
      expect(loggedLines().map(({ timestamp: _timestamp, ...line }) => line)).toEqual([
        {
          level: "error",
          prefix: "rate-limit",
          message: "Rate limiter binding failed — refusing the request",
          error: { type: "Error", detail: "rate limiter unreachable", stack: outage.stack },
        },
      ]);
    });
  }

  it("logs a key-resolution failure with the error as a structured object", async () => {
    consoleLog = spyOn(console, "log").mockImplementation(() => {});
    const keyFailure = new Error("tenant header missing");
    const { app, reached } = countingApp({
      key: () => {
        throw keyFailure;
      },
    });
    const res = await app.request("/test", { method: "POST" }, { LIMITER: { limit: async () => ({ success: true }) } });
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("Service unavailable");
    expect(reached).toEqual([]);
    expect(loggedLines().map(({ timestamp: _timestamp, ...line }) => line)).toEqual([
      {
        level: "warn",
        prefix: "rate-limit",
        message: "Rate limit key resolution failed — refusing the request",
        error: { type: "Error", detail: "tenant header missing", stack: keyFailure.stack },
      },
    ]);
  });
});

describe("limitRequests", () => {
  it("stays off the security barrel, so no consumer reaches the relaxation", () => {
    expect(Object.values<unknown>(securityBarrel).includes(limitRequests)).toBe(false);
  });
});
