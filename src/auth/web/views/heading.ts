import type { AuthViewChrome } from "./types";

/** The level of a heading nested one below a view's own, held at `6`. @internal */
export function nestedHeadingLevel(level: NonNullable<AuthViewChrome["level"]>): NonNullable<AuthViewChrome["level"]> {
  return Math.min(level + 1, 6) as NonNullable<AuthViewChrome["level"]>;
}
