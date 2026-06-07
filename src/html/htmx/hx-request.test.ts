import { describe, expect, it } from "bun:test";
import { Forge } from "../../app/forge-app";
import { mapHandler } from "../../app/route-test-helper";
import { isHxRequest } from "./hx-request";

describe("isHxRequest predicate", () => {
  it("returns true when HX-Request header is 'true'", async () => {
    const app = new Forge();
    let captured: boolean | undefined;
    mapHandler(app, "GET", "/test", (c) => {
      captured = isHxRequest(c);
      return new Response("ok");
    });
    await app.request("/test", { headers: { "HX-Request": "true" } });
    expect(captured).toBe(true);
  });

  it("returns false when HX-Request header is absent", async () => {
    const app = new Forge();
    let captured: boolean | undefined;
    mapHandler(app, "GET", "/test", (c) => {
      captured = isHxRequest(c);
      return new Response("ok");
    });
    await app.request("/test");
    expect(captured).toBe(false);
  });

  it("returns false when HX-Request is not 'true'", async () => {
    const app = new Forge();
    let captured: boolean | undefined;
    mapHandler(app, "GET", "/test", (c) => {
      captured = isHxRequest(c);
      return new Response("ok");
    });
    await app.request("/test", { headers: { "HX-Request": "false" } });
    expect(captured).toBe(false);
  });
});
