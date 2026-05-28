import { describe, expect, it } from "bun:test";
import { deriveAllowedOrigins, parseUrl } from "./url";

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

  it("adds www variant for a non-www hostname", () => {
    const parsed = parseUrl("https://cornellaw.co.za");
    expect(deriveAllowedOrigins(parsed)).toContain("https://www.cornellaw.co.za");
  });

  it("returns exactly two origins for a non-www hostname", () => {
    const parsed = parseUrl("https://cornellaw.co.za");
    expect(deriveAllowedOrigins(parsed)).toHaveLength(2);
  });

  it("returns only the base origin for a www hostname", () => {
    const parsed = parseUrl("https://www.cornellaw.co.za");
    const origins = deriveAllowedOrigins(parsed);
    expect(origins).toHaveLength(1);
    expect(origins[0]).toBe("https://www.cornellaw.co.za");
  });

  it("preserves protocol in the www variant", () => {
    const parsed = parseUrl("http://example.com");
    expect(deriveAllowedOrigins(parsed)).toContain("http://www.example.com");
  });
});
