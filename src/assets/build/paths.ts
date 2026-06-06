import { relative, resolve } from "node:path";

/**
 * Joins `segments` onto `base`, throwing if the resolved result escapes the base directory.
 *
 * Use in place of `join(base, ...segments)` for any path that comes from user-supplied config
 * (copy destinations, sprite targets, font download paths, JS output dirs). Source reads
 * (`from`, `url`, remote sprite `source.path`) are intentionally unrestricted.
 */
export function safeJoin(base: string, ...segments: string[]): string {
  const root = resolve(base);
  const target = segments.length === 0 ? root : resolve(root, ...segments);
  // relative() returns a path starting with ".." when target escapes root.
  // An empty string means target === root, which is allowed.
  const rel = relative(root, target);
  if (rel.startsWith("..")) {
    throw new Error(`[forge-assets] path "${segments.join("/")}" escapes the asset root "${base}"`);
  }
  return target;
}
