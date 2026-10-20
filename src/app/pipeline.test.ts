import { afterEach, describe, expect, it } from "bun:test";

import { TURNSTILE_FIELD_DEFAULT } from "../form/constants";
import { createTestContext } from "../testing/context";
import { mapHandler } from "../testing/route";
import { v } from "../validation/validation";
import { defineAction } from "./action";
import { Forge } from "./forge-app";
import { firstDeclaredField, screenTurnstile } from "./pipeline";
import type { ActionTurnstileOptions } from "./types";

const NameSchema = v.strictObject({ name: v.pipe(v.string(), v.minLength(1, "Name required.")) });
const FORM_HEADERS = { "content-type": "application/x-www-form-urlencoded" };

type Requestable = { request(path: string, init: RequestInit): Promise<Response> };

function makeApp(action: ReturnType<typeof defineAction>) {
  const app = new Forge();
  mapHandler(app, "POST", "/test", action);
  return app;
}

function post(app: Requestable, body: string, path = "/test"): Promise<Response> {
  return app.request(path, { method: "POST", headers: FORM_HEADERS, body });
}

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
      defineAction({
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

    const res = await post(app, `name=Jane&${TURNSTILE_FIELD_DEFAULT}=solved-token`);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(ACTION_500_FRAGMENT);
    expect(verified).toBe(false);
  });

  it("hands a throwing secretKey's error to onError", async () => {
    let captured: Error | undefined;
    const app = makeApp(
      defineAction({
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

    const res = await post(app, `name=Jane&${TURNSTILE_FIELD_DEFAULT}=solved-token`);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("custom 500");
    expect(captured?.message).toBe("secret binding missing");
  });

  it("lets an async-rejecting secretKey reach the same arm", async () => {
    const app = makeApp(
      defineAction({
        schema: NameSchema,
        turnstile: { secretKey: () => Promise.reject(new Error("secret lookup rejected")), verify: () => ({ expectedHostname: "localhost" }) },
        handle: () => new Response("success"),
      }),
    );

    const res = await post(app, `name=Jane&${TURNSTILE_FIELD_DEFAULT}=solved-token`);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(ACTION_500_FRAGMENT);
  });

  it("lets a throwing verify reach the 500 arm", async () => {
    let captured: Error | undefined;
    const app = makeApp(
      defineAction({
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

    const res = await post(app, `name=Jane&${TURNSTILE_FIELD_DEFAULT}=solved-token`);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("custom 500");
    expect(captured?.message).toBe("hostname resolver exploded");
  });

  it("logs a throwing resolver, because a route defect is the operator's to see", async () => {
    const app = makeApp(
      defineAction({
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

    const logs = await captureLogs(() => post(app, `name=Jane&${TURNSTILE_FIELD_DEFAULT}=solved-token`));
    expect(logs.some((line) => line.includes("Action threw"))).toBe(true);
  });

  it("logs every tripped turnstile guard with its reason, not only an unreachable siteverify", async () => {
    const app = makeApp(
      defineAction({
        schema: NameSchema,
        turnstile: { secretKey: () => "test-secret", verify: () => ({ expectedHostname: "localhost" }) },
        handle: () => new Response("success"),
      }),
    );

    const logs = await captureLogs(() => post(app, "name=Jane"));
    expect(logs.some((line) => line.includes("Submission refused by a bot guard") && line.includes("missing-token"))).toBe(true);
  });

  it("names the guard that refused on the same line", async () => {
    const app = makeApp(
      defineAction({
        schema: NameSchema,
        turnstile: { secretKey: () => "test-secret", verify: () => ({ expectedHostname: "localhost" }) },
        handle: () => new Response("success"),
      }),
    );

    const logs = await captureLogs(() => post(app, "name=Jane"));
    expect(logs.some((line) => line.includes("Submission refused by a bot guard") && line.includes("turnstile"))).toBe(true);
  });

  it("still reaches handle through resolvers that do not throw", async () => {
    fakeSiteverify(async () => new Response(JSON.stringify({ success: true, hostname: "localhost" })));

    const app = makeApp(
      defineAction({
        schema: NameSchema,
        turnstile: { secretKey: () => "test-secret", verify: () => ({ expectedHostname: "localhost" }) },
        handle: (data) => new Response(data.name),
      }),
    );

    const res = await post(app, `name=Jane&${TURNSTILE_FIELD_DEFAULT}=solved-token`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Jane");
  });
});

describe("createSubmissionPipeline — an async-rejecting hook", () => {
  it("absorbs a rejected onValidationError into the 500 arm, exactly as a synchronous throw", async () => {
    const app = makeApp(
      defineAction({
        schema: NameSchema,
        handle: () => new Response("success"),
        onValidationError: () => Promise.reject(new Error("formatter rejected")),
      }),
    );

    const res = await post(app, "name=");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(ACTION_500_FRAGMENT);
  });

  it("hands a rejected onValidationError's error to onError", async () => {
    let captured: Error | undefined;
    const app = makeApp(
      defineAction({
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

    const res = await post(app, "name=");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("custom 500");
    expect(captured?.message).toBe("formatter rejected");
  });

  it("logs a rejected onValidationError on the same line a throwing one produces", async () => {
    const app = makeApp(
      defineAction({
        schema: NameSchema,
        handle: () => new Response("success"),
        onValidationError: () => Promise.reject(new Error("formatter rejected")),
      }),
    );

    const logs = await captureLogs(() => post(app, "name="));
    expect(logs.some((line) => line.includes("Action threw"))).toBe(true);
  });

  it("absorbs a rejected onBotDetected into the same arm", async () => {
    const app = makeApp(
      defineAction({
        schema: NameSchema,
        turnstile: { secretKey: () => "test-secret", verify: () => ({ expectedHostname: "localhost" }) },
        handle: () => new Response("success"),
        onBotDetected: () => Promise.reject(new Error("ban list unavailable")),
      }),
    );

    const res = await post(app, "name=Jane");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(ACTION_500_FRAGMENT);
  });

  it("still renders an async onValidationError that resolves", async () => {
    const app = makeApp(
      defineAction({
        schema: NameSchema,
        handle: () => new Response("success"),
        onValidationError: async (issues) => new Response(issues.map((issue) => issue.message).join("|"), { status: 422 }),
      }),
    );

    const res = await post(app, "name=");
    expect(res.status).toBe(422);
    expect(await res.text()).toBe("Name required.");
  });
});

/** The Turnstile lines a run logged, each parsed and stripped of its timestamp and prefix. */
function botGuardLines(lines: readonly string[]): unknown[] {
  return lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((record) => record.message === "Submission refused by a bot guard")
    .map(({ timestamp: _timestamp, prefix: _prefix, ...record }) => record);
}

function tokenForm(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

describe("screenTurnstile", () => {
  it("refuses a form carrying no token as missing-token, logging the guard and the reason at warn", async () => {
    const c = createTestContext(new Request("http://test/submit", { method: "POST" }));
    let result: unknown;

    const logs = await captureLogs(async () => {
      result = await screenTurnstile(c, tokenForm({ name: "Jane" }), "test-secret", {
        expectedHostname: "localhost",
        tokenField: "cf-turnstile-response",
      });
    });

    expect({ result, logged: botGuardLines(logs) }).toEqual({
      result: { ok: false, error: "missing-token" },
      logged: [{ level: "warn", message: "Submission refused by a bot guard", guard: "turnstile", reason: "missing-token" }],
    });
  });

  it("admits a token siteverify accepts and logs nothing about it", async () => {
    fakeSiteverify(async () => new Response(JSON.stringify({ success: true, hostname: "localhost" })));
    const c = createTestContext(new Request("http://test/submit", { method: "POST" }));
    let result: unknown;

    const logs = await captureLogs(async () => {
      result = await screenTurnstile(c, tokenForm({ "cf-turnstile-response": "solved" }), "test-secret", {
        expectedHostname: "localhost",
        tokenField: "cf-turnstile-response",
      });
    });

    expect({ result, logged: botGuardLines(logs) }).toEqual({ result: { ok: true, data: undefined }, logged: [] });
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
      defineAction({
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
