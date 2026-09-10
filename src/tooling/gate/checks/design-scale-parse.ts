import type { DesignSystem } from "./types";
import type { DesignScale } from "./types";

const SPACING_MULTIPLE = /^\d+(?:\.\d+)?$/;

const bare = (root: string): string => (root.startsWith("-") ? root.slice(1) : root);

/** Reads the design system for the roots, steps and tokens the plugin's rules need. @public */
export function deriveDesignScale(ds: DesignSystem): DesignScale {
  const names = ds.getClassList().map(([name]) => name);
  const compiled = ds.candidatesToCss([...names]);

  const spacingRoots = new Set<string>();
  const spacingSteps = new Set<string>();
  const colorRoots = new Set<string>();

  for (let i = 0; i < names.length; i += 1) {
    const css = compiled[i];
    if (css === null || css === undefined) continue;
    const candidate = [...ds.parseCandidate(names[i] as string)][0];
    if (candidate === undefined || candidate.kind !== "functional") continue;
    const value = candidate.value;
    if (value === undefined || value === null || value.kind !== "named") continue;

    // Asked of the compiled CSS, not guessed from the root's name: it is Tailwind that decides
    // whether `size-4` reads `--spacing` and whether `divide-red-500` reads a colour.
    if (css.includes("var(--spacing)") && SPACING_MULTIPLE.test(value.value)) {
      spacingRoots.add(bare(candidate.root));
      spacingSteps.add(value.value);
    }
    if (css.includes("var(--color-")) colorRoots.add(bare(candidate.root));
  }

  const tokens: string[] = [];
  let spacingUnit = "";
  for (const [name, entry] of ds.theme.entries()) {
    if (name === "--spacing") spacingUnit = entry.value;
    else if (name.startsWith("--color-")) tokens.push(name.slice("--color-".length));
  }

  return {
    spacingUnit,
    spacingRoots: [...spacingRoots].sort(),
    spacingSteps: [...spacingSteps].sort((a, b) => Number(a) - Number(b)),
    colorRoots: [...colorRoots].sort(),
    colorTokens: [...new Set(tokens)].sort(),
  };
}

const BANNER = "/** design-scale.ts — GENERATED — do not edit; run `bun run gen:design-scale`. */";

const quote = (value: string): string => JSON.stringify(value);

const list = (name: string, doc: string, values: readonly string[]): string =>
  [`/** ${doc} */`, `export const ${name}: readonly string[] = [`, `${values.map((value) => `  ${quote(value)}`).join(",\n")},`, "];"].join("\n");

/** Renders the derived scale as the committed, dependency-free module. @public */
export function renderDesignScale(scale: DesignScale): string {
  return [
    BANNER,
    "",
    "/** The `--spacing` step size, verbatim. */",
    `export const SPACING_UNIT = ${quote(scale.spacingUnit)};`,
    "",
    list("SPACING_ROOTS", "Every utility root whose named value is a multiple of `--spacing`.", scale.spacingRoots),
    "",
    list("SPACING_STEPS", "Every multiplier the spacing scale enumerates, ascending.", scale.spacingSteps),
    "",
    list("COLOR_ROOTS", "Every utility root that resolves a `--color-*` theme entry.", scale.colorRoots),
    "",
    list("COLOR_TOKENS", "Every colour token the theme declares, `--color-` stripped.", scale.colorTokens),
    "",
  ].join("\n");
}
