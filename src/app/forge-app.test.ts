import { describe, expect, it } from "bun:test";

import type { Middleware } from "@remix-run/fetch-router";

import type { AppContext } from "../context/types";
import type { LogRecord, Logger } from "../logging/types";
import { mapHandler } from "../testing/route";
import { Forge } from "./forge-app";

function capturingLogger(records: Partial<LogRecord>[]): Logger {
  const logger: Logger = {
    debug: (message, data) => records.push({ level: "debug", message, ...(data ? { data } : {}) }),
    info: (message, data) => records.push({ level: "info", message, ...(data ? { data } : {}) }),
    warn: (message, data) => records.push({ level: "warn", message, ...(data ? { data } : {}) }),
    error: (message, data) => records.push({ level: "error", message, ...(data ? { data } : {}) }),
    flush: async () => {},
    child: () => logger,
  };
  return logger;
}

const probe = (label: string, order: string[]): Middleware => {
  return (_context, next) => {
    order.push(label);
    return next();
  };
};

const ERROR_PAGE = (detail: string): string => `<!DOCTYPE html><html><body><h1>500 Internal Server Error</h1><p>${detail}</p></body></html>`;

describe("Forge — constructor", () => {
  it("routes unhandled errors to the logger it was constructed with", async () => {
    const records: Partial<LogRecord>[] = [];
    const app = new Forge(capturingLogger(records));
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("handler exploded");
    });

    await app.request("/boom");
    expect(records.length).toBe(1);
    const record = records[0]!;
    expect(record.level).toBe("error");
    expect(record.message).toBe("Unhandled error");
    expect((record.data as { error: { message: string } }).error.message).toBe("handler exploded");
  });

  it("leaves the logger silent for a request that succeeds", async () => {
    const records: Partial<LogRecord>[] = [];
    const app = new Forge(capturingLogger(records));
    mapHandler(app, "GET", "/ok", () => new Response("ok"));

    expect((await app.request("/ok")).status).toBe(200);
    expect(records).toEqual([]);
  });

  it("resolves config to an empty object when no config store was registered", async () => {
    const app = new Forge();
    let config: unknown = "unset";
    mapHandler(app, "GET", "/", (c) => {
      config = (c as AppContext).config;
      return new Response("ok");
    });

    await app.request("/");
    expect(config).toEqual({});
  });
});

