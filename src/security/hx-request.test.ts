import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { requireHxRequest } from "./hx-request";

function makeApp() {
  const app = new Hono();
  app.use("*", requireHxRequest());
  app.post("/test", (c) => c.text("ok"));
  return app;
}

describe("requireHxRequest middleware", () => {
  it("passes when HX-Request is 'true'", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      method: "POST",
      headers: { "HX-Request": "true" },
    });
    expect(res.status).toBe(200);
  });

  it("returns 403 when HX-Request header is absent", async () => {
    const app = makeApp();
    const res = await app.request("/test", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("returns 403 when HX-Request is not 'true'", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      method: "POST",
      headers: { "HX-Request": "false" },
    });
    expect(res.status).toBe(403);
  });
});
