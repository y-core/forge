import { describe, expect, it, spyOn } from "bun:test";

import type { Refusal, RefuseHook } from "../context/types";
import type { RateLimit } from "../security/types";
import { mapHandler } from "../testing/route";
import { Forge } from "./forge-app";
import { applyMiddlewareChain } from "./middleware-chain";

const CROSS_SITE = { method: "POST", headers: { origin: "https://evil.example.com", "sec-fetch-site": "cross-site" } };

function recording() {
  const seen: Array<{ by: string; refusal: Refusal }> = [];
  const answering =
    (by: string): RefuseHook =>
    (_c, refusal) => {
      seen.push({ by, refusal });
      return new Response(by, { status: refusal.status });
    };
  const declining =
    (by: string): RefuseHook =>
    async (_c, refusal) => {
      seen.push({ by, refusal });
      return undefined;
    };
  return { seen, answering, declining };
}

function staffApp(stage: RefuseHook, group: RefuseHook | undefined, chain: RefuseHook | undefined): Forge {
  const app = new Forge();
  applyMiddlewareChain(app, {
    securityHeaders: {},
    ...(chain === undefined ? {} : { onRefuse: chain }),
    guards: [
      {
        paths: ["/staff/*"],
        origin: { allowedOrigins: ["http://localhost"], onRefuse: stage },
        ...(group === undefined ? {} : { onRefuse: group }),
      },
    ],
  });
  mapHandler(app, "POST", "/staff/save", () => new Response("saved"));
  return app;
}

describe("a guard group stage's own onRefuse that declines", () => {
  it("falls to the group's onRefuse, which answers", async () => {
    const { seen, answering, declining } = recording();
    const res = await staffApp(declining("stage"), answering("group"), answering("chain")).request("/staff/save", CROSS_SITE);

    const refusal: Refusal = { guard: "origin", status: 403, reason: "cross-site" };
    expect({ status: res.status, body: await res.text(), seen }).toEqual({
      status: 403,
      body: "group",
      seen: [
        { by: "stage", refusal },
        { by: "group", refusal },
      ],
    });
  });

  it("falls past a declining group hook to the chain's, and past every hook to forge's default", async () => {
    const chained = recording();
    const toChain = await staffApp(chained.declining("stage"), chained.declining("group"), chained.answering("chain")).request(
      "/staff/save",
      CROSS_SITE,
    );
    const unhooked = recording();
    const toDefault = await staffApp(unhooked.declining("stage"), unhooked.declining("group"), undefined).request("/staff/save", CROSS_SITE);

    expect({
      chain: { status: toChain.status, body: await toChain.text(), seen: chained.seen.map(({ by }) => by) },
      fallback: { status: toDefault.status, body: await toDefault.text(), seen: unhooked.seen.map(({ by }) => by) },
    }).toEqual({
      chain: { status: 403, body: "chain", seen: ["stage", "group", "chain"] },
      fallback: { status: 403, body: "Forbidden", seen: ["stage", "group"] },
    });
  });

  it("is never followed by the group's hook when it answers", async () => {
    const { seen, answering } = recording();
    const res = await staffApp(answering("stage"), answering("group"), undefined).request("/staff/save", CROSS_SITE);

    expect({ body: await res.text(), seen: seen.map(({ by }) => by) }).toEqual({ body: "stage", seen: ["stage"] });
  });
});

function limitedStaffApp(stage: RefuseHook, group: RefuseHook | undefined, chain: RefuseHook | undefined): Forge {
  const app = new Forge();
  applyMiddlewareChain(app, {
    securityHeaders: {},
    rateLimits: { STAFF_LIMIT: { limit: 5, period: 30 } },
    contributions: [{ bindings: [{ name: "STAFF_LIMIT", methods: ["limit"], label: "the staff rate limit", optional: true }] }],
    ...(chain === undefined ? {} : { onRefuse: chain }),
    guards: [
      {
        paths: ["/staff/*"],
        rateLimit: { binding: "STAFF_LIMIT", key: () => "staff", onRefuse: stage },
        ...(group === undefined ? {} : { onRefuse: group }),
      },
    ],
  });
  mapHandler(app, "POST", "/staff/save", () => new Response("saved"));
  return app;
}

