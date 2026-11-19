import { describe, expect, it } from "bun:test";

import { Forge } from "../../app/forge-app";
import { applySecurityHeaders, createSecurityHeaders } from "../../security/headers";
import { fakeR2 } from "../../testing/fakes";
import { mapHandler } from "../../testing/route";
import { UnsatisfiableRangeError } from "./errors";
import { r2Backend } from "./r2-backend";
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

function countingBackend(
  obj: ObjectBody | null,
  opts?: { throwOnGet?: unknown },
): { backend: ObjectStorageBackend; counters: { gets: number; heads: number } } {
  const counters = { gets: 0, heads: 0 };
  const backend: ObjectStorageBackend = {
    name: "counting",
    async put() {
      return obj ?? makeObjectBody();
    },
    async get() {
      counters.gets += 1;
      if (opts?.throwOnGet !== undefined) throw opts.throwOnGet;
      return obj;
    },
    async head() {
      counters.heads += 1;
      return obj;
    },
    async delete() {},
    async list() {
      return { objects: [], truncated: false };
    },
  };
  return { backend, counters };
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

const UPLOADED_HTTP_DATE = "Thu, 01 Jan 2026 00:00:00 GMT";

function conditional(headers: Record<string, string>): Request {
  return new Request("http://x/test.txt", { headers });
}

describe("serveObject — 304 (conditional GET)", () => {
  it("returns 304 when ETag matches If-None-Match", async () => {
    const res = await serveObject(makeBackend(makeObjectBody()), conditional({ "If-None-Match": '"abc123"' }), "test.txt");
    expect(res.status).toBe(304);
  });

  it("returns 200 when ETag does not match", async () => {
    const res = await serveObject(makeBackend(makeObjectBody()), conditional({ "If-None-Match": '"stale"' }), "test.txt");
    expect(res.status).toBe(200);
  });

  it("matches a weak If-None-Match and answers 304 carrying ETag and Last-Modified", async () => {
    const res = await serveObject(makeBackend(makeObjectBody()), conditional({ "If-None-Match": 'W/"abc123"' }), "test.txt");
    expect(res.status).toBe(304);
    expect(res.headers.get("ETag")).toBe('"abc123"');
    expect(res.headers.get("Last-Modified")).toBe(UPLOADED_HTTP_DATE);
  });

  it("answers 304 for a matching If-None-Match even when a Range is present", async () => {
    const res = await serveObject(makeBackend(makeObjectBody()), conditional({ "If-None-Match": '"abc123"', Range: "bytes=0-4" }), "test.txt");
    expect(res.status).toBe(304);
  });

  it("returns 304 when the object is unmodified since If-Modified-Since", async () => {
    const res = await serveObject(makeBackend(makeObjectBody()), conditional({ "If-Modified-Since": UPLOADED_HTTP_DATE }), "test.txt");
    expect(res.status).toBe(304);
    expect(res.headers.get("Last-Modified")).toBe(UPLOADED_HTTP_DATE);
  });

  it("returns 200 when the object changed after If-Modified-Since", async () => {
    const res = await serveObject(makeBackend(makeObjectBody()), conditional({ "If-Modified-Since": "Wed, 31 Dec 2025 00:00:00 GMT" }), "test.txt");
    expect(res.status).toBe(200);
  });

  it("ignores If-Modified-Since when If-None-Match is present", async () => {
    const req = conditional({ "If-None-Match": '"stale"', "If-Modified-Since": UPLOADED_HTTP_DATE });
    const res = await serveObject(makeBackend(makeObjectBody()), req, "test.txt");
    expect(res.status).toBe(200);
  });

  it("emits Last-Modified from the upload time on a 200", async () => {
    const res = await serveObject(makeBackend(makeObjectBody()), new Request("http://x/test.txt"), "test.txt");
    expect(res.headers.get("Last-Modified")).toBe(UPLOADED_HTTP_DATE);
  });
});

describe("serveObject — 412 (failed precondition)", () => {
  it("returns 412 when If-Match names another ETag", async () => {
    const res = await serveObject(makeBackend(makeObjectBody()), conditional({ "If-Match": '"other"' }), "test.txt");
    expect(res.status).toBe(412);
    expect(res.headers.get("ETag")).toBe('"abc123"');
  });

  it("returns 412 when If-Match names only a weak form of the ETag", async () => {
    const res = await serveObject(makeBackend(makeObjectBody()), conditional({ "If-Match": 'W/"abc123"' }), "test.txt");
    expect(res.status).toBe(412);
  });

  it("serves the object when If-Match matches or is a wildcard", async () => {
    const exact = await serveObject(makeBackend(makeObjectBody()), conditional({ "If-Match": '"abc123"' }), "test.txt");
    expect(exact.status).toBe(200);
    const wildcard = await serveObject(makeBackend(makeObjectBody()), conditional({ "If-Match": "*" }), "test.txt");
    expect(wildcard.status).toBe(200);
  });

  it("returns 412 when the object changed after If-Unmodified-Since", async () => {
    const req = conditional({ "If-Unmodified-Since": "Wed, 31 Dec 2025 00:00:00 GMT" });
    const res = await serveObject(makeBackend(makeObjectBody()), req, "test.txt");
    expect(res.status).toBe(412);
    expect(res.headers.get("Last-Modified")).toBe(UPLOADED_HTTP_DATE);
  });

  it("ignores If-Unmodified-Since when If-Match is present", async () => {
    const req = conditional({ "If-Match": '"abc123"', "If-Unmodified-Since": "Wed, 31 Dec 2025 00:00:00 GMT" });
    const res = await serveObject(makeBackend(makeObjectBody()), req, "test.txt");
    expect(res.status).toBe(200);
  });

  it("evaluates If-Match before If-None-Match", async () => {
    const req = conditional({ "If-Match": '"other"', "If-None-Match": '"abc123"' });
    const res = await serveObject(makeBackend(makeObjectBody()), req, "test.txt");
    expect(res.status).toBe(412);
  });
});

describe("serveObject — If-Range", () => {
  it("serves the whole object with 200 when If-Range names a stale ETag", async () => {
    const req = conditional({ Range: "bytes=0-4", "If-Range": '"stale"' });
    const res = await serveObject(makeBackend(makeObjectBody()), req, "test.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Range")).toBeNull();
    expect(res.headers.get("Content-Length")).toBe("11");
  });

  it("serves the whole object with 200 when If-Range names a stale date", async () => {
    const req = conditional({ Range: "bytes=0-4", "If-Range": "Wed, 31 Dec 2025 00:00:00 GMT" });
    const res = await serveObject(makeBackend(makeObjectBody()), req, "test.txt");
    expect(res.status).toBe(200);
  });

  it("serves the range with 206 when If-Range matches the ETag or the upload date", async () => {
    const byEtag = await serveObject(makeBackend(makeObjectBody()), conditional({ Range: "bytes=0-4", "If-Range": '"abc123"' }), "test.txt");
    expect(byEtag.status).toBe(206);
    expect(byEtag.headers.get("Content-Range")).toBe("bytes 0-4/11");
    const byDate = await serveObject(
      makeBackend(makeObjectBody()),
      conditional({ Range: "bytes=0-4", "If-Range": UPLOADED_HTTP_DATE }),
      "test.txt",
    );
    expect(byDate.status).toBe(206);
  });
});

