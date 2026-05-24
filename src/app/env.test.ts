import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { v } from "../validation/mod";
import { resolveBindings, type ValidatedEnv, validateEnv } from "./env";

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

describe("resolveBindings", () => {
  const simpleSchema = v.object({ DATABASE_URL: v.string() });
  type SimpleEnv = { DATABASE_URL: string };

  it("makes the validated env available via c.get('bindings')", async () => {
    const app = new Hono<ValidatedEnv<SimpleEnv>>();
    app.use("*", resolveBindings(simpleSchema));
    app.get("/", (c) => c.text(c.get("bindings").DATABASE_URL));
    const res = await app.request("/", {}, { DATABASE_URL: "postgres://test/db" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("postgres://test/db");
  });

  it("applies valibot transformations — c.get('bindings') reflects schema output, not raw env", async () => {
    const transformSchema = v.object({
      DATABASE_URL: v.string(),
      PORT: v.optional(v.pipe(v.string(), v.transform(Number))),
    });
    type Parsed = { DATABASE_URL: string; PORT?: number };
    const app = new Hono<ValidatedEnv<Parsed>>();
    app.use("*", resolveBindings(transformSchema));
    app.get("/", (c) => c.text(String(typeof c.get("bindings").PORT)));
    const res = await app.request("/", {}, { DATABASE_URL: "x", PORT: "8080" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("number");
  });
});
