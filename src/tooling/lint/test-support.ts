/** Synthetic AST nodes and the traversal oxlint performs, so a rule's spec states the tree it
 *  judges rather than the source text a parser would have to turn into one. The shapes here are the
 *  ones oxlint hands a plugin: `parent` linked, `loc` 1-indexed by line, `:exit` after the children.
 *  Nothing here carries a publication tag — see `types.ts`. */

import type { AstNode, LintRule, RuleContext, SourceLocation, Visitor } from "./types.ts";

let cursor = 0;

/** A distinct location per node, so a report's line identifies which node produced it. */
export function nextLoc(): SourceLocation {
  cursor += 1;
  return { start: { line: cursor, column: 0 }, end: { line: cursor, column: 1 } };
}

/** The children a synthetic node carries; the real AST names them per node type. */
interface WithChildren {
  children?: AstNode[];
}

/** A string, number or boolean literal. */
export function literal(value: unknown): AstNode {
  return { type: "Literal", loc: nextLoc(), value } as AstNode;
}

/** A template literal, one quasi per chunk. */
export function template(...chunks: string[]): AstNode {
  return {
    type: "TemplateLiteral",
    loc: nextLoc(),
    quasis: chunks.map((chunk) => ({ type: "TemplateElement", loc: nextLoc(), value: { cooked: chunk, raw: chunk } })),
  } as AstNode;
}

/** A JSX attribute and the nodes its value is built from. The real AST names the first of them
 *  `value`, so a rule reading the attribute's own value sees the same node the traversal reaches. */
export function attribute(name: string, ...children: AstNode[]): AstNode {
  return {
    type: "JSXAttribute",
    loc: nextLoc(),
    name: { type: "JSXIdentifier", loc: nextLoc(), name },
    value: children[0] ?? null,
    children,
  } as unknown as AstNode;
}

/** A `{…}` attribute value, whose one child the real AST names `expression`. */
export function container(expression: AstNode): AstNode {
  return { type: "JSXExpressionContainer", loc: nextLoc(), expression, children: [expression] } as unknown as AstNode;
}

/** A `{...name}` attribute, whose argument is the bare identifier it spreads. */
export function spread(name: string): AstNode {
  return { type: "JSXSpreadAttribute", loc: nextLoc(), argument: identifier(name), children: [] } as unknown as AstNode;
}

/** A call to a named function and the nodes its arguments are built from. */
export function call(callee: string, ...children: AstNode[]): AstNode {
  return { type: "CallExpression", loc: nextLoc(), callee: { type: "Identifier", loc: nextLoc(), name: callee }, children } as unknown as AstNode;
}

/** A call to a dotted path — `el.classList.add(…)` is `methodCall("el.classList.add")`. */
export function methodCall(path: string, ...children: AstNode[]): AstNode {
  const parts = path.split(".");
  let callee: AstNode = { type: "Identifier", loc: nextLoc(), name: parts[0] ?? "" } as unknown as AstNode;
  for (const part of parts.slice(1)) {
    callee = {
      type: "MemberExpression",
      loc: nextLoc(),
      object: callee,
      property: { type: "Identifier", loc: nextLoc(), name: part },
    } as unknown as AstNode;
  }
  return { type: "CallExpression", loc: nextLoc(), callee, children } as unknown as AstNode;
}

/** A non-computed `owner.name` access. */
export function member(owner: AstNode, name: string): AstNode {
  return {
    type: "MemberExpression",
    loc: nextLoc(),
    object: owner,
    property: { type: "Identifier", loc: nextLoc(), name },
    computed: false,
    children: [owner],
  } as unknown as AstNode;
}

/** A call on an arbitrary callee — `member(…)` for a method call. The real AST names the arguments
 *  `arguments`, which is what a rule reading one by position looks at. */
export function callOn(callee: AstNode, ...args: AstNode[]): AstNode {
  return { type: "CallExpression", loc: nextLoc(), callee, arguments: args, children: [callee, ...args] } as unknown as AstNode;
}

/** An `a ?? b`, whose two sides the real AST names `left` and `right`. */
export function logical(left: AstNode, right: AstNode): AstNode {
  return { type: "LogicalExpression", loc: nextLoc(), left, right, children: [left, right] } as unknown as AstNode;
}

/** One `key: value` pair of an object literal, and the nodes its value is built from. */
export function property(key: string, ...children: AstNode[]): AstNode {
  return { type: "Property", loc: nextLoc(), key: { type: "Identifier", loc: nextLoc(), name: key }, children } as unknown as AstNode;
}

/** An opening JSX element of `tag`, carrying `attributes`. The real AST names them `attributes`,
 *  which is what a rule reading their source order looks at; `children` is what the walk follows. */
export function element(tag: string, ...attributes: AstNode[]): AstNode {
  return {
    type: "JSXOpeningElement",
    loc: nextLoc(),
    name: { type: "JSXIdentifier", loc: nextLoc(), name: tag },
    attributes,
    children: attributes,
  } as unknown as AstNode;
}

/** An opening JSX element of a dotted tag — `<Menu.Item>` is `memberElement("Menu", "Item")`. */
export function memberElement(owner: string, part: string, ...attributes: AstNode[]): AstNode {
  return {
    type: "JSXOpeningElement",
    loc: nextLoc(),
    name: {
      type: "JSXMemberExpression",
      loc: nextLoc(),
      object: { type: "JSXIdentifier", loc: nextLoc(), name: owner },
      property: { type: "JSXIdentifier", loc: nextLoc(), name: part },
    },
    attributes,
    children: attributes,
  } as unknown as AstNode;
}

/** A JSX element: the tag it opens with, then the nodes between that and its close. */
export function jsxElement(opening: AstNode, ...children: AstNode[]): AstNode {
  return { type: "JSXElement", loc: nextLoc(), openingElement: opening, children: [opening, ...children] } as unknown as AstNode;
}

/** A bare identifier — a reference to a name declared elsewhere in the module. */
export function identifier(name: string): AstNode {
  return { type: "Identifier", loc: nextLoc(), name } as unknown as AstNode;
}

/** One `name = init` binding; wrap it in `declaration()` to give it a scope. */
export function declarator(name: string, init: AstNode): AstNode {
  return {
    type: "VariableDeclarator",
    loc: nextLoc(),
    id: { type: "Identifier", loc: nextLoc(), name },
    init,
    children: [init],
  } as unknown as AstNode;
}

/** A `const` declaration at module scope, which is the scope a class list is written in once. */
export function declaration(...declarators: AstNode[]): AstNode {
  return other("VariableDeclaration", ...declarators);
}

/** Any other node, named by type, wrapping `children`. */
export function other(type: string, ...children: AstNode[]): AstNode {
  return { type, loc: nextLoc(), children } as unknown as AstNode;
}

/** Walks `node` the way oxlint does: parents linked, `:exit` fired after the children. */
export function traverse(visitor: Visitor, node: AstNode, parent?: AstNode): void {
  node.parent = parent ?? null;
  visitor[node.type]?.(node);
  for (const child of (node as unknown as WithChildren).children ?? []) traverse(visitor, child, node);
  visitor[`${node.type}:exit`]?.(node);
}

/** Every message `rule` reports over `root`. */
export function runRule(rule: LintRule, root: AstNode): string[] {
  const reported: string[] = [];
  const context: RuleContext = {
    report: (diagnostic) => reported.push(diagnostic.message),
    sourceCode: { getDisableDirectives: () => ({ directives: [] }) },
  };
  traverse(rule.create(context), root);
  return reported;
}
