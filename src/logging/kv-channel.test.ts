import { describe, expect, it } from "bun:test";
import type { KVListResult, KVNamespace } from "../storage/kv/types";
import { kvLogChannel } from "./kv-channel";
import type { KvLogMetadata } from "./types";

interface StubEntry {
  value: string;
  metadata?: unknown;
  expirationTtl?: number;
}

function makeKvStub(): KVNamespace & { _store: Map<string, StubEntry> } {
  const _store = new Map<string, StubEntry>();

  const ns = {
    get(key: string, _opts: { type: string }): Promise<string | null> {
      return Promise.resolve(_store.get(key)?.value ?? null);
    },
    getWithMetadata(key: string, _opts: { type: string }): Promise<{ value: string | null; metadata: unknown }> {
      const entry = _store.get(key);
      return Promise.resolve({ value: entry?.value ?? null, metadata: entry?.metadata ?? null });
    },
    put(key: string, value: string | ArrayBuffer, opts?: { expirationTtl?: number; metadata?: unknown }): Promise<void> {
      const entry: StubEntry = { value: value as string };
      if (opts?.metadata !== undefined) entry.metadata = opts.metadata;
      if (opts?.expirationTtl !== undefined) entry.expirationTtl = opts.expirationTtl;
      _store.set(key, entry);
      return Promise.resolve();
    },
    delete(key: string): Promise<void> {
      _store.delete(key);
      return Promise.resolve();
    },
    list<M = unknown>(opts?: { prefix?: string; limit?: number; cursor?: string }): Promise<KVListResult<M>> {
      const pfx = opts?.prefix ?? "";
      const keys = [..._store.keys()]
        .filter((k) => k.startsWith(pfx))
        .sort()
        .map((name) => ({ name, metadata: _store.get(name)?.metadata as M }));
      return Promise.resolve({ keys, list_complete: true });
    },
    _store,
  } as unknown as KVNamespace & { _store: Map<string, StubEntry> };

  return ns;
}

// Deletes stay parked until `releaseDeletes()`, so "the write promise covers the purge" is assertable.
function makeDeferredDeleteKvStub(): KVNamespace & { _store: Map<string, StubEntry>; calls: string[]; releaseDeletes: () => void } {
  const base = makeKvStub();
  const calls: string[] = [];
  const parked: Array<() => void> = [];

  return {
    ...base,
    put(key: string, value: string, opts?: { expirationTtl?: number; metadata?: unknown }): Promise<void> {
      calls.push("put");
      return base.put(key, value, opts);
    },
    list<M = unknown>(opts?: { prefix?: string; limit?: number; cursor?: string }): Promise<KVListResult<M>> {
      calls.push("list");
      return base.list<M>(opts);
    },
    delete(key: string): Promise<void> {
      calls.push("delete");
      return new Promise<void>((resolve) => {
        parked.push(() => {
          void base.delete(key);
          resolve();
        });
      });
    },
    releaseDeletes(): void {
      for (const release of parked.splice(0)) release();
    },
    calls,
  } as unknown as KVNamespace & { _store: Map<string, StubEntry>; calls: string[]; releaseDeletes: () => void };
}

