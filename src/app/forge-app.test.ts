import { describe, expect, it } from "bun:test";

import type { Middleware } from "@remix-run/fetch-router";

import type { AppContext } from "../context/types";
import { createLogger } from "../logging/logger";
import type { LogChannel, LogRecord, Logger } from "../logging/types";
import { MatcherResourceError } from "../router/mod";
import type { MatcherResourceErrorDetails } from "../router/mod";
import { collectExecutionContext, mockExecutionContext } from "../testing/context";
import { mapHandler } from "../testing/route";
import { Forge } from "./forge-app";

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

  it("never calls the onError override for an aborted request", async () => {
    const app = new Forge();
    let called = false;
    app.setOnError(() => {
      called = true;
      return new Response("handled", { status: 503 });
    });
    mapHandler(app, "GET", "/slow", () => {
      throw new Error("handler exploded");
    });

    const res = await app.fetch(new Request("http://test/slow", { signal: AbortSignal.abort() }), {}, ctx());
    expect(res.status).toBe(499);
    expect(called).toBe(false);
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

describe("Forge.setErrorDetail", () => {
  it("shows the error message once the detail is turned on", async () => {
    const app = new Forge();
    app.setErrorDetail(true);
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("connection refused");
    });

    const res = await app.request("/boom");
    expect(await res.text()).toBe(ERROR_PAGE("connection refused"));
  });

  it("escapes the message it reveals", async () => {
    const app = new Forge();
    app.setErrorDetail(true);
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("<script>alert('x')</script> & co");
    });

    const res = await app.request("/boom");
    expect(await res.text()).toBe(ERROR_PAGE("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; co"));
  });

  it("hides the message by default, no allowance having turned it on", async () => {
    const app = new Forge();
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("connection refused");
    });

    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(ERROR_PAGE("An unexpected error occurred."));
  });

  it("hides it again when the detail is turned back off", async () => {
    const app = new Forge();
    app.setErrorDetail(true);
    app.setErrorDetail(false);
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("connection refused");
    });

    const res = await app.request("/boom");
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
    expect((records[0]!.data as { error: { message: string } }).error.message).toBe("handler exploded");
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
    expect(records.map((r) => r.message)).toStrictEqual(["onError override threw", "Unhandled error"]);
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
