import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { Mock } from "bun:test";

import type { Middleware } from "@remix-run/fetch-router";

import { serializeError } from "../logging/serialize-error";
import type { LogChannel, Logger, LogRecord } from "../logging/types";
import { requestIdCtx } from "../security/request-id";
import { collectExecutionContext } from "../testing/context";
import { captureLogs, quietChannel } from "../testing/logs";
import { mapHandler } from "../testing/route";
import { createApp } from "./app";
import { createErrorPage } from "./error-page";
import { applyMiddlewareChain } from "./middleware-chain";
import type { AppOptions } from "./types";

let consoleLog: Mock<typeof console.log>;
let consoleError: Mock<typeof console.error>;

beforeEach(() => {
  consoleLog = spyOn(console, "log").mockImplementation(() => {});
  consoleError = spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleLog.mockRestore();
  consoleError.mockRestore();
});

function chainedApp(channel: LogChannel, options: Pick<AppOptions, "onError" | "logger"> = {}, before: Middleware[] = []) {
  const app = createApp({
    ...options,
    middleware: (forge) =>
      applyMiddlewareChain(forge, {
        securityHeaders: {},
        before,
        logging: { channels: () => [channel], bindings: (c) => ({ requestId: requestIdCtx.getOptional(c) }) },
      }),
  });
  mapHandler(app, "GET", "/boom", () => {
    throw new Error("handler exploded");
  });
  return app;
}

const errorRecords = (records: readonly LogRecord[]): LogRecord[] =>
  records.filter((record) => record.level === "error" && record.message !== "request.completed");

describe("Forge — app records under a chain's logging channels", () => {
  it("writes one Unhandled error record, carrying the requestId, to the chain's channel and nothing to the console", async () => {
    const capture = captureLogs();

    const res = await chainedApp(capture.channel).request("/boom");

    const records = errorRecords(capture.records);
    expect(records.map((record) => record.message)).toStrictEqual(["Unhandled error"]);
    expect(records[0]!.data).toMatchObject({ source: "app", requestId: res.headers.get("x-request-id"), error: { detail: "handler exploded" } });
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("writes a throwing onError override's record to the chain's channel", async () => {
    const capture = captureLogs();
    const app = chainedApp(capture.channel, {
      onError: () => {
        throw new Error("override exploded");
      },
    });

    await app.request("/boom");

    const records = errorRecords(capture.records);
    expect(records.map((record) => record.message)).toStrictEqual(["Unhandled error", "onError override threw"]);
    expect(records[1]!.data).toMatchObject({ error: { detail: "override exploded" }, original: { detail: "handler exploded" } });
    expect(consoleLog).not.toHaveBeenCalled();
  });

  it("prints nothing under quietChannel()", async () => {
    const app = chainedApp(quietChannel(), {
      onError: () => {
        throw new Error("override exploded");
      },
    });

    const res = await app.request("/boom");

    expect(res.status).toBe(500);
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("leaves createApp's logger silent while a request logger exists", async () => {
    const fallback = captureLogs();

    await chainedApp(quietChannel(), { logger: fallback.logger }).request("/boom");

    expect(fallback.records).toStrictEqual([]);
  });

  it("sends a throw from before requestLogger runs to createApp's logger", async () => {
    const capture = captureLogs();
    const fallback = captureLogs();
    const throwsEarly: Middleware = () => {
      throw new Error("early exploded");
    };

    await chainedApp(capture.channel, { logger: fallback.logger }, [throwsEarly]).request("/boom");

    expect(capture.records).toStrictEqual([]);
    expect(fallback.records.map((record) => record.message)).toStrictEqual(["Unhandled error"]);
    expect(fallback.records[0]!.data).toMatchObject({ error: { detail: "early exploded" } });
  });
});

describe("Forge — app records without request logging", () => {
  it("writes both records to createApp's logger", async () => {
    const fallback = captureLogs();
    const app = createApp({
      logger: fallback.logger,
      onError: () => {
        throw new Error("override exploded");
      },
    });
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("handler exploded");
    });

    await app.request("/boom");

    expect(fallback.records.map((record) => record.message)).toStrictEqual(["Unhandled error", "onError override threw"]);
  });

  it("defaults to a console logger prefixed app", async () => {
    const app = createApp();
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("handler exploded");
    });

    await app.request("/boom");

    const printed = consoleLog.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
    expect(printed.map(({ prefix, message }) => ({ prefix, message }))).toStrictEqual([{ prefix: "app", message: "Unhandled error" }]);
  });
});

interface LogEnv {
  LOGS: LogChannel;
}

function envChannelApp(options: Pick<AppOptions<LogEnv>, "onError" | "logger"> = {}, globals: Middleware[] = []) {
  const app = createApp<LogEnv>({
    ...options,
    middleware: (forge) =>
      applyMiddlewareChain<LogEnv>(forge, {
        securityHeaders: {},
        globals,
        logging: { channels: (c) => [c.env.LOGS], bindings: (c) => ({ requestId: requestIdCtx.getOptional(c) }) },
      }),
  });
  mapHandler(app, "GET", "/boom/:id", () => {
    throw new Error("handler exploded");
  });
  mapHandler(app, "GET", "/string", () => {
    throw "a bare string";
  });
  mapHandler(app, "GET", "/ok", () => new Response("ok"));
  return app;
}

