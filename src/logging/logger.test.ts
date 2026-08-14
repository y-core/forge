import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createLogger } from "./logger";
import type { LogChannel, LogRecord } from "./types";

let captured: string[] = [];
let capturedErrors: string[] = [];
let originalLog: typeof console.log;
let originalError: typeof console.error;

beforeEach(() => {
  captured = [];
  capturedErrors = [];
  originalLog = console.log;
  originalError = console.error;
  console.log = (...args: unknown[]) => captured.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => capturedErrors.push(args.map(String).join(" "));
});

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
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
    const ch1: LogChannel = {
      write: (r) => {
        records1.push(r);
      },
    };
    const ch2: LogChannel = {
      write: (r) => {
        records2.push(r);
      },
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
    const asyncChannel: LogChannel = {
      write: (_r) =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            order.push("async-done");
            resolve();
          }, 10);
        }),
    };

    const log = createLogger("flush-test", { channels: [asyncChannel] });
    log.info("trigger");
    order.push("before-flush");
    await log.flush();
    order.push("after-flush");

    expect(order).toStrictEqual(["before-flush", "async-done", "after-flush"]);
  });

  it("flush settles rather than rejecting when a channel write fails", async () => {
    const records: LogRecord[] = [];
    const failing: LogChannel = { write: () => Promise.reject(new Error("channel down")) };
    const working: LogChannel = {
      write: (r) =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            records.push(r);
            resolve();
          }, 5);
        }),
    };

    const log = createLogger("flush-failure", { channels: [failing, working] });
    log.info("trigger");

    await expect(log.flush()).resolves.toBeUndefined();
    expect(records.map((r) => r.message)).toStrictEqual(["trigger"]);
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
    const ch: LogChannel = {
      write: (r) => {
        records.push(r);
      },
    };
    const log = createLogger("rec-test", { channels: [ch] });

    log.warn("with data", { key: "val" });

    expect(records[0]!.data).toStrictEqual({ key: "val" });
  });

  it("LogRecord omits data field when no data provided", () => {
    const records: LogRecord[] = [];
    const ch: LogChannel = {
      write: (r) => {
        records.push(r);
      },
    };
    const log = createLogger("rec-test", { channels: [ch] });

    log.info("no data");

    expect("data" in records[0]!).toBe(false);
  });
});

describe("createLogger — minLevel", () => {
  function capture(): { records: LogRecord[]; ch: LogChannel } {
    const records: LogRecord[] = [];
    return {
      records,
      ch: {
        write: (r) => {
          records.push(r);
        },
      },
    };
  }

  it("drops records below minLevel before any channel sees them", () => {
    const { records, ch } = capture();
    const log = createLogger("svc", { channels: [ch], minLevel: "warn" });

    log.debug("d");
    log.info("i");

    expect(records).toHaveLength(0);
  });

  it("passes records at and above minLevel", () => {
    const { records, ch } = capture();
    const log = createLogger("svc", { channels: [ch], minLevel: "warn" });

    log.warn("w");
    log.error("e");

    expect(records.map((r) => r.level)).toStrictEqual(["warn", "error"]);
  });

  it("no minLevel means no filtering", () => {
    const { records, ch } = capture();
    const log = createLogger("svc", { channels: [ch] });

    log.debug("d");

    expect(records).toHaveLength(1);
  });
});