describe("Forge.use", () => {
  it("registers nothing for an empty path list", async () => {
    const app = new Forge();
    app.use([], () => {
      throw new Error("a guard registered for no paths must never run");
    });
    mapHandler(app, "GET", "/", () => new Response("ok"));

    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("runs several handlers from one call in the order given", async () => {
    const order: string[] = [];
    const app = new Forge();
    app.use("*", probe("first", order), probe("second", order));
    mapHandler(app, "GET", "/", () => {
      order.push("handler");
      return new Response("ok");
    });

    await app.request("/");
    expect(order).toEqual(["first", "second", "handler"]);
  });

  it("runs guards from separate calls in registration order", async () => {
    const order: string[] = [];
    const app = new Forge();
    app.use("*", probe("outer", order));
    app.use("/inner", probe("inner", order));
    mapHandler(app, "GET", "/inner", () => {
      order.push("handler");
      return new Response("ok");
    });

    await app.request("/inner");
    expect(order).toEqual(["outer", "inner", "handler"]);
  });

  it("runs a catch-all guard on every path", async () => {
    const hits: string[] = [];
    const app = new Forge();
    app.use("*", (c, next) => {
      hits.push(c.url.pathname);
      return next();
    });
    mapHandler(app, "GET", "/", () => new Response("a"));
    mapHandler(app, "GET", "/deep/path", () => new Response("b"));

    await app.request("/");
    await app.request("/deep/path");
    expect(hits).toEqual(["/", "/deep/path"]);
  });

  it("treats a suffix wildcard with no slash as a prefix match", async () => {
    const hits: string[] = [];
    const app = new Forge();
    app.use("/admin*", (c, next) => {
      hits.push(c.url.pathname);
      return next();
    });
    mapHandler(app, "GET", "/admin", () => new Response("a"));
    mapHandler(app, "GET", "/admin/users", () => new Response("b"));
    mapHandler(app, "GET", "/public", () => new Response("c"));

    await app.request("/admin");
    await app.request("/admin/users");
    await app.request("/public");
    expect(hits).toEqual(["/admin", "/admin/users"]);
  });

  it("matches an exact path and nothing below it", async () => {
    const hits: string[] = [];
    const app = new Forge();
    app.use("/api/users", (c, next) => {
      hits.push(c.url.pathname);
      return next();
    });
    mapHandler(app, "GET", "/api/users", () => new Response("a"));
    mapHandler(app, "GET", "/api/users/1", () => new Response("b"));

    await app.request("/api/users");
    await app.request("/api/users/1");
    expect(hits).toEqual(["/api/users"]);
  });

  it("lets a guard short-circuit the handler with its own response", async () => {
    const app = new Forge();
    app.use("*", () => new Response("blocked", { status: 403 }));
    mapHandler(app, "GET", "/", () => new Response("never reached"));

    const res = await app.request("/");
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("blocked");
  });
});

describe("Forge.fetch", () => {
  it("passes env and executionCtx through to the handler", async () => {
    const app = new Forge<{ API_KEY: string }>();
    const executionCtx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
    let seenEnv: unknown;
    let seenCtx: unknown;
    mapHandler(app, "GET", "/", (c) => {
      seenEnv = (c as AppContext<{ API_KEY: string }>).env;
      seenCtx = (c as AppContext).executionCtx;
      return new Response("ok");
    });

    await app.fetch(new Request("http://test/"), { API_KEY: "k" }, executionCtx);
    expect(seenEnv).toEqual({ API_KEY: "k" });
    expect(seenCtx).toBe(executionCtx);
  });

  it("supplies a no-op execution context when the caller omits one", async () => {
    const app = new Forge();
    mapHandler(app, "GET", "/", (c) => {
      (c as AppContext).executionCtx.waitUntil(Promise.resolve());
      return new Response("ok");
    });

    const res = await app.fetch(new Request("http://test/"), {});
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("renders the baseline 500 page with its hardening headers for a throwing handler", async () => {
    const app = new Forge();
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("db offline");
    });

    const res = await app.fetch(new Request("http://test/boom"), {});
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(ERROR_PAGE("An unexpected error occurred."));
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("catches a rejected promise from a handler as well as a synchronous throw", async () => {
    const app = new Forge();
    mapHandler(app, "GET", "/boom", async () => {
      await Promise.resolve();
      throw new Error("async failure");
    });

    const res = await app.fetch(new Request("http://test/boom"), {});
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(ERROR_PAGE("An unexpected error occurred."));
  });

  it("builds the router once and reuses it across requests", async () => {
    const order: string[] = [];
    const app = new Forge();
    app.use("*", probe("guard", order));
    mapHandler(app, "GET", "/", () => new Response("ok"));

    await app.fetch(new Request("http://test/"), {});
    await app.fetch(new Request("http://test/"), {});
    expect(order).toEqual(["guard", "guard"]);
  });
});

describe("Forge.setOnError", () => {
  it("hands the override the error and a context carrying env", async () => {
    const app = new Forge<{ STAGE: string }>();
    let message = "";
    let stage = "";
    app.setOnError((err, c) => {
      message = err.message;
      stage = c.env.STAGE;
      return new Response("handled", { status: 503 });
    });
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("upstream down");
    });

    const res = await app.request("/boom", {}, { STAGE: "test" });
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("handled");
    expect(message).toBe("upstream down");
    expect(stage).toBe("test");
  });

  it("normalizes a thrown non-Error into an Error before the override sees it", async () => {
    const app = new Forge();
    let seen: unknown;
    app.setOnError((err) => {
      seen = err;
      return new Response("handled", { status: 500 });
    });
    mapHandler(app, "GET", "/boom", () => {
      throw "a bare string";
    });

    await app.request("/boom");
    expect(seen).toBeInstanceOf(Error);
    expect((seen as Error).message).toBe("a bare string");
  });
});

describe("Forge.setIsDebug", () => {
  it("shows the error message when the predicate returns true", async () => {
    const app = new Forge();
    app.setIsDebug(() => true);
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("connection refused");
    });

    const res = await app.request("/boom");
    expect(await res.text()).toBe(ERROR_PAGE("connection refused"));
  });

  it("escapes the message it reveals in debug mode", async () => {
    const app = new Forge();
    app.setIsDebug(() => true);
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("<script>alert('x')</script> & co");
    });

    const res = await app.request("/boom");
    expect(await res.text()).toBe(ERROR_PAGE("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; co"));
  });

  it("hides the message when the predicate returns false", async () => {
    const app = new Forge();
    app.setIsDebug(() => false);
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("connection refused");
    });

    const res = await app.request("/boom");
    expect(await res.text()).toBe(ERROR_PAGE("An unexpected error occurred."));
  });

  it("hides the message when the predicate itself throws", async () => {
    const app = new Forge();
    app.setIsDebug(() => {
      throw new Error("predicate exploded");
    });
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("connection refused");
    });

    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(ERROR_PAGE("An unexpected error occurred."));
  });

  it("receives a context carrying env, so a debug flag can come from a binding", async () => {
    const app = new Forge<{ DEBUG: string }>();
    app.setIsDebug((c) => c.env.DEBUG === "1");
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("connection refused");
    });

    expect(await (await app.request("/boom", {}, { DEBUG: "1" })).text()).toBe(ERROR_PAGE("connection refused"));
    expect(await (await app.request("/boom", {}, { DEBUG: "0" })).text()).toBe(ERROR_PAGE("An unexpected error occurred."));
  });
});

