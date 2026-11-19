import { describe, expect, it, mock } from "bun:test";

import { requireFreshStepUp } from "../auth/web/guards";
import { importKeyRing } from "../crypto/keyring/ring";
import { CSRF_FIELD_DEFAULT } from "../form/constants";
import { createCsrfToken, csrfProtection } from "../form/csrf";
import { escapeHtml } from "../html/escape";
import { ok } from "../result/result";
import { get, post, put, Route } from "../router/mod";
import { originProtection } from "../security/cop";
import { mockExecutionContext } from "../testing/context";
import { mapHandler } from "../testing/route";
import type { TestAction } from "../testing/types";
import { v } from "../validation/validation";
import { Forge } from "./forge-app";
import { createHandlerFactory } from "./handler-factory";
import type { BotRejection } from "./types";

const { definePage, defineAction } = createHandlerFactory();
const PAGE_ROUTE = get("/test");
const ACTION_ROUTE = post("/action");
const ANY_PAGE_ROUTE = new Route("ANY", "/test");

function makeApp(handler: TestAction<"/test">) {
  const app = new Forge();
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
  return `<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground"><p>Please correct the following fields.</p><ul class="mt-2 list-disc ps-5">${items}</ul></div>`;
}

const APP_BOUNDARY_500 = "<!DOCTYPE html><html><body><h1>500 Internal Server Error</h1><p>An unexpected error occurred.</p></body></html>";

const ACTION_500_FRAGMENT =
  '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground"><p>Something went wrong. Please try again.</p></div>';

async function captureLogs(run: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => lines.push(msg);
  try {
    await run();
  } finally {
    console.log = originalLog;
  }
  return lines;
}

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
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground"><p>Please correct the following fields.</p><ul class="mt-2 list-disc ps-5"><li>name</li></ul></div>',
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
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground"><p>The submitted form is too large. Please reduce its size and try again.</p></div>',
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
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground"><p>Unable to process the form data. Please try again.</p></div>',
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
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground"><p>The submitted form is too large. Please reduce its size and try again.</p></div>',
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
    mapHandler(app, "POST", "/guarded", { middleware: [csrfProtection({ ring: () => ring, subject: false })], handler: keysPage() });
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
    mapHandler(app, "ANY", "/guarded", {
      middleware: [
        originProtection({ allowedOrigins: ["http://localhost"] }),
        csrfProtection({ ring: () => ring, subject: false }),
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

  function throwingPage(calls: string[], onError?: () => Response) {
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
    const app = throwingPage(calls);
    const logs = await captureLogs(() => submit(app, "name=Jane"));

    expect(logs.some((line) => line.includes("Unhandled error"))).toBe(true);
    expect(logs.some((line) => line.includes("Page handler threw"))).toBe(false);
    expect(logs.some((line) => line.includes("Action threw"))).toBe(false);
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

describe("definePage — error reporting", () => {
  const parse = (lines: string[]): Record<string, unknown>[] => lines.map((line) => JSON.parse(line) as Record<string, unknown>);

  it("leaves the record to the boundary when no onError is supplied", async () => {
    const app = makeApp(
      definePage(PAGE_ROUTE, {
        view: () => {
          throw new Error("view exploded");
        },
      }),
    );

    const records = parse(await captureLogs(() => app.request("/test")));
    expect(records.map((r) => r.prefix)).toEqual(["app"]);
    expect(records[0]!.message).toBe("Unhandled error");
  });

  it("logs exactly once, in the serialized shape, when onError recovers", async () => {
    const app = makeApp(
      definePage(PAGE_ROUTE, {
        view: () => {
          throw new Error("view exploded");
        },
        onError: () => new Response("page error", { status: 500 }),
      }),
    );

    const records = parse(await captureLogs(() => app.request("/test")));
    expect(records.length).toBe(1);
    const record = records[0]!;
    expect(record.prefix).toBe("page");
    expect(record.level).toBe("error");
    expect(record.message).toBe("Page handler threw");
    const error = record.error as { type: string; detail: string; stack?: string };
    expect(error.type).toBe("Error");
    expect(error.detail).toBe("view exploded");
    expect(typeof error.stack).toBe("string");
  });

  it("attributes a throwing onError to the hook and lets the boundary render the original", async () => {
    const app = makeApp(
      definePage(PAGE_ROUTE, {
        view: () => {
          throw new Error("view exploded");
        },
        onError: () => {
          throw new Error("hook exploded");
        },
      }),
    );

    const res = await app.request("/test");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(APP_BOUNDARY_500);

    const records = parse(await captureLogs(() => app.request("/test")));
    const attribution = records.find((r) => r.message === "definePage onError threw")!;
    expect(attribution.level).toBe("error");
    expect((attribution.error as { detail: string }).detail).toBe("hook exploded");
    expect((attribution.original as { detail: string }).detail).toBe("view exploded");
    expect(records.some((r) => r.message === "Unhandled error")).toBe(true);
  });
});

describe("definePage — a client that disconnects", () => {
  it("renders no onError page and logs nothing, leaving the boundary its 499", async () => {
    const app = makeApp(
      definePage(PAGE_ROUTE, {
        view: () => {
          throw new Error("view exploded");
        },
        onError: () => new Response("page error", { status: 500 }),
      }),
    );

    let res: Response | undefined;
    const logs = await captureLogs(async () => {
      res = await app.fetch(new Request("http://localhost/test", { signal: AbortSignal.abort() }), {}, mockExecutionContext());
    });

    expect(res!.status).toBe(499);
    expect(logs).toEqual([]);
  });
});
