import { describe, expect, it } from "bun:test";
import { Forge } from "./forge-app";
import { definePage } from "./page";
import { mapHandler } from "./route-test-helper";

function makeApp(handler: ReturnType<typeof definePage>) {
  const app = new Forge();
  mapHandler(app, "GET", "/test", handler);
  return app;
}

describe("definePage", () => {
  it("renders the view with loader data", async () => {
    const app = makeApp(
      definePage({ loader: () => ({ message: "hello" }), view: (_c, _config, state) => new Response((state.data as { message: string }).message) }),
    );

    const res = await app.request("/test");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  it("sets cache-control: no-store when cache is 'no-store'", async () => {
    const app = makeApp(definePage({ cache: "no-store", view: () => new Response("ok") }));

    const res = await app.request("/test");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("sets public max-age cache header", async () => {
    const app = makeApp(definePage({ cache: { maxAge: 3600 }, view: () => new Response("ok") }));

    const res = await app.request("/test");
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
  });

  it("sets private cache header when scope is private", async () => {
    const app = makeApp(definePage({ cache: { maxAge: 60, scope: "private" }, view: () => new Response("ok") }));

    const res = await app.request("/test");
    expect(res.headers.get("cache-control")).toBe("private, max-age=60");
  });

  it("sets custom headers", async () => {
    const app = makeApp(definePage({ headers: { "x-custom": "value" }, view: () => new Response("ok") }));

    const res = await app.request("/test");
    expect(res.headers.get("x-custom")).toBe("value");
  });

  it("calls onError when the view throws", async () => {
    const app = makeApp(
      definePage({
        view: () => {
          throw new Error("render failed");
        },
        onError: () => new Response("page error", { status: 500 }),
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
        view: () => new Response("unreachable"),
        onError: () => new Response("loader error", { status: 500 }),
      }),
    );

    const res = await app.request("/test");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("loader error");
  });

  it("runs controller middleware before the loader and view", async () => {
    const order: string[] = [];
    const app = new Forge();
    mapHandler(app, "GET", "/test", {
      middleware: [
        async (_c, next) => {
          order.push("mw");
          return next();
        },
      ],
      handler: definePage({
        loader: () => {
          order.push("loader");
          return { ok: true };
        },
        view: () => {
          order.push("view");
          return new Response("ok");
        },
      }),
    });

    await app.request("/test");
    expect(order).toEqual(["mw", "loader", "view"]);
  });
});
