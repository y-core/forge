import type { AstNode, CallNode, LintRule } from "../types.ts";

const D1_CALL = new Set(["query", "queryOne", "execute"]);
const LOOP = new Set(["ForStatement", "ForOfStatement", "ForInStatement", "WhileStatement", "DoWhileStatement"]);
const FUNCTION = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const PER_ITEM = new Set(["map", "flatMap", "forEach"]);

type Named = AstNode & { name?: string; property?: AstNode & { name?: string } };
type Loop = AstNode & { init?: AstNode | null; right?: AstNode };

/** The method a call names through a member access — `query` for `db.query(…)` — or `undefined` for any other callee. */
function methodOf(call: AstNode): string | undefined {
  const callee = (call as CallNode).callee as Named | undefined;
  return callee?.type === "MemberExpression" ? callee.property?.name : undefined;
}

/** Where a D1 call repeats per item: a loop it is awaited in outside the part a loop evaluates once, or a `.map`/`.flatMap`/`.forEach` callback it runs in, up to the nearest function. */
function repeatingScope(call: AstNode): "loop" | "callback" | undefined {
  const awaited = call.parent?.type === "AwaitExpression";
  for (let child = call, current = call.parent; current != null; child = current, current = current.parent) {
    if (LOOP.has(current.type)) {
      const once = child === (current as Loop).init || child === (current as Loop).right;
      return awaited && !once ? "loop" : undefined;
    }
    if (!FUNCTION.has(current.type)) continue;
    const host = current.parent;
    const isCallback = host?.type === "CallExpression" && (host as CallNode).callee !== child && PER_ITEM.has(methodOf(host) ?? "");
    return isCallback ? "callback" : undefined;
  }
  return undefined;
}

/** A `.query`, `.queryOne` or `.execute` call awaited inside a loop body, or run inside a `.map`/`.flatMap`/`.forEach` callback. */
export const sqlInLoop: LintRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "A D1 call per item is the N+1 shape: each one is a round trip and counts toward the invocation's query cap, so the items' keys go to one `json_each` statement or a `createRowLoader` instead.",
    },
  },
  create(context) {
    return {
      CallExpression(node: AstNode) {
        const method = methodOf(node);
        if (method === undefined || !D1_CALL.has(method)) return;
        const scope = repeatingScope(node);
        if (scope === undefined) return;
        context.report({
          message: `\`.${method}(…)\` runs once per item ${scope === "loop" ? "of a loop" : "of a per-item callback"} — read every key in one statement through \`json_each\`, or load them through \`createRowLoader\` (docs/STORAGE_BINDINGS.md §1h).`,
          loc: node.loc,
        });
      },
    };
  },
};
