import { classLiteralVisitor } from "../ast.ts";
import { reporter } from "../report.ts";
import type { LintRule } from "../types.ts";

// The inline axis only, and only the utilities Tailwind gives a logical spelling: a block-axis
// rewrite changes no rendering in any writing mode forge ships, so mirroring is the whole point.
const PHYSICAL_UTILITY =
  /(?<![\w-])(?:[a-z][a-z0-9-]*:)*-?(?:[mp][lr]-[a-z0-9./[\]()%-]+|(?:border|rounded)-[lr](?![a-z])[a-z0-9./[\]()%-]*|text-(?:left|right))(?![\w])/g;

const UTILITY_SWAP: readonly (readonly [RegExp, string])[] = [
  [/^ml-/, "ms-"],
  [/^mr-/, "me-"],
  [/^pl-/, "ps-"],
  [/^pr-/, "pe-"],
  [/^border-l\b/, "border-s"],
  [/^border-r\b/, "border-e"],
  [/^rounded-l\b/, "rounded-s"],
  [/^rounded-r\b/, "rounded-e"],
  [/^text-left$/, "text-start"],
  [/^text-right$/, "text-end"],
];

/** The logical spelling of a physical Tailwind utility, variants preserved. */
export function logicalUtility(token: string): string {
  const variants = token.slice(0, token.lastIndexOf(":") + 1);
  const signed = token.slice(variants.length);
  const sign = signed.startsWith("-") ? "-" : "";
  const base = signed.slice(sign.length);
  for (const [physical, logical] of UTILITY_SWAP) {
    if (physical.test(base)) return `${variants}${sign}${base.replace(physical, logical)}`;
  }
  return token;
}

/** A physical Tailwind utility, which does not mirror in a right-to-left writing mode. */
export const platformLogicalSpacing: LintRule = {
  meta: {
    type: "problem",
    docs: { description: "Inline-axis spacing is written logically, so the layout mirrors with the writing mode instead of staying left-handed." },
  },
  create(context) {
    const report = reporter(context, "forge-ui-platform-logical-spacing");
    return classLiteralVisitor((found) => {
      const hits = new Set<string>();
      for (const match of found.text.matchAll(PHYSICAL_UTILITY)) hits.add(match[0]);
      for (const hit of hits) report(`physical utility \`${hit}\` — use \`${logicalUtility(hit)}\``, found.loc);
    });
  },
};