describe("createLogger — child()", () => {
  it("child merges bindings into data on records", () => {
    const records: LogRecord[] = [];
    const ch: LogChannel = {
      write: (r) => {
        records.push(r);
      },
    };
    const log = createLogger("svc", { channels: [ch] });
    const child = log.child({ requestId: "abc-123" });

    child.info("handler called");

    expect(records[0]!.data).toStrictEqual({ requestId: "abc-123" });
  });

  it("per-call data overrides a binding of the same key", () => {
    const records: LogRecord[] = [];
    const ch: LogChannel = {
      write: (r) => {
        records.push(r);
      },
    };
    const log = createLogger("svc", { channels: [ch] });
    const child = log.child({ requestId: "original" });

    child.warn("override", { requestId: "overridden", extra: "val" });

    expect(records[0]!.data).toStrictEqual({ requestId: "overridden", extra: "val" });
  });

  it("parent and child share the same pending queue so one flush() drains both", async () => {
    const order: string[] = [];
    const asyncChannel: LogChannel = {
      write: (_r) =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            order.push("async");
            resolve();
          }, 10);
        }),
    };

    const log = createLogger("parent", { channels: [asyncChannel] });
    const child = log.child({ requestId: "r1" });

    child.info("from child");
    order.push("before-flush");
    await log.flush();
    order.push("after-flush");

    expect(order).toStrictEqual(["before-flush", "async", "after-flush"]);
  });

  it("child shares channels with parent — writes go to all channels", () => {
    const records1: LogRecord[] = [];
    const records2: LogRecord[] = [];
    const ch1: LogChannel = {
      write: (r) => {
        records1.push(r);
      },
    };
    const ch2: LogChannel = {
      write: (r) => {
        records2.push(r);
      },
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
    const ch: LogChannel = {
      write: (r) => {
        records.push(r);
      },
    };
    const log = createLogger("svc", { channels: [ch] });
    log.child({ requestId: "child-only" });

    log.info("parent msg");

    expect("data" in records[0]!).toBe(false);
  });

  it("nested children accumulate bindings", () => {
    const records: LogRecord[] = [];
    const ch: LogChannel = {
      write: (r) => {
        records.push(r);
      },
    };
    const log = createLogger("svc", { channels: [ch] });
    const child = log.child({ requestId: "r1" });
    const grandchild = child.child({ userId: "u1" });

    grandchild.debug("deep");

    expect(records[0]!.data).toStrictEqual({ requestId: "r1", userId: "u1" });
  });

  it("minLevel is inherited by children", () => {
    const records: LogRecord[] = [];
    const ch: LogChannel = {
      write: (r) => {
        records.push(r);
      },
    };
    const log = createLogger("svc", { channels: [ch], minLevel: "warn" });
    const child = log.child({ requestId: "r1" });

    child.info("dropped");
    child.error("kept");

    expect(records).toHaveLength(1);
    expect(records[0]!.message).toBe("kept");
  });

  it("createLogger bindings option sets initial bindings", () => {
    const records: LogRecord[] = [];
    const ch: LogChannel = {
      write: (r) => {
        records.push(r);
      },
    };
    const log = createLogger("svc", { channels: [ch], bindings: { service: "api" } });

    log.info("startup");

    expect(records[0]!.data).toStrictEqual({ service: "api" });
  });
});

// Mirrors the module-private pending-buffer cap in `logger.ts`.
const PENDING_CAP = 1000;

function failingChannel(error: unknown): LogChannel {
  return { write: () => Promise.reject(error) };
}

function collector(): { errors: unknown[]; onChannelError: (error: unknown) => void } {
  const errors: unknown[] = [];
  return {
    errors,
    onChannelError: (error) => {
      errors.push(error);
    },
  };
}

/** A `Promise` that counts the handlers attached to this instance. */
class TrackedPromise<T> extends Promise<T> {
  attachments = 0;
  // biome-ignore lint/suspicious/noThenProperty: deliberate override on a real Promise subclass.
  override then<TResult1 = T, TResult2 = never>(
    onFulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null | undefined,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null | undefined,
  ): Promise<TResult1 | TResult2> {
    this.attachments += 1;
    return super.then(onFulfilled, onRejected);
  }
}

