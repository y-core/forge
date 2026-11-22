import { describe, expect, it, spyOn } from "bun:test";

import { RequestContext } from "@remix-run/fetch-router";

import { mergePendingHeaders } from "../context/pending-headers";
import { refuseHookCtx } from "../context/refusal";
import { matchedRoutePattern } from "../context/route-pattern";
import type { Refusal, RefuseHook } from "../context/types";
import { getAppContext } from "../context/types";
import { requestLog } from "../logging/request-logger";
import { createTestContext } from "../testing/context";
import { captureLogs } from "../testing/logs";
import { composeRefuseHooks, createRefusalAnswer, defaultRefusalResponse } from "./refusal";
import { requestIdCtx } from "./request-id";

describe("defaultRefusalResponse", () => {
  const cases: Array<{ refusal: Refusal; status: number; body: string }> = [
    { refusal: { guard: "csrf", status: 403, reason: "missing-token" }, status: 403, body: "Forbidden" },
    { refusal: { guard: "csrf", status: 403, reason: "unbound-subject" }, status: 403, body: "Forbidden" },
    { refusal: { guard: "csrf", status: 413, reason: "too-large" }, status: 413, body: "Payload Too Large" },
    { refusal: { guard: "csrf", status: 400, reason: "unreadable-body" }, status: 400, body: "Bad Request" },
    { refusal: { guard: "origin", status: 403, reason: "cross-site" }, status: 403, body: "Forbidden" },
    { refusal: { guard: "rate-limit", status: 429 }, status: 429, body: "Too many requests. Please try again later." },
    { refusal: { guard: "rate-limit", status: 503, reason: "binding-absent" }, status: 503, body: "Service Unavailable" },
    { refusal: { guard: "rate-limit", status: 503, reason: "key-failed" }, status: 503, body: "Service Unavailable" },
    { refusal: { guard: "rate-limit", status: 503, reason: "binding-failed" }, status: 503, body: "Service Unavailable" },
    { refusal: { guard: "admin", status: 403 }, status: 403, body: "Forbidden" },
  ];

  for (const { refusal, status, body } of cases) {
    const label = "reason" in refusal ? `${refusal.guard} ${refusal.status} ${refusal.reason}` : `${refusal.guard} ${refusal.status}`;
    it(`answers ${label} with a ${status} text body and no header, so the reason reaches neither`, async () => {
      const res = defaultRefusalResponse(refusal);
      expect({ status: res.status, body: await res.text(), headers: [...res.headers] }).toEqual({ status, body, headers: [] });
    });
  }
});

describe("createRefusalAnswer — which hook answers", () => {
  const refusal: Refusal = { guard: "origin", status: 403, reason: "disallowed" };

  function quietContext() {
    const context = createTestContext(new Request("http://localhost/save", { method: "POST" }), { env: { SUPPORT: "help-desk" } });
    requestLog.set(context, captureLogs().logger);
    return context;
  }

  it("answers with its own hook ahead of the one published on the request", async () => {
    const context = quietContext();
    refuseHookCtx.set(context, () => new Response("published", { status: 418 }));
    const res = await createRefusalAnswer(() => new Response("own", { status: 409 }))(context, refusal);
    expect({ status: res.status, body: await res.text() }).toEqual({ status: 409, body: "own" });
  });

  it("answers with the hook published on the request when it has none of its own", async () => {
    const context = quietContext();
    const seen: Refusal[] = [];
    refuseHookCtx.set(context, (_c, given) => (seen.push(given), new Response("published", { status: 418 })));
    const res = await createRefusalAnswer()(context, refusal);
    expect({ status: res.status, body: await res.text(), seen }).toEqual({ status: 418, body: "published", seen: [refusal] });
  });

  it("answers with the plain-text default when no hook is declared anywhere", async () => {
    const res = await createRefusalAnswer()(quietContext(), refusal);
    expect({ status: res.status, body: await res.text() }).toEqual({ status: 403, body: "Forbidden" });
  });

  it("hands the hook the app context, so it can read the request's bindings", async () => {
    const answer = createRefusalAnswer<{ SUPPORT: string }>((c) => new Response(c.env.SUPPORT, { status: 403 }));
    const res = await answer(quietContext(), refusal);
    expect(await res.text()).toBe("help-desk");
  });

  it("awaits an async hook", async () => {
    const answer = createRefusalAnswer(async () => {
      await Promise.resolve();
      return new Response("later", { status: 403 });
    });
    const res = await answer(quietContext(), refusal);
    expect(await res.text()).toBe("later");
  });
});

