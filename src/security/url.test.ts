import { describe, expect, it } from "bun:test";

import { v } from "../validation/mod";
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

  it("appends a valid https extra origin after the base origin", () => {
    const parsed = parseUrl("https://a.example");
    expect(deriveAllowedOrigins(parsed, { extraOrigins: ["https://b.example"] })).toEqual(["https://a.example", "https://b.example"]);
  });

  it("appends https://localhost:8787 for the proxy-less dev fallback", () => {
    const parsed = parseUrl("https://cornellaw.co.za");
    expect(deriveAllowedOrigins(parsed, { extraOrigins: ["https://localhost:8787"] })).toEqual([
      "https://cornellaw.co.za",
      "https://localhost:8787",
    ]);
  });

  it("accepts http://localhost:8787 as a loopback extra origin", () => {
    const parsed = parseUrl("https://cornellaw.co.za");
    expect(deriveAllowedOrigins(parsed, { extraOrigins: ["http://localhost:8787"] })).toEqual(["https://cornellaw.co.za", "http://localhost:8787"]);
  });

  it("accepts http://127.0.0.1:8787 as a loopback extra origin", () => {
    const parsed = parseUrl("https://cornellaw.co.za");
    expect(deriveAllowedOrigins(parsed, { extraOrigins: ["http://127.0.0.1:8787"] })).toEqual(["https://cornellaw.co.za", "http://127.0.0.1:8787"]);
  });

  it("rejects an extra origin carrying a path", () => {
    const parsed = parseUrl("https://cornellaw.co.za");
    expect(() => deriveAllowedOrigins(parsed, { extraOrigins: ["https://x.example/app"] })).toThrow(
      "extraOrigins entry is not a normalized origin: https://x.example/app",
    );
  });

  it("rejects an extra origin with a trailing slash", () => {
    const parsed = parseUrl("https://cornellaw.co.za");
    expect(() => deriveAllowedOrigins(parsed, { extraOrigins: ["https://x.example/"] })).toThrow(
      "extraOrigins entry is not a normalized origin: https://x.example/",
    );
  });

  it("rejects an extra origin that is not a URL", () => {
    const parsed = parseUrl("https://cornellaw.co.za");
    expect(() => deriveAllowedOrigins(parsed, { extraOrigins: ["not-a-url"] })).toThrow("extraOrigins entry is not a normalized origin: not-a-url");
  });

  it("rejects a plain http non-loopback extra origin", () => {
    const parsed = parseUrl("https://cornellaw.co.za");
    expect(() => deriveAllowedOrigins(parsed, { extraOrigins: ["http://x.example"] })).toThrow(
      "extraOrigins entry must use https: (http://localhost and http://127.0.0.1 are allowed for local development): http://x.example",
    );
  });

  it("rejects a ws:// loopback extra origin", () => {
    const parsed = parseUrl("https://cornellaw.co.za");
    expect(() => deriveAllowedOrigins(parsed, { extraOrigins: ["ws://localhost:8787"] })).toThrow(
      "extraOrigins entry must use https: (http://localhost and http://127.0.0.1 are allowed for local development): ws://localhost:8787",
    );
  });

  it("rejects an ftp:// loopback extra origin", () => {
    const parsed = parseUrl("https://cornellaw.co.za");
    expect(() => deriveAllowedOrigins(parsed, { extraOrigins: ["ftp://localhost"] })).toThrow(
      "extraOrigins entry must use https: (http://localhost and http://127.0.0.1 are allowed for local development): ftp://localhost",
    );
  });

  it("de-dupes an extra origin equal to the base origin", () => {
    const parsed = parseUrl("https://cornellaw.co.za");
    expect(deriveAllowedOrigins(parsed, { extraOrigins: ["https://cornellaw.co.za"] })).toHaveLength(1);
  });

  it("orders base, www variant, then extras when composed with includeWww", () => {
    const parsed = parseUrl("https://cornellaw.co.za");
    expect(deriveAllowedOrigins(parsed, { includeWww: true, extraOrigins: ["https://localhost:8787"] })).toEqual([
      "https://cornellaw.co.za",
      "https://www.cornellaw.co.za",
      "https://localhost:8787",
    ]);
  });

  it("returns only the base origin for an empty extraOrigins array", () => {
    const parsed = parseUrl("https://cornellaw.co.za");
    expect(deriveAllowedOrigins(parsed, { extraOrigins: [] })).toEqual(["https://cornellaw.co.za"]);
  });

  it("preserves a non-default port in the www variant", () => {
    const parsed = parseUrl("https://example.com:8443");
    expect(deriveAllowedOrigins(parsed, { includeWww: true })).toEqual(["https://example.com:8443", "https://www.example.com:8443"]);
  });

  it("omits a default port from the www variant", () => {
    const parsed = parseUrl("https://example.com:443");
    expect(deriveAllowedOrigins(parsed, { includeWww: true })).toEqual(["https://example.com", "https://www.example.com"]);
  });

  it("orders base, ported www variant, then extras", () => {
    const parsed = parseUrl("https://example.com:8443");
    expect(deriveAllowedOrigins(parsed, { includeWww: true, extraOrigins: ["https://localhost:8787"] })).toEqual([
      "https://example.com:8443",
      "https://www.example.com:8443",
      "https://localhost:8787",
    ]);
  });

  it("de-dupes an extra origin equal to the www variant", () => {
    const parsed = parseUrl("https://cornellaw.co.za");
    expect(deriveAllowedOrigins(parsed, { includeWww: true, extraOrigins: ["https://www.cornellaw.co.za"] })).toEqual([
      "https://cornellaw.co.za",
      "https://www.cornellaw.co.za",
    ]);
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

  it("accepts http://127.0.0.1 for local development", () => {
    const result = v.safeParse(BaseUrlConfigSchema, "http://127.0.0.1:8787");
    expect(result.success).toBe(true);
  });

  it("names both loopback allowances in the rejection message", () => {
    const result = v.safeParse(BaseUrlConfigSchema, "http://cornellaw.co.za");
    expect(result.issues?.[0]?.message).toBe("BASE_URL must use https: (http://localhost and http://127.0.0.1 are allowed for local development)");
  });

  it("rejects a ws:// loopback URL", () => {
    const result = v.safeParse(BaseUrlConfigSchema, "ws://localhost:8787");
    expect(result.success).toBe(false);
    expect(result.issues?.[0]?.message).toBe("BASE_URL must use https: (http://localhost and http://127.0.0.1 are allowed for local development)");
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

  it("derives allowedOrigins with no extra origins — the schema takes no options", () => {
    const result = v.safeParse(BaseUrlConfigSchema, "https://localhost:8787");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.output.allowedOrigins).toEqual(["https://localhost:8787"]);
    }
  });
});