function flushMicrotasks(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function makeRecord(
  overrides?: Partial<{
    level: "debug" | "info" | "warn" | "error";
    prefix: string;
    message: string;
    timestamp: string;
    data: Record<string, unknown>;
  }>,
) {
  return { level: "info" as const, prefix: "test", message: "hello", timestamp: "2026-05-31T10:00:00.000Z", ...overrides };
}

function makeMeta(overrides?: Partial<KvLogMetadata>): KvLogMetadata {
  return { level: "info", prefix: "svc", message: "test message", timestamp: "2026-05-31T10:00:00.000Z", ...overrides };
}

describe("kvLogChannel — write", () => {
  it("stores a time-ordered key under the prefix", async () => {
    const stub = makeKvStub();
    const channel = kvLogChannel(stub, { prefix: "logs", purgeProbability: 0 });

    await channel.write(makeRecord());

    const keys = [...stub._store.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^logs\|\|2026-05-31T10:00:00\.000Z\|\|/);
  });

  it("stores the serialised LogRecord as the value", async () => {
    const stub = makeKvStub();
    const channel = kvLogChannel(stub, { prefix: "logs", purgeProbability: 0 });
    const record = makeRecord({ message: "stored" });

    await channel.write(record);

    const entry = [...stub._store.values()][0]!;
    expect(JSON.parse(entry.value)).toMatchObject({ message: "stored", level: "info" });
  });

  it("applies expirationTtl from defaultTtl option", async () => {
    const stub = makeKvStub();
    const channel = kvLogChannel(stub, { prefix: "logs", defaultTtl: 300, purgeProbability: 0 });

    await channel.write(makeRecord());

    const entry = [...stub._store.values()][0]!;
    expect(entry.expirationTtl).toBe(300);
  });

  it("stores metadata with level, prefix, message, timestamp", async () => {
    const stub = makeKvStub();
    const channel = kvLogChannel(stub, { prefix: "logs", purgeProbability: 0 });

    await channel.write(makeRecord({ level: "warn", prefix: "svc", message: "watch out" }));

    const meta = [...stub._store.values()][0]!.metadata as KvLogMetadata;
    expect(meta.level).toBe("warn");
    expect(meta.prefix).toBe("svc");
    expect(meta.message).toBe("watch out");
    expect(meta.timestamp).toBe("2026-05-31T10:00:00.000Z");
  });

  it("includes requestId in metadata when present in record.data", async () => {
    const stub = makeKvStub();
    const channel = kvLogChannel(stub, { prefix: "logs", purgeProbability: 0 });

    await channel.write(makeRecord({ data: { requestId: "req-abc", other: 1 } }));

    const meta = [...stub._store.values()][0]!.metadata as KvLogMetadata;
    expect(meta.requestId).toBe("req-abc");
  });

  it("omits requestId from metadata when absent in record.data", async () => {
    const stub = makeKvStub();
    const channel = kvLogChannel(stub, { prefix: "logs", purgeProbability: 0 });

    await channel.write(makeRecord());

    const meta = [...stub._store.values()][0]!.metadata as KvLogMetadata;
    expect("requestId" in meta).toBe(false);
  });
});

describe("kvLogChannel — purge", () => {
  it("deletes oldest entries beyond maxLogs when above highWater (purgeProbability:1)", async () => {
    const stub = makeKvStub();
    for (let i = 1; i <= 6; i++) {
      const ts = `2026-05-31T0${i}:00:00.000Z`;
      stub._store.set(`logs||${ts}||aaa`, { value: "{}", expirationTtl: 300 });
    }

    const channel = kvLogChannel(stub, { prefix: "logs", maxLogs: 3, highWater: 4, purgeProbability: 1 });

    await channel.write(makeRecord({ timestamp: "2026-05-31T07:00:00.000Z" }));

    const remaining = [...stub._store.keys()].filter((k) => k.startsWith("logs||")).sort();
    expect(remaining.length).toBeLessThanOrEqual(3 + 1);
  });

  it("does not purge when entry count is at or below highWater", async () => {
    const stub = makeKvStub();
    stub._store.set("logs||2026-05-31T01:00:00.000Z||aaa", { value: "{}" });

    const channel = kvLogChannel(stub, { prefix: "logs", maxLogs: 3, highWater: 5, purgeProbability: 1 });

    await channel.write(makeRecord());

    expect(stub._store.size).toBe(2);
  });

  it("passes a numeric limit to kv.list during purge (bounded page)", async () => {
    let capturedListOpts: { prefix?: string; limit?: number } | undefined;

    const baseStub = makeKvStub();
    for (let i = 1; i <= 6; i++) {
      const ts = `2026-05-31T0${i}:00:00.000Z`;
      baseStub._store.set(`logs||${ts}||aaa`, { value: "{}" });
    }

    const originalList = baseStub.list.bind(baseStub);
    const trackingKv = {
      ...baseStub,
      list(opts?: { prefix?: string; limit?: number; cursor?: string }) {
        capturedListOpts = opts;
        return originalList(opts);
      },
    } as unknown as KVNamespace & { _store: Map<string, StubEntry> };

    const channel = kvLogChannel(trackingKv, { prefix: "logs", maxLogs: 3, highWater: 4, purgeProbability: 1 });
    await channel.write(makeRecord({ timestamp: "2026-05-31T07:00:00.000Z" }));

    expect(typeof capturedListOpts?.limit).toBe("number");
    expect(capturedListOpts?.limit).toBe(1000);
  });

  it("write does not settle until a selected purge settles", async () => {
    const stub = makeDeferredDeleteKvStub();
    for (let i = 1; i <= 6; i++) {
      stub._store.set(`logs||2026-05-31T0${i}:00:00.000Z||aaa`, { value: "{}" });
    }

    const channel = kvLogChannel(stub, { prefix: "logs", maxLogs: 3, highWater: 4, purgeProbability: 1 });

    let settled = false;
    const write = Promise.resolve(channel.write(makeRecord({ timestamp: "2026-05-31T07:00:00.000Z" }))).then(() => {
      settled = true;
    });

    await flushMicrotasks();
    expect(stub.calls).toStrictEqual(["put", "list", "delete", "delete", "delete", "delete"]);
    expect(settled).toBe(false);

    stub.releaseDeletes();
    await write;

    expect(settled).toBe(true);
    const remaining = [...stub._store.keys()].sort();
    expect(remaining).toHaveLength(3);
    expect(remaining[0]).toBe("logs||2026-05-31T05:00:00.000Z||aaa");
    expect(remaining[1]).toBe("logs||2026-05-31T06:00:00.000Z||aaa");
    expect(remaining[2]).toMatch(/^logs\|\|2026-05-31T07:00:00\.000Z\|\|[0-9a-f]{8}$/);
  });

  it("a failing put still covers the purge, then rejects with the put's own error", async () => {
    const base = makeDeferredDeleteKvStub();
    const stub = {
      ...base,
      put(): Promise<void> {
        base.calls.push("put");
        return Promise.reject(new Error("kv down"));
      },
    } as unknown as typeof base;
    for (let i = 1; i <= 6; i++) {
      stub._store.set(`logs||2026-05-31T0${i}:00:00.000Z||aaa`, { value: "{}" });
    }

    const channel = kvLogChannel(stub, { prefix: "logs", maxLogs: 3, highWater: 4, purgeProbability: 1 });

    const write = Promise.resolve(channel.write(makeRecord({ timestamp: "2026-05-31T07:00:00.000Z" })));
    let settled = false;
    const watched = write.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await flushMicrotasks();
    expect(stub.calls).toStrictEqual(["put", "list", "delete", "delete", "delete"]);
    expect(settled).toBe(false);

    stub.releaseDeletes();
    await watched;

    expect(settled).toBe(true);
    await expect(write).rejects.toThrow("kv down");
    expect([...stub._store.keys()].sort()).toStrictEqual([
      "logs||2026-05-31T04:00:00.000Z||aaa",
      "logs||2026-05-31T05:00:00.000Z||aaa",
      "logs||2026-05-31T06:00:00.000Z||aaa",
    ]);
  });

  it("does not purge when purgeProbability is 0", async () => {
    const stub = makeKvStub();
    for (let i = 1; i <= 10; i++) {
      stub._store.set(`logs||2026-05-31T0${i}:00:00.000Z||x`, { value: "{}" });
    }

    const channel = kvLogChannel(stub, { prefix: "logs", maxLogs: 2, highWater: 3, purgeProbability: 0 });

    await channel.write(makeRecord());

    expect(stub._store.size).toBe(11);
  });
});

describe("kvLogChannel — read", () => {
  it("returns all rows from KV metadata", async () => {
    const stub = makeKvStub();
    stub._store.set("logs||2026-05-31T10:00:00.000Z||aaa", { value: "{}", metadata: makeMeta({ message: "first" }) });
    stub._store.set("logs||2026-05-31T11:00:00.000Z||bbb", { value: "{}", metadata: makeMeta({ message: "second" }) });

    const channel = kvLogChannel(stub);
    const result = await channel.read!();

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.message).toBe("first");
    expect(result.rows[1]!.message).toBe("second");
  });

  it("returns empty rows when KV has no entries", async () => {
    const stub = makeKvStub();
    const channel = kvLogChannel(stub);
    const result = await channel.read!();
    expect(result.rows).toHaveLength(0);
    expect(result.complete).toBe(true);
  });

  it("maps KV metadata fields onto LogRow", async () => {
    const stub = makeKvStub();
    stub._store.set("logs||2026-05-31T10:00:00.000Z||aaa", {
      value: "{}",
      metadata: makeMeta({ level: "warn", prefix: "api", message: "slow request", requestId: "req-xyz" }),
    });

    const channel = kvLogChannel(stub);
    const result = await channel.read!();
    const row = result.rows[0]!;

    expect(row.level).toBe("warn");
    expect(row.prefix).toBe("api");
    expect(row.message).toBe("slow request");
    expect(row.requestId).toBe("req-xyz");
    expect(row.timestamp).toBe("2026-05-31T10:00:00.000Z");
  });

  it("filters rows by exact level", async () => {
    const stub = makeKvStub();
    stub._store.set("logs||2026-05-31T10:00:00.000Z||a", { value: "{}", metadata: makeMeta({ level: "info" }) });
    stub._store.set("logs||2026-05-31T10:00:01.000Z||b", { value: "{}", metadata: makeMeta({ level: "error" }) });
    stub._store.set("logs||2026-05-31T10:00:02.000Z||c", { value: "{}", metadata: makeMeta({ level: "warn" }) });

    const channel = kvLogChannel(stub);
    const result = await channel.read!({ level: "error" });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.level).toBe("error");
  });

  it("returns all rows when level is not specified", async () => {
    const stub = makeKvStub();
    stub._store.set("logs||2026-05-31T10:00:00.000Z||a", { value: "{}", metadata: makeMeta({ level: "debug" }) });
    stub._store.set("logs||2026-05-31T10:00:01.000Z||b", { value: "{}", metadata: makeMeta({ level: "error" }) });

    const channel = kvLogChannel(stub);
    const result = await channel.read!({});

    expect(result.rows).toHaveLength(2);
  });

  it("filters by message substring (case-insensitive)", async () => {
    const stub = makeKvStub();
    stub._store.set("logs||2026-05-31T10:00:00.000Z||a", { value: "{}", metadata: makeMeta({ message: "Email delivery failed" }) });
    stub._store.set("logs||2026-05-31T10:00:01.000Z||b", { value: "{}", metadata: makeMeta({ message: "Contact form submitted" }) });

    const channel = kvLogChannel(stub);
    const result = await channel.read!({ q: "email" });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.message).toBe("Email delivery failed");
  });

  it("filters by prefix substring", async () => {
    const stub = makeKvStub();
    stub._store.set("logs||2026-05-31T10:00:00.000Z||a", { value: "{}", metadata: makeMeta({ prefix: "contact" }) });
    stub._store.set("logs||2026-05-31T10:00:01.000Z||b", { value: "{}", metadata: makeMeta({ prefix: "email" }) });

    const channel = kvLogChannel(stub);
    const result = await channel.read!({ q: "contact" });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.prefix).toBe("contact");
  });

  it("filters by requestId substring", async () => {
    const stub = makeKvStub();
    stub._store.set("logs||2026-05-31T10:00:00.000Z||a", { value: "{}", metadata: makeMeta({ requestId: "cf-ray-12345" }) });
    stub._store.set("logs||2026-05-31T10:00:01.000Z||b", { value: "{}", metadata: makeMeta({ requestId: "cf-ray-99999" }) });

    const channel = kvLogChannel(stub);
    const result = await channel.read!({ q: "12345" });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.requestId).toBe("cf-ray-12345");
  });

  it("combines level and text filters", async () => {
    const stub = makeKvStub();
    stub._store.set("logs||2026-05-31T10:00:00.000Z||a", { value: "{}", metadata: makeMeta({ level: "error", message: "failed" }) });
    stub._store.set("logs||2026-05-31T10:00:01.000Z||b", { value: "{}", metadata: makeMeta({ level: "info", message: "failed" }) });
    stub._store.set("logs||2026-05-31T10:00:02.000Z||c", { value: "{}", metadata: makeMeta({ level: "error", message: "ok" }) });

    const channel = kvLogChannel(stub);
    const result = await channel.read!({ level: "error", q: "failed" });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.level).toBe("error");
    expect(result.rows[0]!.message).toBe("failed");
  });

  it("read uses the channel's configured prefix (not the default 'logs')", async () => {
    const stub = makeKvStub();
    stub._store.set("app-logs||2026-05-31T10:00:00.000Z||a", { value: "{}", metadata: makeMeta({ message: "in prefix" }) });
    stub._store.set("logs||2026-05-31T10:00:00.000Z||b", { value: "{}", metadata: makeMeta({ message: "outside" }) });

    const channel = kvLogChannel(stub, { prefix: "app-logs" });
    const result = await channel.read!();

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.message).toBe("in prefix");
  });
});