describe("createRefusalAnswer — a 429's Retry-After", () => {
  const spent: Refusal = { guard: "rate-limit", status: 429, retryAfter: 45 };

  function quietContext() {
    const context = createTestContext(new Request("http://localhost/save", { method: "POST" }));
    requestLog.set(context, captureLogs().logger);
    return context;
  }

  async function answered(answer: ReturnType<typeof createRefusalAnswer>, refusal: Refusal) {
    const context = quietContext();
    const res = await answer(context, refusal);
    return { own: res.headers.get("Retry-After"), queued: mergePendingHeaders(context, res)?.get("Retry-After") ?? null };
  }

  const cases: Array<{
    name: string;
    answer: () => ReturnType<typeof createRefusalAnswer>;
    refusal: Refusal;
    expected: { own: string | null; queued: string | null };
  }> = [
    {
      name: "queues the retryAfter as Retry-After beside the default answer",
      answer: () => createRefusalAnswer(),
      refusal: spent,
      expected: { own: null, queued: "45" },
    },
    {
      name: "queues the retryAfter as Retry-After beside a hook's answer that sets none",
      answer: () => createRefusalAnswer(() => new Response("slow down", { status: 429 })),
      refusal: spent,
      expected: { own: null, queued: "45" },
    },
    {
      name: "keeps a hook's own Retry-After and queues none over it",
      answer: () => createRefusalAnswer(() => new Response("slow down", { status: 429, headers: { "Retry-After": "7" } })),
      refusal: spent,
      expected: { own: "7", queued: null },
    },
    {
      name: "queues no Retry-After for a 429 without a retryAfter",
      answer: () => createRefusalAnswer(),
      refusal: { guard: "rate-limit", status: 429 },
      expected: { own: null, queued: null },
    },
    {
      name: "queues no Retry-After for a 503",
      answer: () => createRefusalAnswer(),
      refusal: { guard: "rate-limit", status: 503, reason: "binding-absent" },
      expected: { own: null, queued: null },
    },
  ];

  for (const { name, answer, refusal, expected } of cases) {
    it(name, async () => {
      expect(await answered(answer(), refusal)).toEqual(expected);
    });
  }

  it("hands the hook the refusal with its retryAfter", async () => {
    const seen: Refusal[] = [];
    await createRefusalAnswer((_c, refusal) => (seen.push(refusal), new Response(null, { status: 429 })))(quietContext(), spent);
    expect(seen).toStrictEqual([{ guard: "rate-limit", status: 429, retryAfter: 45 }]);
  });
});

