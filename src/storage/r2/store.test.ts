import { describe, expect, it } from "bun:test";

import { fakeR2 } from "../../testing/fakes";
import { r2Backend } from "./r2-backend";
import { createObjectStore } from "./store";
import type {
  ListObjectsResult,
  ObjectBody,
  ObjectStorageBackend,
  StoredObject,
  StoreGetOptions,
  StoreListOptions,
  StorePutOptions,
} from "./types";

// A real `fakeR2` whose `get` rejects — the fault path exercised through the shipped adapter
// rather than through a hand-built double.
function brokenR2(message: string): ReturnType<typeof fakeR2> {
  const bucket = fakeR2({ "doc.txt": "hello" });
  return { ...bucket, get: () => Promise.reject(new Error(message)) } as ReturnType<typeof fakeR2>;
}

function makeMemoryBackend(name = "memory"): ObjectStorageBackend & { _store: Map<string, StoredObject & { _body?: string }> } {
  const _store = new Map<string, StoredObject & { _body?: string }>();

  function makeBody(_key: string, entry: StoredObject & { _body?: string }): ObjectBody {
    const bodyText = entry._body ?? "";
    return {
      ...entry,
      body: new ReadableStream(),
      bodyUsed: false,
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(bodyText).buffer as ArrayBuffer),
      text: () => Promise.resolve(bodyText),
      blob: () => Promise.resolve(new Blob([bodyText])),
    };
  }

  const backend: ObjectStorageBackend = {
    name,
    async put(key, value, opts?: StorePutOptions): Promise<StoredObject> {
      const body = typeof value === "string" ? value : "";
      const entry: StoredObject & { _body?: string } = {
        key,
        size: body.length,
        etag: `etag-${key}`,
        httpEtag: `"etag-${key}"`,
        uploaded: new Date("2026-01-01"),
        ...(opts?.contentType !== undefined ? { contentType: opts.contentType } : {}),
        _body: body,
      };
      _store.set(key, entry);
      return entry;
    },
    async get(key, _opts?: StoreGetOptions): Promise<ObjectBody | null> {
      const entry = _store.get(key);
      return entry ? makeBody(key, entry) : null;
    },
    async head(key): Promise<StoredObject | null> {
      return _store.get(key) ?? null;
    },
    async delete(key): Promise<void> {
      if (Array.isArray(key)) for (const k of key) _store.delete(k);
      else _store.delete(key);
    },
    async list(opts?: StoreListOptions): Promise<ListObjectsResult> {
      const pfx = opts?.prefix ?? "";
      const objects = [..._store.values()].filter((o) => o.key.startsWith(pfx));
      return { objects, truncated: false };
    },
  };

  return Object.assign(backend, { _store });
}

function runStoreContract(backendA: ObjectStorageBackend, backendB: ObjectStorageBackend) {
  it("put returns a StoredObject", async () => {
    const store = createObjectStore(backendA);
    const res = await store.put("doc.txt", "hello");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.key).toBe("doc.txt");
      expect(typeof res.data.etag).toBe("string");
    }
  });

  it("get returns null for missing key", async () => {
    const store = createObjectStore(backendB);
    const res = await store.get("nope.txt");
    expect(res).toEqual({ ok: true, data: null });
  });

  it("get returns content after put", async () => {
    const backend = makeMemoryBackend();
    const store = createObjectStore(backend);
    await store.put("hello.txt", "world");
    const res = await store.get("hello.txt");
    expect(res.ok).toBe(true);
    if (res.ok && res.data) expect(await res.data.text()).toBe("world");
  });

  it("head returns null for missing key", async () => {
    const store = createObjectStore(backendA);
    expect(await store.head("nope.txt")).toEqual({ ok: true, data: null });
  });

  it("delete removes the key", async () => {
    const backend = makeMemoryBackend();
    const store = createObjectStore(backend);
    await store.put("tmp.txt", "x");
    await store.delete("tmp.txt");
    expect(await store.get("tmp.txt")).toEqual({ ok: true, data: null });
  });

  it("list returns stored keys", async () => {
    const backend = makeMemoryBackend();
    const store = createObjectStore(backend);
    await store.put("a.txt", "1");
    await store.put("b.txt", "2");
    const res = await store.list();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.objects.map((o) => o.key).sort()).toEqual(["a.txt", "b.txt"]);
  });
}

