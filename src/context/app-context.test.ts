import { describe, expect, it } from "bun:test";
import { RequestContext } from "@remix-run/fetch-router";
import { EnvKey, ExecutionContextKey, getAppContext } from "./types";

function makeCtx() {
  return new RequestContext(new Request("http://localhost/"));
}

describe("getAppContext", () => {
  it("returns the context with env once per-request state has been injected", () => {
    const c = makeCtx();
    const env = { CSRF_SECRET: "x" };
    c.set(EnvKey, env, { property: "env" });
    c.set(ExecutionContextKey, {} as ExecutionContext, { property: "executionCtx" });

    const app = getAppContext<{ CSRF_SECRET: string }>(c);
    expect(app.env).toBe(env);
    expect(app.env.CSRF_SECRET).toBe("x");
  });

  it("treats empty bindings as present (env is {}, not missing)", () => {
    const c = makeCtx();
    c.set(EnvKey, {}, { property: "env" });
    expect(() => getAppContext(c)).not.toThrow();
  });

  it("throws a clear error when per-request state was never injected", () => {
    const c = makeCtx();
    expect(() => getAppContext(c)).toThrow("per-request state is not available");
  });
});
