/** Resolves a logical asset path to its public, content-hashed URL. @public */
export interface Manifest {
  path(key: string): string;
}

/** Resolves a sprite group name to its public sprite sheet URL. @public */
export interface SpriteRegistry {
  get(name: string): string;
}
