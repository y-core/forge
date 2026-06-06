import { describe, expect, it } from "bun:test";
import type { AppContext } from "../context/types";
import { v } from "../validation/mod";
import { validateBindings, validateEnv } from "./env";
import { Forge } from "./forge-app";
import { mapHandler } from "./route-test-helper";

const schema = v.object({ DATABASE_URL: v.string(), PORT: v.optional(v.pipe(v.string(), v.transform(Number))) });

describe("validateEnv", () => {
  it("returns parsed env when valid", () => {
    const result = validateEnv({ DATABASE_URL: "postgres://localhost/db" }, schema);
    expect(result.DATABASE_URL).toBe("postgres://localhost/db");
  });

  it("throws when a required field is missing", () => {
    expect(() => validateEnv({}, schema)).toThrow("Invalid environment");
  });

  it("throws with the field name in the error message", () => {
    expect(() => validateEnv({}, schema)).toThrow("DATABASE_URL");
  });

  it("succeeds when an optional field is absent", () => {
    const result = validateEnv({ DATABASE_URL: "postgres://localhost/db" }, schema);
    expect(result.PORT).toBeUndefined();
  });
});

describe("validateBindings", () => {
  const simpleSchema = v.object({ DATABASE_URL: v.string() });

  it("calls next() when env is valid", async () => {
    const app = new Forge<{ DATABASE_URL: string }>();
    app.use("*", validateBindings(simpleSchema));
    mapHandler(app, "GET", "/", (c) => new Response((c as AppContext<{ DATABASE_URL: string }>).env.DATABASE_URL));
    const res = await app.request("/", {}, { DATABASE_URL: "postgres://test/db" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("postgres://test/db");
  });

  it("returns 500 when env is invalid (handler is never reached)", async () => {
    const app = new Forge();
    app.setOnError((err) => new Response(err.message, { status: 500 }));
    app.use("*", validateBindings(simpleSchema));
    let handlerReached = false;
    mapHandler(app, "GET", "/", () => {
      handlerReached = true;
      return new Response("ok");
    });
    const res = await app.request("/", {}, {});
    expect(res.status).toBe(500);
    expect(handlerReached).toBe(false);
  });

  it("re-validates when env reference changes", async () => {
    const app = new Forge<{ DATABASE_URL: string }>();
    app.use("*", validateBindings(simpleSchema));
    mapHandler(app, "GET", "/", (c) => new Response((c as AppContext<{ DATABASE_URL: string }>).env.DATABASE_URL));

    const res1 = await app.request("/", {}, { DATABASE_URL: "first" });
    expect(await res1.text()).toBe("first");

    const res2 = await app.request("/", {}, { DATABASE_URL: "second" });
    expect(await res2.text()).toBe("second");
  });

  it("does not set any extra context properties beyond env and executionCtx", async () => {
    const app = new Forge<{ DATABASE_URL: string }>();
    app.use("*", validateBindings(simpleSchema));
    let hasBindingsKey = false;
    mapHandler(app, "GET", "/", (c) => {
      // validateBindings must not install a "bindings" property — env is accessed directly
      // biome-ignore lint/suspicious/noExplicitAny: intentional — verifying no extra property
      hasBindingsKey = "bindings" in (c as any);
      return new Response("ok");
    });
    await app.request("/", {}, { DATABASE_URL: "postgres://test/db" });
    expect(hasBindingsKey).toBe(false);
  });
});
