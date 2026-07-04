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

    // handler record + per-request summary record, both through the bound child logger
    expect(records).toHaveLength(2);
    expect(records[0]!.data?.requestId).toBe("test-req-1");
    expect(records[0]!.message).toBe("handler ran");
    expect(records[1]!.data?.requestId).toBe("test-req-1");
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

    // one async write for the handler record, one for the summary record
    expect(order).toStrictEqual(["async-done", "async-done", "after-request"]);
  });
});

describe("requestLogger — per-request summary record", () => {
  function makeStatusApp(channel: LogChannel, status: number) {
    const app = new Forge();
    app.use("*", requestLogger({ channels: () => [channel] }));
    mapHandler(app, "GET", "/thing", () => new Response("body", { status }));
    return app;
  }

  it("emits one summary record with method, path, status, and duration", async () => {
    const { records, channel } = makeCapture();
    const app = makeStatusApp(channel, 200);

    await app.request("/thing");

    expect(records).toHaveLength(1);
    const summary = records[0]!;
    expect(summary.message).toBe("GET /thing");
    expect(summary.data?.method).toBe("GET");
    expect(summary.data?.path).toBe("/thing");
    expect(summary.data?.status).toBe(200);
    expect(typeof summary.data?.duration).toBe("number");
  });

  it("strips the query string from the recorded path", async () => {
    const { records, channel } = makeCapture();
    const app = makeStatusApp(channel, 200);

    await app.request("/thing?token=secret&x=1");

    expect(records[0]!.message).toBe("GET /thing");
    expect(records[0]!.data?.path).toBe("/thing");
  });

  it("logs 2xx responses at info level", async () => {
    const { records, channel } = makeCapture();
    await makeStatusApp(channel, 200).request("/thing");
    expect(records[0]!.level).toBe("info");
  });

  it("logs 4xx responses at warn level", async () => {
    const { records, channel } = makeCapture();
    await makeStatusApp(channel, 404).request("/thing");
    expect(records[0]!.level).toBe("warn");
    expect(records[0]!.data?.status).toBe(404);
  });

  it("logs 5xx responses at error level", async () => {
    const { records, channel } = makeCapture();
    await makeStatusApp(channel, 503).request("/thing");
    expect(records[0]!.level).toBe("error");
    expect(records[0]!.data?.status).toBe(503);
  });

  it("a throwing handler surfaces as an error-level 500 summary (app error boundary)", async () => {
    const { records, channel } = makeCapture();
    const app = new Forge();
    app.use("*", requestLogger({ channels: () => [channel] }));
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("handler exploded");
    });

    await app.request("/boom");

    expect(records).toHaveLength(1);
    expect(records[0]!.level).toBe("error");
    expect(records[0]!.message).toBe("GET /boom");
    expect(records[0]!.data?.status).toBe(500);
  });

  it("a throw escaping next() emits one error record with the serialized error, then rethrows", async () => {
    const { records, channel } = makeCapture();
    const app = new Forge();
    app.use("*", requestLogger({ channels: () => [channel] }));
    // Below requestLogger but above the route error boundary — the throw escapes next().
    app.use("*", () => {
      throw new Error("middleware exploded");
    });
    mapHandler(app, "GET", "/boom", () => new Response("unreached"));

    await app.request("/boom").catch(() => undefined);

    expect(records).toHaveLength(1);
    const rec = records[0]!;
    expect(rec.level).toBe("error");
    expect(rec.message).toBe("GET /boom");
    const error = rec.data?.error as { name: string; message: string; stack?: string };
    expect(error.name).toBe("Error");
    expect(error.message).toBe("middleware exploded");
    expect(typeof error.stack).toBe("string");
    expect("status" in (rec.data ?? {})).toBe(false);
  });
});

describe("requestLogger — minLevel", () => {
  it("a static minLevel drops records below it, including the info summary", async () => {
    const { records, channel } = makeCapture();
    const app = new Forge();
    app.use("*", requestLogger({ channels: () => [channel], minLevel: "warn" }));
    mapHandler(app, "GET", "/test", (c) => {
      const log = requestLog.get(c);
      log.info("dropped");
      log.warn("kept");
      return new Response("ok");
    });

    await app.request("/test");

    // "dropped" and the info-level 200 summary are filtered; only the explicit warn survives
    expect(records).toHaveLength(1);
    expect(records[0]!.message).toBe("kept");
  });

  it("a minLevel resolver is called per request and applies its result", async () => {
    const { records, channel } = makeCapture();
    const app = new Forge();
    app.use("*", requestLogger({ channels: () => [channel], minLevel: (c) => (c.request.headers.get("x-quiet") ? "error" : undefined) }));
    mapHandler(app, "GET", "/test", (c) => {
      requestLog.get(c).info("handler ran");
      return new Response("ok");
    });

    await app.request("/test", { headers: { "x-quiet": "1" } });
    expect(records).toHaveLength(0);

    await app.request("/test");
    // resolver returned undefined → no filtering: handler record + summary
    expect(records).toHaveLength(2);
  });
});
