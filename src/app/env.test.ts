import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { v } from "../validation/mod";
import { validateBindings, validateEnv } from "./env";

const schema = v.object({
  DATABASE_URL: v.string(),
  PORT: v.optional(v.pipe(v.string(), v.transform(Number))),
});

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
    const app = new Hono<{ Bindings: { DATABASE_URL: string } }>();
    app.use("*", validateBindings(simpleSchema));
    app.get("/", (c) => c.text(c.env.DATABASE_URL));
    const res = await app.request("/", {}, { DATABASE_URL: "postgres://test/db" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("postgres://test/db");
  });

  it("returns 500 when env is invalid (handler is never reached)", async () => {
    const app = new Hono();
    app.onError((err, c) => c.text(err.message, 500));
    app.use("*", validateBindings(simpleSchema));
    let handlerReached = false;
    app.get("/", (c) => {
      handlerReached = true;
      return c.text("ok");
    });
    const res = await app.request("/", {}, {});
    expect(res.status).toBe(500);
    expect(handlerReached).toBe(false);
  });

  it("re-validates when env reference changes", async () => {
    const app = new Hono<{ Bindings: { DATABASE_URL: string } }>();
    app.use("*", validateBindings(simpleSchema));
    app.get("/", (c) => c.text(c.env.DATABASE_URL));

    const res1 = await app.request("/", {}, { DATABASE_URL: "first" });
    expect(await res1.text()).toBe("first");

    const res2 = await app.request("/", {}, { DATABASE_URL: "second" });
    expect(await res2.text()).toBe("second");
  });

  it("does not set any context variables", async () => {
    const app = new Hono<{ Bindings: { DATABASE_URL: string } }>();
    app.use("*", validateBindings(simpleSchema));
    let bindingsValue: unknown = "not-set";
    app.get("/", (c) => {
      // biome-ignore lint/suspicious/noExplicitAny: intentional — verifying the key was never set
      bindingsValue = (c as any).get("bindings");
      return c.text("ok");
    });
    await app.request("/", {}, { DATABASE_URL: "postgres://test/db" });
    expect(bindingsValue).toBeUndefined();
  });
});
