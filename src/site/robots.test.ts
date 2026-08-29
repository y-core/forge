import { describe, expect, it } from "bun:test";
import { resolveSiteConfig } from "./config";
import { renderRobotsTxt } from "./robots";
import type { SiteConfig } from "./types";

const base: SiteConfig = {
  origin: "https://example.com",
  pages: ["/"],
  robots: { rules: [{ userAgent: "*", allow: ["/"], disallow: ["/api/"] }], sitemap: true },
};

describe("renderRobotsTxt", () => {
  it("renders one stanza per rule and the sitemap trailer", () => {
    expect(renderRobotsTxt(resolveSiteConfig(base))).toBe("User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: https://example.com/sitemap.xml\n");
  });

  it("omits the sitemap trailer when it is not enabled", () => {
    const config = resolveSiteConfig({ ...base, robots: { rules: base.robots.rules } });
    expect(renderRobotsTxt(config)).toBe("User-agent: *\nAllow: /\nDisallow: /api/\n");
  });

  it("emits Crawl-delay only when the rule sets one, after the path lines", () => {
    const config = resolveSiteConfig({ ...base, robots: { rules: [{ userAgent: "BadBot", disallow: ["/"], crawlDelay: 10 }] } });
    expect(renderRobotsTxt(config)).toBe("User-agent: BadBot\nDisallow: /\nCrawl-delay: 10\n");
  });

  it("separates multiple stanzas with a blank line", () => {
    const config = resolveSiteConfig({
      ...base,
      robots: {
        rules: [
          { userAgent: "*", allow: ["/"] },
          { userAgent: "BadBot", disallow: ["/"] },
        ],
      },
    });
    expect(renderRobotsTxt(config)).toBe("User-agent: *\nAllow: /\n\nUser-agent: BadBot\nDisallow: /\n");
  });

  it("renders a bare User-agent line for a rule carrying no directives", () => {
    const config = resolveSiteConfig({ ...base, robots: { rules: [{ userAgent: "*" }] } });
    expect(renderRobotsTxt(config)).toBe("User-agent: *\n");
  });
});