describe("createObjectStore — memoryBackend A", () => {
  runStoreContract(makeMemoryBackend("memory-a"), makeMemoryBackend("memory-a"));
});

describe("createObjectStore — memoryBackend B (backend-swap equivalence)", () => {
  runStoreContract(makeMemoryBackend("memory-b"), makeMemoryBackend("memory-b"));
});

describe("createObjectStore — prefix namespacing", () => {
  it("prepends prefix to stored keys", async () => {
    const backend = makeMemoryBackend();
    const store = createObjectStore(backend, { prefix: "tenant-1" });
    await store.put("logo.png", "data");
    expect(backend._store.has("tenant-1/logo.png")).toBe(true);
  });

  it("strips prefix from returned keys", async () => {
    const backend = makeMemoryBackend();
    const store = createObjectStore(backend, { prefix: "tenant-1" });
    await store.put("logo.png", "data");
    const res = await store.get("logo.png");
    expect(res.ok && res.data?.key).toBe("logo.png");
  });

  it("exposes the backend reference", () => {
    const backend = makeMemoryBackend();
    const store = createObjectStore(backend);
    expect(store.backend).toBe(backend);
  });
});

describe("createObjectStore — key normalization (traversal prevention)", () => {
  it("rejects get with a leading slash", async () => {
    const store = createObjectStore(makeMemoryBackend());
    const res = await store.get("/etc/passwd");
    expect(res.ok).toBe(false);
  });

  it("rejects get with a '..' segment", async () => {
    const store = createObjectStore(makeMemoryBackend());
    const res = await store.get("../secret");
    expect(res.ok).toBe(false);
  });

  it("rejects get with a '.' segment", async () => {
    const store = createObjectStore(makeMemoryBackend());
    const res = await store.get("a/./b");
    expect(res.ok).toBe(false);
  });

  it("rejects delete with a traversal key in array", async () => {
    const store = createObjectStore(makeMemoryBackend());
    const res = await store.delete(["valid.txt", "../x"]);
    expect(res.ok).toBe(false);
  });

  it("rejects list with a traversal prefix", async () => {
    const store = createObjectStore(makeMemoryBackend());
    const res = await store.list({ prefix: "../x" });
    expect(res.ok).toBe(false);
  });

  it("allows a valid nested path", async () => {
    const backend = makeMemoryBackend();
    const store = createObjectStore(backend, { prefix: "tenant" });
    await store.put("a/b/c.txt", "data");
    expect(backend._store.has("tenant/a/b/c.txt")).toBe(true);
  });

  it("never hits the backend for a traversal get", async () => {
    let backendCalled = false;
    const spyBackend = {
      ...makeMemoryBackend(),
      get: async () => {
        backendCalled = true;
        return null;
      },
    } as unknown as ReturnType<typeof makeMemoryBackend>;
    const store = createObjectStore(spyBackend);
    await store.get("../secret");
    expect(backendCalled).toBe(false);
  });
});

describe("createObjectStore — serveObject", () => {
  it("refuses a key with a leading slash the same way `get` does, before touching the backend", async () => {
    let backendCalled = false;
    const backend = {
      ...makeMemoryBackend(),
      get: async () => {
        backendCalled = true;
        return null;
      },
    } as unknown as ReturnType<typeof makeMemoryBackend>;
    const store = createObjectStore(backend);
    const res = await store.serveObject(new Request("https://example.com/file"), "/etc/passwd");
    expect(res).toEqual({ ok: false, error: new Error("Object key must not start with '/': /etc/passwd") });
    expect(backendCalled).toBe(false);
  });

  it("refuses a key with a '..' path segment", async () => {
    const store = createObjectStore(makeMemoryBackend());
    const res = await store.serveObject(new Request("https://example.com/file"), "../secret");
    expect(res).toEqual({ ok: false, error: new Error("Object key must not contain '.' or '..' segments: ../secret") });
  });

  it("names the backend fault instead of answering a bare 500", async () => {
    const store = createObjectStore(r2Backend(brokenR2("backend exploded")));
    const res = await store.serveObject(new Request("https://example.com/file"), "doc.txt");
    expect(res).toEqual({ ok: false, error: new Error("backend exploded") });
  });

  it("serves a stored object on the happy path", async () => {
    const backend = makeMemoryBackend();
    const store = createObjectStore(backend);
    await store.put("doc.txt", "hello");
    const res = await store.serveObject(new Request("https://example.com/file"), "doc.txt");
    expect(res.ok).toBe(true);
    expect(res.ok && res.data.status).toBe(200);
  });
});