describe("kvLogChannel — readEntry", () => {
  it("returns the full stored record for a listed key, including data.stack", async () => {
    const stub = makeKvStub();
    const channel = kvLogChannel(stub, { prefix: "logs", purgeProbability: 0, persistStack: true });
    await channel.write(makeRecord({ level: "error", message: "client crash", data: { stack: "Error: boom\n  at main.ts:1" } }));

    const key = [...stub._store.keys()][0]!;
    const record = await channel.readEntry!(key);

    expect(record?.level).toBe("error");
    expect(record?.message).toBe("client crash");
    expect(record?.data?.stack).toBe("Error: boom\n  at main.ts:1");
  });

  it("returns null for a missing key", async () => {
    const channel = kvLogChannel(makeKvStub(), { prefix: "logs" });
    expect(await channel.readEntry!("logs||2026-05-31T10:00:00.000Z||none")).toBeNull();
  });

  it("returns null for a key outside the channel prefix", async () => {
    const stub = makeKvStub();
    stub._store.set("secrets||token", { value: '{"level":"info"}' });

    const channel = kvLogChannel(stub, { prefix: "logs" });

    expect(await channel.readEntry!("secrets||token")).toBeNull();
  });

  it("returns null when the stored value is not valid JSON", async () => {
    const stub = makeKvStub();
    stub._store.set("logs||2026-05-31T10:00:00.000Z||bad", { value: "not-json" });

    const channel = kvLogChannel(stub, { prefix: "logs" });

    expect(await channel.readEntry!("logs||2026-05-31T10:00:00.000Z||bad")).toBeNull();
  });
});

