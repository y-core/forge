import { describe, expect, it } from "bun:test";

import { v } from "../validation/mod";
import { SiteConfigSchema } from "./types";

const base = { origin: "https://example.com", pages: ["/"], robots: { rules: [{ userAgent: "*" }] } };

const parse = (value: unknown) => v.safeParse(SiteConfigSchema, value);

describe("SiteConfigSchema — origin", () => {
  it("accepts a minimal config and returns it unchanged", () => {
    const result = parse(base);
    expect(result.success).toBe(true);
    expect(result.output).toEqual(base);
  });

  it("rejects an origin with a trailing slash, naming the reason", () => {
    const result = parse({ ...base, origin: "https://example.com/" });
    expect(result.success).toBe(false);
    expect(result.issues?.[0]?.message).toBe("origin must not end in a trailing slash");
  });

  it("rejects an origin that is not an absolute URL", () => {
    expect(parse({ ...base, origin: "example.com" }).success).toBe(false);
  });

  it("rejects a missing origin", () => {
    expect(parse({ pages: ["/"], robots: { rules: [] } }).success).toBe(false);
  });

  it("rejects a non-string origin", () => {
    expect(parse({ ...base, origin: 42 }).success).toBe(false);
  });
});

describe("SiteConfigSchema — pages and robots", () => {
  it("accepts an empty page list", () => {
    expect(parse({ ...base, pages: [] }).success).toBe(true);
  });

  it("rejects a page list holding a non-string", () => {
    expect(parse({ ...base, pages: ["/", 1] }).success).toBe(false);
  });

  it("rejects a missing robots block", () => {
    expect(parse({ origin: base.origin, pages: [] }).success).toBe(false);
  });

  it("accepts a rule carrying allow, disallow and a zero crawl delay", () => {
    const robots = { rules: [{ userAgent: "*", allow: ["/"], disallow: ["/admin"], crawlDelay: 0 }], sitemap: true };
    expect(parse({ ...base, robots }).output).toEqual({ ...base, robots });
  });

  it("rejects a negative crawl delay", () => {
    expect(parse({ ...base, robots: { rules: [{ userAgent: "*", crawlDelay: -1 }] } }).success).toBe(false);
  });

  it("rejects a rule with no userAgent", () => {
    expect(parse({ ...base, robots: { rules: [{ allow: ["/"] }] } }).success).toBe(false);
  });
});

describe("SiteConfigSchema — sitemap", () => {
  it("accepts an entry override at each end of the priority range", () => {
    const sitemap = { exclude: ["/draft"], entries: { "/": { changefreq: "daily", priority: 1, lastmod: "2026-01-01" }, "/x": { priority: 0 } } };
    expect(parse({ ...base, sitemap }).output).toEqual({ ...base, sitemap });
  });

  it("rejects a priority above 1", () => {
    expect(parse({ ...base, sitemap: { entries: { "/": { priority: 1.1 } } } }).success).toBe(false);
  });

  it("rejects a priority below 0", () => {
    expect(parse({ ...base, sitemap: { entries: { "/": { priority: -0.1 } } } }).success).toBe(false);
  });

  it("rejects a changefreq outside the sitemap protocol's vocabulary", () => {
    expect(parse({ ...base, sitemap: { entries: { "/": { changefreq: "fortnightly" } } } }).success).toBe(false);
  });

  it("accepts every changefreq the protocol defines", () => {
    for (const changefreq of ["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"]) {
      expect(parse({ ...base, sitemap: { entries: { "/": { changefreq } } } }).success).toBe(true);
    }
  });
});

describe("SiteConfigSchema — zone", () => {
  it("accepts a full zone block", () => {
    const zone = {
      zoneId: "z1",
      apex: "example.com",
      redirect: { from: ["www.example.com"], statusCode: 308 },
      allow: { action: "block", description: "d", prefixes: ["/assets/"], files: ["robots.txt"], paths: ["/"] },
    };
    expect(parse({ ...base, zone }).output).toEqual({ ...base, zone });
  });

  it("accepts a zone with every optional field omitted", () => {
    expect(parse({ ...base, zone: {} }).success).toBe(true);
  });

  it("rejects an allow action outside the terminating set", () => {
    expect(parse({ ...base, zone: { allow: { action: "log" } } }).success).toBe(false);
  });

  it("accepts every terminating allow action", () => {
    for (const action of ["managed_challenge", "js_challenge", "challenge", "block"]) {
      expect(parse({ ...base, zone: { allow: { action } } }).success).toBe(true);
    }
  });

  it("rejects an allow block with no action", () => {
    expect(parse({ ...base, zone: { allow: { prefixes: ["/assets/"] } } }).success).toBe(false);
  });

  it("rejects a redirect status that is not a redirect status", () => {
    expect(parse({ ...base, zone: { redirect: { from: ["www.example.com"], statusCode: 200 } } }).success).toBe(false);
  });

  it("rejects a redirect with no from list", () => {
    expect(parse({ ...base, zone: { redirect: { statusCode: 301 } } }).success).toBe(false);
  });
});
