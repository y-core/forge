import { describe, expect, it } from "bun:test";
import { v } from "../validation/mod";
import { validateEnv } from "./env";

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
