import { describe, expect, it, spyOn } from "bun:test";

import type { Middleware } from "@remix-run/fetch-router";
import { createController } from "@remix-run/fetch-router";
import { createRoutes, Route } from "@remix-run/fetch-router/routes";
import { createMultiMatcher } from "@remix-run/route-pattern/match";

import { setPendingHeader } from "../context/pending-headers";
import { matchedRoutePattern } from "../context/route-pattern";
import type { AppContext } from "../context/types";
import { createLogger } from "../logging/logger";
import { requestLogger } from "../logging/request-logger";
import { serializeError } from "../logging/serialize-error";
import type { LogChannel, LogRecord, Logger } from "../logging/types";
import { get, MatcherResourceError } from "../router/mod";
import type { MatcherResourceErrorDetails } from "../router/mod";
import { rateLimit, routeKeySuffix } from "../security/rate-limit";
import { cfHeadersTrustedCtx } from "../security/request-id";
import type { RateLimit } from "../security/types";
import { collectExecutionContext, mockExecutionContext } from "../testing/context";
import { mapHandler } from "../testing/route";
import { Forge } from "./forge-app";
import { createHandlerFactory } from "./handler-factory";

const { definePage } = createHandlerFactory();

/** The `executionCtx` every `fetch` call in this file passes, since the argument is required. */
const ctx = (): ExecutionContext => collectExecutionContext().executionCtx;

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
    expect((record.data as { error: { detail: string } }).error.detail).toBe("handler exploded");
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

  // The correct-form counterpart is `app.test.ts`'s "runs the guard for /admin and /admin/x but not
  // /administrator", which pins that `/admin/*` leaves `/administrator` unguarded.
  it("refuses a suffix wildcard with no slash rather than silently narrowing it", () => {
    const app = new Forge();
    expect(() =>
      app.use("/admin*", (_c, next) => {
        return next();
      }),
    ).toThrow(/not a supported guard pattern/);
  });

  it("refuses a wildcard that is neither the catch-all nor a trailing slash-star", () => {
    const app = new Forge();
    const pass: Middleware = (_c, next) => next();
    expect(() => app.use("/a*b", pass)).toThrow(/not a supported guard pattern/);
    expect(() => app.use("*/x", pass)).toThrow(/not a supported guard pattern/);
    expect(() => app.use(["/ok/*", "/bad*"], pass)).toThrow(/"\/bad\*"/);
    // The catch-all short-circuits the matcher, not the check: a typo beside it is still a typo.
    expect(() => app.use(["*", "/bad*"], pass)).toThrow(/"\/bad\*"/);
  });

  it("still takes the catch-all itself, alone or beside a valid prefix", async () => {
    const hits: string[] = [];
    const app = new Forge();
    const probeHit: Middleware = (c, next) => {
      hits.push(c.url.pathname);
      return next();
    };
    app.use("*", probeHit);
    app.use(["*", "/ok/*"], probeHit);
    mapHandler(app, "GET", "/anywhere", () => new Response("ok"));

    await app.request("/anywhere");
    expect(hits).toEqual(["/anywhere", "/anywhere"]);
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

  it("matches each registration once per request, however many handlers it holds", async () => {
    const order: string[] = [];
    const app = new Forge();
    app.use("/a/*", probe("a1", order), probe("a2", order), probe("a3", order));
    app.use(["/b", "/a/x"], probe("b1", order), probe("b2", order));
    mapHandler(app, "GET", "/a/x", () => new Response("ok"));
    mapHandler(app, "GET", "/c", () => new Response("ok"));

    // The router dispatches through `matchAll`, so every `match` call is a guard's.
    const match = spyOn(Object.getPrototypeOf(createMultiMatcher()) as { match: () => unknown }, "match");
    try {
      await app.request("/a/x");
      expect(match).toHaveBeenCalledTimes(2);
      expect(order).toEqual(["a1", "a2", "a3", "b1", "b2"]);

      await app.request("/c");
      expect(match).toHaveBeenCalledTimes(4);
      expect(order).toHaveLength(5);
    } finally {
      match.mockRestore();
    }
  });

  it("refuses a registration after the first request instead of dropping it", async () => {
    const app = new Forge();
    mapHandler(app, "GET", "/", () => new Response("ok"));
    await app.request("/");

    const pass: Middleware = (_c, next) => next();
    expect(() => app.use("*", pass)).toThrow(/^Forge\.use: called after the app served its first request/);
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

describe("Forge.map", () => {
  it("takes a route mapped after the first request", async () => {
    const app = new Forge();
    mapHandler(app, "GET", "/", () => new Response("first"));
    await app.request("/");

    mapHandler(app, "GET", "/late", () => new Response("late"));
    const res = await app.request("/late");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("late");
  });

  it("puts a route mapped after the first request behind the guards already registered", async () => {
    const app = new Forge();
    app.use("/admin/*", () => new Response("blocked", { status: 403 }));
    mapHandler(app, "GET", "/", () => new Response("first"));
    await app.request("/");

    mapHandler(app, "GET", "/admin/late", () => new Response("late"));
    const res = await app.request("/admin/late");
    expect([res.status, await res.text()]).toEqual([403, "blocked"]);
  });
});

describe("Forge.fetch", () => {
  it("passes env and executionCtx through to the handler", async () => {
    const app = new Forge<{ API_KEY: string }>();
    const executionCtx = mockExecutionContext();
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

  it("refuses a caller that omits the execution context, naming the three-argument entry", async () => {
    const app = new Forge();
    mapHandler(app, "GET", "/", () => new Response("ok"));

    // The two-argument call is a compile error; `as never` reproduces the JS caller it still reaches.
    const call = app.fetch(new Request("http://test/"), {}, undefined as never);
    await expect(call).rejects.toThrow(/`executionCtx` is required/);
    await expect(call).rejects.toThrow(/app\.fetch\(req, env, ctx\)/);
  });

  it("hands deferred work to the caller's execution context rather than dropping it", async () => {
    const app = new Forge();
    const collected = collectExecutionContext();
    let deferred = false;
    mapHandler(app, "GET", "/", (c) => {
      (c as AppContext).executionCtx.waitUntil(
        Promise.resolve().then(() => {
          deferred = true;
        }),
      );
      return new Response("ok");
    });

    const res = await app.fetch(new Request("http://test/"), {}, collected.executionCtx);
    expect(res.status).toBe(200);
    await collected.drain();
    expect(deferred).toBe(true);
  });

  it("renders the baseline 500 page with its hardening headers for a throwing handler", async () => {
    const app = new Forge();
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("db offline");
    });

    const res = await app.fetch(new Request("http://test/boom"), {}, ctx());
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

    const res = await app.fetch(new Request("http://test/boom"), {}, ctx());
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(ERROR_PAGE("An unexpected error occurred."));
  });

  it("builds the router once and reuses it across requests", async () => {
    const order: string[] = [];
    const app = new Forge();
    app.use("*", probe("guard", order));
    mapHandler(app, "GET", "/", () => new Response("ok"));

    await app.fetch(new Request("http://test/"), {}, ctx());
    await app.fetch(new Request("http://test/"), {}, ctx());
    expect(order).toEqual(["guard", "guard"]);
  });
});

describe("Forge — client aborts", () => {
  it("answers a throw on an aborted request with a bodyless 499 and no log record", async () => {
    const records: Partial<LogRecord>[] = [];
    const app = new Forge(capturingLogger(records));
    mapHandler(app, "GET", "/slow", () => {
      throw new Error("handler exploded");
    });

    const res = await app.fetch(new Request("http://test/slow", { signal: AbortSignal.abort() }), {}, ctx());
    expect(res.status).toBe(499);
    expect(res.body).toBe(null);
    expect(records).toEqual([]);
  });

  it("never calls the onError override for an aborted request, and writes no record", async () => {
    const records: Partial<LogRecord>[] = [];
    const app = new Forge(capturingLogger(records));
    let called = false;
    app.setOnError(() => {
      called = true;
      return new Response("handled", { status: 503 });
    });
    mapHandler(app, "GET", "/slow", () => {
      throw new Error("handler exploded");
    });

    const res = await app.fetch(new Request("http://test/slow", { signal: AbortSignal.abort() }), {}, ctx());
    expect({ status: res.status, body: res.body, called, records }).toStrictEqual({ status: 499, body: null, called: false, records: [] });
  });

  it("treats an out-of-chain throw on an aborted request as cancellation too", async () => {
    const records: Partial<LogRecord>[] = [];
    const app = new Forge(capturingLogger(records));
    // Config resolution runs before routing, so its throw never reaches the router's boundary.
    app.configStore = {
      get: () => {
        throw new Error("config exploded");
      },
    } as unknown as NonNullable<typeof app.configStore>;
    mapHandler(app, "GET", "/", () => new Response("ok"));

    const res = await app.fetch(new Request("http://test/", { signal: AbortSignal.abort() }), {}, ctx());
    expect(res.status).toBe(499);
    expect(res.body).toBe(null);
    expect(records).toEqual([]);
  });

  it("still reports a throw on a request that was never aborted", async () => {
    const records: Partial<LogRecord>[] = [];
    const app = new Forge(capturingLogger(records));
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("handler exploded");
    });

    const res = await app.fetch(new Request("http://test/boom", { signal: new AbortController().signal }), {}, ctx());
    expect(res.status).toBe(500);
    expect(records.length).toBe(1);
    expect(records[0]!.level).toBe("error");
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

describe("Forge — the Unhandled error record beside an onError override", () => {
  it.each([503, 404, 200])("serves an override's %i Response as given beside exactly one Unhandled error record", async (status) => {
    const records: Partial<LogRecord>[] = [];
    const app = new Forge(capturingLogger(records));
    const thrown = new Error("upstream down");
    app.setOnError(() => new Response("override page", { status }));
    mapHandler(app, "GET", "/boom", () => {
      throw thrown;
    });

    const res = await app.request("/boom");
    expect({ status: res.status, body: await res.text(), records }).toStrictEqual({
      status,
      body: "override page",
      records: [{ level: "error", message: "Unhandled error", data: { error: serializeError(thrown) } }],
    });
  });

  it("records the error before the override runs", async () => {
    const records: Partial<LogRecord>[] = [];
    const app = new Forge(capturingLogger(records));
    let seenByOverride: string[] = [];
    app.setOnError(() => {
      seenByOverride = records.map((r) => r.message ?? "");
      return new Response("override page", { status: 503 });
    });
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("upstream down");
    });

    await app.request("/boom");
    expect(seenByOverride).toStrictEqual(["Unhandled error"]);
  });

  it("records Unhandled error, then the override's own failure naming both errors, and serves the fallback 500 when the override throws", async () => {
    const records: Partial<LogRecord>[] = [];
    const app = new Forge(capturingLogger(records));
    const thrown = new Error("handler exploded");
    const overrideThrown = new Error("override exploded");
    app.setOnError(() => {
      throw overrideThrown;
    });
    mapHandler(app, "GET", "/boom", () => {
      throw thrown;
    });

    const res = await app.request("/boom");
    expect({ status: res.status, body: await res.text(), records }).toStrictEqual({
      status: 500,
      body: ERROR_PAGE("An unexpected error occurred."),
      records: [
        { level: "error", message: "Unhandled error", data: { error: serializeError(thrown) } },
        { level: "error", message: "onError override threw", data: { error: serializeError(overrideThrown), original: serializeError(thrown) } },
      ],
    });
  });
});

describe("Forge — the error detail its fallback 500 discloses", () => {
  it("hides the message by default, in a build not armed for development", async () => {
    const app = new Forge();
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("connection refused");
    });

    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(ERROR_PAGE("An unexpected error occurred."));
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

describe("Forge — the app logger's error-path flush", () => {
  function asyncChannel(records: LogRecord[]): LogChannel {
    return {
      write: async (record) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        records.push(record);
      },
    };
  }

  function appOverAsyncChannel(records: LogRecord[]): Forge {
    return new Forge(createLogger("app", { channels: [asyncChannel(records)] }));
  }

  it("defers a flush covering its own unhandled-error record", async () => {
    const records: LogRecord[] = [];
    const app = appOverAsyncChannel(records);
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("handler exploded");
    });
    const collected = collectExecutionContext();

    const res = await app.fetch(new Request("http://test/boom"), {}, collected.executionCtx);
    await collected.drain();

    expect(res.status).toBe(500);
    expect(records.map((r) => r.message)).toStrictEqual(["Unhandled error"]);
    expect((records[0]!.data as { error: { detail: string } }).error.detail).toBe("handler exploded");
  });

  it("covers the onError-override record on the same flush", async () => {
    const records: LogRecord[] = [];
    const app = appOverAsyncChannel(records);
    app.setOnError(() => {
      throw new Error("override exploded");
    });
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("handler exploded");
    });
    const collected = collectExecutionContext();

    const res = await app.fetch(new Request("http://test/boom"), {}, collected.executionCtx);
    await collected.drain();

    expect(res.status).toBe(500);
    expect(records.map((r) => r.message)).toStrictEqual(["Unhandled error", "onError override threw"]);
  });

  it("defers a flush covering the Unhandled error record when the override's Response is served", async () => {
    const records: LogRecord[] = [];
    const app = appOverAsyncChannel(records);
    app.setOnError(() => new Response("override page", { status: 503 }));
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("handler exploded");
    });
    const collected = collectExecutionContext();

    const res = await app.fetch(new Request("http://test/boom"), {}, collected.executionCtx);
    const deferred = collected.pending.length;
    await collected.drain();

    expect({ status: res.status, deferred, messages: records.map((r) => r.message) }).toStrictEqual({
      status: 503,
      deferred: 1,
      messages: ["Unhandled error"],
    });
  });

  it("covers the out-of-chain throw, where the app logger holds the only record", async () => {
    const records: LogRecord[] = [];
    const app = appOverAsyncChannel(records);
    app.configStore = {
      get: () => {
        throw new Error("config exploded");
      },
    } as unknown as NonNullable<typeof app.configStore>;
    mapHandler(app, "GET", "/", () => new Response("ok"));
    const collected = collectExecutionContext();

    const res = await app.fetch(new Request("http://test/"), {}, collected.executionCtx);
    await collected.drain();

    expect(res.status).toBe(500);
    expect(records.map((r) => r.message)).toStrictEqual(["Unhandled error"]);
  });
});