describe("kvLogChannel — oversized message truncation", () => {
  it("truncates message in metadata to 256 characters when message exceeds 256 chars", async () => {
    const stub = makeKvStub();
    const channel = kvLogChannel(stub, { prefix: "logs", purgeProbability: 0 });
    const longMessage = "x".repeat(300);

    await channel.write(makeRecord({ message: longMessage }));

    const meta = [...stub._store.values()][0]!.metadata as KvLogMetadata;
    expect(meta.message.length).toBe(256);
    expect(meta.message).toBe("x".repeat(256));
  });

  it("stores the full message in the KV value body even when metadata is truncated", async () => {
    const stub = makeKvStub();
    const channel = kvLogChannel(stub, { prefix: "logs", purgeProbability: 0 });
    const longMessage = "y".repeat(300);

    await channel.write(makeRecord({ message: longMessage }));

    const entry = [...stub._store.values()][0]!;
    const stored = JSON.parse(entry.value) as { message: string };
    expect(stored.message).toBe(longMessage);
  });

  it("keeps message intact in metadata when message is exactly 256 chars", async () => {
    const stub = makeKvStub();
    const channel = kvLogChannel(stub, { prefix: "logs", purgeProbability: 0 });
    const exactMessage = "a".repeat(256);

    await channel.write(makeRecord({ message: exactMessage }));

    const meta = [...stub._store.values()][0]!.metadata as KvLogMetadata;
    expect(meta.message.length).toBe(256);
    expect(meta.message).toBe(exactMessage);
  });
});

