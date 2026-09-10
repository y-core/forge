import type { RuleEnforcer, RuleId } from "./types";

/** The corpus file that justifies each rule this tooling enforces. @public */
export const RULE_CORPUS_PATH: Readonly<Record<RuleId, string>> = {
  "forge-ui-color-token-only": "src/ui/design/floor.md",
  "forge-ui-color-theme-no-raw-utility": "src/ui/design/reference/04-color.md",
  "forge-ui-no-inline-style": "src/ui/design/floor.md",
  "forge-ui-spacing-scale-only": "src/ui/design/floor.md",
  "forge-ui-no-nested-card": "src/ui/design/floor.md",
  "forge-ui-interaction-focus-visible": "src/ui/design/reference/09-interaction.md",
  "forge-ui-catalog-wrong-raw-input": "src/ui/design/catalog.md",
  "forge-ui-contrast-floor": "src/ui/design/floor.md",
  "forge-ui-a11y-label-association": "src/ui/design/floor.md",
  "forge-ui-a11y-live-politeness": "src/ui/design/reference/10-accessibility.md",
  "forge-ui-a11y-no-aria-readonly-on-button": "src/ui/design/reference/10-accessibility.md",
  "forge-ui-a11y-one-live-region": "src/ui/design/reference/10-accessibility.md",
  "forge-ui-a11y-aria-beside-data": "src/ui/design/reference/10-accessibility.md",
  "forge-ui-a11y-heading-size-by-class": "src/ui/design/reference/10-accessibility.md",
  "forge-ui-reduced-motion": "src/ui/design/floor.md",
  "forge-ui-focus-ring": "src/ui/design/floor.md",
  "forge-ui-optional-prop-undefined": "src/ui/design/reference/10-accessibility.md",
};

// This is what keeps a `RULE_CORPUS_PATH` row from asserting nothing once its detector has moved:
// `checkDesign` reads the enforcer to decide which side it holds the row against.
/** The mechanism that enforces each rule. @public */
export const RULE_ENFORCER: Readonly<Record<RuleId, RuleEnforcer>> = {
  "forge-ui-color-token-only": "lint",
  "forge-ui-color-theme-no-raw-utility": "lint",
  "forge-ui-no-inline-style": "lint",
  "forge-ui-spacing-scale-only": "lint",
  "forge-ui-no-nested-card": "lint",
  "forge-ui-interaction-focus-visible": "lint",
  "forge-ui-catalog-wrong-raw-input": "lint",
  "forge-ui-contrast-floor": "contrast",
  "forge-ui-a11y-label-association": "lint",
  "forge-ui-a11y-live-politeness": "lint",
  "forge-ui-a11y-no-aria-readonly-on-button": "lint",
  "forge-ui-a11y-one-live-region": "lint",
  "forge-ui-a11y-aria-beside-data": "lint",
  "forge-ui-a11y-heading-size-by-class": "lint",
  "forge-ui-reduced-motion": "lint",
  "forge-ui-focus-ring": "lint",
  "forge-ui-optional-prop-undefined": "lint",
};

const PREFIX = "forge-ui-";

/** The oxlint plugin rule key a corpus id is enforced under — the id minus its `forge-ui-` prefix. @public */
export function lintKeyOf(id: string): string {
  return id.slice(PREFIX.length);
}

/** The corpus id a plugin rule key belongs to, or `undefined` when the register names no such rule. @public */
export function corpusIdOf(key: string): RuleId | undefined {
  const id = `${PREFIX}${key}`;
  return id in RULE_CORPUS_PATH ? (id as RuleId) : undefined;
}
