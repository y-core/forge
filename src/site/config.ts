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
    zone: parsed.zone ?? null,
  };
}
