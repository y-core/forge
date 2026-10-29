import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, matchesGlob, resolve, sep } from "node:path";

import { peer } from "./peers";
import type { CssDeclaration, CssRootMode, CssSourceDeclaration } from "./types";

type CompiledRoot = null | "none" | { base: string; pattern: string };

type TailwindCompile = (css: string, options: object) => Promise<{ root: CompiledRoot; sources: readonly CssSourceDeclaration[] }>;

const GLOB_SYNTAX = /[*?[\]{}]/;

function rootMode(root: CompiledRoot): CssRootMode {
  if (root === "none") return "none";
  return root === null ? "auto" : "explicit";
}

type ExportTarget = string | null | readonly ExportTarget[] | { readonly [condition: string]: ExportTarget };

const STYLE_CONDITIONS = new Set(["style", "default"]);

function conditionalTarget(target: ExportTarget | undefined): string | undefined {
  if (target === undefined || target === null) return undefined;
  if (typeof target === "string") return target;
  if (Array.isArray(target)) return target.map(conditionalTarget).find((found) => found !== undefined);
  for (const [condition, nested] of Object.entries(target as Record<string, ExportTarget>)) {
    if (!STYLE_CONDITIONS.has(condition)) continue;
    const found = conditionalTarget(nested);
    if (found !== undefined) return found;
  }
  return undefined;
}

function exportedTarget(exports: ExportTarget, subpath: string): string | undefined {
  if (typeof exports === "string" || Array.isArray(exports)) return subpath === "." ? conditionalTarget(exports) : undefined;
  const map = exports as Record<string, ExportTarget>;
  if (!Object.keys(map).some((key) => key.startsWith("."))) return subpath === "." ? conditionalTarget(exports) : undefined;
  if (subpath in map) return conditionalTarget(map[subpath]);
  for (const [key, target] of Object.entries(map)) {
    const star = key.indexOf("*");
    if (star === -1) continue;
    const [prefix, suffix] = [key.slice(0, star), key.slice(star + 1)];
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix) || subpath.length < key.length - 1) continue;
    const found = conditionalTarget(target);
    if (found !== undefined) return found.replaceAll("*", subpath.slice(prefix.length, subpath.length - suffix.length));
  }
  return undefined;
}

function packageDirectory(name: string, base: string): string | undefined {
  for (let dir = base; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (dirname(dir) === dir) return undefined;
  }
}

function packageStylesheet(id: string, base: string): string | undefined {
  const segments = id.split("/");
  const name = segments.slice(0, id.startsWith("@") ? 2 : 1).join("/");
  const rest = id.slice(name.length);
  const dir = packageDirectory(name, base);
  if (dir === undefined) return undefined;
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as { exports?: ExportTarget; style?: string };
  if (manifest.exports !== undefined) {
    const target = exportedTarget(manifest.exports, `.${rest}`);
    return target === undefined ? undefined : join(dir, target);
  }
  const relativePath = rest === "" ? (manifest.style ?? "index.css") : rest.slice(1);
  return [join(dir, relativePath), join(dir, `${relativePath}.css`)].find((path) => existsSync(path));
}

// Tailwind's loader resolves a package from the importing stylesheet with the `style` condition, never from this module.
/** The real path of the stylesheet an `@import` of `id` names, resolved from the importing stylesheet's directory `base`. @internal */
export function stylesheetPath(id: string, base: string): string {
  if (id.startsWith(".") || id.startsWith("/")) return resolve(base, id);
  const path = packageStylesheet(id, base);
  if (path === undefined || !existsSync(path)) throw new Error(`\`@import "${id}"\` resolves to no stylesheet from ${base}.`);
  return realpathSync(path);
}

/** Compiles the stylesheet at `entry` and reads back what it tells Tailwind to scan. @internal */
export async function readCssDeclaration(entry: string): Promise<CssDeclaration> {
  const { compile } = await peer<{ compile: TailwindCompile }>("tailwindcss", "css", "a stylesheet's `@source` declaration");
  const stylesheets = new Set([entry]);

  const loadStylesheet = async (id: string, base: string): Promise<{ path: string; base: string; content: string }> => {
    const path = stylesheetPath(id, base);
    stylesheets.add(path);
    return { path, base: dirname(path), content: readFileSync(path, "utf-8") };
  };

  const compiled = await compile(readFileSync(entry, "utf-8"), {
    base: dirname(entry),
    from: entry,
    loadStylesheet,
    loadModule: (id: string) => {
      throw new Error(`\`${id}\` was loaded as a module: a \`@source\` declaration is read without running \`@plugin\` or \`@config\`.`);
    },
  });

  return {
    root: rootMode(compiled.root),
    sources: compiled.sources.map(({ base, pattern, negated }) => ({ base, pattern, negated })),
    stylesheets: [...stylesheets],
  };
}

/** Whether the absolute `path` is one `source` names — any file beneath a directory, or a glob's match. @internal */
export function cssSourceMatches(source: CssSourceDeclaration, path: string): boolean {
  const target = resolve(source.base, source.pattern);
  if (GLOB_SYNTAX.test(source.pattern)) return matchesGlob(path, target);
  return path === target || path.startsWith(target + sep);
}

/** Whether the absolute `path` is matched by a declared source and by no `@source not`. @internal */
export function isCssSourceCovered(sources: readonly CssSourceDeclaration[], path: string): boolean {
  const matching = sources.filter((source) => cssSourceMatches(source, path));
  return matching.some((source) => !source.negated) && !matching.some((source) => source.negated);
}