describe("Forge — an abort mid-request", () => {
  it("answers 499 with no record when the client disconnects while a handler is still running", async () => {
    const records: Partial<LogRecord>[] = [];
    const app = new Forge(capturingLogger(records));
    const controller = new AbortController();
    mapHandler(app, "GET", "/slow", () => new Promise<Response>(() => {}));

    const pending = app.fetch(new Request("http://test/slow", { signal: controller.signal }), {}, ctx());
    controller.abort();
    const res = await pending;

    expect(res.status).toBe(499);
    expect(res.body).toBe(null);
    expect(records).toEqual([]);
  });
});

// Without `limits` every call below still answers, just under route-pattern's own looser defaults.
// So each test names the limit the refusal cites rather than the answer it produced.
describe("Forge — the matcher resource budget", () => {
  /** Over forge's 4096-byte ceiling, under route-pattern's own 64 KiB default. */
  const oversized = `/${"a".repeat(5000)}`;

  /** The structured refusal, or `null` if the call was allowed through. */
  function refusal(attempt: () => void): MatcherResourceErrorDetails | null {
    try {
      attempt();
      return null;
    } catch (error) {
      if (error instanceof MatcherResourceError) return error.details;
      throw error;
    }
  }

  it("refuses an oversized route pattern at registration", () => {
    const app = new Forge();
    expect(refusal(() => mapHandler(app, "GET", oversized, () => new Response("ok")))).toMatchObject({ limit: "maxPatternSize", maximum: 4096 });
  });

  it("refuses an oversized single guard path at registration", () => {
    const app = new Forge();
    expect(refusal(() => app.use(oversized, (_c, next) => next()))).toMatchObject({ limit: "maxPatternSize", maximum: 4096 });
  });

  it("refuses an oversized path among several guard paths at registration", () => {
    const app = new Forge();
    expect(refusal(() => app.use(["/ok", oversized], (_c, next) => next()))).toMatchObject({ limit: "maxPatternSize", maximum: 4096 });
  });

  it("throws mid-match on a URL that costs more than the match-work budget", async () => {
    const app = new Forge();
    mapHandler(app, "GET", "/things/:id", () => new Response("ok"));
    let details: MatcherResourceErrorDetails | null = null;
    app.setOnError((error) => {
      if (error instanceof MatcherResourceError) details = error.details;
      return new Response("handled", { status: 503 });
    });

    await app.request(`/${"b".repeat(250_000)}`);
    expect(details).toMatchObject({ limit: "maxMatchWork", maximum: 200_000 });
  });

  it("answers the exhausted budget with the error boundary's 500 rather than a crash", async () => {
    const app = new Forge(capturingLogger([]));
    mapHandler(app, "GET", "/things/:id", () => new Response("ok"));
    expect((await app.request(`/${"b".repeat(250_000)}`)).status).toBe(500);
  });

  // The budget is calibrated to sit above real traffic: twice the URL length Cloudflare delivers,
  // against more routes than a consumer registers, still matches rather than refusing.
  it("leaves a 32 KiB URL matched against 500 routes inside the budget", async () => {
    const app = new Forge();
    for (let route = 0; route < 500; route++) mapHandler(app, "GET", `/route-${route}/:id`, () => new Response("ok"));
    let refused: unknown;
    app.setOnError((error) => {
      refused = error;
      return new Response("handled", { status: 503 });
    });

    const res = await app.request(`/route-0/${"c".repeat(32 * 1024)}`);
    expect({ status: res.status, refused }).toEqual({ status: 200, refused: undefined });
  });
});

