import { v } from "../validation/mod";

const ChangefreqSchema = v.picklist(["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"] as const);

const RobotsRuleSchema = v.object({
  userAgent: v.string(),
  allow: v.optional(v.array(v.string())),
  disallow: v.optional(v.array(v.string())),
  crawlDelay: v.optional(v.pipe(v.number(), v.minValue(0))),
});

const RobotsConfigSchema = v.object({ rules: v.array(RobotsRuleSchema), sitemap: v.optional(v.boolean()) });

const SitemapOverrideSchema = v.object({
  changefreq: v.optional(ChangefreqSchema),
  priority: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(1))),
  lastmod: v.optional(v.string()),
});

const SitemapConfigSchema = v.object({
  exclude: v.optional(v.array(v.string())),
  entries: v.optional(v.record(v.string(), SitemapOverrideSchema)),
});

const ZoneActionSchema = v.picklist(["managed_challenge", "js_challenge", "challenge", "block"] as const);

const ZoneRedirectSchema = v.object({ from: v.array(v.string()), statusCode: v.optional(v.picklist([301, 302, 307, 308] as const)) });

const ZoneAllowSchema = v.object({
  action: ZoneActionSchema,
  description: v.optional(v.string()),
  prefixes: v.optional(v.array(v.string())),
  files: v.optional(v.array(v.string())),
  paths: v.optional(v.array(v.string())),
});

const ZoneConfigSchema = v.object({
  zoneId: v.optional(v.string()),
  apex: v.string(),
  redirect: v.optional(ZoneRedirectSchema),
  allow: v.optional(ZoneAllowSchema),
});

/** The default export of a `site.config.ts`. @public */
export const SiteConfigSchema = v.object({
  origin: v.pipe(
    v.string(),
    v.url(),
    v.check((s) => !s.endsWith("/"), "origin must not end in a trailing slash"),
  ),
  pages: v.array(v.string()),
  robots: RobotsConfigSchema,
  sitemap: v.optional(SitemapConfigSchema),
  zone: v.optional(ZoneConfigSchema),
});

/** One `User-agent` stanza of a `robots.txt`. @public */
export type RobotsRule = v.InferOutput<typeof RobotsRuleSchema>;
/** How often a URL is expected to change, per the sitemap protocol. @public */
export type Changefreq = v.InferOutput<typeof ChangefreqSchema>;
/** Per-path sitemap metadata a config may attach to a generated entry. @public */
export type SitemapOverride = v.InferOutput<typeof SitemapOverrideSchema>;
/** The robots block of a site config. @public */
export type RobotsConfig = v.InferOutput<typeof RobotsConfigSchema>;
/** The sitemap block of a site config. @public */
export type SitemapConfig = v.InferOutput<typeof SitemapConfigSchema>;
/** The terminating action a WAF allow-list rule takes on traffic it does not recognise. @public */
export type ZoneAction = v.InferOutput<typeof ZoneActionSchema>;
/** The zone block of a site config — edge rules derived from the same route table. @public */
export type ZoneConfig = v.InferOutput<typeof ZoneConfigSchema>;
/** What a consumer writes in `site.config.ts`. @public */
export type SiteConfig = v.InferInput<typeof SiteConfigSchema>;

/** A site config with every optional block defaulted, as the renderers consume it. @public */
export interface ResolvedSiteConfig {
  origin: string;
  pages: readonly string[];
  robots: { rules: readonly RobotsRule[]; sitemap: boolean };
  sitemap: { exclude: readonly string[]; entries: Readonly<Record<string, SitemapOverride>> };
  zone: ZoneConfig | null;
}

/** One resolved `<url>` of a sitemap: an absolute location plus whatever metadata the config supplied. @public */
export interface SitemapEntry extends SitemapOverride {
  /** Root-relative path, leading slash, no trailing slash except for `/` itself. */
  path: string;
  /** Absolute URL, `origin` + `path`. */
  loc: string;
}

/** Inputs to {@link resolveSitemapEntries} beyond the path list itself. @public */
export interface ResolveSitemapOptions {
  origin: string;
  exclude?: readonly string[];
  entries?: Readonly<Record<string, SitemapOverride>>;
}

/** Every part of the served surface a zone allow-list must let through. @public */
export interface ZoneSurface {
  /** The host the rule is scoped to, and the only host whose surface is enumerated here. */
  apex: string;
  /** Exact application paths — `routePaths(routes)` across every method. */
  paths: readonly string[];
  /** Path prefixes served wholesale, matched as `starts_with` — `/assets/`, `/cdn-cgi/`. */
  prefixes: readonly string[];
  /** Exact files at the asset-tree root — the icons, `robots.txt`, `sitemap.xml`. */
  files: readonly string[];
}

/** A single Cloudflare Ruleset Engine rule, as the entrypoint PUT body carries it. @public */
export interface ZoneRule {
  action: string;
  expression: string;
  description: string;
  enabled: boolean;
  action_parameters?: Record<string, unknown>;
}

/** What {@link buildRedirectRule} needs to emit a `www`-style host redirect. @public */
export interface RedirectSpec {
  /** Hosts to redirect away from. */
  from: readonly string[];
  /** The host to redirect to. */
  apex: string;
  /** Defaults to 301. */
  statusCode?: 301 | 302 | 307 | 308;
}
