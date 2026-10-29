import { classLiteralVisitor } from "../ast.ts";
import { reporter } from "../report.ts";
import type { LintRule } from "../types.ts";

/** Every key `STATE_ATTRS` registers, which is what a styling hook is read from. */
export const STATE_ATTR_KEYS: readonly string[] = [
  "pressed",
  "checked",
  "selected",
  "disabled",
  "invalid",
  "busy",
  "orientation",
  "side",
  "align",
  "instant",
  "dismissing",
  "state",
];

const ARIA_STATE = new RegExp(`(?<![a-z0-9])aria-\\[?(${STATE_ATTR_KEYS.join("|")})(?![a-z0-9-])`);

/** A Tailwind variant that styles from an `aria-*` state `STATE_ATTRS` gives a `data-*` hook. */
export const a11yStateAttrsSource: LintRule = {
  meta: {
    type: "problem",
    docs: { description: "State is read in CSS from the `data-*` hook `STATE_ATTRS` registers, never from its `aria-*` counterpart." },
  },
  create(context) {
    const report = reporter(context, "forge-ui-a11y-state-attrs-source");
    return classLiteralVisitor((found) => {
      const hits = new Map<string, string>();
      for (const token of found.text.split(/\s+/)) {
        const state = ARIA_STATE.exec(token.slice(0, Math.max(token.lastIndexOf(":"), 0)))?.[1];
        if (state !== undefined) hits.set(token, state);
      }
      for (const [token, state] of hits) {
        report(`\`${token}\` styles from \`aria-${state}\` — read the state from \`data-${state}\`, which \`STATE_ATTRS\` registers`, found.loc);
      }
    });
  },
};