describe("Forge — a cookie-setting response is never shared-cacheable", () => {
  const writeCookie: Middleware = async (context, next) => {
    const res = await next();
    setPendingHeader(context, "set-cookie", "sid=abc; HttpOnly", { append: true });
    return res;
  };

  const publicPageApp = (withCookie: boolean): Forge => {
    const app = new Forge();
    if (withCookie) app.use("*", writeCookie);
    mapHandler(app, "GET", "/", definePage(get("/"), { cache: { scope: "public", maxAge: 60 }, view: () => new Response("ok") }));
    return app;
  };

  it("rewrites an explicit public page to private when its session writes a cookie", async () => {
    const res = await publicPageApp(true).request("/");
    expect(res.headers.getSetCookie()).toEqual(["sid=abc; HttpOnly"]);
    expect(res.headers.get("cache-control")).toBe("private, max-age=60");
  });

  it("leaves the same public page public when no cookie is written", async () => {
    const res = await publicPageApp(false).request("/");
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
  });

  it("rewrites a handler's own public Cache-Control beside its own Set-Cookie", async () => {
    const app = new Forge();
    mapHandler(app, "GET", "/", () => new Response("ok", { headers: { "cache-control": "public, max-age=300", "set-cookie": "a=1" } }));
    const res = await app.request("/");
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
  });
});

