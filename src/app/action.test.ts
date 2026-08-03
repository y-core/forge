import { describe, expect, it } from "bun:test";
import { CSRF_FIELD_DEFAULT } from "../form/constants";
import { createCsrfToken, csrfProtection, importCsrfKey } from "../form/csrf";
import { defineAction } from "./action";
import { Forge } from "./forge-app";
import { mapHandler } from "./route-test-helper";

interface TestData {
  name: string;
}

function makeApp(action: ReturnType<typeof defineAction<TestData>>) {
  const app = new Forge();
  mapHandler(app, "POST", "/test", action);
  return app;
}

const VALID_FORM = new URLSearchParams({ name: "Jane" });

describe("defineAction", () => {
  it("runs full pipeline successfully", async () => {
    const app = makeApp(
      defineAction<TestData>({
        parse: (fd) => ({ name: fd.get("name") as string }),
        validate: (data) => (data.name ? { ok: true, data } : { ok: false, error: ["Name required"] }),
        handle: () => new Response("success"),
      }),
    );

    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: VALID_FORM.toString(),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("success");
  });

  it("returns validation error fragment when validation fails", async () => {
    const app = makeApp(
      defineAction<TestData>({
        parse: (fd) => ({ name: fd.get("name") as string }),
        validate: (_data) => ({ ok: false, error: ["Name required."] }),
        handle: () => new Response("success"),
      }),
    );

    const res = await app.request("/test", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "name=Jane" });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Name required.");
    expect(text).toContain("Please correct the following fields.");
  });

  it("returns 400 when body cannot be parsed as form data", async () => {
    const app = makeApp(
      defineAction<TestData>({
        parse: (fd) => ({ name: fd.get("name") as string }),
        validate: (data) => (data.name ? { ok: true, data } : { ok: false, error: ["Name required"] }),
        handle: () => new Response("success"),
      }),
    );

    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Jane" }),
    });
    expect(res.status).toBe(400);
  });

  it("calls onValidationError when provided", async () => {
    const app = makeApp(
      defineAction<TestData>({
        parse: (fd) => ({ name: fd.get("name") as string }),
        validate: (_data) => ({ ok: false, error: ["Bad"] }),
        handle: () => new Response("success"),
        onValidationError: () => new Response("custom error", { status: 422 }),
      }),
    );

    const res = await app.request("/test", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "name=Jane" });
    expect(res.status).toBe(422);
    expect(await res.text()).toBe("custom error");
  });

  it("returns 500 fragment when handler throws", async () => {
    const app = makeApp(
      defineAction<TestData>({
        parse: (fd) => ({ name: fd.get("name") as string }),
        validate: (data) => (data.name ? { ok: true, data } : { ok: false, error: ["Name required"] }),
        handle: () => {
          throw new Error("downstream failure");
        },
      }),
    );

    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: VALID_FORM.toString(),
    });
    expect(res.status).toBe(500);
  });

  it("calls onError when handler throws and onError is provided", async () => {
    const app = makeApp(
      defineAction<TestData>({
        parse: (fd) => ({ name: fd.get("name") as string }),
        validate: (data) => (data.name ? { ok: true, data } : { ok: false, error: ["required"] }),
        handle: () => {
          throw new Error("oops");
        },
        onError: () => new Response("custom 500", { status: 500 }),
      }),
    );

    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: VALID_FORM.toString(),
    });
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
      handler: defineAction<TestData>({
        parse: (fd) => ({ name: fd.get("name") as string }),
        validate: (data) => (data.name ? { ok: true, data } : { ok: false, error: ["required"] }),
        handle: () => {
          order.push("handle");
          return new Response("ok");
        },
      }),
    });

    await app.request("/test", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: VALID_FORM.toString() });
    expect(order).toEqual(["mw", "handle"]);
  });

  it("returns 413 when the form body exceeds the default size limit", async () => {
    const app = makeApp(
      defineAction<TestData>({
        parse: (fd) => ({ name: fd.get("name") as string }),
        validate: (data) => (data.name ? { ok: true, data } : { ok: false, error: ["Name required"] }),
        handle: () => new Response("success"),
      }),
    );
    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      // 100 KB default limit; this body is ~200 KB.
      body: `name=${"x".repeat(200_000)}`,
    });
    expect(res.status).toBe(413);
  });

  it("rejects an oversized streaming body (no Content-Length) with the exact 413 fragment", async () => {
    // A ReadableStream body carries no Content-Length, so only parseFormData's streaming
    // byte counter can catch it — this pins the chunked-transfer bypass defense end-to-end.
    const app = makeApp(
      defineAction<TestData>({
        parse: (fd) => ({ name: fd.get("name") as string }),
        validate: (data) => (data.name ? { ok: true, data } : { ok: false, error: ["Name required"] }),
        handle: () => new Response("success"),
      }),
    );
    const big = `name=${"x".repeat(200_000)}`;
    const bytes = new TextEncoder().encode(big);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });

    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: stream,
      duplex: "half",
    } as unknown as RequestInit);

    expect(res.status).toBe(413);
    expect(await res.text()).toBe(
      '<div class="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"><p>The submitted form is too large. Please reduce its size and try again.</p></div>',
    );
  });

  it("accepts a body above the default cap when the route raises maxBytes", async () => {
    const app = makeApp(
      defineAction<TestData>({
        maxBytes: 300 * 1024,
        parse: (fd) => ({ name: fd.get("name") as string }),
        validate: (data) => (data.name ? { ok: true, data } : { ok: false, error: ["Name required"] }),
        handle: (data) => new Response(String(data.name.length)),
      }),
    );

    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `name=${"x".repeat(200_000)}`,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("200000");
  });

  it("still returns 413 for a body above the route's own raised cap", async () => {
    const app = makeApp(
      defineAction<TestData>({
        maxBytes: 150 * 1024,
        parse: (fd) => ({ name: fd.get("name") as string }),
        validate: (data) => (data.name ? { ok: true, data } : { ok: false, error: ["Name required"] }),
        handle: () => new Response("success"),
      }),
    );

    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `name=${"x".repeat(200_000)}`,
    });
    expect(res.status).toBe(413);
  });

  it("logs server-side when the handler throws", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      const app = makeApp(
        defineAction<TestData>({
          parse: (fd) => ({ name: fd.get("name") as string }),
          validate: (data) => (data.name ? { ok: true, data } : { ok: false, error: ["Name required"] }),
          handle: () => {
            throw new Error("boom downstream");
          },
        }),
      );
      await app.request("/test", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: VALID_FORM.toString() });
    } finally {
      console.log = originalLog;
    }
    expect(logs.some((l) => l.includes("Action handler threw"))).toBe(true);
  });
});

