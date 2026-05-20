import { beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { defineSecurity } from "./compose";
import { importCsrfKey } from "./csrf";

const HEX_SECRET = "c".repeat(64);

type CsrfVars = { Variables: { csrfToken?: string } };

describe("defineSecurity", () => {
  let key: CryptoKey;

  beforeAll(async () => {
    key = await importCsrfKey(HEX_SECRET);
  });

  it("returns an empty array when config is empty", () => {
    expect(defineSecurity({})).toEqual([]);
  });

  it("applies hxRequest guard when configured", async () => {
    const app = new Hono();
    for (const mw of defineSecurity({ hxRequest: true })) app.use("*", mw);
    app.post("/test", (c) => c.text("ok"));

    const denied = await app.request("/test", { method: "POST" });
    expect(denied.status).toBe(403);

    const allowed = await app.request("/test", {
      method: "POST",
      headers: { "HX-Request": "true" },
    });
    expect(allowed.status).toBe(200);
  });

  it("applies contentType guard when configured", async () => {
    const app = new Hono();
    for (const mw of defineSecurity({ contentType: true })) app.use("*", mw);
    app.post("/test", (c) => c.text("ok"));

    const denied = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(denied.status).toBe(415);

    const allowed = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=Jane",
    });
    expect(allowed.status).toBe(200);
  });

  it("applies multiple guards in order — hxRequest checked before contentType", async () => {
    const app = new Hono();
    for (const mw of defineSecurity({ hxRequest: true, contentType: true })) app.use("*", mw);
    app.post("/test", (c) => c.text("ok"));

    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(403);
  });

  it("applies CSRF guard when configured", async () => {
    const app = new Hono<CsrfVars>();
    for (const mw of defineSecurity({ csrf: { secret: key } })) app.use("*", mw);
    app.get("/test", (c) => c.text(c.get("csrfToken") ?? ""));
    app.post("/test", (c) => c.text("ok"));

    const getRes = await app.request("/test");
    const token = await getRes.text();

    const postRes = await app.request("/test", {
      method: "POST",
      headers: { "X-CSRF-Token": token },
    });
    expect(postRes.status).toBe(200);

    const badRes = await app.request("/test", {
      method: "POST",
      headers: { "X-CSRF-Token": "bad.token" },
    });
    expect(badRes.status).toBe(403);
  });
});