describe("createRefusalAnswer — the refusal log", () => {
  function loggedContext(path = "/items/7") {
    const capture = captureLogs();
    const context = createTestContext(new Request(`http://localhost${path}`, { method: "POST" }));
    requestLog.set(context, capture.logger);
    const lines = () => capture.records.map(({ level, message, data }) => ({ level, message, data }));
    return { context, lines };
  }

  const levels: Array<{ refusal: Refusal; level: "warn" | "error"; reason: string | null }> = [
    { refusal: { guard: "csrf", status: 403, reason: "expired" }, level: "warn", reason: "expired" },
    { refusal: { guard: "csrf", status: 413, reason: "too-large" }, level: "warn", reason: "too-large" },
    { refusal: { guard: "csrf", status: 400, reason: "unreadable-body" }, level: "warn", reason: "unreadable-body" },
    { refusal: { guard: "origin", status: 403, reason: "same-site" }, level: "warn", reason: "same-site" },
    { refusal: { guard: "rate-limit", status: 429 }, level: "warn", reason: null },
    { refusal: { guard: "rate-limit", status: 503, reason: "binding-absent" }, level: "error", reason: "binding-absent" },
    { refusal: { guard: "admin", status: 403 }, level: "warn", reason: null },
  ];

  for (const { refusal, level, reason } of levels) {
    it(`logs a ${refusal.guard} ${refusal.status} once as security.${refusal.guard}.refused at ${level}`, async () => {
      const { context, lines } = loggedContext();
      matchedRoutePattern.set(context, "/items/:id");
      requestIdCtx.set(context, "req-1");
      await createRefusalAnswer()(context, refusal);
      expect(lines()).toEqual([
        {
          level,
          message: `security.${refusal.guard}.refused`,
          data: { source: "security", guard: refusal.guard, status: refusal.status, reason, routePattern: "/items/:id", requestId: "req-1" },
        },
      ]);
    });
  }

  it("logs a null route pattern and request id when neither was set", async () => {
    const { context, lines } = loggedContext();
    await createRefusalAnswer()(context, { guard: "admin", status: 403 });
    expect(lines()).toEqual([
      {
        level: "warn",
        message: "security.admin.refused",
        data: { source: "security", guard: "admin", status: 403, reason: null, routePattern: null, requestId: null },
      },
    ]);
  });

  it("serialises the cause behind a refusal onto the line as its error", async () => {
    const { context, lines } = loggedContext();
    const cause = new TypeError("limiter offline");
    await createRefusalAnswer()(context, { guard: "rate-limit", status: 503, reason: "binding-failed" }, cause);
    expect(lines()).toEqual([
      {
        level: "error",
        message: "security.rate-limit.refused",
        data: {
          source: "security",
          guard: "rate-limit",
          status: 503,
          reason: "binding-failed",
          routePattern: null,
          requestId: null,
          error: { type: "TypeError", detail: "limiter offline", stack: cause.stack },
        },
      },
    ]);
  });

  it("logs before answering, so a hook that throws still leaves the line", async () => {
    const { context, lines } = loggedContext();
    const answer = createRefusalAnswer(() => {
      throw new Error("hook bug");
    });
    await expect(answer(context, { guard: "admin", status: 403 })).rejects.toThrow("hook bug");
    expect(lines().map(({ message }) => message)).toEqual(["security.admin.refused"]);
  });

  it("writes every identical 403, collapsing only 429s", async () => {
    const answer = createRefusalAnswer();
    const { context, lines } = loggedContext();
    await answer(context, { guard: "origin", status: 403, reason: "missing" });
    await answer(context, { guard: "origin", status: 403, reason: "missing" });
    expect(lines().length).toBe(2);
  });

  it("writes to the console under the security prefix when the request carries no logger", async () => {
    const consoleLog = spyOn(console, "log").mockImplementation(() => {});
    try {
      const context = new RequestContext(new Request("http://localhost/save", { method: "POST" }));
      await createRefusalAnswer()(context, { guard: "csrf", status: 403, reason: "missing-token" });
      const lines = consoleLog.mock.calls.map(([line]) => {
        const { timestamp: _timestamp, ...rest } = JSON.parse(String(line)) as Record<string, unknown>;
        return rest;
      });
      expect(lines).toEqual([
        {
          level: "warn",
          prefix: "security",
          message: "security.csrf.refused",
          guard: "csrf",
          status: 403,
          reason: "missing-token",
          routePattern: null,
          requestId: null,
        },
      ]);
    } finally {
      consoleLog.mockRestore();
    }
  });
});

