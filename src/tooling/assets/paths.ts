import { relative, resolve, sep } from "node:path";

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

/** The directory a deploy uploads: the top-level segment of `publicDir` under `root`, and `root` itself when there is none. @internal */
export function deployRoot(root: string, publicDir: string): string {
  const rel = relative(resolve(root), resolve(publicDir));
  // An escaping `publicDir` has no deploy root at all — the directory a deploy uploads is not this
  // tree, so answering `root` drops `_headers` beside assets it does not sit with.
  if (rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error(
      `[forge-assets] paths.publicDir "${publicDir}" is outside root "${root}" — a deploy uploads a directory under the root, ` +
        "so there is no deploy root to write _headers into. Move publicDir under the root, or set root to the directory you deploy.",
    );
  }
  const top = rel.split(sep)[0];
  // `dirname` on a single-segment `publicDir` is a step upward out of the app entirely.
  if (top === undefined || top === "") return resolve(root);
  return safeJoin(root, top);
}
