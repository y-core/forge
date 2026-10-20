import { describe, expect, it } from "bun:test";

import { v } from "../validation/mod";
import { parseEnv } from "../validation/parse-env";
import { BaseUrlConfigSchema, deriveAllowedOrigins, parseUrl } from "./url";

describe("parseUrl", () => {
  it("extracts origin from a valid URL", () => {
    const result = parseUrl("https://example.com");
    expect(result.origin).toBe("https://example.com");
  });

  it("extracts hostname from a valid URL", () => {
    const result = parseUrl("https://example.com");
    expect(result.hostname).toBe("example.com");
  });

  it("extracts protocol including the trailing colon", () => {
    const result = parseUrl("https://example.com");
    expect(result.protocol).toBe("https:");
  });

  it("strips path and query from origin", () => {
    const result = parseUrl("https://example.com/some/path?q=1");
    expect(result.origin).toBe("https://example.com");
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
    const parsed = parseUrl("https://example.com");
    expect(deriveAllowedOrigins(parsed)).toContain("https://example.com");
  });

  it("returns only the base origin by default (no www variant)", () => {
    const parsed = parseUrl("https://example.com");
    const origins = deriveAllowedOrigins(parsed);
    expect(origins).toHaveLength(1);
    expect(origins[0]).toBe("https://example.com");
  });

  it("adds www variant when includeWww: true for a non-www hostname", () => {
    const parsed = parseUrl("https://example.com");
    expect(deriveAllowedOrigins(parsed, { includeWww: true })).toContain("https://www.example.com");
  });

  it("returns exactly two origins for a non-www hostname when includeWww: true", () => {
    const parsed = parseUrl("https://example.com");
    expect(deriveAllowedOrigins(parsed, { includeWww: true })).toHaveLength(2);
  });

  it("returns only the base origin for a www hostname even when includeWww: true", () => {
    const parsed = parseUrl("https://www.example.com");
    const origins = deriveAllowedOrigins(parsed, { includeWww: true });
    expect(origins).toHaveLength(1);
    expect(origins[0]).toBe("https://www.example.com");
  });

  it("preserves protocol in the www variant", () => {
    const parsed = parseUrl("https://example.com");
    expect(deriveAllowedOrigins(parsed, { includeWww: true })).toContain("https://www.example.com");
  });

  it("takes no `dev` option, so extra origins are admitted by the origin guards alone", () => {
    // @ts-expect-error — `deriveAllowedOrigins` takes no `dev` option
    deriveAllowedOrigins(parseUrl("https://example.com"), { dev: ["https://b.example"] });
  });

  it("preserves a non-default port in the www variant", () => {
    const parsed = parseUrl("https://example.com:8443");
    expect(deriveAllowedOrigins(parsed, { includeWww: true })).toEqual(["https://example.com:8443", "https://www.example.com:8443"]);
  });

  it("omits a default port from the www variant", () => {
    const parsed = parseUrl("https://example.com:443");
    expect(deriveAllowedOrigins(parsed, { includeWww: true })).toEqual(["https://example.com", "https://www.example.com"]);
  });
});

describe("BaseUrlConfigSchema", () => {
  it("accepts a valid https URL", () => {
    const result = v.safeParse(BaseUrlConfigSchema, "https://example.com");
    expect(result.success).toBe(true);
  });

  it("accepts http://localhost for local development", () => {
    const result = v.safeParse(BaseUrlConfigSchema, "http://localhost:8787");
    expect(result.success).toBe(true);
  });

  it("rejects a plain http non-localhost URL", () => {
    const result = v.safeParse(BaseUrlConfigSchema, "http://example.com");
    expect(result.success).toBe(false);
  });

  it("accepts http://127.0.0.1 for local development", () => {
    const result = v.safeParse(BaseUrlConfigSchema, "http://127.0.0.1:8787");
    expect(result.success).toBe(true);
  });

  it("names both loopback allowances in the rejection message", () => {
    const result = v.safeParse(BaseUrlConfigSchema, "http://example.com");
    expect(result.issues?.[0]?.message).toBe("must use https: (http://localhost and http://127.0.0.1 are allowed for local development)");
  });

  it("rejects a ws:// loopback URL", () => {
    const result = v.safeParse(BaseUrlConfigSchema, "ws://localhost:8787");
    expect(result.success).toBe(false);
    expect(result.issues?.[0]?.message).toBe("must use https: (http://localhost and http://127.0.0.1 are allowed for local development)");
  });

  it("rejects a non-URL string", () => {
    const result = v.safeParse(BaseUrlConfigSchema, "not-a-url");
    expect(result.success).toBe(false);
  });

  it("transforms to a BaseUrlConfig with allowedOrigins", () => {
    const result = v.safeParse(BaseUrlConfigSchema, "https://example.com");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.output.origin).toBe("https://example.com");
      expect(result.output.allowedOrigins).toEqual(["https://example.com"]);
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

describe("BaseUrlConfigSchema in an env refusal", () => {
  const Schema = v.object({ site: v.object({ url: BaseUrlConfigSchema }) });

  it("states the requirement, and names no env key — which key supplies the value is the consumer's choice", () => {
    expect(() => parseEnv(Schema, { site: { url: "http://example.com" } })).toThrow(
      new Error("Invalid environment: site.url: must use https: (http://localhost and http://127.0.0.1 are allowed for local development)"),
    );
  });

  it("reproduces none of the rejected origin, which is what the narrowing was for", () => {
    expect(() => parseEnv(Schema, { site: { url: "http://secret-staging.example" } })).toThrow(
      new Error("Invalid environment: site.url: must use https: (http://localhost and http://127.0.0.1 are allowed for local development)"),
    );
  });
});
