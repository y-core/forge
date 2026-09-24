import { describe, expect, it } from "bun:test";

import { Forge } from "../app/forge-app";
import { mapHandler } from "../testing/route";
import { isFormCapConflict, parseFormData } from "./parse-form-data";
import type { ReadonlyFormData } from "./types";

describe("parseFormData", () => {
  it("parses form data and returns it", async () => {
    let fd: ReadonlyFormData | undefined;
    const app = new Forge();
    mapHandler(app, "POST", "/test", async (c) => {
      fd = await parseFormData(c);
      return new Response("ok");
    });

    await app.request("/test", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "name=Alice" });
    expect(fd).toBeInstanceOf(FormData);
    expect(fd?.get("name")).toBe("Alice");
  });

  it("memoizes — repeated calls return the same FormData instance", async () => {
    let first: ReadonlyFormData | undefined;
    let second: ReadonlyFormData | undefined;
    const app = new Forge();
    mapHandler(app, "POST", "/test", async (c) => {
      first = await parseFormData(c);
      second = await parseFormData(c);
      return new Response("ok");
    });

    await app.request("/test", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "name=Alice" });
    expect(first).toBe(second);
  });

  it("propagates errors from body parsing", async () => {
    const app = new Forge();
    mapHandler(app, "POST", "/test", async (c) => {
      try {
        await parseFormData(c);
        return new Response("ok");
      } catch {
        return new Response("error", { status: 400 });
      }
    });

    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Alice" }),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("error");
  });
});

function streamOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

/** A context over a request whose body is a stream, so it carries no `Content-Length` to refuse on. */
function streamedContext(text: string): Parameters<typeof parseFormData>[0] {
  const request = new Request("http://localhost/test", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: streamOf(text),
    duplex: "half",
  } as unknown as RequestInit);
  return { request } as unknown as Parameters<typeof parseFormData>[0];
}

