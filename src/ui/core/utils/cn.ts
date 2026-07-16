/**
 * Joins class-name fragments into a single space-separated string, dropping any
 * falsy entries (`false`/`null`/`undefined`). The canonical way to merge a
 * component's base classes with a caller-supplied `class`. @public
 */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

/** Narrows a JSX `class` prop (which may be a non-string) to `string | undefined`. @public */
export function asClass(cls: unknown): string | undefined {
  return typeof cls === "string" ? cls : undefined;
}
