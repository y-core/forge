import { describe, expect, it } from "bun:test";
import { Forge } from "../app/forge-app";
import { mapHandler } from "../app/route-test-helper";
import { parseFormData } from "./parse-form-data";
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
    // A ReadableStream body carries no Content-Length, so only the streaming cap can catch it.
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
