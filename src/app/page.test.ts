import { describe, expect, it } from "bun:test";
import type { Env } from "hono";
import { Hono } from "hono";
import { applyRoutes, route } from "../router/mod";
import type { RouteModule } from "../router/types";
import { definePage } from "./page";

function makeApp(pageModule: unknown) {
  const app = new Hono();
  applyRoutes(app, [route("/test", pageModule as RouteModule<Env>)]);
  return app;
}

describe("definePage", () => {
  it("renders the view with loader data", async () => {
    const app = makeApp(
      definePage({
        loader: () => ({ message: "hello" }),
        view: (c, _config, state) => c.text((state.data as { message: string }).message),
      }),
    );

    const res = await app.request("/test");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  it("renders POST action data through the view", async () => {
    const app = makeApp(
      definePage({
        action: () => ({ ok: true }),
        view: (c, _config, state) => c.text(String((state.actionData as { ok: boolean }).ok)),
      }),
    );

    const res = await app.request("/test", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("true");
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

  it("calls onError when the view throws", async () => {
    const app = makeApp(
      definePage({
        view: () => {
          throw new Error("render failed");
        },
        onError: (_err, c) => c.text("page error", 500),
      }),
    );

    const res = await app.request("/test");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("page error");
  });

  it("calls onError when the loader throws", async () => {
    const app = makeApp(
      definePage({
        loader: () => {
          throw new Error("loader failed");
        },
        view: (c) => c.text("unreachable"),
        onError: (_err, c) => c.text("loader error", 500),
      }),
    );

    const res = await app.request("/test");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("loader error");
  });

  it("runs middleware before the loader and view", async () => {
    const order: string[] = [];
    const app = makeApp(
      definePage({
        middleware: async (_c, next) => {
          order.push("mw");
          return next();
        },
        loader: () => {
          order.push("loader");
          return { ok: true };
        },
        view: (c) => {
          order.push("view");
          return c.text("ok");
        },
      }),
    );

    await app.request("/test");
    expect(order).toEqual(["mw", "loader", "view"]);
  });
});