describe("Forge.request", () => {
  it("resolves a bare path against localhost", async () => {
    const app = new Forge();
    let url = "";
    mapHandler(app, "GET", "/here", (c) => {
      url = c.url.href;
      return new Response("ok");
    });

    await app.request("/here?q=1");
    expect(url).toBe("http://localhost/here?q=1");
  });

  it("keeps an absolute URL as given, so an origin-sensitive guard can be exercised", async () => {
    const app = new Forge();
    let url = "";
    mapHandler(app, "GET", "/here", (c) => {
      url = c.url.href;
      return new Response("ok");
    });

    await app.request("https://example.com/here");
    expect(url).toBe("https://example.com/here");
  });

  it("carries the method, headers and body of the init it is given", async () => {
    const app = new Forge();
    let seen = "";
    mapHandler(app, "POST", "/submit", async (c) => {
      seen = `${c.request.method} ${c.request.headers.get("x-test")} ${await c.request.text()}`;
      return new Response("ok");
    });

    await app.request("/submit", { method: "POST", headers: { "x-test": "yes" }, body: "name=Ada" });
    expect(seen).toBe("POST yes name=Ada");
  });

  it("defaults env to an empty object", async () => {
    const app = new Forge();
    let seenEnv: unknown;
    mapHandler(app, "GET", "/", (c) => {
      seenEnv = (c as AppContext).env;
      return new Response("ok");
    });

    await app.request("/");
    expect(seenEnv).toEqual({});
  });

  it("awaits work a handler deferred with waitUntil before it returns", async () => {
    const app = new Forge();
    const done: string[] = [];
    mapHandler(app, "GET", "/", (c) => {
      (c as AppContext).executionCtx.waitUntil(
        (async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          done.push("deferred");
        })(),
      );
      return new Response("ok");
    });

    await app.request("/");
    expect(done).toEqual(["deferred"]);
  });
});
