import { childrenOf } from "../ast.ts";
import { defineLintRule } from "../report.ts";
import type { AstNode, CallNode, IdentifierNode, LiteralNode, RuleContext, VariableDeclaratorNode } from "../types.ts";

/** The SSR helpers markup comes out of, before any local wrapper is traced back to them, called or passed by name to `.then`, `.map` or `.flatMap`; a `.text()` awaited or returned is the other seed. */
const SEED_RENDERER = /^render(?:[A-Z]\w*)?$/;

/** A matcher that passes on markup the assertion never pinned. */
const SUBSTRING_MATCHERS = new Set(["toContain", "toMatch"]);

/** Derivations that yield a list, whose `toContain` is exact membership rather than a substring. */
const LIST_METHODS = new Set(["split", "map", "filter", "flatMap", "concat", "matchAll"]);

/** Fixture helpers whose declared return is a list, reached by import so no annotation is in the file. */
const LIST_HELPERS = ["classesOf", "tagsOf", "elementsOf", "attrValuesOf"];

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

/** Whether `child` is a name `node` spells rather than reads — `x.out`'s `out`, or the key of `{ out: … }`. */
function spellsName(node: AstNode, child: AstNode): boolean {
  if (memberName(node) !== undefined) return child === (node as unknown as { property?: AstNode }).property;
  const property = node as unknown as { key?: AstNode; computed?: boolean; shorthand?: boolean };
  return node.type === "Property" && property.computed !== true && property.shorthand !== true && child === property.key;
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

/** Whether the value `node` evaluates to is a list rather than a string to match inside. */
function producesList(node: AstNode | null | undefined, isList: (identifier: AstNode) => boolean): boolean {
  const value = unwrap(node);
  if (value == null) return false;
  if (value.type === "ArrayExpression") return true;
  if (value.type === "Identifier") return isList(value);
  // `a?.split(" ") ?? []` and `cond ? list : []` are lists on whichever branch is taken, and the
  // fallback branch is the one written precisely because the other yields a list too.
  if (value.type === "LogicalExpression" || value.type === "ConditionalExpression") {
    const branches = value.type === "LogicalExpression" ? ["left", "right"] : ["consequent", "alternate"];
    return branches.some((key) => producesList((value as unknown as Record<string, AstNode | undefined>)[key], isList));
  }
  if (value.type !== "CallExpression") return false;
  const callee = (value as CallNode).callee;
  const method = memberName(callee);
  if (method !== undefined && LIST_METHODS.has(method)) return true;
  if (isList(callee)) return true;
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
function blockReturnsList(node: AstNode, isList: (identifier: AstNode) => boolean): boolean {
  return childrenOf(node).some((child) => {
    if (isFunction(child)) return false;
    if (child.type === "ReturnStatement") return producesList((child as unknown as { argument?: AstNode | null }).argument, isList);
    return blockReturnsList(child, isList);
  });
}

/** Whether the binding at `node` yields a list — as a value, or as what a helper hands back. */
function yieldsList(node: AstNode | null | undefined, isList: (identifier: AstNode) => boolean): boolean {
  const value = unwrap(node);
  if (value == null) return false;
  if (isFunction(value)) {
    const body = (value as FunctionNode).body;
    return annotatesList(returnTypeOf(value)) || yieldsList(body, isList);
  }
  if (value.type === "BlockStatement") return blockReturnsList(value, isList);
  return producesList(value, isList);
}

/** The matchers that compare a whole tuple or record, each slot exactly. */
const EQUALITY_MATCHERS = new Set(["toEqual", "toStrictEqual"]);

const itemsOf = (node: AstNode): (AstNode | null)[] => (node as unknown as { elements?: (AstNode | null)[] }).elements ?? [];

/** The key a non-computed property spells, by name or by string literal. */
function keyOf(node: AstNode | null | undefined): string | undefined {
  const property = node as unknown as { key?: AstNode; computed?: boolean } | null | undefined;
  if (node?.type !== "Property" || property?.computed === true) return undefined;
  const key = property?.key;
  return (
    nameOf(key) ?? (key?.type === "Literal" && typeof (key as LiteralNode).value === "string" ? ((key as LiteralNode).value as string) : undefined)
  );
}

/** The argument of the matcher call `matcher` names, when `matcher` is the member it is called through. */
function matcherArgument(matcher: AstNode | null | undefined): AstNode | undefined {
  const call = matcher?.parent;
  return call?.type === "CallExpression" ? (call as CallNode).arguments[0] : undefined;
}

/** Whether `node` is a literal `value`. */
const isLiteral = (node: AstNode | null | undefined, value: boolean): boolean => node?.type === "Literal" && (node as LiteralNode).value === value;

/** What a `toEqual` expects in the slot `node` holds in its subject's tuple or record, when it holds one. */
function expectedInSlot(node: AstNode): AstNode | null | undefined {
  const holder = node.parent;
  let subject: AstNode | null | undefined;
  let pick: (expected: AstNode) => AstNode | null | undefined;
  if (holder?.type === "ArrayExpression") {
    const index = itemsOf(holder).indexOf(node);
    subject = holder;
    pick = (expected) => (expected.type === "ArrayExpression" ? itemsOf(expected)[index] : undefined);
  } else if (holder?.type === "Property" && (holder as unknown as { value?: AstNode }).value === node && keyOf(holder) !== undefined) {
    const key = keyOf(holder);
    subject = holder.parent;
    pick = (expected) =>
      expected.type === "ObjectExpression"
        ? (expected as unknown as { properties?: AstNode[] }).properties?.find((property) => keyOf(property) === key)
        : undefined;
  } else {
    return undefined;
  }
  const asserted = subject?.parent;
  if (
    asserted?.type !== "CallExpression" ||
    nameOf((asserted as CallNode).callee) !== "expect" ||
    (asserted as CallNode).arguments[0] !== subject
  ) {
    return undefined;
  }
  const expected = EQUALITY_MATCHERS.has(memberName(asserted.parent) ?? "") ? matcherArgument(asserted.parent) : undefined;
  const slot = expected === undefined ? undefined : pick(expected);
  return slot?.type === "Property" ? (slot as unknown as { value?: AstNode }).value : slot;
}

// Absence is the one claim an exact match cannot make: `not.toContain` and an `includes` asserted
// `false` both say a string appears *nowhere* in the document, so there is no element to pin.
/** Whether `node` is the subject of an assertion that its result is absent. */
function assertsAbsence(node: AstNode): boolean {
  if (isLiteral(expectedInSlot(node), false)) return true;
  const asserted = node.parent;
  if (asserted?.type !== "CallExpression" || nameOf((asserted as CallNode).callee) !== "expect") return false;
  const negated = memberName(asserted.parent) === "not";
  const matcher = negated ? asserted.parent?.parent : asserted.parent;
  if (memberName(matcher) !== "toBe") return false;
  return isLiteral(matcherArgument(matcher), negated);
}

/** The declaration `identifier` names from the scope it is read in — `undefined` for a global or an unresolved name. */
function declarationOf(identifier: AstNode, sourceCode: RuleContext["sourceCode"]): AstNode | undefined {
  const name = nameOf(identifier);
  if (name === undefined) return undefined;
  for (let scope = sourceCode.getScope?.(identifier) ?? null; scope !== null; scope = scope.upper) {
    const variable = scope.set.get(name);
    if (variable !== undefined) return variable.defs[0]?.node;
  }
  return undefined;
}

/** The declarations a marked-up value can be reached through, grown until they stop growing. */
interface MarkupBindings {
  functions: Set<AstNode>;
  values: Set<AstNode>;
  /** Whether an awaited `.text()` seeds markup — true only where every response a test reads is a rendered page. */
  responseText: boolean;
}

/** The arguments of each method that hold a callback whose result the call hands back. */
const CALLBACK_RESULT_ARGS = new Map<string, readonly number[]>([
  ["then", [0, 1]],
  ["map", [0]],
  ["flatMap", [0]],
]);

/** Whether `ref` names a renderer or a local helper already known to return markup. */
function namesMarkupFunction(ref: AstNode, markup: MarkupBindings, resolve: (identifier: AstNode) => AstNode | undefined): boolean {
  if (SEED_RENDERER.test(nameOf(ref) ?? "")) return true;
  const declared = resolve(ref);
  return declared !== undefined && markup.functions.has(declared);
}

/** Whether a callback returns markup — an inline function by its returns, a name by what it names. */
function callbackReturnsMarkup(
  callback: AstNode | undefined,
  markup: MarkupBindings,
  resolve: (identifier: AstNode) => AstNode | undefined,
): boolean {
  const fn = unwrap(callback);
  if (fn == null) return false;
  if (isFunction(fn)) return returnsMarkup(fn, markup, resolve);
  return fn.type === "Identifier" && namesMarkupFunction(fn, markup, resolve);
}

/** Whether the subtree at `node` reaches a renderer, by call or by a name already known to hold markup. */
function reachesMarkup(node: AstNode | undefined, markup: MarkupBindings, resolve: (identifier: AstNode) => AstNode | undefined): boolean {
  if (node === undefined) return false;
  if (markup.responseText && node.type === "AwaitExpression" && memberName((unwrap(node) as CallNode | undefined)?.callee) === "text") return true;
  if (node.type === "CallExpression") {
    const callee = (node as CallNode).callee;
    if (namesMarkupFunction(callee, markup, resolve)) return true;
    const callbacks = CALLBACK_RESULT_ARGS.get(memberName(callee) ?? "") ?? [];
    if (callbacks.some((index) => callbackReturnsMarkup((node as CallNode).arguments[index], markup, resolve))) return true;
  }
  if (node.type === "Identifier") {
    const declared = resolve(node);
    if (declared !== undefined && markup.values.has(declared)) return true;
  }
  return childrenOf(node).some((child) => !spellsName(node, child) && reachesMarkup(child, markup, resolve));
}

/** What `node` evaluates to, past the elements a sequence evaluates and discards. */
function resultOf(node: AstNode): AstNode {
  const last = node.type === "SequenceExpression" ? (node as unknown as { expressions: AstNode[] }).expressions.at(-1) : undefined;
  return last === undefined ? node : resultOf(last);
}

/** The arguments of every `return` this block owns — a nested function's returns are its own. */
function blockReturns(node: AstNode): AstNode[] {
  return childrenOf(node).flatMap((child) => {
    if (isFunction(child)) return [];
    if (child.type !== "ReturnStatement") return blockReturns(child);
    const argument = (child as unknown as { argument?: AstNode | null }).argument;
    return argument == null ? [] : [resultOf(argument)];
  });
}

/** Whether `node` is a `.text()` call — markup once awaited, whether here or by the caller it is handed to. */
const readsText = (node: AstNode | null | undefined): boolean => {
  const value = unwrap(node);
  return value?.type === "CallExpression" && memberName((value as CallNode).callee) === "text";
};

/** Whether what a function returns reaches a renderer — markup its body only reads does not make it a markup helper. */
function returnsMarkup(node: AstNode, markup: MarkupBindings, resolve: (identifier: AstNode) => AstNode | undefined): boolean {
  const fn = unwrap(node);
  const body = isFunction(fn) ? (fn as FunctionNode).body : fn;
  if (body == null) return false;
  const returned = body.type === "BlockStatement" ? blockReturns(body) : [resultOf(body)];
  return returned.some((expression) => (markup.responseText && readsText(expression)) || reachesMarkup(expression, markup, resolve));
}

/** One declaration and the expression it binds — a declarator's initializer, or a function's body. */
interface Binding {
  declaration: AstNode;
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
export const exactMarkupAssertion = defineLintRule("libs-testing-exact-match", {
  meta: {
    type: "problem",
    docs: { description: "`toContain`, `toMatch` and `.includes` on rendered markup pass on markup that moved to the wrong element." },
    // `responseText: false` is for a tree whose responses are not all markup, where a 429's plain-text body is not.
    schema: [{ type: "object", properties: { responseText: { type: "boolean" } }, additionalProperties: false }],
  },
  create(context, report) {
    const responseText = (context.options?.[0] as { responseText?: boolean } | undefined)?.responseText ?? true;
    const markup: MarkupBindings = { functions: new Set(), values: new Set(), responseText };
    const lists = new Set<AstNode>();
    const resolved = new Map<AstNode, AstNode | undefined>();
    const bindings: Binding[] = [];
    const candidates: Candidate[] = [];

    const resolve = (identifier: AstNode): AstNode | undefined => {
      if (resolved.has(identifier)) return resolved.get(identifier);
      const declared = declarationOf(identifier, context.sourceCode);
      resolved.set(identifier, declared);
      return declared;
    };

    const isList = (identifier: AstNode): boolean => {
      if (LIST_HELPERS.includes(nameOf(identifier) ?? "")) return true;
      const declared = resolve(identifier);
      return declared !== undefined && lists.has(declared);
    };

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
        addCandidate(node);
      },
      VariableDeclarator(node: AstNode): void {
        const declarator = node as VariableDeclaratorNode;
        if (nameOf(declarator.id) === undefined || declarator.init == null) return;
        bindings.push({ declaration: node, body: declarator.init, fn: isFunction(unwrap(declarator.init)) });
      },
      FunctionDeclaration(node: AstNode): void {
        const declared = node as FunctionNode;
        if (nameOf(declared.id) !== undefined && declared.body !== undefined) {
          bindings.push({ declaration: node, body: declared.body, fn: true, returnType: returnTypeOf(node) });
        }
      },
      "Program:exit"(): void {
        // A fixpoint rather than one pass: a wrapper may be declared after the wrapper it calls, and
        // the chain is arbitrarily deep. The sets only grow, so the loop terminates on the binding count.
        for (let size = -1; size !== markup.functions.size + markup.values.size + lists.size;) {
          size = markup.functions.size + markup.values.size + lists.size;
          for (const binding of bindings) {
            // A list is a list whether or not markup reaches it: the questions are independent,
            // and it is the listness that decides `toContain` is membership rather than a substring.
            if (annotatesList(binding.returnType) || yieldsList(binding.body, isList)) lists.add(binding.declaration);
            if (binding.fn) {
              if (returnsMarkup(binding.body, markup, resolve)) markup.functions.add(binding.declaration);
            } else if (!lists.has(binding.declaration) && reachesMarkup(binding.body, markup, resolve)) {
              markup.values.add(binding.declaration);
            }
          }
        }

        for (const { subject, matcher, loc } of candidates) {
          if (producesList(subject, isList) || !reachesMarkup(subject, markup, resolve)) continue;
          report(
            `\`${matcher}\` on rendered markup — assert the exact string: a substring assertion passes on markup that moved, so the attribute may have landed on the wrong element. \`toBe\` the whole render, or extract the fragment and \`toBe\` that`,
            loc,
          );
        }
      },
    };
  },
});
