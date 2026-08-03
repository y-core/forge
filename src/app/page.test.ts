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

  it("invokes action on a POST and hands its result to the view as actionData", async () => {
    const app = new Forge();
    mapHandler(
      app,
      "POST",
      "/test",
      definePage({
        action: () => ({ saved: true }),
        view: (_c, _config, state) => Response.json({ actionData: state.actionData, method: state.method }),
      }),
    );

    const res = await app.request("/test", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ actionData: { saved: true }, method: "POST" });
  });

  it("runs action before loader so the view sees post-mutation data", async () => {
    const order: string[] = [];
    const app = new Forge();
    mapHandler(
      app,
      "POST",
      "/test",
      definePage({
        action: () => {
          order.push("action");
          return "done";
        },
        loader: () => {
          order.push("loader");
          return { count: 1 };
        },
        view: () => {
          order.push("view");
          return new Response("ok");
        },
      }),
    );

    await app.request("/test", { method: "POST" });
    expect(order).toEqual(["action", "loader", "view"]);
  });

  it("short-circuits rendering when action returns a Response, still applying headers", async () => {
    const app = new Forge();
    mapHandler(
      app,
      "POST",
      "/test",
      definePage({
        cache: "no-store",
        action: () => new Response(null, { status: 303, headers: { location: "/done" } }),
        view: () => new Response("unreachable"),
      }),
    );

    const res = await app.request("/test", { method: "POST" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/done");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("skips action on a GET and renders with actionData undefined", async () => {
    let called = false;
    const app = makeApp(
      definePage({
        action: () => {
          called = true;
          return "should not run";
        },
        view: (_c, _config, state) => Response.json({ actionData: state.actionData ?? null, method: state.method }),
      }),
    );

    const res = await app.request("/test");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ actionData: null, method: "GET" });
    expect(called).toBe(false);
  });

  it("sends a throwing action through the same boundary as a throwing view", async () => {
    const app = new Forge();
    mapHandler(
      app,
      "POST",
      "/boundary",
      definePage({
        action: () => {
          throw new Error("action failed");
        },
        view: () => new Response("unreachable"),
      }),
    );

    const res = await app.request("/boundary", { method: "POST" });
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("An unexpected error occurred.");
  });

  it("calls onError when the action throws", async () => {
    const app = new Forge();
    mapHandler(
      app,
      "POST",
      "/test",
      definePage({
        action: () => {
          throw new Error("action failed");
        },
        view: () => new Response("unreachable"),
        onError: () => new Response("action error", { status: 500 }),
      }),
    );

    const res = await app.request("/test", { method: "POST" });
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("action error");
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