function countingLogger(): { logger: Logger; flushes: () => number; records: string[] } {
  let flushes = 0;
  const records: string[] = [];
  const logger: Logger = {
    debug: (message) => void records.push(message),
    info: (message) => void records.push(message),
    warn: (message) => void records.push(message),
    error: (message) => void records.push(message),
    flush: async () => {
      flushes += 1;
    },
    child: () => logger,
  };
  return { logger, flushes: () => flushes, records };
}

function delayedChannel(records: LogRecord[]): LogChannel {
  return {
    write: async (record) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      records.push(record);
    },
  };
}

const throwsAfterRequestLogger: Middleware = () => {
  throw new Error("middleware exploded");
};

const messages = (records: readonly LogRecord[]) => records.map(({ level, message }) => ({ level, message }));

describe("Forge — app records under channels built from env", () => {
  it("lands both app records in the channel the request's env supplies, with nothing on the console", async () => {
    const capture = captureLogs();
    const app = envChannelApp({
      onError: () => {
        throw new Error("override exploded");
      },
    });

    const res = await app.request("/boom/1", {}, { LOGS: capture.channel });

    expect(res.status).toBe(500);
    expect(errorRecords(capture.records).map((record) => record.message)).toStrictEqual(["Unhandled error", "onError override threw"]);
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("routes each request's record to that request's env channel only", async () => {
    const first = captureLogs();
    const second = captureLogs();
    const app = envChannelApp();

    await app.request("/boom/1", {}, { LOGS: first.channel });
    await app.request("/ok", {}, { LOGS: second.channel });

    expect(errorRecords(first.records).map((record) => record.message)).toStrictEqual(["Unhandled error"]);
    expect(errorRecords(second.records)).toStrictEqual([]);
  });

  it("writes exactly one Unhandled error across the chain's channel and createApp's logger", async () => {
    const capture = captureLogs();
    const fallback = captureLogs();

    await envChannelApp({ logger: fallback.logger }).request("/boom/1", {}, { LOGS: capture.channel });

    const unhandled = [...capture.records, ...fallback.records].filter((record) => record.message.toLowerCase() === "unhandled error");
    expect(unhandled).toHaveLength(1);
    expect(fallback.records).toStrictEqual([]);
  });

  it("serves an onError override's Response and still writes one Unhandled error record", async () => {
    const capture = captureLogs();
    const app = envChannelApp({ onError: () => new Response("custom page", { status: 503 }) });

    const res = await app.request("/boom/1", {}, { LOGS: capture.channel });

    expect(res.status).toBe(503);
    expect(await res.text()).toBe("custom page");
    expect(messages(capture.records)).toStrictEqual([
      { level: "error", message: "Unhandled error" },
      { level: "error", message: "request.completed" },
    ]);
  });

  it("writes exactly one error-level record carrying the serialized error under onError: createErrorPage()", async () => {
    const capture = captureLogs();
    const errorPage = createErrorPage<LogEnv>();
    let thrown: Error | undefined;
    const app = envChannelApp({ onError: (err, c) => ((thrown = err), errorPage(err, c)) });

    const res = await app.request("/boom/1", {}, { LOGS: capture.channel });

    expect(res.status).toBe(500);
    const records = errorRecords(capture.records);
    expect(records.map((record) => record.message)).toStrictEqual(["Unhandled error"]);
    expect(records[0]!.data!["error"]).toStrictEqual(serializeError(thrown));
  });
});

describe("Forge — the Unhandled error record's fields", () => {
  it("carries the request logger's prefix, the requestId of its summary, source app and the serialized error", async () => {
    const capture = captureLogs();

    const res = await envChannelApp().request("/boom/7", {}, { LOGS: capture.channel });

    const requestId = res.headers.get("x-request-id");
    expect(requestId).toMatch(/\S/);
    expect(capture.records).toStrictEqual([
      {
        level: "error",
        prefix: "request",
        message: "Unhandled error",
        timestamp: expect.any(String),
        data: { requestId, source: "app", error: { type: "Error", detail: "handler exploded", stack: expect.any(String) } },
      },
      {
        level: "error",
        prefix: "request",
        message: "request.completed",
        timestamp: expect.any(String),
        data: { requestId, method: "GET", path: "/boom/7", routePattern: "/boom/:id", status: 500, duration: expect.any(Number) },
      },
    ]);
  });

  it("carries the same fields when an onError override serves the Response", async () => {
    const capture = captureLogs();

    const res = await envChannelApp({ onError: () => new Response("custom page", { status: 503 }) }).request(
      "/boom/7",
      {},
      { LOGS: capture.channel },
    );

    const requestId = res.headers.get("x-request-id");
    expect(requestId).toMatch(/\S/);
    expect(capture.records).toStrictEqual([
      {
        level: "error",
        prefix: "request",
        message: "Unhandled error",
        timestamp: expect.any(String),
        data: { requestId, source: "app", error: { type: "Error", detail: "handler exploded", stack: expect.any(String) } },
      },
      {
        level: "error",
        prefix: "request",
        message: "request.completed",
        timestamp: expect.any(String),
        data: { requestId, method: "GET", path: "/boom/7", routePattern: "/boom/:id", status: 503, duration: expect.any(Number) },
      },
    ]);
  });

  it("serializes a thrown non-Error value's text into data.error.detail", async () => {
    const capture = captureLogs();

    await envChannelApp().request("/string", {}, { LOGS: capture.channel });

    const records = errorRecords(capture.records);
    expect(records.map((record) => record.message)).toStrictEqual(["Unhandled error"]);
    expect(records[0]!.data).toMatchObject({ source: "app", error: { detail: "a bare string" } });
  });
});

describe("Forge — a route handler's throw against a throw from middleware after requestLogger", () => {
  it("records a handler throw as Unhandled error followed by a request.completed summary at 500", async () => {
    const capture = captureLogs();

    await envChannelApp().request("/boom/1", {}, { LOGS: capture.channel });

    expect(messages(capture.records)).toStrictEqual([
      { level: "error", message: "Unhandled error" },
      { level: "error", message: "request.completed" },
    ]);
  });

  it("records a middleware throw as request.failed followed by one Unhandled error on the same logger", async () => {
    const capture = captureLogs();
    const fallback = captureLogs();

    const res = await envChannelApp({ logger: fallback.logger }, [throwsAfterRequestLogger]).request("/ok", {}, { LOGS: capture.channel });

    expect(res.status).toBe(500);
    expect(messages(capture.records)).toStrictEqual([
      { level: "error", message: "request.failed" },
      { level: "error", message: "Unhandled error" },
    ]);
    const [failed, unhandled] = capture.records;
    expect(unhandled!.data).toMatchObject({ source: "app", requestId: failed!.data!["requestId"], error: { detail: "middleware exploded" } });
    expect(fallback.records).toStrictEqual([]);
  });
});

describe("Forge — flushing the logger that took the app record", () => {
  it("never flushes createApp's logger while a request logger takes the record", async () => {
    const fallback = countingLogger();

    await envChannelApp({ logger: fallback.logger }, [throwsAfterRequestLogger]).request("/ok", {}, { LOGS: quietChannel() });

    expect(fallback.flushes()).toBe(0);
    expect(fallback.records).toStrictEqual([]);
  });

  it("flushes createApp's logger once when it is the one that took the record", async () => {
    const fallback = countingLogger();
    const app = createApp({ logger: fallback.logger });
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("handler exploded");
    });

    await app.request("/boom");

    expect(fallback.records).toStrictEqual(["Unhandled error"]);
    expect(fallback.flushes()).toBe(1);
  });

  it("flushes createApp's logger once when an onError override serves the Response", async () => {
    const fallback = countingLogger();
    const app = createApp({ logger: fallback.logger, onError: () => new Response("custom page", { status: 503 }) });
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("handler exploded");
    });

    const res = await app.request("/boom");

    expect({ status: res.status, records: fallback.records, flushes: fallback.flushes() }).toStrictEqual({
      status: 503,
      records: ["Unhandled error"],
      flushes: 1,
    });
  });

  it("flushes createApp's logger once, after both records, when the onError override throws", async () => {
    const fallback = countingLogger();
    const app = createApp({
      logger: fallback.logger,
      onError: () => {
        throw new Error("override exploded");
      },
    });
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("handler exploded");
    });

    const res = await app.request("/boom");

    expect({ status: res.status, records: fallback.records, flushes: fallback.flushes() }).toStrictEqual({
      status: 500,
      records: ["Unhandled error", "onError override threw"],
      flushes: 1,
    });
  });

  it("hands waitUntil a flush covering an Unhandled error written after requestLogger's own flush", async () => {
    const records: LogRecord[] = [];
    const app = envChannelApp({}, [throwsAfterRequestLogger]);
    const collected = collectExecutionContext();

    await app.fetch(new Request("http://test/ok"), { LOGS: delayedChannel(records) }, collected.executionCtx);
    await collected.drain();

    expect(records.map((record) => record.message)).toStrictEqual(["request.failed", "Unhandled error"]);
  });

  it("awaits the flush inline when waitUntil throws", async () => {
    const records: LogRecord[] = [];
    const app = envChannelApp({}, [throwsAfterRequestLogger]);
    const refusing = {
      waitUntil: () => {
        throw new Error("waitUntil unavailable");
      },
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;

    const res = await app.fetch(new Request("http://test/ok"), { LOGS: delayedChannel(records) }, refusing);

    expect(res.status).toBe(500);
    expect(records.map((record) => record.message)).toStrictEqual(["request.failed", "Unhandled error"]);
  });
});
