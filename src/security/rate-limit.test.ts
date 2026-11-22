import { afterEach, describe, expect, it, setSystemTime, spyOn } from "bun:test";

import type { Middleware } from "@remix-run/fetch-router";

import { Forge } from "../app/forge-app";
import { refuseHookCtx } from "../context/refusal";
import { matchedRoutePattern } from "../context/route-pattern";
import type { Refusal, RefuseHook } from "../context/types";
import { requestLog } from "../logging/request-logger";
import { createTestContext } from "../testing/context";
import { captureLogs } from "../testing/logs";
import { mapHandler } from "../testing/route";
import * as securityBarrel from "./mod";
import { limitRequests, rateLimit, rateLimitCheck, rateLimitsCtx, routeKeySuffix } from "./rate-limit";
import { cfHeadersTrustedCtx } from "./request-id";
import type { RateLimit, RateLimitTable } from "./types";

type Env = { LIMITER?: RateLimit };

/** Publishes trust in the CF headers on every request, as a trusting chain does. */
const trustingCf: Middleware = (context, next) => {
  cfHeadersTrustedCtx.set(context, true);
  return next();
};

const TRUSTED = { trusted: true };

function makeApp(opts?: Partial<Parameters<typeof rateLimit>[0]>, { trusted = false } = {}) {
  const app = new Forge<Env>();
  if (trusted) app.use("*", trustingCf);
  app.use("*", rateLimit<Env>({ binding: "LIMITER", ...opts }));
  mapHandler(app, "POST", "/test", () => new Response("ok"));
  return app;
}

function makeRelaxedApp() {
  const app = new Forge<Env>();
  app.use(
    "*",
    trustingCf,
    limitRequests<Env>({ binding: "LIMITER" }, () => true),
  );
  mapHandler(app, "POST", "/test", () => new Response("ok"));
  return app;
}

