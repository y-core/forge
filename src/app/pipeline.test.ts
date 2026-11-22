import { afterEach, beforeAll, describe, expect, it } from "bun:test";

import type { Middleware } from "@remix-run/fetch-router";

import { contextVar } from "../context/accessor";
import { importKeyRing } from "../crypto/keyring/ring";
import type { KeyRing } from "../crypto/keyring/types";
import { TURNSTILE_FIELD_DEFAULT } from "../form/constants";
import { createCsrfToken } from "../form/csrf";
import { requestLog } from "../logging/request-logger";
import { post } from "../router/mod";
import type { RateLimit } from "../security/types";
import { createTestContext } from "../testing/context";
import { captureLogs } from "../testing/logs";
import { mapHandler } from "../testing/route";
import type { CapturedLogs, TestAction } from "../testing/types";
import { v } from "../validation/validation";
import { Forge } from "./forge-app";
import { createHandlerFactory } from "./handler-factory";
import { applyMiddlewareChain } from "./middleware-chain";
import { firstDeclaredField, screenTurnstile } from "./pipeline";
import type { ActionTurnstileOptions } from "./types";

const { defineAction } = createHandlerFactory();
const ACTION_ROUTE = post("/test");

const NameSchema = v.strictObject({ name: v.pipe(v.string(), v.minLength(1, "Name required.")) });
const FORM_HEADERS = { "content-type": "application/x-www-form-urlencoded" };

type Requestable = { request(path: string, init: RequestInit): Promise<Response> };

function makeApp(action: TestAction<"/test">, capture?: CapturedLogs) {
  const app = new Forge(capture?.logger);
  if (capture) {
    app.use("*", (context, next) => {
      requestLog.set(context, capture.logger);
      return next();
    });
  }
  mapHandler(app, "POST", "/test", action);
  return app;
}

function submit(app: Requestable, body: string, path = "/test"): Promise<Response> {
  return app.request(path, { method: "POST", headers: FORM_HEADERS, body });
}

function refusal(...fields: readonly string[]): string {
  const items = fields.map((field) => `<li>${field}</li>`).join("");
  return `<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground" data-announce-failure="Please correct the following fields."><p>Please correct the following fields.</p><ul class="mt-2 list-disc ps-5">${items}</ul></div>`;
}

const UNPARSEABLE_FRAGMENT =
  '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground" data-announce-failure="Unable to process the form data. Please try again."><p>Unable to process the form data. Please try again.</p></div>';

const ACTION_500_FRAGMENT =
  '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground" data-announce-failure="Something went wrong. Please try again."><p>Something went wrong. Please try again.</p></div>';

let savedFetch: typeof globalThis.fetch | undefined;

afterEach(() => {
  if (savedFetch) {
    globalThis.fetch = savedFetch;
    savedFetch = undefined;
  }
});

function fakeSiteverify(respond: (init: RequestInit | undefined) => Promise<Response>): void {
  savedFetch = globalThis.fetch;
  globalThis.fetch = ((_url: URL | RequestInfo, init?: RequestInit) => respond(init)) as typeof globalThis.fetch;
}

