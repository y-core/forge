import { describe, expect, it } from "bun:test";

import { createTestContext, mockExecutionContext } from "../testing/context";
import { ConfigKey, EnvKey, ExecutionContextKey, getAppContext, RequestContext } from "./types";

const MISSING_STATE =
  "getAppContext: per-request state is not available — the Forge router must inject request state (provideRequestState) before this handler runs.";

const request = (): Request => new Request("http://test/x");

describe("context keys", () => {
  it("are three distinct keys, so one binding can never be read through another", () => {
    const keys = [EnvKey, ExecutionContextKey, ConfigKey];
    expect(new Set(keys).size).toBe(3);
  });

  it("store and read back independently on one context", () => {
    const c = new RequestContext(request());
    const executionCtx = mockExecutionContext();
    c.set(EnvKey, { API: "k" });
    c.set(ExecutionContextKey, executionCtx);
    c.set(ConfigKey, { mode: "test" });
    expect(c.get(EnvKey)).toEqual({ API: "k" });
    expect(c.get(ExecutionContextKey)).toBe(executionCtx);
    expect(c.get(ConfigKey)).toEqual({ mode: "test" });
  });
});

describe("getAppContext", () => {
  it("returns the very same context object, narrowed rather than copied", () => {
    const c = createTestContext(request(), { env: { API: "k" } });
    expect(getAppContext(c)).toBe(c);
  });

  it("exposes env, executionCtx and config as properties", () => {
    const executionCtx = mockExecutionContext();
    const c = getAppContext<{ API: string }, Record<string, string>, { mode: string }>(
      createTestContext(request(), { env: { API: "k" }, executionCtx, config: { mode: "test" } }),
    );
    expect(c.env).toEqual({ API: "k" });
    expect(c.executionCtx).toBe(executionCtx);
    expect(c.config).toEqual({ mode: "test" });
  });

  it("throws when no per-request state was injected at all", () => {
    expect(() => getAppContext(new RequestContext(request()))).toThrow(MISSING_STATE);
  });

  it("throws when env was set explicitly to undefined", () => {
    const c = new RequestContext(request());
    c.set(EnvKey, undefined);
    expect(() => getAppContext(c)).toThrow(MISSING_STATE);
  });

  it("accepts an empty bindings object — a Worker with no bindings is still routed state", () => {
    const c = new RequestContext(request());
    c.set(EnvKey, {}, { property: "env" });
    expect(getAppContext(c).env).toEqual({});
  });

  it("throws when only executionCtx and config were injected", () => {
    const c = new RequestContext(request());
    c.set(ExecutionContextKey, mockExecutionContext());
    c.set(ConfigKey, { mode: "test" });
    expect(() => getAppContext(c)).toThrow(MISSING_STATE);
  });
});
