import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { requireFormContentType } from "./content-type";

function makeApp() {
  const app = new Hono();
  app.use("*", requireFormContentType());
  app.post("/test", (c) => c.text("ok"));
  return app;
}

describe("requireFormContentType middleware", () => {
  it("passes for application/x-www-form-urlencoded", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=Jane",
    });
    expect(res.status).toBe(200);
  });

  it("passes for multipart/form-data", async () => {
    const app = makeApp();
    const fd = new FormData();
    fd.append("name", "Jane");
    const res = await app.request("/test", {
      method: "POST",
      body: fd,
    });
    expect(res.status).toBe(200);
  });

  it("returns 415 for application/json", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Jane" }),
    });
    expect(res.status).toBe(415);
  });

  it("returns 415 when content-type is absent", async () => {
    const app = makeApp();
    const res = await app.request("/test", { method: "POST" });
    expect(res.status).toBe(415);
  });
});
