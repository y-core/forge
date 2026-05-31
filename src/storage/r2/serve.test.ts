import { describe, expect, it } from "bun:test";
import { serveObject } from "./serve";
import type { ObjectBody, ObjectStorageBackend, StoredObject } from "./types";

function makeObjectBody(overrides: Partial<StoredObject> = {}): ObjectBody {
  const text = "hello world";
  const base: StoredObject = {
    key: "test.txt",
    size: text.length,
    etag: "abc123",
    httpEtag: '"abc123"',
    uploaded: new Date("2026-01-01"),
    contentType: "text/plain",
    ...overrides,
  };
  return {
    ...base,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    }),
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(text).buffer as ArrayBuffer),
    text: () => Promise.resolve(text),
    blob: () => Promise.resolve(new Blob([text])),
  };
}

function makeBackend(obj: ObjectBody | null): ObjectStorageBackend {
  return {
    name: "test",
    async put() { return obj ?? makeObjectBody(); },
    async get(_key, _opts) { return obj; },
    async head(_key) { return obj; },
    async delete() {},
    async list() { return { objects: [], truncated: false }; },
  };
}

describe("serveObject — 200", () => {
  it("returns 200 with Content-Type and ETag headers", async () => {
    const backend = makeBackend(makeObjectBody());
    const res = await serveObject(backend, new Request("http://x/test.txt"), "test.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain");
    expect(res.headers.get("ETag")).toBe('"abc123"');
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
  });
});

describe("serveObject — 304 (conditional GET)", () => {
  it("returns 304 when ETag matches If-None-Match", async () => {
    const backend = makeBackend(makeObjectBody());
    const req = new Request("http://x/test.txt", { headers: { "If-None-Match": '"abc123"' } });
    const res = await serveObject(backend, req, "test.txt");
    expect(res.status).toBe(304);
  });

  it("returns 200 when ETag does not match", async () => {
    const backend = makeBackend(makeObjectBody());
    const req = new Request("http://x/test.txt", { headers: { "If-None-Match": '"stale"' } });
    const res = await serveObject(backend, req, "test.txt");
    expect(res.status).toBe(200);
  });
});

describe("serveObject — 206 (range request)", () => {
  it("returns 206 with Content-Range header for a byte range", async () => {
    const backend = makeBackend(makeObjectBody({ size: 100 }));
    const req = new Request("http://x/test.txt", { headers: { "Range": "bytes=0-9" } });
    const res = await serveObject(backend, req, "test.txt");
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 0-9/100");
    expect(res.headers.get("Content-Length")).toBe("10");
  });

  it("returns 206 for open-ended range", async () => {
    const backend = makeBackend(makeObjectBody({ size: 50 }));
    const req = new Request("http://x/test.txt", { headers: { "Range": "bytes=10-" } });
    const res = await serveObject(backend, req, "test.txt");
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 10-49/50");
  });
});

describe("serveObject — 416 (unsatisfiable range)", () => {
  it("returns 416 for offset beyond size", async () => {
    const backend = makeBackend(makeObjectBody({ size: 10 }));
    const req = new Request("http://x/test.txt", { headers: { "Range": "bytes=20-30" } });
    const res = await serveObject(backend, req, "test.txt");
    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe("bytes */10");
  });

  it("returns 416 for invalid range syntax", async () => {
    const backend = makeBackend(makeObjectBody());
    const req = new Request("http://x/test.txt", { headers: { "Range": "invalid" } });
    const res = await serveObject(backend, req, "test.txt");
    expect(res.status).toBe(416);
  });
});

describe("serveObject — 404", () => {
  it("returns 404 when object does not exist", async () => {
    const backend = makeBackend(null);
    const res = await serveObject(backend, new Request("http://x/missing.txt"), "missing.txt");
    expect(res.status).toBe(404);
  });
});
