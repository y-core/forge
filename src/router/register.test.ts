import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { index, layout, route } from "./config";
import { applyRoutes } from "./register";

describe("applyRoutes — GET orchestration", () => {
  it("calls the loader before the view and passes loader data into the view", async () => {
    const app = new Hono();
    const order: string[] = [];

    applyRoutes(app, [
      route("/hello", {
        loader: () => {
          order.push("loader");
          return { greeting: "hello" };
        },
        view: (c, _config, state) => {
          order.push("view");
          expect(state.method).toBe("GET");
          expect(state.data).toEqual({ greeting: "hello" });
          expect(state.actionData).toBeUndefined();
          return c.text((state.data as { greeting: string }).greeting);
        },
      }),
    ]);

    const res = await app.request("/hello");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
    expect(order).toEqual(["loader", "view"]);
  });

  it("allows a view-only page route", async () => {
    const app = new Hono();

    applyRoutes(app, [
      route("/page", {
        view: (c, _config, state) => {
          expect(state.data).toBeUndefined();
          return c.text("page");
        },
      }),
    ]);

    const res = await app.request("/page");
    expect(await res.text()).toBe("page");
  });

  it("returns a direct response when the loader does", async () => {
    const app = new Hono();

    applyRoutes(app, [
      route("/redirect", {
        loader: () => new Response("redirect", { status: 302 }),
        view: (c) => c.text("unreachable"),
      }),
    ]);

    const res = await app.request("/redirect");
    expect(res.status).toBe(302);
    expect(await res.text()).toBe("redirect");
  });

  it("returns 500 when a GET route has a loader but no view", async () => {
    const app = new Hono();
    app.onError((err, c) => c.text(err.message, 500));

    applyRoutes(app, [route("/broken", { loader: () => ({ ok: true }) })]);

    const res = await app.request("/broken");
    expect(res.status).toBe(500);
  });
});

describe("applyRoutes — POST orchestration", () => {
  it("passes action data into the view for page routes", async () => {
    const app = new Hono();
    const order: string[] = [];

    applyRoutes(app, [
      route("/submit", {
        action: async () => {
          order.push("action");
          return { saved: true };
        },
        view: (c, _config, state) => {
          order.push("view");
          expect(state.method).toBe("POST");
          expect(state.actionData).toEqual({ saved: true });
          expect(state.data).toBeUndefined();
          return c.text("saved");
        },
      }),
    ]);

    const res = await app.request("/submit", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("saved");
    expect(order).toEqual(["action", "view"]);
  });

  it("returns a direct response from a resource action", async () => {
    const app = new Hono();

    applyRoutes(app, [
      route("/resource", {
        action: () => new Response("posted", { status: 201 }),
      }),
    ]);

    const res = await app.request("/resource", { method: "POST" });
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("posted");
  });

  it("returns 500 when an action returns data without a view", async () => {
    const app = new Hono();
    app.onError((err, c) => c.text(err.message, 500));

    applyRoutes(app, [
      route("/broken", {
        action: () => ({ ok: true }),
      }),
    ]);

    const res = await app.request("/broken", { method: "POST" });
    expect(res.status).toBe(500);
  });
});

describe("applyRoutes — index and nested routes", () => {
  it("registers an index route on the root path", async () => {
    const app = new Hono();
    applyRoutes(app, [index({ view: (c) => c.text("root") })]);

    const res = await app.request("/");
    expect(await res.text()).toBe("root");
  });

  it("registers child routes under the parent path", async () => {
    const app = new Hono();
    applyRoutes(app, [
      route("/api", { view: (c) => c.text("api root") }, [
        route("/users", { view: (c) => c.text("users") }),
      ]),
    ]);

    expect(await (await app.request("/api")).text()).toBe("api root");
    expect(await (await app.request("/api/users")).text()).toBe("users");
  });
});

describe("applyRoutes — middleware", () => {
  it("applies layout middleware to child routes", async () => {
    const app = new Hono();
    const calls: string[] = [];

    applyRoutes(app, [
      layout(
        {
          middleware: async (_c, next) => {
            calls.push("mw");
            await next();
          },
        },
        [route("/a", { view: (c) => c.text("a") }), route("/b", { view: (c) => c.text("b") })],
      ),
    ]);

    await app.request("/a");
    await app.request("/b");
    expect(calls).toEqual(["mw", "mw"]);
  });

  it("applies per-route middleware before handlers", async () => {
    const app = new Hono();
    const log: string[] = [];

    applyRoutes(app, [
      route("/x", {
        middleware: async (_c, next) => {
          log.push("before");
          await next();
          log.push("after");
        },
        loader: () => {
          log.push("loader");
          return { ok: true };
        },
        view: (c) => {
          log.push("view");
          return c.text("ok");
        },
      }),
    ]);

    await app.request("/x");
    expect(log).toEqual(["before", "loader", "view", "after"]);
  });
});
