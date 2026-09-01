import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { resolveSiteConfig } from "../../site/config";
import { renderRobotsTxt } from "../../site/robots";
import { renderSitemapXml } from "../../site/sitemap";
import { SITE_OUTPUTS, type SiteBuildConfig } from "../types";

/**
 * Renders `robots.txt` and `sitemap.xml` into the asset-tree root, so both are served as static
 * assets and cost the Worker no invocation.
 *
 * Neither file gets a `Cache-Control` line here. `_headers` is written wholesale by the pipeline's
 * `emitHeaders`, which truncates — a second writer would silently drop the `/assets/*` rule. A
 * cache line for these two belongs in `emitHeaders`, not beside them.
 *
 * @public
 */
export function buildSite(config: SiteBuildConfig): void {
  const resolved = resolveSiteConfig(config.config);
  mkdirSync(config.outDir, { recursive: true });

  writeFileSync(join(config.outDir, "robots.txt"), renderRobotsTxt(resolved));
  writeFileSync(join(config.outDir, "sitemap.xml"), renderSitemapXml(resolved));

  for (const file of SITE_OUTPUTS) console.log(`✓ site: ${file}`);
}
