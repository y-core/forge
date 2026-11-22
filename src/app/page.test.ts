import { describe, expect, it, mock } from "bun:test";

import { requireFreshStepUp } from "../auth/web/guards";
import { importKeyRing } from "../crypto/keyring/ring";
import { CSRF_FIELD_DEFAULT } from "../form/constants";
import { createCsrfToken, csrfMintStage } from "../form/csrf";
import { escapeHtml } from "../html/escape";
import { requestLog } from "../logging/request-logger";
import { ok } from "../result/result";
import { get, post, put, Route } from "../router/mod";
import { rateLimit } from "../security/rate-limit";
import type { RateLimit } from "../security/types";
import { mockExecutionContext } from "../testing/context";
import { captureLogs } from "../testing/logs";
import { mapHandler } from "../testing/route";
import type { CapturedLogs, TestAction } from "../testing/types";
import { v } from "../validation/validation";
import { Forge } from "./forge-app";
import { createHandlerFactory } from "./handler-factory";
import { buildGuardChain } from "./middleware-chain";
import type { BotRejection } from "./types";

const { definePage, defineAction } = createHandlerFactory();
const PAGE_ROUTE = get("/test");
const ACTION_ROUTE = post("/action");
const ANY_PAGE_ROUTE = new Route("ANY", "/test");

function capturedForge(capture?: CapturedLogs): Forge {
  const app = new Forge(capture?.logger);
  if (capture) {
    app.use("*", (context, next) => {
      requestLog.set(context, capture.logger);
      return next();
    });
  }
  return app;
}

function makeApp(handler: TestAction<"/test">, capture?: CapturedLogs) {
  const app = capturedForge(capture);
  mapHandler(app, "GET", "/test", handler);
  return app;
}

const FORM_HEADERS = { "content-type": "application/x-www-form-urlencoded" };

type Requestable = { request(path: string, init: RequestInit): Promise<Response> };

function submit(app: Requestable, body: string, path = "/test"): Promise<Response> {
  return app.request(path, { method: "POST", headers: FORM_HEADERS, body });
}

const TURNSTILE_OPTIONS = { secretKey: () => "test-secret", verify: () => ({ expectedHostname: "localhost" }) };

const NameSchema = v.strictObject({ name: v.pipe(v.string(), v.minLength(1, "Name required.")) });

function refusal(...fields: readonly string[]): string {
  const items = fields.map((field) => `<li>${field}</li>`).join("");
  return `<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground" data-announce-failure="Please correct the following fields."><p>Please correct the following fields.</p><ul class="mt-2 list-disc ps-5">${items}</ul></div>`;
}

const APP_BOUNDARY_500 = "<!DOCTYPE html><html><body><h1>500 Internal Server Error</h1><p>An unexpected error occurred.</p></body></html>";

const ACTION_500_FRAGMENT =
  '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground" data-announce-failure="Something went wrong. Please try again."><p>Something went wrong. Please try again.</p></div>';

