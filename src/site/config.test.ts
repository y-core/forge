import { describe, expect, it } from "bun:test";

import { defineSiteConfig, resolveSiteConfig } from "./config";
import type { SiteConfig } from "./types";

const base: SiteConfig = { origin: "https://example.com", pages: ["/"], robots: { rules: [{ userAgent: "*" }] } };

describe("defineSiteConfig", () => {
  it("returns its argument unchanged — it exists for the authoring type, not for a transform", () => {
    expect(defineSiteConfig(base)).toBe(base);
  });
});

describe("resolveSiteConfig", () => {
  it("defaults every optional block", () => {
    expect(resolveSiteConfig(base)).toEqual({
      origin: "https://example.com",
      pages: ["/"],
      robots: { rules: [{ userAgent: "*" }], sitemap: false },
      sitemap: { exclude: [], entries: {} },
      zone: null,
    });
  });

  it("rejects an origin carrying a trailing slash, which would double the separator in every loc", () => {
    expect(() => resolveSiteConfig({ ...base, origin: "https://example.com/" })).toThrow();
  });

  it("rejects an origin that is not an absolute URL", () => {
    expect(() => resolveSiteConfig({ ...base, origin: "example.com" })).toThrow();
  });

  it("rejects a sitemap priority outside 0..1", () => {
    expect(() => resolveSiteConfig({ ...base, sitemap: { entries: { "/": { priority: 1.5 } } } })).toThrow();
  });

  it("rejects a negative crawl delay", () => {
    expect(() => resolveSiteConfig({ ...base, robots: { rules: [{ userAgent: "*", crawlDelay: -1 }] } })).toThrow();
  });

  it("carries a zone block through, filling the apex from the origin's hostname", () => {
    const zone: SiteConfig["zone"] = { redirect: { from: ["www.example.com"] }, allow: { action: "block" } };
    expect(resolveSiteConfig({ ...base, zone }).zone).toEqual({ ...zone, apex: "example.com" });
  });

  it("keeps an explicit apex over the derived one", () => {
    expect(resolveSiteConfig({ ...base, zone: { apex: "other.test" } }).zone?.apex).toBe("other.test");
  });

  it("derives the apex from the origin's host alone, dropping scheme and port", () => {
    expect(resolveSiteConfig({ ...base, origin: "https://example.com:8443", zone: {} }).zone?.apex).toBe("example.com");
  });
});
