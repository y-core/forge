import { v } from "../validation/mod";
import type { ResolvedSiteConfig, SiteConfig } from "./types";
import { SiteConfigSchema } from "./types";

/** Types the default export of a `site.config.ts`. @public */
export function defineSiteConfig(config: SiteConfig): SiteConfig {
  return config;
}

/** Validates a site config and fills in every optional block, yielding the shape the renderers consume. @public */
export function resolveSiteConfig(config: SiteConfig): ResolvedSiteConfig {
  const parsed = v.parse(SiteConfigSchema, config);
  return {
    origin: parsed.origin,
    pages: parsed.pages,
    robots: { rules: parsed.robots.rules, sitemap: parsed.robots.sitemap ?? false },
    sitemap: { exclude: parsed.sitemap?.exclude ?? [], entries: parsed.sitemap?.entries ?? {} },
    // The apex defaults to the origin's hostname, so a consumer states the host once. `new URL` is
    // safe here: the schema has already refused an origin that is not an absolute URL.
    zone: parsed.zone ? { ...parsed.zone, apex: parsed.zone.apex ?? new URL(parsed.origin).hostname } : null,
  };
}
