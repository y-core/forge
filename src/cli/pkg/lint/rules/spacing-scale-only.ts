import { classLiteralVisitor } from "../ast.ts";
import { SPACING_ROOTS, SPACING_STEPS, SPACING_UNIT } from "../data/design-scale.ts";
import { reporter } from "../report.ts";
import type { LintRule } from "../types.ts";

const ROOTS = new Set(SPACING_ROOTS);

const ARBITRARY = /(?<![\w-])(?:[a-z][a-z0-9-]*:)*(-?)([a-z][a-z0-9-]*)-\[([^\]\s]+)\]/g;

const LENGTH = /^(-?\d+(?:\.\d+)?)(px|rem)$/;

const PIXELS_PER_REM = 16;

/** The `--spacing` step size in pixels, or `NaN` when the theme states it in a unit this cannot read. */
const unitPx = ((): number => {
  const unit = LENGTH.exec(SPACING_UNIT);
  if (unit === null) return Number.NaN;
  return Number(unit[1]) * (unit[2] === "rem" ? PIXELS_PER_REM : 1);
})();

const STEPS = new Set(SPACING_STEPS);

/** The scale step an arbitrary length is exactly equal to, or `undefined` when the scale has none. */
function stepFor(value: string): string | undefined {
  const length = LENGTH.exec(value);
  if (length === null || Number.isNaN(unitPx)) return undefined;
  const pixels = Number(length[1]) * (length[2] === "rem" ? PIXELS_PER_REM : 1);
  const multiple = Math.abs(pixels) / unitPx;
  return STEPS.has(String(multiple)) ? String(multiple) : undefined;
}

/** An arbitrary length on a spacing utility where the scale already states that value. */
export const spacingScaleOnly: LintRule = {
  meta: {
    type: "problem",
    docs: { description: "Spacing comes from the scale the design system declares, so one edit to `--spacing` moves the whole layout." },
  },
  create(context) {
    const report = reporter(context, "forge-ui-spacing-scale-only");
    return classLiteralVisitor((found) => {
      const hits = new Set<string>();
      for (const match of found.text.matchAll(ARBITRARY)) {
        const [, sign = "", root = "", value = ""] = match;
        if (!ROOTS.has(root)) continue;
        const step = stepFor(value);
        if (step === undefined) continue;
        hits.add(`${sign}${root}-[${value}]|${sign}${root}-${step}`);
      }
      for (const hit of hits) {
        const [written = "", scale = ""] = hit.split("|");
        report(`arbitrary value \`${written}\` where the scale states \`${scale}\``, found.loc);
      }
    });
  },
};
