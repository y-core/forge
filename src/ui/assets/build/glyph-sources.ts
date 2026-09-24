import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { SpriteSource } from "../../../tooling/assets/types";
import { FORGE_UI_SPRITE_FILES } from "../glyphs";

const DIR = fileURLToPath(new URL("..", import.meta.url));

/** Returns absolute `SpriteSource` entries for all forge UI glyphs; build-time only. @public */
export function forgeUiSpriteSources(): SpriteSource[] {
  return Object.entries(FORGE_UI_SPRITE_FILES).map(([group, names]) => ({ path: join(DIR, group), files: names.map((name) => `${name}.svg`) }));
}
