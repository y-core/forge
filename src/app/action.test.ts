import { afterEach, describe, expect, it } from "bun:test";

import type { Middleware } from "@remix-run/fetch-router";

import { contextVar } from "../context/accessor";
import type { Refusal, RefuseHook } from "../context/types";
import { importKeyRing } from "../crypto/keyring/ring";
import type { KeyRing } from "../crypto/keyring/types";
import { CSRF_FIELD_DEFAULT, TURNSTILE_FIELD_DEFAULT } from "../form/constants";
import { createCsrfToken, csrfMintStage } from "../form/csrf";
import { parseFormData } from "../form/parse-form-data";
import { TURNSTILE_TEST_KEYS } from "../form/turnstile-keys";
import { requestLog } from "../logging/request-logger";
import { post } from "../router/mod";
import type { RateLimit, RateLimitOptions } from "../security/types";
import { mockExecutionContext } from "../testing/context";
import { captureLogs } from "../testing/logs";
import { attrOf, elementOf, innerOf } from "../testing/markup";
import { mapHandler } from "../testing/route";
import type { CapturedLogs, TestAction } from "../testing/types";
import { v } from "../validation/validation";
import { createApp } from "./app";
import { Forge } from "./forge-app";
import { createHandlerFactory } from "./handler-factory";
import { applyMiddlewareChain } from "./middleware-chain";

const { defineAction } = createHandlerFactory();
const TEST_ROUTE = post("/test");

const CSRF_HEX_KEY = "9c55dd3f0812c671dc6d905ab7941deebb36feefbbfe4ba28bd37ae08287a9cf";

const NameSchema = v.strictObject({ name: v.pipe(v.string(), v.minLength(1, "Name required.")) });

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

const VALID_FORM = new URLSearchParams({ name: "Jane" });
const FORM_HEADERS = { "content-type": "application/x-www-form-urlencoded" };

type Requestable = { request(path: string, init: RequestInit): Promise<Response> };

function submit(app: Requestable, body: string, path = "/test"): Promise<Response> {
  return app.request(path, { method: "POST", headers: FORM_HEADERS, body });
}

function refusal(...fields: readonly string[]): string {
  const items = fields.map((field) => `<li>${field}</li>`).join("");
  return `<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground" data-announce-failure="Please correct the following fields."><p>Please correct the following fields.</p><ul class="mt-2 list-disc ps-5">${items}</ul></div>`;
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

describe("defineAction", () => {
  it("runs full pipeline successfully", async () => {
    const app = makeApp(defineAction(TEST_ROUTE, { schema: NameSchema, handle: () => new Response("success") }));

    const res = await app.request("/test", { method: "POST", headers: FORM_HEADERS, body: VALID_FORM.toString() });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("success");
  });

  it("returns validation error fragment when validation fails", async () => {
    const app = makeApp(defineAction(TEST_ROUTE, { schema: NameSchema, handle: () => new Response("success") }));

    const res = await app.request("/test", { method: "POST", headers: FORM_HEADERS, body: "name=" });
    expect(res.status).toBe(422);
    expect(await res.text()).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground" data-announce-failure="Please correct the following fields."><p>Please correct the following fields.</p><ul class="mt-2 list-disc ps-5"><li>name</li></ul></div>',
    );
  });

  it("returns 400 when body cannot be parsed as form data", async () => {
    const app = makeApp(defineAction(TEST_ROUTE, { schema: NameSchema, handle: () => new Response("success") }));

    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Jane" }),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground" data-announce-failure="Unable to process the form data. Please try again."><p>Unable to process the form data. Please try again.</p></div>',
    );
  });

  it("calls onValidationError when provided", async () => {
    const app = makeApp(
      defineAction(TEST_ROUTE, {
        schema: NameSchema,
        handle: () => new Response("success"),
        onValidationError: () => new Response("custom error", { status: 422 }),
      }),
    );

    const res = await app.request("/test", { method: "POST", headers: FORM_HEADERS, body: "name=" });
    expect(res.status).toBe(422);
    expect(await res.text()).toBe("custom error");
  });

  it("hands onValidationError the issues themselves, so the app decides how much travels back", async () => {
    const app = makeApp(
      defineAction(TEST_ROUTE, {
        schema: NameSchema,
        handle: () => new Response("success"),
        onValidationError: (issues) => new Response(issues.map((issue) => issue.message).join("|"), { status: 422 }),
      }),
    );

    const res = await app.request("/test", { method: "POST", headers: FORM_HEADERS, body: "name=" });
    expect(await res.text()).toBe("Name required.");
  });

  it("returns 500 fragment when handler throws", async () => {
    const app = makeApp(
      defineAction(TEST_ROUTE, {
        schema: NameSchema,
        handle: () => {
          throw new Error("downstream failure");
        },
      }),
    );

    const res = await app.request("/test", { method: "POST", headers: FORM_HEADERS, body: VALID_FORM.toString() });
    expect(res.status).toBe(500);
  });

  it("marks its generic 500 fragment as a failure fragment, so the client runtime swaps it", async () => {
    const app = makeApp(
      defineAction(TEST_ROUTE, {
        schema: NameSchema,
        handle: () => {
          throw new Error("downstream failure");
        },
      }),
    );

    const res = await submit(app, VALID_FORM.toString());

    expect({ status: res.status, marker: res.headers.get("Forge-Failure-Fragment") }).toEqual({ status: 500, marker: "1" });
  });

  it("leaves the marker off a 500 its onError returns, and off a 422, which swaps unmarked", async () => {
    const recovered = makeApp(
      defineAction(TEST_ROUTE, {
        schema: NameSchema,
        handle: () => {
          throw new Error("oops");
        },
        onError: () => new Response("custom 500", { status: 500 }),
      }),
    );
    const invalid = makeApp(defineAction(TEST_ROUTE, { schema: NameSchema, handle: () => new Response("ok") }));

    const answers = [await submit(recovered, VALID_FORM.toString()), await submit(invalid, "name=")];

    expect(answers.map((res) => [res.status, res.headers.has("Forge-Failure-Fragment")])).toEqual([
      [500, false],
      [422, false],
    ]);
  });

  it("passes on the marker an onError sets on its own 500, so an app opts its fragment into the swap", async () => {
    const app = makeApp(
      defineAction(TEST_ROUTE, {
        schema: NameSchema,
        handle: () => {
          throw new Error("oops");
        },
        onError: () =>
          new Response("<p>We could not save that.</p>", { status: 500, headers: { "content-type": "text/html", "Forge-Failure-Fragment": "1" } }),
      }),
    );

    const res = await submit(app, VALID_FORM.toString());

    expect({ status: res.status, marker: res.headers.get("Forge-Failure-Fragment"), body: await res.text() }).toEqual({
      status: 500,
      marker: "1",
      body: "<p>We could not save that.</p>",
    });
  });

  it("leaves the marker off the uncaught-error page the boundary answers", async () => {
    const app = createApp();
    mapHandler(app, "POST", "/test", () => {
      throw new Error("kaboom");
    });

    const res = await submit(app, VALID_FORM.toString());

    expect({ status: res.status, marker: res.headers.has("Forge-Failure-Fragment") }).toEqual({ status: 500, marker: false });
  });

  it("calls onError when handler throws and onError is provided", async () => {
    const app = makeApp(
      defineAction(TEST_ROUTE, {
        schema: NameSchema,
        handle: () => {
          throw new Error("oops");
        },
        onError: () => new Response("custom 500", { status: 500 }),
      }),
    );

    const res = await app.request("/test", { method: "POST", headers: FORM_HEADERS, body: VALID_FORM.toString() });
    expect(await res.text()).toBe("custom 500");
  });

  it("runs controller middleware before the action", async () => {
    const order: string[] = [];
    const app = new Forge();
    mapHandler(app, "POST", "/test", {
      middleware: [
        async (_c, next) => {
          order.push("mw");
          return next();
        },
      ],
      handler: defineAction(TEST_ROUTE, {
        schema: NameSchema,
        handle: () => {
          order.push("handle");
          return new Response("ok");
        },
      }),
    });

    await app.request("/test", { method: "POST", headers: FORM_HEADERS, body: VALID_FORM.toString() });
    expect(order).toEqual(["mw", "handle"]);
  });

  it("returns 413 when the form body exceeds the default size limit", async () => {
    const app = makeApp(defineAction(TEST_ROUTE, { schema: NameSchema, handle: () => new Response("success") }));
    const res = await app.request("/test", {
      method: "POST",
      headers: FORM_HEADERS,
      // 100 KB default limit; this body is ~200 KB.
      body: `name=${"x".repeat(200_000)}`,
    });
    expect(res.status).toBe(413);
  });

  it("rejects an oversized streaming body (no Content-Length) with the exact 413 fragment", async () => {
    const app = makeApp(defineAction(TEST_ROUTE, { schema: NameSchema, handle: () => new Response("success") }));
    const big = `name=${"x".repeat(200_000)}`;
    const bytes = new TextEncoder().encode(big);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });

    const res = await app.request("/test", { method: "POST", headers: FORM_HEADERS, body: stream, duplex: "half" } as unknown as RequestInit);

    expect(res.status).toBe(413);
    expect(await res.text()).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground" data-announce-failure="The submitted form is too large. Please reduce its size and try again."><p>The submitted form is too large. Please reduce its size and try again.</p></div>',
    );
  });

  it("accepts a body above the default cap when the route raises maxBytes", async () => {
    const app = makeApp(
      defineAction(TEST_ROUTE, { maxBytes: 300 * 1024, schema: NameSchema, handle: (data) => new Response(String(data.name.length)) }),
    );

    const res = await app.request("/test", { method: "POST", headers: FORM_HEADERS, body: `name=${"x".repeat(200_000)}` });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("200000");
  });

  it("still returns 413 for a body above the route's own raised cap", async () => {
    const app = makeApp(defineAction(TEST_ROUTE, { maxBytes: 150 * 1024, schema: NameSchema, handle: () => new Response("success") }));

    const res = await app.request("/test", { method: "POST", headers: FORM_HEADERS, body: `name=${"x".repeat(200_000)}` });
    expect(res.status).toBe(413);
  });

  it("logs to the context's request logger, as the action, when the handler throws", async () => {
    const capture = captureLogs();
    const app = makeApp(
      defineAction(TEST_ROUTE, {
        schema: NameSchema,
        handle: () => {
          throw new Error("boom downstream");
        },
      }),
      capture,
    );
    await app.request("/test", { method: "POST", headers: FORM_HEADERS, body: VALID_FORM.toString() });
    expect(capture.records.map(({ message, data }) => ({ message, source: data?.source }))).toStrictEqual([
      { message: "Action threw", source: "action" },
    ]);
  });
});

