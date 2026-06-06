import { describe, expect, it } from "bun:test";
import { Forge } from "../app/forge-app";
import { mapHandler } from "../app/route-test-helper";
import { requireFormContentType } from "./content-type";

function makeApp() {
  const app = new Forge();
  app.use("*", requireFormContentType());
  mapHandler(app, "POST", "/test", () => new Response("ok"));
  return app;
}

describe("requireFormContentType middleware", () => {
  it("passes for application/x-www-form-urlencoded", async () => {
    const app = makeApp();
    const res = await app.request("/test", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "name=Jane" });
    expect(res.status).toBe(200);
  });

  it("passes for multipart/form-data", async () => {
    const app = makeApp();
    const fd = new FormData();
    fd.append("name", "Jane");
    const res = await app.request("/test", { method: "POST", body: fd });
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

  it("passes for an uppercased media type (case-insensitive)", async () => {
    const app = makeApp();
    const res = await app.request("/test", { method: "POST", headers: { "content-type": "Application/X-WWW-Form-Urlencoded" }, body: "name=Jane" });
    expect(res.status).toBe(200);
  });

  it("passes for an uppercased media type with a charset parameter", async () => {
    const app = makeApp();
    const res = await app.request("/test", { method: "POST", headers: { "content-type": "MULTIPART/FORM-DATA; boundary=xyz" }, body: "ignored" });
    expect(res.status).toBe(200);
  });
});
