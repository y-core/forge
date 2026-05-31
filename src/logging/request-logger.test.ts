import { describe, expect, it } from "bun:test";
import type { ExecutionContext } from "hono";
import { Hono } from "hono";
import type { LoggerVariables } from "./request-logger";
import { requestLogger } from "./request-logger";
import type { LogChannel, LogRecord } from "./types";

function makeCapture(): { records: LogRecord[]; channel: LogChannel } {
  const records: LogRecord[] = [];
  return {
    records,
    channel: (r) => { records.push(r); },
  };
}

function makeApp(channel: LogChannel, extraBindings?: Record<string, unknown>) {
  const app = new Hono<LoggerVariables>();
  app.use(
    "*",
    requestLogger({
      channels: () => [channel],
      bindings: extraBindings ? () => extraBindings : undefined,
    }),
  );
  app.get("/test", (c) => {
    const log = c.get("logger");
    log.info("handler ran");
    return c.text("ok");
  });
  return app;
}

describe("requestLogger", () => {
  it("sets c.get('logger') on the context", async () => {
    const { channel } = makeCapture();
    const app = makeApp(channel);
    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });

  it("emitted records carry the custom bindings", async () => {
    const { records, channel } = makeCapture();
    const app = makeApp(channel, { requestId: "test-req-1" });

    await app.request("/test");

    expect(records).toHaveLength(1);
    expect(records[0].data?.requestId).toBe("test-req-1");
    expect(records[0].message).toBe("handler ran");
  });

  it("emitted records have the correct level and message", async () => {
    const { records, channel } = makeCapture();
    const app = makeApp(channel);

    await app.request("/test");

    expect(records[0].level).toBe("info");
    expect(records[0].message).toBe("handler ran");
  });

  it("uses 'request' as the default prefix", async () => {
    const { records, channel } = makeCapture();
    const app = makeApp(channel);

    await app.request("/test");

    expect(records[0].prefix).toBe("request");
  });

  it("uses the custom prefix when provided", async () => {
    const { records, channel } = makeCapture();
    const app = new Hono<LoggerVariables>();
    app.use("*", requestLogger({ prefix: "worker", channels: () => [channel] }));
    app.get("/test", (c) => {
      c.get("logger").info("msg");
      return c.text("ok");
    });

    await app.request("/test");

    expect(records[0].prefix).toBe("worker");
  });

  it("flush is invoked — waitUntil receives the flush promise", async () => {
    const flushed: Promise<void>[] = [];
    const mockCtx = { waitUntil: (p: Promise<void>) => { flushed.push(p); } };

    const { channel } = makeCapture();
    const app = new Hono<LoggerVariables>();
    app.use("*", requestLogger({ channels: () => [channel] }));
    app.get("/test", (c) => {
      c.get("logger").info("msg");
      return c.text("ok");
    });

    await app.request("/test", {}, undefined, { waitUntil: mockCtx.waitUntil } as unknown as ExecutionContext);

    expect(flushed.length).toBeGreaterThan(0);
    await Promise.all(flushed);
  });

  it("async channel writes are included in the flush", async () => {
    const order: string[] = [];
    const asyncChannel: LogChannel = (_r) =>
      new Promise<void>((resolve) => {
        setTimeout(() => { order.push("async-done"); resolve(); }, 5);
      });

    const app = new Hono<LoggerVariables>();
    app.use("*", requestLogger({ channels: () => [asyncChannel] }));
    app.get("/test", (c) => {
      c.get("logger").info("trigger");
      return c.text("ok");
    });

    // No executionCtx — flush falls through to await
    await app.request("/test");
    order.push("after-request");

    expect(order).toStrictEqual(["async-done", "after-request"]);
  });
});
