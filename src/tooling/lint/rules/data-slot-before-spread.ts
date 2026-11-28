import { attributesOf, openingTag, spreadName, statedString } from "../jsx.ts";
import { defineLintRule } from "../report.ts";
import type { AstNode, JsxAttributeNode, SourceLocation } from "../types.ts";

/** A literal `data-slot` a later spread on the same element silently overwrites. */
export const dataSlotBeforeSpread = defineLintRule("forge-data-slot-before-spread", {
  meta: {
    type: "problem",
    docs: { description: "A literal `data-slot` written before `{...rest}` loses to the spread, so the element ships the caller's token." },
  },
  create(_context, report) {
    return {
      JSXOpeningElement(node: AstNode): void {
        let slot: { value: string; loc: SourceLocation } | undefined;

        for (const attribute of attributesOf(node)) {
          if (attribute.type === "JSXAttribute") {
            const jsx = attribute as JsxAttributeNode;
            if (slot !== undefined || jsx.name?.name !== "data-slot") continue;
            const value = statedString(jsx.value);
            if (value !== undefined) slot = { value, loc: attribute.loc };
            continue;
          }
          if (attribute.type !== "JSXSpreadAttribute" || slot === undefined) continue;
          const spread = spreadName(attribute);
          if (spread === undefined) continue;
          report(
            `\`<${openingTag(node)}>\` has a literal \`data-slot='${slot.value}'\` before \`{...${spread}}\` — the spread wins and the token is lost; destructure \`"data-slot": inherited\` and write \`data-slot={slotToken("${slot.value}", inherited)}\``,
            slot.loc,
          );
          return;
        }
      },
    };
  },
});
