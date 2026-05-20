import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { index, layout, route } from "./config";
import { applyRoutes } from "./register";

describe("applyRoutes — route()", () => {
  it("registers a GET handler via loader", async () => {
    const app = new Hono();
    applyRoutes(app, [route("/hello", { loader: (c) => c.text("hello") })]);
    const res = await app.request("/hello");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  it("registers a GET handler via view", async () => {
    const app = new Hono();
    applyRoutes(app, [route("/page", { view: (c) => c.text("page") })]);
    const res = await app.request("/page");
    expect(await res.text()).toBe("page");
  });

  it("prefers view over loader for GET", async () => {
    const app = new Hono();
    applyRoutes(app, [
      route("/x", { loader: (c) => c.text("loader"), view: (c) => c.text("view") }),
    ]);
    expect(await (await app.request("/x")).text()).toBe("view");
  });

  it("registers a POST handler via action", async () => {
    const app = new Hono();
    applyRoutes(app, [route("/submit", { action: (c) => c.text("posted") })]);
    const res = await app.request("/submit", { method: "POST" });
    expect(await res.text()).toBe("posted");
  });

  it("registers both GET and POST on the same path", async () => {
    const app = new Hono();
    applyRoutes(app, [
      route("/form", { loader: (c) => c.text("get"), action: (c) => c.text("post") }),
    ]);
    expect(await (await app.request("/form")).text()).toBe("get");
    expect(await (await app.request("/form", { method: "POST" })).text()).toBe("post");
  });
});

describe("applyRoutes — index()", () => {
  it("registers on the root path when no prefix", async () => {
    const app = new Hono();
    applyRoutes(app, [index({ loader: (c) => c.text("root") })]);
    const res = await app.request("/");
    expect(await res.text()).toBe("root");
  });
});

describe("applyRoutes — nested routes", () => {
  it("registers child routes under the parent path", async () => {
    const app = new Hono();
    applyRoutes(app, [
      route("/api", { loader: (c) => c.text("api root") }, [
        route("/users", { loader: (c) => c.text("users") }),
      ]),
    ]);
    expect(await (await app.request("/api")).text()).toBe("api root");
    expect(await (await app.request("/api/users")).text()).toBe("users");
  });
});

describe("applyRoutes — layout() middleware", () => {
  it("applies layout middleware to all child routes", async () => {
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
        [route("/a", { loader: (c) => c.text("a") }), route("/b", { loader: (c) => c.text("b") })],
      ),
    ]);

    await app.request("/a");
    await app.request("/b");
    expect(calls).toEqual(["mw", "mw"]);
  });
});

describe("applyRoutes — per-route middleware", () => {
  it("applies module middleware before the handler", async () => {
    const app = new Hono();
    const log: string[] = [];

    applyRoutes(app, [
      route("/x", {
        middleware: async (_c, next) => {
          log.push("before");
          await next();
          log.push("after");
        },
        loader: (c) => {
          log.push("handler");
          return c.text("ok");
        },
      }),
    ]);

    await app.request("/x");
    expect(log).toEqual(["before", "handler", "after"]);
  });
});