describe("Forge — the matched route pattern", () => {
  it("stamps the full source of a route declared under a base", async () => {
    const app = new Forge();
    const routes = createRoutes("/n", { show: new Route("GET", "/:nb") });
    app.map(routes, createController(routes, { actions: { show: (c) => new Response(matchedRoutePattern.getOptional(c) ?? "unstamped") } }));

    const res = await app.fetch(new Request("http://test/n/abc"), {}, ctx());

    expect(await res.text()).toBe("/n/:nb");
  });

  it("stamps each action's own pattern when a controller's middleware is shared by every action", async () => {
    const app = new Forge();
    const routes = createRoutes({ show: new Route("GET", "/n/:nb"), edit: new Route("GET", "/n/:nb/edit") });
    const shared: Middleware = (_c, next) => next();
    const echoPattern = (c: Parameters<typeof matchedRoutePattern.getOptional>[0]) =>
      new Response(matchedRoutePattern.getOptional(c) ?? "unstamped");
    app.map(routes, createController(routes, { middleware: [shared], actions: { show: echoPattern, edit: echoPattern } }));

    const show = await app.fetch(new Request("http://test/n/abc"), {}, ctx());
    const edit = await app.fetch(new Request("http://test/n/abc/edit"), {}, ctx());

    expect([await show.text(), await edit.text()]).toStrictEqual(["/n/:nb", "/n/:nb/edit"]);
  });

  it("still answers 499 when the client disconnects while a stamped route's handler runs", async () => {
    const records: Partial<LogRecord>[] = [];
    const app = new Forge(capturingLogger(records));
    const controller = new AbortController();
    let stamped: string | undefined;
    let entered!: () => void;
    const handlerEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    mapHandler(app, "GET", "/n/:nb", (c) => {
      stamped = matchedRoutePattern.getOptional(c);
      entered();
      return new Promise<Response>(() => {});
    });

    const pending = app.fetch(new Request("http://test/n/abc", { signal: controller.signal }), {}, ctx());
    await handlerEntered;
    controller.abort();
    const res = await pending;

    expect(stamped).toBe("/n/:nb");
    expect(res.status).toBe(499);
    expect(res.body).toBe(null);
    expect(records).toEqual([]);
  });

  it("leaves the route's response as the handler built it", async () => {
    const app = new Forge();
    mapHandler(app, "GET", "/n/:nb", () => new Response("made", { status: 201, headers: { "x-probe": "kept" } }));

    const res = await app.fetch(new Request("http://test/n/abc"), {}, ctx());

    expect(res.status).toBe(201);
    expect(res.headers.get("x-probe")).toBe("kept");
    expect(await res.text()).toBe("made");
  });
});

