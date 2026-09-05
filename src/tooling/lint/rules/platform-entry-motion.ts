import { reporter } from "../report.ts";
import type { AstNode, CallNode, IdentifierNode, LintRule } from "../types.ts";

const CLASS_LIST_METHODS = new Set(["add", "remove", "toggle"]);

/** A member expression, read one link at a time. */
interface MemberNode extends AstNode {
  object: AstNode;
  property: AstNode;
}

const nameOf = (node: AstNode | undefined): string | undefined =>
  node?.type === "Identifier" || node?.type === "JSXIdentifier" ? (node as IdentifierNode).name : undefined;

/** Whether `node` calls `classList.add`, `.remove` or `.toggle`. */
function isClassListCall(node: AstNode): boolean {
  if (node.type !== "CallExpression") return false;
  const callee = (node as CallNode).callee;
  if (callee.type !== "MemberExpression") return false;
  const method = nameOf((callee as MemberNode).property);
  if (method === undefined || !CLASS_LIST_METHODS.has(method)) return false;
  const owner = (callee as MemberNode).object;
  return owner.type === "MemberExpression" && nameOf((owner as MemberNode).property) === "classList";
}

/** Whether `node` calls `requestAnimationFrame`. */
function isFrameCall(node: AstNode): boolean {
  return node.type === "CallExpression" && nameOf((node as CallNode).callee) === "requestAnimationFrame";
}

/** A class added inside `requestAnimationFrame` to start an entry transition. */
export const platformEntryMotion: LintRule = {
  meta: {
    type: "problem",
    docs: { description: "An entry transition is declared with `@starting-style`, not started by adding a class on the next frame." },
  },
  create(context) {
    const report = reporter(context, "forge-ui-platform-entry-motion");
    const reported = new Set<AstNode>();

    return {
      CallExpression(node): void {
        if (!isClassListCall(node)) return;
        for (let current = node.parent ?? undefined; current !== undefined; current = current.parent ?? undefined) {
          if (!isFrameCall(current)) continue;
          if (reported.has(current)) return;
          reported.add(current);
          report(
            "a class added inside `requestAnimationFrame` to start an entry transition — declare it with `@starting-style` and `transition-behavior: allow-discrete`",
            node.loc,
          );
          return;
        }
      },
    };
  },
};