describe("createRefusalAnswer — a hook that declines", () => {
  const origin: Refusal = { guard: "origin", status: 403, reason: "cross-site" };

  function quietContext() {
    const context = createTestContext(new Request("http://localhost/save", { method: "POST" }));
    requestLog.set(context, captureLogs().logger);
    return context;
  }

  function recording() {
    const seen: string[] = [];
    const declining =
      (by: string): RefuseHook =>
      (_c, refusal) => {
        seen.push(`${by}:${refusal.guard}`);
        return undefined;
      };
    const decliningLater =
      (by: string): RefuseHook =>
      async (_c, refusal) => {
        await Promise.resolve();
        seen.push(`${by}:${refusal.guard}`);
        return undefined;
      };
    const answering =
      (by: string, headers: Record<string, string> = {}): RefuseHook =>
      (_c, refusal) => {
        seen.push(`${by}:${refusal.guard}`);
        return new Response(by, { status: refusal.status, headers });
      };
    return { seen, declining, decliningLater, answering };
  }

  async function outcome(context: ReturnType<typeof quietContext>, res: Response) {
    return {
      status: res.status,
      body: await res.text(),
      own: res.headers.get("Retry-After"),
      queued: mergePendingHeaders(context, res)?.get("Retry-After") ?? null,
    };
  }

  it("passes a refusal its own hook declines to the hook published on the request", async () => {
    const { seen, declining, answering } = recording();
    const context = quietContext();
    refuseHookCtx.set(context, answering("chain"));
    const res = await createRefusalAnswer(declining("own"))(context, origin);
    expect({ ...(await outcome(context, res)), seen }).toEqual({
      status: 403,
      body: "chain",
      own: null,
      queued: null,
      seen: ["own:origin", "chain:origin"],
    });
  });

  it("passes a refusal an async hook resolves undefined for to the hook published on the request", async () => {
    const { seen, decliningLater, answering } = recording();
    const context = quietContext();
    refuseHookCtx.set(context, answering("chain"));
    const res = await createRefusalAnswer(decliningLater("own"))(context, origin);
    expect({ body: await res.text(), seen }).toEqual({ body: "chain", seen: ["own:origin", "chain:origin"] });
  });

  it("answers forge's plain-text default when every hook declines, asking each in order", async () => {
    const { seen, declining, decliningLater } = recording();
    const context = quietContext();
    refuseHookCtx.set(context, decliningLater("chain"));
    const res = await createRefusalAnswer(declining("own"))(context, origin);
    expect({ ...(await outcome(context, res)), seen }).toEqual({
      status: 403,
      body: "Forbidden",
      own: null,
      queued: null,
      seen: ["own:origin", "chain:origin"],
    });
  });

  it("answers forge's plain-text default when its own hook declines and none is published", async () => {
    const { seen, declining } = recording();
    const context = quietContext();
    const res = await createRefusalAnswer(declining("own"))(context, origin);
    expect({ status: res.status, body: await res.text(), seen }).toEqual({ status: 403, body: "Forbidden", seen: ["own:origin"] });
  });

  it("answers forge's plain-text default when the only hook, the published one, declines", async () => {
    const { seen, declining } = recording();
    const context = quietContext();
    refuseHookCtx.set(context, declining("chain"));
    const res = await createRefusalAnswer()(context, origin);
    expect({ status: res.status, body: await res.text(), seen }).toEqual({ status: 403, body: "Forbidden", seen: ["chain:origin"] });
  });

  it("asks a hook that is both its own and the published one only once", async () => {
    const { seen, declining } = recording();
    const hook = declining("both");
    const context = quietContext();
    refuseHookCtx.set(context, hook);
    const res = await createRefusalAnswer(hook)(context, origin);
    expect({ status: res.status, body: await res.text(), seen }).toEqual({ status: 403, body: "Forbidden", seen: ["both:origin"] });
  });

  it("asks a hook composed into its own and published on the request only once, in the composed order", async () => {
    const { seen, declining } = recording();
    const both = declining("both");
    const context = quietContext();
    refuseHookCtx.set(context, both);
    const res = await createRefusalAnswer(composeRefuseHooks(declining("stage"), both))(context, origin);
    expect({ status: res.status, body: await res.text(), seen }).toEqual({ status: 403, body: "Forbidden", seen: ["stage:origin", "both:origin"] });
  });

  it("asks each constituent of a hook composed of composed hooks once, whichever level names it", async () => {
    const { seen, declining, answering } = recording();
    const both = declining("both");
    const context = quietContext();
    refuseHookCtx.set(context, composeRefuseHooks(both, answering("chain")));
    const own = composeRefuseHooks(composeRefuseHooks(declining("stage"), both), both, undefined);
    const res = await createRefusalAnswer(own)(context, origin);
    expect({ body: await res.text(), seen }).toEqual({ body: "chain", seen: ["stage:origin", "both:origin", "chain:origin"] });
  });

  it("answers a composed hook with its first constituent's answer, asking none after it", async () => {
    const { seen, declining, answering } = recording();
    const context = quietContext();
    const res = await createRefusalAnswer(composeRefuseHooks(declining("first"), answering("second"), answering("third")))(context, origin);
    expect({ body: await res.text(), seen }).toEqual({ body: "second", seen: ["first:origin", "second:origin"] });
  });

  it("composes nothing but undefined into a hook that declines, so the refusal falls to forge's default", async () => {
    const context = quietContext();
    const composed = composeRefuseHooks(undefined, undefined);
    const declined = await composed(context, origin);
    const res = await createRefusalAnswer(composed)(context, origin);
    expect({ declined, status: res.status, body: await res.text() }).toEqual({ declined: undefined, status: 403, body: "Forbidden" });
  });

  it("asks a hook listed twice in one composition once", async () => {
    const { seen, declining } = recording();
    const twice = declining("twice");
    const declined = await composeRefuseHooks(twice, undefined, twice)(quietContext(), origin);
    expect({ declined, seen }).toEqual({ declined: undefined, seen: ["twice:origin"] });
  });

  it("asks a single composed hook once when the request publishes it bare", async () => {
    const { seen, declining } = recording();
    const only = declining("only");
    const context = quietContext();
    refuseHookCtx.set(context, only);
    const res = await createRefusalAnswer(composeRefuseHooks(only))(context, origin);
    expect({ status: res.status, body: await res.text(), seen }).toEqual({ status: 403, body: "Forbidden", seen: ["only:origin"] });
  });

  it("asks an answering hook composed into its own and published on the request once, answering with it", async () => {
    const { seen, declining, answering } = recording();
    const both = answering("both");
    const context = quietContext();
    refuseHookCtx.set(context, both);
    const res = await createRefusalAnswer(composeRefuseHooks(declining("stage"), both))(context, origin);
    expect({ status: res.status, body: await res.text(), seen }).toEqual({ status: 403, body: "both", seen: ["stage:origin", "both:origin"] });
  });

  it("asks two distinct plain hooks each once, its own first, when neither is composed", async () => {
    const { seen, declining } = recording();
    const context = quietContext();
    refuseHookCtx.set(context, declining("chain"));
    const res = await createRefusalAnswer(declining("own"))(context, origin);
    expect({ status: res.status, body: await res.text(), seen }).toEqual({ status: 403, body: "Forbidden", seen: ["own:origin", "chain:origin"] });
  });

  it("answers a declined 503 for an absent limiter binding with forge's default and no Retry-After", async () => {
    const { seen, declining } = recording();
    const context = quietContext();
    refuseHookCtx.set(context, declining("chain"));
    const res = await createRefusalAnswer(declining("own"))(context, { guard: "rate-limit", status: 503, reason: "binding-absent" });
    expect({ ...(await outcome(context, res)), seen }).toEqual({
      status: 503,
      body: "Service Unavailable",
      own: null,
      queued: null,
      seen: ["own:rate-limit", "chain:rate-limit"],
    });
  });

  describe("a 429's Retry-After, whichever answers", () => {
    const spent: Refusal = { guard: "rate-limit", status: 429, retryAfter: 45 };

    const cases: Array<{
      name: string;
      own: (r: ReturnType<typeof recording>) => RefuseHook;
      chain: (r: ReturnType<typeof recording>) => RefuseHook | undefined;
      expected: { status: number; body: string; own: string | null; queued: string | null };
    }> = [
      {
        name: "queues it beside forge's default when every hook declines",
        own: (r) => r.declining("own"),
        chain: (r) => r.declining("chain"),
        expected: { status: 429, body: "Too many requests. Please try again later.", own: null, queued: "45" },
      },
      {
        name: "queues it beside forge's default when its own hook declines and none is published",
        own: (r) => r.decliningLater("own"),
        chain: () => undefined,
        expected: { status: 429, body: "Too many requests. Please try again later.", own: null, queued: "45" },
      },
      {
        name: "queues it beside the published hook's answer when its own declines",
        own: (r) => r.declining("own"),
        chain: (r) => r.answering("chain"),
        expected: { status: 429, body: "chain", own: null, queued: "45" },
      },
      {
        name: "keeps the published hook's own Retry-After and queues none over it",
        own: (r) => r.declining("own"),
        chain: (r) => r.answering("chain", { "Retry-After": "7" }),
        expected: { status: 429, body: "chain", own: "7", queued: null },
      },
    ];

    for (const { name, own, chain, expected } of cases) {
      it(name, async () => {
        const r = recording();
        const context = quietContext();
        const published = chain(r);
        if (published !== undefined) refuseHookCtx.set(context, published);
        const res = await createRefusalAnswer(own(r))(context, spent);
        expect(await outcome(context, res)).toEqual(expected);
      });
    }
  });

  describe("a hook that throws", () => {
    it("rejects with the published hook's error after its own declined", async () => {
      const { seen, declining } = recording();
      const context = quietContext();
      refuseHookCtx.set(context, () => {
        throw new Error("chain hook bug");
      });
      await expect(createRefusalAnswer(declining("own"))(context, origin)).rejects.toThrow("chain hook bug");
      expect(seen).toEqual(["own:origin"]);
    });

    it("rejects with its own hook's error and never asks the published one", async () => {
      const { seen, answering } = recording();
      const context = quietContext();
      refuseHookCtx.set(context, answering("chain"));
      const answer = createRefusalAnswer(async () => {
        throw new Error("own hook bug");
      });
      await expect(answer(context, origin)).rejects.toThrow("own hook bug");
      expect(seen).toEqual([]);
    });
  });

  it("writes the refusal line once, however many hooks decline", async () => {
    const capture = captureLogs();
    const context = createTestContext(new Request("http://localhost/save", { method: "POST" }));
    requestLog.set(context, capture.logger);
    const { declining } = recording();
    refuseHookCtx.set(context, declining("chain"));
    await createRefusalAnswer(declining("own"))(context, origin);
    expect(capture.records.map(({ message }) => message)).toEqual(["security.origin.refused"]);
  });

  it("types a hook returning undefined as a RefuseHook, and refuses one returning null", async () => {
    const c = getAppContext(quietContext());
    const declines: RefuseHook = () => undefined;
    const declinesLater: RefuseHook = async () => undefined;
    // @ts-expect-error — `undefined` is the only decline; `null` is not a sentinel
    const nulled: RefuseHook = () => null;
    expect([declines(c, origin), await declinesLater(c, origin), nulled(c, origin)]).toEqual([undefined, undefined, null]);
  });
});
