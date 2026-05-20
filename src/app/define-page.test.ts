import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { applyRoutes, route } from "../router/mod";
import { definePage } from "./define-page";

function makeApp(pageModule: ReturnType<typeof definePage>) {
  const app = new Hono();
  applyRoutes(app, [route("/test", pageModule)]);
  return app;
}

describe("definePage", () => {
  it("renders the view", async () => {
    const app = makeApp(
      definePage({
        view: (c) => c.text("hello"),
      }),
    );
    const res = await app.request("/test");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  it("sets cache-control: no-store when cache is 'no-store'", async () => {
    const app = makeApp(
      definePage({
        cache: "no-store",
        view: (c) => c.text("ok"),
      }),
    );
    const res = await app.request("/test");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("sets public max-age cache header", async () => {
    const app = makeApp(
      definePage({
        cache: { maxAge: 3600 },
        view: (c) => c.text("ok"),
      }),
    );
    const res = await app.request("/test");
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
  });

  it("sets private cache header when scope is private", async () => {
    const app = makeApp(
      definePage({
        cache: { maxAge: 60, scope: "private" },
        view: (c) => c.text("ok"),
      }),
    );
    const res = await app.request("/test");
    expect(res.headers.get("cache-control")).toBe("private, max-age=60");
  });

  it("sets custom headers", async () => {
    const app = makeApp(
      definePage({
        headers: { "x-custom": "value" },
        view: (c) => c.text("ok"),
      }),
    );
    const res = await app.request("/test");
    expect(res.headers.get("x-custom")).toBe("value");
  });

  it("runs middleware before the view", async () => {
    const order: string[] = [];
    const app = makeApp(
      definePage({
        middleware: async (_c, next) => {
          order.push("mw");
          return next();
        },
        view: (c) => {
          order.push("view");
          return c.text("ok");
        },
      }),
    );
    await app.request("/test");
    expect(order).toEqual(["mw", "view"]);
  });
});