describe("createLogger — onChannelError", () => {
  it("invokes the hook with the rejection reason from a failing channel write", async () => {
    const boom = new Error("kv down");
    const { errors, onChannelError } = collector();
    const log = createLogger("svc", { channels: [failingChannel(boom)], onChannelError });

    log.info("persisted?");
    await log.flush();

    expect(errors).toStrictEqual([boom]);
  });

  it("passes a non-Error rejection reason through unchanged", async () => {
    const { errors, onChannelError } = collector();
    const log = createLogger("svc", { channels: [{ write: () => Promise.reject("binding is undefined") }], onChannelError });

    log.error("persisted?");
    await log.flush();

    expect(errors).toStrictEqual(["binding is undefined"]);
  });

  it("does not invoke the hook when every write succeeds", async () => {
    const { errors, onChannelError } = collector();
    const sync: LogChannel = { write: () => {} };
    const async: LogChannel = { write: () => Promise.resolve() };
    const log = createLogger("svc", { channels: [sync, async], onChannelError });

    log.info("fine");
    await log.flush();

    expect(errors).toStrictEqual([]);
  });

  it("invokes the hook once per failing channel and leaves a healthy channel's write intact", async () => {
    const first = new Error("channel a down");
    const second = new Error("channel b down");
    const records: LogRecord[] = [];
    const healthy: LogChannel = {
      write: (r) => {
        records.push(r);
      },
    };
    const { errors, onChannelError } = collector();
    const log = createLogger("svc", { channels: [failingChannel(first), healthy, failingChannel(second)], onChannelError });

    log.warn("fan out");
    await log.flush();

    expect(errors).toStrictEqual([first, second]);
    expect(records.map((r) => r.message)).toStrictEqual(["fan out"]);
  });

  it("a record dropped by minLevel never reaches the channel, so nothing is reported", async () => {
    const { errors, onChannelError } = collector();
    const log = createLogger("svc", { channels: [failingChannel(new Error("kv down"))], minLevel: "error", onChannelError });

    log.warn("dropped before dispatch");
    await log.flush();

    expect(errors).toStrictEqual([]);
  });
});

describe("createLogger — onChannelError and the flush contract", () => {
  it("flush resolves and still waits for the failing write to settle", async () => {
    const order: string[] = [];
    const { errors, onChannelError } = collector();
    const boom = new Error("kv down");
    const slowFailure: LogChannel = {
      write: () =>
        new Promise<void>((_resolve, reject) => {
          setTimeout(() => {
            order.push("write-settled");
            reject(boom);
          }, 10);
        }),
    };
    const log = createLogger("svc", { channels: [slowFailure], onChannelError });

    log.info("trigger");
    order.push("before-flush");
    await expect(log.flush()).resolves.toBeUndefined();
    order.push("after-flush");

    expect(order).toStrictEqual(["before-flush", "write-settled", "after-flush"]);
    expect(errors).toStrictEqual([boom]);
  });

  it("flush awaits the write itself, not a promise derived from the error handler", async () => {
    const boom = new Error("kv down");
    const write = new TrackedPromise<void>((_resolve, reject) => {
      setTimeout(() => reject(boom), 5);
    });
    const { errors, onChannelError } = collector();
    const log = createLogger("svc", { channels: [{ write: () => write }], onChannelError });

    log.info("trigger");

    expect(write.attachments).toBe(1);

    await log.flush();

    expect(write.attachments).toBe(2);
    expect(errors).toStrictEqual([boom]);
  });

  it("observes a write evicted by the pending cap, which flush never awaits", async () => {
    const raised: Error[] = [];
    const { errors, onChannelError } = collector();
    let writes = 0;
    const channel: LogChannel = {
      write: () => {
        const index = writes++;
        const error = new Error(`write ${index} failed`);
        raised.push(error);
        if (index > 0) return Promise.reject(error);
        return new Promise<void>((_resolve, reject) => {
          setTimeout(() => reject(error), 50);
        });
      },
    };
    const log = createLogger("svc", { channels: [channel], onChannelError });

    for (let i = 0; i <= PENDING_CAP; i++) log.info(`record ${i}`);

    await log.flush();

    expect(errors).toHaveLength(PENDING_CAP);
    expect(errors.includes(raised[0])).toBe(false);

    await new Promise<void>((resolve) => setTimeout(resolve, 120));

    expect(errors).toHaveLength(PENDING_CAP + 1);
    expect(errors[PENDING_CAP]).toBe(raised[0]);
  });
});

