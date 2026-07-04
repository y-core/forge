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
    // Pre-populate 6 entries with sortable timestamps
    for (let i = 1; i <= 6; i++) {
      const ts = `2026-05-31T0${i}:00:00.000Z`;
      stub._store.set(`logs||${ts}||aaa`, { value: "{}", expirationTtl: 300 });
    }

    // maxLogs=3, highWater=4 → 6 entries is above highWater, should purge down to maxLogs=3
    const channel = kvLogChannel(stub, { prefix: "logs", maxLogs: 3, highWater: 4, purgeProbability: 1 });

    await channel.write(makeRecord({ timestamp: "2026-05-31T07:00:00.000Z" }));

    // Should have at most maxLogs=3 entries (the newest)
    const remaining = [...stub._store.keys()].filter((k) => k.startsWith("logs||")).sort();
    expect(remaining.length).toBeLessThanOrEqual(3 + 1); // +1 for the newly written entry
  });

  it("does not purge when entry count is at or below highWater", async () => {
    const stub = makeKvStub();
    stub._store.set("logs||2026-05-31T01:00:00.000Z||aaa", { value: "{}" });

    const channel = kvLogChannel(stub, { prefix: "logs", maxLogs: 3, highWater: 5, purgeProbability: 1 });

    await channel.write(makeRecord());

    // Only 2 total — no purge
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

  it("does not purge when purgeProbability is 0", async () => {
    const stub = makeKvStub();
    for (let i = 1; i <= 10; i++) {
      stub._store.set(`logs||2026-05-31T0${i}:00:00.000Z||x`, { value: "{}" });
    }

    const channel = kvLogChannel(stub, { prefix: "logs", maxLogs: 2, highWater: 3, purgeProbability: 0 });

    await channel.write(makeRecord());

    // All original plus the new one; nothing purged
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
    const channel = kvLogChannel(stub, { prefix: "logs", purgeProbability: 0 });
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

    // Must resolve — purge error must be swallowed, not propagated to caller
    await expect(channel.write(makeRecord())).resolves.toBeUndefined();
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
