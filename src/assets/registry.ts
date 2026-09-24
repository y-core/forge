import type { Manifest } from "./types";
import type { SpriteRegistry } from "./types";

/** Creates a sprite registry over `sprites`, throwing on an unknown group name. @public */
export function createSpriteRegistry(sprites: Record<string, string>, manifest: Manifest): SpriteRegistry {
  return {
    get(name: string): string {
      const path = sprites[name];
      if (!path) throw new Error(`Unknown sprite group: "${name}"`);
      return manifest.path(path);
    },
  };
}