describe("createLogger — a throwing onChannelError", () => {
  it("never reaches the caller: dispatch returns, flush resolves, the logger stays usable", async () => {
    let calls = 0;
    const log = createLogger("svc", {
      channels: [failingChannel(new Error("kv down"))],
      onChannelError: () => {
        calls += 1;
        throw new Error("the reporter is broken too");
      },
    });

    expect(() => log.info("trigger")).not.toThrow();
    await expect(log.flush()).resolves.toBeUndefined();
    expect(calls).toBe(1);

    log.error("again");
    await expect(log.flush()).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });

  it("swallows the hook's throw rather than routing it to console.error", async () => {
    const log = createLogger("svc", {
      channels: [failingChannel(new Error("kv down"))],
      onChannelError: () => {
        throw new Error("the reporter is broken too");
      },
    });

    log.info("trigger");
    await log.flush();

    expect(capturedErrors).toStrictEqual([]);
    expect(captured).toStrictEqual([]);
  });
});

describe("createLogger — the default channel-error reporter", () => {
  it("writes one structured console.error line in the consoleChannel record shape", async () => {
    const boom = new Error("kv down");
    const log = createLogger("svc", { channels: [failingChannel(boom)] });

    log.info("trigger");
    await log.flush();

    expect(capturedErrors).toHaveLength(1);
    expect(captured).toStrictEqual([]);

    const report = JSON.parse(capturedErrors[0]!);
    expect(Object.keys(report)).toStrictEqual(["error", "level", "prefix", "message", "timestamp"]);
    expect(report.level).toBe("error");
    expect(report.prefix).toBe("logger");
    expect(report.message).toBe("log channel write failed");
    expect(new Date(report.timestamp).toISOString()).toBe(report.timestamp);
    expect(report.error).toStrictEqual({ name: "Error", message: "kv down", stack: boom.stack });
    expect(JSON.stringify(report.error)).not.toBe("{}");
  });

  it("reports a non-Error rejection reason without throwing", async () => {
    const log = createLogger("svc", { channels: [{ write: () => Promise.reject("binding is undefined") }] });

    log.info("trigger");
    await log.flush();

    expect(capturedErrors).toHaveLength(1);
    const report = JSON.parse(capturedErrors[0]!);
    expect(report.error).toStrictEqual({ name: "string", message: "binding is undefined" });
  });

  it("is replaced entirely when a hook is supplied", async () => {
    const boom = new Error("kv down");
    const { errors, onChannelError } = collector();
    const log = createLogger("svc", { channels: [failingChannel(boom)], onChannelError });

    log.info("trigger");
    await log.flush();

    expect(errors).toStrictEqual([boom]);
    expect(capturedErrors).toStrictEqual([]);
  });
});

describe("createLogger — child() inherits the error surface", () => {
  it("a grandchild reports through the parent's hook, by reference", async () => {
    const boom = new Error("kv down");
    const { errors, onChannelError } = collector();
    const log = createLogger("svc", { channels: [failingChannel(boom)], onChannelError });
    const grandchild = log.child({ requestId: "r1" }).child({ userId: "u1" });

    grandchild.info("from a grandchild");
    await grandchild.flush();

    expect(errors).toStrictEqual([boom]);
  });

  it("a child's failing write is reported once, not once per generation", async () => {
    const boom = new Error("kv down");
    const { errors, onChannelError } = collector();
    const log = createLogger("svc", { channels: [failingChannel(boom)], onChannelError });
    const child = log.child({ requestId: "r1" });

    child.info("one record");
    await log.flush();

    expect(errors).toStrictEqual([boom]);
  });

  it("a child inherits the default reporter when the parent configured none", async () => {
    const log = createLogger("svc", { channels: [failingChannel(new Error("kv down"))] });
    const child = log.child({ requestId: "r1" });

    child.info("trigger");
    await child.flush();

    expect(capturedErrors).toHaveLength(1);
    const report = JSON.parse(capturedErrors[0]!);
    expect(report.message).toBe("log channel write failed");
    expect(report.prefix).toBe("logger");
  });
});