describe("parseFormData — byte limits", () => {
  it("rejects an oversized body via the Content-Length fast-path with status 413", async () => {
    let status = 0;
    const app = new Forge();
    mapHandler(app, "POST", "/test", async (c) => {
      try {
        await parseFormData(c, { maxBytes: 10 });
        return new Response("ok");
      } catch (err) {
        status = (err as { status?: number }).status ?? 0;
        return new Response("too large", { status: 413 });
      }
    });
    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `name=${"x".repeat(100)}`,
    });
    expect(res.status).toBe(413);
    expect(status).toBe(413);
  });

  it("rejects an oversized body on the stream when Content-Length is absent (chunked bypass)", async () => {
    const big = `name=${"x".repeat(100)}`;
    // No Content-Length on a ReadableStream body, so only the streaming cap can catch it.
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: streamOf(big),
      duplex: "half",
    } as unknown as RequestInit);
    expect(req.headers.get("content-length")).toBeNull();

    const ctx = { request: req } as unknown as Parameters<typeof parseFormData>[0];
    let status = 0;
    try {
      await parseFormData(ctx, { maxBytes: 10 });
    } catch (err) {
      status = (err as { status?: number }).status ?? 0;
    }
    expect(status).toBe(413);
  });

  it("re-checks the shared parse against each caller's own cap", async () => {
    let generous: ReadonlyFormData | undefined;
    let strictStatus = 0;
    const app = new Forge();
    mapHandler(app, "POST", "/test", async (c) => {
      generous = await parseFormData(c, { maxBytes: 1000 });
      try {
        await parseFormData(c, { maxBytes: 4 });
      } catch (err) {
        strictStatus = (err as { status?: number }).status ?? 0;
      }
      return new Response("ok");
    });

    await app.request("/test", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "name=Alice" });
    expect(generous?.get("name")).toBe("Alice");
    expect(strictStatus).toBe(413);
  });

  it("does not let a strict caller's rejection revoke an earlier caller's accepted parse", async () => {
    let before: ReadonlyFormData | undefined;
    let after: ReadonlyFormData | undefined;
    const app = new Forge();
    mapHandler(app, "POST", "/test", async (c) => {
      before = await parseFormData(c, { maxBytes: 1000 });
      await parseFormData(c, { maxBytes: 4 }).catch(() => {});
      after = await parseFormData(c, { maxBytes: 1000 });
      return new Response("ok");
    });

    await app.request("/test", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "name=Alice" });
    expect(before).toBe(after);
    expect(after?.get("name")).toBe("Alice");
  });

  it("reports a strict-first, generous-second ordering as the wiring conflict it is", async () => {
    // Streamed, so the strict caller's refusal comes off the metering transform and spends the body.
    // Over Content-Length the refusal costs nothing, and the case below is what happens instead.
    const ctx = streamedContext("name=Alice");
    let thrown: unknown;
    await parseFormData(ctx, { maxBytes: 4 }).catch(() => {});
    try {
      await parseFormData(ctx, { maxBytes: 1000 });
    } catch (err) {
      thrown = err;
    }

    expect(isFormCapConflict(thrown)).toBe(true);
    expect((thrown as { status?: number }).status).toBeUndefined();
    expect((thrown as Error).message).toContain("4 bytes");
    expect((thrown as Error).message).toContain("1000-byte");
    expect((thrown as Error).message).toContain("csrfProtection");
  });

  // The regression the design nearly caused: comparing caps alone would turn every raised-cap route
  // from "works below the small cap" into "never works".
  it("still serves a body inside the strict cap to a later, more generous caller", async () => {
    let strict: ReadonlyFormData | undefined;
    let generous: ReadonlyFormData | undefined;
    const app = new Forge();
    mapHandler(app, "POST", "/test", async (c) => {
      strict = await parseFormData(c, { maxBytes: 100 });
      generous = await parseFormData(c, { maxBytes: 5000 });
      return new Response("ok");
    });

    await app.request("/test", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "name=Alice" });
    expect(strict).toBe(generous);
    expect(generous?.get("name")).toBe("Alice");
  });

  it("leaves a genuine oversize refusal a 413, not a conflict, when the later cap is no larger", async () => {
    const ctx = streamedContext("name=Alice");
    let thrown: unknown;
    await parseFormData(ctx, { maxBytes: 4 }).catch(() => {});
    try {
      await parseFormData(ctx, { maxBytes: 4 });
    } catch (err) {
      thrown = err;
    }

    expect(isFormCapConflict(thrown)).toBe(false);
    expect((thrown as { status?: number }).status).toBe(413);
  });

  // A Content-Length refusal is decided off a header and never opens the stream, so the body is
  // still there. Reporting "the stream is gone" to the next caller would be a false wiring error.
  it("serves a later, larger caller after a Content-Length refusal, because the body was never read", async () => {
    const req = new Request("http://localhost/test", {
      method: "POST",
      // Set explicitly: a Worker receives one from the client, but `new Request` does not add it.
      headers: { "content-type": "application/x-www-form-urlencoded", "content-length": "10" },
      body: "name=Alice",
    });
    const ctx = { request: req } as unknown as Parameters<typeof parseFormData>[0];

    const refusal = await parseFormData(ctx, { maxBytes: 4 }).then(
      () => undefined,
      (err: unknown) => err,
    );
    expect((refusal as { status?: number }).status).toBe(413);
    expect(isFormCapConflict(refusal)).toBe(false);
    expect(req.bodyUsed).toBe(false);

    expect((await parseFormData(ctx, { maxBytes: 1000 })).get("name")).toBe("Alice");
  });

  // Every other case here is urlencoded, where the boundary the re-wrapping `Response` must be handed
  // does not exist. Multipart is the encoding that proves the metered stream is still decodable.
  it("round-trips a multipart body through the metering transform", async () => {
    const app = new Forge();
    mapHandler(app, "POST", "/test", async (c) => {
      const fd = await parseFormData(c);
      return new Response(`${fd.get("name") as string}|${fd.get("message") as string}`);
    });

    const form = new FormData();
    form.append("name", "Alice");
    form.append("message", "Hello.");
    const res = await app.request("/test", { method: "POST", body: form });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Alice|Hello.");
  });

  it("accepts a body within the limit", async () => {
    const app = new Forge();
    mapHandler(app, "POST", "/test", async (c) => {
      const fd = await parseFormData(c, { maxBytes: 1000 });
      return new Response(fd.get("name") as string);
    });
    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=Alice",
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Alice");
  });
});
