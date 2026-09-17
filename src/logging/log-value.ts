/** Renders `url` as its origin and path, dropping the query and fragment. @internal */
export function logSafeUrl(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

/** `JSON.stringify` replacer that narrows every `URL` through `logSafeUrl`. @internal */
export function urlNarrowing(this: unknown, key: string, value: unknown): unknown {
  // The replacer's `value` has already been through `toJSON`, so only the holder still tells a URL from a string.
  const held = (this as Record<string, unknown> | undefined)?.[key];
  return held instanceof URL ? logSafeUrl(held) : value;
}
