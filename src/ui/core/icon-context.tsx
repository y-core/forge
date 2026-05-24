import type { Child, FC } from "hono/jsx";
import { createContext, useContext } from "hono/jsx";

interface IconSpriteProviderProps {
  sprite: string;
  children: Child;
}

const IconSpriteContext = createContext<string>("");

export const IconSpriteProvider: FC<IconSpriteProviderProps> = ({ sprite, children }) => (
  <IconSpriteContext.Provider value={sprite}>{children}</IconSpriteContext.Provider>
);

/** @internal Used only by Icon — not part of the public API. */
export function useIconSprite(): string {
  return useContext(IconSpriteContext);
}