const SPENT = { STAFF_LIMIT: { limit: async () => ({ success: false }) } satisfies RateLimit };

async function answerOf(res: Response) {
  return { status: res.status, body: await res.text(), retryAfter: res.headers.get("retry-after") };
}

describe("a guard group's rate-limit refusal every stage and group hook declines", () => {
  it("keeps Retry-After from the limit's period beside the chain hook's answer", async () => {
    const { seen, declining, answering } = recording();
    const res = await limitedStaffApp(declining("stage"), declining("group"), answering("chain")).request("/staff/save", { method: "POST" }, SPENT);

    expect({ ...(await answerOf(res)), seen: seen.map(({ by }) => by) }).toEqual({
      status: 429,
      body: "chain",
      retryAfter: "30",
      seen: ["stage", "group", "chain"],
    });
  });

  it("keeps Retry-After from the limit's period beside forge's default when the chain hook declines too", async () => {
    const { seen, declining } = recording();
    const res = await limitedStaffApp(declining("stage"), declining("group"), declining("chain")).request("/staff/save", { method: "POST" }, SPENT);

    expect({ ...(await answerOf(res)), seen: seen.map(({ by }) => by) }).toEqual({
      status: 429,
      body: "Too many requests. Please try again later.",
      retryAfter: "30",
      seen: ["stage", "group", "chain"],
    });
  });

  it("keeps the Retry-After the answering chain hook set itself", async () => {
    const { declining } = recording();
    const chain: RefuseHook = (_c, refusal) => new Response("chain", { status: refusal.status, headers: { "Retry-After": "120" } });
    const res = await limitedStaffApp(declining("stage"), declining("group"), chain).request("/staff/save", { method: "POST" }, SPENT);

    expect(await answerOf(res)).toEqual({ status: 429, body: "chain", retryAfter: "120" });
  });

  it("answers a 503 for an absent limiter binding with forge's default and no Retry-After", async () => {
    const { seen, declining } = recording();
    const res = await limitedStaffApp(declining("stage"), declining("group"), declining("chain")).request("/staff/save", { method: "POST" });

    expect({ ...(await answerOf(res)), seen }).toEqual({
      status: 503,
      body: "Service Unavailable",
      retryAfter: null,
      seen: ["stage", "group", "chain"].map((by) => ({ by, refusal: { guard: "rate-limit", status: 503, reason: "binding-absent" } })),
    });
  });
});

describe("a guard group stage's own onRefuse that throws", () => {
  it("reaches the app's error handler without asking the group's or the chain's hook", async () => {
    const { seen, answering } = recording();
    const app = staffApp(
      async () => {
        throw new Error("stage hook bug");
      },
      answering("group"),
      answering("chain"),
    );
    const caught: string[] = [];
    app.setOnError((error) => (caught.push(error.message), new Response("boundary", { status: 500 })));

    const res = await app.request("/staff/save", CROSS_SITE);

    expect({ status: res.status, body: await res.text(), caught, seen }).toEqual({
      status: 500,
      body: "boundary",
      caught: ["stage hook bug"],
      seen: [],
    });
  });
});

describe("the refusal line under declining hooks", () => {
  it("is written once for a refusal the stage, group and chain hooks all decline", async () => {
    const consoleLog = spyOn(console, "log").mockImplementation(() => {});
    try {
      const { declining } = recording();
      const res = await staffApp(declining("stage"), declining("group"), declining("chain")).request("/staff/save", CROSS_SITE);
      const refusedLines = consoleLog.mock.calls
        .map(([line]) => (JSON.parse(String(line)) as { message: string }).message)
        .filter((message) => message.endsWith(".refused"));

      expect({ status: res.status, refusedLines }).toEqual({ status: 403, refusedLines: ["security.origin.refused"] });
    } finally {
      consoleLog.mockRestore();
    }
  });
});