describe("serveObject — Range on methods other than GET (RFC 9110 §14.2)", () => {
  for (const method of ["HEAD", "POST", "PUT"]) {
    it(`ignores Range on ${method} and answers 200 for the whole object`, async () => {
      const { backend, counters } = countingBackend(makeObjectBody());
      const req = new Request("http://x/test.txt", { method, headers: { Range: "bytes=0-4" } });
      const res = await serveObject(backend, req, "test.txt");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Range")).toBeNull();
      expect(res.headers.get("Content-Length")).toBe("11");
      expect(counters).toEqual({ gets: 1, heads: 0 });
    });
  }

  it("spends no head on If-Range when the method is HEAD", async () => {
    const { backend, counters } = countingBackend(makeObjectBody());
    const req = new Request("http://x/test.txt", { method: "HEAD", headers: { Range: "bytes=0-4", "If-Range": '"abc123"' } });
    const res = await serveObject(backend, req, "test.txt");
    expect(res.status).toBe(200);
    expect(counters).toEqual({ gets: 1, heads: 0 });
  });

  it("does not answer 416 on HEAD for a range past the end", async () => {
    const req = new Request("http://x/test.txt", { method: "HEAD", headers: { Range: "bytes=20-30" } });
    const res = await serveObject(makeBackend(makeObjectBody()), req, "test.txt");
    expect(res.status).toBe(200);
  });

  it("still answers 304 to a HEAD whose If-None-Match matches", async () => {
    const req = new Request("http://x/test.txt", { method: "HEAD", headers: { Range: "bytes=0-4", "If-None-Match": '"abc123"' } });
    const res = await serveObject(makeBackend(makeObjectBody()), req, "test.txt");
    expect(res.status).toBe(304);
  });
});

