import { reporter } from "../report.ts";
import type { AstNode, JsxAttributeNode, LintRule } from "../types.ts";

// Hand-listed rather than imported: this namespace is a leaf and may not reach into `ui`
// (NAMESPACES.md §3c). `src/ui/contracts/state-attrs.test.ts` holds the two lists together, so a
// seventh presence flag fails there rather than going unchecked here.
/** The state flags `stateAttrs` emits as a bare presence hook, minus their `data-` prefix. */
export const PRESENCE_STATES: readonly string[] = ["pressed", "checked", "selected", "disabled", "invalid", "busy"];

const PRESENCE_ATTRS = new Set(PRESENCE_STATES.map((state) => `data-${state}`));

/** A `data-*` state attribute written by hand rather than emitted through `stateAttrs`. */
export const a11yAriaBesideData: LintRule = {
  meta: {
    type: "problem",
    docs: { description: "A state hook is emitted through `stateAttrs`, so its `aria-*` counterpart is never written alone." },
  },
  create(context) {
    const report = reporter(context, "forge-ui-a11y-aria-beside-data");
    return {
      JSXAttribute(node: AstNode): void {
        const name = (node as JsxAttributeNode).name?.name ?? "";
        if (!PRESENCE_ATTRS.has(name)) return;
        report(
          `hand-written \`${name}\` — emit it through \`stateAttrs\`, beside its \`aria-${name.slice("data-".length)}\` counterpart`,
          node.loc,
        );
      },
    };
  },
};
