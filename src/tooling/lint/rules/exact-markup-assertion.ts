import { childrenOf } from "../ast.ts";
import type { AstNode, CallNode, IdentifierNode, LintRule, LiteralNode, VariableDeclaratorNode } from "../types.ts";

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

const nameOf = (node: AstNode | null | undefined): string | undefined => (node?.type === "Identifier" ? (node as IdentifierNode).name : undefined);

/** The property a non-computed member expression names. */
function memberName(node: AstNode | null | undefined): string | undefined {
  if (node?.type !== "MemberExpression" || (node as unknown as { computed?: boolean }).computed === true) return undefined;
  return nameOf((node as unknown as { property?: AstNode }).property);
}

/** `await x` and `(x)` say nothing about what `x` is, so a shape test looks through them. */
function unwrap(node: AstNode | null | undefined): AstNode | null | undefined {
  if (node?.type === "AwaitExpression") return unwrap((node as unknown as { argument?: AstNode }).argument);
  if (node?.type === "TSAsExpression" || node?.type === "TSNonNullExpression" || node?.type === "ChainExpression") {
    return unwrap((node as unknown as { expression?: AstNode }).expression);
  }
  return node;
}

function isFunction(node: AstNode | null | undefined): boolean {
  return node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression" || node?.type === "FunctionDeclaration";
}

// The subject is what the value *is*, not what was touched on the way: `classOf(out).split(" ")` is
// a list even though a renderer's markup is three nodes down inside it.
/** Whether the value `node` evaluates to is a list rather than a string to match inside. `lists`
 *  names the same-file bindings already known to hold or return one. */
function producesList(node: AstNode | null | undefined, lists: ReadonlySet<string>): boolean {
  const value = unwrap(node);
  if (value == null) return false;
  if (value.type === "ArrayExpression") return true;
  if (value.type === "Identifier") return lists.has((value as IdentifierNode).name);
  // `a?.split(" ") ?? []` and `cond ? list : []` are lists on whichever branch is taken, and the
  // fallback branch is the one written precisely because the other yields a list too.
  if (value.type === "LogicalExpression" || value.type === "ConditionalExpression") {
    const branches = value.type === "LogicalExpression" ? ["left", "right"] : ["consequent", "alternate"];
    return branches.some((key) => producesList((value as unknown as Record<string, AstNode | undefined>)[key], lists));
  }
  if (value.type !== "CallExpression") return false;
  const callee = (value as CallNode).callee;
  const method = memberName(callee);
  if (method !== undefined && LIST_METHODS.has(method)) return true;
  if (lists.has(nameOf(callee) ?? "")) return true;
  return method === "from" && nameOf((callee as unknown as { object?: AstNode }).object) === "Array";
}

/** A type annotation naming an array, through the wrappers a return type is written in. */
function annotatesList(node: AstNode | null | undefined): boolean {
  if (node == null) return false;
  if (node.type === "TSArrayType" || node.type === "TSTupleType") return true;
  if (node.type === "TSTypeReference") {
    const name = nameOf((node as unknown as { typeName?: AstNode }).typeName);
    if (name === "Array" || name === "ReadonlyArray") return true;
    // An `async` helper's list is behind a `Promise`, and its argument is the type actually returned.
    return name === "Promise" && childrenOf(node).some(annotatesList);
  }
  if (node.type === "TSTypeAnnotation" || node.type === "TSTypeOperator" || node.type === "TSUnionType") {
    return childrenOf(node).some(annotatesList);
  }
  return false;
}

const returnTypeOf = (node: AstNode): AstNode | null | undefined => (node as unknown as { returnType?: AstNode | null }).returnType;

/** Whether any `return` this block owns yields a list — a nested function's returns are its own. */
function blockReturnsList(node: AstNode, lists: ReadonlySet<string>): boolean {
  return childrenOf(node).some((child) => {
    if (isFunction(child)) return false;
    if (child.type === "ReturnStatement") return producesList((child as unknown as { argument?: AstNode | null }).argument, lists);
    return blockReturnsList(child, lists);
  });
}

