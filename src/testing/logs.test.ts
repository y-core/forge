import { afterEach, beforeEach, describe, expect, it, setSystemTime, spyOn } from "bun:test";

import { createApp } from "../app/app";
import { applyMiddlewareChain } from "../app/middleware-chain";
import { consoleChannel } from "../logging/channels";
import { LOG_REDACTED } from "../logging/log-clone";
import { createLogger } from "../logging/logger";
import type { LogChannel } from "../logging/types";
import { captureLogs, quietChannel } from "./logs";
import { mapHandler } from "./route";

describe("captureLogs", () => {
  it("records what the logger wrote, redacted by the default policy", () => {
    const capture = captureLogs();

    capture.logger.warn("signed in", { user: "jane", password: "hunter2" });

    expect(capture.records.map(({ level, message, data }) => ({ level, message, data }))).toStrictEqual([
      { level: "warn", message: "signed in", data: { user: "jane", password: LOG_REDACTED } },
    ]);
  });

  it("collects a child's records in the same list", () => {
    const capture = captureLogs();

    capture.logger.child({ source: "action" }).error("Action threw");

    expect(capture.records.map(({ message, data }) => ({ message, data }))).toStrictEqual([
      { message: "Action threw", data: { source: "action" } },
    ]);
  });

  it("collects a record written straight to its channel", async () => {
    const capture = captureLogs();

    await capture.channel.write({ level: "info", prefix: "other", message: "hello", timestamp: "2026-11-22T00:00:00.000Z" });

    expect(capture.records.map(({ prefix, message }) => ({ prefix, message }))).toStrictEqual([{ prefix: "other", message: "hello" }]);
  });
});

describe("quietChannel", () => {
  it("drops a record without keeping or returning anything", () => {
    const channel = quietChannel();

    expect(channel.write({ level: "error", prefix: "test", message: "dropped", timestamp: "2026-11-24T00:00:00.000Z" })).toBeUndefined();
    expect(channel.read).toBeUndefined();
  });

  it("serves as a logger's channel, children and flush included", async () => {
    const logger = createLogger("test", { channels: [quietChannel()] });

    logger.child({ source: "action" }).error("Action threw");

    await expect(logger.flush()).resolves.toBeUndefined();
  });
});

describe("an app's composition root taking its log channels", () => {
  const NOW = "2026-11-24T09:00:00.000Z";
  const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"] as const;
  let emitted: unknown[][];
  let restore: (() => void)[];

  beforeEach(() => {
    setSystemTime(new Date(NOW));
    emitted = [];
    restore = [
      ...CONSOLE_METHODS.map((method) => spyOn(console, method).mockImplementation((...args: unknown[]) => void emitted.push(args))),
      spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => (emitted.push([chunk]), true)),
    ].map((spy) => () => spy.mockRestore());
  });

  afterEach(() => {
    for (const undo of restore) undo();
    setSystemTime();
  });

  function buildApp(logChannels: () => LogChannel[] = () => [consoleChannel()]) {
    return createApp({
      middleware: (app) => applyMiddlewareChain(app, { logging: { channels: logChannels }, securityHeaders: {} }),
      routes: (app) => mapHandler(app, "GET", "/orders", () => new Response("orders")),
    });
  }

  it("writes the request's record to the console with its default channels", async () => {
    const res = await buildApp().request("/orders");

    expect(res.status).toBe(200);
    expect(emitted.map(([line]) => JSON.parse(String(line)))).toStrictEqual([
      {
        method: "GET",
        path: "/orders",
        routePattern: "/orders",
        status: 200,
        duration: 0,
        level: "info",
        prefix: "request",
        message: "request.completed",
        timestamp: NOW,
      },
    ]);
  });

  it("emits nothing on the console or stdout during a request when given quietChannel()", async () => {
    const res = await buildApp(() => [quietChannel()]).request("/orders");

    expect({ status: res.status, body: await res.text() }).toStrictEqual({ status: 200, body: "orders" });
    expect(emitted).toStrictEqual([]);
  });

  it("collects the request's record and emits nothing when given captureLogs().channel", async () => {
    const capture = captureLogs();

    await buildApp(() => [capture.channel]).request("/orders");

    expect(capture.records).toStrictEqual([
      {
        level: "info",
        prefix: "request",
        message: "request.completed",
        timestamp: NOW,
        data: { method: "GET", path: "/orders", routePattern: "/orders", status: 200, duration: 0 },
      },
    ]);
    expect(emitted).toStrictEqual([]);
  });
});