describe("serveObject — If-Range against a weak validator", () => {
  it("ignores the Range when If-Range carries a weak ETag, since If-Range compares strongly", async () => {
    const req = conditional({ Range: "bytes=0-4", "If-Range": 'W/"abc123"' });
    const res = await serveObject(makeBackend(makeObjectBody()), req, "test.txt");
    expect([res.status, res.headers.get("Content-Range"), await res.text()]).toEqual([200, null, "hello world"]);
  });

  it("ignores the Range when the stored ETag is weak, even though If-Range names its opaque tag", async () => {
    const req = conditional({ Range: "bytes=0-4", "If-Range": '"abc123"' });
    const res = await serveObject(makeBackend(makeObjectBody({ httpEtag: 'W/"abc123"' })), req, "test.txt");
    expect([res.status, res.headers.get("Content-Range")]).toEqual([200, null]);
  });

  it("serves the range on an If-Range date matching the upload, however weak the stored ETag", async () => {
    const req = conditional({ Range: "bytes=0-4", "If-Range": UPLOADED_HTTP_DATE });
    const res = await serveObject(makeBackend(makeObjectBody({ httpEtag: 'W/"abc123"' })), req, "test.txt");
    expect([res.status, res.headers.get("Content-Range")]).toEqual([206, "bytes 0-4/11"]);
  });

  it("serves the range on an If-Range date naming the upload's second, though the upload carried milliseconds", async () => {
    const req = conditional({ Range: "bytes=0-4", "If-Range": UPLOADED_HTTP_DATE });
    const res = await serveObject(makeBackend(makeObjectBody({ uploaded: new Date("2026-01-01T00:00:00.750Z") })), req, "test.txt");
    expect([res.status, res.headers.get("Content-Range")]).toEqual([206, "bytes 0-4/11"]);
  });

  it("serves the whole object rather than 416 when a stale If-Range voids an unsatisfiable Range", async () => {
    const req = conditional({ Range: "bytes=500-600", "If-Range": '"stale"' });
    const res = await serveObject(makeBackend(makeObjectBody()), req, "test.txt");
    expect([res.status, res.headers.get("Content-Range"), res.headers.get("Content-Length")]).toEqual([200, null, "11"]);
  });

  it("answers 416 when a matching If-Range admits an unsatisfiable Range", async () => {
    const req = conditional({ Range: "bytes=500-600", "If-Range": '"abc123"' });
    const res = await serveObject(makeBackend(makeObjectBody()), req, "test.txt");
    expect([res.status, res.headers.get("Content-Range")]).toEqual([416, "bytes */11"]);
  });

  it("ignores If-Range without a Range, spending no head on it", async () => {
    const { backend, counters } = countingBackend(makeObjectBody());
    const res = await serveObject(backend, conditional({ "If-Range": '"stale"' }), "test.txt");
    expect([res.status, await res.text(), counters]).toEqual([200, "hello world", { gets: 1, heads: 0 }]);
  });
});

