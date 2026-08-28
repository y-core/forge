/** A string literal that reads as a Tailwind class declaration. */
export interface ClassDeclaration {
  /** The literal as written, without its quotes. */
  literal: string;
  /** The tokens that made it read as classes — at least two, by construction. */
  anchors: string[];
}

const BARE = new Set(["flex", "grid", "hidden", "absolute", "relative", "static", "sticky", "fixed"]);

const FAMILY =
  /^(inline-|px-|py-|pt-|pb-|pl-|pr-|p-|mx-|my-|mt-|mb-|ml-|mr-|m-|w-|h-|size-|gap-|text-|bg-|border|rounded|opacity-|shadow-|z-|ring-|leading-|tracking-|space-)/;

const VARIANT = /^(?:[a-z][a-z0-9-]*:)+[a-z0-9[]/;

/** Whether one whitespace-separated token reads as a Tailwind utility. @public */
export function isClassAnchor(token: string): boolean {
  if (token.includes("/") || token.includes(".")) return false;
  const base = token.replace(/^(?:[a-z][a-z0-9-]*:)+/, "");
  return BARE.has(base) || FAMILY.test(base) || VARIANT.test(token);
}

/** Removes block and line comments. @public */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, "");
}

/** Every string literal in `source` that declares utility classes. @public */
export function findClassDeclarations(source: string): ClassDeclaration[] {
  const stripped = stripComments(source);
  const out: ClassDeclaration[] = [];
  for (const match of stripped.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g)) {
    const literal = match[1] ?? match[2] ?? match[3] ?? "";
    const anchors = literal.split(/\s+/).filter(isClassAnchor);
    if (anchors.length >= 2) out.push({ literal, anchors });
  }
  return out;
}

/** Every `@source` path a stylesheet declares, excluding `@source not "…"` exclusions. @public */
export function findSourceDirectives(css: string): string[] {
  const out: string[] = [];
  for (const match of css.matchAll(/@source\s+(not\s+)?["']([^"']+)["']/g)) {
    if (match[1]) continue;
    const source = match[2];
    if (source !== undefined) out.push(source);
  }
  return out;
}
