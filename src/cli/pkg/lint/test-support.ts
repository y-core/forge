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

/** A JSX attribute and the nodes its value is built from. */
export function attribute(name: string, ...children: AstNode[]): AstNode {
  return { type: "JSXAttribute", loc: nextLoc(), name: { type: "JSXIdentifier", loc: nextLoc(), name }, children } as unknown as AstNode;
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

/** One `key: value` pair of an object literal, and the nodes its value is built from. */
export function property(key: string, ...children: AstNode[]): AstNode {
  return { type: "Property", loc: nextLoc(), key: { type: "Identifier", loc: nextLoc(), name: key }, children } as unknown as AstNode;
}

/** An opening JSX element of `tag`, carrying `attributes`. */
export function element(tag: string, ...attributes: AstNode[]): AstNode {
  return {
    type: "JSXOpeningElement",
    loc: nextLoc(),
    name: { type: "JSXIdentifier", loc: nextLoc(), name: tag },
    children: attributes,
  } as unknown as AstNode;
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
