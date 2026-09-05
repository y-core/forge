import { classExpressionVisitor } from "../ast.ts";
import { reporter } from "../report.ts";
import type { LintRule } from "../types.ts";

const PALETTE_HUES =
  "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone";

const COLOR_UTILITIES = "bg|text|border|ring|from|via|to|fill|stroke|divide|outline|decoration|accent|caret|placeholder|shadow";

const PALETTE_UTILITY = new RegExp(`(?<![\\w-])((?:[a-z][a-z0-9-]*:)*)(${COLOR_UTILITIES})-(${PALETTE_HUES})-(?:50|[1-9]00|950)(?![\\w-])`, "g");

/** A raw Tailwind palette utility with no `dark:` counterpart in the same class expression, which
 *  is what makes it survive the theme switch unchanged. */
export const colorThemeNoRawUtility: LintRule = {
  meta: { type: "problem", docs: { description: "A raw palette utility is paired with its `dark:` counterpart, or replaced by a theme token." } },
  create(context) {
    const report = reporter(context, "forge-ui-color-theme-no-raw-utility");
    return classExpressionVisitor((found) => {
      const paired = new Set<string>();
      const bare = new Map<string, string>();

      for (const match of found.text.matchAll(PALETTE_UTILITY)) {
        const family = `${match[2]}-${match[3]}`;
        if ((match[1] ?? "").split(":").includes("dark")) paired.add(family);
        else if (!bare.has(family)) bare.set(family, match[0]);
      }

      for (const [family, written] of bare) {
        if (paired.has(family)) continue;
        report(`\`${written}\` has no \`dark:${family}-*\` counterpart beside it — a raw palette utility survives the theme switch`, found.loc);
      }
    });
  },
};