describe("createSubmissionPipeline — a throwing Turnstile resolver", () => {
  it("lets a throwing secretKey reach the 500 arm without spending a siteverify call", async () => {
    let verified = false;
    fakeSiteverify(async () => {
      verified = true;
      return new Response(JSON.stringify({ success: true, hostname: "localhost" }));
    });

    const app = makeApp(
      defineAction(ACTION_ROUTE, {
        schema: NameSchema,
        turnstile: {
          secretKey: () => {
            throw new Error("secret binding missing");
          },
          verify: () => ({ expectedHostname: "localhost" }),
        },
        handle: () => new Response("success"),
      }),
    );

    const res = await submit(app, `name=Jane&${TURNSTILE_FIELD_DEFAULT}=solved-token`);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(ACTION_500_FRAGMENT);
    expect(verified).toBe(false);
  });

  it("hands a throwing secretKey's error to onError", async () => {
    let captured: Error | undefined;
    const app = makeApp(
      defineAction(ACTION_ROUTE, {
        schema: NameSchema,
        turnstile: {
          secretKey: () => {
            throw new Error("secret binding missing");
          },
          verify: () => ({ expectedHostname: "localhost" }),
        },
        onError: (error) => {
          captured = error;
          return new Response("custom 500", { status: 500 });
        },
        handle: () => new Response("success"),
      }),
    );

    const res = await submit(app, `name=Jane&${TURNSTILE_FIELD_DEFAULT}=solved-token`);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("custom 500");
    expect(captured?.message).toBe("secret binding missing");
  });

  it("lets an async-rejecting secretKey reach the same arm", async () => {
    const app = makeApp(
      defineAction(ACTION_ROUTE, {
        schema: NameSchema,
        turnstile: { secretKey: () => Promise.reject(new Error("secret lookup rejected")), verify: () => ({ expectedHostname: "localhost" }) },
        handle: () => new Response("success"),
      }),
    );

    const res = await submit(app, `name=Jane&${TURNSTILE_FIELD_DEFAULT}=solved-token`);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(ACTION_500_FRAGMENT);
  });

  it("lets a throwing verify reach the 500 arm", async () => {
    let captured: Error | undefined;
    const app = makeApp(
      defineAction(ACTION_ROUTE, {
        schema: NameSchema,
        turnstile: {
          secretKey: () => "test-secret",
          verify: () => {
            throw new Error("hostname resolver exploded");
          },
        },
        onError: (error) => {
          captured = error;
          return new Response("custom 500", { status: 500 });
        },
        handle: () => new Response("success"),
      }),
    );

    const res = await submit(app, `name=Jane&${TURNSTILE_FIELD_DEFAULT}=solved-token`);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("custom 500");
    expect(captured?.message).toBe("hostname resolver exploded");
  });

  it("logs a throwing resolver, because a route defect is the operator's to see", async () => {
    const capture = captureLogs();
    const app = makeApp(
      defineAction(ACTION_ROUTE, {
        schema: NameSchema,
        turnstile: {
          secretKey: () => {
            throw new Error("secret binding missing");
          },
          verify: () => ({ expectedHostname: "localhost" }),
        },
        handle: () => new Response("success"),
      }),
      capture,
    );

    await submit(app, `name=Jane&${TURNSTILE_FIELD_DEFAULT}=solved-token`);
    expect(capture.records.map(({ message, data }) => ({ message, source: data?.source }))).toContainEqual({
      message: "Action threw",
      source: "action",
    });
  });

  it("logs every tripped turnstile guard with its reason, not only an unreachable siteverify", async () => {
    const capture = captureLogs();
    const app = makeApp(
      defineAction(ACTION_ROUTE, {
        schema: NameSchema,
        turnstile: { secretKey: () => "test-secret", verify: () => ({ expectedHostname: "localhost" }) },
        handle: () => new Response("success"),
      }),
      capture,
    );

    await submit(app, "name=Jane");
    expect(capture.records.find((record) => record.message === "Submission refused by a bot guard")?.data).toMatchObject({
      reason: "missing-token",
    });
  });

  it("names the guard that refused on the same line", async () => {
    const capture = captureLogs();
    const app = makeApp(
      defineAction(ACTION_ROUTE, {
        schema: NameSchema,
        turnstile: { secretKey: () => "test-secret", verify: () => ({ expectedHostname: "localhost" }) },
        handle: () => new Response("success"),
      }),
      capture,
    );

    await submit(app, "name=Jane");
    expect(capture.records.find((record) => record.message === "Submission refused by a bot guard")?.data).toMatchObject({ guard: "turnstile" });
  });

  it("still reaches handle through resolvers that do not throw", async () => {
    fakeSiteverify(async () => new Response(JSON.stringify({ success: true, hostname: "localhost" })));

    const app = makeApp(
      defineAction(ACTION_ROUTE, {
        schema: NameSchema,
        turnstile: { secretKey: () => "test-secret", verify: () => ({ expectedHostname: "localhost" }) },
        handle: (data) => new Response(data.name),
      }),
    );

    const res = await submit(app, `name=Jane&${TURNSTILE_FIELD_DEFAULT}=solved-token`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Jane");
  });
});

describe("createSubmissionPipeline — an async-rejecting hook", () => {
  it("absorbs a rejected onValidationError into the 500 arm, exactly as a synchronous throw", async () => {
    const app = makeApp(
      defineAction(ACTION_ROUTE, {
        schema: NameSchema,
        handle: () => new Response("success"),
        onValidationError: () => Promise.reject(new Error("formatter rejected")),
      }),
    );

    const res = await submit(app, "name=");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(ACTION_500_FRAGMENT);
  });

  it("hands a rejected onValidationError's error to onError", async () => {
    let captured: Error | undefined;
    const app = makeApp(
      defineAction(ACTION_ROUTE, {
        schema: NameSchema,
        handle: () => new Response("success"),
        onValidationError: async () => {
          throw new Error("formatter rejected");
        },
        onError: (error) => {
          captured = error;
          return new Response("custom 500", { status: 500 });
        },
      }),
    );

    const res = await submit(app, "name=");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("custom 500");
    expect(captured?.message).toBe("formatter rejected");
  });

  it("logs a rejected onValidationError on the same line a throwing one produces", async () => {
    const capture = captureLogs();
    const app = makeApp(
      defineAction(ACTION_ROUTE, {
        schema: NameSchema,
        handle: () => new Response("success"),
        onValidationError: () => Promise.reject(new Error("formatter rejected")),
      }),
      capture,
    );

    await submit(app, "name=");
    expect(capture.records.map((record) => record.message)).toContain("Action threw");
  });

  it("absorbs a rejected onBotDetected into the same arm", async () => {
    const app = makeApp(
      defineAction(ACTION_ROUTE, {
        schema: NameSchema,
        turnstile: { secretKey: () => "test-secret", verify: () => ({ expectedHostname: "localhost" }) },
        handle: () => new Response("success"),
        onBotDetected: () => Promise.reject(new Error("ban list unavailable")),
      }),
    );

    const res = await submit(app, "name=Jane");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(ACTION_500_FRAGMENT);
  });

  it("still renders an async onValidationError that resolves", async () => {
    const app = makeApp(
      defineAction(ACTION_ROUTE, {
        schema: NameSchema,
        handle: () => new Response("success"),
        onValidationError: async (issues) => new Response(issues.map((issue) => issue.message).join("|"), { status: 422 }),
      }),
    );

    const res = await submit(app, "name=");
    expect(res.status).toBe(422);
    expect(await res.text()).toBe("Name required.");
  });
});

/** The Turnstile records a run logged, each reduced to its level, message and data. */
function botGuardRecords(capture: CapturedLogs): unknown[] {
  return capture.records
    .filter((record) => record.message === "Submission refused by a bot guard")
    .map(({ level, message, data }) => ({ level, message, ...data }));
}

function tokenForm(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

describe("screenTurnstile", () => {
  it("refuses a form carrying no token as missing-token, logging the guard and the reason at warn", async () => {
    const capture = captureLogs();
    const c = createTestContext(new Request("http://test/submit", { method: "POST" }), { logger: capture.logger });

    const result = await screenTurnstile(c, tokenForm({ name: "Jane" }), "test-secret", {
      expectedHostname: "localhost",
      tokenField: "cf-turnstile-response",
    });

    expect({ result, logged: botGuardRecords(capture) }).toEqual({
      result: { ok: false, error: "missing-token" },
      logged: [{ level: "warn", message: "Submission refused by a bot guard", source: "pipeline", guard: "turnstile", reason: "missing-token" }],
    });
  });

  it("admits a token siteverify accepts and logs nothing about it", async () => {
    fakeSiteverify(async () => new Response(JSON.stringify({ success: true, hostname: "localhost" })));
    const capture = captureLogs();
    const c = createTestContext(new Request("http://test/submit", { method: "POST" }), { logger: capture.logger });

    const result = await screenTurnstile(c, tokenForm({ "cf-turnstile-response": "solved" }), "test-secret", {
      expectedHostname: "localhost",
      tokenField: "cf-turnstile-response",
    });

    expect({ result, logged: botGuardRecords(capture) }).toEqual({ result: { ok: true, data: undefined }, logged: [] });
  });

  it("reads the token from the field it is given, not from the default one", async () => {
    const sent: unknown[] = [];
    fakeSiteverify(async (init) => {
      sent.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ success: true, hostname: "localhost" }));
    });
    const c = createTestContext(new Request("http://test/submit", { method: "POST" }));
    const form = tokenForm({ "cf-turnstile-response": "default-field-token", "bot-check": "named-field-token" });

    const named = await screenTurnstile(c, form, "test-secret", { expectedHostname: "localhost", tokenField: "bot-check" });

    expect({ named, sent }).toEqual({ named: { ok: true, data: undefined }, sent: [{ secret: "test-secret", response: "named-field-token" }] });
  });

  it("forwards the request's own signal to siteverify", async () => {
    const reasons: unknown[] = [];
    fakeSiteverify(async (init) => {
      reasons.push(init?.signal?.aborted === true ? init.signal.reason : "live");
      return new Response(JSON.stringify({ success: true, hostname: "localhost" }));
    });
    const request = new AbortController();
    request.abort("request-gone");
    const c = createTestContext(new Request("http://test/submit", { method: "POST", signal: request.signal }));

    await screenTurnstile(c, tokenForm({ "cf-turnstile-response": "solved" }), "test-secret", {
      expectedHostname: "localhost",
      tokenField: "cf-turnstile-response",
    });

    expect(reasons).toEqual(["request-gone"]);
  });

  it("lets a caller-supplied signal replace the request's, so the request's abort no longer reaches siteverify", async () => {
    const reasons: unknown[] = [];
    fakeSiteverify(async (init) => {
      reasons.push(init?.signal?.aborted === true ? init.signal.reason : "live");
      return new Response(JSON.stringify({ success: true, hostname: "localhost" }));
    });
    const request = new AbortController();
    request.abort("request-gone");
    const c = createTestContext(new Request("http://test/submit", { method: "POST", signal: request.signal }));
    const form = tokenForm({ "cf-turnstile-response": "solved" });

    await screenTurnstile(c, form, "test-secret", {
      expectedHostname: "localhost",
      tokenField: "cf-turnstile-response",
      signal: new AbortController().signal,
    });
    const caller = new AbortController();
    caller.abort("caller-gone");
    await screenTurnstile(c, form, "test-secret", {
      expectedHostname: "localhost",
      tokenField: "cf-turnstile-response",
      signal: caller.signal,
    }).catch(() => undefined);

    expect(reasons).toEqual(["live", "caller-gone"]);
  });
});