describe("createObjectStore — content-type inference on put", () => {
  it("infers content-type from key extension when not provided", async () => {
    const backend = makeMemoryBackend();
    const store = createObjectStore(backend);
    await store.put("style.css", "body{}");
    const obj = backend._store.get("style.css");
    expect(obj?.contentType).toBe("text/css; charset=utf-8");
  });

  it("uses explicit content-type when provided", async () => {
    const backend = makeMemoryBackend();
    const store = createObjectStore(backend);
    await store.put("data", "...", { contentType: "application/octet-stream" });
    const obj = backend._store.get("data");
    expect(obj?.contentType).toBe("application/octet-stream");
  });
});

describe("createObjectStore — listing and body identity", () => {
  function listingBackend(res: ListObjectsResult): ObjectStorageBackend & { seen: { options?: StoreListOptions | undefined } } {
    const seen: { options?: StoreListOptions | undefined } = {};
    const backend = makeMemoryBackend();
    return Object.assign(
      {
        ...backend,
        async list(options?: StoreListOptions): Promise<ListObjectsResult> {
          seen.options = options;
          return res;
        },
      },
      { seen },
    );
  }

  it("strips the store prefix from delimitedPrefixes as well as from keys", async () => {
    const backend = listingBackend({
      objects: [{ key: "tenant-a/report.txt", size: 1, etag: "e", httpEtag: '"e"', uploaded: new Date("2026-01-01") }],
      truncated: false,
      delimitedPrefixes: ["tenant-a/invoices/", "tenant-a/logs/"],
    });
    const store = createObjectStore(backend, { prefix: "tenant-a" });
    const res = await store.list({ delimiter: "/" });
    if (!res.ok) throw new Error("expected ok");
    expect(res.data.objects.map((o) => o.key)).toEqual(["report.txt"]);
    expect(res.data.delimitedPrefixes).toEqual(["invoices/", "logs/"]);
  });

  it("forwards the caller's list options", async () => {
    const backend = listingBackend({ objects: [], truncated: false });
    const store = createObjectStore(backend);
    await store.list({ delimiter: "/", limit: 10 });
    expect(backend.seen.options?.delimiter).toBe("/");
    expect(backend.seen.options?.limit).toBe(10);
  });
});

describe("createObjectStore — get re-keying does not consume the body", () => {
  function bodyBackend(key: string): { backend: ObjectStorageBackend; reads: { body: number } } {
    const reads = { body: 0 };
    let used = false;
    const stream = new ReadableStream();
    const obj: ObjectBody = {
      key,
      size: 5,
      etag: "e",
      httpEtag: '"e"',
      uploaded: new Date("2026-01-01"),
      get body() {
        reads.body += 1;
        return stream;
      },
      get bodyUsed() {
        return used;
      },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      text: () => {
        used = true;
        return Promise.resolve("hello");
      },
      blob: () => Promise.resolve(new Blob([])),
    };
    const backend: ObjectStorageBackend = {
      ...makeMemoryBackend(),
      async get() {
        return obj;
      },
    };
    return { backend, reads };
  }

  it("reports bodyUsed after a read, with a store prefix set", async () => {
    const { backend } = bodyBackend("tenant-a/file.txt");
    const store = createObjectStore(backend, { prefix: "tenant-a" });
    const res = await store.get("file.txt");
    if (!res.ok || res.data === null) throw new Error("expected an object");
    expect(res.data.key).toBe("file.txt");
    expect(res.data.bodyUsed).toBe(false);
    expect(await res.data.text()).toBe("hello");
    expect(res.data.bodyUsed).toBe(true);
  });

  it("reports bodyUsed after a read with no prefix", async () => {
    const { backend } = bodyBackend("file.txt");
    const store = createObjectStore(backend);
    const res = await store.get("file.txt");
    if (!res.ok || res.data === null) throw new Error("expected an object");
    expect(await res.data.text()).toBe("hello");
    expect(res.data.bodyUsed).toBe(true);
  });

  it("reads the body getter zero times while re-keying", async () => {
    const { backend, reads } = bodyBackend("tenant-a/file.txt");
    const store = createObjectStore(backend, { prefix: "tenant-a" });
    const res = await store.get("file.txt");
    if (!res.ok) throw new Error("expected ok");
    expect(reads.body).toBe(0);
  });
});
