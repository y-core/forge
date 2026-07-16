import { describe, expect, it } from "bun:test";
import { parseEnv } from "./parse-env";
import { v } from "./validation";

const schema = v.object({ DATABASE_URL: v.string(), PORT: v.optional(v.pipe(v.string(), v.transform(Number))) });

describe("parseEnv", () => {
  it("returns the parsed output when valid", () => {
    const out = parseEnv(schema, { DATABASE_URL: "postgres://localhost/db" });
    expect(out.DATABASE_URL).toBe("postgres://localhost/db");
  });

  it("applies schema transforms to the parsed output", () => {
    const out = parseEnv(schema, { DATABASE_URL: "postgres://localhost/db", PORT: "8080" });
    expect(out.PORT).toBe(8080);
  });

  it("succeeds when an optional field is absent", () => {
    const out = parseEnv(schema, { DATABASE_URL: "postgres://localhost/db" });
    expect(out.PORT).toBeUndefined();
  });

  it("throws the exact normalized message when a required field is missing", () => {
    expect(() => parseEnv(schema, {})).toThrow(
      new Error('Invalid environment: DATABASE_URL: Invalid key: Expected "DATABASE_URL" but received undefined'),
    );
  });

  it("throws the exact normalized message when a field has the wrong type", () => {
    expect(() => parseEnv(schema, { DATABASE_URL: 123 })).toThrow(
      new Error("Invalid environment: DATABASE_URL: Invalid type: Expected string but received 123"),
    );
  });
});