describe("firstDeclaredField", () => {
  for (const { label, schema, expected } of [
    {
      label: "the first key in declaration order, not alphabetical order",
      schema: v.strictObject({ zeta: v.string(), alpha: v.string() }),
      expected: "zeta",
    },
    { label: "undefined for an object schema declaring no field", schema: v.strictObject({}), expected: undefined },
    { label: "undefined for a schema that is not an object at all", schema: v.string(), expected: undefined },
  ]) {
    it(`returns ${label}`, () => {
      expect(firstDeclaredField(schema)).toBe(expected);
    });
  }
});

describe("createSubmissionPipeline — Turnstile defaults", () => {
  const KEYS_ENV = { TURNSTILE_SITE_KEY: "site-key-public", TURNSTILE_SECRET_KEY: "secret-key-private" };

  /** Answers siteverify with `answer`; hands back every body it was sent. */
  function siteverify(answer: Record<string, unknown>): unknown[] {
    const sent: unknown[] = [];
    fakeSiteverify(async (init) => {
      sent.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(answer));
    });
    return sent;
  }

  function guardedApp(turnstile: ActionTurnstileOptions, errors: Error[] = []) {
    return makeApp(
      defineAction(ACTION_ROUTE, {
        schema: NameSchema,
        turnstile,
        onError: (error) => {
          errors.push(error);
          return new Response("custom 500", { status: 500 });
        },
        handle: (data) => new Response(data.name),
      }),
    );
  }

  function postAt(app: Forge, url: string, env: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Response> {
    return app.request(url, { method: "POST", headers: { ...FORM_HEADERS, ...headers }, body: `name=Jane&${TURNSTILE_FIELD_DEFAULT}=solved` }, env);
  }

  it("verifies under the bindings' secret and the request's remote address, admitting a token solved for the request's hostname", async () => {
    const sent = siteverify({ success: true, hostname: "app.example" });

    const res = await postAt(guardedApp({}), "https://app.example/test", KEYS_ENV, { "CF-Connecting-IP": "203.0.113.7" });

    expect({ status: res.status, body: await res.text(), sent }).toEqual({
      status: 200,
      body: "Jane",
      sent: [{ secret: "secret-key-private", response: "solved", remoteip: "203.0.113.7" }],
    });
  });

  it("verifies with only the secret bound, so an action never reads the site key", async () => {
    const sent = siteverify({ success: true, hostname: "app.example" });

    const res = await postAt(guardedApp({}), "https://app.example/test", { TURNSTILE_SECRET_KEY: "secret-key-private" });

    expect({ status: res.status, sent }).toEqual({ status: 200, sent: [{ secret: "secret-key-private", response: "solved" }] });
  });

  it("sends no remote address when the request carries no CF-Connecting-IP", async () => {
    const sent = siteverify({ success: true, hostname: "app.example" });

    await postAt(guardedApp({}), "https://app.example/test", KEYS_ENV);

    expect(sent).toEqual([{ secret: "secret-key-private", response: "solved" }]);
  });

  it("refuses a token solved for a hostname other than the request's", async () => {
    siteverify({ success: true, hostname: "elsewhere.example" });

    const res = await postAt(guardedApp({}), "https://app.example/test", KEYS_ENV);

    expect(res.status).toBe(422);
  });

  for (const { name, env, message } of [
    { name: "an absent secret key", env: { TURNSTILE_SITE_KEY: "site-key-public" }, message: "Invalid environment: TURNSTILE_SECRET_KEY: missing" },
    { name: "a blank secret key", env: { ...KEYS_ENV, TURNSTILE_SECRET_KEY: "" }, message: "Invalid environment: TURNSTILE_SECRET_KEY: missing" },
  ]) {
    it(`answers 500 naming the key for ${name}, without spending a siteverify call`, async () => {
      const sent = siteverify({ success: true, hostname: "app.example" });
      const errors: Error[] = [];

      const res = await postAt(guardedApp({}, errors), "https://app.example/test", env);

      expect({ status: res.status, messages: errors.map((error) => error.message), sent }).toEqual({ status: 500, messages: [message], sent: [] });
    });
  }

  it("lets a consumer's secret and constraints win over the defaults", async () => {
    const sent = siteverify({ success: true, hostname: "apex.example", action: "contact" });

    const res = await postAt(
      guardedApp({ secretKey: () => "override-secret", verify: () => ({ expectedHostname: "apex.example", expectedAction: "contact" }) }),
      "https://www.app.example/test",
      {},
    );

    expect({ status: res.status, sent }).toEqual({ status: 200, sent: [{ secret: "override-secret", response: "solved" }] });
  });
});

