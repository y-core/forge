import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** A node of the AST `candidatesToAst` returns; only the shapes a derivation reads are named. @public */
export interface CssNode {
  kind: string;
  property?: string;
  name?: string;
  nodes?: readonly CssNode[];
}

/** The subset of Tailwind's design system forge's derivations call. @public */
export interface DesignSystem {
  candidatesToAst: (candidates: string[]) => readonly (readonly CssNode[] | null)[];
  candidatesToCss: (candidates: string[]) => readonly (string | null)[];
  parseCandidate: (candidate: string) => Iterable<{ kind: string; root: string; value?: { kind: string; value: string } | null }>;
  getClassList: () => readonly (readonly [string, unknown])[];
  utilities: { keys: (kind: "static" | "functional") => readonly string[] };
  theme: { entries: () => Iterable<readonly [string, { value: string }]> };
}

/** Whether `tailwindcss` can be resolved — a derivation is unrunnable without it, and it is an optional peer. @public */
export function hasTailwind(): boolean {
  try {
    import.meta.resolve("tailwindcss");
    return true;
  } catch {
    return false;
  }
}

/** Turns a `file://` URL into a path, and leaves a path alone. @public */
export const fileURLToPathish = (url: string): string => (url.startsWith("file://") ? new URL(url).pathname : url);

/** Whether an `@import` id names a package rather than a path — the two halves of one resolution rule. @public */
export const isBareSpecifier = (id: string): boolean => !id.startsWith(".") && !id.startsWith("/");

// `loadModule` throws rather than returning a stub: forge's stylesheet uses no `@plugin`/`@config`,
// and a silent no-op would hide the day it does.
/** Compiles the stylesheet at `entry` into the design system it declares. @public */
export async function loadDesignSystem(entry: string): Promise<DesignSystem> {
  const { __unstable__loadDesignSystem } = (await import("tailwindcss")) as {
    __unstable__loadDesignSystem: (css: string, options: unknown) => Promise<DesignSystem>;
  };

  const loadStylesheet = async (id: string, base: string): Promise<{ path: string; base: string; content: string }> => {
    const path = isBareSpecifier(id)
      ? fileURLToPathish(import.meta.resolve(id === "tailwindcss" ? "tailwindcss/index.css" : id))
      : resolve(base, id);
    return { path, base: dirname(path), content: readFileSync(path, "utf-8") };
  };

  return __unstable__loadDesignSystem(readFileSync(entry, "utf-8"), {
    base: dirname(entry),
    loadStylesheet,
    loadModule: (id: string) => {
      throw new Error(`\`${id}\` was loaded as a module: this design system is expected to use no \`@plugin\` or \`@config\`.`);
    },
  });
}

/** The comparable form of a generated module: layout removed, content kept. @public */
export const canonical = (source: string): string => source.replace(/\s+/g, "").replace(/,([\]}])/g, "$1");
