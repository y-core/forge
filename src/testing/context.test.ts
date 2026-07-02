import { describe, expect, it } from "bun:test";
import { getAppContext } from "../context/types";
import { requestLog } from "../logging/request-logger";
import { createTestContext, mockExecutionContext, nullLogger } from "./context";

describe("createTestContext", () => {
  it("satisfies getAppContext without throwing", () => {
    const c = createTestContext(new Request("http://test/"));
    expect(() => getAppContext(c)).not.toThrow();
  });

  it("exposes env, executionCtx, and config as context properties", () => {
    const c = createTestContext<{ API_KEY: string }, { debug: boolean }>(new Request("http://test/"), {
      env: { API_KEY: "k-123" },
      config: { debug: true },
    });
    expect(c.env.API_KEY).toBe("k-123");
    expect(c.config).toEqual({ debug: true });
    expect(typeof c.executionCtx.waitUntil).toBe("function");
  });

  it("installs the request logger (nullLogger by default)", () => {
    const c = createTestContext(new Request("http://test/"));
    expect(requestLog.get(c)).toBe(nullLogger);
  });

  it("accepts a custom logger and execution context", () => {
    const recorded: string[] = [];
    const logger = { ...nullLogger, info: (msg: string) => recorded.push(msg) };
    const ctx = mockExecutionContext();
    const c = createTestContext(new Request("http://test/"), { logger, executionCtx: ctx });
    requestLog.get(c).info("hello");
    expect(recorded).toEqual(["hello"]);
    expect(c.executionCtx).toBe(ctx);
  });

  it("defaults env to an empty object", () => {
    const c = createTestContext(new Request("http://test/"));
    expect(c.env).toEqual({});
  });
});

describe("mockExecutionContext", () => {
  it("waitUntil and passThroughOnException are callable no-ops", () => {
    const ctx = mockExecutionContext();
    expect(() => ctx.waitUntil(Promise.resolve())).not.toThrow();
    expect(() => ctx.passThroughOnException()).not.toThrow();
  });
});

describe("nullLogger", () => {
  it("drops records, flushes immediately, and child() returns itself", async () => {
    expect(() => nullLogger.error("dropped")).not.toThrow();
    await nullLogger.flush();
    expect(nullLogger.child({ requestId: "x" })).toBe(nullLogger);
  });
});
