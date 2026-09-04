// The `.ts` extensions are load-bearing: oxlint loads a plugin through Node's ESM resolver, which
// does not resolve an extensionless specifier.
import { a11yHeadingSizeByClass } from "./lint/rules/a11y-heading-size-by-class.ts";
import { colorTokenOnly } from "./lint/rules/color-token-only.ts";
import { platformEntryMotion } from "./lint/rules/platform-entry-motion.ts";
import { platformLogicalSpacing } from "./lint/rules/platform-logical-spacing.ts";
import { platformTextBalance } from "./lint/rules/platform-text-balance.ts";
import { platformTextPretty } from "./lint/rules/platform-text-pretty.ts";
import { reducedMotion } from "./lint/rules/reduced-motion.ts";
import { spacingScaleOnly } from "./lint/rules/spacing-scale-only.ts";
import { suppressionNeedsReason } from "./lint/rules/suppression-needs-reason.ts";
import type { LintPlugin } from "./lint/types.ts";

/** forge's rules, loaded by naming `@y-core/forge/cli/pkg/lint` in `jsPlugins`. @public */
export const lintPlugin: LintPlugin = {
  meta: { name: "forge" },
  rules: {
    "a11y-heading-size-by-class": a11yHeadingSizeByClass,
    "color-token-only": colorTokenOnly,
    "platform-entry-motion": platformEntryMotion,
    "platform-logical-spacing": platformLogicalSpacing,
    "platform-text-balance": platformTextBalance,
    "platform-text-pretty": platformTextPretty,
    "reduced-motion": reducedMotion,
    "spacing-scale-only": spacingScaleOnly,
    "suppression-needs-reason": suppressionNeedsReason,
  },
};

export default lintPlugin;
