import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SpriteSource } from "../../assets/types";

/** All forge UI glyph names — the complete set the `controls/` and `chrome/` components need. @public */
export const FORGE_UI_ICON_NAMES = ["spinner", "chevron-down", "hamburger", "close", "sun", "moon", "monitor"] as const;

/** Union of forge UI glyph names. @public */
export type ForgeUiIconName = (typeof FORGE_UI_ICON_NAMES)[number];

const DIR = fileURLToPath(new URL(".", import.meta.url));

/**
 * Returns absolute `SpriteSource` entries for all forge UI glyphs. Spread into a consumer's
 * `forgeAssetsConfig` sprite sources to avoid manually listing `node_modules` paths:
 *
 * ```ts
 * import { forgeUiSpriteSources } from "@y-core/forge/ui/assets";
 * // in your config:
 * sources: [...forgeUiSpriteSources(), { path: "src/assets/svg", files: [...] }]
 * ```
 *
 * Build-time only — safe to import from `config.ts` (Node environment). @public
 */
export function forgeUiSpriteSources(): SpriteSource[] {
  return [
    { path: join(DIR, "core"), files: ["spinner.svg", "chevron-down.svg", "hamburger.svg", "close.svg"] },
    { path: join(DIR, "theme"), files: ["sun.svg", "moon.svg", "monitor.svg"] },
  ];
}
