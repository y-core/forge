import type { ResolvedSiteConfig, ResolveSitemapOptions, SitemapEntry } from "./types";

/** Route-pattern syntax that cannot be turned into a concrete URL. @internal */
const DYNAMIC_PATTERN = /[:*{}()?]/;

const XML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

/** @internal */
function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);
}

/** Normalises a route path to a leading slash and no trailing slash, `/` excepted. @internal */
function normalisePath(path: string): string {
  const withSlash = path.startsWith("/") ? path : `/${path}`;
  return withSlash.length > 1 && withSlash.endsWith("/") ? withSlash.replace(/\/+$/, "") : withSlash;
}

/** Matches a path against one exclude pattern, where `*` stands for any run of characters. @internal */
function matchesExclude(path: string, pattern: string): boolean {
  const normalised = normalisePath(pattern);
  if (!normalised.includes("*")) return normalised === path;
  const source = normalised.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${source}$`).test(path);
}

/** Sitemap priority renders with one decimal place, or two when the value needs it. @internal */
function formatPriority(priority: number): string {
  return Number.isInteger(priority * 10) ? priority.toFixed(1) : priority.toFixed(2);
}

/**
 * Filters a route-path list down to the URLs a sitemap can carry, and decorates each with its
 * configured metadata.
 *
 * Parameterised (`/case/:id`) and wildcard patterns are dropped: there is no single URL they
 * stand for. Excluded paths are dropped next, duplicates collapse, and the survivors sort so the
 * output is stable across builds.
 *
 * @public
 */
export function resolveSitemapEntries(paths: readonly string[], options: ResolveSitemapOptions): SitemapEntry[] {
  const { origin, exclude = [], entries = {} } = options;
  const seen = new Set<string>();
  const resolved: SitemapEntry[] = [];

  for (const raw of paths) {
    if (DYNAMIC_PATTERN.test(raw)) continue;
    const path = normalisePath(raw);
    if (seen.has(path)) continue;
    if (exclude.some((pattern) => matchesExclude(path, pattern))) continue;
    seen.add(path);
    resolved.push({ ...entries[path], path, loc: `${origin}${path === "/" ? "/" : path}` });
  }

  return resolved.sort((a, b) => a.path.localeCompare(b.path));
}

/** Renders a sitemap XML document from a resolved site config. @public */
export function renderSitemapXml(config: ResolvedSiteConfig): string {
  const entries = resolveSitemapEntries(config.pages, { origin: config.origin, exclude: config.sitemap.exclude, entries: config.sitemap.entries });

  const urls = entries.map((entry) => {
    const lines = [`    <loc>${escapeXml(entry.loc)}</loc>`];
    if (entry.lastmod) lines.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
    if (entry.changefreq) lines.push(`    <changefreq>${entry.changefreq}</changefreq>`);
    if (entry.priority !== undefined) lines.push(`    <priority>${formatPriority(entry.priority)}</priority>`);
    return `  <url>\n${lines.join("\n")}\n  </url>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}
