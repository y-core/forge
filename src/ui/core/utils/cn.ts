export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

/** Narrows a JSX `class` prop (which may be a non-string) to `string | undefined`. */
export function asClass(cls: unknown): string | undefined {
  return typeof cls === "string" ? cls : undefined;
}