describe("serveObject — precondition interactions (RFC 9110 §13.2.2)", () => {
  it("serves the range when If-Match passes beside it", async () => {
    const req = conditional({ "If-Match": '"abc123"', Range: "bytes=0-4" });
    const res = await serveObject(makeBackend(makeObjectBody()), req, "test.txt");
    expect([res.status, res.headers.get("Content-Range")]).toEqual([206, "bytes 0-4/11"]);
  });

  it("answers 412 before the Range is considered, fetching no body", async () => {
    const { backend, counters } = countingBackend(makeObjectBody());
    const res = await serveObject(backend, conditional({ "If-Match": '"other"', Range: "bytes=0-4" }), "test.txt");
    expect([res.status, res.headers.get("Content-Range"), await res.text(), counters]).toEqual([
      412,
      null,
      "Precondition Failed",
      { gets: 0, heads: 1 },
    ]);
  });

  it("answers 412 for an If-Match naming the stored weak ETag, since If-Match compares strongly", async () => {
    const res = await serveObject(makeBackend(makeObjectBody({ httpEtag: 'W/"abc123"' })), conditional({ "If-Match": 'W/"abc123"' }), "test.txt");
    expect([res.status, res.headers.get("ETag")]).toEqual([412, 'W/"abc123"']);
  });

  it("answers 412 for a failed If-Unmodified-Since before a matching If-None-Match is reached", async () => {
    const req = conditional({ "If-Unmodified-Since": "Wed, 31 Dec 2025 00:00:00 GMT", "If-None-Match": '"abc123"' });
    const res = await serveObject(makeBackend(makeObjectBody()), req, "test.txt");
    expect(res.status).toBe(412);
  });

  it("answers 304 for If-None-Match `*` on an object that exists, with an empty body and no get", async () => {
    const { backend, counters } = countingBackend(makeObjectBody());
    const res = await serveObject(backend, conditional({ "If-None-Match": "*" }), "test.txt");
    expect([res.status, res.headers.get("ETag"), res.headers.get("Last-Modified"), await res.text(), counters]).toEqual([
      304,
      '"abc123"',
      UPLOADED_HTTP_DATE,
      "",
      { gets: 0, heads: 1 },
    ]);
  });

  it("answers 304 for If-None-Match `*` beside a Range", async () => {
    const res = await serveObject(makeBackend(makeObjectBody()), conditional({ "If-None-Match": "*", Range: "bytes=0-4" }), "test.txt");
    expect([res.status, res.headers.get("Content-Range")]).toEqual([304, null]);
  });

  it("answers 304 when the ETag is one entry of an If-None-Match list", async () => {
    const res = await serveObject(makeBackend(makeObjectBody()), conditional({ "If-None-Match": '"v1", W/"abc123", "v3"' }), "test.txt");
    expect(res.status).toBe(304);
  });

  it("answers 304 for a strong If-None-Match against a weak stored ETag, as an edge-compressed object carries", async () => {
    const res = await serveObject(
      makeBackend(makeObjectBody({ httpEtag: 'W/"abc123"' })),
      conditional({ "If-None-Match": '"abc123"' }),
      "test.txt",
    );
    expect([res.status, res.headers.get("ETag")]).toEqual([304, 'W/"abc123"']);
  });

  it("serves the range when a stale If-None-Match sits beside it", async () => {
    const res = await serveObject(makeBackend(makeObjectBody()), conditional({ "If-None-Match": '"stale"', Range: "bytes=0-4" }), "test.txt");
    expect([res.status, res.headers.get("Content-Range")]).toEqual([206, "bytes 0-4/11"]);
  });

  const missing: ReadonlyArray<Record<string, string>> = [
    { "If-Match": '"abc123"' },
    { "If-Match": "*" },
    { "If-None-Match": "*" },
    { "If-Unmodified-Since": UPLOADED_HTTP_DATE },
    { "If-Modified-Since": UPLOADED_HTTP_DATE },
  ];

  for (const headers of missing) {
    it(`answers 404 rather than 304 or 412 for a missing object under ${Object.keys(headers)[0]}: ${Object.values(headers)[0]}`, async () => {
      const res = await serveObject(makeBackend(null), conditional(headers), "missing.txt");
      expect(res.status).toBe(404);
    });
  }
});

