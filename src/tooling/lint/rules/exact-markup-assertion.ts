import { childrenOf } from "../ast.ts";
import type { AstNode, CallNode, IdentifierNode, LintRule, VariableDeclaratorNode } from "../types.ts";

/** The SSR helpers markup comes out of, before any local wrapper is traced back to them. */
const SEED_RENDERER = /^render(?:[A-Z]\w*)?$/;

/** A matcher that passes on markup the assertion never pinned. */
const SUBSTRING_MATCHERS = new Set(["toContain", "toMatch"]);

/** Derivations that yield a list, whose `toContain` is exact membership rather than a substring. */
const LIST_METHODS = new Set(["split", "map", "filter", "flatMap", "concat", "matchAll"]);

/** A function whose body is judged for the renderer it calls. */
interface FunctionNode extends AstNode {
  id?: AstNode | undefined;
  body?: AstNode | undefined;
}

const nameOf = (node: AstNode | undefined): string | undefined => (node?.type === "Identifier" ? (node as IdentifierNode).name : undefined);

/** The property a non-computed member expression names. */
function memberName(node: AstNode | undefined): string | undefined {
  if (node?.type !== "MemberExpression" || (node as unknown as { computed?: boolean }).computed === true) return undefined;
  return nameOf((node as unknown as { property?: AstNode }).property);
}

/** `await x` and `(x)` say nothing about what `x` is, so a shape test looks through them. */
function unwrap(node: AstNode | undefined): AstNode | undefined {
  if (node?.type === "AwaitExpression") return unwrap((node as unknown as { argument?: AstNode }).argument);
  if (node?.type === "TSAsExpression" || node?.type === "TSNonNullExpression" || node?.type === "ChainExpression") {
    return unwrap((node as unknown as { expression?: AstNode }).expression);
  }
  return node;
}

function isFunction(node: AstNode | undefined): boolean {
  return node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression" || node?.type === "FunctionDeclaration";
}

// The subject is what the value *is*, not what was touched on the way: `classOf(out).split(" ")` is
// a list even though a renderer's markup is three nodes down inside it.
/** Whether the value `node` evaluates to is a list rather than a string to match inside. */
function producesList(node: AstNode | undefined): boolean {
  const value = unwrap(node);
  if (value === undefined) return false;
  if (value.type === "ArrayExpression") return true;
  // `a?.split(" ") ?? []` and `cond ? list : []` are lists on whichever branch is taken, and the
  // fallback branch is the one written precisely because the other yields a list too.
  if (value.type === "LogicalExpression" || value.type === "ConditionalExpression") {
    const branches = value.type === "LogicalExpression" ? ["left", "right"] : ["consequent", "alternate"];
    return branches.some((key) => producesList((value as unknown as Record<string, AstNode | undefined>)[key]));
  }
  if (value.type !== "CallExpression") return false;
  const callee = (value as CallNode).callee;
  const method = memberName(callee);
  if (method !== undefined && LIST_METHODS.has(method)) return true;
  return method === "from" && nameOf((callee as unknown as { object?: AstNode }).object) === "Array";
}

/** The names a marked-up value can be reached through, grown until they stop growing. */
interface MarkupNames {
  functions: Set<string>;
  values: Set<string>;
}

/** Whether the subtree at `node` reaches a renderer, by call or by a name already known to hold markup. */
function reachesMarkup(node: AstNode | undefined, names: MarkupNames): boolean {
  if (node === undefined) return false;
  if (node.type === "CallExpression" && names.functions.has(nameOf((node as CallNode).callee) ?? "")) return true;
  if (node.type === "Identifier" && names.values.has((node as IdentifierNode).name)) return true;
  return childrenOf(node).some((child) => reachesMarkup(child, names));
}

/** One name and the expression it is bound to — a declarator's initializer, or a function's body. */
interface Binding {
  name: string;
  body: AstNode;
  fn: boolean;
}

/** A substring assertion whose subject decides whether it is reported. */
interface Candidate {
  subject: AstNode;
  matcher: string;
  loc: AstNode["loc"];
}

/** A substring assertion on rendered markup, which passes on markup that moved. */
export const exactMarkupAssertion: LintRule = {
  meta: {
    type: "problem",
    docs: { description: "`toContain`, `toMatch` and `.includes` on rendered markup pass on markup that moved to the wrong element." },
  },
  create(context) {
    const names: MarkupNames = { functions: new Set(), values: new Set() };
    const bindings: Binding[] = [];
    const candidates: Candidate[] = [];

    const addCandidate = (node: AstNode): void => {
      const callee = (node as CallNode).callee;
      const method = memberName(callee);
      if (method === undefined) return;
      const receiver = (callee as unknown as { object?: AstNode }).object;

      if (method === "includes") {
        if (receiver !== undefined) candidates.push({ subject: receiver, matcher: ".includes", loc: node.loc });
        return;
      }
      if (!SUBSTRING_MATCHERS.has(method)) return;
      // `.not` sits between the matcher and the `expect(…)` whose argument is the subject.
      const asserted = memberName(receiver) === "not" ? (receiver as unknown as { object?: AstNode }).object : receiver;
      if (asserted?.type !== "CallExpression" || nameOf((asserted as CallNode).callee) !== "expect") return;
      const subject = (asserted as CallNode).arguments[0];
      if (subject !== undefined) candidates.push({ subject, matcher: method, loc: node.loc });
    };

    return {
      CallExpression(node: AstNode): void {
        const name = nameOf((node as CallNode).callee);
        if (name !== undefined && SEED_RENDERER.test(name)) names.functions.add(name);
        addCandidate(node);
      },
      VariableDeclarator(node: AstNode): void {
        const declarator = node as VariableDeclaratorNode;
        const name = nameOf(declarator.id);
        if (name === undefined || declarator.init == null) return;
        bindings.push({ name, body: declarator.init, fn: isFunction(unwrap(declarator.init)) });
      },
      FunctionDeclaration(node: AstNode): void {
        const declared = node as FunctionNode;
        const name = nameOf(declared.id);
        if (name !== undefined && declared.body !== undefined) bindings.push({ name, body: declared.body, fn: true });
      },
      "Program:exit"(): void {
        // A fixpoint rather than one pass: a wrapper may be declared after the wrapper it calls, and
        // the chain is arbitrarily deep. The sets only grow, so the loop terminates on the name count.
        for (let size = -1; size !== names.functions.size + names.values.size;) {
          size = names.functions.size + names.values.size;
          for (const binding of bindings) {
            if (!reachesMarkup(binding.body, names)) continue;
            if (binding.fn) names.functions.add(binding.name);
            else if (!producesList(binding.body)) names.values.add(binding.name);
          }
        }

        for (const { subject, matcher, loc } of candidates) {
          if (producesList(subject) || !reachesMarkup(subject, names)) continue;
          context.report({
            message: `\`${matcher}\` on rendered markup — assert the exact string: a substring assertion passes on markup that moved, so the attribute may have landed on the wrong element. \`toBe\` the whole render, or extract the fragment and \`toBe\` that (TESTING.md §3b)`,
            loc,
          });
        }
      },
    };
  },
};
