import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { consoleChannel } from "./channels";
import type { LogRecord } from "./types";

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
    ch(makeRecord());
    expect(captured).toHaveLength(1);
    expect(() => JSON.parse(captured[0]!)).not.toThrow();
  });

  it("includes level, prefix, message, and timestamp", () => {
    const ch = consoleChannel();
    ch(makeRecord({ level: "warn", prefix: "svc", message: "oops", timestamp: "2026-01-01T00:00:00.000Z" }));
    const obj = JSON.parse(captured[0]!);
    expect(obj.level).toBe("warn");
    expect(obj.prefix).toBe("svc");
    expect(obj.message).toBe("oops");
    expect(obj.timestamp).toBe("2026-01-01T00:00:00.000Z");
  });

  it("spreads data fields at the top level", () => {
    const ch = consoleChannel();
    ch(makeRecord({ data: { userId: "u1", count: 3 } }));
    const obj = JSON.parse(captured[0]!);
    expect(obj.userId).toBe("u1");
    expect(obj.count).toBe(3);
    expect("data" in obj).toBe(false);
  });

  it("omits data key when no data provided", () => {
    const ch = consoleChannel();
    ch(makeRecord());
    const obj = JSON.parse(captured[0]!);
    expect("data" in obj).toBe(false);
  });

  it("returns void (sync channel)", () => {
    const ch = consoleChannel();
    const result = ch(makeRecord());
    expect(result).toBeUndefined();
  });
});