describe("serveObject — HTTP-date preconditions at one-second precision", () => {
  const uploadedMidSecond = () => makeObjectBody({ uploaded: new Date("2026-01-01T00:00:00.750Z") });

  it("answers 304 to If-Modified-Since naming the upload's second, though the upload carried milliseconds", async () => {
    const res = await serveObject(makeBackend(uploadedMidSecond()), conditional({ "If-Modified-Since": UPLOADED_HTTP_DATE }), "test.txt");
    expect(res.status).toBe(304);
  });

  it("serves the object to If-Unmodified-Since naming the upload's second, though the upload carried milliseconds", async () => {
    const res = await serveObject(makeBackend(uploadedMidSecond()), conditional({ "If-Unmodified-Since": UPLOADED_HTTP_DATE }), "test.txt");
    expect(res.status).toBe(200);
  });

  it("serves the object to an If-Unmodified-Since later than the upload", async () => {
    const res = await serveObject(
      makeBackend(makeObjectBody()),
      conditional({ "If-Unmodified-Since": "Fri, 02 Jan 2026 00:00:00 GMT" }),
      "test.txt",
    );
    expect(res.status).toBe(200);
  });

  for (const header of ["If-Modified-Since", "If-Unmodified-Since"]) {
    it(`ignores an ${header} that is not a date`, async () => {
      const res = await serveObject(makeBackend(makeObjectBody()), conditional({ [header]: "not a date" }), "test.txt");
      expect([res.status, await res.text()]).toEqual([200, "hello world"]);
    });
  }
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
});