describe("defineAction — every failure fragment is marked for the announcer", () => {
  const throwing = () => {
    throw new Error("boom downstream");
  };
  const cases = [
    {
      name: "an unparseable body",
      status: 400,
      init: { headers: { "content-type": "application/json" }, body: '{"name":"Jane"}' },
      handle: () => new Response("success"),
    },
    {
      name: "an oversized body",
      status: 413,
      init: { headers: FORM_HEADERS, body: `name=${"x".repeat(200_000)}` },
      handle: () => new Response("success"),
    },
    { name: "a schema refusal", status: 422, init: { headers: FORM_HEADERS, body: "name=" }, handle: () => new Response("success") },
    { name: "a throwing handler", status: 500, init: { headers: FORM_HEADERS, body: VALID_FORM.toString() }, handle: throwing },
  ];

  for (const { name, status, init, handle } of cases) {
    it(`announces exactly the lead it shows on ${name} (${status})`, async () => {
      const app = makeApp(defineAction(TEST_ROUTE, { schema: NameSchema, handle }));

      const res = await app.request("/test", { method: "POST", ...init });
      const body = await res.text();
      const announced = attrOf(body, "data-announce-failure");

      expect({ status: res.status, marked: announced !== "", announced }).toEqual({
        status,
        marked: true,
        announced: innerOf(elementOf(body, "p")),
      });
    });
  }
});