describe("kvLogChannel — purge error isolation", () => {
  it("write resolves successfully even when kv.list throws during purge", async () => {
    const throwingKv = {
      ...makeKvStub(),
      async put(_k: string, _v: string, _o: unknown): Promise<void> {
        return Promise.resolve();
      },
      async list(_opts: unknown): Promise<never> {
        throw new Error("KV list failed");
      },
    } as unknown as KVNamespace & { _store: Map<string, StubEntry> };

    const channel = kvLogChannel(throwingKv, { prefix: "logs", purgeProbability: 1 });

    await expect(channel.write(makeRecord())).resolves.toBeUndefined();
  });
});

describe("kvLogChannel — stack stripping", () => {
  it("strips a nested data.error.stack from the stored JSON by default", async () => {
    const stub = makeKvStub();
    const channel = kvLogChannel(stub, { prefix: "logs", purgeProbability: 0 });

    await channel.write(makeRecord({ level: "error", data: { error: { name: "Error", message: "boom", stack: "Error: boom\n  at main.ts:1" } } }));

    const entry = [...stub._store.values()][0]!;
    const stored = JSON.parse(entry.value) as { data?: { error?: Record<string, unknown> } };
    expect(stored.data?.error).toStrictEqual({ name: "Error", message: "boom" });
    expect(entry.value).not.toContain("stack");
  });

  it("strips a top-level data.stack from the stored JSON by default", async () => {
    const stub = makeKvStub();
    const channel = kvLogChannel(stub, { prefix: "logs", purgeProbability: 0 });

    await channel.write(makeRecord({ data: { stack: "Error: boom", requestId: "req-1" } }));

    const entry = [...stub._store.values()][0]!;
    const stored = JSON.parse(entry.value) as { data?: Record<string, unknown> };
    expect(stored.data).toStrictEqual({ requestId: "req-1" });
  });

  it("strips stack keys nested inside arrays by default", async () => {
    const stub = makeKvStub();
    const channel = kvLogChannel(stub, { prefix: "logs", purgeProbability: 0 });

    await channel.write(
      makeRecord({
        data: {
          errors: [
            { message: "a", stack: "s1" },
            { message: "b", stack: "s2" },
          ],
        },
      }),
    );

    const entry = [...stub._store.values()][0]!;
    const stored = JSON.parse(entry.value) as { data?: { errors?: Array<Record<string, unknown>> } };
    expect(stored.data?.errors).toStrictEqual([{ message: "a" }, { message: "b" }]);
  });

  it("retains data.stack in the stored JSON when persistStack is true", async () => {
    const stub = makeKvStub();
    const channel = kvLogChannel(stub, { prefix: "logs", purgeProbability: 0, persistStack: true });

    await channel.write(makeRecord({ data: { error: { message: "boom", stack: "Error: boom\n  at main.ts:1" } } }));

    const entry = [...stub._store.values()][0]!;
    const stored = JSON.parse(entry.value) as { data?: { error?: Record<string, unknown> } };
    expect(stored.data?.error?.stack).toBe("Error: boom\n  at main.ts:1");
  });

  it("does not mutate the caller's record when stripping stacks", async () => {
    const stub = makeKvStub();
    const channel = kvLogChannel(stub, { prefix: "logs", purgeProbability: 0 });
    const record = makeRecord({ data: { error: { message: "boom", stack: "trace" } } });

    await channel.write(record);

    expect((record.data!.error as Record<string, unknown>).stack).toBe("trace");
  });
});