describe("serveObject — ignored Range (RFC 9110 §14.2)", () => {
  const ignored: ReadonlyArray<{ label: string; range: string }> = [
    { label: "invalid syntax", range: "invalid" },
    { label: "an inverted range", range: "bytes=500-200" },
    { label: "non-numeric boundaries", range: "bytes=abc-def" },
    { label: "a multi-range request", range: "bytes=0-1,4-5" },
    { label: "an unknown unit", range: "items=0-1" },
  ];

  for (const { label, range } of ignored) {
    it(`serves the whole object with 200 for ${label}`, async () => {
      const backend = makeBackend(makeObjectBody());
      const res = await serveObject(backend, new Request("http://x/test.txt", { headers: { Range: range } }), "test.txt");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Range")).toBeNull();
      expect(res.headers.get("Content-Length")).toBe("11");
    });
  }
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

describe("serveObject — range contract", () => {
  it("refuses a 400-digit first-byte-pos without calling the backend", async () => {
    const { backend, counters } = countingBackend(makeObjectBody());
    const res = await serveObject(backend, new Request("http://x/t", { headers: { Range: `bytes=${"9".repeat(400)}-` } }), "test.txt");
    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe("bytes */*");
    expect(counters.gets).toBe(0);
  });

  it("answers 416 with the size from head when the backend refuses the range", async () => {
    const { backend, counters } = countingBackend(makeObjectBody(), { throwOnGet: new UnsatisfiableRangeError("test.txt") });
    const res = await serveObject(backend, new Request("http://x/t", { headers: { Range: "bytes=500-600" } }), "test.txt");
    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe("bytes */11");
    expect(counters.heads).toBe(1);
  });

  it("answers `bytes */*` when the head that follows a refusal returns nothing", async () => {
    const { backend } = countingBackend(null, { throwOnGet: new UnsatisfiableRangeError("test.txt") });
    const res = await serveObject(backend, new Request("http://x/t", { headers: { Range: "bytes=500-600" } }), "test.txt");
    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe("bytes */*");
  });

  it("propagates a plain Error from the backend", async () => {
    const { backend } = countingBackend(makeObjectBody(), { throwOnGet: new Error("bucket unavailable") });
    await expect(serveObject(backend, new Request("http://x/t", { headers: { Range: "bytes=0-1" } }), "test.txt")).rejects.toThrow(
      "bucket unavailable",
    );
  });

  it("answers 416 from the head without a get when a precondition already fetched the size", async () => {
    const { backend, counters } = countingBackend(makeObjectBody());
    const req = new Request("http://x/t", { headers: { Range: "bytes=500-600", "If-None-Match": '"stale"' } });
    const res = await serveObject(backend, req, "test.txt");
    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe("bytes */11");
    expect(counters.gets).toBe(0);
  });

  it("cancels the body it fetched when the range proves unsatisfiable", async () => {
    let cancelled = false;
    const obj = makeObjectBody({ size: 10 });
    const body = new ReadableStream({
      cancel() {
        cancelled = true;
      },
    });
    const res = await serveObject(makeBackend({ ...obj, body }), new Request("http://x/t", { headers: { Range: "bytes=20-30" } }), "test.txt");
    expect(res.status).toBe(416);
    expect(cancelled).toBe(true);
  });

  it("spends no head on a satisfiable ranged get", async () => {
    const { backend, counters } = countingBackend(makeObjectBody());
    const res = await serveObject(backend, new Request("http://x/t", { headers: { Range: "bytes=0-4" } }), "test.txt");
    expect(res.status).toBe(206);
    expect(counters.heads).toBe(0);
    expect(counters.gets).toBe(1);
  });

  it("clamps an oversized last-byte-pos and an oversized suffix to the whole object", async () => {
    const backend = makeBackend(makeObjectBody());
    const bounded = await serveObject(backend, new Request("http://x/t", { headers: { Range: `bytes=0-${"9".repeat(400)}` } }), "test.txt");
    expect(bounded.status).toBe(206);
    expect(bounded.headers.get("Content-Range")).toBe("bytes 0-10/11");

    const suffix = await serveObject(makeBackend(makeObjectBody()), new Request("http://x/t", { headers: { Range: "bytes=-9999" } }), "test.txt");
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get("Content-Range")).toBe("bytes 0-10/11");
  });
});

describe("serveObject — headers", () => {
  it("emits Content-Encoding, Content-Language and nosniff", async () => {
    const backend = makeBackend(makeObjectBody({ contentEncoding: "gzip", contentLanguage: "en-GB" }));
    const res = await serveObject(backend, new Request("http://x/t"), "test.txt");
    expect(res.headers.get("Content-Encoding")).toBe("gzip");
    expect(res.headers.get("Content-Language")).toBe("en-GB");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("falls back to the object's stored Content-Disposition", async () => {
    const backend = makeBackend(makeObjectBody({ contentDisposition: 'attachment; filename="report.pdf"' }));
    const res = await serveObject(backend, new Request("http://x/t"), "test.txt");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="report.pdf"');
  });

  it("lets the option override the stored disposition", async () => {
    const backend = makeBackend(makeObjectBody({ contentDisposition: 'attachment; filename="stored.pdf"' }));
    const res = await serveObject(backend, new Request("http://x/t"), "test.txt", { contentDisposition: "inline" });
    expect(res.headers.get("Content-Disposition")).toBe("inline; filename=\"test.txt\"; filename*=UTF-8''test.txt");
  });

  it("drops a stored disposition carrying a non-ASCII byte rather than throwing", async () => {
    const backend = makeBackend(makeObjectBody({ contentDisposition: 'attachment; filename="rapport-café.pdf"' }));
    const res = await serveObject(backend, new Request("http://x/t"), "test.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBeNull();
  });
});

describe("serveObject — active content types", () => {
  // `nosniff` stops a sniff *into* a type and does nothing once the stored type already is one the
  // browser renders, which is the case an app reaches by storing an attacker-supplied MIME type.
  const cases: ReadonlyArray<{ key: string; contentType: string }> = [
    { key: "page.html", contentType: "text/html; charset=utf-8" },
    { key: "page.htm", contentType: "text/html; charset=utf-8" },
    { key: "avatar.svg", contentType: "image/svg+xml" },
    { key: "feed.xml", contentType: "application/xml; charset=utf-8" },
    { key: "app.js", contentType: "text/javascript; charset=utf-8" },
    { key: "mod.mjs", contentType: "text/javascript; charset=utf-8" },
    // Caller-supplied spellings `inferContentType` never emits, each of which a browser parses as a
    // document on this origin or runs outright.
    { key: "feed.atom", contentType: "application/atom+xml" },
    { key: "transform.xsl", contentType: "text/xsl" },
    { key: "legacy.script", contentType: "application/x-javascript" },
  ];

  for (const { key, contentType } of cases) {
    it(`downloads a stored ${contentType} under an empty sandbox (${key})`, async () => {
      const backend = makeBackend(makeObjectBody({ key, contentType }));
      const res = await serveObject(backend, new Request(`http://x/${key}`), key);
      const filename = key.split("/").pop() ?? key;
      expect(Object.fromEntries(res.headers)).toEqual({
        "accept-ranges": "bytes",
        "content-disposition": `attachment; filename="${filename}"; filename*=UTF-8''${filename}`,
        "content-length": "11",
        "content-security-policy": "sandbox",
        "content-type": contentType,
        etag: '"abc123"',
        "last-modified": "Thu, 01 Jan 2026 00:00:00 GMT",
        "x-content-type-options": "nosniff",
      });
    });
  }

  it("overrides a stored inline disposition on an active type, which is the attack itself", async () => {
    const backend = makeBackend(makeObjectBody({ key: "avatar.svg", contentType: "image/svg+xml", contentDisposition: "inline" }));
    const res = await serveObject(backend, new Request("http://x/avatar.svg"), "avatar.svg");
    expect(res.headers.get("Content-Disposition")).toBe(`attachment; filename="avatar.svg"; filename*=UTF-8''avatar.svg`);
  });

  it("still lets the caller ask for inline explicitly", async () => {
    const backend = makeBackend(makeObjectBody({ key: "page.html", contentType: "text/html" }));
    const res = await serveObject(backend, new Request("http://x/page.html"), "page.html", { contentDisposition: "inline" });
    expect(res.headers.get("Content-Disposition")).toBe(`inline; filename="page.html"; filename*=UTF-8''page.html`);
    expect(res.headers.get("Content-Security-Policy")).toBe("sandbox");
  });

  it("leaves an inert type untouched — no sandbox, no forced disposition", async () => {
    const backend = makeBackend(makeObjectBody({ key: "image.png", contentType: "image/png" }));
    const res = await serveObject(backend, new Request("http://x/image.png"), "image.png");
    expect(Object.fromEntries(res.headers)).toEqual({
      "accept-ranges": "bytes",
      "content-length": "11",
      "content-type": "image/png",
      etag: '"abc123"',
      "last-modified": "Thu, 01 Jan 2026 00:00:00 GMT",
      "x-content-type-options": "nosniff",
    });
  });
});

describe("serveObject — stored types that do not parse as one media type", () => {
  for (const contentType of [
    "text/plain, text/html",
    "text/html,",
    "image/png, image/svg+xml",
    "text/plain; charset=utf-8, text/html",
    "text/plain;x=y, text/html",
    "image/png;a=b,image/svg+xml",
    "text/html;charset=utf-8, x",
    "",
    "   ",
    '"text/html"',
    "TEXT/HTML,",
  ]) {
    it(`downloads a stored ${JSON.stringify(contentType)} as a sandboxed octet-stream attachment`, async () => {
      const backend = makeBackend(makeObjectBody({ key: "upload.bin", contentType }));
      const res = await serveObject(backend, new Request("http://x/upload.bin"), "upload.bin");
      expect(Object.fromEntries(res.headers)).toEqual({
        "accept-ranges": "bytes",
        "content-disposition": `attachment; filename="upload.bin"; filename*=UTF-8''upload.bin`,
        "content-length": "11",
        "content-security-policy": "sandbox",
        "content-type": "application/octet-stream",
        etag: '"abc123"',
        "last-modified": "Thu, 01 Jan 2026 00:00:00 GMT",
        "x-content-type-options": "nosniff",
      });
    });
  }

  it("serves an object with no stored type as octet-stream", async () => {
    const { contentType: _omitted, ...withoutType } = makeObjectBody({ key: "upload.bin" });
    const res = await serveObject(makeBackend(withoutType), new Request("http://x/upload.bin"), "upload.bin");
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
  });
});

describe("serveObject — outgoing Content-Type", () => {
  const cases: ReadonlyArray<{ stored: string; served: string }> = [
    { stored: "TEXT/HTML ;charset=utf-8", served: "text/html; charset=utf-8" },
    { stored: 'text/plain; charset="utf-8"', served: "text/plain; charset=utf-8" },
    { stored: "image/png; foo=bar", served: "image/png" },
    { stored: 'text/plain; charset="utf-8, text/html"', served: "text/plain" },
    { stored: 'multipart/form-data; boundary="a, b"', served: "multipart/form-data" },
  ];

  for (const { stored, served } of cases) {
    it(`sends ${JSON.stringify(served)} for a stored ${JSON.stringify(stored)}`, async () => {
      const backend = makeBackend(makeObjectBody({ contentType: stored }));
      const res = await serveObject(backend, new Request("http://x/test.txt"), "test.txt");
      expect(res.headers.get("Content-Type")).toBe(served);
    });
  }
});

describe("serveObject — under forge's security headers", () => {
  const servePage = (request: Request) =>
    serveObject(makeBackend(makeObjectBody({ key: "page.html", contentType: "text/html" })), request, "page.html", {
      contentDisposition: "inline",
    });

  it("keeps the sandbox beside the app-wide CSP inside a Forge app", async () => {
    const app = new Forge();
    app.use("*", createSecurityHeaders());
    mapHandler(app, "GET", "/files/page.html", (c) => servePage(c.request));

    const res = await app.request("/files/page.html");

    const policies = (res.headers.get("content-security-policy") ?? "").split(", ");
    expect(policies).toHaveLength(2);
    expect(policies[0]).toStartWith("default-src 'self'");
    expect(policies[1]).toBe("sandbox");
  });

  it("keeps the sandbox when the response is hardened with applySecurityHeaders", async () => {
    const res = applySecurityHeaders(await servePage(new Request("http://x/page.html")), { nonce: "abc" });

    const policies = (res.headers.get("content-security-policy") ?? "").split(", ");
    expect(policies).toHaveLength(2);
    expect(policies[0]).toStartWith("default-src 'self'");
    expect(policies[1]).toBe("sandbox");
  });
});

describe("serveObject — against the R2 fake", () => {
  it("answers 416 with the real size for a range beyond the object", async () => {
    const backend = r2Backend(fakeR2({ "file.txt": "abcdefghij" }));
    const res = await serveObject(backend, new Request("http://x/f", { headers: { Range: "bytes=50-60" } }), "file.txt");
    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe("bytes */10");
  });

  it("serves a satisfiable range from the fake", async () => {
    const backend = r2Backend(fakeR2({ "file.txt": "abcdefghij" }));
    const res = await serveObject(backend, new Request("http://x/f", { headers: { Range: "bytes=2-4" } }), "file.txt");
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 2-4/10");
    expect(await res.text()).toBe("cde");
  });
});
