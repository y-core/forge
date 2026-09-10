// The `.ts` extensions are load-bearing: oxlint loads a plugin through Node's ESM resolver, which
// does not resolve an extensionless specifier.
import { a11yAriaBesideData } from "./rules/a11y-aria-beside-data.ts";
import { a11yHeadingSizeByClass } from "./rules/a11y-heading-size-by-class.ts";
import { a11yLabelAssociation } from "./rules/a11y-label-association.ts";
import { a11yLivePoliteness } from "./rules/a11y-live-politeness.ts";
import { a11yNoAriaReadonlyOnButton } from "./rules/a11y-no-aria-readonly-on-button.ts";
import { a11yOneLiveRegion } from "./rules/a11y-one-live-region.ts";
import { catalogWrongRawInput } from "./rules/catalog-wrong-raw-input.ts";
import { colorThemeNoRawUtility } from "./rules/color-theme-no-raw-utility.ts";
import { colorTokenOnly } from "./rules/color-token-only.ts";
import { dataSlotBeforeSpread } from "./rules/data-slot-before-spread.ts";
import { exactMarkupAssertion } from "./rules/exact-markup-assertion.ts";
import { focusRing } from "./rules/focus-ring.ts";
import { interactionFocusVisible } from "./rules/interaction-focus-visible.ts";
import { noInlineStyle } from "./rules/no-inline-style.ts";
import { noNestedCard } from "./rules/no-nested-card.ts";
import { optionalPropUndefined } from "./rules/optional-prop-undefined.ts";
import { platformEntryMotion } from "./rules/platform-entry-motion.ts";
import { platformLogicalSpacing } from "./rules/platform-logical-spacing.ts";
import { platformTextBalance } from "./rules/platform-text-balance.ts";
import { platformTextPretty } from "./rules/platform-text-pretty.ts";
import { reducedMotion } from "./rules/reduced-motion.ts";
import { spacingScaleOnly } from "./rules/spacing-scale-only.ts";
import { suppressionNeedsReason } from "./rules/suppression-needs-reason.ts";
import { typeImportExternal } from "./rules/type-import-external.ts";
import { typeImportSeparation } from "./rules/type-import-separation.ts";
import type { LintPlugin } from "./types.ts";

/** forge's rules, loaded by naming `@y-core/forge/tooling/lint` in `jsPlugins`. @public */
export const lintPlugin: LintPlugin = {
  meta: { name: "forge" },
  rules: {
    "a11y-aria-beside-data": a11yAriaBesideData,
    "a11y-heading-size-by-class": a11yHeadingSizeByClass,
    "a11y-label-association": a11yLabelAssociation,
    "a11y-live-politeness": a11yLivePoliteness,
    "a11y-no-aria-readonly-on-button": a11yNoAriaReadonlyOnButton,
    "a11y-one-live-region": a11yOneLiveRegion,
    "catalog-wrong-raw-input": catalogWrongRawInput,
    "color-theme-no-raw-utility": colorThemeNoRawUtility,
    "color-token-only": colorTokenOnly,
    "data-slot-before-spread": dataSlotBeforeSpread,
    "exact-markup-assertion": exactMarkupAssertion,
    "focus-ring": focusRing,
    "interaction-focus-visible": interactionFocusVisible,
    "no-inline-style": noInlineStyle,
    "no-nested-card": noNestedCard,
    "optional-prop-undefined": optionalPropUndefined,
    "platform-entry-motion": platformEntryMotion,
    "platform-logical-spacing": platformLogicalSpacing,
    "platform-text-balance": platformTextBalance,
    "platform-text-pretty": platformTextPretty,
    "reduced-motion": reducedMotion,
    "spacing-scale-only": spacingScaleOnly,
    "suppression-needs-reason": suppressionNeedsReason,
    "type-import-external": typeImportExternal,
    "type-import-separation": typeImportSeparation,
  },
};

export default lintPlugin;
