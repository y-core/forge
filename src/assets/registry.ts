import type { Manifest } from "./manifest";

/** Resolves a sprite group name to its public sprite sheet URL. @public */
export interface SpriteRegistry {
  get(name: string): string;
}

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
