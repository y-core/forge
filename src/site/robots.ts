import type { ResolvedSiteConfig } from "./types";

/** The path the generated sitemap is served from, relative to the origin. @public */
export const SITEMAP_PATH = "/sitemap.xml";

/** Renders a `robots.txt` body — one stanza per rule, then the `Sitemap:` line when enabled. @public */
export function renderRobotsTxt(config: ResolvedSiteConfig): string {
  const stanzas = config.robots.rules.map((rule) => {
    const lines = [`User-agent: ${rule.userAgent}`];
    for (const path of rule.allow ?? []) lines.push(`Allow: ${path}`);
    for (const path of rule.disallow ?? []) lines.push(`Disallow: ${path}`);
    if (rule.crawlDelay !== undefined) lines.push(`Crawl-delay: ${rule.crawlDelay}`);
    return lines.join("\n");
  });

  const trailer = config.robots.sitemap ? [`Sitemap: ${config.origin}${SITEMAP_PATH}`] : [];
  return `${[...stanzas, ...trailer].join("\n\n")}\n`;
}
