import { describe, expect, it } from "bun:test";
import { Forge } from "../app/forge-app";
import { mapHandler } from "../app/route-test-helper";
import type { KVNamespace } from "../storage/kv/types";
import { withLevels } from "./channels";
import { kvLogChannel } from "./kv-channel";
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

/**
 * A channel that records a write only once it **settles**, the shape a real `kvLogChannel` has.
 *
 * The synchronous `makeCapture` above cannot see a dropped record: it appends before returning, so
 * a write whose promise nobody awaits still shows up. Only a channel that defers the append can
 * distinguish "persisted" from "started and abandoned".
 *
 * Delays escalate per write so the distinction is deterministic rather than a race: with the second
 * write far slower than the first, awaiting only the first flush window provably excludes it.
 */
function makeAsyncCapture(delaysMs: number[] = [1, 30]): { records: LogRecord[]; channel: LogChannel } {
  const records: LogRecord[] = [];
  let writes = 0;
  return {
    records,
    channel: {
      write: (r) => {
        const delay = delaysMs[Math.min(writes++, delaysMs.length - 1)] ?? 1;
        return new Promise<void>((resolve) => {
          setTimeout(() => {
            records.push(r);
            resolve();
          }, delay);
        });
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

  it("a 200 summary carries no error field", async () => {
    const { records, channel } = makeCapture();
    const app = makeStatusApp(channel, 200);

    await app.request("/thing");

    expect(records).toHaveLength(1);
    expect(records[0]!.level).toBe("info");
    expect(Object.keys(records[0]!.data ?? {}).sort()).toStrictEqual(["duration", "method", "path", "status"]);
  });

  it("a throwing handler yields the boundary's serialized-error record and an error-level 500 summary", async () => {
    const { records, channel } = makeCapture();
    const app = new Forge();
    app.use("*", requestLogger({ channels: () => [channel] }));
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("handler exploded");
    });

    const res = await app.request("/boom");

    expect(res.status).toBe(500);
    expect(records).toHaveLength(2);

    // The error boundary runs below requestLogger, so its detail record lands first.
    const detail = records[0]!;
    expect(detail.level).toBe("error");
    expect(detail.message).toBe("unhandled error");
    const error = detail.data?.error as { name: string; message: string; stack?: string };
    expect(error.name).toBe("Error");
    expect(error.message).toBe("handler exploded");
    expect(typeof error.stack).toBe("string");

    const summary = records[1]!;
    expect(summary.level).toBe("error");
    expect(summary.message).toBe("GET /boom");
    expect(summary.data?.status).toBe(500);
  });

  it("the boundary's error record inherits the request bindings, keeping the 500 correlated", async () => {
    const { records, channel } = makeCapture();
    const app = new Forge();
    app.use("*", requestLogger({ channels: () => [channel], bindings: () => ({ requestId: "req-boom-1" }) }));
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("handler exploded");
    });

    await app.request("/boom");

    expect(records.map((r) => r.data?.requestId)).toStrictEqual(["req-boom-1", "req-boom-1"]);
  });

  it("a throw escaping next() emits this middleware's error record, then rethrows for the boundary", async () => {
    const { records, channel } = makeCapture();
    const app = new Forge();
    app.use("*", requestLogger({ channels: () => [channel] }));
    // Below requestLogger but above the route error boundary — the throw escapes next().
    app.use("*", () => {
      throw new Error("middleware exploded");
    });
    mapHandler(app, "GET", "/boom", () => new Response("unreached"));

    await app.request("/boom").catch(() => undefined);

    // This middleware's own record comes first, inside its flush window; the outer boundary then
    // catches the rethrow and appends its own detail record.
    expect(records.map((r) => r.message)).toStrictEqual(["GET /boom", "unhandled error"]);
    const rec = records[0]!;
    expect(rec.level).toBe("error");
    const error = rec.data?.error as { name: string; message: string; stack?: string };
    expect(error.name).toBe("Error");
    expect(error.message).toBe("middleware exploded");
    expect(typeof error.stack).toBe("string");
    expect("status" in (rec.data ?? {})).toBe(false);
  });
});

describe("requestLogger — flush windows under an asynchronous channel", () => {
  function makeGuardThrowApp(channel: LogChannel) {
    const app = new Forge();
    app.use("*", requestLogger({ channels: () => [channel], bindings: () => ({ requestId: "req-async-1" }) }));
    // Below requestLogger but above the route error boundary — the throw escapes next().
    app.use("*", () => {
      throw new Error("middleware exploded");
    });
    mapHandler(app, "GET", "/boom", () => new Response("unreached"));
    return app;
  }

  it("a guard throw persists both records, not just the one inside requestLogger's window", async () => {
    const { records, channel } = makeAsyncCapture();

    const res = await makeGuardThrowApp(channel).request("/boom");

    // `requestLogger`'s `finally` splices the pending buffer, so the boundary's later record was
    // left in a buffer nobody awaited — with a real KV channel it could be lost to isolate
    // teardown. A *dropped* error record is strictly worse than the duplicate this path is known
    // to produce, and only an async channel can observe it.
    expect(res.status).toBe(500);
    expect(records.map((r) => r.message)).toStrictEqual(["GET /boom", "unhandled error"]);
  });

  it("keeps the two records correlated by requestId across the separate flush windows", async () => {
    const { records, channel } = makeAsyncCapture();

    await makeGuardThrowApp(channel).request("/boom");

    expect(records.map((r) => r.data?.requestId)).toStrictEqual(["req-async-1", "req-async-1"]);
  });

  it("the handler-throw path still persists both records", async () => {
    const { records, channel } = makeAsyncCapture();
    const app = new Forge();
    app.use("*", requestLogger({ channels: () => [channel] }));
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("handler exploded");
    });

    const res = await app.request("/boom");

    expect(res.status).toBe(500);
    // The boundary runs below requestLogger here, so its record is written — and now flushed —
    // first; the summary follows in requestLogger's own window.
    expect(records.map((r) => r.message)).toStrictEqual(["unhandled error", "GET /boom"]);
  });
});