// Throws *synchronously*, as `consoleChannel` does on cyclic `data` — no promise to observe.
function throwingChannel(error: unknown): LogChannel {
  return {
    write: () => {
      throw error;
    },
  };
}

describe("createLogger — a synchronously throwing channel", () => {
  it("does not escape dispatch: the value is reported by identity and flush resolves", async () => {
    const boom = new Error("stringify blew up");
    const { errors, onChannelError } = collector();
    const log = createLogger("svc", { channels: [throwingChannel(boom)], onChannelError });

    expect(() => log.info("persisted?")).not.toThrow();

    expect(errors).toStrictEqual([boom]);
    await expect(log.flush()).resolves.toBeUndefined();
    expect(errors).toStrictEqual([boom]);
  });

  it("reports once per throwing channel and leaves a healthy channel's write intact", async () => {
    const first = new Error("channel a threw");
    const second = new Error("channel b threw");
    const records: LogRecord[] = [];
    const healthy: LogChannel = {
      write: (r) => {
        records.push(r);
      },
    };
    const { errors, onChannelError } = collector();
    const log = createLogger("svc", { channels: [throwingChannel(first), healthy, throwingChannel(second)], onChannelError });

    expect(() => log.warn("fan out")).not.toThrow();
    await log.flush();

    expect(errors).toStrictEqual([first, second]);
    expect(records.map((r) => r.message)).toStrictEqual(["fan out"]);
  });

  it("adds nothing to the pending buffer, so flush still resolves without yielding", async () => {
    const first = new Error("channel a threw");
    const second = new Error("channel b threw");
    const { errors, onChannelError } = collector();
    const log = createLogger("svc", { channels: [throwingChannel(first), throwingChannel(second)], onChannelError });

    expect(() => log.error("nothing to track")).not.toThrow();
    expect(errors).toStrictEqual([first, second]);

    const raced = await Promise.race([
      log.flush().then(() => "flush"),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("macrotask"), 0);
      }),
    ]);

    expect(raced).toBe("flush");
    await expect(log.flush()).resolves.toBeUndefined();
  });

  it("mixes with a rejecting channel: both reported once, and flush awaits only the rejecting one", async () => {
    const thrown = new Error("stringify blew up");
    const rejected = new Error("kv down");
    const order: string[] = [];
    const slowFailure: LogChannel = {
      write: () =>
        new Promise<void>((_resolve, reject) => {
          setTimeout(() => {
            order.push("write-settled");
            reject(rejected);
          }, 10);
        }),
    };
    const { errors, onChannelError } = collector();
    const log = createLogger("svc", { channels: [throwingChannel(thrown), slowFailure], onChannelError });

    log.info("both modes");

    expect(errors).toStrictEqual([thrown]);

    order.push("before-flush");
    await expect(log.flush()).resolves.toBeUndefined();
    order.push("after-flush");

    expect(order).toStrictEqual(["before-flush", "write-settled", "after-flush"]);
    expect(errors).toStrictEqual([thrown, rejected]);
  });

  it("survives a throwing onChannelError reached from the sync path, and does not latch it", async () => {
    let calls = 0;
    const log = createLogger("svc", {
      channels: [throwingChannel(new Error("stringify blew up"))],
      onChannelError: () => {
        calls += 1;
        throw new Error("the reporter is broken too");
      },
    });

    expect(() => log.info("trigger")).not.toThrow();
    await expect(log.flush()).resolves.toBeUndefined();
    expect(calls).toBe(1);

    expect(() => log.error("again")).not.toThrow();
    await expect(log.flush()).resolves.toBeUndefined();
    expect(calls).toBe(2);

    expect(capturedErrors).toStrictEqual([]);
    expect(captured).toStrictEqual([]);
  });
});
