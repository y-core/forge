import { defineLintRule } from "../report.ts";
import type { AstNode, CallNode, LiteralNode, TemplateLiteralNode } from "../types.ts";

const ENV_KEY = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/;

function literalText(node: AstNode | undefined): string | undefined {
  if (node?.type === "Literal") {
    const { value } = node as LiteralNode;
    return typeof value === "string" ? value : undefined;
  }
  if (node?.type === "TemplateLiteral") return (node as TemplateLiteralNode).quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join(" ");
  return undefined;
}

/** A `safeCheck` whose vouched message spells an UPPER_SNAKE env key, which belongs to the consuming app rather than to the schema. */
export const vouchedMessageEnvKey = defineLintRule("forge-vouched-message-env-key", {
  meta: {
    type: "problem",
    docs: {
      description:
        "A `safeCheck` message names the requirement, not the env key that supplies the value: which key that is belongs to the consuming app, and the `<field>:` prefix already locates it.",
    },
  },
  create(_context, report) {
    return {
      CallExpression(node: AstNode) {
        const { callee, arguments: args } = node as CallNode;
        if (callee?.type !== "Identifier" || (callee as AstNode & { name?: string }).name !== "safeCheck") return;
        const key = ENV_KEY.exec(literalText(args?.[1]) ?? "")?.[0];
        if (key === undefined) return;
        report(
          `\`safeCheck\` message names \`${key}\`, an env key — name the requirement, since the consuming app picks the key and the \`<field>:\` prefix already locates it`,
          node.loc,
        );
      },
    };
  },
});
