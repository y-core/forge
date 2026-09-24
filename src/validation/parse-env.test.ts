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
    expect(() => parseEnv(schema, {})).toThrow(new Error("Invalid environment: DATABASE_URL: missing"));
  });

  it("throws the exact normalized message when a field has the wrong type", () => {
    expect(() => parseEnv(schema, { DATABASE_URL: 123 })).toThrow(new Error("Invalid environment: DATABASE_URL: string"));
  });

  it("names the failure identically whatever the rejected value's size", () => {
    const secretSchema = v.object({ API_KEY: v.pipe(v.string(), v.regex(/^sk_live_/)) });
    const short = (() => {
      try {
        parseEnv(secretSchema, { API_KEY: "sk_t5" });
      } catch (err) {
        return (err as Error).message;
      }
      throw new Error("expected a rejection");
    })();
    const long = (() => {
      try {
        parseEnv(secretSchema, { API_KEY: `sk_test_${"S".repeat(50_000)}` });
      } catch (err) {
        return (err as Error).message;
      }
      throw new Error("expected a rejection");
    })();
    expect(short).toBe("Invalid environment: API_KEY: regex");
    expect(long).toBe(short);
  });

  it("joins several issues with a semicolon", () => {
    expect(() => parseEnv(schema, { DATABASE_URL: 1, PORT: 2 })).toThrow(new Error("Invalid environment: DATABASE_URL: string; PORT: string"));
  });

  it("labels a path-less issue root", () => {
    expect(() => parseEnv(v.string() as v.BaseSchema<unknown, string, v.BaseIssue<unknown>>, 42)).toThrow(
      new Error("Invalid environment: root: string"),
    );
  });
});
