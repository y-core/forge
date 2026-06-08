/**
 * Joins a base path with zero or more segments into a clean URL path. Collapses
 * duplicate slashes between parts and trims a trailing slash; preserves a leading
 * slash when `base` has one. `joinPath("/showcase/")` → `"/showcase"`;
 * `joinPath("/showcase/ui/api", "preview")` → `"/showcase/ui/api/preview"`. @public
 */
export function joinPath(base: string, ...segments: string[]): string {
  const parts = [base, ...segments].map((s) => s.replace(/^\/+|\/+$/g, "")).filter((s) => s.length > 0);
  const joined = parts.join("/");
  return base.startsWith("/") ? `/${joined}` : joined;
}
