import { describe, expect, it } from "bun:test";
import * as v from "valibot";
import { BaseUrlConfigSchema, deriveAllowedOrigins, parseUrl } from "./url";

describe("parseUrl", () => {
  it("extracts origin from a valid URL", () => {
    const result = parseUrl("https://cornellaw.co.za");
    expect(result.origin).toBe("https://cornellaw.co.za");
  });

  it("extracts hostname from a valid URL", () => {
    const result = parseUrl("https://cornellaw.co.za");
    expect(result.hostname).toBe("cornellaw.co.za");
  });

  it("extracts protocol including the trailing colon", () => {
    const result = parseUrl("https://cornellaw.co.za");
    expect(result.protocol).toBe("https:");
  });

  it("strips path and query from origin", () => {
    const result = parseUrl("https://cornellaw.co.za/some/path?q=1");
    expect(result.origin).toBe("https://cornellaw.co.za");
  });

  it("throws on an invalid URL", () => {
    expect(() => parseUrl("not-a-url")).toThrow();
  });

  it("handles non-standard ports", () => {
    const result = parseUrl("http://localhost:8787");
    expect(result.origin).toBe("http://localhost:8787");
    expect(result.hostname).toBe("localhost");
  });
});

describe("deriveAllowedOrigins", () => {
  it("includes the base origin", () => {
    const parsed = parseUrl("https://cornellaw.co.za");
    expect(deriveAllowedOrigins(parsed)).toContain("https://cornellaw.co.za");
  });

  it("returns only the base origin by default (no www variant)", () => {
    const parsed = parseUrl("https://cornellaw.co.za");
    const origins = deriveAllowedOrigins(parsed);
    expect(origins).toHaveLength(1);
    expect(origins[0]).toBe("https://cornellaw.co.za");
  });

  it("adds www variant when includeWww: true for a non-www hostname", () => {
    const parsed = parseUrl("https://cornellaw.co.za");
    expect(deriveAllowedOrigins(parsed, { includeWww: true })).toContain("https://www.cornellaw.co.za");
  });

  it("returns exactly two origins for a non-www hostname when includeWww: true", () => {
    const parsed = parseUrl("https://cornellaw.co.za");
    expect(deriveAllowedOrigins(parsed, { includeWww: true })).toHaveLength(2);
  });

  it("returns only the base origin for a www hostname even when includeWww: true", () => {
    const parsed = parseUrl("https://www.cornellaw.co.za");
    const origins = deriveAllowedOrigins(parsed, { includeWww: true });
    expect(origins).toHaveLength(1);
    expect(origins[0]).toBe("https://www.cornellaw.co.za");
  });

  it("preserves protocol in the www variant", () => {
    const parsed = parseUrl("https://example.com");
    expect(deriveAllowedOrigins(parsed, { includeWww: true })).toContain("https://www.example.com");
  });
});

describe("BaseUrlConfigSchema", () => {
  it("accepts a valid https URL", () => {
    const result = v.safeParse(BaseUrlConfigSchema, "https://cornellaw.co.za");
    expect(result.success).toBe(true);
  });

  it("accepts http://localhost for local development", () => {
    const result = v.safeParse(BaseUrlConfigSchema, "http://localhost:8787");
    expect(result.success).toBe(true);
  });

  it("rejects a plain http non-localhost URL", () => {
    const result = v.safeParse(BaseUrlConfigSchema, "http://cornellaw.co.za");
    expect(result.success).toBe(false);
  });

  it("rejects a non-URL string", () => {
    const result = v.safeParse(BaseUrlConfigSchema, "not-a-url");
    expect(result.success).toBe(false);
  });

  it("transforms to a BaseUrlConfig with allowedOrigins", () => {
    const result = v.safeParse(BaseUrlConfigSchema, "https://cornellaw.co.za");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.output.origin).toBe("https://cornellaw.co.za");
      expect(result.output.allowedOrigins).toEqual(["https://cornellaw.co.za"]);
    }
  });
});
