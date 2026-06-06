import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createLogger } from "./logger";
import type { LogChannel, LogRecord } from "./types";

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
    expect(() => JSON.parse(captured[0]!)).not.toThrow();
  });

  it("includes the prefix in output", () => {
    const log = createLogger("my-prefix");
    log.info("hello");
    const obj = JSON.parse(captured[0]!);
    expect(obj.prefix).toBe("my-prefix");
  });

  it("includes the message in output", () => {
    const log = createLogger("test");
    log.warn("something wrong");
    const obj = JSON.parse(captured[0]!);
    expect(obj.message).toBe("something wrong");
  });

  it("includes a timestamp in output", () => {
    const log = createLogger("test");
    log.error("bad");
    const obj = JSON.parse(captured[0]!);
    expect(typeof obj.timestamp).toBe("string");
    expect(() => new Date(obj.timestamp)).not.toThrow();
  });

  it("includes the log level", () => {
    const log = createLogger("test");
    log.debug("debug msg");
    const obj = JSON.parse(captured[0]!);
    expect(obj.level).toBe("debug");
  });

  it("includes extra data fields when provided", () => {
    const log = createLogger("test");
    log.info("with data", { userId: "abc" });
    const obj = JSON.parse(captured[0]!);
    expect(obj.userId).toBe("abc");
  });

  it("dispatches to multiple channels", () => {
    const records1: LogRecord[] = [];
    const records2: LogRecord[] = [];
    const ch1: LogChannel = (r) => {
      records1.push(r);
    };
    const ch2: LogChannel = (r) => {
      records2.push(r);
    };

    const log = createLogger("multi", { channels: [ch1, ch2] });
    log.info("broadcast");

    expect(records1).toHaveLength(1);
    expect(records2).toHaveLength(1);
    expect(records1[0]!.message).toBe("broadcast");
    expect(records2[0]!.message).toBe("broadcast");
  });

  it("flush awaits pending async channel writes", async () => {
    const order: string[] = [];
    const asyncChannel: LogChannel = (_r) =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          order.push("async-done");
          resolve();
        }, 10);
      });

    const log = createLogger("flush-test", { channels: [asyncChannel] });
    log.info("trigger");
    order.push("before-flush");
    await log.flush();
    order.push("after-flush");

    expect(order).toStrictEqual(["before-flush", "async-done", "after-flush"]);
  });

  it("flush with no pending promises resolves immediately", async () => {
    const log = createLogger("test");
    await expect(log.flush()).resolves.toBeUndefined();
  });

  it("uses consoleChannel by default when no channels provided", () => {
    const log = createLogger("default-ch");
    log.info("check default");
    expect(captured).toHaveLength(1);
    const obj = JSON.parse(captured[0]!);
    expect(obj.level).toBe("info");
  });

  it("empty channels array produces no output", () => {
    const log = createLogger("silent", { channels: [] });
    log.info("should not appear");
    expect(captured).toHaveLength(0);
  });

  it("LogRecord includes data field when data is provided", () => {
    const records: LogRecord[] = [];
    const ch: LogChannel = (r) => {
      records.push(r);
    };
    const log = createLogger("rec-test", { channels: [ch] });

    log.warn("with data", { key: "val" });

    expect(records[0]!.data).toStrictEqual({ key: "val" });
  });

  it("LogRecord omits data field when no data provided", () => {
    const records: LogRecord[] = [];
    const ch: LogChannel = (r) => {
      records.push(r);
    };
    const log = createLogger("rec-test", { channels: [ch] });

    log.info("no data");

    expect("data" in records[0]!).toBe(false);
  });
});

describe("createLogger — child()", () => {
  it("child merges bindings into data on records", () => {
    const records: LogRecord[] = [];
    const ch: LogChannel = (r) => {
      records.push(r);
    };
    const log = createLogger("svc", { channels: [ch] });
    const child = log.child({ requestId: "abc-123" });

    child.info("handler called");

    expect(records[0]!.data).toStrictEqual({ requestId: "abc-123" });
  });

  it("per-call data overrides a binding of the same key", () => {
    const records: LogRecord[] = [];
    const ch: LogChannel = (r) => {
      records.push(r);
    };
    const log = createLogger("svc", { channels: [ch] });
    const child = log.child({ requestId: "original" });

    child.warn("override", { requestId: "overridden", extra: "val" });

    expect(records[0]!.data).toStrictEqual({ requestId: "overridden", extra: "val" });
  });

  it("parent and child share the same pending queue so one flush() drains both", async () => {
    const order: string[] = [];
    const asyncChannel: LogChannel = (_r) =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          order.push("async");
          resolve();
        }, 10);
      });

    const log = createLogger("parent", { channels: [asyncChannel] });
    const child = log.child({ requestId: "r1" });

    child.info("from child");
    order.push("before-flush");
    await log.flush(); // flush on parent drains child writes too
    order.push("after-flush");

    expect(order).toStrictEqual(["before-flush", "async", "after-flush"]);
  });

  it("child shares channels with parent — writes go to all channels", () => {
    const records1: LogRecord[] = [];
    const records2: LogRecord[] = [];
    const ch1: LogChannel = (r) => {
      records1.push(r);
    };
    const ch2: LogChannel = (r) => {
      records2.push(r);
    };

    const log = createLogger("p", { channels: [ch1, ch2] });
    const child = log.child({ userId: "u1" });

    child.error("boom");

    expect(records1).toHaveLength(1);
    expect(records2).toHaveLength(1);
    expect(records1[0]!.data).toStrictEqual({ userId: "u1" });
  });

  it("child bindings do not affect the parent logger", () => {
    const records: LogRecord[] = [];
    const ch: LogChannel = (r) => {
      records.push(r);
    };
    const log = createLogger("svc", { channels: [ch] });
    log.child({ requestId: "child-only" });

    log.info("parent msg");

    expect("data" in records[0]!).toBe(false);
  });

  it("nested children accumulate bindings", () => {
    const records: LogRecord[] = [];
    const ch: LogChannel = (r) => {
      records.push(r);
    };
    const log = createLogger("svc", { channels: [ch] });
    const child = log.child({ requestId: "r1" });
    const grandchild = child.child({ userId: "u1" });

    grandchild.debug("deep");

    expect(records[0]!.data).toStrictEqual({ requestId: "r1", userId: "u1" });
  });

  it("createLogger bindings option sets initial bindings", () => {
    const records: LogRecord[] = [];
    const ch: LogChannel = (r) => {
      records.push(r);
    };
    const log = createLogger("svc", { channels: [ch], bindings: { service: "api" } });

    log.info("startup");

    expect(records[0]!.data).toStrictEqual({ service: "api" });
  });
});
