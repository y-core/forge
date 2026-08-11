import { describe, expect, it } from "bun:test";
import { CSRF_FIELD_DEFAULT } from "../form/constants";
import { createCsrfToken, csrfProtection, importCsrfKey } from "../form/csrf";
import { escapeHtml } from "../http/escape";
import { mapHandler } from "../testing/route";
import { strictObject } from "../validation/strict-object";
import { v } from "../validation/validation";
import { defineAction } from "./action";
import { Forge } from "./forge-app";
import { definePage } from "./page";
import type { BotRejection } from "./types";

function makeApp(handler: ReturnType<typeof definePage>) {
  const app = new Forge();
  mapHandler(app, "GET", "/test", handler);
  return app;
}

const FORM_HEADERS = { "content-type": "application/x-www-form-urlencoded" };

/** Structural, so it accepts a `Forge` at any binding type without restating its generics. */
type Requestable = { request(path: string, init: RequestInit): Promise<Response> };

function post(app: Requestable, body: string, path = "/test"): Promise<Response> {
  return app.request(path, { method: "POST", headers: FORM_HEADERS, body });
}

const NameSchema = strictObject({ name: v.pipe(v.string(), v.minLength(1, "Name required.")) });

/**
 * The shared pipeline's 422 refusal, built from one template because several cases assert it and the
 * point of those cases is that the *same* bytes come back from the page path as from the action path.
 * The anchor case in `definePage — the schema pipeline` spells the literal out in full.
 */
function refusal(...fields: readonly string[]): string {
  const items = fields.map((field) => `<li>${field}</li>`).join("");
  return `<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground"><p>Please correct the following fields.</p><ul class="mt-2 list-disc pl-5">${items}</ul></div>`;
}

/**
 * What the **app-level** boundary answers, which is where a `definePage` throw with no `onError`
 * lands. Named because a status-only assertion cannot tell this apart from `ACTION_500_FRAGMENT` —
 * both are 500, and only the body says which mechanism produced it.
 */
const APP_BOUNDARY_500 = "<!DOCTYPE html><html><body><h1>500 Internal Server Error</h1><p>An unexpected error occurred.</p></body></html>";

/** What `defineAction`'s own recovery arm answers. `definePage` deliberately does not have this arm. */
const ACTION_500_FRAGMENT =
  '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground"><p>Something went wrong. Please try again.</p></div>';