describe("defineAction — a throwing schema or hook", () => {
  const ThrowingTransform = v.strictObject({
    payload: v.pipe(
      v.string(),
      v.transform((raw) => JSON.parse(raw) as unknown),
    ),
  });
  const ThrowingCheck = v.strictObject({
    name: v.pipe(
      v.string(),
      v.check<string>(() => {
        throw new Error("check exploded");
      }),
    ),
  });

  it("answers 500 with the generic fragment when a v.transform throws", async () => {
    const app = makeApp(defineAction(TEST_ROUTE, { schema: ThrowingTransform, handle: () => new Response("success") }));

    const res = await submit(app, "payload=notjson");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground" data-announce-failure="Something went wrong. Please try again."><p>Something went wrong. Please try again.</p></div>',
    );
  });

  it("hands a throwing v.transform's error to onError", async () => {
    let captured: Error | undefined;
    const app = makeApp(
      defineAction(TEST_ROUTE, {
        schema: ThrowingTransform,
        handle: () => new Response("success"),
        onError: (error) => {
          captured = error;
          return new Response("custom 500", { status: 500 });
        },
      }),
    );

    const res = await submit(app, "payload=notjson");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("custom 500");
    expect(captured instanceof Error).toBe(true);
    expect(captured?.name).toBe("SyntaxError");
  });

  it("logs a throwing v.transform, because a schema defect is the operator's to see", async () => {
    const capture = captureLogs();
    const app = makeApp(defineAction(TEST_ROUTE, { schema: ThrowingTransform, handle: () => new Response("success") }), capture);
    await submit(app, "payload=notjson");
    expect(capture.records.map((record) => record.message)).toContain("Action threw");
  });

  it("answers 500 when a v.check predicate throws", async () => {
    const app = makeApp(defineAction(TEST_ROUTE, { schema: ThrowingCheck, handle: () => new Response("success") }));

    const res = await submit(app, "name=Jane");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground" data-announce-failure="Something went wrong. Please try again."><p>Something went wrong. Please try again.</p></div>',
    );
  });

  it("hands a throwing v.check's error to onError", async () => {
    let captured: Error | undefined;
    const app = makeApp(
      defineAction(TEST_ROUTE, {
        schema: ThrowingCheck,
        handle: () => new Response("success"),
        onError: (error) => {
          captured = error;
          return new Response("custom 500", { status: 500 });
        },
      }),
    );

    const res = await submit(app, "name=Jane");
    expect(res.status).toBe(500);
    expect(captured?.message).toBe("check exploded");
  });

  it("logs a throwing v.check", async () => {
    const capture = captureLogs();
    const app = makeApp(defineAction(TEST_ROUTE, { schema: ThrowingCheck, handle: () => new Response("success") }), capture);
    await submit(app, "name=Jane");
    expect(capture.records.map((record) => record.message)).toContain("Action threw");
  });

  it("absorbs a throwing onValidationError into the same 500 path, deliberately and symmetrically", async () => {
    let captured: Error | undefined;
    const app = makeApp(
      defineAction(TEST_ROUTE, {
        schema: NameSchema,
        handle: () => new Response("success"),
        onValidationError: () => {
          throw new Error("formatter exploded");
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
    expect(captured?.message).toBe("formatter exploded");
  });

  it("answers 500 for a throwing onValidationError with no onError supplied", async () => {
    const app = makeApp(
      defineAction(TEST_ROUTE, {
        schema: NameSchema,
        handle: () => new Response("success"),
        onValidationError: () => {
          throw new Error("formatter exploded");
        },
      }),
    );

    const res = await submit(app, "name=");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground" data-announce-failure="Something went wrong. Please try again."><p>Something went wrong. Please try again.</p></div>',
    );
  });

  it("still reaches handle through a transform that does not throw", async () => {
    const app = makeApp(defineAction(TEST_ROUTE, { schema: ThrowingTransform, handle: (data) => new Response(JSON.stringify(data.payload)) }));

    const res = await submit(app, `payload=${encodeURIComponent('{"ok":true}')}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"ok":true}');
  });
});

describe("defineAction — what reaches the schema", () => {
  it("refuses a field nobody declared", async () => {
    const app = makeApp(
      defineAction(TEST_ROUTE, {
        schema: NameSchema,
        handle: () => new Response("success"),
        onValidationError: (issues) => new Response(issues.map((issue) => issue.type).join("|"), { status: 400 }),
      }),
    );

    const res = await app.request("/test", { method: "POST", headers: FORM_HEADERS, body: "name=Jane&nobody_asked=1" });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("strict_object");
  });

  it("lets an absent optional field reach the schema as absent rather than as an empty string", async () => {
    const Schema = v.strictObject({ name: v.string(), phone: v.optional(v.string()) });
    const app = makeApp(defineAction(TEST_ROUTE, { schema: Schema, handle: (data) => new Response(String(data.phone)) }));

    const res = await app.request("/test", { method: "POST", headers: FORM_HEADERS, body: "name=Jane" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("undefined");
  });

  it("distinguishes a field submitted empty from one not submitted at all", async () => {
    const Schema = v.strictObject({ name: v.string(), phone: v.optional(v.string()) });
    const app = makeApp(defineAction(TEST_ROUTE, { schema: Schema, handle: (data) => new Response(String(data.phone)) }));

    const res = await app.request("/test", { method: "POST", headers: FORM_HEADERS, body: "name=Jane&phone=" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("hands a repeated key to the schema as an array, so a scalar schema refuses it", async () => {
    const app = makeApp(
      defineAction(TEST_ROUTE, {
        schema: NameSchema,
        handle: () => new Response("success"),
        onValidationError: (issues) => new Response(issues.map((issue) => issue.type).join("|"), { status: 400 }),
      }),
    );

    const res = await app.request("/test", { method: "POST", headers: FORM_HEADERS, body: "name=Jane&name=Alex" });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("string");
  });

  it("accepts a repeated key when the schema declares an array", async () => {
    const Schema = v.strictObject({ tag: v.array(v.string()) });
    const app = makeApp(defineAction(TEST_ROUTE, { schema: Schema, handle: (data) => new Response(data.tag.join(",")) }));

    const res = await app.request("/test", { method: "POST", headers: FORM_HEADERS, body: "tag=a&tag=b" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("a,b");
  });

  it("does not let a caller-sent __proto__ mutate a prototype or reach the handler", async () => {
    let handled = false;
    const app = makeApp(
      defineAction(TEST_ROUTE, {
        schema: NameSchema,
        handle: () => {
          handled = true;
          return new Response("success");
        },
      }),
    );

    const res = await app.request("/test", { method: "POST", headers: FORM_HEADERS, body: "name=Jane&__proto__=polluted" });
    expect(res.status).toBe(422);
    expect(handled).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  for (const inherited of ["__proto__", "constructor", "toString", "valueOf"]) {
    it(`refuses an undeclared ${inherited} as the undeclared key it is`, async () => {
      const app = makeApp(
        defineAction(TEST_ROUTE, {
          schema: NameSchema,
          handle: () => new Response("success"),
          onValidationError: (issues) => new Response(issues.map((issue) => issue.type).join("|"), { status: 400 }),
        }),
      );

      const res = await submit(app, `name=Jane&${encodeURIComponent(inherited)}=sent`);
      expect(res.status).toBe(400);
      expect(await res.text()).toBe("strict_object");
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    });
  }

  it("reads a schema field named constructor as absent when the caller did not send it", async () => {
    const Schema = v.strictObject({ name: v.string(), constructor: v.string() });
    const app = makeApp(
      defineAction(TEST_ROUTE, {
        schema: Schema,
        handle: () => new Response("success"),
        onValidationError: (issues) => new Response(issues.map((issue) => issue.message).join("|"), { status: 400 }),
      }),
    );

    const res = await submit(app, "name=Jane");
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('Invalid key: Expected "constructor" but received undefined');
  });

  it("satisfies v.optional on a schema field named constructor by omission", async () => {
    const Schema = v.strictObject({ name: v.string(), constructor: v.optional(v.string()) });
    const app = makeApp(defineAction(TEST_ROUTE, { schema: Schema, handle: (data) => new Response(Object.keys(data).join(",")) }));

    const res = await submit(app, "name=Jane");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("name");
  });

  it("carries a submitted field named constructor through to handle as the submitted value", async () => {
    const Schema = v.strictObject({ name: v.string(), constructor: v.string() });
    const app = makeApp(defineAction(TEST_ROUTE, { schema: Schema, handle: (data) => new Response(data.constructor) }));

    const res = await submit(app, "name=Jane&constructor=Acme%20Builders");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Acme Builders");
  });
});

describe("defineAction behind a CSRF policy — body size cap", () => {
  const RAISED = 300 * 1024;

  function echoAction(maxBytes?: number) {
    return defineAction(TEST_ROUTE, {
      ...(maxBytes !== undefined ? { maxBytes } : {}),
      schema: NameSchema,
      handle: (data) => new Response(String(data.name.length)),
    });
  }

  async function guardedBody(path: string, ring: KeyRing, payloadLength: number): Promise<string> {
    const token = await createCsrfToken(ring, path);
    return `${CSRF_FIELD_DEFAULT}=${token}&name=${"x".repeat(payloadLength)}`;
  }

  it("accepts a body over the default cap when the route and its guard both raise maxBytes", async () => {
    const ring = await importKeyRing([CSRF_HEX_KEY]);
    const app = new Forge();
    app.use("/upload", csrfMintStage({ ring: () => ring, subject: false, maxBytes: RAISED }));
    mapHandler(app, "POST", "/upload", echoAction(RAISED));

    const res = await app.request("/upload", { method: "POST", headers: FORM_HEADERS, body: await guardedBody("/upload", ring, 200_000) });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("200000");
  });

  it("answers 413 rather than a misleading 403 when the body exceeds the guard's cap", async () => {
    const ring = await importKeyRing([CSRF_HEX_KEY]);
    const app = new Forge();
    app.use("/upload", csrfMintStage({ ring: () => ring, subject: false }));
    mapHandler(app, "POST", "/upload", echoAction());

    const res = await app.request("/upload", { method: "POST", headers: FORM_HEADERS, body: await guardedBody("/upload", ring, 200_000) });
    expect(res.status).toBe(413);
    expect(await res.text()).toBe("Payload Too Large");
  });

  it("keeps a genuine token failure on 403 when the body is within the cap", async () => {
    const ring = await importKeyRing([CSRF_HEX_KEY]);
    const app = new Forge();
    app.use("/upload", csrfMintStage({ ring: () => ring, subject: false }));
    mapHandler(app, "POST", "/upload", echoAction());

    const res = await app.request("/upload", { method: "POST", headers: FORM_HEADERS, body: "name=Jane" });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it("keeps two routes with different caps independent within the same isolate", async () => {
    const ring = await importKeyRing([CSRF_HEX_KEY]);
    const app = new Forge();
    app.use("*", csrfMintStage({ ring: () => ring, subject: false, maxBytes: RAISED }));
    mapHandler(app, "POST", "/big", echoAction(RAISED));
    mapHandler(app, "POST", "/small", echoAction());

    const first = await app.request("/big", { method: "POST", headers: FORM_HEADERS, body: await guardedBody("/big", ring, 200_000) });
    expect(first.status).toBe(200);

    const strict = await app.request("/small", { method: "POST", headers: FORM_HEADERS, body: await guardedBody("/small", ring, 200_000) });
    expect(strict.status).toBe(413);

    const again = await app.request("/big", { method: "POST", headers: FORM_HEADERS, body: await guardedBody("/big", ring, 200_000) });
    expect(again.status).toBe(200);
  });

  // Without the rethrow the pipeline answers a 400 fragment and never logs what threw, so the route
  // looks like it is refusing bad input rather than being mis-wired.
  it("rethrows a cap conflict to the error boundary rather than answering a 400 fragment", async () => {
    const app = new Forge();
    app.use("*", async (c, next) => {
      await parseFormData(c, { maxBytes: 64 }).catch(() => {});
      return next();
    });
    mapHandler(app, "POST", "/upload", echoAction(RAISED));

    const res = await app.request("/upload", { method: "POST", headers: FORM_HEADERS, body: `name=${"x".repeat(200)}` });
    expect(res.status).toBe(500);
  });

  it("still answers a genuine oversize body with the pipeline's 413 fragment", async () => {
    const app = new Forge();
    mapHandler(app, "POST", "/upload", echoAction(64));

    const res = await app.request("/upload", { method: "POST", headers: FORM_HEADERS, body: `name=${"x".repeat(200)}` });
    expect(res.status).toBe(413);
  });
});

describe("defineAction — bot guards", () => {
  function turnstileApp(tokenField?: string, capture?: CapturedLogs) {
    return makeApp(
      defineAction(TEST_ROUTE, {
        schema: NameSchema,
        turnstile: {
          secretKey: () => "test-secret",
          ...(tokenField !== undefined ? { tokenField } : {}),
          verify: () => ({ expectedHostname: "localhost" }),
        },
        handle: (data) => new Response(Object.keys(data).join(",")),
      }),
      capture,
    );
  }

  it("hands onBotDetected the turnstile rejection instead of rendering the refusal", async () => {
    fakeSiteverify(async () => new Response(JSON.stringify({ success: false })));

    let rejection: unknown;
    const app = makeApp(
      defineAction(TEST_ROUTE, {
        schema: NameSchema,
        turnstile: { secretKey: () => "test-secret", verify: () => ({ expectedHostname: "localhost" }) },
        onBotDetected: (received) => {
          rejection = received;
          return new Response("banned", { status: 403 });
        },
        handle: () => new Response("success"),
      }),
    );

    const res = await submit(app, `name=Jane&${TURNSTILE_FIELD_DEFAULT}=bad-token`);
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("banned");
    expect(rejection).toEqual({ guard: "turnstile", reason: "verification-failed" });
  });

  it("does not reach onBotDetected when Turnstile passes", async () => {
    fakeSiteverify(async () => new Response(JSON.stringify({ success: true, hostname: "localhost" })));

    let called = false;
    const app = makeApp(
      defineAction(TEST_ROUTE, {
        schema: NameSchema,
        turnstile: { secretKey: () => "test-secret", verify: () => ({ expectedHostname: "localhost" }) },
        onBotDetected: () => {
          called = true;
          return new Response("banned", { status: 403 });
        },
        handle: () => new Response("success"),
      }),
    );

    const res = await submit(app, `name=Jane&${TURNSTILE_FIELD_DEFAULT}=solved-token`);
    expect(res.status).toBe(200);
    expect(called).toBe(false);
  });

  it("accepts a cf-turnstile-response body against a v.strictObject that never declares the token field", async () => {
    fakeSiteverify(async () => new Response(JSON.stringify({ success: true, hostname: "localhost" })));

    const res = await submit(turnstileApp(), `name=Jane&${TURNSTILE_FIELD_DEFAULT}=solved-token`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("name");
  });

  it("strips a renamed Turnstile token field without the route declaring it twice", async () => {
    fakeSiteverify(async () => new Response(JSON.stringify({ success: true, hostname: "localhost" })));

    const res = await submit(turnstileApp("my-token"), "name=Jane&my-token=solved-token");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("name");
  });

  it("sends the token from the renamed field to siteverify", async () => {
    let sent: string | undefined;
    fakeSiteverify(async (init) => {
      sent = init?.body as string;
      return new Response(JSON.stringify({ success: true, hostname: "localhost" }));
    });

    await submit(turnstileApp("my-token"), "name=Jane&my-token=solved-token");
    expect(JSON.parse(sent!)).toEqual({ response: "solved-token", secret: "test-secret" });
  });

  it("refuses a submission Turnstile rejects", async () => {
    fakeSiteverify(async () => new Response(JSON.stringify({ success: false })));

    const res = await submit(turnstileApp(), `name=Jane&${TURNSTILE_FIELD_DEFAULT}=bad-token`);
    expect(res.status).toBe(422);
    expect(await res.text()).toBe(refusal("name"));
  });

  it("refuses a submission carrying no token at all", async () => {
    let rejection: unknown;
    const app = makeApp(
      defineAction(TEST_ROUTE, {
        schema: NameSchema,
        turnstile: { secretKey: () => "test-secret", verify: () => ({ expectedHostname: "localhost" }) },
        onBotDetected: (received) => {
          rejection = received;
          return new Response("no token", { status: 403 });
        },
        handle: () => new Response("success"),
      }),
    );

    const res = await submit(app, "name=Jane");
    expect(res.status).toBe(403);
    expect(rejection).toEqual({ guard: "turnstile", reason: "missing-token" });
  });

  it("fails closed on a siteverify network error and carries the reason in the rejection", async () => {
    fakeSiteverify(async () => {
      throw new Error("connection refused");
    });

    let rejection: unknown;
    const app = makeApp(
      defineAction(TEST_ROUTE, {
        schema: NameSchema,
        turnstile: { secretKey: () => "test-secret", verify: () => ({ expectedHostname: "localhost" }) },
        onBotDetected: (received) => {
          rejection = received;
          return new Response("unavailable", { status: 503 });
        },
        handle: () => new Response("success"),
      }),
    );

    const res = await submit(app, `name=Jane&${TURNSTILE_FIELD_DEFAULT}=solved-token`);
    expect(res.status).toBe(503);
    expect(rejection).toEqual({ guard: "turnstile", reason: "network-error" });
  });

  it("refuses with the ordinary fragment on a network error when no onBotDetected is supplied", async () => {
    fakeSiteverify(async () => {
      throw new Error("connection refused");
    });

    const res = await submit(turnstileApp(), `name=Jane&${TURNSTILE_FIELD_DEFAULT}=solved-token`);
    expect(res.status).toBe(422);
    expect(await res.text()).toBe(refusal("name"));
  });

  // The line is the same for every trip; the reason is what tells an outage from a rejection.
  it("logs a network error with the reason that names it an outage", async () => {
    fakeSiteverify(async () => {
      throw new Error("connection refused");
    });

    const capture = captureLogs();
    await submit(turnstileApp(undefined, capture), `name=Jane&${TURNSTILE_FIELD_DEFAULT}=solved-token`);
    expect(capture.records.find((record) => record.message === "Submission refused by a bot guard")?.data).toMatchObject({
      reason: "network-error",
    });
  });

  it("fails closed on a siteverify timeout and carries the reason in the rejection", async () => {
    fakeSiteverify(async () => {
      // Outlives the 1 ms budget below, so the real AbortController fires and `verifyTurnstile`
      // distinguishes a timeout from a plain network failure by its own signal.
      await new Promise((resolve) => globalThis.setTimeout(resolve, 30));
      throw new DOMException("aborted", "AbortError");
    });

    let rejection: unknown;
    const app = makeApp(
      defineAction(TEST_ROUTE, {
        schema: NameSchema,
        turnstile: { secretKey: () => "test-secret", verify: () => ({ expectedHostname: "localhost", timeoutMs: 1 }) },
        onBotDetected: (received) => {
          rejection = received;
          return new Response("timed out", { status: 504 });
        },
        handle: () => new Response("success"),
      }),
    );

    const res = await submit(app, `name=Jane&${TURNSTILE_FIELD_DEFAULT}=solved-token`);
    expect(res.status).toBe(504);
    expect(rejection).toEqual({ guard: "turnstile", reason: "timeout" });
  });

  it("refuses a token minted for another hostname", async () => {
    fakeSiteverify(async () => new Response(JSON.stringify({ success: true, hostname: "attacker.example" })));

    let rejection: unknown;
    const app = makeApp(
      defineAction(TEST_ROUTE, {
        schema: NameSchema,
        turnstile: { secretKey: () => "test-secret", verify: () => ({ expectedHostname: "localhost" }) },
        onBotDetected: (received) => {
          rejection = received;
          return new Response("replayed", { status: 403 });
        },
        handle: () => new Response("success"),
      }),
    );

    const res = await submit(app, `name=Jane&${TURNSTILE_FIELD_DEFAULT}=solved-token`);
    expect(res.status).toBe(403);
    expect(rejection).toEqual({ guard: "turnstile", reason: "hostname-mismatch" });
  });
});

describe("defineAction — injected field derivation", () => {
  const SECRET = CSRF_HEX_KEY;

  function keysAction() {
    return defineAction(TEST_ROUTE, { schema: NameSchema, handle: (data) => new Response(Object.keys(data).join(",")) });
  }

  function issueTypesAction() {
    return defineAction(TEST_ROUTE, {
      schema: NameSchema,
      handle: () => new Response("success"),
      onValidationError: (issues) => new Response(issues.map((issue) => issue.type).join("|"), { status: 400 }),
    });
  }

  async function guardedApp(tokenField?: string) {
    const ring = await importKeyRing([SECRET]);
    const app = new Forge();
    app.use("/guarded", csrfMintStage({ ring: () => ring, subject: false, ...(tokenField !== undefined ? { tokenField } : {}) }));
    mapHandler(app, "POST", "/guarded", keysAction());
    return { app, token: await createCsrfToken(ring, "/guarded") };
  }

  it("strips the CSRF token from a body validated against a schema that never declares it", async () => {
    const { app, token } = await guardedApp();

    const res = await submit(app, `${CSRF_FIELD_DEFAULT}=${token}&name=Jane`, "/guarded");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("name");
  });

  it("strips a renamed CSRF field with no second declaration anywhere on the route", async () => {
    const { app, token } = await guardedApp("xsrf");

    const res = await submit(app, `xsrf=${token}&name=Jane`, "/guarded");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("name");
  });

  it("strips only the name the guard actually consumed, so a stray default field is still refused", async () => {
    const ring = await importKeyRing([SECRET]);
    const app = new Forge();
    app.use("/guarded", csrfMintStage({ ring: () => ring, subject: false, tokenField: "xsrf" }));
    mapHandler(app, "POST", "/guarded", issueTypesAction());
    const token = await createCsrfToken(ring, "/guarded");

    const res = await submit(app, `xsrf=${token}&name=Jane&${CSRF_FIELD_DEFAULT}=stray`, "/guarded");
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("strict_object");
  });

  it("refuses _csrf as an undeclared field when no CSRF middleware ran", async () => {
    const res = await submit(makeApp(issueTypesAction()), `name=Jane&${CSRF_FIELD_DEFAULT}=whatever`);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("strict_object");
  });

  it("names the unconsumed CSRF field in the default refusal, pointing at the missing middleware", async () => {
    const res = await submit(
      makeApp(defineAction(TEST_ROUTE, { schema: NameSchema, handle: () => new Response("success") })),
      `name=Jane&${CSRF_FIELD_DEFAULT}=whatever`,
    );
    expect(res.status).toBe(422);
    expect(await res.text()).toBe(refusal(CSRF_FIELD_DEFAULT));
  });

  it("refuses a renamed CSRF field when no CSRF middleware ran", async () => {
    const res = await submit(makeApp(issueTypesAction()), "name=Jane&xsrf=whatever");
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("strict_object");
  });

  it("keeps the CSRF drop per request rather than per route, across two apps in one isolate", async () => {
    const { app: guarded, token } = await guardedApp();
    const unguarded = makeApp(issueTypesAction());

    expect(await (await submit(guarded, `${CSRF_FIELD_DEFAULT}=${token}&name=Jane`, "/guarded")).text()).toBe("name");
    expect(await (await submit(unguarded, `name=Jane&${CSRF_FIELD_DEFAULT}=whatever`)).text()).toBe("strict_object");
    expect(await (await submit(guarded, `${CSRF_FIELD_DEFAULT}=${token}&name=Jane`, "/guarded")).text()).toBe("name");
  });
});

describe("defineAction — the one refusal", () => {
  const UNDECLARED = "company";
  const EmailSchema = v.strictObject({ email: v.pipe(v.string(), v.email()) });
  const UnionSchema = v.union([v.strictObject({ name: v.string() }), v.strictObject({ email: v.string() })]);
  const LONG_KEY = "k".repeat(30_000);

  it("renders exactly this markup, which is the literal every other case here is asserted against", () => {
    expect(refusal("name")).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground" data-announce-failure="Please correct the following fields."><p>Please correct the following fields.</p><ul class="mt-2 list-disc ps-5"><li>name</li></ul></div>',
    );
  });

  it("answers 422 by default — a well-formed request the server understood and declined", async () => {
    const res = await submit(
      makeApp(defineAction(TEST_ROUTE, { schema: EmailSchema, handle: () => new Response("success") })),
      "email=not-an-email",
    );
    expect(res.status).toBe(422);
    expect(await res.text()).toBe(refusal("email"));
  });

  it("lets onValidationError replace the status and the body entirely, including with a 2xx", async () => {
    const app = makeApp(
      defineAction(TEST_ROUTE, {
        schema: NameSchema,
        handle: () => new Response("success"),
        onValidationError: () => new Response("<p>try again</p>", { status: 200, headers: { "content-type": "text/html" } }),
      }),
    );

    const res = await submit(app, "name=");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<p>try again</p>");
  });

  it("puts neither the submitted value nor the schema's own pattern into the response", async () => {
    const Schema = v.strictObject({ password: v.pipe(v.string(), v.regex(/^(?=.*[A-Z]).{12,}$/)) });
    const app = makeApp(defineAction(TEST_ROUTE, { schema: Schema, handle: () => new Response("success") }));

    const res = await submit(app, "password=hunter2secret");
    const body = await res.text();
    expect(res.status).toBe(422);
    expect(body).toBe(refusal("password"));
    expect(body.includes("hunter2secret")).toBe(false);
    expect(body.includes("(?=.*[A-Z])")).toBe(false);
    expect(body.includes("{12,}")).toBe(false);
  });

  it("answers a 50,000-character value and a 5-character one with byte-identical refusals", async () => {
    const app = makeApp(defineAction(TEST_ROUTE, { schema: EmailSchema, handle: () => new Response("success") }));

    const huge = await submit(app, `email=${"z".repeat(50_000)}&${LONG_KEY}=1`);
    const small = await submit(app, `email=zzzzz&${LONG_KEY}=1`);
    const hugeBody = await huge.text();
    const smallBody = await small.text();

    expect(huge.status).toBe(422);
    expect(small.status).toBe(huge.status);
    expect(hugeBody).toBe(smallBody);
    expect(hugeBody).toBe(refusal("email"));
    expect(hugeBody.length).toBe(refusal("email").length);
  });

  it("bounds the answer identically when the long value passes and the undeclared key is what fails", async () => {
    const app = makeApp(defineAction(TEST_ROUTE, { schema: NameSchema, handle: () => new Response("success") }));

    const huge = await submit(app, `name=${"z".repeat(50_000)}&${LONG_KEY}=1`);
    const small = await submit(app, `name=Jane&${LONG_KEY}=1`);
    const hugeBody = await huge.text();

    expect(huge.status).toBe(422);
    expect(small.status).toBe(422);
    expect(hugeBody).toBe(await small.text());
    expect(hugeBody).toBe(refusal("k".repeat(40)));
  });

  it("cannot have its response multiplied by a caller adding fields", async () => {
    const app = makeApp(defineAction(TEST_ROUTE, { schema: EmailSchema, handle: () => new Response("success") }));
    const extras = Array.from({ length: 500 }, (_, index) => `extra${index}=1`).join("&");

    const bare = await submit(app, "email=nope");
    const padded = await submit(app, `email=nope&${extras}`);

    expect(await padded.text()).toBe(await bare.text());
    expect(padded.status).toBe(bare.status);
  });

  it("pins the issue count to one for a body failing two declared fields", async () => {
    const Schema = v.strictObject({ a: v.pipe(v.string(), v.minLength(2)), b: v.pipe(v.string(), v.minLength(2)) });
    const app = makeApp(
      defineAction(TEST_ROUTE, {
        schema: Schema,
        handle: () => new Response("success"),
        onValidationError: (issues) => new Response(String(issues.length), { status: 400 }),
      }),
    );

    const res = await submit(app, "a=&b=");
    expect(await res.text()).toBe("1");
  });

  it("renders one list item for a body failing two declared fields", async () => {
    const Schema = v.strictObject({ a: v.pipe(v.string(), v.minLength(2)), b: v.pipe(v.string(), v.minLength(2)) });
    const app = makeApp(defineAction(TEST_ROUTE, { schema: Schema, handle: () => new Response("success") }));

    const res = await submit(app, "a=&b=");
    expect(await res.text()).toBe(refusal("a"));
  });

  it("truncates a caller-supplied v.record key to forty characters", async () => {
    const Schema = v.record(v.string(), v.pipe(v.string(), v.minLength(5)));
    const app = makeApp(defineAction(TEST_ROUTE, { schema: Schema, handle: () => new Response("success") }));

    const res = await submit(app, `${"q".repeat(200)}=x`);
    expect(res.status).toBe(422);
    expect(await res.text()).toBe(refusal("q".repeat(40)));
  });

  it("still escapes what it does render", async () => {
    const app = makeApp(defineAction(TEST_ROUTE, { schema: NameSchema, handle: () => new Response("success") }));

    const res = await submit(app, `name=Jane&${encodeURIComponent("a&b'c\"d<e>f")}=1`);
    expect(res.status).toBe(422);
    expect(await res.text()).toBe(refusal("a&amp;b&#39;c&quot;d&lt;e&gt;f"));
  });

  it("answers a failed Turnstile check with the same bytes as a schema refusal", async () => {
    fakeSiteverify(async () => new Response(JSON.stringify({ success: false })));

    const guarded = makeApp(
      defineAction(TEST_ROUTE, {
        schema: NameSchema,
        turnstile: { secretKey: () => "test-secret", verify: () => ({ expectedHostname: "localhost" }) },
        handle: () => new Response("success"),
      }),
    );
    const plain = makeApp(defineAction(TEST_ROUTE, { schema: NameSchema, handle: () => new Response("success") }));

    const bot = await submit(guarded, `name=Jane&${TURNSTILE_FIELD_DEFAULT}=bad-token`);
    const human = await submit(plain, "name=");

    expect(bot.status).toBe(422);
    expect(human.status).toBe(422);
    expect(await bot.text()).toBe(await human.text());
  });

  it("falls back to the same generic wording for a schema with no entries to name", async () => {
    fakeSiteverify(async () => new Response(JSON.stringify({ success: false })));

    const app = makeApp(
      defineAction(TEST_ROUTE, {
        schema: UnionSchema,
        turnstile: { secretKey: () => "test-secret", verify: () => ({ expectedHostname: "localhost" }) },
        handle: () => new Response("success"),
      }),
    );

    const bot = await submit(app, `name=Jane&${TURNSTILE_FIELD_DEFAULT}=bad-token`);
    const human = await submit(makeApp(defineAction(TEST_ROUTE, { schema: UnionSchema, handle: () => new Response("success") })), "zzz=1");
    const botBody = await bot.text();

    expect(bot.status).toBe(422);
    expect(human.status).toBe(422);
    expect(botBody).toBe(await human.text());
    expect(botBody).toBe(refusal("the submitted form"));
  });

  it("never names the guard in any refusal it renders", async () => {
    fakeSiteverify(async () => new Response(JSON.stringify({ success: false })));

    const app = makeApp(
      defineAction(TEST_ROUTE, {
        schema: NameSchema,
        turnstile: { secretKey: () => "test-secret", verify: () => ({ expectedHostname: "localhost" }) },
        handle: () => new Response("success"),
      }),
    );

    const bodies = [
      await (await submit(app, `name=Jane&${TURNSTILE_FIELD_DEFAULT}=bad`)).text(),
      await (await submit(app, `name=&${TURNSTILE_FIELD_DEFAULT}=bad`)).text(),
    ];

    for (const body of bodies) {
      expect(body.includes(TURNSTILE_FIELD_DEFAULT)).toBe(false);
      expect(body).toBe(refusal("name"));
    }
  });

  it("names an undeclared field when the schema itself is what refused", async () => {
    const app = makeApp(defineAction(TEST_ROUTE, { schema: NameSchema, handle: () => new Response("success") }));

    const res = await submit(app, `name=Jane&${UNDECLARED}=spam`);
    expect(await res.text()).toBe(refusal(UNDECLARED));
  });
});

describe("defineAction — error reporting", () => {
  it("logs the generic 500 at error level, in the serialized shape", async () => {
    const capture = captureLogs();
    const app = makeApp(
      defineAction(TEST_ROUTE, {
        schema: NameSchema,
        handle: () => {
          throw new Error("handle exploded");
        },
      }),
      capture,
    );

    await submit(app, VALID_FORM.toString());
    expect(capture.records.length).toBe(1);
    const record = capture.records[0]!;
    expect(record.data?.source).toBe("action");
    expect(record.level).toBe("error");
    expect(record.message).toBe("Action threw");
    const error = record.data?.error as { type: string; detail: string; stack?: string };
    expect(error.type).toBe("Error");
    expect(error.detail).toBe("handle exploded");
    expect(typeof error.stack).toBe("string");
  });

  it("logs at warn when onError recovers, since the client got a normal response", async () => {
    const capture = captureLogs();
    const app = makeApp(
      defineAction(TEST_ROUTE, {
        schema: NameSchema,
        handle: () => {
          throw new Error("handle exploded");
        },
        onError: () => new Response("recovered", { status: 200 }),
      }),
      capture,
    );

    await submit(app, VALID_FORM.toString());
    expect(capture.records.map(({ level, message }) => ({ level, message }))).toStrictEqual([{ level: "warn", message: "Action threw" }]);
  });

  it("attributes a throwing onError to the hook and still answers the generic fragment", async () => {
    const capture = captureLogs();
    const app = makeApp(
      defineAction(TEST_ROUTE, {
        schema: NameSchema,
        handle: () => {
          throw new Error("handle exploded");
        },
        onError: () => {
          throw new Error("hook exploded");
        },
      }),
      capture,
    );

    const res = await submit(app, VALID_FORM.toString());

    expect(res.status).toBe(500);
    expect(await res.text()).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground" data-announce-failure="Something went wrong. Please try again."><p>Something went wrong. Please try again.</p></div>',
    );
    expect(capture.records.length).toBe(1);
    const record = capture.records[0]!;
    expect(record.message).toBe("defineAction onError threw");
    expect(record.level).toBe("error");
    expect(record.data).toMatchObject({ error: { detail: "hook exploded" }, original: { detail: "handle exploded" } });
  });
});

describe("defineAction — a client that disconnects", () => {
  it("renders no fragment and logs nothing, leaving the boundary its 499", async () => {
    const capture = captureLogs();
    const app = makeApp(
      defineAction(TEST_ROUTE, {
        schema: NameSchema,
        handle: () => {
          throw new Error("handle exploded");
        },
      }),
      capture,
    );

    const res = await app.fetch(
      new Request("http://localhost/test", { method: "POST", headers: FORM_HEADERS, body: VALID_FORM.toString(), signal: AbortSignal.abort() }),
      {},
      mockExecutionContext(),
    );

    expect(res.status).toBe(499);
    expect(capture.records).toEqual([]);
  });
});

describe("defineAction — Turnstile under a testing secret", () => {
  const TESTING_SECRET = TURNSTILE_TEST_KEYS.secret.pass;
  // Siteverify's fixed answer under a testing secret names its own hostname and carries no action.
  const TESTING_ANSWER = { success: true, hostname: "example.com" };

  function guardedApp() {
    return createApp({
      routes: (app) =>
        mapHandler(
          app,
          "POST",
          "/test",
          defineAction(TEST_ROUTE, {
            schema: NameSchema,
            turnstile: { verify: () => ({ expectedAction: "contact" }) },
            handle: (data) => new Response(data.name),
          }),
        ),
    });
  }

  function postWith(app: Forge, secret: string): Promise<Response> {
    return app.request(
      "https://app.example/test",
      { method: "POST", headers: FORM_HEADERS, body: `name=Jane&${TURNSTILE_FIELD_DEFAULT}=solved` },
      { TURNSTILE_SITE_KEY: "site-key", TURNSTILE_SECRET_KEY: secret },
    );
  }

  it("refuses a testing-secret token solved for another hostname with no action, in a build not armed for development", async () => {
    fakeSiteverify(async () => new Response(JSON.stringify(TESTING_ANSWER)));

    const res = await postWith(guardedApp(), TESTING_SECRET);

    expect(res.status).toBe(422);
  });
});

describe("defineAction — route rate limits keyed by identity and params", () => {
  const NOTEBOOK_ROUTE = post("/notebooks/:nb/entries");
  const userIdVar = contextVar<string>("action-test.userId");
  type LimitedEnv = { NOTEBOOK_WRITES?: RateLimit; USER_WRITES?: RateLimit };

  const identify: Middleware = (context, next) => {
    const user = context.request.headers.get("x-user");
    if (user === null) return new Response("Unauthorized", { status: 401 });
    userIdVar.set(context, user);
    return next();
  };

  function budgetLimiter(name: string, perKey: number, spent: string[]): RateLimit {
    const used = new Map<string, number>();
    return {
      limit: async ({ key }) => {
        spent.push(`${name}:${key}`);
        const count = (used.get(key) ?? 0) + 1;
        used.set(key, count);
        return { success: count <= perKey };
      },
    };
  }

  function notebookApp(rateLimit: RateLimitOptions | readonly RateLimitOptions[], onRefuse?: RefuseHook) {
    const handled: string[] = [];
    const app = new Forge<LimitedEnv>();
    applyMiddlewareChain(app, {
      securityHeaders: {},
      rateLimits: { NOTEBOOK_WRITES: { limit: 1, period: 60 }, USER_WRITES: { limit: 2, period: 3600 } },
      ...(onRefuse === undefined ? {} : { onRefuse }),
    });
    mapHandler(app, "POST", "/notebooks/:nb/entries", {
      middleware: [identify],
      handler: defineAction(NOTEBOOK_ROUTE, {
        schema: NameSchema,
        rateLimit,
        handle: (data, c) => {
          handled.push(`${c.params.nb}:${data.name}`);
          return new Response(`saved to ${c.params.nb}`);
        },
      }),
    });
    return { app, handled };
  }

  function write(app: Forge<LimitedEnv>, env: LimitedEnv, user: string, nb: string): Promise<Response> {
    return app.request(`/notebooks/${nb}/entries`, { method: "POST", headers: { ...FORM_HEADERS, "x-user": user }, body: "name=Entry" }, env);
  }

  const perUserPerNotebook: RateLimitOptions = { binding: "NOTEBOOK_WRITES", key: (c) => `${userIdVar.get(c)}:${c.params.nb}` };

  it("spends a separate budget per notebook and per user, answering the spent one 429 through the chain's hook", async () => {
    const spent: string[] = [];
    const refusals: Refusal[] = [];
    const { app, handled } = notebookApp(perUserPerNotebook, (_c, received) => {
      refusals.push(received);
      return new Response(`refused by ${received.guard}`, { status: received.status });
    });
    const env: LimitedEnv = { NOTEBOOK_WRITES: budgetLimiter("NOTEBOOK_WRITES", 1, spent) };

    const answers: [number, string, string | null][] = [];
    for (const [user, nb] of [
      ["alice", "n1"],
      ["alice", "n1"],
      ["alice", "n2"],
      ["bob", "n1"],
    ] as const) {
      const res = await write(app, env, user, nb);
      answers.push([res.status, await res.text(), res.headers.get("Retry-After")]);
    }

    expect({ answers, spent, refusals, handled }).toEqual({
      answers: [
        [200, "saved to n1", null],
        [429, "refused by rate-limit", "60"],
        [200, "saved to n2", null],
        [200, "saved to n1", null],
      ],
      spent: ["NOTEBOOK_WRITES:alice:n1", "NOTEBOOK_WRITES:alice:n1", "NOTEBOOK_WRITES:alice:n2", "NOTEBOOK_WRITES:bob:n1"],
      refusals: [{ guard: "rate-limit", status: 429, retryAfter: 60 }],
      handled: ["n1:Entry", "n2:Entry", "n1:Entry"],
    });
  });

  it("answers with the limit's own onRefuse in place of the chain's hook", async () => {
    const chainHook: RefuseHook = () => new Response("chain hook", { status: 429 });
    const { app, handled } = notebookApp({ ...perUserPerNotebook, onRefuse: () => new Response("route hook", { status: 429 }) }, chainHook);
    const env: LimitedEnv = { NOTEBOOK_WRITES: budgetLimiter("NOTEBOOK_WRITES", 0, []) };

    const res = await write(app, env, "alice", "n1");

    expect({ status: res.status, body: await res.text(), handled }).toEqual({ status: 429, body: "route hook", handled: [] });
  });

  describe("two stacked limits", () => {
    const stacked: readonly RateLimitOptions[] = [
      { binding: "USER_WRITES", key: (c) => userIdVar.get(c) },
      { binding: "NOTEBOOK_WRITES", key: (c) => `${userIdVar.get(c)}:${c.params.nb}` },
    ];

    const cases: { name: string; userBudget: number; notebookBudget: number; expected: { status: number; spent: string[]; handled: number } }[] = [
      {
        name: "spends both, in order, on a submission each admits",
        userBudget: 1,
        notebookBudget: 1,
        expected: { status: 200, spent: ["USER_WRITES:alice", "NOTEBOOK_WRITES:alice:n1"], handled: 1 },
      },
      {
        name: "answers 429 when the second refuses, having spent the first",
        userBudget: 1,
        notebookBudget: 0,
        expected: { status: 429, spent: ["USER_WRITES:alice", "NOTEBOOK_WRITES:alice:n1"], handled: 0 },
      },
      {
        name: "answers 429 when the first refuses, without spending the second",
        userBudget: 0,
        notebookBudget: 1,
        expected: { status: 429, spent: ["USER_WRITES:alice"], handled: 0 },
      },
    ];

    for (const { name, userBudget, notebookBudget, expected } of cases) {
      it(name, async () => {
        const spent: string[] = [];
        const { app, handled } = notebookApp(stacked);
        const env: LimitedEnv = {
          USER_WRITES: budgetLimiter("USER_WRITES", userBudget, spent),
          NOTEBOOK_WRITES: budgetLimiter("NOTEBOOK_WRITES", notebookBudget, spent),
        };

        const res = await write(app, env, "alice", "n1");

        expect({ status: res.status, spent, handled: handled.length }).toEqual(expected);
      });
    }

    it("answers each limit's 429 with its own declared period as Retry-After", async () => {
      const { app } = notebookApp(stacked);
      const refusedByUser = await write(
        app,
        { USER_WRITES: budgetLimiter("USER_WRITES", 0, []), NOTEBOOK_WRITES: budgetLimiter("NOTEBOOK_WRITES", 1, []) },
        "alice",
        "n1",
      );
      const refusedByNotebook = await write(
        app,
        { USER_WRITES: budgetLimiter("USER_WRITES", 1, []), NOTEBOOK_WRITES: budgetLimiter("NOTEBOOK_WRITES", 0, []) },
        "alice",
        "n1",
      );

      expect([refusedByUser.headers.get("Retry-After"), refusedByNotebook.headers.get("Retry-After")]).toEqual(["3600", "60"]);
    });
  });
});
