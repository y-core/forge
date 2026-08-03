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
    async put() {
      return obj ?? makeObjectBody();
    },
    async get(_key, _opts) {
      return obj;
    },
    async head(_key) {
      return obj;
    },
    async delete() {},
    async list() {
      return { objects: [], truncated: false };
    },
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
    const req = new Request("http://x/test.txt", { headers: { Range: "bytes=0-9" } });
    const res = await serveObject(backend, req, "test.txt");
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 0-9/100");
    expect(res.headers.get("Content-Length")).toBe("10");
  });

  it("returns 206 for open-ended range", async () => {
    const backend = makeBackend(makeObjectBody({ size: 50 }));
    const req = new Request("http://x/test.txt", { headers: { Range: "bytes=10-" } });
    const res = await serveObject(backend, req, "test.txt");
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 10-49/50");
  });
});

describe("serveObject — 416 (unsatisfiable range)", () => {
  it("returns 416 for offset beyond size", async () => {
    const backend = makeBackend(makeObjectBody({ size: 10 }));
    const req = new Request("http://x/test.txt", { headers: { Range: "bytes=20-30" } });
    const res = await serveObject(backend, req, "test.txt");
    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe("bytes */10");
  });

  it("returns 416 for invalid range syntax", async () => {
    const backend = makeBackend(makeObjectBody());
    const req = new Request("http://x/test.txt", { headers: { Range: "invalid" } });
    const res = await serveObject(backend, req, "test.txt");
    expect(res.status).toBe(416);
  });

  it("returns 416 for an inverted range (end < start)", async () => {
    const backend = makeBackend(makeObjectBody({ size: 1000 }));
    const req = new Request("http://x/test.txt", { headers: { Range: "bytes=500-200" } });
    const res = await serveObject(backend, req, "test.txt");
    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe("bytes */*");
  });

  it("returns 416 for NaN range boundaries (non-numeric start and end)", async () => {
    const backend = makeBackend(makeObjectBody({ size: 1000 }));
    const req = new Request("http://x/test.txt", { headers: { Range: "bytes=abc-def" } });
    const res = await serveObject(backend, req, "test.txt");
    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe("bytes */*");
  });
});

describe("serveObject — 206 (valid range parse)", () => {
  it("returns 206 for a well-formed range bytes=0-499", async () => {
    const backend = makeBackend(makeObjectBody({ size: 1000 }));
    const req = new Request("http://x/test.txt", { headers: { Range: "bytes=0-499" } });
    const res = await serveObject(backend, req, "test.txt");
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 0-499/1000");
    expect(res.headers.get("Content-Length")).toBe("500");
  });
});

describe("serveObject — 404", () => {
  it("returns 404 when object does not exist", async () => {
    const backend = makeBackend(null);
    const res = await serveObject(backend, new Request("http://x/missing.txt"), "missing.txt");
    expect(res.status).toBe(404);
  });
});

describe("serveObject — Content-Disposition", () => {
  it("emits an ASCII filename plus an RFC 5987 filename* for a plain name", async () => {
    const backend = makeBackend(makeObjectBody({ key: "files/report final.pdf" }));
    const res = await serveObject(backend, new Request("http://x/f"), "files/report final.pdf", { contentDisposition: "attachment" });
    expect(res.headers.get("Content-Disposition")).toBe(`attachment; filename="report final.pdf"; filename*=UTF-8''report%20final.pdf`);
  });

  it("folds an accent to its base letter and escapes a quote in the fallback", async () => {
    const backend = makeBackend(makeObjectBody({ key: 'na"me-é.txt' }));
    const res = await serveObject(backend, new Request("http://x/f"), 'na"me-é.txt', { contentDisposition: "inline" });
    expect(res.headers.get("Content-Disposition")).toBe(`inline; filename="na\\"me-e.txt"; filename*=UTF-8''na%22me-%C3%A9.txt`);
  });

  it("serves a CJK filename with an ASCII fallback that keeps the extension", async () => {
    const backend = makeBackend(makeObjectBody({ key: "downloads/年度報告.pdf" }));
    const res = await serveObject(backend, new Request("http://x/f"), "downloads/年度報告.pdf", { contentDisposition: "attachment" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe(`attachment; filename="_.pdf"; filename*=UTF-8''%E5%B9%B4%E5%BA%A6%E5%A0%B1%E5%91%8A.pdf`);
  });

  it("yields a non-empty ASCII fallback for an entirely non-ASCII filename", async () => {
    const backend = makeBackend(makeObjectBody({ key: "文書" }));
    const res = await serveObject(backend, new Request("http://x/f"), "文書", { contentDisposition: "attachment" });
    expect(res.headers.get("Content-Disposition")).toBe(`attachment; filename="_"; filename*=UTF-8''%E6%96%87%E6%9B%B8`);
  });

  it("emits quotes and backslashes as quoted-pairs in the fallback", async () => {
    const backend = makeBackend(makeObjectBody({ key: 'back\\slash"quote.txt' }));
    const res = await serveObject(backend, new Request("http://x/f"), 'back\\slash"quote.txt', { contentDisposition: "attachment" });
    expect(res.headers.get("Content-Disposition")).toBe(
      `attachment; filename="back\\\\slash\\"quote.txt"; filename*=UTF-8''back%5Cslash%22quote.txt`,
    );
  });

  it("omits Content-Disposition when no disposition is requested", async () => {
    const backend = makeBackend(makeObjectBody());
    const res = await serveObject(backend, new Request("http://x/test.txt"), "test.txt");
    expect(res.headers.get("Content-Disposition")).toBeNull();
  });
});
