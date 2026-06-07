import { describe, expect, it } from "bun:test";
import { Forge } from "../app/forge-app";
import { mapHandler } from "../app/route-test-helper";
import { requestLog, requestLogger } from "./request-logger";
import type { LogChannel, LogRecord } from "./types";

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

function makeApp(channel: LogChannel, extraBindings?: Record<string, unknown>) {
  const app = new Forge();
  app.use("*", requestLogger(extraBindings ? { channels: () => [channel], bindings: () => extraBindings } : { channels: () => [channel] }));
  mapHandler(app, "GET", "/test", (c) => {
    const log = requestLog.get(c);
    log.info("handler ran");
    return new Response("ok");
  });
  return app;
}

describe("requestLogger", () => {
  it("sets logger on the context", async () => {
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
    expect(records[0]!.data?.requestId).toBe("test-req-1");
    expect(records[0]!.message).toBe("handler ran");
  });

  it("emitted records have the correct level and message", async () => {
    const { records, channel } = makeCapture();
    const app = makeApp(channel);

    await app.request("/test");

    expect(records[0]!.level).toBe("info");
    expect(records[0]!.message).toBe("handler ran");
  });

  it("uses 'request' as the default prefix", async () => {
    const { records, channel } = makeCapture();
    const app = makeApp(channel);

    await app.request("/test");

    expect(records[0]!.prefix).toBe("request");
  });

  it("uses the custom prefix when provided", async () => {
    const { records, channel } = makeCapture();
    const app = new Forge();
    app.use("*", requestLogger({ prefix: "worker", channels: () => [channel] }));
    mapHandler(app, "GET", "/test", (c) => {
      requestLog.get(c).info("msg");
      return new Response("ok");
    });

    await app.request("/test");

    expect(records[0]!.prefix).toBe("worker");
  });

  it("flush is invoked — waitUntil receives the flush promise", async () => {
    const flushed: Promise<void>[] = [];
    const mockCtx: ExecutionContext = {
      waitUntil: (p: Promise<void>) => {
        flushed.push(p);
      },
      passThroughOnException: () => {},
    };

    const { channel } = makeCapture();
    const app = new Forge();
    app.use("*", requestLogger({ channels: () => [channel] }));
    mapHandler(app, "GET", "/test", (c) => {
      requestLog.get(c).info("msg");
      return new Response("ok");
    });

    await app.fetch(new Request("http://localhost/test"), {}, mockCtx);

    expect(flushed.length).toBeGreaterThan(0);
    await Promise.all(flushed);
  });

  it("async channel writes are included in the flush", async () => {
    const order: string[] = [];
    const asyncChannel: LogChannel = {
      write: (_r) =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            order.push("async-done");
            resolve();
          }, 5);
        }),
    };

    const app = new Forge();
    app.use("*", requestLogger({ channels: () => [asyncChannel] }));
    mapHandler(app, "GET", "/test", (c) => {
      requestLog.get(c).info("trigger");
      return new Response("ok");
    });

    // No executionCtx — flush falls through to await
    await app.request("/test");
    order.push("after-request");

    expect(order).toStrictEqual(["async-done", "after-request"]);
  });
});