describe("createSubmissionPipeline — the rate-limit stage's place in the sequence", () => {
  const CSRF_HEX_KEY = "9c55dd3f0812c671dc6d905ab7941deebb36feefbbfe4ba28bd37ae08287a9cf";
  const userIdVar = contextVar<string>("pipeline-test.userId");
  type LimitedEnv = { SUBMISSIONS?: RateLimit };

  let ring: KeyRing;
  beforeAll(async () => {
    ring = await importKeyRing([CSRF_HEX_KEY]);
  });

  function identify(events: string[]): Middleware {
    return (context, next) => {
      const user = context.request.headers.get("x-user");
      events.push(`identify:${user ?? "none"}`);
      if (user === null) return new Response("Unauthorized", { status: 401 });
      userIdVar.set(context, user);
      return next();
    };
  }

  function stagedApp(
    events: string[],
    rateLimits: Record<string, { limit: number; period: number }> = { SUBMISSIONS: { limit: 5, period: 60 } },
    onError?: (error: Error) => Response,
  ) {
    const app = new Forge<LimitedEnv>();
    applyMiddlewareChain(app, { securityHeaders: {}, rateLimits, csrf: { ring: () => ring, subject: false } });
    mapHandler(app, "POST", "/test", {
      middleware: [identify(events)],
      handler: defineAction(ACTION_ROUTE, {
        schema: NameSchema,
        rateLimit: { binding: "SUBMISSIONS", key: (c) => userIdVar.get(c) },
        turnstile: { secretKey: () => "test-secret", verify: () => ({ expectedHostname: "localhost" }) },
        handle: (data) => {
          events.push("handle");
          return new Response(`saved ${data.name}`);
        },
        ...(onError === undefined ? {} : { onError }),
      }),
    });
    return app;
  }

  function limiterEnv(events: string[], admits: boolean): LimitedEnv {
    return {
      SUBMISSIONS: {
        limit: async ({ key }) => {
          events.push(`limit:${key}`);
          return { success: admits };
        },
      },
    };
  }

  function siteverifyAnswering(events: string[], success: boolean): void {
    fakeSiteverify(async () => {
      events.push("siteverify");
      return new Response(JSON.stringify(success ? { success: true, hostname: "localhost" } : { success: false }));
    });
  }

  const SOLVED = `${TURNSTILE_FIELD_DEFAULT}=solved-token`;

  const cases: {
    name: string;
    headers: { user?: string; token?: boolean; contentType?: string };
    body: string;
    admits?: boolean;
    humanVerified?: boolean;
    expected: { status: number; body: string; events: string[] };
  }[] = [
    {
      name: "spends the limit after CSRF and identity, then screens Turnstile, validates, and handles an admitted submission",
      headers: { user: "alice", token: true },
      body: `name=Jane&${SOLVED}`,
      expected: { status: 200, body: "saved Jane", events: ["identify:alice", "limit:alice", "siteverify", "handle"] },
    },
    {
      name: "answers a CSRF-refused submission 403 without reaching identity or spending the limit",
      headers: { user: "alice" },
      body: `name=Jane&${SOLVED}`,
      expected: { status: 403, body: "Forbidden", events: [] },
    },
    {
      name: "answers a submission identity refuses without spending the limit",
      headers: { token: true },
      body: `name=Jane&${SOLVED}`,
      expected: { status: 401, body: "Unauthorized", events: ["identify:none"] },
    },
    {
      name: "answers an over-limit submission 429 without calling siteverify or the handler",
      headers: { user: "alice", token: true },
      body: `name=Jane&${SOLVED}`,
      admits: false,
      expected: { status: 429, body: "Too many requests. Please try again later.", events: ["identify:alice", "limit:alice"] },
    },
    {
      name: "spends the limit on a submission Turnstile then trips",
      headers: { user: "alice", token: true },
      body: `name=Jane&${TURNSTILE_FIELD_DEFAULT}=bad-token`,
      humanVerified: false,
      expected: { status: 422, body: refusal("name"), events: ["identify:alice", "limit:alice", "siteverify"] },
    },
    {
      name: "spends the limit on a submission the schema then refuses",
      headers: { user: "alice", token: true },
      body: `name=&${SOLVED}`,
      expected: { status: 422, body: refusal("name"), events: ["identify:alice", "limit:alice", "siteverify"] },
    },
    {
      name: "answers an over-limit schema-invalid submission 429 rather than its field errors",
      headers: { user: "alice", token: true },
      body: `name=&${SOLVED}`,
      admits: false,
      expected: { status: 429, body: "Too many requests. Please try again later.", events: ["identify:alice", "limit:alice"] },
    },
    {
      name: "answers an unparseable body 400 without spending the limit",
      headers: { user: "alice", token: true, contentType: "application/json" },
      body: JSON.stringify({ name: "Jane" }),
      expected: { status: 400, body: UNPARSEABLE_FRAGMENT, events: ["identify:alice"] },
    },
  ];

  for (const { name, headers, body, admits = true, humanVerified = true, expected } of cases) {
    it(name, async () => {
      const events: string[] = [];
      siteverifyAnswering(events, humanVerified);
      const app = stagedApp(events);
      const init: RequestInit = {
        method: "POST",
        headers: {
          "content-type": headers.contentType ?? "application/x-www-form-urlencoded",
          ...(headers.user === undefined ? {} : { "x-user": headers.user }),
          ...(headers.token ? { "x-csrf-token": await createCsrfToken(ring, "/test") } : {}),
        },
        body,
      };

      const res = await app.request("/test", init, limiterEnv(events, admits));

      expect({ status: res.status, body: await res.text(), events }).toEqual(expected);
    });
  }

  it("answers the stage's 429 with Retry-After set to the chain's declared period", async () => {
    const events: string[] = [];
    const app = stagedApp(events, { SUBMISSIONS: { limit: 3, period: 900 } });
    const token = await createCsrfToken(ring, "/test");

    const res = await app.request(
      "/test",
      { method: "POST", headers: { ...FORM_HEADERS, "x-user": "alice", "x-csrf-token": token }, body: `name=Jane&${SOLVED}` },
      limiterEnv(events, false),
    );

    expect({ status: res.status, retryAfter: res.headers.get("Retry-After") }).toEqual({ status: 429, retryAfter: "900" });
  });

  it("answers 503 without handling the submission when the limit's binding is absent", async () => {
    const events: string[] = [];
    siteverifyAnswering(events, true);
    const app = stagedApp(events);
    const token = await createCsrfToken(ring, "/test");

    const res = await app.request(
      "/test",
      { method: "POST", headers: { ...FORM_HEADERS, "x-user": "alice", "x-csrf-token": token }, body: `name=Jane&${SOLVED}` },
      {},
    );

    expect({ status: res.status, body: await res.text(), events }).toEqual({
      status: 503,
      body: "Service Unavailable",
      events: ["identify:alice"],
    });
  });

  it("fails the request, naming the binding, rather than spending when the limit's binding is not in the chain's rateLimits", async () => {
    const events: string[] = [];
    let thrown: Error | undefined;
    siteverifyAnswering(events, true);
    const app = stagedApp(events, { OTHER_LIMIT: { limit: 5, period: 60 } }, (error) => {
      thrown = error;
      return new Response("failed", { status: 500 });
    });
    const token = await createCsrfToken(ring, "/test");

    const res = await app.request(
      "/test",
      { method: "POST", headers: { ...FORM_HEADERS, "x-user": "alice", "x-csrf-token": token }, body: `name=Jane&${SOLVED}` },
      limiterEnv(events, true),
    );

    expect({ status: res.status, events }).toEqual({ status: 500, events: ["identify:alice"] });
    expect(thrown?.message).toContain('"SUBMISSIONS"');
  });
});