describe("Forge — the matched route pattern, resolved before app.use middleware", () => {
  /** A guard on every path that records the pattern it saw before calling `next()`. */
  function recordingGuard(seen: (string | undefined)[]): Middleware {
    return (c, next) => {
      seen.push(matchedRoutePattern.getOptional(c));
      return next();
    };
  }

  it("is readable in an app.use middleware before it calls next()", async () => {
    const seen: (string | undefined)[] = [];
    const app = new Forge();
    app.use("*", recordingGuard(seen));
    mapHandler(app, "GET", "/n/:nb", () => new Response("ok"));

    const res = await app.request("/n/abc");

    expect({ status: res.status, seen }).toStrictEqual({ status: 200, seen: ["/n/:nb"] });
  });

  const dispatchCases: { name: string; routes: ["GET" | "POST" | "ANY", string][]; method: string; path: string; expected: string }[] = [
    {
      name: "a literal route over a param route registered before it",
      routes: [
        ["GET", "/n/:nb"],
        ["GET", "/n/new"],
      ],
      method: "GET",
      path: "/n/new",
      expected: "/n/new",
    },
    {
      name: "an ANY route on POST when the more specific match is a GET route",
      routes: [
        ["GET", "/n/new"],
        ["ANY", "/n/:nb"],
      ],
      method: "POST",
      path: "/n/new",
      expected: "/n/:nb",
    },
    {
      name: "HEAD resolving to the GET route when the more specific match is a POST route",
      routes: [
        ["POST", "/n/new"],
        ["GET", "/n/:nb"],
      ],
      method: "HEAD",
      path: "/n/new",
      expected: "/n/:nb",
    },
  ];

  for (const { name, routes, method, path, expected } of dispatchCases) {
    it(`names the route dispatch then runs: ${name}`, async () => {
      const seen: (string | undefined)[] = [];
      const dispatched: string[] = [];
      const app = new Forge();
      app.use("*", recordingGuard(seen));
      for (const [routeMethod, pattern] of routes) {
        mapHandler(app, routeMethod, pattern, () => {
          dispatched.push(`${routeMethod} ${pattern}`);
          return new Response("ok");
        });
      }

      const res = await app.request(path, { method });

      const route = routes.find(([, pattern]) => pattern === expected)!;
      expect({ status: res.status, seen, dispatched }).toStrictEqual({ status: 200, seen: [expected], dispatched: [`${route[0]} ${route[1]}`] });
    });
  }

  it("leaves the pattern unset on a 404", async () => {
    const seen: (string | undefined)[] = [];
    const app = new Forge();
    app.use("*", recordingGuard(seen));
    mapHandler(app, "GET", "/n/:nb", () => new Response("ok"));

    const res = await app.request("/elsewhere");

    expect({ status: res.status, seen }).toStrictEqual({ status: 404, seen: [undefined] });
  });

  it("leaves the pattern unset on an advertised 405, though the path matches another method's route", async () => {
    const seen: (string | undefined)[] = [];
    const app = new Forge();
    app.setMethodMismatch("advertise");
    app.use("*", recordingGuard(seen));
    mapHandler(app, "GET", "/n/:nb", () => new Response("ok"));

    const res = await app.request("/n/abc", { method: "DELETE" });

    expect({ status: res.status, seen }).toStrictEqual({ status: 405, seen: [undefined] });
  });

  it("resolves a route mapped after the first fetch on the next request", async () => {
    const seen: (string | undefined)[] = [];
    const app = new Forge();
    app.use("*", recordingGuard(seen));
    mapHandler(app, "GET", "/early", () => new Response("early"));
    const first = await app.request("/early");
    mapHandler(app, "GET", "/late/:id", () => new Response("late"));

    const second = await app.request("/late/1");

    expect({ statuses: [first.status, second.status], body: await second.text(), seen }).toStrictEqual({
      statuses: [200, 200],
      body: "late",
      seen: ["/early", "/late/:id"],
    });
  });

  it("answers an exhausted match budget with 500, the pattern unset for guards and the rate-limit key", async () => {
    const records: LogRecord[] = [];
    const channel: LogChannel = { write: (r) => void records.push(r) };
    const seen: (string | undefined)[] = [];
    const keys: string[] = [];
    const app = new Forge<{ LIMITER: RateLimit }>(capturingLogger([]));
    app.use("*", requestLogger({ channels: () => [channel] }));
    app.use("*", (context, next) => (cfHeadersTrustedCtx.set(context, true), next()));
    app.use("*", rateLimit<{ LIMITER: RateLimit }>({ binding: "LIMITER", keySuffix: routeKeySuffix }));
    app.use("*", recordingGuard(seen));
    mapHandler(app, "GET", "/things/:id", () => new Response("ok"));
    const counter: RateLimit = {
      limit: async ({ key }) => {
        keys.push(key);
        return { success: true };
      },
    };

    const res = await app.request(`/${"b".repeat(250_000)}`, { headers: { "CF-Connecting-IP": "198.51.100.4" } }, { LIMITER: counter });

    expect({ status: res.status, seen, keys, log: records.map((r) => ({ message: r.message, status: r.data?.status })) }).toStrictEqual({
      status: 500,
      seen: [undefined],
      keys: ["198.51.100.4:<unmatched>"],
      log: [
        { message: "Unhandled error", status: undefined },
        { message: "request.completed", status: 500 },
      ],
    });
  });
});

