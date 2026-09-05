import { classLiteralVisitor } from "../ast.ts";
import { COLOR_ROOTS, COLOR_TOKENS } from "../data/design-scale.ts";
import { reporter } from "../report.ts";
import type { LintRule } from "../types.ts";

const ROOTS = new Set(COLOR_ROOTS);

const TOKENS = new Set(COLOR_TOKENS);

// The palette is declared in its `--color-` form only, so no palette entry resolves bare.
const PALETTE_TOKEN = /^(?:black|white)$|-\d+$/;

const BARE_TOKENS = new Set(COLOR_TOKENS.filter((token) => !PALETTE_TOKEN.test(token)));

// A bare `shadow-(--x)` sets `--tw-shadow`, not a colour: a shadow family is a colour position only
// in its explicit `shadow-(color:--x)` form, which `CUSTOM_PROPERTY` does not match.
const SHADOW_ROOTS = new Set(["shadow", "inset-shadow", "drop-shadow", "text-shadow"]);

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/g;

// `tone.ts` declares these with `[--tone:…]` utilities, which never reach the compiled `@theme` and
// so never appear in the generated scale; oxlint runs per file, so the declaration is unreachable.
const DECLARED_PROPERTIES = new Set(["--tone", "--tone-fg", "--tone-text", "--tone-soft", "--tone-soft-fg", "--tone-soft-border"]);

// Both spellings Tailwind accepts for a custom property: `bg-[--x]` and the newer `bg-(--x)`.
const CUSTOM_PROPERTY = /(?<![\w-])(?:[a-z][a-z0-9-]*:)*(-?[a-z][a-z0-9-]*)-[[(](--[a-z0-9-]+)[\])]/g;

/** A raw colour literal in a class string, or a colour utility resolving a property the theme does
 *  not declare — either way, a colour that no semantic token stands behind. */
export const colorTokenOnly: LintRule = {
  meta: {
    type: "problem",
    docs: { description: "A colour is resolved through a semantic token, so the theme — and every mode it has — decides what is painted." },
  },
  create(context) {
    const report = reporter(context, "forge-ui-color-token-only");
    return classLiteralVisitor((found) => {
      const literals = new Set<string>();
      for (const match of found.text.matchAll(COLOR_LITERAL)) literals.add(match[0]);
      for (const literal of literals) {
        report(`raw colour literal \`${literal}\` in a class string — resolve the colour through a semantic token`, found.loc);
      }

      const undeclared = new Set<string>();
      for (const match of found.text.matchAll(CUSTOM_PROPERTY)) {
        const root = (match[1] ?? "").replace(/^-/, "");
        const property = match[2] ?? "";
        if (!ROOTS.has(root) || SHADOW_ROOTS.has(root) || DECLARED_PROPERTIES.has(property)) continue;
        const declared = property.startsWith("--color-") ? TOKENS.has(property.slice("--color-".length)) : BARE_TOKENS.has(property.slice(2));
        if (declared) continue;
        undeclared.add(`${root}|${property}`);
      }
      for (const hit of undeclared) {
        const [root = "", property = ""] = hit.split("|");
        report(`\`${root}-(${property})\` names a property the theme declares no colour token for`, found.loc);
      }
    });
  },
};
