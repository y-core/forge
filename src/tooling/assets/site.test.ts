import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildSite } from "./site";
import { SITE_OUTPUTS } from "./types";
import type { SiteBuildConfig } from "./types";

let outDir: string;

const config = (): SiteBuildConfig => ({
  outDir: join(outDir, "public"),
  config: {
    origin: "https://example.com",
    pages: ["/", "/fica", "/api/contact", "/case/:id"],
    robots: { rules: [{ userAgent: "*", allow: ["/"], disallow: ["/api/"] }], sitemap: true },
    sitemap: { exclude: ["/api/*"] },
  },
});

beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), "forge-site-"));
});

afterEach(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe("buildSite", () => {
  it("writes both outputs into an outDir it creates", () => {
    buildSite(config());
    for (const file of SITE_OUTPUTS) expect(existsSync(join(outDir, "public", file))).toBe(true);
  });

  it("writes a robots.txt carrying the Sitemap line at the configured origin", () => {
    buildSite(config());
    expect(readFileSync(join(outDir, "public", "robots.txt"), "utf-8")).toBe(
      "User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: https://example.com/sitemap.xml\n",
    );
  });

  it("writes a sitemap carrying the served pages and neither an excluded nor a parameterised path", () => {
    buildSite(config());
    expect(readFileSync(join(outDir, "public", "sitemap.xml"), "utf-8")).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        "  <url>\n    <loc>https://example.com/</loc>\n  </url>\n" +
        "  <url>\n    <loc>https://example.com/fica</loc>\n  </url>\n" +
        "</urlset>\n",
    );
  });

  it("refuses an invalid site config rather than emitting a wrong file", () => {
    const invalid = config();
    invalid.config = { ...invalid.config, origin: "https://example.com/" };
    expect(() => buildSite(invalid)).toThrow();
    expect(existsSync(join(outDir, "public", "robots.txt"))).toBe(false);
  });
});
