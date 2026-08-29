import { describe, expect, it } from "bun:test";
import { resolveSiteConfig } from "./config";
import { renderSitemapXml, resolveSitemapEntries } from "./sitemap";
import type { SiteConfig } from "./types";

const origin = "https://example.com";

describe("resolveSitemapEntries", () => {
  it("turns paths into absolute locations, sorted", () => {
    expect(resolveSitemapEntries(["/privacy", "/"], { origin })).toEqual([
      { path: "/", loc: "https://example.com/" },
      { path: "/privacy", loc: "https://example.com/privacy" },
    ]);
  });

  it("drops parameterised and wildcard patterns, which stand for no single URL", () => {
    const entries = resolveSitemapEntries(["/", "/case/:id", "/docs/*", "/files/(a)"], { origin });
    expect(entries.map((e) => e.path)).toEqual(["/"]);
  });

  it("drops excluded paths, matching `*` against any run of characters", () => {
    const entries = resolveSitemapEntries(["/", "/api/contact", "/api/fica", "/fica"], { origin, exclude: ["/api/*"] });
    expect(entries.map((e) => e.path)).toEqual(["/", "/fica"]);
  });

  it("matches an exclude pattern carrying no wildcard exactly", () => {
    const entries = resolveSitemapEntries(["/api", "/api/contact"], { origin, exclude: ["/api"] });
    expect(entries.map((e) => e.path)).toEqual(["/api/contact"]);
  });

  it("collapses duplicate paths", () => {
    expect(resolveSitemapEntries(["/fica", "/fica/", "/fica"], { origin }).map((e) => e.path)).toEqual(["/fica"]);
  });

  it("normalises a missing leading slash and a trailing slash, but leaves the root alone", () => {
    expect(resolveSitemapEntries(["privacy/", "/"], { origin }).map((e) => e.loc)).toEqual(["https://example.com/", "https://example.com/privacy"]);
  });

  it("decorates an entry with the metadata configured for its path", () => {
    const entries = resolveSitemapEntries(["/fica"], {
      origin,
      entries: { "/fica": { changefreq: "yearly", priority: 0.5, lastmod: "2026-08-29" } },
    });
    expect(entries).toEqual([{ path: "/fica", loc: "https://example.com/fica", changefreq: "yearly", priority: 0.5, lastmod: "2026-08-29" }]);
  });
});

describe("renderSitemapXml", () => {
  const config: SiteConfig = {
    origin,
    pages: ["/", "/fica", "/privacy", "/api/contact", "/case/:id"],
    robots: { rules: [{ userAgent: "*" }] },
    sitemap: { exclude: ["/api/*"], entries: { "/": { changefreq: "monthly", priority: 1 }, "/privacy": { priority: 0.3 } } },
  };

  it("renders the urlset envelope with one url per surviving entry", () => {
    expect(renderSitemapXml(resolveSiteConfig(config))).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        "  <url>\n    <loc>https://example.com/</loc>\n    <changefreq>monthly</changefreq>\n    <priority>1.0</priority>\n  </url>\n" +
        "  <url>\n    <loc>https://example.com/fica</loc>\n  </url>\n" +
        "  <url>\n    <loc>https://example.com/privacy</loc>\n    <priority>0.3</priority>\n  </url>\n" +
        "</urlset>\n",
    );
  });

  it("carries no excluded or parameterised path", () => {
    const xml = renderSitemapXml(resolveSiteConfig(config));
    expect(xml.includes("/api/")).toBe(false);
    expect(xml.includes(":id")).toBe(false);
  });

  it("escapes XML metacharacters in a location", () => {
    const xml = renderSitemapXml(resolveSiteConfig({ ...config, pages: ["/a&b"], sitemap: undefined }));
    expect(xml.includes("<loc>https://example.com/a&amp;b</loc>")).toBe(true);
  });

  it("renders a two-decimal priority when one decimal would lose precision", () => {
    const xml = renderSitemapXml(resolveSiteConfig({ ...config, pages: ["/fica"], sitemap: { entries: { "/fica": { priority: 0.75 } } } }));
    expect(xml.includes("<priority>0.75</priority>")).toBe(true);
  });
});
