import type { Child, FC } from "hono/jsx";
import { createContext, useContext } from "hono/jsx";

const IconSpriteContext = createContext<string>("");

interface IconSpriteProviderProps {
  sprite: string;
  children: Child;
}

export const IconSpriteProvider: FC<IconSpriteProviderProps> = ({ sprite, children }) => (
  <IconSpriteContext.Provider value={sprite}>{children}</IconSpriteContext.Provider>
);

export function useIconSprite(): string {
  return useContext(IconSpriteContext);
}
