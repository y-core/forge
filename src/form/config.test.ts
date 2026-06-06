import { describe, expect, it } from "bun:test";
import { v } from "../validation/mod";
import { CsrfConfigSchema, TurnstileConfigSchema } from "./config";

const VALID_SECRET = "de7bf4aef360e3a4c3254c9cec7e45d0f1fd98cc2219c62b5b07e826ba1bcc6e";

describe("CsrfConfigSchema", () => {
  it("accepts a valid 32+ hex character secret", () => {
    const result = v.safeParse(CsrfConfigSchema, { secret: VALID_SECRET });
    expect(result.success).toBe(true);
  });

  it("rejects a secret shorter than 32 hex characters", () => {
    const result = v.safeParse(CsrfConfigSchema, { secret: "abc123" });
    expect(result.success).toBe(false);
  });

  it("rejects a secret with non-hex characters", () => {
    const result = v.safeParse(CsrfConfigSchema, { secret: "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing secret", () => {
    const result = v.safeParse(CsrfConfigSchema, {});
    expect(result.success).toBe(false);
  });
});

describe("TurnstileConfigSchema", () => {
  it("accepts valid secretKey and siteKey", () => {
    const result = v.safeParse(TurnstileConfigSchema, { secretKey: "secret", siteKey: "site" });
    expect(result.success).toBe(true);
  });

  it("rejects when secretKey is missing", () => {
    const result = v.safeParse(TurnstileConfigSchema, { siteKey: "site" });
    expect(result.success).toBe(false);
  });

  it("rejects when siteKey is missing", () => {
    const result = v.safeParse(TurnstileConfigSchema, { secretKey: "secret" });
    expect(result.success).toBe(false);
  });
});