describe("definePage", () => {
  it("renders the view with loader data", async () => {
    const app = makeApp(
      definePage(PAGE_ROUTE, {
        loader: () => ({ message: "hello" }),
        view: (_c, _config, state) => new Response((state.data as { message: string }).message),
      }),
    );

    const res = await app.request("/test");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  it("sets cache-control: no-store when cache is 'no-store'", async () => {
    const app = makeApp(definePage(PAGE_ROUTE, { cache: "no-store", view: () => new Response("ok") }));

    const res = await app.request("/test");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("defaults an unscoped cache directive to private, not public", async () => {
    const app = makeApp(definePage(PAGE_ROUTE, { cache: { maxAge: 3600 }, view: () => new Response("ok") }));

    const res = await app.request("/test");
    expect(res.headers.get("cache-control")).toBe("private, max-age=3600");
  });

  it("sets a public cache header when the page asks for edge caching explicitly", async () => {
    const app = makeApp(definePage(PAGE_ROUTE, { cache: { maxAge: 3600, scope: "public" }, view: () => new Response("ok") }));

    const res = await app.request("/test");
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
  });

  it("sets private cache header when scope is private", async () => {
    const app = makeApp(definePage(PAGE_ROUTE, { cache: { maxAge: 60, scope: "private" }, view: () => new Response("ok") }));

    const res = await app.request("/test");
    expect(res.headers.get("cache-control")).toBe("private, max-age=60");
  });

  it("leaves a response that states its own cache-control alone", async () => {
    const app = makeApp(
      definePage(PAGE_ROUTE, {
        cache: { maxAge: 300 },
        loader: () => new Response("refused", { status: 403, headers: { "cache-control": "no-store" } }),
        view: () => new Response("ok"),
      }),
    );

    const res = await app.request("/test");
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("applies the page cache to a response that states none", async () => {
    const app = makeApp(
      definePage(PAGE_ROUTE, { cache: { maxAge: 300 }, loader: () => new Response("moved", { status: 302 }), view: () => new Response("ok") }),
    );

    const res = await app.request("/test");
    expect(res.status).toBe(302);
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
  });

  it("lets `headers` override a response's own cache-control", async () => {
    const app = makeApp(
      definePage(PAGE_ROUTE, {
        cache: { maxAge: 300 },
        headers: { "cache-control": "private, max-age=10" },
        loader: () => new Response("refused", { status: 403, headers: { "cache-control": "no-store" } }),
        view: () => new Response("ok"),
      }),
    );

    const res = await app.request("/test");
    expect(res.headers.get("cache-control")).toBe("private, max-age=10");
  });

  it("refuses a pipeline option stated without a schema", () => {
    expect(() => definePage(PAGE_ROUTE, { turnstile: TURNSTILE_OPTIONS, view: () => new Response("ok") } as never)).toThrow(
      "definePage: `turnstile` requires `schema` — a submission-pipeline option without a schema is ignored.",
    );
    expect(() => definePage(PAGE_ROUTE, { turnstile: TURNSTILE_OPTIONS, maxBytes: 1024, view: () => new Response("ok") } as never)).toThrow(
      "definePage: `turnstile`, `maxBytes` require `schema` — submission-pipeline options without a schema are ignored.",
    );
  });

  it("refuses a rate limit stated without a schema, naming it", () => {
    expect(() => definePage(PAGE_ROUTE, { rateLimit: { binding: "LIMITER", key: () => "k" }, view: () => new Response("ok") } as never)).toThrow(
      "definePage: `rateLimit` requires `schema` — a submission-pipeline option without a schema is ignored.",
    );
  });

  it("refuses a pipeline option stated without a schema at the type level", () => {
    // @ts-expect-error -- `turnstile` is only assignable on the arm that also states `schema`
    expect(() => definePage(PAGE_ROUTE, { turnstile: TURNSTILE_OPTIONS, view: () => new Response("ok") })).toThrow();
  });

  it("sets custom headers", async () => {
    const app = makeApp(definePage(PAGE_ROUTE, { headers: { "x-custom": "value" }, view: () => new Response("ok") }));

    const res = await app.request("/test");
    expect(res.headers.get("x-custom")).toBe("value");
  });

  it("calls onError when the view throws", async () => {
    const app = makeApp(
      definePage(PAGE_ROUTE, {
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
      definePage(PAGE_ROUTE, {
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
      definePage(PAGE_ROUTE, {
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
      definePage(PAGE_ROUTE, {
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
      definePage(PAGE_ROUTE, {
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
      definePage(PAGE_ROUTE, {
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

  it("answers OPTIONS and TRACE with a 405 naming the methods it serves, running neither the action nor the loader", async () => {
    const action = mock(() => "should not run");
    const loader = mock(() => ({ message: "should not run" }));
    const app = new Forge();
    mapHandler(app, "ANY", "/test", definePage(ANY_PAGE_ROUTE, { action, loader, view: () => new Response("rendered") }));

    for (const method of ["OPTIONS", "TRACE"]) {
      const res = await app.request("/test", { method });
      expect({ method, status: res.status, allow: res.headers.get("allow") }).toEqual({
        method,
        status: 405,
        allow: "GET, HEAD, POST, PUT, PATCH, DELETE",
      });
    }
    expect(action).not.toHaveBeenCalled();
    expect(loader).not.toHaveBeenCalled();
  });

  it("answers its 405 exactly as the app answers a method mismatch, ignoring the page's own cache and headers", async () => {
    const app = new Forge();
    mapHandler(
      app,
      "ANY",
      "/test",
      definePage(ANY_PAGE_ROUTE, { cache: { maxAge: 60, scope: "public" }, headers: { "x-page": "yes" }, view: () => new Response("rendered") }),
    );

    const res = await app.request("/test", { method: "OPTIONS" });
    expect(Object.fromEntries(res.headers)).toEqual({
      allow: "GET, HEAD, POST, PUT, PATCH, DELETE",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
      "referrer-policy": "no-referrer",
    });
    expect(await res.text()).toBe("Method Not Allowed");
  });

  it("names only the route's own method in Allow when the page was defined for one", async () => {
    const allowOn = async (page: TestAction<"/test">) => {
      const app = new Forge();
      mapHandler(app, "ANY", "/test", page);
      return (await app.request("/test", { method: "OPTIONS" })).headers.get("allow");
    };
    const view = () => new Response("rendered");

    expect(await allowOn(definePage(PAGE_ROUTE, { view }))).toBe("GET, HEAD");
    expect(await allowOn(definePage(put("/test"), { view }))).toBe("PUT");
  });

  it("sends a throwing action through the same boundary as a throwing view", async () => {
    const app = new Forge();
    mapHandler(
      app,
      "POST",
      "/boundary",
      definePage(PAGE_ROUTE, {
        action: () => {
          throw new Error("action failed");
        },
        view: () => new Response("unreachable"),
      }),
    );

    const res = await app.request("/boundary", { method: "POST" });
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(APP_BOUNDARY_500);
  });

  it("calls onError when the action throws", async () => {
    const app = new Forge();
    mapHandler(
      app,
      "POST",
      "/test",
      definePage(PAGE_ROUTE, {
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
      handler: definePage(PAGE_ROUTE, {
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

describe("definePage — the schema pipeline", () => {
  it("renders exactly this refusal, which is the literal every other case here is asserted against", () => {
    expect(refusal("name")).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground" data-announce-failure="Please correct the following fields."><p>Please correct the following fields.</p><ul class="mt-2 list-disc ps-5"><li>name</li></ul></div>',
    );
  });

  it("refuses an invalid body with the 422 fragment and reaches neither the action, the loader nor the view", async () => {
    const calls: string[] = [];
    const app = new Forge();
    mapHandler(
      app,
      "POST",
      "/test",
      definePage(PAGE_ROUTE, {
        schema: NameSchema,
        action: () => {
          calls.push("action");
          return { saved: true };
        },
        loader: () => {
          calls.push("loader");
          return { count: 1 };
        },
        view: () => {
          calls.push("view");
          return new Response("rendered");
        },
      }),
    );

    const res = await submit(app, "name=");
    expect(res.status).toBe(422);
    expect(await res.text()).toBe(refusal("name"));
    expect(calls).toEqual([]);
  });

  it("hands the parsed body to the action as its third argument, then runs the loader and the view", async () => {
    const Schema = v.strictObject({ name: v.string(), phone: v.optional(v.string()) });
    const calls: string[] = [];
    let firstArgIsTheContext = false;
    let received: unknown;
    const app = new Forge();
    mapHandler(
      app,
      "POST",
      "/test",
      definePage(PAGE_ROUTE, {
        schema: Schema,
        action: (c, _config, data) => {
          calls.push("action");
          firstArgIsTheContext = c.request.method === "POST";
          received = data;
          return { saved: data.name };
        },
        loader: () => {
          calls.push("loader");
          return { count: 1 };
        },
        view: (_c, _config, state) => {
          calls.push("view");
          return Response.json({ actionData: state.actionData, data: state.data, method: state.method });
        },
      }),
    );

    const res = await submit(app, "name=Jane");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ actionData: { saved: "Jane" }, data: { count: 1 }, method: "POST" });
    expect(calls).toEqual(["action", "loader", "view"]);
    expect(firstArgIsTheContext).toBe(true);
    expect(received).toEqual({ name: "Jane" });
    expect("phone" in (received as object)).toBe(false);
  });

  it("leaves a schema-less page exactly as it was — no third argument, and the body still unread", async () => {
    let thirdArg: unknown = "never assigned";
    let bodyUsedAtEntry: boolean | undefined;
    let readByAction: string | null = null;
    const app = new Forge();
    mapHandler(
      app,
      "POST",
      "/test",
      definePage(PAGE_ROUTE, {
        action: async (c, _config, data) => {
          thirdArg = data;
          bodyUsedAtEntry = c.request.bodyUsed;
          const form = await c.request.formData();
          readByAction = String(form.get("name"));
          return { echoed: readByAction };
        },
        view: (_c, _config, state) => Response.json({ actionData: state.actionData }),
      }),
    );

    const res = await submit(app, "name=Jane");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ actionData: { echoed: "Jane" } });
    expect(thirdArg).toBeUndefined();
    expect(bodyUsedAtEntry).toBe(false);
    expect(readByAction).toBe("Jane");
  });

  it("keeps a schema-less page's action reachable with a body a schema would have refused", async () => {
    const app = new Forge();
    mapHandler(
      app,
      "POST",
      "/test",
      definePage(PAGE_ROUTE, { action: () => "ran", view: (_c, _config, state) => new Response(String(state.actionData)) }),
    );

    const res = await submit(app, "name=&nobody_asked=1");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ran");
  });

  it("never runs the pipeline on a GET, so a bodiless request still renders", async () => {
    const calls: string[] = [];
    const app = makeApp(
      definePage(PAGE_ROUTE, {
        schema: NameSchema,
        action: () => {
          calls.push("action");
          return "should not run";
        },
        view: (_c, _config, state) => new Response(`rendered:${state.method}:${String(state.actionData)}`),
      }),
    );

    const res = await app.request("/test");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("rendered:GET:undefined");
    expect(calls).toEqual([]);
  });

  it("never runs the pipeline when the page declares a schema but no action", async () => {
    const app = new Forge();
    mapHandler(
      app,
      "POST",
      "/test",
      definePage(PAGE_ROUTE, { schema: NameSchema, view: (_c, _config, state) => new Response(`rendered:${state.method}`) }),
    );

    const res = await submit(app, "name=");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("rendered:POST");
  });
});

describe("definePage — a refusal carries the page's own headers", () => {
  const CACHE = "no-store" as const;
  const HEADERS = { "x-page": "value" };

  function headeredApp(calls: string[]) {
    const app = new Forge();
    mapHandler(
      app,
      "POST",
      "/test",
      definePage(PAGE_ROUTE, {
        cache: CACHE,
        headers: HEADERS,
        schema: NameSchema,
        action: () => {
          calls.push("action");
          return "ran";
        },
        view: () => new Response("rendered"),
      }),
    );
    return app;
  }

  it("carries them on the 422 a refused schema produces", async () => {
    const calls: string[] = [];
    const res = await submit(headeredApp(calls), "name=");

    expect(res.status).toBe(422);
    expect(await res.text()).toBe(refusal("name"));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-page")).toBe("value");
    expect(calls).toEqual([]);
  });

  it("carries them on the 413 an oversized body produces", async () => {
    const calls: string[] = [];
    // 100 KB default cap; this body is ~200 KB.
    const res = await submit(headeredApp(calls), `name=${"x".repeat(200_000)}`);

    expect(res.status).toBe(413);
    expect(await res.text()).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground" data-announce-failure="The submitted form is too large. Please reduce its size and try again."><p>The submitted form is too large. Please reduce its size and try again.</p></div>',
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-page")).toBe("value");
    expect(calls).toEqual([]);
  });

  it("carries them on the 400 an unparseable body produces", async () => {
    const calls: string[] = [];
    const res = await headeredApp(calls).request("/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Jane" }),
    });

    expect(res.status).toBe(400);
    expect(await res.text()).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground" data-announce-failure="Unable to process the form data. Please try again."><p>Unable to process the form data. Please try again.</p></div>',
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-page")).toBe("value");
    expect(calls).toEqual([]);
  });

  it("renders the view normally when the body passes, with the same headers", async () => {
    const calls: string[] = [];
    const res = await submit(headeredApp(calls), "name=Jane");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("rendered");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(calls).toEqual(["action"]);
  });
});

describe("definePage — the submission sequence's options are the page's own", () => {
  const MessageSchema = v.strictObject({ message: v.pipe(v.string(), v.minLength(1, "Tell us what you'd like & we'll reply.")) });

  function renderForm(errors: readonly string[]): Response {
    const items = errors.map((message) => `<li>${escapeHtml(message)}</li>`).join("");
    return new Response(`<main><h1>Contact</h1><form method="post"><ul>${items}</ul></form></main>`, {
      status: errors.length === 0 ? 200 : 422,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  it("re-renders the page's own view with its field errors instead of the default fragment", async () => {
    const calls: string[] = [];
    let methodAtRefusal: string | undefined;
    const app = new Forge();
    mapHandler(
      app,
      "POST",
      "/test",
      definePage(PAGE_ROUTE, {
        schema: MessageSchema,
        onValidationError: (issues, c) => {
          methodAtRefusal = c.request.method;
          return renderForm(issues.map((issue) => issue.message));
        },
        action: () => {
          calls.push("action");
          return "saved";
        },
        view: () => {
          calls.push("view");
          return renderForm([]);
        },
      }),
    );

    const res = await submit(app, "message=");
    expect(res.status).toBe(422);
    expect(await res.text()).toBe(
      '<main><h1>Contact</h1><form method="post"><ul><li>Tell us what you&#39;d like &amp; we&#39;ll reply.</li></ul></form></main>',
    );
    expect(calls).toEqual([]);
    expect(methodAtRefusal).toBe("POST");
  });

  it("hands the page's onBotDetected the rejection instead of rendering the refusal", async () => {
    const calls: string[] = [];
    let rejection: BotRejection | undefined;
    const app = new Forge();
    mapHandler(
      app,
      "POST",
      "/test",
      definePage(PAGE_ROUTE, {
        schema: NameSchema,
        turnstile: TURNSTILE_OPTIONS,
        onBotDetected: (received) => {
          rejection = received;
          return new Response("go away", { status: 403 });
        },
        action: (_c, _config, data) => {
          calls.push("action");
          return Object.keys(data).join(",");
        },
        view: (_c, _config, state) => new Response(String(state.actionData)),
      }),
    );

    const res = await submit(app, "name=Jane");
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("go away");
    expect(rejection).toEqual({ guard: "turnstile", reason: "missing-token" });
    expect(calls).toEqual([]);
  });

  it("accepts a body over the default cap when the page raises maxBytes", async () => {
    const app = new Forge();
    mapHandler(
      app,
      "POST",
      "/test",
      definePage(PAGE_ROUTE, {
        maxBytes: 300 * 1024,
        schema: NameSchema,
        action: (_c, _config, data) => String(data.name.length),
        view: (_c, _config, state) => new Response(String(state.actionData)),
      }),
    );

    // ~200 KB, twice the default cap: a 200 here is only reachable through the page's own limit.
    const res = await submit(app, `name=${"x".repeat(200_000)}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("200000");
  });

  it("refuses a body over a cap the page lowered, well under the default", async () => {
    const calls: string[] = [];
    const app = new Forge();
    mapHandler(
      app,
      "POST",
      "/test",
      definePage(PAGE_ROUTE, {
        maxBytes: 1024,
        schema: NameSchema,
        action: () => {
          calls.push("action");
          return "ran";
        },
        view: () => new Response("rendered"),
      }),
    );

    // ~2 KB — under the default cap and over this page's, so the 413 can only come from the page's own.
    const res = await submit(app, `name=${"x".repeat(2000)}`);
    expect(res.status).toBe(413);
    expect(await res.text()).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground" data-announce-failure="The submitted form is too large. Please reduce its size and try again."><p>The submitted form is too large. Please reduce its size and try again.</p></div>',
    );
    expect(calls).toEqual([]);
  });
});

describe("definePage — the CSRF field the guard consumed", () => {
  const SECRET = "9c55dd3f0812c671dc6d905ab7941deebb36feefbbfe4ba28bd37ae08287a9cf";
  const KeysSchema = v.strictObject({ name: v.string() });

  function keysPage() {
    return definePage(PAGE_ROUTE, {
      schema: KeysSchema,
      action: (_c, _config, data) => Object.keys(data).join(","),
      view: (_c, _config, state) => new Response(String(state.actionData)),
    });
  }

  it("drops the token field on the page path, so a v.strictObject that never declares it passes", async () => {
    const ring = await importKeyRing([SECRET]);
    const app = new Forge();
    app.use("/guarded", csrfMintStage({ ring: () => ring, subject: false }));
    mapHandler(app, "POST", "/guarded", keysPage());
    const token = await createCsrfToken(ring, "/guarded");

    const res = await submit(app, `${CSRF_FIELD_DEFAULT}=${token}&name=Jane`, "/guarded");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("name");
  });

  it("refuses _csrf as the undeclared field it is when no CSRF middleware ran", async () => {
    const app = new Forge();
    mapHandler(app, "POST", "/unguarded", keysPage());

    const res = await submit(app, `name=Jane&${CSRF_FIELD_DEFAULT}=whatever`, "/unguarded");
    expect(res.status).toBe(422);
    expect(await res.text()).toBe(refusal(CSRF_FIELD_DEFAULT));
  });
});

describe("definePage — a safe method behind the mutation guards", () => {
  const SECRET = "9c55dd3f0812c671dc6d905ab7941deebb36feefbbfe4ba28bd37ae08287a9cf";

  it("answers OPTIONS with a valid CSRF token 405 behind originProtection and requireFreshStepUp, and never runs the action", async () => {
    const ring = await importKeyRing([SECRET]);
    const action = mock(() => "mutated");
    const app = new Forge();
    app.use(
      "/guarded",
      csrfMintStage({ ring: () => ring, subject: false }),
      ...buildGuardChain({ paths: ["/guarded"], origin: { allowedOrigins: ["http://localhost"] } }),
    );
    mapHandler(app, "ANY", "/guarded", {
      middleware: [
        requireFreshStepUp({
          factors: () => ({ resolve: () => Promise.resolve(ok({ status: "satisfied" as const })) }),
          enrolmentPaths: { kinds: {} },
          stepUpPath: "/auth/verify",
          settledPath: "/account",
        }),
      ],
      handler: definePage(new Route("ANY", "/guarded"), { action, view: () => new Response("rendered") }),
    });
    const token = await createCsrfToken(ring, "/guarded");

    const res = await app.request("/guarded", { method: "OPTIONS", headers: { "X-CSRF-Token": token } });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD, POST, PUT, PATCH, DELETE");
    expect(action).not.toHaveBeenCalled();
  });
});

describe("definePage — a throwing schema", () => {
  const ThrowingCheck = v.strictObject({
    name: v.pipe(
      v.string(),
      v.check<string>(() => {
        throw new Error("check exploded");
      }),
    ),
  });

  function throwingPage(calls: string[], onError?: () => Response, capture?: CapturedLogs) {
    const app = capturedForge(capture);
    mapHandler(
      app,
      "POST",
      "/test",
      definePage(PAGE_ROUTE, {
        schema: ThrowingCheck,
        action: () => {
          calls.push("action");
          return "ran";
        },
        view: () => {
          calls.push("view");
          return new Response("rendered");
        },
        ...(onError ? { onError } : {}),
      }),
    );
    return app;
  }

  it("rethrows to the app boundary rather than answering defineAction's 500 fragment", async () => {
    const calls: string[] = [];
    const res = await submit(throwingPage(calls), "name=Jane");

    expect(res.status).toBe(500);
    expect(await res.text()).toBe(APP_BOUNDARY_500);
    expect(calls).toEqual([]);
  });

  it("hands the schema's own error to def.onError when one is supplied", async () => {
    let captured: Error | undefined;
    const calls: string[] = [];
    const app = new Forge();
    mapHandler(
      app,
      "POST",
      "/test",
      definePage(PAGE_ROUTE, {
        schema: ThrowingCheck,
        action: () => {
          calls.push("action");
          return "ran";
        },
        view: () => new Response("rendered"),
        onError: (error) => {
          captured = error;
          return new Response("page error", { status: 500 });
        },
      }),
    );

    const res = await submit(app, "name=Jane");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("page error");
    expect(captured?.message).toBe("check exploded");
    expect(calls).toEqual([]);
  });

  it("leaves the record to the boundary and never logs it as an action's", async () => {
    const calls: string[] = [];
    const capture = captureLogs();
    await submit(throwingPage(calls, undefined, capture), "name=Jane");

    const messages = capture.records.map((record) => record.message);
    expect(messages).toContain("Unhandled error");
    expect(messages).not.toContain("Page handler threw");
    expect(messages).not.toContain("Action threw");
  });

  it("answers one and the same throwing schema differently on each builder, on purpose", async () => {
    const pageApp = new Forge();
    mapHandler(
      pageApp,
      "POST",
      "/page",
      definePage(PAGE_ROUTE, { schema: ThrowingCheck, action: () => "ran", view: () => new Response("rendered") }),
    );
    const actionApp = new Forge();
    mapHandler(actionApp, "POST", "/action", defineAction(ACTION_ROUTE, { schema: ThrowingCheck, handle: () => new Response("handled") }));

    const page = await submit(pageApp, "name=Jane", "/page");
    const action = await submit(actionApp, "name=Jane", "/action");

    expect(page.status).toBe(500);
    expect(action.status).toBe(500);
    expect(await page.text()).toBe(APP_BOUNDARY_500);
    expect(await action.text()).toBe(ACTION_500_FRAGMENT);
  });
});

describe("definePage — the query schema", () => {
  const PageQuery = v.strictObject({ page: v.pipe(v.string(), v.digits(), v.transform(Number)) });

  it("hands the loader the parsed query, typed as the schema's output", async () => {
    const seen: number[] = [];
    const app = makeApp(
      definePage(PAGE_ROUTE, {
        query: PageQuery,
        loader: (_c, _config, query) => {
          const page: number = query.page;
          seen.push(page);
          return { page };
        },
        view: (_c, _config, state) => new Response(String(state.data.page + 1)),
      }),
    );

    const res = await app.request("/test?page=2");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("3");
    expect(seen).toEqual([2]);
  });

  it("answers 400 naming the field, under the page's headers, and runs neither loader nor view", async () => {
    const loader = mock(() => ({}));
    const view = mock(() => new Response("view"));
    const app = makeApp(definePage(PAGE_ROUTE, { query: PageQuery, cache: "no-store", headers: { "x-page": "1" }, loader, view }));

    const res = await app.request("/test?page=two");
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-page")).toBe("1");
    expect(await res.text()).toBe(refusal("page"));
    expect(loader).not.toHaveBeenCalled();
    expect(view).not.toHaveBeenCalled();
  });

  it("renders onQueryError's refusal in place of the default, handed the issues", async () => {
    const app = makeApp(
      definePage(PAGE_ROUTE, {
        query: PageQuery,
        onQueryError: (issues) => new Response(`refused ${issues.length}`, { status: 400 }),
        view: () => new Response("view"),
      }),
    );

    const res = await app.request("/test?page=2&extra=1");
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("refused 1");
  });

  it("refuses a bad query before the action runs on a submission", async () => {
    const action = mock(() => ({}));
    const app = capturedForge();
    mapHandler(app, "POST", "/test", definePage(post("/test"), { query: PageQuery, action, view: () => new Response("view") }));

    const res = await submit(app, "", "/test?page=two");
    expect(res.status).toBe(400);
    expect(action).not.toHaveBeenCalled();
  });

  it("infers the query's output type with no type arguments, and still accepts a two-argument loader", () => {
    definePage(PAGE_ROUTE, {
      query: PageQuery,
      loader: (_c, _config, query) => {
        // @ts-expect-error -- `page` is the transform's number, not the raw string
        const raw: string = query.page;
        return { raw };
      },
      view: () => new Response("ok"),
    });
    definePage(PAGE_ROUTE, { query: PageQuery, loader: (_c, config) => ({ config }), view: () => new Response("ok") });
    definePage(PAGE_ROUTE, {
      loader: (_c, _config, query) => {
        // @ts-expect-error -- with no `query` schema the third argument is `unknown`
        return { page: query.page };
      },
      view: () => new Response("ok"),
    });
  });

  it("hands a page with no query schema an undefined third argument and leaves the query string unparsed", async () => {
    const loader = mock((..._args: unknown[]) => ({}));
    const app = makeApp(definePage(PAGE_ROUTE, { loader, view: () => new Response("view") }));

    const res = await app.request("/test?page=two&__proto__=x");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("view");
    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader.mock.calls[0]?.length).toBe(3);
    expect(loader.mock.calls[0]?.[2]).toBeUndefined();
  });

  describe("reads the query string with formToObject's semantics", () => {
    const TagsQuery = v.strictObject({ tag: v.array(v.string()) });

    const cases = [
      { search: "?tag=a&tag=b", expected: { status: 200, body: '["a","b"]' } },
      { search: "?tag=a&tag=b&tag=c", expected: { status: 200, body: '["a","b","c"]' } },
      { search: "?tag=a", expected: { status: 400, body: refusal("tag") } },
    ];

    for (const { search, expected } of cases) {
      it(`answers ${search} with ${expected.status}`, async () => {
        const app = makeApp(
          definePage(PAGE_ROUTE, {
            query: TagsQuery,
            loader: (_c, _config, query) => query.tag,
            view: (_c, _config, state) => new Response(JSON.stringify(state.data)),
          }),
        );

        const res = await app.request(`/test${search}`);
        expect({ status: res.status, body: await res.text() }).toEqual(expected);
      });
    }
  });

  it("passes an absent optional parameter as absent, and an absent defaulted one as its transformed default", async () => {
    const seen: unknown[] = [];
    const app = makeApp(
      definePage(PAGE_ROUTE, {
        query: v.strictObject({ q: v.optional(v.string()), page: v.pipe(v.optional(v.string(), "1"), v.digits(), v.transform(Number)) }),
        loader: (_c, _config, query) => {
          seen.push(query);
          return {};
        },
        view: () => new Response("view"),
      }),
    );

    const res = await app.request("/test");
    expect(res.status).toBe(200);
    expect(seen).toEqual([{ page: 1 }]);
    expect(Object.hasOwn(seen[0] as object, "q")).toBe(false);
  });

  it("refuses with one item when several parameters fail", async () => {
    const TwoDigits = v.strictObject({ a: v.pipe(v.string(), v.digits()), b: v.pipe(v.string(), v.digits()) });
    const app = makeApp(definePage(PAGE_ROUTE, { query: TwoDigits, view: () => new Response("view") }));

    const res = await app.request("/test?a=x&b=y");
    expect(res.status).toBe(400);
    expect(await res.text()).toBe(refusal("a"));
  });

  describe("a throwing query transform", () => {
    const ThrowingQuery = v.strictObject({
      page: v.pipe(
        v.string(),
        v.transform(() => {
          throw new Error("transform exploded");
        }),
      ),
    });

    it("reaches the app boundary as a 500, not a 400, and never runs the loader", async () => {
      const loader = mock(() => ({}));
      const app = makeApp(definePage(PAGE_ROUTE, { query: ThrowingQuery, loader, view: () => new Response("view") }));

      const res = await app.request("/test?page=1");
      expect(res.status).toBe(500);
      expect(await res.text()).toBe(APP_BOUNDARY_500);
      expect(loader).not.toHaveBeenCalled();
    });

    it("hands the transform's own error to def.onError", async () => {
      let captured: Error | undefined;
      const onQueryError = mock(() => new Response("refused", { status: 400 }));
      const app = makeApp(
        definePage(PAGE_ROUTE, {
          query: ThrowingQuery,
          onQueryError,
          view: () => new Response("view"),
          onError: (error) => {
            captured = error;
            return new Response("page error", { status: 503 });
          },
        }),
      );

      const res = await app.request("/test?page=1");
      expect(res.status).toBe(503);
      expect(await res.text()).toBe("page error");
      expect(captured?.message).toBe("transform exploded");
      expect(onQueryError).not.toHaveBeenCalled();
    });
  });

  it("answers a submission's bad query with the query refusal, reading no body and running neither action nor loader", async () => {
    const action = mock(() => ({}));
    const loader = mock(() => ({}));
    const app = capturedForge();
    mapHandler(
      app,
      "POST",
      "/test",
      definePage(post("/test"), { query: PageQuery, schema: NameSchema, action, loader, view: () => new Response("view") }),
    );

    const res = await submit(app, "name=", "/test?page=two");
    expect(res.status).toBe(400);
    expect(await res.text()).toBe(refusal("page"));
    expect(action).not.toHaveBeenCalled();
    expect(loader).not.toHaveBeenCalled();
  });

  it("hands the action a good query's page and the loader its parsed query on a submission", async () => {
    const calls: unknown[] = [];
    const app = capturedForge();
    mapHandler(
      app,
      "POST",
      "/test",
      definePage(post("/test"), {
        query: PageQuery,
        action: () => {
          calls.push("action");
          return "done";
        },
        loader: (_c, _config, query) => {
          calls.push(query);
          return {};
        },
        view: () => new Response("view"),
      }),
    );

    const res = await submit(app, "", "/test?page=7");
    expect(res.status).toBe(200);
    expect(calls).toEqual(["action", { page: 7 }]);
  });

  it("answers HEAD with a bad query as the bodiless 400 its GET would be, without running the loader", async () => {
    const loader = mock(() => ({}));
    const app = makeApp(definePage(PAGE_ROUTE, { query: PageQuery, headers: { "x-page": "1" }, loader, view: () => new Response("view") }));

    const res = await app.request("/test?page=two", { method: "HEAD" });
    expect(res.status).toBe(400);
    expect(res.headers.get("x-page")).toBe("1");
    expect(await res.text()).toBe("");
    expect(loader).not.toHaveBeenCalled();
  });

  it("answers OPTIONS with a bad query as 405, never consulting the query schema", async () => {
    const onQueryError = mock(() => new Response("refused", { status: 400 }));
    const app = new Forge();
    mapHandler(app, "ANY", "/test", definePage(ANY_PAGE_ROUTE, { query: PageQuery, onQueryError, view: () => new Response("view") }));

    const res = await app.request("/test?page=two", { method: "OPTIONS" });
    expect(res.status).toBe(405);
    expect(await res.text()).toBe("Method Not Allowed");
    expect(onQueryError).not.toHaveBeenCalled();
  });

  it("keeps onQueryError's own status and applies the page's cache and headers to it", async () => {
    let search: string | undefined;
    const app = makeApp(
      definePage(PAGE_ROUTE, {
        query: PageQuery,
        cache: { maxAge: 30 },
        headers: { "x-page": "1" },
        onQueryError: async (_issues, c) => {
          search = c.url.search;
          return new Response("not here", { status: 404 });
        },
        view: () => new Response("view"),
      }),
    );

    const res = await app.request("/test?page=two");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("not here");
    expect(res.headers.get("cache-control")).toBe("private, max-age=30");
    expect(res.headers.get("x-page")).toBe("1");
    expect(search).toBe("?page=two");
  });

  it("hands onQueryError the issue for the field that failed", async () => {
    const seen: unknown[] = [];
    const app = makeApp(
      definePage(PAGE_ROUTE, {
        query: PageQuery,
        onQueryError: (issues) => {
          seen.push(issues.map((issue) => ({ type: issue.type, input: issue.input, key: issue.path?.[0]?.key })));
          return new Response("refused", { status: 400 });
        },
        view: () => new Response("view"),
      }),
    );

    await app.request("/test?page=two");
    expect(seen).toEqual([[{ type: "digits", input: "two", key: "page" }]]);
  });
});

describe("definePage — error reporting", () => {
  it("leaves the record to the boundary when no onError is supplied", async () => {
    const capture = captureLogs();
    const app = makeApp(
      definePage(PAGE_ROUTE, {
        view: () => {
          throw new Error("view exploded");
        },
      }),
      capture,
    );

    await app.request("/test");
    expect(capture.records.map((r) => r.message)).toEqual(["Unhandled error"]);
  });

  it("logs exactly once, to the context's request logger as the page, when onError recovers", async () => {
    const capture = captureLogs();
    const app = makeApp(
      definePage(PAGE_ROUTE, {
        view: () => {
          throw new Error("view exploded");
        },
        onError: () => new Response("page error", { status: 500 }),
      }),
      capture,
    );

    await app.request("/test");
    expect(capture.records.length).toBe(1);
    const record = capture.records[0]!;
    expect(record.data?.source).toBe("page");
    expect(record.level).toBe("error");
    expect(record.message).toBe("Page handler threw");
    const error = record.data?.error as { type: string; detail: string; stack?: string };
    expect(error.type).toBe("Error");
    expect(error.detail).toBe("view exploded");
    expect(typeof error.stack).toBe("string");
  });

  it("attributes a throwing onError to the hook and lets the boundary render the original", async () => {
    const capture = captureLogs();
    const app = makeApp(
      definePage(PAGE_ROUTE, {
        view: () => {
          throw new Error("view exploded");
        },
        onError: () => {
          throw new Error("hook exploded");
        },
      }),
      capture,
    );

    const res = await app.request("/test");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(APP_BOUNDARY_500);

    const attribution = capture.records.find((r) => r.message === "definePage onError threw")!;
    expect(attribution.level).toBe("error");
    expect(attribution.data).toMatchObject({ error: { detail: "hook exploded" }, original: { detail: "view exploded" } });
    expect(capture.records.some((r) => r.message === "Unhandled error")).toBe(true);
  });
});

describe("definePage — a client that disconnects", () => {
  it("renders no onError page and logs nothing, leaving the boundary its 499", async () => {
    const capture = captureLogs();
    const app = makeApp(
      definePage(PAGE_ROUTE, {
        view: () => {
          throw new Error("view exploded");
        },
        onError: () => new Response("page error", { status: 500 }),
      }),
      capture,
    );

    const res = await app.fetch(new Request("http://localhost/test", { signal: AbortSignal.abort() }), {}, mockExecutionContext());

    expect(res.status).toBe(499);
    expect(capture.records).toEqual([]);
  });
});

describe("definePage — route rate limits", () => {
  type LimitedEnv = { LIMITER?: RateLimit };

  function admittingOnce(spent: string[]): RateLimit {
    let used = 0;
    return {
      limit: async ({ key }) => {
        spent.push(key);
        used += 1;
        return { success: used <= 1 };
      },
    };
  }

  function limitedPage(calls: string[]) {
    const app = new Forge<LimitedEnv>();
    mapHandler(
      app,
      "ANY",
      "/test",
      definePage(ANY_PAGE_ROUTE, {
        headers: { "x-page": "value" },
        schema: NameSchema,
        rateLimit: { binding: "LIMITER", key: (c) => `notes:${c.url.pathname}` },
        action: (_c, _config, data) => {
          calls.push(`action:${data.name}`);
          return "saved";
        },
        view: () => new Response("rendered"),
      }),
    );
    return app;
  }

  it("spends the limit on a mutation, answering the over-limit one 429 with the page's headers and without the action", async () => {
    const spent: string[] = [];
    const calls: string[] = [];
    const app = limitedPage(calls);
    const env: LimitedEnv = { LIMITER: admittingOnce(spent) };
    const init = { method: "POST", headers: FORM_HEADERS, body: "name=Jane" };

    const admitted = await app.request("/test", init, env);
    const refused = await app.request("/test", { ...init }, env);

    expect({
      admitted: [admitted.status, await admitted.text()],
      refused: [refused.status, await refused.text(), refused.headers.get("x-page")],
      spent,
      calls,
    }).toEqual({
      admitted: [200, "rendered"],
      refused: [429, "Too many requests. Please try again later.", "value"],
      spent: ["notes:/test", "notes:/test"],
      calls: ["action:Jane"],
    });
  });

  it("renders a GET without spending the limit", async () => {
    const spent: string[] = [];
    const app = limitedPage([]);

    const res = await app.request("/test", {}, { LIMITER: admittingOnce(spent) });

    expect({ status: res.status, body: await res.text(), spent }).toEqual({ status: 200, body: "rendered", spent: [] });
  });

  it("limits a GET page through rateLimit in the route's own middleware", async () => {
    const spent: string[] = [];
    const app = new Forge<LimitedEnv>();
    mapHandler(app, "GET", "/test", {
      middleware: [rateLimit<LimitedEnv>({ binding: "LIMITER", key: () => "reader" })],
      handler: definePage(PAGE_ROUTE, { view: () => new Response("rendered") }),
    });
    const env: LimitedEnv = { LIMITER: admittingOnce(spent) };

    const admitted = await app.request("/test", {}, env);
    const refused = await app.request("/test", {}, env);

    expect({ admitted: [admitted.status, await admitted.text()], refused: [refused.status, await refused.text()], spent }).toEqual({
      admitted: [200, "rendered"],
      refused: [429, "Too many requests. Please try again later."],
      spent: ["reader", "reader"],
    });
  });
});
