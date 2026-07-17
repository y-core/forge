import { describe, expect, it } from "bun:test";
import { createApp } from "../app/app";
import { mapHandler } from "./route";

describe("mapHandler", () => {
  it("registers a single GET route reachable via app.request", async () => {
    const app = createApp();
    mapHandler(app, "GET", "/ping", () => new Response("pong"));
    const res = await app.request("/ping");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("pong");
  });

  it("registers a POST route that reads the request body", async () => {
    const app = createApp();
    mapHandler(app, "POST", "/echo", async (context) => {
      const req = (context as unknown as { request: Request }).request;
      return new Response(await req.text());
    });
    const res = await app.request("/echo", { method: "POST", body: "hi" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hi");
  });

  it("registers an action with middleware", async () => {
    const app = createApp();
    const order: string[] = [];
    mapHandler(app, "GET", "/mw", {
      middleware: [
        async (_context, next) => {
          order.push("mw");
          return next();
        },
      ],
      handler: () => {
        order.push("handler");
        return new Response("ok");
      },
    });
    const res = await app.request("/mw");
    expect(res.status).toBe(200);
    expect(order).toEqual(["mw", "handler"]);
  });
});
