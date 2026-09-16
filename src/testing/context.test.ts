import { describe, expect, it } from "bun:test";

import { getAppContext, RequestContext } from "../context/types";
import { requestLog } from "../logging/request-logger";
import { createTestContext, mockExecutionContext, nullLogger } from "./context";

describe("createTestContext", () => {
  it("is accepted by the production accessor, which reads back every injection", () => {
    const executionCtx = mockExecutionContext();
    const context = createTestContext<{ API_KEY: string }, { debug: boolean }>(new Request("http://test/"), {
      env: { API_KEY: "k-123" },
      config: { debug: true },
      executionCtx,
    });

    const app = getAppContext<{ API_KEY: string }, Record<string, string>, { debug: boolean }>(context);
    expect(app.env).toEqual({ API_KEY: "k-123" });
    expect(app.config).toEqual({ debug: true });
    expect(app.executionCtx).toBe(executionCtx);
  });

  it("is what the accessor is reading, since a context nobody injected into is refused", () => {
    expect(() => getAppContext(new RequestContext(new Request("http://test/")))).toThrow("per-request state is not available");
  });

  it("installs the request logger a handler reaches, defaulting to the one that drops records", () => {
    expect(requestLog.get(createTestContext(new Request("http://test/")))).toBe(nullLogger);
  });

  it("routes a handler's records to a supplied logger instead", () => {
    const recorded: string[] = [];
    const logger = { ...nullLogger, info: (msg: string) => recorded.push(msg) };

    requestLog.get(createTestContext(new Request("http://test/"), { logger })).info("hello");
    expect(recorded).toEqual(["hello"]);
  });

  it("defaults env to an empty object, so a missing-binding case is testable without constructing one", () => {
    expect(createTestContext(new Request("http://test/")).env).toEqual({});
  });
});

describe("mockExecutionContext", () => {
  it("answers both members production calls, returning nothing from either", () => {
    const ctx = mockExecutionContext();

    expect(ctx.waitUntil(Promise.resolve())).toBeUndefined();
    expect(ctx.passThroughOnException()).toBeUndefined();
  });

  it("hands out a fresh context per call, so no state one test parks on it reaches the next", () => {
    expect(mockExecutionContext()).not.toBe(mockExecutionContext());
  });
});

describe("nullLogger", () => {
  it("drops a record at every level rather than buffering one for flush to emit", async () => {
    for (const level of ["debug", "info", "warn", "error"] as const) expect(nullLogger[level]("dropped")).toBeUndefined();

    await expect(nullLogger.flush()).resolves.toBeUndefined();
  });

  it("returns itself from child() at any depth, so a per-request child never reaches a second sink", () => {
    expect(nullLogger.child({ requestId: "x" }).child({ route: "/y" })).toBe(nullLogger);
  });
});
