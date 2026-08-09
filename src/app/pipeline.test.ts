import { afterEach, describe, expect, it } from "bun:test";
import { TURNSTILE_FIELD_DEFAULT } from "../form/constants";
import { mapHandler } from "../testing/route";
import { strictObject } from "../validation/strict-object";
import { v } from "../validation/validation";
import { defineAction } from "./action";
import { Forge } from "./forge-app";

/**
 * The shared pipeline is `@internal` and not barrelled, so it is exercised through the builder that
 * owns the recovery arm each case is about. What is under test here is the pipeline's stated
 * propagate-don't-catch contract: **only the body parse catches its own failure**, and everything
 * after it — a `secretKey` lookup, a `verify` call, a hook that rejects instead of rendering — is
 * left to reach the builder's own `try`.
 *
 * These are the paths the extraction newly made worth covering. A hook that returned a *rejected
 * promise* previously escaped the handler entirely — no status, no `onError`, no log — while only a
 * synchronous throw landed on the 500 arm; the pipeline `await`s it, which is what makes the code
 * match `defineAction`'s own TSDoc.
 */

const NameSchema = strictObject({ name: v.pipe(v.string(), v.minLength(1, "Name required.")) });
const FORM_HEADERS = { "content-type": "application/x-www-form-urlencoded" };

/** Structural, so it accepts a `Forge` at any binding type without restating its generics. */
type Requestable = { request(path: string, init: RequestInit): Promise<Response> };

function makeApp(action: ReturnType<typeof defineAction>) {
  const app = new Forge();
  mapHandler(app, "POST", "/test", action);
  return app;
}

function post(app: Requestable, body: string, path = "/test"): Promise<Response> {
  return app.request(path, { method: "POST", headers: FORM_HEADERS, body });
}

/**
 * `defineAction`'s own recovery arm. Asserted as an exact body rather than as a status, because
 * forge's app-level boundary also answers 500 — a status-only assertion cannot tell "the builder
 * caught it" from "the framework caught it".
 */
const ACTION_500_FRAGMENT =
  '<div class="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"><p>Something went wrong. Please try again.</p></div>';

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

let savedFetch: typeof globalThis.fetch | undefined;

afterEach(() => {
  if (savedFetch) {
    globalThis.fetch = savedFetch;
    savedFetch = undefined;
  }
});

/** Replaces `fetch` for the siteverify call only; restored by the `afterEach` above. */
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
    // The throw happened before the network, so the outage the 500 reports is the route's own.
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
    // `secretKey` is documented as resolving per request, so a binding read that rejects is the
    // ordinary shape of this failure rather than an exotic one.
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

  it("still reaches handle through resolvers that do not throw", async () => {
    // The paired positive case: a route whose resolvers work must not be turned into a 500 by the
    // arm that catches the ones that do not.
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
        honeypot: "company",
        handle: () => new Response("success"),
        onBotDetected: () => Promise.reject(new Error("ban list unavailable")),
      }),
    );

    const res = await post(app, "name=Jane&company=spam");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(ACTION_500_FRAGMENT);
  });

  it("still renders an async onValidationError that resolves", async () => {
    // The paired positive case: awaiting the hook must not break the hook that works.
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
