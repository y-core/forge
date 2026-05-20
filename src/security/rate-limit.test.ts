import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { RateLimitBinding } from "./rate-limit";
import { rateLimit } from "./rate-limit";

type Env = { LIMITER?: RateLimitBinding };

function makeApp(opts?: Partial<Parameters<typeof rateLimit>[0]>) {
  const app = new Hono<{ Bindings: Env }>();
  app.use(
    "*",
    rateLimit({
      limiter: (c) => (c.env as Env | undefined)?.LIMITER,
      ...opts,
    }),
  );
  app.post("/test", (c) => c.text("ok"));
  return app;
}

const EXPECTED_429_HTML =
  '<div class="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"><p>Too many requests. Please try again later.</p></div>';

describe("rateLimit middleware", () => {
  it("returns 429 when rate limit is exceeded", async () => {
    const app = makeApp();
    const res = await app.request(
      "/test",
      { method: "POST" },
      { LIMITER: { limit: async () => ({ success: false }) } },
    );
    expect(res.status).toBe(429);
    expect(await res.text()).toBe(EXPECTED_429_HTML);
  });

  it("passes through when rate limit allows", async () => {
    const app = makeApp();
    const res = await app.request(
      "/test",
      { method: "POST" },
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

  it("falls back to 'unknown' when CF-Connecting-IP header is absent", async () => {
    const app = makeApp();
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
    expect(capturedKey).toBe("unknown");
  });

  it("skips when binding is undefined", async () => {
    const app = makeApp();
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
    const app = makeApp({ onLimit: (c) => c.json({ error: "rate limited" }, 429) });
    const res = await app.request(
      "/test",
      { method: "POST" },
      { LIMITER: { limit: async () => ({ success: false }) } },
    );
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate limited" });
  });
});
