import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { consoleChannel, withMinLevel } from "./channels";
import type { LogChannel, LogRecord } from "./types";
import { levelAtLeast, parseLogLevel } from "./types";

let captured: string[] = [];
let originalLog: typeof console.log;

beforeEach(() => {
  captured = [];
  originalLog = console.log;
  console.log = (...args: unknown[]) => captured.push(args.map(String).join(" "));
});

afterEach(() => {
  console.log = originalLog;
});

function makeRecord(overrides?: Partial<LogRecord>): LogRecord {
  return { level: "info", prefix: "test", message: "hello", timestamp: "2026-01-01T00:00:00.000Z", ...overrides };
}

describe("consoleChannel", () => {
  it("emits a single JSON line", () => {
    const ch = consoleChannel();
    ch.write(makeRecord());
    expect(captured).toHaveLength(1);
    expect(() => JSON.parse(captured[0]!)).not.toThrow();
  });

  it("includes level, prefix, message, and timestamp", () => {
    const ch = consoleChannel();
    ch.write(makeRecord({ level: "warn", prefix: "svc", message: "oops", timestamp: "2026-01-01T00:00:00.000Z" }));
    const obj = JSON.parse(captured[0]!);
    expect(obj.level).toBe("warn");
    expect(obj.prefix).toBe("svc");
    expect(obj.message).toBe("oops");
    expect(obj.timestamp).toBe("2026-01-01T00:00:00.000Z");
  });

  it("spreads data fields at the top level", () => {
    const ch = consoleChannel();
    ch.write(makeRecord({ data: { userId: "u1", count: 3 } }));
    const obj = JSON.parse(captured[0]!);
    expect(obj.userId).toBe("u1");
    expect(obj.count).toBe(3);
    expect("data" in obj).toBe(false);
  });

  it("omits data key when no data provided", () => {
    const ch = consoleChannel();
    ch.write(makeRecord());
    const obj = JSON.parse(captured[0]!);
    expect("data" in obj).toBe(false);
  });

  it("returns void (sync channel)", () => {
    const ch = consoleChannel();
    const result = ch.write(makeRecord());
    expect(result).toBeUndefined();
  });

  it("has no read method", () => {
    const ch = consoleChannel();
    expect(ch.read).toBeUndefined();
  });

  it("reserved fields win — caller-supplied level in data cannot forge the real level", () => {
    const ch = consoleChannel();
    ch.write(makeRecord({ level: "error", message: "real message", data: { level: "debug", message: "forged" } }));
    const obj = JSON.parse(captured[0]!);
    expect(obj.level).toBe("error");
    expect(obj.message).toBe("real message");
  });

  it("reserved fields win — caller-supplied timestamp in data is overridden by the record timestamp", () => {
    const ch = consoleChannel();
    ch.write(makeRecord({ timestamp: "2026-01-01T00:00:00.000Z", data: { timestamp: "fake" } }));
    const obj = JSON.parse(captured[0]!);
    expect(obj.timestamp).toBe("2026-01-01T00:00:00.000Z");
    expect(obj.timestamp).not.toBe("fake");
  });
});

describe("withMinLevel", () => {
  function makeCapture(): { records: LogRecord[]; channel: LogChannel } {
    const records: LogRecord[] = [];
    return {
      records,
      channel: {
        write: (r) => {
          records.push(r);
        },
      },
    };
  }

  it("drops records below the minimum level", () => {
    const { records, channel } = makeCapture();
    const filtered = withMinLevel(channel, "warn");

    filtered.write(makeRecord({ level: "debug" }));
    filtered.write(makeRecord({ level: "info" }));

    expect(records).toHaveLength(0);
  });

  it("passes records at and above the minimum level", () => {
    const { records, channel } = makeCapture();
    const filtered = withMinLevel(channel, "warn");

    filtered.write(makeRecord({ level: "warn" }));
    filtered.write(makeRecord({ level: "error" }));

    expect(records.map((r) => r.level)).toStrictEqual(["warn", "error"]);
  });

  it("returns the inner channel's write promise for passing records", () => {
    const asyncChannel: LogChannel = { write: () => Promise.resolve() };
    const filtered = withMinLevel(asyncChannel, "info");
    expect(filtered.write(makeRecord({ level: "error" }))).toBeInstanceOf(Promise);
  });

  it("filtered writes return undefined (nothing pending to flush)", () => {
    const asyncChannel: LogChannel = { write: () => Promise.resolve() };
    const filtered = withMinLevel(asyncChannel, "warn");
    expect(filtered.write(makeRecord({ level: "debug" }))).toBeUndefined();
  });

  it("passes read through to the inner channel", async () => {
    const inner: LogChannel = {
      write: () => {},
      read: () => Promise.resolve({ rows: [{ key: "k", level: "info", prefix: "p", message: "m", timestamp: "t" }], complete: true }),
    };
    const filtered = withMinLevel(inner, "error");

    const result = await filtered.read!();

    expect(result.rows).toHaveLength(1);
  });

  it("passes readEntry through to the inner channel", async () => {
    const inner: LogChannel = { write: () => {}, readEntry: (key) => Promise.resolve(makeRecord({ message: `entry:${key}` })) };
    const filtered = withMinLevel(inner, "error");

    const record = await filtered.readEntry!("abc");

    expect(record?.message).toBe("entry:abc");
  });

  it("has no read/readEntry when the inner channel is write-only", () => {
    const filtered = withMinLevel({ write: () => {} }, "warn");
    expect(filtered.read).toBeUndefined();
    expect(filtered.readEntry).toBeUndefined();
  });
});

describe("levelAtLeast", () => {
  it("orders debug < info < warn < error", () => {
    expect(levelAtLeast("debug", "info")).toBe(false);
    expect(levelAtLeast("info", "info")).toBe(true);
    expect(levelAtLeast("warn", "info")).toBe(true);
    expect(levelAtLeast("error", "warn")).toBe(true);
    expect(levelAtLeast("warn", "error")).toBe(false);
  });
});

describe("parseLogLevel", () => {
  it("parses a known level", () => {
    expect(parseLogLevel("warn", "info")).toBe("warn");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(parseLogLevel(" ERROR ", "info")).toBe("error");
  });

  it("falls back for undefined", () => {
    expect(parseLogLevel(undefined, "info")).toBe("info");
  });

  it("falls back for unknown values", () => {
    expect(parseLogLevel("verbose", "debug")).toBe("debug");
  });
});
