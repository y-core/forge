import { describe, expect, it } from "bun:test";
import { Forge } from "../app/forge-app";
import { mapHandler } from "../app/route-test-helper";
import { rateLimit } from "./rate-limit";
import type { RateLimitBinding } from "./types";

type Env = { LIMITER?: RateLimitBinding };

function makeApp(opts?: Partial<Parameters<typeof rateLimit>[0]>) {
  const app = new Forge<Env>();
  app.use("*", rateLimit<Env>({ limiter: (c) => c.env.LIMITER, ...opts }));
  mapHandler(app, "POST", "/test", () => new Response("ok"));
  return app;
}

describe("rateLimit middleware", () => {
  it("returns 429 when rate limit is exceeded", async () => {
    const app = makeApp();
    const res = await app.request(
      "/test",
      { method: "POST", headers: { "CF-Connecting-IP": "1.2.3.4" } },
      { LIMITER: { limit: async () => ({ success: false }) } },
    );
    expect(res.status).toBe(429);
    expect(await res.text()).toBe("Too many requests. Please try again later.");
  });

  it("passes through when rate limit allows", async () => {
    const app = makeApp();
    const res = await app.request(
      "/test",
      { method: "POST", headers: { "CF-Connecting-IP": "1.2.3.4" } },
      { LIMITER: { limit: async () => ({ success: true }) } },
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("keys by CF-Connecting-IP", async () => {
    const app = makeApp();
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

  it("returns 503 when CF-Connecting-IP is absent and no custom key is provided (fail-closed)", async () => {
    const app = makeApp();
    const res = await app.request("/test", { method: "POST" }, { LIMITER: { limit: async () => ({ success: true }) } });
    expect(res.status).toBe(503);
  });

  it("returns 503 when binding is undefined (default required: true)", async () => {
    const app = makeApp();
    const res = await app.request("/test", { method: "POST" });
    expect(res.status).toBe(503);
  });

  it("skips when binding is undefined and required: false", async () => {
    const app = makeApp({ required: false });
    const res = await app.request("/test", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("uses custom key function", async () => {
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
    const app = makeApp({ onLimit: () => Response.json({ error: "rate limited" }, { status: 429 }) });
    const res = await app.request(
      "/test",
      { method: "POST", headers: { "CF-Connecting-IP": "1.2.3.4" } },
      { LIMITER: { limit: async () => ({ success: false }) } },
    );
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate limited" });
  });
});
