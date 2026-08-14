import { afterEach, describe, expect, it } from "bun:test";
import { CSRF_FIELD_DEFAULT, HONEYPOT_FIELD_DEFAULT, TURNSTILE_FIELD_DEFAULT } from "../form/constants";
import { createCsrfToken, csrfProtection, importCsrfKey } from "../form/csrf";
import { mapHandler } from "../testing/route";
import { strictObject } from "../validation/strict-object";
import { v } from "../validation/validation";
import { defineAction } from "./action";
import { Forge } from "./forge-app";

const NameSchema = strictObject({ name: v.pipe(v.string(), v.minLength(1, "Name required.")) });

function makeApp(action: ReturnType<typeof defineAction>) {
  const app = new Forge();
  mapHandler(app, "POST", "/test", action);
  return app;
}

const VALID_FORM = new URLSearchParams({ name: "Jane" });
const FORM_HEADERS = { "content-type": "application/x-www-form-urlencoded" };

type Requestable = { request(path: string, init: RequestInit): Promise<Response> };

function post(app: Requestable, body: string, path = "/test"): Promise<Response> {
  return app.request(path, { method: "POST", headers: FORM_HEADERS, body });
}

function refusal(...fields: readonly string[]): string {
  const items = fields.map((field) => `<li>${field}</li>`).join("");
  return `<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground"><p>Please correct the following fields.</p><ul class="mt-2 list-disc pl-5">${items}</ul></div>`;
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

describe("defineAction", () => {
  it("runs full pipeline successfully", async () => {
    const app = makeApp(defineAction({ schema: NameSchema, handle: () => new Response("success") }));

    const res = await app.request("/test", { method: "POST", headers: FORM_HEADERS, body: VALID_FORM.toString() });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("success");
  });

  it("returns validation error fragment when validation fails", async () => {
    const app = makeApp(defineAction({ schema: NameSchema, handle: () => new Response("success") }));

    const res = await app.request("/test", { method: "POST", headers: FORM_HEADERS, body: "name=" });
    expect(res.status).toBe(422);
    expect(await res.text()).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground"><p>Please correct the following fields.</p><ul class="mt-2 list-disc pl-5"><li>name</li></ul></div>',
    );
  });

  it("returns 400 when body cannot be parsed as form data", async () => {
    const app = makeApp(defineAction({ schema: NameSchema, handle: () => new Response("success") }));

    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Jane" }),
    });
    expect(res.status).toBe(400);
  });

  it("calls onValidationError when provided", async () => {
    const app = makeApp(
      defineAction({
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
      defineAction({
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
      defineAction({
        schema: NameSchema,
        handle: () => {
          throw new Error("downstream failure");
        },
      }),
    );

    const res = await app.request("/test", { method: "POST", headers: FORM_HEADERS, body: VALID_FORM.toString() });
    expect(res.status).toBe(500);
  });

  it("calls onError when handler throws and onError is provided", async () => {
    const app = makeApp(
      defineAction({
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
      handler: defineAction({
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
    const app = makeApp(defineAction({ schema: NameSchema, handle: () => new Response("success") }));
    const res = await app.request("/test", {
      method: "POST",
      headers: FORM_HEADERS,
      // 100 KB default limit; this body is ~200 KB.
      body: `name=${"x".repeat(200_000)}`,
    });
    expect(res.status).toBe(413);
  });

  it("rejects an oversized streaming body (no Content-Length) with the exact 413 fragment", async () => {
    const app = makeApp(defineAction({ schema: NameSchema, handle: () => new Response("success") }));
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
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground"><p>The submitted form is too large. Please reduce its size and try again.</p></div>',
    );
  });

  it("accepts a body above the default cap when the route raises maxBytes", async () => {
    const app = makeApp(defineAction({ maxBytes: 300 * 1024, schema: NameSchema, handle: (data) => new Response(String(data.name.length)) }));

    const res = await app.request("/test", { method: "POST", headers: FORM_HEADERS, body: `name=${"x".repeat(200_000)}` });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("200000");
  });

  it("still returns 413 for a body above the route's own raised cap", async () => {
    const app = makeApp(defineAction({ maxBytes: 150 * 1024, schema: NameSchema, handle: () => new Response("success") }));

    const res = await app.request("/test", { method: "POST", headers: FORM_HEADERS, body: `name=${"x".repeat(200_000)}` });
    expect(res.status).toBe(413);
  });

  it("logs server-side when the handler throws", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      const app = makeApp(
        defineAction({
          schema: NameSchema,
          handle: () => {
            throw new Error("boom downstream");
          },
        }),
      );
      await app.request("/test", { method: "POST", headers: FORM_HEADERS, body: VALID_FORM.toString() });
    } finally {
      console.log = originalLog;
    }
    expect(logs.some((l) => l.includes("Action threw"))).toBe(true);
  });
});

describe("defineAction — a throwing schema or hook", () => {
  const ThrowingTransform = strictObject({
    payload: v.pipe(
      v.string(),
      v.transform((raw) => JSON.parse(raw) as unknown),
    ),
  });
  const ThrowingCheck = strictObject({
    name: v.pipe(
      v.string(),
      v.check<string>(() => {
        throw new Error("check exploded");
      }),
    ),
  });

  it("answers 500 with the generic fragment when a v.transform throws", async () => {
    const app = makeApp(defineAction({ schema: ThrowingTransform, handle: () => new Response("success") }));

    const res = await post(app, "payload=notjson");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground"><p>Something went wrong. Please try again.</p></div>',
    );
  });

  it("hands a throwing v.transform's error to onError", async () => {
    let captured: Error | undefined;
    const app = makeApp(
      defineAction({
        schema: ThrowingTransform,
        handle: () => new Response("success"),
        onError: (error) => {
          captured = error;
          return new Response("custom 500", { status: 500 });
        },
      }),
    );

    const res = await post(app, "payload=notjson");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("custom 500");
    expect(captured instanceof Error).toBe(true);
    expect(captured?.name).toBe("SyntaxError");
  });

  it("logs a throwing v.transform, because a schema defect is the operator's to see", async () => {
    const app = makeApp(defineAction({ schema: ThrowingTransform, handle: () => new Response("success") }));
    const logs = await captureLogs(() => post(app, "payload=notjson"));
    expect(logs.some((line) => line.includes("Action threw"))).toBe(true);
  });

  it("answers 500 when a v.check predicate throws", async () => {
    const app = makeApp(defineAction({ schema: ThrowingCheck, handle: () => new Response("success") }));

    const res = await post(app, "name=Jane");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground"><p>Something went wrong. Please try again.</p></div>',
    );
  });

  it("hands a throwing v.check's error to onError", async () => {
    let captured: Error | undefined;
    const app = makeApp(
      defineAction({
        schema: ThrowingCheck,
        handle: () => new Response("success"),
        onError: (error) => {
          captured = error;
          return new Response("custom 500", { status: 500 });
        },
      }),
    );

    const res = await post(app, "name=Jane");
    expect(res.status).toBe(500);
    expect(captured?.message).toBe("check exploded");
  });

  it("logs a throwing v.check", async () => {
    const app = makeApp(defineAction({ schema: ThrowingCheck, handle: () => new Response("success") }));
    const logs = await captureLogs(() => post(app, "name=Jane"));
    expect(logs.some((line) => line.includes("Action threw"))).toBe(true);
  });

  it("absorbs a throwing onValidationError into the same 500 path, deliberately and symmetrically", async () => {
    let captured: Error | undefined;
    const app = makeApp(
      defineAction({
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

    const res = await post(app, "name=");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("custom 500");
    expect(captured?.message).toBe("formatter exploded");
  });

  it("answers 500 for a throwing onValidationError with no onError supplied", async () => {
    const app = makeApp(
      defineAction({
        schema: NameSchema,
        handle: () => new Response("success"),
        onValidationError: () => {
          throw new Error("formatter exploded");
        },
      }),
    );

    const res = await post(app, "name=");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground"><p>Something went wrong. Please try again.</p></div>',
    );
  });

  it("still reaches handle through a transform that does not throw", async () => {
    const app = makeApp(defineAction({ schema: ThrowingTransform, handle: (data) => new Response(JSON.stringify(data.payload)) }));

    const res = await post(app, `payload=${encodeURIComponent('{"ok":true}')}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"ok":true}');
  });
});

describe("defineAction — what reaches the schema", () => {
  const RawNameSchema = v.strictObject({ name: v.pipe(v.string(), v.minLength(1, "Name required.")) });

  it("refuses a field nobody declared", async () => {
    const app = makeApp(
      defineAction({
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
    const app = makeApp(defineAction({ schema: Schema, handle: (data) => new Response(String(data.phone)) }));

    const res = await app.request("/test", { method: "POST", headers: FORM_HEADERS, body: "name=Jane" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("undefined");
  });

  it("distinguishes a field submitted empty from one not submitted at all", async () => {
    const Schema = v.strictObject({ name: v.string(), phone: v.optional(v.string()) });
    const app = makeApp(defineAction({ schema: Schema, handle: (data) => new Response(String(data.phone)) }));

    const res = await app.request("/test", { method: "POST", headers: FORM_HEADERS, body: "name=Jane&phone=" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("hands a repeated key to the schema as an array, so a scalar schema refuses it", async () => {
    const app = makeApp(
      defineAction({
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
    const app = makeApp(defineAction({ schema: Schema, handle: (data) => new Response(data.tag.join(",")) }));

    const res = await app.request("/test", { method: "POST", headers: FORM_HEADERS, body: "tag=a&tag=b" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("a,b");
  });

  it("does not let a caller-sent __proto__ mutate a prototype or reach the handler", async () => {
    const app = makeApp(defineAction({ schema: RawNameSchema, handle: (data) => new Response(Object.keys(data).join(",")) }));

    const res = await app.request("/test", { method: "POST", headers: FORM_HEADERS, body: "name=Jane&__proto__=polluted" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("name");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  for (const inherited of ["__proto__", "constructor", "toString", "valueOf"]) {
    it(`refuses an undeclared ${inherited} as the undeclared key it is`, async () => {
      const app = makeApp(
        defineAction({
          schema: NameSchema,
          handle: () => new Response("success"),
          onValidationError: (issues) => new Response(issues.map((issue) => issue.type).join("|"), { status: 400 }),
        }),
      );

      const res = await post(app, `name=Jane&${encodeURIComponent(inherited)}=sent`);
      expect(res.status).toBe(400);
      expect(await res.text()).toBe("strict_object");
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    });
  }

  it("reads a schema field named constructor as absent when the caller did not send it", async () => {
    const Schema = strictObject({ name: v.string(), constructor: v.string() });
    const app = makeApp(
      defineAction({
        schema: Schema,
        handle: () => new Response("success"),
        onValidationError: (issues) => new Response(issues.map((issue) => issue.message).join("|"), { status: 400 }),
      }),
    );

    const res = await post(app, "name=Jane");
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('Invalid key: Expected "constructor" but received undefined');
  });

  it("satisfies v.optional on a schema field named constructor by omission", async () => {
    const Schema = strictObject({ name: v.string(), constructor: v.optional(v.string()) });
    const app = makeApp(defineAction({ schema: Schema, handle: (data) => new Response(Object.keys(data).join(",")) }));

    const res = await post(app, "name=Jane");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("name");
  });

  it("carries a submitted field named constructor through to handle as the submitted value", async () => {
    const Schema = strictObject({ name: v.string(), constructor: v.string() });
    const app = makeApp(defineAction({ schema: Schema, handle: (data) => new Response(data.constructor) }));

    const res = await post(app, "name=Jane&constructor=Acme%20Builders");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Acme Builders");
  });
});

describe("defineAction behind csrfProtection — body size cap", () => {
  const RAISED = 300 * 1024;

  function echoAction(maxBytes?: number) {
    return defineAction({
      ...(maxBytes !== undefined ? { maxBytes } : {}),
      schema: NameSchema,
      handle: (data) => new Response(String(data.name.length)),
    });
  }

  async function guardedBody(path: string, key: CryptoKey, payloadLength: number): Promise<string> {
    const token = await createCsrfToken(key, path);
    return `${CSRF_FIELD_DEFAULT}=${token}&name=${"x".repeat(payloadLength)}`;
  }

  it("accepts a body over the default cap when the route and its guard both raise maxBytes", async () => {
    const key = await importCsrfKey("a".repeat(64));
    const app = new Forge();
    mapHandler(app, "POST", "/upload", {
      middleware: [csrfProtection({ secret: () => key, subject: false, maxBytes: RAISED })],
      handler: echoAction(RAISED),
    });

    const res = await app.request("/upload", { method: "POST", headers: FORM_HEADERS, body: await guardedBody("/upload", key, 200_000) });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("200000");
  });

  it("answers 413 rather than a misleading 403 when the body exceeds the guard's cap", async () => {
    const key = await importCsrfKey("a".repeat(64));
    const app = new Forge();
    mapHandler(app, "POST", "/upload", { middleware: [csrfProtection({ secret: () => key, subject: false })], handler: echoAction() });

    const res = await app.request("/upload", { method: "POST", headers: FORM_HEADERS, body: await guardedBody("/upload", key, 200_000) });
    expect(res.status).toBe(413);
    expect(await res.text()).toBe("Payload Too Large");
  });

  it("keeps a genuine token failure on 403 when the body is within the cap", async () => {
    const key = await importCsrfKey("a".repeat(64));
    const app = new Forge();
    mapHandler(app, "POST", "/upload", { middleware: [csrfProtection({ secret: () => key, subject: false })], handler: echoAction() });

    const res = await app.request("/upload", { method: "POST", headers: FORM_HEADERS, body: "name=Jane" });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it("keeps two routes with different caps independent within the same isolate", async () => {
    const key = await importCsrfKey("a".repeat(64));
    const app = new Forge();
    mapHandler(app, "POST", "/big", {
      middleware: [csrfProtection({ secret: () => key, subject: false, maxBytes: RAISED })],
      handler: echoAction(RAISED),
    });
    mapHandler(app, "POST", "/small", { middleware: [csrfProtection({ secret: () => key, subject: false })], handler: echoAction() });

    const first = await app.request("/big", { method: "POST", headers: FORM_HEADERS, body: await guardedBody("/big", key, 200_000) });
    expect(first.status).toBe(200);

    const strict = await app.request("/small", { method: "POST", headers: FORM_HEADERS, body: await guardedBody("/small", key, 200_000) });
    expect(strict.status).toBe(413);

    const again = await app.request("/big", { method: "POST", headers: FORM_HEADERS, body: await guardedBody("/big", key, 200_000) });
    expect(again.status).toBe(200);
  });
});

describe("defineAction — bot guards", () => {
  const DECOY = "company";

  function honeypotApp(field: string) {
    return makeApp(defineAction({ schema: NameSchema, honeypot: field, handle: (data) => new Response(Object.keys(data).join(",")) }));
  }

  function turnstileApp(tokenField?: string) {
    return makeApp(
      defineAction({
        schema: NameSchema,
        turnstile: {
          secretKey: () => "test-secret",
          ...(tokenField !== undefined ? { tokenField } : {}),
          verify: () => ({ expectedHostname: "localhost" }),
        },
        handle: (data) => new Response(Object.keys(data).join(",")),
      }),
    );
  }

  it("refuses a submission whose renamed honeypot is filled, without the route writing the check", async () => {
    const res = await post(honeypotApp(DECOY), `name=Jane&${DECOY}=spam`);
    expect(res.status).toBe(422);
    expect(await res.text()).toBe(refusal("name"));
  });

  it("lets a legitimate submission through when the renamed honeypot is empty, and drops the field", async () => {
    const res = await post(honeypotApp(DECOY), `name=Jane&${DECOY}=`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("name");
  });

  it("validates a form carrying forge's own honeypot against a strictObject that does not declare it", async () => {
    const res = await post(honeypotApp(HONEYPOT_FIELD_DEFAULT), `name=Jane&${HONEYPOT_FIELD_DEFAULT}=`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("name");
  });

  it("refuses forge's own honeypot when it is filled", async () => {
    const res = await post(honeypotApp(HONEYPOT_FIELD_DEFAULT), `name=Jane&${HONEYPOT_FIELD_DEFAULT}=spam`);
    expect(res.status).toBe(422);
    expect(await res.text()).toBe(refusal("name"));
  });

  it("treats an absent honeypot field as unfilled, so a form rendered without the decoy still passes", async () => {
    const res = await post(honeypotApp(DECOY), "name=Jane");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("name");
  });

  it("strips no field merely for matching a forge-shaped pattern when no guard consumes it", async () => {
    const app = makeApp(
      defineAction({
        schema: NameSchema,
        handle: () => new Response("success"),
        onValidationError: (issues) => new Response(issues.map((issue) => issue.type).join("|"), { status: 400 }),
      }),
    );

    for (const guessable of [HONEYPOT_FIELD_DEFAULT, "__forge_marker", "__forge", "honeypot"]) {
      const res = await post(app, `name=Jane&${guessable}=`);
      expect(res.status).toBe(400);
      expect(await res.text()).toBe("strict_object");
    }
  });

  it("hands onBotDetected the honeypot rejection instead of rendering the refusal", async () => {
    let rejection: unknown;
    const app = makeApp(
      defineAction({
        schema: NameSchema,
        honeypot: DECOY,
        onBotDetected: (received) => {
          rejection = received;
          return new Response("banned", { status: 403 });
        },
        handle: () => new Response("success"),
      }),
    );

    const res = await post(app, `name=Jane&${DECOY}=spam`);
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("banned");
    expect(rejection).toEqual({ guard: "honeypot" });
  });

  it("does not reach onBotDetected when the honeypot is empty", async () => {
    let called = false;
    const app = makeApp(
      defineAction({
        schema: NameSchema,
        honeypot: DECOY,
        onBotDetected: () => {
          called = true;
          return new Response("banned", { status: 403 });
        },
        handle: () => new Response("success"),
      }),
    );

    const res = await post(app, `name=Jane&${DECOY}=`);
    expect(res.status).toBe(200);
    expect(called).toBe(false);
  });

  it("accepts a cf-turnstile-response body against a strictObject that never declares the token field", async () => {
    fakeSiteverify(async () => new Response(JSON.stringify({ success: true, hostname: "localhost" })));

    const res = await post(turnstileApp(), `name=Jane&${TURNSTILE_FIELD_DEFAULT}=solved-token`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("name");
  });

  it("strips a renamed Turnstile token field without the route declaring it twice", async () => {
    fakeSiteverify(async () => new Response(JSON.stringify({ success: true, hostname: "localhost" })));

    const res = await post(turnstileApp("my-token"), "name=Jane&my-token=solved-token");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("name");
  });

  it("sends the token from the renamed field to siteverify", async () => {
    let sent: string | undefined;
    fakeSiteverify(async (init) => {
      sent = init?.body as string;
      return new Response(JSON.stringify({ success: true, hostname: "localhost" }));
    });

    await post(turnstileApp("my-token"), "name=Jane&my-token=solved-token");
    expect(JSON.parse(sent!)).toEqual({ response: "solved-token", secret: "test-secret" });
  });

  it("refuses a submission Turnstile rejects", async () => {
    fakeSiteverify(async () => new Response(JSON.stringify({ success: false })));

    const res = await post(turnstileApp(), `name=Jane&${TURNSTILE_FIELD_DEFAULT}=bad-token`);
    expect(res.status).toBe(422);
    expect(await res.text()).toBe(refusal("name"));
  });

  it("refuses a submission carrying no token at all", async () => {
    let rejection: unknown;
    const app = makeApp(
      defineAction({
        schema: NameSchema,
        turnstile: { secretKey: () => "test-secret", verify: () => ({ expectedHostname: "localhost" }) },
        onBotDetected: (received) => {
          rejection = received;
          return new Response("no token", { status: 403 });
        },
        handle: () => new Response("success"),
      }),
    );

    const res = await post(app, "name=Jane");
    expect(res.status).toBe(403);
    expect(rejection).toEqual({ guard: "turnstile", reason: "missing-token" });
  });

  it("fails closed on a siteverify network error and carries the reason in the rejection", async () => {
    fakeSiteverify(async () => {
      throw new Error("connection refused");
    });

    let rejection: unknown;
    const app = makeApp(
      defineAction({
        schema: NameSchema,
        turnstile: { secretKey: () => "test-secret", verify: () => ({ expectedHostname: "localhost" }) },
        onBotDetected: (received) => {
          rejection = received;
          return new Response("unavailable", { status: 503 });
        },
        handle: () => new Response("success"),
      }),
    );

    const res = await post(app, `name=Jane&${TURNSTILE_FIELD_DEFAULT}=solved-token`);
    expect(res.status).toBe(503);
    expect(rejection).toEqual({ guard: "turnstile", reason: "network-error" });
  });

  it("refuses with the ordinary fragment on a network error when no onBotDetected is supplied", async () => {
    fakeSiteverify(async () => {
      throw new Error("connection refused");
    });

    const res = await post(turnstileApp(), `name=Jane&${TURNSTILE_FIELD_DEFAULT}=solved-token`);
    expect(res.status).toBe(422);
    expect(await res.text()).toBe(refusal("name"));
  });

  it("logs a network error as an outage rather than a rejection", async () => {
    fakeSiteverify(async () => {
      throw new Error("connection refused");
    });

    const logs = await captureLogs(() => post(turnstileApp(), `name=Jane&${TURNSTILE_FIELD_DEFAULT}=solved-token`));
    expect(logs.some((line) => line.includes("Turnstile verification unavailable") && line.includes("network-error"))).toBe(true);
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
      defineAction({
        schema: NameSchema,
        turnstile: { secretKey: () => "test-secret", verify: () => ({ expectedHostname: "localhost", timeoutMs: 1 }) },
        onBotDetected: (received) => {
          rejection = received;
          return new Response("timed out", { status: 504 });
        },
        handle: () => new Response("success"),
      }),
    );

    const res = await post(app, `name=Jane&${TURNSTILE_FIELD_DEFAULT}=solved-token`);
    expect(res.status).toBe(504);
    expect(rejection).toEqual({ guard: "turnstile", reason: "timeout" });
  });

  it("refuses a token minted for another hostname", async () => {
    fakeSiteverify(async () => new Response(JSON.stringify({ success: true, hostname: "attacker.example" })));

    let rejection: unknown;
    const app = makeApp(
      defineAction({
        schema: NameSchema,
        turnstile: { secretKey: () => "test-secret", verify: () => ({ expectedHostname: "localhost" }) },
        onBotDetected: (received) => {
          rejection = received;
          return new Response("replayed", { status: 403 });
        },
        handle: () => new Response("success"),
      }),
    );

    const res = await post(app, `name=Jane&${TURNSTILE_FIELD_DEFAULT}=solved-token`);
    expect(res.status).toBe(403);
    expect(rejection).toEqual({ guard: "turnstile", reason: "hostname-mismatch" });
  });

  it("drops both guards' fields on a route that runs both", async () => {
    fakeSiteverify(async () => new Response(JSON.stringify({ success: true, hostname: "localhost" })));

    const app = makeApp(
      defineAction({
        schema: NameSchema,
        honeypot: DECOY,
        turnstile: { secretKey: () => "test-secret", verify: () => ({ expectedHostname: "localhost" }) },
        handle: (data) => new Response(Object.keys(data).join(",")),
      }),
    );

    const res = await post(app, `name=Jane&${DECOY}=&${TURNSTILE_FIELD_DEFAULT}=solved-token`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("name");
  });

  it("checks the honeypot before spending a siteverify call", async () => {
    let verified = false;
    fakeSiteverify(async () => {
      verified = true;
      return new Response(JSON.stringify({ success: true, hostname: "localhost" }));
    });

    const app = makeApp(
      defineAction({
        schema: NameSchema,
        honeypot: DECOY,
        turnstile: { secretKey: () => "test-secret", verify: () => ({ expectedHostname: "localhost" }) },
        handle: () => new Response("success"),
      }),
    );

    const res = await post(app, `name=Jane&${DECOY}=spam&${TURNSTILE_FIELD_DEFAULT}=solved-token`);
    expect(res.status).toBe(422);
    expect(verified).toBe(false);
  });
});

describe("defineAction — injected field derivation", () => {
  const SECRET = "a".repeat(64);

  function keysAction() {
    return defineAction({ schema: NameSchema, handle: (data) => new Response(Object.keys(data).join(",")) });
  }

  function issueTypesAction() {
    return defineAction({
      schema: NameSchema,
      handle: () => new Response("success"),
      onValidationError: (issues) => new Response(issues.map((issue) => issue.type).join("|"), { status: 400 }),
    });
  }

  async function guardedApp(tokenField?: string) {
    const key = await importCsrfKey(SECRET);
    const app = new Forge();
    mapHandler(app, "POST", "/guarded", {
      middleware: [csrfProtection({ secret: () => key, subject: false, ...(tokenField !== undefined ? { tokenField } : {}) })],
      handler: keysAction(),
    });
    return { app, token: await createCsrfToken(key, "/guarded") };
  }

  it("strips the CSRF token from a body validated against a schema that never declares it", async () => {
    const { app, token } = await guardedApp();

    const res = await post(app, `${CSRF_FIELD_DEFAULT}=${token}&name=Jane`, "/guarded");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("name");
  });

  it("strips a renamed CSRF field with no second declaration anywhere on the route", async () => {
    const { app, token } = await guardedApp("xsrf");

    const res = await post(app, `xsrf=${token}&name=Jane`, "/guarded");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("name");
  });

  it("strips only the name the guard actually consumed, so a stray default field is still refused", async () => {
    const key = await importCsrfKey(SECRET);
    const app = new Forge();
    mapHandler(app, "POST", "/guarded", {
      middleware: [csrfProtection({ secret: () => key, subject: false, tokenField: "xsrf" })],
      handler: issueTypesAction(),
    });
    const token = await createCsrfToken(key, "/guarded");

    const res = await post(app, `xsrf=${token}&name=Jane&${CSRF_FIELD_DEFAULT}=stray`, "/guarded");
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("strict_object");
  });

  it("refuses _csrf as an undeclared field when no CSRF middleware ran", async () => {
    const res = await post(makeApp(issueTypesAction()), `name=Jane&${CSRF_FIELD_DEFAULT}=whatever`);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("strict_object");
  });

  it("names the unconsumed CSRF field in the default refusal, pointing at the missing middleware", async () => {
    const res = await post(
      makeApp(defineAction({ schema: NameSchema, handle: () => new Response("success") })),
      `name=Jane&${CSRF_FIELD_DEFAULT}=whatever`,
    );
    expect(res.status).toBe(422);
    expect(await res.text()).toBe(refusal(CSRF_FIELD_DEFAULT));
  });

  it("refuses a renamed CSRF field when no CSRF middleware ran", async () => {
    const res = await post(makeApp(issueTypesAction()), "name=Jane&xsrf=whatever");
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("strict_object");
  });

  it("keeps the CSRF drop per request rather than per route, across two apps in one isolate", async () => {
    const { app: guarded, token } = await guardedApp();
    const unguarded = makeApp(issueTypesAction());

    expect(await (await post(guarded, `${CSRF_FIELD_DEFAULT}=${token}&name=Jane`, "/guarded")).text()).toBe("name");
    expect(await (await post(unguarded, `name=Jane&${CSRF_FIELD_DEFAULT}=whatever`)).text()).toBe("strict_object");
    expect(await (await post(guarded, `${CSRF_FIELD_DEFAULT}=${token}&name=Jane`, "/guarded")).text()).toBe("name");
  });
});

describe("defineAction — the one refusal", () => {
  const DECOY = "company";
  const EmailSchema = strictObject({ email: v.pipe(v.string(), v.email()) });
  const UnionSchema = v.union([strictObject({ name: v.string() }), strictObject({ email: v.string() })]);
  const LONG_KEY = "k".repeat(30_000);

  it("renders exactly this markup, which is the literal every other case here is asserted against", () => {
    expect(refusal("name")).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground"><p>Please correct the following fields.</p><ul class="mt-2 list-disc pl-5"><li>name</li></ul></div>',
    );
  });

  it("answers 422 by default — a well-formed request the server understood and declined", async () => {
    const res = await post(makeApp(defineAction({ schema: EmailSchema, handle: () => new Response("success") })), "email=not-an-email");
    expect(res.status).toBe(422);
    expect(await res.text()).toBe(refusal("email"));
  });

  it("lets onValidationError replace the status and the body entirely, including with a 2xx", async () => {
    const app = makeApp(
      defineAction({
        schema: NameSchema,
        handle: () => new Response("success"),
        onValidationError: () => new Response("<p>try again</p>", { status: 200, headers: { "content-type": "text/html" } }),
      }),
    );

    const res = await post(app, "name=");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<p>try again</p>");
  });

  it("puts neither the submitted value nor the schema's own pattern into the response", async () => {
    const Schema = strictObject({ password: v.pipe(v.string(), v.regex(/^(?=.*[A-Z]).{12,}$/)) });
    const app = makeApp(defineAction({ schema: Schema, handle: () => new Response("success") }));

    const res = await post(app, "password=hunter2secret");
    const body = await res.text();
    expect(res.status).toBe(422);
    expect(body).toBe(refusal("password"));
    expect(body.includes("hunter2secret")).toBe(false);
    expect(body.includes("(?=.*[A-Z])")).toBe(false);
    expect(body.includes("{12,}")).toBe(false);
  });

  it("answers a 50,000-character value and a 5-character one with byte-identical refusals", async () => {
    const app = makeApp(defineAction({ schema: EmailSchema, handle: () => new Response("success") }));

    const huge = await post(app, `email=${"z".repeat(50_000)}&${LONG_KEY}=1`);
    const small = await post(app, `email=zzzzz&${LONG_KEY}=1`);
    const hugeBody = await huge.text();
    const smallBody = await small.text();

    expect(huge.status).toBe(422);
    expect(small.status).toBe(huge.status);
    expect(hugeBody).toBe(smallBody);
    expect(hugeBody).toBe(refusal("email"));
    expect(hugeBody.length).toBe(refusal("email").length);
  });

  it("bounds the answer identically when the long value passes and the undeclared key is what fails", async () => {
    const app = makeApp(defineAction({ schema: NameSchema, handle: () => new Response("success") }));

    const huge = await post(app, `name=${"z".repeat(50_000)}&${LONG_KEY}=1`);
    const small = await post(app, `name=Jane&${LONG_KEY}=1`);
    const hugeBody = await huge.text();

    expect(huge.status).toBe(422);
    expect(small.status).toBe(422);
    expect(hugeBody).toBe(await small.text());
    expect(hugeBody).toBe(refusal("k".repeat(40)));
  });

  it("cannot have its response multiplied by a caller adding fields", async () => {
    const app = makeApp(defineAction({ schema: EmailSchema, handle: () => new Response("success") }));
    const extras = Array.from({ length: 500 }, (_, index) => `extra${index}=1`).join("&");

    const bare = await post(app, "email=nope");
    const padded = await post(app, `email=nope&${extras}`);

    expect(await padded.text()).toBe(await bare.text());
    expect(padded.status).toBe(bare.status);
  });

  it("pins the issue count to one for a body failing two declared fields", async () => {
    const Schema = strictObject({ a: v.pipe(v.string(), v.minLength(2)), b: v.pipe(v.string(), v.minLength(2)) });
    const app = makeApp(
      defineAction({
        schema: Schema,
        handle: () => new Response("success"),
        onValidationError: (issues) => new Response(String(issues.length), { status: 400 }),
      }),
    );

    const res = await post(app, "a=&b=");
    expect(await res.text()).toBe("1");
  });

  it("renders one list item for a body failing two declared fields", async () => {
    const Schema = strictObject({ a: v.pipe(v.string(), v.minLength(2)), b: v.pipe(v.string(), v.minLength(2)) });
    const app = makeApp(defineAction({ schema: Schema, handle: () => new Response("success") }));

    const res = await post(app, "a=&b=");
    expect(await res.text()).toBe(refusal("a"));
  });

  it("truncates a caller-supplied v.record key to forty characters", async () => {
    const Schema = v.record(v.string(), v.pipe(v.string(), v.minLength(5)));
    const app = makeApp(defineAction({ schema: Schema, handle: () => new Response("success") }));

    const res = await post(app, `${"q".repeat(200)}=x`);
    expect(res.status).toBe(422);
    expect(await res.text()).toBe(refusal("q".repeat(40)));
  });

  it("still escapes what it does render", async () => {
    const app = makeApp(defineAction({ schema: NameSchema, handle: () => new Response("success") }));

    const res = await post(app, `name=Jane&${encodeURIComponent("a&b'c\"d<e>f")}=1`);
    expect(res.status).toBe(422);
    expect(await res.text()).toBe(refusal("a&amp;b&#39;c&quot;d&lt;e&gt;f"));
  });

  it("answers a filled honeypot and a mistyped field with byte-identical refusals", async () => {
    const guarded = makeApp(defineAction({ schema: NameSchema, honeypot: DECOY, handle: () => new Response("success") }));
    const plain = makeApp(defineAction({ schema: NameSchema, handle: () => new Response("success") }));

    const bot = await post(guarded, `name=Jane&${DECOY}=spam`);
    const human = await post(plain, "name=");
    const botBody = await bot.text();

    expect(bot.status).toBe(422);
    expect(human.status).toBe(422);
    expect(botBody).toBe(await human.text());
    expect(botBody).toBe(refusal("name"));
  });

  it("answers a failed Turnstile check with the same bytes as a schema refusal", async () => {
    fakeSiteverify(async () => new Response(JSON.stringify({ success: false })));

    const guarded = makeApp(
      defineAction({
        schema: NameSchema,
        turnstile: { secretKey: () => "test-secret", verify: () => ({ expectedHostname: "localhost" }) },
        handle: () => new Response("success"),
      }),
    );
    const plain = makeApp(defineAction({ schema: NameSchema, handle: () => new Response("success") }));

    const bot = await post(guarded, `name=Jane&${TURNSTILE_FIELD_DEFAULT}=bad-token`);
    const human = await post(plain, "name=");

    expect(bot.status).toBe(422);
    expect(human.status).toBe(422);
    expect(await bot.text()).toBe(await human.text());
  });

  it("falls back to the same generic wording for a schema with no entries to name", async () => {
    const app = makeApp(defineAction({ schema: UnionSchema, honeypot: DECOY, handle: () => new Response("success") }));

    const bot = await post(app, `name=Jane&${DECOY}=spam`);
    const human = await post(app, "zzz=1");
    const botBody = await bot.text();

    expect(bot.status).toBe(422);
    expect(human.status).toBe(422);
    expect(botBody).toBe(await human.text());
    expect(botBody).toBe(refusal("the submitted form"));
  });

  it("never names the decoy in any refusal it renders", async () => {
    fakeSiteverify(async () => new Response(JSON.stringify({ success: false })));

    const app = makeApp(
      defineAction({
        schema: NameSchema,
        honeypot: DECOY,
        turnstile: { secretKey: () => "test-secret", verify: () => ({ expectedHostname: "localhost" }) },
        handle: () => new Response("success"),
      }),
    );

    const bodies = [
      await (await post(app, `name=Jane&${DECOY}=spam&${TURNSTILE_FIELD_DEFAULT}=t`)).text(),
      await (await post(app, `name=Jane&${DECOY}=&${TURNSTILE_FIELD_DEFAULT}=bad`)).text(),
      await (await post(app, `name=&${DECOY}=&${TURNSTILE_FIELD_DEFAULT}=t`)).text(),
    ];

    for (const body of bodies) {
      expect(body.includes(DECOY)).toBe(false);
      expect(body).toBe(refusal("name"));
    }
  });

  it("never names the decoy when the decoy is itself the only undeclared field left", async () => {
    const app = makeApp(defineAction({ schema: NameSchema, handle: () => new Response("success") }));

    const res = await post(app, `name=Jane&${DECOY}=spam`);
    expect(await res.text()).toBe(refusal(DECOY));
  });
});
