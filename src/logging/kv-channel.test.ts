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
        .sort() // lexicographic — same as real KV
        .map((name) => ({ name, metadata: _store.get(name)?.metadata as M }));
      return Promise.resolve({ keys, list_complete: true });
    },
    _store,
  } as unknown as KVNamespace & { _store: Map<string, StubEntry> };

  return ns;
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

describe("kvLogChannel — write", () => {
  it("stores a time-ordered key under the prefix", async () => {
    const stub = makeKvStub();
    const channel = kvLogChannel(stub, { prefix: "logs", purgeProbability: 0 });

    await channel(makeRecord());

    const keys = [...stub._store.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^logs\|\|2026-05-31T10:00:00\.000Z\|\|/);
  });

  it("stores the serialised LogRecord as the value", async () => {
    const stub = makeKvStub();
    const channel = kvLogChannel(stub, { prefix: "logs", purgeProbability: 0 });
    const record = makeRecord({ message: "stored" });

    await channel(record);

    const entry = [...stub._store.values()][0]!;
    expect(JSON.parse(entry.value)).toMatchObject({ message: "stored", level: "info" });
  });

  it("applies expirationTtl from defaultTtl option", async () => {
    const stub = makeKvStub();
    const channel = kvLogChannel(stub, { prefix: "logs", defaultTtl: 300, purgeProbability: 0 });

    await channel(makeRecord());

    const entry = [...stub._store.values()][0]!;
    expect(entry.expirationTtl).toBe(300);
  });

  it("stores metadata with level, prefix, message, timestamp", async () => {
    const stub = makeKvStub();
    const channel = kvLogChannel(stub, { prefix: "logs", purgeProbability: 0 });

    await channel(makeRecord({ level: "warn", prefix: "svc", message: "watch out" }));

    const meta = [...stub._store.values()][0]!.metadata as KvLogMetadata;
    expect(meta.level).toBe("warn");
    expect(meta.prefix).toBe("svc");
    expect(meta.message).toBe("watch out");
    expect(meta.timestamp).toBe("2026-05-31T10:00:00.000Z");
  });

  it("includes requestId in metadata when present in record.data", async () => {
    const stub = makeKvStub();
    const channel = kvLogChannel(stub, { prefix: "logs", purgeProbability: 0 });

    await channel(makeRecord({ data: { requestId: "req-abc", other: 1 } }));

    const meta = [...stub._store.values()][0]!.metadata as KvLogMetadata;
    expect(meta.requestId).toBe("req-abc");
  });

  it("omits requestId from metadata when absent in record.data", async () => {
    const stub = makeKvStub();
    const channel = kvLogChannel(stub, { prefix: "logs", purgeProbability: 0 });

    await channel(makeRecord());

    const meta = [...stub._store.values()][0]!.metadata as KvLogMetadata;
    expect("requestId" in meta).toBe(false);
  });
});

describe("kvLogChannel — purge", () => {
  it("deletes oldest entries beyond maxLogs when above highWater (purgeProbability:1)", async () => {
    const stub = makeKvStub();
    // Pre-populate 6 entries with sortable timestamps
    for (let i = 1; i <= 6; i++) {
      const ts = `2026-05-31T0${i}:00:00.000Z`;
      stub._store.set(`logs||${ts}||aaa`, { value: "{}", expirationTtl: 300 });
    }

    // maxLogs=3, highWater=4 → 6 entries is above highWater, should purge down to maxLogs=3
    const channel = kvLogChannel(stub, { prefix: "logs", maxLogs: 3, highWater: 4, purgeProbability: 1 });

    await channel(makeRecord({ timestamp: "2026-05-31T07:00:00.000Z" }));

    // Should have at most maxLogs=3 entries (the newest)
    const remaining = [...stub._store.keys()].filter((k) => k.startsWith("logs||")).sort();
    expect(remaining.length).toBeLessThanOrEqual(3 + 1); // +1 for the newly written entry
  });

  it("does not purge when entry count is at or below highWater", async () => {
    const stub = makeKvStub();
    stub._store.set("logs||2026-05-31T01:00:00.000Z||aaa", { value: "{}" });

    const channel = kvLogChannel(stub, { prefix: "logs", maxLogs: 3, highWater: 5, purgeProbability: 1 });

    await channel(makeRecord());

    // Only 2 total — no purge
    expect(stub._store.size).toBe(2);
  });

  it("does not purge when purgeProbability is 0", async () => {
    const stub = makeKvStub();
    for (let i = 1; i <= 10; i++) {
      stub._store.set(`logs||2026-05-31T0${i}:00:00.000Z||x`, { value: "{}" });
    }

    const channel = kvLogChannel(stub, { prefix: "logs", maxLogs: 2, highWater: 3, purgeProbability: 0 });

    await channel(makeRecord());

    // All original plus the new one; nothing purged
    expect(stub._store.size).toBe(11);
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
