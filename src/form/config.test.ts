import { describe, expect, it } from "bun:test";

import { v } from "../validation/mod";
import { CsrfConfigSchema, TurnstileConfigSchema } from "./config";

const VALID_SECRET = "de7bf4aef360e3a4c3254c9cec7e45d0f1fd98cc2219c62b5b07e826ba1bcc6e";
const OLDER_SECRET = "8b7680f6f106e5235091e5cdcc23ed1f2bd06cd47e14022ec96f670b87a7157d";

describe("CsrfConfigSchema", () => {
  it("accepts a 64-hex-character secret", () => {
    const result = v.safeParse(CsrfConfigSchema, { secret: VALID_SECRET });
    expect(result.success).toBe(true);
  });

  it("rejects a secret shorter than 64 hex characters", () => {
    const result = v.safeParse(CsrfConfigSchema, { secret: "abc123" });
    expect(result.success).toBe(false);
  });

  it("rejects a secret one hex character under the 32-byte floor", () => {
    const result = v.safeParse(CsrfConfigSchema, { secret: VALID_SECRET.slice(0, 63) });
    expect(result.success).toBe(false);
  });

  it("rejects a 16-byte secret the previous floor admitted", () => {
    const result = v.safeParse(CsrfConfigSchema, { secret: VALID_SECRET.slice(0, 32) });
    expect(result.success).toBe(false);
  });

  it("rejects an odd-length hex secret that no byte string encodes", () => {
    const result = v.safeParse(CsrfConfigSchema, { secret: `${VALID_SECRET}a` });
    expect(result.success).toBe(false);
  });

  it("rejects a secret with non-hex characters", () => {
    const result = v.safeParse(CsrfConfigSchema, { secret: "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz" });
    expect(result.success).toBe(false);
  });

  it("accepts a comma-separated ring of 64-hex-character secrets, spaces around the commas included", () => {
    expect(v.safeParse(CsrfConfigSchema, { secret: `${VALID_SECRET},${OLDER_SECRET}` }).success).toBe(true);
    expect(v.safeParse(CsrfConfigSchema, { secret: `${VALID_SECRET} , ${OLDER_SECRET}` }).success).toBe(true);
  });

  it("rejects a ring with one entry under the 32-byte floor", () => {
    const result = v.safeParse(CsrfConfigSchema, { secret: `${VALID_SECRET},${OLDER_SECRET.slice(0, 62)}` });
    expect(result.success).toBe(false);
  });

  it("rejects a ring with an empty entry between its commas", () => {
    expect(v.safeParse(CsrfConfigSchema, { secret: `${VALID_SECRET},,${OLDER_SECRET}` }).success).toBe(false);
    expect(v.safeParse(CsrfConfigSchema, { secret: `${VALID_SECRET},` }).success).toBe(false);
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
