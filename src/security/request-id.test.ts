import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { RequestIdContext } from "./request-id";
import { requestId } from "./request-id";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeApp() {
  const app = new Hono<{ Variables: RequestIdContext }>();
  app.use("*", requestId());
  app.get("/test", (c) => c.json({ id: c.get("requestId") }));
  return app;
}

describe("requestId middleware", () => {
  it("uses the inbound CF-Ray header as the request ID", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      headers: { "CF-Ray": "abc123def456-IAD" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Request-Id")).toBe("abc123def456-IAD");
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe("abc123def456-IAD");
  });

  it("generates a UUID when CF-Ray is absent", async () => {
    const app = makeApp();
    const res = await app.request("/test");
    expect(res.status).toBe(200);
    const xReqId = res.headers.get("X-Request-Id");
    expect(xReqId).not.toBe(null);
    expect(UUID_RE.test(xReqId!)).toBe(true);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(xReqId);
  });

  it("ignores an inbound X-Request-Id and uses CF-Ray instead", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      headers: {
        "CF-Ray": "ray-from-cf",
        "X-Request-Id": "client-supplied-id",
      },
    });
    expect(res.headers.get("X-Request-Id")).toBe("ray-from-cf");
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe("ray-from-cf");
  });

  it("ignores an inbound X-Request-Id and generates a UUID when CF-Ray is also absent", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      headers: { "X-Request-Id": "client-supplied-id" },
    });
    const xReqId = res.headers.get("X-Request-Id");
    expect(xReqId).not.toBe("client-supplied-id");
    expect(xReqId).not.toBe(null);
    expect(UUID_RE.test(xReqId!)).toBe(true);
  });
});
