import type { SiteConfig } from "@y-core/forge/site";
import type { AssetsConfig } from "@y-core/forge/tooling/assets/types";

export type AssetsSiteBlock = (site: SiteConfig) => AssetsConfig;
