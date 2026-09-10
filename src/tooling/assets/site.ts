import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { resolveSiteConfig } from "../../site/config";
import { renderRobotsTxt } from "../../site/robots";
import { renderSitemapXml } from "../../site/sitemap";
import { SITE_OUTPUTS } from "./types";
import type { SiteBuildConfig } from "./types";

/** Renders `robots.txt` and `sitemap.xml` into the asset-tree root, so both are served as static assets. @public */
export function buildSite(config: SiteBuildConfig): void {
  const resolved = resolveSiteConfig(config.config);
  mkdirSync(config.outDir, { recursive: true });

  writeFileSync(join(config.outDir, "robots.txt"), renderRobotsTxt(resolved));
  writeFileSync(join(config.outDir, "sitemap.xml"), renderSitemapXml(resolved));

  for (const file of SITE_OUTPUTS) console.log(`✓ site: ${file}`);
}