/** Captures the structured log lines written while `run` executes. */
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
      definePage({ loader: () => ({ message: "hello" }), view: (_c, _config, state) => new Response((state.data as { message: string }).message) }),
    );

    const res = await app.request("/test");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  it("sets cache-control: no-store when cache is 'no-store'", async () => {
    const app = makeApp(definePage({ cache: "no-store", view: () => new Response("ok") }));

    const res = await app.request("/test");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("sets public max-age cache header", async () => {
    const app = makeApp(definePage({ cache: { maxAge: 3600 }, view: () => new Response("ok") }));

    const res = await app.request("/test");
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
  });

  it("sets private cache header when scope is private", async () => {
    const app = makeApp(definePage({ cache: { maxAge: 60, scope: "private" }, view: () => new Response("ok") }));

    const res = await app.request("/test");
    expect(res.headers.get("cache-control")).toBe("private, max-age=60");
  });

  it("sets custom headers", async () => {
    const app = makeApp(definePage({ headers: { "x-custom": "value" }, view: () => new Response("ok") }));

    const res = await app.request("/test");
    expect(res.headers.get("x-custom")).toBe("value");
  });

  it("calls onError when the view throws", async () => {
    const app = makeApp(
      definePage({
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
      definePage({
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
      definePage({
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
      definePage({
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
      definePage({
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
      definePage({
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

  it("sends a throwing action through the same boundary as a throwing view", async () => {
    const app = new Forge();
    mapHandler(
      app,
      "POST",
      "/boundary",
      definePage({
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
      definePage({
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
      handler: definePage({
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

/**
 * Declaring a `schema` puts the page's action behind the same read → drop → guard → `safeParse`
 * sequence `defineAction` runs. The guarantee this suite exists for is a *negative* one — the action
 * is unreachable with a body the schema refused — so every case here asserts what did **not** run
 * alongside the bytes that came back, and each is paired with the case proving the same trio does run
 * on a body the schema accepts.
 */
describe("definePage — the schema pipeline", () => {
  it("renders exactly this refusal, which is the literal every other case here is asserted against", () => {
    expect(refusal("name")).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground"><p>Please correct the following fields.</p><ul class="mt-2 list-disc pl-5"><li>name</li></ul></div>',
    );
  });

  it("refuses an invalid body with the 422 fragment and reaches neither the action, the loader nor the view", async () => {
    const calls: string[] = [];
    const app = new Forge();
    mapHandler(
      app,
      "POST",
      "/test",
      definePage({
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

    const res = await post(app, "name=");
    expect(res.status).toBe(422);
    expect(await res.text()).toBe(refusal("name"));
    // The empty trace is only meaningful next to the case below, which proves the very same trio
    // runs on a body the schema accepts — a page whose route never matched would trace empty too.
    expect(calls).toEqual([]);
  });

  it("hands the parsed body to the action as its third argument, then runs the loader and the view", async () => {
    const Schema = strictObject({ name: v.string(), phone: v.optional(v.string()) });
    const calls: string[] = [];
    let firstArgIsTheContext = false;
    let received: unknown;
    const app = new Forge();
    mapHandler(
      app,
      "POST",
      "/test",
      definePage({
        schema: Schema,
        action: (c, _config, data) => {
          calls.push("action");
          // Data-first could not have been additive: an action written against `(c, config)` would
          // silently retype its first parameter. This is what pins the chosen order.
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

    const res = await post(app, "name=Jane");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ actionData: { saved: "Jane" }, data: { count: 1 }, method: "POST" });
    expect(calls).toEqual(["action", "loader", "view"]);
    expect(firstArgIsTheContext).toBe(true);
    expect(received).toEqual({ name: "Jane" });
    // An absent optional field stays absent rather than arriving as `""` — the property `formToObject`
    // exists to hold, now reaching the page builder too.
    expect("phone" in (received as object)).toBe(false);
  });

  it("leaves a schema-less page exactly as it was — no third argument, and the body still unread", async () => {
    // The additive-not-breaking guarantee, and the most important regression guard in this file. If the
    // pipeline ever became unconditional, `parseFormData` would have piped the request body through its
    // counting transform before the action ran, and the action's own read would throw.
    let thirdArg: unknown = "never assigned";
    let bodyUsedAtEntry: boolean | undefined;
    let readByAction: string | null = null;
    const app = new Forge();
    mapHandler(
      app,
      "POST",
      "/test",
      definePage({
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

    const res = await post(app, "name=Jane");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ actionData: { echoed: "Jane" } });
    expect(thirdArg).toBeUndefined();
    expect(bodyUsedAtEntry).toBe(false);
    expect(readByAction).toBe("Jane");
  });

  it("keeps a schema-less page's action reachable with a body a schema would have refused", async () => {
    // The same guarantee from the other side: no schema means no refusal, however malformed the body.
    const app = new Forge();
    mapHandler(app, "POST", "/test", definePage({ action: () => "ran", view: (_c, _config, state) => new Response(String(state.actionData)) }));

    const res = await post(app, "name=&nobody_asked=1");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ran");
  });

  it("never runs the pipeline on a GET, so a bodiless request still renders", async () => {
    // A GET carries no body, so a pipeline that ran would fail its own `parseFormData` and answer 400.
    // The rendered 200 is therefore evidence the sequence was skipped, not merely that it passed.
    const calls: string[] = [];
    const app = makeApp(
      definePage({
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
    // There is no terminal step to protect, so a body the schema would refuse is simply not read.
    const app = new Forge();
    mapHandler(app, "POST", "/test", definePage({ schema: NameSchema, view: (_c, _config, state) => new Response(`rendered:${state.method}`) }));

    const res = await post(app, "name=");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("rendered:POST");
  });
});

/**
 * A page's refusals are the page's responses, so they carry its configured `cache`/`headers` — a
 * genuine difference from `defineAction`, whose refusal is a bare fragment. That is what routing the
 * pipeline's `Response` through `applyResponseHeaders` buys, and it is worth pinning on all three
 * refusal statuses rather than the one that happened to be written first.
 */
describe("definePage — a refusal carries the page's own headers", () => {
  const CACHE = "no-store" as const;
  const HEADERS = { "x-page": "value" };

  function headeredApp(calls: string[]) {
    const app = new Forge();
    mapHandler(
      app,
      "POST",
      "/test",
      definePage({
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
    const res = await post(headeredApp(calls), "name=");

    expect(res.status).toBe(422);
    expect(await res.text()).toBe(refusal("name"));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-page")).toBe("value");
    expect(calls).toEqual([]);
  });

  it("carries them on the 413 an oversized body produces", async () => {
    const calls: string[] = [];
    // 100 KB default cap; this body is ~200 KB.
    const res = await post(headeredApp(calls), `name=${"x".repeat(200_000)}`);

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
    const res = await post(headeredApp(calls), "name=Jane");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("rendered");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(calls).toEqual(["action"]);
  });
});

/**
 * The sequence is shared and so are its options: a page declares `onValidationError`, `honeypot`,
 * `onBotDetected` and `maxBytes` exactly as an action does. Each case here is written so that
 * un-wiring the option changes the bytes — a refusal that still names the schema's own field, a
 * decoy that would otherwise be an undeclared key, a cap only a raised limit could clear.
 */
describe("definePage — the submission sequence's options are the page's own", () => {
  /** Unguessable by construction, so a fallback that dropped a "likely" decoy name could not match it. */
  const DECOY = "contact_reason_2";

  /** Carries characters that must survive as entities, so a refusal cannot be asserted by substring. */
  const MessageSchema = strictObject({ message: v.pipe(v.string(), v.minLength(1, "Tell us what you'd like & we'll reply.")) });

  /**
   * The page's own markup, rendered from the same function on a first paint and on a refusal — which
   * is the capability under test: the refusal is this page, not the shared fragment.
   */
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
      definePage({
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

    const res = await post(app, "message=");
    expect(res.status).toBe(422);
    expect(await res.text()).toBe(
      '<main><h1>Contact</h1><form method="post"><ul><li>Tell us what you&#39;d like &amp; we&#39;ll reply.</li></ul></form></main>',
    );
    // The page answered without running its own trio, so the errors came from the sequence's issues
    // rather than from a second validation pass the action would have had to write.
    expect(calls).toEqual([]);
    expect(methodAtRefusal).toBe("POST");
  });

  function decoyPage(calls: string[], onBotDetected?: (rejection: BotRejection) => Response) {
    const app = new Forge();
    mapHandler(
      app,
      "POST",
      "/test",
      definePage({
        schema: NameSchema,
        honeypot: DECOY,
        ...(onBotDetected ? { onBotDetected } : {}),
        action: (_c, _config, data) => {
          calls.push("action");
          return Object.keys(data).join(",");
        },
        view: (_c, _config, state) => new Response(String(state.actionData)),
      }),
    );
    return app;
  }

  it("refuses a filled decoy the page declared as its honeypot, naming the schema's field and not the decoy", async () => {
    const calls: string[] = [];
    const res = await post(decoyPage(calls), `name=Jane&${DECOY}=spam`);

    expect(res.status).toBe(422);
    // Naming `name` is the whole assertion: an unwired honeypot would have reached `strictObject`,
    // which refuses `contact_reason_2` as the undeclared key it is — same status, different bytes.
    expect(await res.text()).toBe(refusal("name"));
    expect(calls).toEqual([]);
  });

  it("drops the empty decoy, so a strictObject that never declares it still passes", async () => {
    const calls: string[] = [];
    const res = await post(decoyPage(calls), `name=Jane&${DECOY}=`);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("name");
    expect(calls).toEqual(["action"]);
  });

  it("hands the page's onBotDetected the rejection instead of rendering the refusal", async () => {
    const calls: string[] = [];
    let rejection: BotRejection | undefined;
    const app = decoyPage(calls, (received) => {
      rejection = received;
      return new Response("go away", { status: 403 });
    });

    const res = await post(app, `name=Jane&${DECOY}=spam`);
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("go away");
    expect(rejection).toEqual({ guard: "honeypot" });
    expect(calls).toEqual([]);
  });

  it("accepts a body over the default cap when the page raises maxBytes", async () => {
    const app = new Forge();
    mapHandler(
      app,
      "POST",
      "/test",
      definePage({
        maxBytes: 300 * 1024,
        schema: NameSchema,
        action: (_c, _config, data) => String(data.name.length),
        view: (_c, _config, state) => new Response(String(state.actionData)),
      }),
    );

    // ~200 KB, twice the default cap: a 200 here is only reachable through the page's own limit.
    const res = await post(app, `name=${"x".repeat(200_000)}`);
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
      definePage({
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
    const res = await post(app, `name=${"x".repeat(2000)}`);
    expect(res.status).toBe(413);
    expect(await res.text()).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground"><p>The submitted form is too large. Please reduce its size and try again.</p></div>',
    );
    expect(calls).toEqual([]);
  });
});

/**
 * Derive-only holds on **both** builders: the CSRF field is dropped because `csrfProtection` recorded
 * on the request which field it took the token from, and on no other ground. Both directions are
 * pinned, because a fallback that dropped `_csrf` on a guess would make the positive case pass while
 * the guard was absent.
 */
describe("definePage — the CSRF field the guard consumed", () => {
  const SECRET = "a".repeat(64);
  const KeysSchema = strictObject({ name: v.string() });

  function keysPage() {
    return definePage({
      schema: KeysSchema,
      action: (_c, _config, data) => Object.keys(data).join(","),
      view: (_c, _config, state) => new Response(String(state.actionData)),
    });
  }

  it("drops the token field on the page path, so a strictObject that never declares it passes", async () => {
    const key = await importCsrfKey(SECRET);
    const app = new Forge();
    mapHandler(app, "POST", "/guarded", { middleware: [csrfProtection({ secret: () => key, subject: false })], handler: keysPage() });
    const token = await createCsrfToken(key, "/guarded");

    const res = await post(app, `${CSRF_FIELD_DEFAULT}=${token}&name=Jane`, "/guarded");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("name");
  });

  it("refuses _csrf as the undeclared field it is when no CSRF middleware ran", async () => {
    const app = new Forge();
    mapHandler(app, "POST", "/unguarded", keysPage());

    const res = await post(app, `name=Jane&${CSRF_FIELD_DEFAULT}=whatever`, "/unguarded");
    expect(res.status).toBe(422);
    expect(await res.text()).toBe(refusal(CSRF_FIELD_DEFAULT));
  });
});

/**
 * **The asymmetry between the two builders is deliberate and is pinned here so it is not "unified"
 * later.** The pipeline lets a throw escape rather than answering it, and the two builders recover
 * differently on purpose: `defineAction` owns a 500 fragment because its terminal step *is* the
 * response, while a page with no `onError` rethrows to the app boundary, which is where a page's
 * unhandled failure has always been rendered.
 *
 * Every case asserts the exact body. Forge's app-level boundary also answers 500, so a status-only
 * assertion cannot distinguish "the builder caught it" from "the framework caught it".
 */
describe("definePage — a throwing schema", () => {
  const ThrowingCheck = strictObject({
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
      definePage({
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
    const res = await post(throwingPage(calls), "name=Jane");

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
      definePage({
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

    const res = await post(app, "name=Jane");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("page error");
    expect(captured?.message).toBe("check exploded");
    expect(calls).toEqual([]);
  });

  it("logs the throw as the page's own and never as an action's", async () => {
    const calls: string[] = [];
    const app = throwingPage(calls);
    const logs = await captureLogs(() => post(app, "name=Jane"));

    expect(logs.some((line) => line.includes("Page handler threw"))).toBe(true);
    expect(logs.some((line) => line.includes("Action threw"))).toBe(false);
  });

  it("answers one and the same throwing schema differently on each builder, on purpose", async () => {
    const pageApp = new Forge();
    mapHandler(pageApp, "POST", "/page", definePage({ schema: ThrowingCheck, action: () => "ran", view: () => new Response("rendered") }));
    const actionApp = new Forge();
    mapHandler(actionApp, "POST", "/action", defineAction({ schema: ThrowingCheck, handle: () => new Response("handled") }));

    const page = await post(pageApp, "name=Jane", "/page");
    const action = await post(actionApp, "name=Jane", "/action");

    expect(page.status).toBe(500);
    expect(action.status).toBe(500);
    expect(await page.text()).toBe(APP_BOUNDARY_500);
    expect(await action.text()).toBe(ACTION_500_FRAGMENT);
  });
});
