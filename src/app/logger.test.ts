import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createLogger } from "./logger";

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

describe("createLogger", () => {
  it("outputs valid JSON", () => {
    const log = createLogger("test");
    log.info("hello");
    expect(() => JSON.parse(captured[0])).not.toThrow();
  });

  it("includes the prefix in output", () => {
    const log = createLogger("my-prefix");
    log.info("hello");
    const obj = JSON.parse(captured[0]);
    expect(obj.prefix).toBe("my-prefix");
  });

  it("includes the message in output", () => {
    const log = createLogger("test");
    log.warn("something wrong");
    const obj = JSON.parse(captured[0]);
    expect(obj.message).toBe("something wrong");
  });

  it("includes a timestamp in output", () => {
    const log = createLogger("test");
    log.error("bad");
    const obj = JSON.parse(captured[0]);
    expect(typeof obj.timestamp).toBe("string");
    expect(() => new Date(obj.timestamp)).not.toThrow();
  });

  it("includes the log level", () => {
    const log = createLogger("test");
    log.debug("debug msg");
    const obj = JSON.parse(captured[0]);
    expect(obj.level).toBe("debug");
  });

  it("includes extra data fields when provided", () => {
    const log = createLogger("test");
    log.info("with data", { userId: "abc" });
    const obj = JSON.parse(captured[0]);
    expect(obj.userId).toBe("abc");
  });
});
