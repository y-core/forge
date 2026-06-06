import { describe, expect, it } from "bun:test";
import type { KVListResult, KVNamespace } from "../../storage/kv/types";
import type { KvLogMetadata } from "../types";
import { readLogs } from "./reader";

function makeKvStub(entries: Array<{ key: string; meta: KvLogMetadata }>): KVNamespace {
  const sorted = [...entries].sort((a, b) => a.key.localeCompare(b.key));

  const ns = {
    get: () => Promise.resolve(null),
    getWithMetadata: () => Promise.resolve({ value: null, metadata: null }),
    put: () => Promise.resolve(),
    delete: () => Promise.resolve(),
    list<M = unknown>(opts?: { prefix?: string; limit?: number; cursor?: string }): Promise<KVListResult<M>> {
      const pfx = opts?.prefix ?? "";
      const keys = sorted.filter((e) => e.key.startsWith(pfx)).map((e) => ({ name: e.key, metadata: e.meta as unknown as M }));
      return Promise.resolve({ keys, list_complete: true });
    },
  } as unknown as KVNamespace;

  return ns;
}

function meta(overrides?: Partial<KvLogMetadata>): KvLogMetadata {
  return { level: "info", prefix: "svc", message: "test message", timestamp: "2026-05-31T10:00:00.000Z", ...overrides };
}

describe("readLogs — basic retrieval", () => {
  it("returns all rows from KV metadata", async () => {
    const kv = makeKvStub([
      { key: "logs||2026-05-31T10:00:00.000Z||aaa", meta: meta({ message: "first" }) },
      { key: "logs||2026-05-31T11:00:00.000Z||bbb", meta: meta({ message: "second" }) },
    ]);

    const result = await readLogs(kv);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.message).toBe("first");
    expect(result.rows[1]!.message).toBe("second");
  });

  it("returns empty rows when KV has no matching entries", async () => {
    const kv = makeKvStub([]);
    const result = await readLogs(kv);
    expect(result.rows).toHaveLength(0);
  });

  it("maps KV metadata fields onto LogRow", async () => {
    const kv = makeKvStub([
      { key: "logs||2026-05-31T10:00:00.000Z||aaa", meta: meta({ level: "warn", prefix: "api", message: "slow request", requestId: "req-xyz" }) },
    ]);

    const result = await readLogs(kv);
    const row = result.rows[0]!;

    expect(row.level).toBe("warn");
    expect(row.prefix).toBe("api");
    expect(row.message).toBe("slow request");
    expect(row.requestId).toBe("req-xyz");
    expect(row.timestamp).toBe("2026-05-31T10:00:00.000Z");
  });
});

describe("readLogs — level filter", () => {
  it("filters rows by exact level", async () => {
    const kv = makeKvStub([
      { key: "logs||2026-05-31T10:00:00.000Z||a", meta: meta({ level: "info" }) },
      { key: "logs||2026-05-31T10:00:01.000Z||b", meta: meta({ level: "error" }) },
      { key: "logs||2026-05-31T10:00:02.000Z||c", meta: meta({ level: "warn" }) },
    ]);

    const result = await readLogs(kv, { level: "error" });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.level).toBe("error");
  });

  it("returns all rows when level is not specified", async () => {
    const kv = makeKvStub([
      { key: "logs||2026-05-31T10:00:00.000Z||a", meta: meta({ level: "debug" }) },
      { key: "logs||2026-05-31T10:00:01.000Z||b", meta: meta({ level: "error" }) },
    ]);

    const result = await readLogs(kv, {});

    expect(result.rows).toHaveLength(2);
  });
});

describe("readLogs — text filter (q)", () => {
  it("filters by message substring (case-insensitive)", async () => {
    const kv = makeKvStub([
      { key: "logs||2026-05-31T10:00:00.000Z||a", meta: meta({ message: "Email delivery failed" }) },
      { key: "logs||2026-05-31T10:00:01.000Z||b", meta: meta({ message: "Contact form submitted" }) },
    ]);

    const result = await readLogs(kv, { q: "email" });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.message).toBe("Email delivery failed");
  });

  it("filters by prefix substring", async () => {
    const kv = makeKvStub([
      { key: "logs||2026-05-31T10:00:00.000Z||a", meta: meta({ prefix: "contact" }) },
      { key: "logs||2026-05-31T10:00:01.000Z||b", meta: meta({ prefix: "email" }) },
    ]);

    const result = await readLogs(kv, { q: "contact" });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.prefix).toBe("contact");
  });

  it("filters by requestId substring", async () => {
    const kv = makeKvStub([
      { key: "logs||2026-05-31T10:00:00.000Z||a", meta: meta({ requestId: "cf-ray-12345" }) },
      { key: "logs||2026-05-31T10:00:01.000Z||b", meta: meta({ requestId: "cf-ray-99999" }) },
    ]);

    const result = await readLogs(kv, { q: "12345" });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.requestId).toBe("cf-ray-12345");
  });

  it("combines level and text filters", async () => {
    const kv = makeKvStub([
      { key: "logs||2026-05-31T10:00:00.000Z||a", meta: meta({ level: "error", message: "failed" }) },
      { key: "logs||2026-05-31T10:00:01.000Z||b", meta: meta({ level: "info", message: "failed" }) },
      { key: "logs||2026-05-31T10:00:02.000Z||c", meta: meta({ level: "error", message: "ok" }) },
    ]);

    const result = await readLogs(kv, { level: "error", q: "failed" });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.level).toBe("error");
    expect(result.rows[0]!.message).toBe("failed");
  });
});

describe("readLogs — custom prefix", () => {
  it("lists with the provided prefix", async () => {
    const kv = makeKvStub([
      { key: "app-logs||2026-05-31T10:00:00.000Z||a", meta: meta({ message: "in prefix" }) },
      { key: "logs||2026-05-31T10:00:00.000Z||b", meta: meta({ message: "outside" }) },
    ]);

    const result = await readLogs(kv, { prefix: "app-logs" });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.message).toBe("in prefix");
  });
});
