import type { Manifest } from "./manifest";

export interface SpriteRegistry {
  get(name: string): string;
}

export function createSpriteRegistry(sprites: Record<string, string>, manifest: Manifest): SpriteRegistry {
  return {
    get(name: string): string {
      const path = sprites[name];
      if (!path) throw new Error(`Unknown sprite group: "${name}"`);
      return manifest.path(path);
    },
  };
}
