import { describe, expect, it } from "bun:test";

import { mapHandler } from "../testing/route";
import { Forge } from "./forge-app";
import { applyMiddlewareChain } from "./middleware-chain";

function notesApp(methods: readonly string[] | undefined) {
  const reached: string[] = [];
  const app = new Forge();
  applyMiddlewareChain(app, {
    securityHeaders: {},
    contributions: [{ bindings: [{ name: "LIMITER", methods: ["limit"], label: "a rate-limit binding", optional: true }] }],
    rateLimits: { LIMITER: { limit: 10, period: 60 } },
    guards: [{ paths: ["/notes"], rateLimit: { binding: "LIMITER", key: () => "client-1", ...(methods ? { methods } : {}) } }],
  });
  mapHandler(app, "GET", "/notes", () => (reached.push("GET"), new Response("read")));
  mapHandler(app, "POST", "/notes", () => (reached.push("POST"), new Response("written")));
  const answer = async (method: string) => {
    const res = await app.request("/notes", { method }, {});
    return { status: res.status, body: await res.text() };
  };
  return { answer, reached };
}

describe("applyMiddlewareChain — a group rateLimit on an absent optional BindingSpec", () => {
  it('serves a GET and refuses a POST 503 under methods ["POST"]', async () => {
    const { answer, reached } = notesApp(["POST"]);
    expect({ get: await answer("GET"), post: await answer("POST"), reached }).toEqual({
      get: { status: 200, body: "read" },
      post: { status: 503, body: "Service Unavailable" },
      reached: ["GET"],
    });
  });

  it("refuses a GET and a POST 503 when no methods are given", async () => {
    const { answer, reached } = notesApp(undefined);
    expect({ get: await answer("GET"), post: await answer("POST"), reached }).toEqual({
      get: { status: 503, body: "Service Unavailable" },
      post: { status: 503, body: "Service Unavailable" },
      reached: [],
    });
  });
});