describe("kvLogChannel — structured value serialization", () => {
  async function storedData(data: Record<string, unknown>, options?: { persistStack?: boolean }): Promise<Record<string, unknown>> {
    const stub = makeKvStub();
    const channel = kvLogChannel(stub, { prefix: "logs", purgeProbability: 0, ...options });
    await channel.write(makeRecord({ data }));
    const entry = [...stub._store.values()][0]!;
    return (JSON.parse(entry.value) as { data: Record<string, unknown> }).data;
  }

  it("serializes a Date to its ISO 8601 string", async () => {
    expect(await storedData({ at: new Date("2026-05-31T10:00:00.000Z") })).toStrictEqual({ at: "2026-05-31T10:00:00.000Z" });
  });

  it("serializes an invalid Date to null rather than throwing", async () => {
    expect(await storedData({ at: new Date("not-a-date") })).toStrictEqual({ at: null });
  });

  it("serializes a Map to a tagged entry list", async () => {
    expect(await storedData({ counts: new Map([["a", 1]]) })).toStrictEqual({ counts: { type: "Map", entries: [["a", 1]] } });
  });

  it("serializes a Set to a tagged value list", async () => {
    expect(await storedData({ tags: new Set(["a", "b"]) })).toStrictEqual({ tags: { type: "Set", values: ["a", "b"] } });
  });

  it("serializes Date, Map and Set nested inside objects and arrays", async () => {
    const data = {
      outer: { at: new Date("2026-01-02T03:04:05.000Z"), inner: [new Set([1]), { m: new Map<string, unknown>([["k", new Date(0)]]) }] },
    };
    expect(await storedData(data)).toStrictEqual({
      outer: {
        at: "2026-01-02T03:04:05.000Z",
        inner: [{ type: "Set", values: [1] }, { m: { type: "Map", entries: [["k", "1970-01-01T00:00:00.000Z"]] } }],
      },
    });
  });

  it("walks Map keys as well as values", async () => {
    const data = { m: new Map<unknown, unknown>([[new Set(["k"]), new Date("2026-05-31T10:00:00.000Z")]]) };
    expect(await storedData(data)).toStrictEqual({ m: { type: "Map", entries: [[{ type: "Set", values: ["k"] }, "2026-05-31T10:00:00.000Z"]] } });
  });

  it("strips a stack nested inside a Map value", async () => {
    const data = { m: new Map([["e", { message: "boom", stack: "trace" }]]) };
    expect(await storedData(data)).toStrictEqual({ m: { type: "Map", entries: [["e", { message: "boom" }]] } });
  });

  it("leaves plain objects, arrays and primitives unchanged", async () => {
    const data = { s: "text", n: 1, b: true, nul: null, arr: [1, "two", { deep: [3] }], obj: { nested: { flag: false } } };
    expect(await storedData(data)).toStrictEqual({
      s: "text",
      n: 1,
      b: true,
      nul: null,
      arr: [1, "two", { deep: [3] }],
      obj: { nested: { flag: false } },
    });
  });

  it("does not mutate the caller's Date, Map or Set values", async () => {
    const at = new Date("2026-05-31T10:00:00.000Z");
    const counts = new Map([["a", 1]]);
    const stub = makeKvStub();
    const channel = kvLogChannel(stub, { prefix: "logs", purgeProbability: 0 });
    const record = makeRecord({ data: { at, counts } });

    await channel.write(record);

    expect(record.data?.at).toBe(at);
    expect(record.data?.counts).toBe(counts);
  });

  it("replaces a self-referential object with the circular marker instead of hanging", async () => {
    const cyclic: Record<string, unknown> = { name: "root" };
    cyclic.self = cyclic;
    expect(await storedData({ cyclic })).toStrictEqual({ cyclic: { name: "root", self: "[circular]" } });
  });

  it("cuts a cycle that runs through an array and a Map", async () => {
    const branch: Record<string, unknown> = {};
    branch.items = [branch];
    branch.lookup = new Map([["back", branch]]);
    expect(await storedData({ branch })).toStrictEqual({
      branch: { items: ["[circular]"], lookup: { type: "Map", entries: [["back", "[circular]"]] } },
    });
  });

  it("keeps a repeated sibling reference intact — only ancestors count as a cycle", async () => {
    const shared = { id: 1 };
    expect(await storedData({ a: shared, b: shared })).toStrictEqual({ a: { id: 1 }, b: { id: 1 } });
  });

  it("serializes Date, Map and Set when persistStack is true as well", async () => {
    const data = { at: new Date("2026-05-31T10:00:00.000Z"), tags: new Set(["x"]), error: { message: "boom", stack: "trace" } };
    expect(await storedData(data, { persistStack: true })).toStrictEqual({
      at: "2026-05-31T10:00:00.000Z",
      tags: { type: "Set", values: ["x"] },
      error: { message: "boom", stack: "trace" },
    });
  });
});

describe("kvLogChannel — flush (via createLogger)", () => {
  it("the put promise lands in pending and flush awaits it", async () => {
    const order: string[] = [];
    const slowKv = {
      ...makeKvStub(),
      put(_k: string, _v: string, _o: unknown): Promise<void> {
        return new Promise<void>((resolve) => {
          setTimeout(() => {
            order.push("put-done");
            resolve();
          }, 10);
        });
      },
    } as unknown as KVNamespace & { _store: Map<string, StubEntry> };

    const { createLogger } = await import("./logger");
    const log = createLogger("flush-kv", { channels: [kvLogChannel(slowKv, { purgeProbability: 0 })] });

    log.info("trigger");
    order.push("before-flush");
    await log.flush();
    order.push("after-flush");

    expect(order).toStrictEqual(["before-flush", "put-done", "after-flush"]);
  });
});