describe("rateLimit middleware", () => {
  it("returns 429 when rate limit is exceeded", async () => {
    const app = makeApp({}, TRUSTED);
    const res = await app.request(
      "/test",
      { method: "POST", headers: { "CF-Connecting-IP": "1.2.3.4" } },
      { LIMITER: { limit: async () => ({ success: false }) } },
    );
    expect(res.status).toBe(429);
    expect(await res.text()).toBe("Too many requests. Please try again later.");
  });

  it("passes through when rate limit allows", async () => {
    const app = makeApp({}, TRUSTED);
    const res = await app.request(
      "/test",
      { method: "POST", headers: { "CF-Connecting-IP": "1.2.3.4" } },
      { LIMITER: { limit: async () => ({ success: true }) } },
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("keys by CF-Connecting-IP under the chain's trust", async () => {
    const app = makeApp({}, TRUSTED);
    let capturedKey: string | undefined;
    await app.request(
      "/test",
      { method: "POST", headers: { "CF-Connecting-IP": "5.6.7.8" } },
      {
        LIMITER: {
          limit: async ({ key }: { key: string }) => {
            capturedKey = key;
            return { success: true };
          },
        },
      },
    );
    expect(capturedKey).toBe("5.6.7.8");
  });

  it("keys by `<ip>:<suffix>` when keySuffix is set under the chain's trust", async () => {
    const app = makeApp({ keySuffix: (c) => new URL(c.request.url).pathname }, TRUSTED);
    let capturedKey: string | undefined;
    await app.request(
      "/test",
      { method: "POST", headers: { "CF-Connecting-IP": "5.6.7.8" } },
      {
        LIMITER: {
          limit: async ({ key }: { key: string }) => {
            capturedKey = key;
            return { success: true };
          },
        },
      },
    );
    expect(capturedKey).toBe("5.6.7.8:/test");
  });

  it("returns 503 without consulting keySuffix or the binding when CF-Connecting-IP is absent", async () => {
    let suffixCalls = 0;
    let limitCalls = 0;
    const app = makeApp(
      {
        keySuffix: () => {
          suffixCalls += 1;
          return "route";
        },
      },
      TRUSTED,
    );
    const res = await app.request(
      "/test",
      { method: "POST" },
      {
        LIMITER: {
          limit: async () => {
            limitCalls += 1;
            return { success: true };
          },
        },
      },
    );
    expect({ status: res.status, body: await res.text(), suffixCalls, limitCalls }).toEqual({
      status: 503,
      body: "Service Unavailable",
      suffixCalls: 0,
      limitCalls: 0,
    });
  });

  it("counts two suffixes for the same IP in separate buckets", async () => {
    const hits = new Map<string, number>();
    const onePerKey: RateLimit = {
      limit: async ({ key }) => {
        const count = (hits.get(key) ?? 0) + 1;
        hits.set(key, count);
        return { success: count <= 1 };
      },
    };
    const app = new Forge<Env>();
    app.use("*", trustingCf, rateLimit<Env>({ binding: "LIMITER", keySuffix: (c) => new URL(c.request.url).pathname }));
    mapHandler(app, "POST", "/a", () => new Response("a"));
    mapHandler(app, "POST", "/b", () => new Response("b"));
    const send = (path: string) =>
      app.request(path, { method: "POST", headers: { "CF-Connecting-IP": "5.6.7.8" } }, { LIMITER: onePerKey }).then((r) => r.status);

    expect([await send("/a"), await send("/a"), await send("/b")]).toEqual([200, 429, 200]);
  });

  it("rejects `key` together with `keySuffix` at the type level", () => {
    expect(() =>
      // @ts-expect-error — `key` and `keySuffix` are mutually exclusive
      rateLimit<Env>({ binding: "LIMITER", key: () => "custom", keySuffix: () => "route" }),
    ).toThrow("`key` and `keySuffix` are exclusive");
  });

  it("answers 503 key-failed for a keySuffix where no chain trust is published", async () => {
    const res = await makeApp({ keySuffix: () => "route" }).request(
      "/test",
      { method: "POST", headers: { "CF-Connecting-IP": "1.2.3.4" } },
      { LIMITER: { limit: async () => ({ success: true }) } },
    );
    expect(res.status).toBe(503);
  });

  it("refuses keySuffix together with key at construction", () => {
    expect(() => makeApp({ key: () => "custom", keySuffix: () => "route" } as never, TRUSTED)).toThrow("`key` and `keySuffix` are exclusive");
  });

  it("answers 503 key-failed through the hook, without spending, where no chain trust is published and no key is passed", async () => {
    const seen: Refusal[] = [];
    let limitCalls = 0;
    const app = makeApp({ onRefuse: (_c, refusal) => (seen.push(refusal), new Response(null, { status: 503 })) });
    const res = await app.request(
      "/test",
      { method: "POST", headers: { "CF-Connecting-IP": "1.2.3.4" } },
      { LIMITER: { limit: async () => ((limitCalls += 1), { success: true }) } },
    );
    expect({ status: res.status, seen, limitCalls }).toEqual({
      status: 503,
      seen: [{ guard: "rate-limit", status: 503, reason: "key-failed" }],
      limitCalls: 0,
    });
  });

  it("returns 503 when CF-Connecting-IP is absent under the chain's trust (fail-closed)", async () => {
    const app = makeApp({}, TRUSTED);
    const res = await app.request("/test", { method: "POST" }, { LIMITER: { limit: async () => ({ success: true }) } });
    expect(res.status).toBe(503);
  });

  it("returns 503 when binding is undefined in a build not armed for development", async () => {
    const app = makeApp({}, TRUSTED);
    const res = await app.request("/test", { method: "POST" });
    expect(res.status).toBe(503);
  });

  it("skips when binding is undefined under a relaxation that admits its absence", async () => {
    const res = await makeRelaxedApp().request("/test", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("still enforces a present binding under a relaxation that admits an absent one", async () => {
    const res = await makeRelaxedApp().request(
      "/test",
      { method: "POST", headers: { "CF-Connecting-IP": "1.2.3.4" } },
      { LIMITER: { limit: async () => ({ success: false }) } },
    );
    expect({ status: res.status, body: await res.text() }).toEqual({ status: 429, body: "Too many requests. Please try again later." });
  });

  it("returns 503 when a relaxing `dev` is smuggled into the options past the type", async () => {
    const app = makeApp({ dev: () => true } as never, TRUSTED);
    const res = await app.request("/test", { method: "POST" });
    expect(res.status).toBe(503);
  });

  it("takes no `dev` option, so only a development build relaxes it", () => {
    // @ts-expect-error — `rateLimit` takes no `dev` option
    rateLimit<Env>({ binding: "LIMITER", dev: true });
  });

  it("uses custom key function regardless of the chain's trust", async () => {
    const app = makeApp({ key: () => "custom" });
    let capturedKey: string | undefined;
    await app.request(
      "/test",
      { method: "POST" },
      {
        LIMITER: {
          limit: async ({ key }: { key: string }) => {
            capturedKey = key;
            return { success: true };
          },
        },
      },
    );
    expect(capturedKey).toBe("custom");
  });

  it("hands a spent limit to onRefuse as a rate-limit 429 and answers with its response", async () => {
    const seen: Refusal[] = [];
    const app = makeApp({ onRefuse: (_c, refusal) => (seen.push(refusal), Response.json({ error: "rate limited" }, { status: 429 })) }, TRUSTED);
    const res = await app.request(
      "/test",
      { method: "POST", headers: { "CF-Connecting-IP": "1.2.3.4" } },
      { LIMITER: { limit: async () => ({ success: false }) } },
    );
    expect({ status: res.status, body: await res.json(), seen }).toEqual({
      status: 429,
      body: { error: "rate limited" },
      seen: [{ guard: "rate-limit", status: 429 }],
    });
  });

  it("never calls onRefuse on a request the limit admits", async () => {
    const seen: Refusal[] = [];
    const app = makeApp({ onRefuse: (_c, refusal) => (seen.push(refusal), new Response(null, { status: 418 })) }, TRUSTED);
    const res = await app.request(
      "/test",
      { method: "POST", headers: { "CF-Connecting-IP": "1.2.3.4" } },
      { LIMITER: { limit: async () => ({ success: true }) } },
    );
    expect({ status: res.status, body: await res.text(), seen }).toEqual({ status: 200, body: "ok", seen: [] });
  });

  it("answers through the hook published on the request when it declares none of its own", async () => {
    const seen: Refusal[] = [];
    const app = new Forge<Env>();
    app.use("*", (context, next) => {
      refuseHookCtx.set(context, (_c, refusal) => (seen.push(refusal), new Response("chain", { status: 429 })));
      return next();
    });
    app.use("*", rateLimit<Env>({ binding: "LIMITER", key: () => "client-1" }));
    mapHandler(app, "POST", "/test", () => new Response("ok"));

    const res = await app.request("/test", { method: "POST" }, { LIMITER: { limit: async () => ({ success: false }) } });
    expect({ status: res.status, body: await res.text(), seen }).toEqual({
      status: 429,
      body: "chain",
      seen: [{ guard: "rate-limit", status: 429 }],
    });
  });

  it("answers through its own hook ahead of the one published on the request", async () => {
    const app = new Forge<Env>();
    app.use("*", (context, next) => {
      refuseHookCtx.set(context, () => new Response("chain", { status: 429 }));
      return next();
    });
    app.use("*", rateLimit<Env>({ binding: "LIMITER", key: () => "client-1", onRefuse: () => new Response("own", { status: 429 }) }));
    mapHandler(app, "POST", "/test", () => new Response("ok"));

    const res = await app.request("/test", { method: "POST" }, { LIMITER: { limit: async () => ({ success: false }) } });
    expect({ status: res.status, body: await res.text() }).toEqual({ status: 429, body: "own" });
  });
});

describe("rateLimit — a failing binding or key", () => {
  let consoleLog: ReturnType<typeof spyOn<Console, "log">> | undefined;

  afterEach(() => {
    consoleLog?.mockRestore();
    consoleLog = undefined;
  });

  function loggedLines(): Record<string, unknown>[] {
    return (consoleLog?.mock.calls ?? []).map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
  }

  function countingApp(opts: Partial<Parameters<typeof rateLimit>[0]>) {
    const app = new Forge<Env>();
    const reached: string[] = [];
    app.use("*", rateLimit<Env>({ binding: "LIMITER", ...opts }));
    mapHandler(app, "POST", "/test", () => {
      reached.push("handler");
      return new Response("ok");
    });
    return { app, reached };
  }

  const outage = new Error("rate limiter unreachable");
  for (const { name, limit } of [
    {
      name: "throws",
      limit: (): Promise<{ success: boolean }> => {
        throw outage;
      },
    },
    { name: "rejects", limit: (): Promise<{ success: boolean }> => Promise.reject(outage) },
  ]) {
    it(`refuses with 503 and logs an error when the binding's limit ${name}`, async () => {
      consoleLog = spyOn(console, "log").mockImplementation(() => {});
      const { app, reached } = countingApp({ key: () => "client-1" });
      const res = await app.request("/test", { method: "POST" }, { LIMITER: { limit } });
      expect(res.status).toBe(503);
      expect(await res.text()).toBe("Service Unavailable");
      expect(reached).toEqual([]);
      expect(loggedLines().map(({ timestamp: _timestamp, ...line }) => line)).toEqual([
        {
          level: "error",
          prefix: "security",
          message: "security.rate-limit.refused",
          guard: "rate-limit",
          status: 503,
          reason: "binding-failed",
          routePattern: "/test",
          requestId: null,
          error: { type: "Error", detail: "rate limiter unreachable", stack: outage.stack },
        },
      ]);
    });
  }

  it("logs a key-resolution failure at error, with the error as a structured object", async () => {
    consoleLog = spyOn(console, "log").mockImplementation(() => {});
    const keyFailure = new Error("tenant header missing");
    const { app, reached } = countingApp({
      key: () => {
        throw keyFailure;
      },
    });
    const res = await app.request("/test", { method: "POST" }, { LIMITER: { limit: async () => ({ success: true }) } });
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("Service Unavailable");
    expect(reached).toEqual([]);
    expect(loggedLines().map(({ timestamp: _timestamp, ...line }) => line)).toEqual([
      {
        level: "error",
        prefix: "security",
        message: "security.rate-limit.refused",
        guard: "rate-limit",
        status: 503,
        reason: "key-failed",
        routePattern: "/test",
        requestId: null,
        error: { type: "Error", detail: "tenant header missing", stack: keyFailure.stack },
      },
    ]);
  });
});

describe("rateLimit — logging through the request's logger", () => {
  function loggedApp(key: () => string) {
    const capture = captureLogs();
    const app = new Forge<Env>();
    app.use("*", (context, next) => {
      requestLog.set(context, capture.logger);
      return next();
    });
    app.use("*", rateLimit<Env>({ binding: "LIMITER", key }));
    mapHandler(app, "POST", "/test", () => new Response("ok"));
    return { app, capture };
  }

  const recorded = (capture: ReturnType<typeof captureLogs>) =>
    capture.records.map(({ level, message, data }) => ({
      level,
      message,
      source: data?.["source"],
      detail: (data?.["error"] as { detail?: string })?.detail,
    }));

  it("records a failing binding on the context's request logger at error, writing nothing to the console", async () => {
    const consoleLog = spyOn(console, "log").mockImplementation(() => {});
    try {
      const { app, capture } = loggedApp(() => "client-1");
      const res = await app.request(
        "/test",
        { method: "POST" },
        { LIMITER: { limit: () => Promise.reject(new Error("rate limiter unreachable")) } },
      );

      expect({ status: res.status, logged: recorded(capture), console: consoleLog.mock.calls.length }).toEqual({
        status: 503,
        logged: [{ level: "error", message: "security.rate-limit.refused", source: "security", detail: "rate limiter unreachable" }],
        console: 0,
      });
    } finally {
      consoleLog.mockRestore();
    }
  });

  it("records a failing key on the context's request logger at error", async () => {
    const { app, capture } = loggedApp(() => {
      throw new Error("tenant header missing");
    });
    const res = await app.request("/test", { method: "POST" }, { LIMITER: { limit: async () => ({ success: true }) } });

    expect({ status: res.status, logged: recorded(capture) }).toEqual({
      status: 503,
      logged: [{ level: "error", message: "security.rate-limit.refused", source: "security", detail: "tenant header missing" }],
    });
  });

  it("records a keyless limit with no chain trust as key-failed at error, without spending", async () => {
    const capture = captureLogs();
    let limitCalls = 0;
    const app = new Forge<Env>();
    app.use("*", (context, next) => {
      requestLog.set(context, capture.logger);
      return next();
    });
    app.use("*", rateLimit<Env>({ binding: "LIMITER" }));
    mapHandler(app, "POST", "/test", () => new Response("ok"));

    const res = await app.request(
      "/test",
      { method: "POST", headers: { "CF-Connecting-IP": "1.2.3.4" } },
      { LIMITER: { limit: async () => ((limitCalls += 1), { success: true }) } },
    );

    expect({
      status: res.status,
      limitCalls,
      logged: capture.records.map(({ level, message, data }) => ({ level, message, reason: data?.["reason"] })),
    }).toEqual({ status: 503, limitCalls: 0, logged: [{ level: "error", message: "security.rate-limit.refused", reason: "key-failed" }] });
  });
});

describe("rateLimit — every 503 goes through the hook", () => {
  const outage = new Error("rate limiter unreachable");
  const keyFailure = new Error("tenant header missing");
  const cases: Array<{ reason: "binding-absent" | "key-failed" | "binding-failed"; key: () => string; env: Env; cause: Error | undefined }> = [
    { reason: "binding-absent", key: () => "client-1", env: {}, cause: undefined },
    {
      reason: "key-failed",
      key: () => {
        throw keyFailure;
      },
      env: { LIMITER: { limit: async () => ({ success: true }) } },
      cause: keyFailure,
    },
    { reason: "binding-failed", key: () => "client-1", env: { LIMITER: { limit: () => Promise.reject(outage) } }, cause: outage },
  ];

  for (const { reason, key, env, cause } of cases) {
    it(`hands ${reason} to the hook as a rate-limit 503, logs it at error, and never reaches the handler`, async () => {
      const capture = captureLogs();
      const seen: Refusal[] = [];
      const reached: string[] = [];
      const app = new Forge<Env>();
      app.use("*", (context, next) => {
        requestLog.set(context, capture.logger);
        return next();
      });
      app.use(
        "*",
        rateLimit<Env>({ binding: "LIMITER", key, onRefuse: (_c, refusal) => (seen.push(refusal), new Response("try later", { status: 503 })) }),
      );
      mapHandler(app, "POST", "/test", () => (reached.push("handler"), new Response("ok")));

      const res = await app.request("/test", { method: "POST", headers: { "CF-Connecting-IP": "198.51.100.4" } }, env);

      expect({
        status: res.status,
        body: await res.text(),
        seen,
        reached,
        logged: capture.records.map(({ level, message, data }) => ({ level, message, data })),
      }).toEqual({
        status: 503,
        body: "try later",
        seen: [{ guard: "rate-limit", status: 503, reason }],
        reached: [],
        logged: [
          {
            level: "error",
            message: "security.rate-limit.refused",
            data: {
              source: "security",
              guard: "rate-limit",
              status: 503,
              reason,
              routePattern: "/test",
              requestId: null,
              ...(cause ? { error: { type: "Error", detail: cause.message, stack: cause.stack } } : {}),
            },
          },
        ],
      });
    });
  }

  it("answers a hook that throws through the error boundary rather than masking it as a 503", async () => {
    const app = new Forge<Env>();
    app.setOnError(() => new Response("boundary", { status: 500 }));
    app.use(
      "*",
      rateLimit<Env>({
        binding: "LIMITER",
        key: () => "client-1",
        onRefuse: () => {
          throw new Error("hook bug");
        },
      }),
    );
    mapHandler(app, "POST", "/test", () => new Response("ok"));

    const res = await app.request("/test", { method: "POST" });
    expect({ status: res.status, body: await res.text() }).toEqual({ status: 500, body: "boundary" });
  });
});

describe("rateLimit — identical 429 lines collapse", () => {
  const T0 = new Date("2026-11-23T12:00:00.000Z").getTime();
  const spent: Env = { LIMITER: { limit: async () => ({ success: false }) } };

  function collapsingApp(hook?: RefuseHook<Env>) {
    const capture = captureLogs();
    const app = new Forge<Env>();
    app.use("*", (context, next) => {
      requestLog.set(context, capture.logger);
      return next();
    });
    app.use("*", rateLimit<Env>({ binding: "LIMITER", key: () => "client-1", ...(hook ? { onRefuse: hook } : {}) }));
    mapHandler(app, "POST", "/a", () => new Response("a"));
    mapHandler(app, "POST", "/b", () => new Response("b"));
    const at = async (offsetMs: number, path: string) => {
      setSystemTime(new Date(T0 + offsetMs));
      return (await app.request(path, { method: "POST" }, spent)).status;
    };
    const lines = () => capture.records.map(({ data }) => ({ routePattern: data?.["routePattern"], collapsed: data?.["collapsed"] }));
    return { at, lines };
  }

  afterEach(() => {
    setSystemTime();
  });

  it("writes the first 429, holds identical ones inside the window, and carries their count on the next one written", async () => {
    const { at, lines } = collapsingApp();
    const statuses = [await at(0, "/a"), await at(1_000, "/a"), await at(59_000, "/a"), await at(61_000, "/a")];
    expect({ statuses, lines: lines() }).toEqual({
      statuses: [429, 429, 429, 429],
      lines: [
        { routePattern: "/a", collapsed: undefined },
        { routePattern: "/a", collapsed: 2 },
      ],
    });
  });

  it("writes a 429 on another route inside the window, since it is not identical", async () => {
    const { at, lines } = collapsingApp();
    const statuses = [await at(0, "/a"), await at(1_000, "/b"), await at(2_000, "/a")];
    expect({ statuses, lines: lines() }).toEqual({
      statuses: [429, 429, 429],
      lines: [
        { routePattern: "/a", collapsed: undefined },
        { routePattern: "/b", collapsed: undefined },
      ],
    });
  });

  it("still hands every held 429 to the hook, collapsing only the log", async () => {
    const seen: Refusal[] = [];
    const { at, lines } = collapsingApp((_c, refusal) => (seen.push(refusal), new Response("slow down", { status: 429 })));
    await at(0, "/a");
    await at(1_000, "/a");
    await at(2_000, "/a");
    expect({ hooked: seen.length, written: lines().length }).toEqual({ hooked: 3, written: 1 });
  });

  it("collapses per rateLimit instance, so a second limiter writes its own first 429", async () => {
    const first = collapsingApp();
    const second = collapsingApp();
    await first.at(0, "/a");
    await second.at(1_000, "/a");
    expect({ first: first.lines(), second: second.lines() }).toEqual({
      first: [{ routePattern: "/a", collapsed: undefined }],
      second: [{ routePattern: "/a", collapsed: undefined }],
    });
  });

  it("never collapses a 503, writing each one", async () => {
    const capture = captureLogs();
    const app = new Forge<Env>();
    app.use("*", (context, next) => {
      requestLog.set(context, capture.logger);
      return next();
    });
    app.use("*", rateLimit<Env>({ binding: "LIMITER", key: () => "client-1" }));
    mapHandler(app, "POST", "/a", () => new Response("a"));
    setSystemTime(new Date(T0));
    await app.request("/a", { method: "POST" });
    setSystemTime(new Date(T0 + 1_000));
    await app.request("/a", { method: "POST" });
    expect(capture.records.map(({ level, data }) => [level, data?.["reason"]])).toEqual([
      ["error", "binding-absent"],
      ["error", "binding-absent"],
    ]);
  });
});

describe("rateLimit — the 429 log line", () => {
  it("logs security.rate-limit.refused at warn with no client address or key", async () => {
    const capture = captureLogs();
    const app = new Forge<Env>();
    app.use("*", (context, next) => {
      requestLog.set(context, capture.logger);
      return next();
    });
    app.use("*", trustingCf, rateLimit<Env>({ binding: "LIMITER", keySuffix: () => "suffix-7" }));
    mapHandler(app, "POST", "/items/:id", () => new Response("ok"));

    const res = await app.request(
      "/items/9",
      { method: "POST", headers: { "CF-Connecting-IP": "198.51.100.4" } },
      { LIMITER: { limit: async () => ({ success: false }) } },
    );
    expect({ status: res.status, logged: capture.records.map(({ level, message, data }) => ({ level, message, data })) }).toEqual({
      status: 429,
      logged: [
        {
          level: "warn",
          message: "security.rate-limit.refused",
          data: { source: "security", guard: "rate-limit", status: 429, reason: null, routePattern: "/items/:id", requestId: null },
        },
      ],
    });
  });
});

describe("rateLimit — the methods it counts", () => {
  const SPENT_BODY = "Too many requests. Please try again later.";

  function methodApp(methods: readonly string[] | undefined) {
    const app = new Forge<Env>();
    app.use("*", rateLimit<Env>({ binding: "LIMITER", key: () => "client-1", ...(methods ? { methods } : {}) }));
    mapHandler(app, "GET", "/test", () => new Response("read"));
    mapHandler(app, "POST", "/test", () => new Response("written"));
    return app;
  }

  const cases: {
    name: string;
    methods: readonly string[] | undefined;
    method: string;
    expected: { status: number; body: string; spent: number };
  }[] = [
    { name: 'leaves a GET uncounted under ["POST"]', methods: ["POST"], method: "GET", expected: { status: 200, body: "read", spent: 0 } },
    { name: 'counts a POST under ["POST"]', methods: ["POST"], method: "POST", expected: { status: 429, body: SPENT_BODY, spent: 1 } },
    {
      name: 'counts a POST under a lower-cased ["post"]',
      methods: ["post"],
      method: "POST",
      expected: { status: 429, body: SPENT_BODY, spent: 1 },
    },
    { name: "counts a GET when no methods are given", methods: undefined, method: "GET", expected: { status: 429, body: SPENT_BODY, spent: 1 } },
  ];

  for (const { name, methods, method, expected } of cases) {
    it(name, async () => {
      let spent = 0;
      const exhausted: RateLimit = {
        limit: async () => {
          spent += 1;
          return { success: false };
        },
      };
      const res = await methodApp(methods).request("/test", { method }, { LIMITER: exhausted });
      expect({ status: res.status, body: await res.text(), spent }).toEqual(expected);
    });
  }

  it("passes an uncounted method past an absent binding, and still refuses a counted one 503", async () => {
    const app = methodApp(["POST"]);
    const answer = async (method: string) => {
      const res = await app.request("/test", { method }, {});
      return { status: res.status, body: await res.text() };
    };
    expect({ get: await answer("GET"), post: await answer("POST") }).toEqual({
      get: { status: 200, body: "read" },
      post: { status: 503, body: "Service Unavailable" },
    });
  });

  it("refuses a GET 503 past an absent binding when no methods are given", async () => {
    const res = await methodApp(undefined).request("/test", { method: "GET" }, {});
    expect({ status: res.status, body: await res.text() }).toEqual({ status: 503, body: "Service Unavailable" });
  });
});

describe("rateLimit — the rateLimits table published on the request", () => {
  function tabledApp(table: RateLimitTable, methods?: readonly string[]) {
    const reached: string[] = [];
    const app = new Forge<Env>();
    app.setOnError((err) => new Response(err.message, { status: 500 }));
    app.use("*", (context, next) => {
      rateLimitsCtx.set(context, table);
      return next();
    });
    app.use("*", rateLimit<Env>({ binding: "LIMITER", key: () => "client-1", ...(methods ? { methods } : {}) }));
    mapHandler(app, "GET", "/test", () => (reached.push("handler"), new Response("ok")));
    return { app, reached };
  }

  function counter(spent: string[]): RateLimit {
    return {
      limit: async () => {
        spent.push("LIMITER");
        return { success: true };
      },
    };
  }

  const missing: { name: string; methods: readonly string[] | undefined }[] = [
    { name: "throws through the error boundary, spending nothing, when the table lacks its binding", methods: undefined },
    { name: "throws for a method it does not count, since a missing name is a wiring error", methods: ["POST"] },
  ];

  for (const { name, methods } of missing) {
    it(name, async () => {
      const spent: string[] = [];
      const { app, reached } = tabledApp({ RATE_LIMITER: { limit: 10, period: 60 } }, methods);
      const res = await app.request("/test", {}, { LIMITER: counter(spent) });
      const body = await res.text();

      expect({ status: res.status, spent, reached }).toEqual({ status: 500, spent: [], reached: [] });
      expect(body).toContain('"LIMITER"');
      expect(body).toContain("`rateLimits`");
    });
  }

  it("counts and serves when the table holds its binding", async () => {
    const spent: string[] = [];
    const { app, reached } = tabledApp({ LIMITER: { limit: 10, period: 60 } });
    const res = await app.request("/test", {}, { LIMITER: counter(spent) });
    expect({ status: res.status, body: await res.text(), spent, reached }).toEqual({
      status: 200,
      body: "ok",
      spent: ["LIMITER"],
      reached: ["handler"],
    });
  });
});

describe("rateLimit — the 429's Retry-After", () => {
  const WINDOWS: RateLimitTable = { LIMITER: { limit: 5, period: 90 } };
  const spent: Env = { LIMITER: { limit: async () => ({ success: false }) } };

  function retryApp({ table, hook }: { table?: RateLimitTable; hook?: RefuseHook<Env> }) {
    const app = new Forge<Env>();
    app.use("*", (context, next) => {
      requestLog.set(context, captureLogs().logger);
      if (table) rateLimitsCtx.set(context, table);
      return next();
    });
    app.use("*", rateLimit<Env>({ binding: "LIMITER", key: () => "client-1", ...(hook ? { onRefuse: hook } : {}) }));
    mapHandler(app, "POST", "/test", () => new Response("ok"));
    return app;
  }

  async function answer(app: Forge<Env>, env: Env) {
    const res = await app.request("/test", { method: "POST" }, env);
    return {
      status: res.status,
      body: await res.text(),
      retryAfter: res.headers.get("Retry-After"),
      rateLimit: res.headers.get("RateLimit"),
      policy: res.headers.get("RateLimit-Policy"),
    };
  }

  it("answers the default 429 with Retry-After set to the published period, and no RateLimit headers", async () => {
    expect(await answer(retryApp({ table: WINDOWS }), spent)).toEqual({
      status: 429,
      body: "Too many requests. Please try again later.",
      retryAfter: "90",
      rateLimit: null,
      policy: null,
    });
  });

  it("hands a hook that sets no Retry-After the period as retryAfter, and answers with Retry-After set to it", async () => {
    const seen: Refusal[] = [];
    const app = retryApp({ table: WINDOWS, hook: (_c, refusal) => (seen.push(refusal), new Response("slow down", { status: 429 })) });
    expect({ ...(await answer(app, spent)), seen }).toStrictEqual({
      status: 429,
      body: "slow down",
      retryAfter: "90",
      rateLimit: null,
      policy: null,
      seen: [{ guard: "rate-limit", status: 429, retryAfter: 90 }],
    });
  });

  it("keeps the Retry-After a hook sets itself", async () => {
    const app = retryApp({ table: WINDOWS, hook: () => new Response("slow down", { status: 429, headers: { "Retry-After": "7" } }) });
    expect(await answer(app, spent)).toEqual({ status: 429, body: "slow down", retryAfter: "7", rateLimit: null, policy: null });
  });

  it("refuses 429 with no Retry-After and no retryAfter on the refusal when no rateLimits table is published", async () => {
    const seen: Refusal[] = [];
    const app = retryApp({ hook: (_c, refusal) => (seen.push(refusal), new Response("slow down", { status: 429 })) });
    expect({ ...(await answer(app, spent)), seen }).toStrictEqual({
      status: 429,
      body: "slow down",
      retryAfter: null,
      rateLimit: null,
      policy: null,
      seen: [{ guard: "rate-limit", status: 429 }],
    });
  });

  it("answers the default 429 with no Retry-After when no rateLimits table is published", async () => {
    expect(await answer(retryApp({}), spent)).toEqual({
      status: 429,
      body: "Too many requests. Please try again later.",
      retryAfter: null,
      rateLimit: null,
      policy: null,
    });
  });

  it("sets no Retry-After on a 503 under a published table", async () => {
    expect(await answer(retryApp({ table: WINDOWS }), {})).toEqual({
      status: 503,
      body: "Service Unavailable",
      retryAfter: null,
      rateLimit: null,
      policy: null,
    });
  });

  it("sets no Retry-After on a request the limit admits", async () => {
    expect(await answer(retryApp({ table: WINDOWS }), { LIMITER: { limit: async () => ({ success: true }) } })).toEqual({
      status: 200,
      body: "ok",
      retryAfter: null,
      rateLimit: null,
      policy: null,
    });
  });
});

describe("limitRequests", () => {
  it("stays off the security barrel, so no consumer reaches the relaxation", () => {
    expect(Object.values<unknown>(securityBarrel).includes(limitRequests)).toBe(false);
  });
});

describe("rateLimitCheck", () => {
  function recording(spent: string[], success: boolean): RateLimit {
    return {
      limit: async ({ key }) => {
        spent.push(key);
        return { success };
      },
    };
  }

  async function check(env: Env, { method = "POST", methods }: { method?: string; methods?: readonly string[] } = {}) {
    const c = createTestContext<Env>(new Request("http://test/notes", { method }), { env });
    const answer = await rateLimitCheck<Env>({ binding: "LIMITER", key: () => "user-7", ...(methods ? { methods } : {}) })(c);
    return answer === undefined ? undefined : { status: answer.status, body: await answer.text() };
  }

  it("admits a request the binding allows, answering undefined after spending its key", async () => {
    const spent: string[] = [];
    expect({ answer: await check({ LIMITER: recording(spent, true) }), spent }).toEqual({ answer: undefined, spent: ["user-7"] });
  });

  it("answers a request the binding refuses with the 429 refusal", async () => {
    const spent: string[] = [];
    expect({ answer: await check({ LIMITER: recording(spent, false) }), spent }).toEqual({
      answer: { status: 429, body: "Too many requests. Please try again later." },
      spent: ["user-7"],
    });
  });

  it("answers 503 for an absent binding, as the strict build refuses it", async () => {
    expect(await check({})).toEqual({ status: 503, body: "Service Unavailable" });
  });

  it("admits a method outside `methods` without spending", async () => {
    const spent: string[] = [];
    expect({ answer: await check({ LIMITER: recording(spent, false) }, { method: "GET", methods: ["post"] }), spent }).toEqual({
      answer: undefined,
      spent: [],
    });
  });

  it("stays off the security barrel", () => {
    expect(Object.values<unknown>(securityBarrel).includes(rateLimitCheck)).toBe(false);
  });
});

describe("routeKeySuffix", () => {
  const cases: { name: string; pattern: string | undefined; expected: string }[] = [
    { name: "the matched pattern source for a param route", pattern: "/admin/users/:id", expected: "/admin/users/:id" },
    { name: "the catch-all pattern for an `ANY *` route", pattern: "*", expected: "*" },
    { name: "one constant when no route matched", pattern: undefined, expected: "<unmatched>" },
  ];

  for (const { name, pattern, expected } of cases) {
    it(`answers ${name}`, () => {
      const c = createTestContext(new Request("http://test/admin/users/42"));
      if (pattern !== undefined) matchedRoutePattern.set(c, pattern);
      expect(routeKeySuffix(c)).toBe(expected);
    });
  }

  it("keys a live request by the route it resolved to, not its concrete URL", async () => {
    const keys: string[] = [];
    const app = new Forge<Env>();
    app.use("*", trustingCf, rateLimit<Env>({ binding: "LIMITER", keySuffix: routeKeySuffix }));
    mapHandler(app, "POST", "/items/:id", () => new Response("ok"));
    const LIMITER: RateLimit = {
      limit: async ({ key }) => {
        keys.push(key);
        return { success: true };
      },
    };

    for (const path of ["/items/1", "/items/2", "/missing"]) {
      await app.request(path, { method: "POST", headers: { "CF-Connecting-IP": "1.2.3.4" } }, { LIMITER });
    }

    expect(keys).toStrictEqual(["1.2.3.4:/items/:id", "1.2.3.4:/items/:id", "1.2.3.4:<unmatched>"]);
  });

  it("is the export the security barrel publishes", () => {
    expect(securityBarrel.routeKeySuffix).toBe(routeKeySuffix);
  });
});
