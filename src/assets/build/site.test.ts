import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SITE_OUTPUTS, type SiteBuildConfig } from "../types";
import { buildSite } from "./site";

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
    const xml = readFileSync(join(outDir, "public", "sitemap.xml"), "utf-8");
    expect(xml).toContain("<loc>https://example.com/</loc>");
    expect(xml).toContain("<loc>https://example.com/fica</loc>");
    expect(xml.includes("/api/")).toBe(false);
    expect(xml.includes(":id")).toBe(false);
  });

  it("refuses an invalid site config rather than emitting a wrong file", () => {
    const invalid = config();
    invalid.config = { ...invalid.config, origin: "https://example.com/" };
    expect(() => buildSite(invalid)).toThrow();
    expect(existsSync(join(outDir, "public", "robots.txt"))).toBe(false);
  });
});