/** Whether the binding at `node` yields a list — as a value, or as what a helper hands back. */
function yieldsList(node: AstNode | null | undefined, lists: ReadonlySet<string>): boolean {
  const value = unwrap(node);
  if (value == null) return false;
  if (isFunction(value)) {
    const body = (value as FunctionNode).body;
    return annotatesList(returnTypeOf(value)) || yieldsList(body, lists);
  }
  if (value.type === "BlockStatement") return blockReturnsList(value, lists);
  return producesList(value, lists);
}

// Absence is the one claim an exact match cannot make: `not.toContain` and an `includes` asserted
// `false` both say a string appears *nowhere* in the document, so there is no element to pin.
/** Whether `node` is the subject of an assertion that its result is absent. */
function assertsAbsence(node: AstNode): boolean {
  const asserted = node.parent;
  if (asserted?.type !== "CallExpression" || nameOf((asserted as CallNode).callee) !== "expect") return false;
  const negated = memberName(asserted.parent) === "not";
  const matcher = negated ? asserted.parent?.parent : asserted.parent;
  if (memberName(matcher) !== "toBe") return false;
  const call = matcher?.parent;
  const argument = call?.type === "CallExpression" ? (call as CallNode).arguments[0] : undefined;
  const value = argument?.type === "Literal" ? (argument as LiteralNode).value : undefined;
  return value === negated;
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
  /** A `function` declaration's annotation, which sits on the declaration rather than on its body. */
  returnType?: AstNode | null | undefined;
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
    const lists = new Set<string>();
    const bindings: Binding[] = [];
    const candidates: Candidate[] = [];

    const addCandidate = (node: AstNode): void => {
      const callee = (node as CallNode).callee;
      const method = memberName(callee);
      if (method === undefined) return;
      const receiver = (callee as unknown as { object?: AstNode }).object;

      if (method === "includes") {
        if (receiver !== undefined && !assertsAbsence(node)) candidates.push({ subject: receiver, matcher: ".includes", loc: node.loc });
        return;
      }
      if (!SUBSTRING_MATCHERS.has(method)) return;
      if (memberName(receiver) === "not") return;
      if (receiver?.type !== "CallExpression" || nameOf((receiver as CallNode).callee) !== "expect") return;
      const subject = (receiver as CallNode).arguments[0];
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
        if (name !== undefined && declared.body !== undefined) {
          bindings.push({ name, body: declared.body, fn: true, returnType: returnTypeOf(node) });
        }
      },
      "Program:exit"(): void {
        // A fixpoint rather than one pass: a wrapper may be declared after the wrapper it calls, and
        // the chain is arbitrarily deep. The sets only grow, so the loop terminates on the name count.
        for (let size = -1; size !== names.functions.size + names.values.size + lists.size;) {
          size = names.functions.size + names.values.size + lists.size;
          for (const binding of bindings) {
            // A list is a list whether or not markup reaches it: the two questions are independent,
            // and it is the listness that decides `toContain` is membership rather than a substring.
            if (annotatesList(binding.returnType) || yieldsList(binding.body, lists)) lists.add(binding.name);
            if (!reachesMarkup(binding.body, names)) continue;
            if (binding.fn) names.functions.add(binding.name);
            else if (!lists.has(binding.name)) names.values.add(binding.name);
          }
        }

        for (const { subject, matcher, loc } of candidates) {
          if (producesList(subject, lists) || !reachesMarkup(subject, names)) continue;
          context.report({
            message: `\`${matcher}\` on rendered markup — assert the exact string: a substring assertion passes on markup that moved, so the attribute may have landed on the wrong element. \`toBe\` the whole render, or extract the fragment and \`toBe\` that (TESTING.md §3b)`,
            loc,
          });
        }
      },
    };
  },
};
