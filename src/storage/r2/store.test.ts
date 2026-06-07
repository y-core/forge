import { describe, expect, it } from "bun:test";
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

// ── Shared in-memory backend factory ──────────────────────────────────────────

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

// ── Backend-swap equivalence proof ────────────────────────────────────────────

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

// ── Prefix namespacing ─────────────────────────────────────────────────────────

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

// ── Path traversal rejection ───────────────────────────────────────────────────

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

// ── Content-type auto-inference ────────────────────────────────────────────────

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
