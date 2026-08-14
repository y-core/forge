import { relative, resolve } from "node:path";

/** Joins `segments` onto `base`, throwing if the result escapes the base directory. */
export function safeJoin(base: string, ...segments: string[]): string {
  const root = resolve(base);
  const target = segments.length === 0 ? root : resolve(root, ...segments);
  const rel = relative(root, target);
  if (rel.startsWith("..")) {
    throw new Error(`[forge-assets] path "${segments.join("/")}" escapes the asset root "${base}"`);
  }
  return target;
}