describe("Forge — a context.url rewritten after route resolution", () => {
  /** Counts the route matcher's own `matchAll` runs, which the memoizing wrapper answers from cache when it can. */
  function spyMatchAll() {
    return spyOn(Object.getPrototypeOf(createMultiMatcher()) as { matchAll: () => unknown }, "matchAll");
  }

  function rewriting(rewrite: (c: Parameters<Middleware>[0]) => void): Middleware {
    return (c, next) => {
      rewrite(c);
      return next();
    };
  }

  /** An app whose `/admin/*` guard and handlers record what ran, behind a `"*"` middleware applying `rewrite`. */
  function adminApp(rewrite: (c: Parameters<Middleware>[0]) => void) {
    const ran: string[] = [];
    const records: Partial<LogRecord>[] = [];
    const app = new Forge(capturingLogger(records));
    app.setMethodMismatch("advertise");
    app.use("*", rewriting(rewrite));
    app.use("/admin/*", probe("admin guard", ran));
    mapHandler(app, "GET", "/admin/x", () => (ran.push("GET /admin/x"), new Response("admin")));
    mapHandler(app, "GET", "/x", () => (ran.push("GET /x"), new Response("public")));
    mapHandler(app, "POST", "/post-only", () => (ran.push("POST /post-only"), new Response("post")));
    mapHandler(app, "GET", "/s", () => (ran.push("GET /s"), new Response("plain")));
    mapHandler(app, "GET", "/s?mode=b", () => (ran.push("GET /s?mode=b"), new Response("mode b")));
    return { app, ran, records };
  }

  async function refusal(path: string, rewrite: (c: Parameters<Middleware>[0]) => void) {
    const { app, ran, records } = adminApp(rewrite);
    const res = await app.request(path);
    const logged = records.map((r) => ({ message: r.message, detail: (r.data?.["error"] as { detail?: string } | undefined)?.detail }));
    return { status: res.status, ran, logged };
  }

  const refusalMessage = (from: string, to: string) =>
    `Forge: context.url changed after route resolution, from "${from}" to "${to}" — it is read-only once forge has the request. Rewrite the URL in the Worker's fetch export and pass app.fetch a rebuilt Request.`;

  const refused = (from: string, to: string) => ({
    status: 500,
    ran: [],
    logged: [{ message: "Unhandled error", detail: refusalMessage(from, to) }],
  });

  /** Serves one request through an app `setup` builds, reporting what ran and what the error boundary logged. */
  async function serve(setup: (app: Forge, ran: string[]) => void, path: string, init?: RequestInit) {
    const ran: string[] = [];
    const records: Partial<LogRecord>[] = [];
    const app = new Forge(capturingLogger(records));
    setup(app, ran);
    const res = await app.request(path, init);
    const logged = records.map((r) => ({ message: r.message, detail: (r.data?.["error"] as { detail?: string } | undefined)?.detail }));
    return { status: res.status, body: await res.text(), ran, logged, records };
  }

  const toX = rewriting((c) => void (c.url.pathname = "/x"));
  const reassignToX = rewriting((c) => void (c.url = new URL("/x", c.url)));

  function adminAndPublic(app: Forge, ran: string[]): void {
    mapHandler(app, "GET", "/admin/x", () => (ran.push("GET /admin/x"), new Response("admin")));
    mapHandler(app, "GET", "/x", () => (ran.push("GET /x"), new Response("public")));
  }

  const refusedAnswer = (from: string, to: string, ran: string[] = []) => ({
    status: 500,
    body: ERROR_PAGE("An unexpected error occurred."),
    ran,
    logged: [{ message: "Unhandled error", detail: refusalMessage(from, to) }],
  });

  const outcome = ({ records: _records, ...rest }: Awaited<ReturnType<typeof serve>>) => rest;

  it("refuses a prefix strip made in place, running neither the guard nor a handler", async () => {
    expect(await refusal("/admin/x", (c) => void (c.url.pathname = "/x"))).toStrictEqual(refused("/admin/x", "/x"));
  });

  it("refuses a prefix strip made by reassigning context.url, running neither the guard nor a handler", async () => {
    expect(await refusal("/admin/x", (c) => void (c.url = new URL("/x", c.url)))).toStrictEqual(refused("/admin/x", "/x"));
  });

  it("refuses a rewrite onto a path no route serves, rather than answering 404", async () => {
    expect(await refusal("/x", (c) => void (c.url.pathname = "/missing"))).toStrictEqual(refused("/x", "/missing"));
  });

  it("refuses a rewrite onto another method's path, rather than advertising its methods", async () => {
    expect(await refusal("/x", (c) => void (c.url.pathname = "/post-only"))).toStrictEqual(refused("/x", "/post-only"));
  });

  it("refuses a query-only rewrite", async () => {
    expect(await refusal("/s", (c) => void (c.url.search = "?mode=b"))).toStrictEqual(refused("/s", "/s"));
  });

  it("refuses a fragment-only rewrite", async () => {
    expect(await refusal("/s", (c) => void (c.url.hash = "#frag"))).toStrictEqual(refused("/s", "/s"));
  });

  it("refuses a reassignment to an equal URL", async () => {
    expect(await refusal("/x", (c) => void (c.url = new URL(c.url.href)))).toStrictEqual(refused("/x", "/x"));
  });

  it("matches an unrewritten URL once across resolution and dispatch", async () => {
    const { app, ran } = adminApp(() => {});
    await app.request("/admin/x");
    ran.length = 0;

    const matchAll = spyMatchAll();
    try {
      const res = await app.request("/admin/x");
      expect({ status: res.status, body: await res.text(), ran, matchAll: matchAll.mock.calls.length }).toStrictEqual({
        status: 200,
        body: "admin",
        ran: ["admin guard", "GET /admin/x"],
        matchAll: 1,
      });
    } finally {
      matchAll.mockRestore();
    }
  });

  it.each([
    { where: "an /admin/*-scoped middleware, in place", setup: (app: Forge) => app.use("/admin/*", toX), ran: [] },
    { where: "an /admin/*-scoped middleware, by reassignment", setup: (app: Forge) => app.use("/admin/*", reassignToX), ran: [] },
    {
      where: "a guard group's chain, in place",
      setup: (app: Forge, ran: string[]) => app.use(["/admin/*", "/ops/*"], probe("group guard", ran), toX),
      ran: ["group guard"],
    },
    {
      where: "a guard group's chain, by reassignment",
      setup: (app: Forge, ran: string[]) => app.use(["/admin/*", "/ops/*"], probe("group guard", ran), reassignToX),
      ran: ["group guard"],
    },
  ])("refuses a prefix strip made in $where before any handler runs", async ({ setup, ran }) => {
    const answer = await serve((app, r) => (setup(app, r), adminAndPublic(app, r)), "/admin/x");
    expect(outcome(answer)).toStrictEqual(refusedAnswer("/admin/x", "/x", [...ran]));
  });

  it.each([
    { how: "in place", rewrite: toX },
    { how: "by reassignment", rewrite: reassignToX },
  ])("refuses a prefix strip made $how in a route's own middleware before its handler runs", async ({ rewrite }) => {
    const answer = await serve((app, ran) => {
      mapHandler(app, "GET", "/admin/x", {
        middleware: [probe("route middleware", ran), rewrite, probe("later route middleware", ran)],
        handler: () => (ran.push("GET /admin/x"), new Response("admin")),
      });
      mapHandler(app, "GET", "/x", () => (ran.push("GET /x"), new Response("public")));
    }, "/admin/x");
    expect(outcome(answer)).toStrictEqual(refusedAnswer("/admin/x", "/x", ["route middleware"]));
  });

  it("refuses a rewrite restored in place before the skipped guard or the handler runs", async () => {
    const answer = await serve((app, ran) => {
      app.use("*", toX);
      app.use("/admin/*", probe("admin guard", ran));
      app.use(
        "*",
        rewriting((c) => void (c.url.pathname = "/admin/x")),
      );
      adminAndPublic(app, ran);
    }, "/admin/x");
    expect(outcome(answer)).toStrictEqual(refusedAnswer("/admin/x", "/x"));
  });

  it("refuses a rewrite restored by reassigning the original URL object before the skipped guard or the handler runs", async () => {
    const originals = new WeakMap<object, URL>();
    const answer = await serve((app, ran) => {
      app.use(
        "*",
        rewriting((c) => {
          originals.set(c, c.url);
          c.url = new URL("/x", c.url);
        }),
      );
      app.use("/admin/*", probe("admin guard", ran));
      app.use(
        "*",
        rewriting((c) => void (c.url = originals.get(c) ?? c.url)),
      );
      adminAndPublic(app, ran);
    }, "/admin/x");
    expect(outcome(answer)).toStrictEqual(refusedAnswer("/admin/x", "/x"));
  });

  it("refuses a rewritten HEAD request with a bodiless 500", async () => {
    const answer = await serve((app, ran) => (app.use("*", toX), adminAndPublic(app, ran)), "/admin/x", { method: "HEAD" });
    expect(outcome(answer)).toStrictEqual({ ...refusedAnswer("/admin/x", "/x"), body: "" });
  });

  it.each([
    { how: "in place", rewrite: (c: Parameters<Middleware>[0]) => void (c.url.href = "http://localhost/x?token=rewritten-secret") },
    { how: "by reassignment", rewrite: (c: Parameters<Middleware>[0]) => void (c.url = new URL("/x?token=rewritten-secret", c.url)) },
  ])("names both paths in a refusal made $how, and neither query", async ({ rewrite }) => {
    const answer = await serve((app, ran) => (app.use("*", rewriting(rewrite)), adminAndPublic(app, ran)), "/admin/x?token=original-secret");
    expect({ ...outcome(answer), leaked: JSON.stringify(answer.records).match(/secret/g) }).toStrictEqual({
      ...refusedAnswer("/admin/x", "/x"),
      leaked: null,
    });
  });

  it.each(["advertise", "notFound"] as const)(
    "answers 500 when a handler rewrites context.url in place and returns a 405, under the %s method-mismatch mode",
    async (mode) => {
      const answer = await serve((app, ran) => {
        app.setMethodMismatch(mode);
        mapHandler(app, "GET", "/x", (c) => {
          ran.push("GET /x");
          c.url.pathname = "/post-only";
          return new Response("handler's own 405", { status: 405 });
        });
        mapHandler(app, "POST", "/post-only", () => (ran.push("POST /post-only"), new Response("post")));
      }, "/x");
      expect(outcome(answer)).toStrictEqual(refusedAnswer("/x", "/post-only", ["GET /x"]));
    },
  );

  it.each(["advertise", "notFound"] as const)(
    "answers 500 when a handler reassigns context.url and returns a 405, under the %s method-mismatch mode",
    async (mode) => {
      const answer = await serve((app, ran) => {
        app.setMethodMismatch(mode);
        mapHandler(app, "GET", "/x", (c) => {
          ran.push("GET /x");
          c.url = new URL("/post-only", c.url);
          return new Response("handler's own 405", { status: 405 });
        });
        mapHandler(app, "POST", "/post-only", () => (ran.push("POST /post-only"), new Response("post")));
      }, "/x");
      expect(outcome(answer)).toStrictEqual(refusedAnswer("/x", "/post-only", ["GET /x"]));
    },
  );

  describe("a middleware that only reads context.url", () => {
    const reader =
      (ran: string[]): Middleware =>
      (c, next) => {
        ran.push(`read ${c.url.href} q=${c.url.searchParams.get("q")}`);
        return next();
      };

    function readingApp(mode: "advertise" | "notFound") {
      return (app: Forge, ran: string[]) => {
        app.setMethodMismatch(mode);
        app.use("*", reader(ran));
        adminAndPublic(app, ran);
      };
    }

    it.each([
      {
        name: "serves a GET",
        mode: "advertise" as const,
        path: "/x?q=1",
        init: undefined,
        expected: { status: 200, body: "public", ran: ["read http://localhost/x?q=1 q=1", "GET /x"] },
      },
      {
        name: "serves a HEAD without a body",
        mode: "advertise" as const,
        path: "/x?q=1",
        init: { method: "HEAD" },
        expected: { status: 200, body: "", ran: ["read http://localhost/x?q=1 q=1", "GET /x"] },
      },
      {
        name: "advertises a method mismatch as 405",
        mode: "advertise" as const,
        path: "/x?q=1",
        init: { method: "POST" },
        expected: { status: 405, body: "Method Not Allowed", ran: ["read http://localhost/x?q=1 q=1"] },
      },
      {
        name: "hides a method mismatch behind 404",
        mode: "notFound" as const,
        path: "/x?q=1",
        init: { method: "POST" },
        expected: { status: 404, body: "Not Found", ran: ["read http://localhost/x?q=1 q=1"] },
      },
      {
        name: "answers an unmatched path with 404",
        mode: "advertise" as const,
        path: "/missing?q=1",
        init: undefined,
        expected: { status: 404, body: "Not Found", ran: ["read http://localhost/missing?q=1 q=1"] },
      },
    ])("$name", async ({ mode, path, init, expected }) => {
      const answer = await serve(readingApp(mode), path, init);
      expect(outcome(answer)).toStrictEqual({ ...expected, logged: [] });
    });

    it("advertises GET and HEAD on the 405 it answers", async () => {
      const app = new Forge();
      readingApp("advertise")(app, []);
      expect((await app.request("/x", { method: "POST" })).headers.get("allow")).toBe("GET, HEAD");
    });
  });

  describe("a URL over the match-work budget", () => {
    const overBudget = `/${"b".repeat(250_000)}`;

    async function budgetRefusal(middleware: Middleware) {
      const ran: string[] = [];
      let seen: unknown;
      const app = new Forge(capturingLogger([]));
      app.use("*", middleware);
      mapHandler(app, "GET", "/things/:id", () => (ran.push("GET /things/:id"), new Response("thing")));
      mapHandler(app, "GET", "/x", () => (ran.push("GET /x"), new Response("public")));
      app.setOnError((error) => {
        seen = error;
        return new Response("handled", { status: 503 });
      });
      const res = await app.request(overBudget);
      return { status: res.status, ran, seen };
    }

    it("still reaches onError as the matcher's own refusal when a middleware only reads the URL", async () => {
      const { seen, ...rest } = await budgetRefusal(reading());
      expect({ ...rest, limit: seen instanceof MatcherResourceError ? seen.details.limit : seen }).toStrictEqual({
        status: 503,
        ran: [],
        limit: "maxMatchWork",
      });
    });

    it("refuses a rewrite onto a matchable path rather than serving it", async () => {
      const { seen, ...rest } = await budgetRefusal(toX);
      expect({ ...rest, message: seen instanceof Error && !(seen instanceof MatcherResourceError) ? seen.message : seen }).toStrictEqual({
        status: 503,
        ran: [],
        message: refusalMessage(overBudget, "/x"),
      });
    });

    function reading(): Middleware {
      return (c, next) => (void c.url.pathname, next());
    }
  });

  it("keeps each concurrent request's resolution to itself, and a refused one leaves none behind", async () => {
    const ran: string[] = [];
    const app = new Forge(capturingLogger([]));
    let entered = 0;
    let release!: () => void;
    const bothEntered = new Promise<void>((resolve) => (release = resolve));
    app.use("*", async (c, next) => {
      if (++entered === 2) release();
      await bothEntered;
      if (c.request.headers.has("x-rewrite")) c.url.pathname = "/x";
      return next();
    });
    adminAndPublic(app, ran);

    const [plain, rewritten] = await Promise.all([app.request("/admin/x"), app.request("/admin/x", { headers: { "x-rewrite": "1" } })]);
    const after = await app.request("/admin/x");
    expect({
      plain: [plain.status, await plain.text()],
      rewritten: rewritten.status,
      after: [after.status, await after.text()],
      ran,
    }).toStrictEqual({ plain: [200, "admin"], rewritten: 500, after: [200, "admin"], ran: ["GET /admin/x", "GET /admin/x"] });
  });
});
