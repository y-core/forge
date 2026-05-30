import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { isHxRequest } from "./hx-request";

describe("isHxRequest predicate", () => {
  it("returns true when HX-Request header is 'true'", async () => {
    const app = new Hono();
    let captured: boolean | undefined;
    app.get("/test", (c) => {
      captured = isHxRequest(c);
      return c.text("ok");
    });
    await app.request("/test", { headers: { "HX-Request": "true" } });
    expect(captured).toBe(true);
  });

  it("returns false when HX-Request header is absent", async () => {
    const app = new Hono();
    let captured: boolean | undefined;
    app.get("/test", (c) => {
      captured = isHxRequest(c);
      return c.text("ok");
    });
    await app.request("/test");
    expect(captured).toBe(false);
  });

  it("returns false when HX-Request is not 'true'", async () => {
    const app = new Hono();
    let captured: boolean | undefined;
    app.get("/test", (c) => {
      captured = isHxRequest(c);
      return c.text("ok");
    });
    await app.request("/test", { headers: { "HX-Request": "false" } });
    expect(captured).toBe(false);
  });
});