describe("requestLogger — a failing channel never changes the request outcome", () => {
  /** The shape a real channel takes when its backing store is unavailable: the write starts and
   *  rejects. Nothing about it is recoverable at the request level, which is the point. */
  const failingChannel: LogChannel = { write: () => Promise.reject(new Error("channel down")) };

  function makeFailingChannelApp() {
    const app = new Forge();
    app.use("*", requestLogger({ channels: () => [failingChannel] }));
    mapHandler(app, "GET", "/test", (c) => {
      requestLog.get(c).info("handler ran");
      return new Response("ok");
    });
    return app;
  }

  it("returns the response unchanged when the flush is handed to waitUntil", async () => {
    const flushed: Promise<void>[] = [];
    const mockCtx: ExecutionContext = {
      waitUntil: (p: Promise<void>) => {
        flushed.push(p);
      },
      passThroughOnException: () => {},
    };

    const res = await makeFailingChannelApp().fetch(new Request("http://localhost/test"), {}, mockCtx);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    // A rejecting promise handed to `waitUntil` is a rejection with nobody attached — the runtime
    // reports it, and nothing about the request is improved by it.
    expect(flushed.length).toBeGreaterThan(0);
    await expect(Promise.all(flushed)).resolves.toBeDefined();
  });

  it("returns the response unchanged on the no-executionCtx fallback branch", async () => {
    // The dangerous branch: `await flush` runs inside a `finally`, and a `finally` that throws
    // replaces whatever was propagating — here, a perfectly good 200.
    const res = await makeFailingChannelApp().request("/test");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("a throw escaping next() reaches the boundary unmasked by the flush failure", async () => {
    const { records, channel } = makeCapture();
    const app = new Forge();
    app.use("*", requestLogger({ channels: () => [channel, failingChannel] }));
    app.use("*", () => {
      throw new Error("middleware exploded");
    });
    mapHandler(app, "GET", "/boom", () => new Response("unreached"));

    const res = await app.request("/boom");

    expect(res.status).toBe(500);
    // The boundary's record is written after `requestLogger`'s `finally` has run, so it carries
    // whichever error actually came out of it — the middleware's, or the flush's had the `finally`
    // replaced it. That substitution is the whole failure mode, and it is silent without this.
    const detail = records.find((r) => r.message === "unhandled error");
    expect((detail?.data?.error as { message: string } | undefined)?.message).toBe("middleware exploded");
  });
});

describe("requestLogger — persisted error detail", () => {
  it("the 500 error record keeps its stack live but not in KV under the persistStack default", async () => {
    const persisted: string[] = [];
    const kv = {
      put: (_key: string, value: string) => {
        persisted.push(value);
        return Promise.resolve();
      },
      list: () => Promise.resolve({ keys: [], list_complete: true }),
    } as unknown as KVNamespace;

    const { records, channel } = makeCapture();
    const app = new Forge();
    app.use("*", requestLogger({ channels: () => [channel, kvLogChannel(kv, { purgeProbability: 0 })] }));
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("handler exploded");
    });

    await app.request("/boom");

    const live = records[0]!.data?.error as { name: string; message: string; stack?: string };
    expect(typeof live.stack).toBe("string");

    const stored = persisted.map((raw) => JSON.parse(raw) as { message: string; data?: { error?: Record<string, unknown> } });
    const storedDetail = stored.find((r) => r.message === "unhandled error");
    expect(storedDetail).toBeDefined();
    expect(storedDetail?.data?.error).toStrictEqual({ name: "Error", message: "handler exploded" });
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

describe("requestLogger — per-channel level allowlists", () => {
  it("a channels factory wrapping in withLevels([]) suppresses every record, response and flush intact", async () => {
    const { records, channel } = makeCapture();
    const flushed: Promise<void>[] = [];
    const mockCtx: ExecutionContext = {
      waitUntil: (p: Promise<void>) => {
        flushed.push(p);
      },
      passThroughOnException: () => {},
    };
    const app = new Forge();
    app.use("*", requestLogger({ channels: () => [withLevels(channel, [])] }));
    mapHandler(app, "GET", "/test", (c) => {
      requestLog.get(c).info("handler ran");
      return new Response("ok");
    });

    const res = await app.fetch(new Request("http://localhost/test"), {}, mockCtx);

    expect(res.status).toBe(200);
    expect(records).toHaveLength(0);
    expect(flushed.length).toBeGreaterThan(0);
    await Promise.all(flushed);
  });

  it("a withLevels(['warn','error']) channel drops a 200 summary and keeps 404 and 500 — the e2e posture", async () => {
    const { records, channel } = makeCapture();
    const app = new Forge();
    app.use("*", requestLogger({ channels: () => [withLevels(channel, ["warn", "error"])] }));
    mapHandler(app, "GET", "/ok", () => new Response("ok"));
    mapHandler(app, "GET", "/missing", () => new Response("nope", { status: 404 }));
    mapHandler(app, "GET", "/boom", () => new Response("bang", { status: 500 }));

    await app.request("/ok");
    expect(records).toHaveLength(0);

    await app.request("/missing");
    await app.request("/boom");

    expect(records.map((r) => [r.level, r.data?.status])).toStrictEqual([
      ["warn", 404],
      ["error", 500],
    ]);
  });
});
