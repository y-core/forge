import { describe, expect, it } from "bun:test";
import { Forge } from "../app/forge-app";
import { mapHandler } from "../app/route-test-helper";
import { requestId, requestIdCtx } from "./request-id";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeApp(options?: { trustCfHeaders?: boolean }) {
  const app = new Forge();
  app.use("*", requestId(options));
  mapHandler(app, "GET", "/test", (c) => Response.json({ id: requestIdCtx.get(c) }));
  return app;
}

describe("requestId middleware", () => {
  it("ignores a spoofed CF-Ray by default and generates a fresh UUID", async () => {
    const app = makeApp();
    const res = await app.request("/test", { headers: { "CF-Ray": "abc123def456-IAD" } });
    expect(res.status).toBe(200);
    const xReqId = res.headers.get("X-Request-Id");
    expect(xReqId).not.toBe("abc123def456-IAD");
    expect(xReqId).not.toBe(null);
    expect(UUID_RE.test(xReqId!)).toBe(true);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(xReqId);
  });

  it("generates a UUID when CF-Ray is absent (default)", async () => {
    const app = makeApp();
    const res = await app.request("/test");
    expect(res.status).toBe(200);
    const xReqId = res.headers.get("X-Request-Id");
    expect(xReqId).not.toBe(null);
    expect(UUID_RE.test(xReqId!)).toBe(true);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(xReqId);
  });

  it("adopts the inbound CF-Ray header when trustCfHeaders is true", async () => {
    const app = makeApp({ trustCfHeaders: true });
    const res = await app.request("/test", { headers: { "CF-Ray": "abc123def456-IAD" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Request-Id")).toBe("abc123def456-IAD");
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe("abc123def456-IAD");
  });

  it("generates a UUID when trustCfHeaders is true but CF-Ray is absent", async () => {
    const app = makeApp({ trustCfHeaders: true });
    const res = await app.request("/test");
    expect(res.status).toBe(200);
    const xReqId = res.headers.get("X-Request-Id");
    expect(xReqId).not.toBe(null);
    expect(UUID_RE.test(xReqId!)).toBe(true);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(xReqId);
  });

  it("ignores an inbound X-Request-Id and uses CF-Ray when trustCfHeaders is true", async () => {
    const app = makeApp({ trustCfHeaders: true });
    const res = await app.request("/test", { headers: { "CF-Ray": "ray-from-cf", "X-Request-Id": "client-supplied-id" } });
    expect(res.headers.get("X-Request-Id")).toBe("ray-from-cf");
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe("ray-from-cf");
  });

  it("ignores an inbound X-Request-Id and generates a UUID when CF-Ray is also absent", async () => {
    const app = makeApp({ trustCfHeaders: true });
    const res = await app.request("/test", { headers: { "X-Request-Id": "client-supplied-id" } });
    const xReqId = res.headers.get("X-Request-Id");
    expect(xReqId).not.toBe("client-supplied-id");
    expect(xReqId).not.toBe(null);
    expect(UUID_RE.test(xReqId!)).toBe(true);
  });
});