describe("defineAction behind csrfProtection — body size cap", () => {
  const RAISED = 300 * 1024;

  function echoAction(maxBytes?: number) {
    return defineAction<TestData>({
      ...(maxBytes !== undefined ? { maxBytes } : {}),
      parse: (fd) => ({ name: fd.get("name") as string }),
      validate: (data) => (data.name ? { ok: true, data } : { ok: false, error: ["Name required"] }),
      handle: (data) => new Response(String(data.name.length)),
    });
  }

  async function guardedBody(path: string, key: CryptoKey, payloadLength: number): Promise<string> {
    const token = await createCsrfToken(key, path);
    return `${CSRF_FIELD_DEFAULT}=${token}&name=${"x".repeat(payloadLength)}`;
  }

  const FORM_HEADERS = { "content-type": "application/x-www-form-urlencoded" };

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

    // Exercise the generous route first, then the strict one, then the generous one again: a cap
    // that leaked across requests would show up as the wrong verdict on the second or third call.
    const first = await app.request("/big", { method: "POST", headers: FORM_HEADERS, body: await guardedBody("/big", key, 200_000) });
    expect(first.status).toBe(200);

    const strict = await app.request("/small", { method: "POST", headers: FORM_HEADERS, body: await guardedBody("/small", key, 200_000) });
    expect(strict.status).toBe(413);

    const again = await app.request("/big", { method: "POST", headers: FORM_HEADERS, body: await guardedBody("/big", key, 200_000) });
    expect(again.status).toBe(200);
  });
});
