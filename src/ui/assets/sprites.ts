import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SpriteSource } from "../../assets/types";

// `panel-open`/`panel-close` serves all four cases and mirrored under `rtl:`
const FORGE_UI_SPRITE_FILES = {
  core: ["spinner", "chevron-down", "hamburger", "close", "panel-open", "panel-close"],
  theme: ["sun", "moon", "monitor"],
} as const;

/** Union of forge UI glyph names. @public */
export type ForgeUiIconName = (typeof FORGE_UI_SPRITE_FILES)[keyof typeof FORGE_UI_SPRITE_FILES][number];

/** All forge UI glyph names — the complete set the `controls/` and `chrome/` components need. @public */
export const FORGE_UI_ICON_NAMES: readonly ForgeUiIconName[] = Object.values(FORGE_UI_SPRITE_FILES).flat();

const DIR = fileURLToPath(new URL(".", import.meta.url));

/** Returns absolute `SpriteSource` entries for all forge UI glyphs; build-time only. @public */
export function forgeUiSpriteSources(): SpriteSource[] {
  return Object.entries(FORGE_UI_SPRITE_FILES).map(([group, names]) => ({ path: join(DIR, group), files: names.map((name) => `${name}.svg`) }));
}
