import { childrenOf } from "./ast.ts";
import type { AstNode, IdentifierNode, JsxAttributeNode, LiteralNode } from "./types.ts";

/** A JSX opening element and the attributes it carries, in source order. */
export interface JsxOpeningElementNode extends AstNode {
  name?: AstNode | undefined;
  attributes?: readonly AstNode[] | undefined;
}

/** A member or namespaced JSX name, whose parts spell the tag as written. */
interface JsxNameNode extends AstNode {
  name?: string | AstNode | undefined;
  object?: AstNode | undefined;
  property?: AstNode | undefined;
  namespace?: AstNode | undefined;
}

/** The tag a JSX name spells — `div`, `Card.Content`, `svg:use`. */
export function tagName(node: AstNode | undefined): string {
  if (node === undefined) return "element";
  const name = node as JsxNameNode;
  if (typeof name.name === "string") return name.name;
  if (name.object !== undefined) return `${tagName(name.object)}.${tagName(name.property)}`;
  if (name.namespace !== undefined) return `${tagName(name.namespace)}:${tagName(name.name as AstNode | undefined)}`;
  return "element";
}

/** The tag of the element `node` opens. */
export const openingTag = (node: AstNode): string => tagName((node as JsxOpeningElementNode).name);

/** The attributes `node` carries, in source order; a spread is one of them. */
export const attributesOf = (node: AstNode): readonly AstNode[] => (node as JsxOpeningElementNode).attributes ?? [];

/** The attribute `name`, or `undefined` when the element carries none. */
export function attributeNamed(node: AstNode, name: string): JsxAttributeNode | undefined {
  for (const attribute of attributesOf(node)) {
    if (attribute.type === "JSXAttribute" && (attribute as JsxAttributeNode).name?.name === name) return attribute as JsxAttributeNode;
  }
  return undefined;
}

/** The string an attribute states, whether quoted or written in an expression container. A value
 *  computed at render time states none, and is judged nowhere. */
export function statedString(value: AstNode | null | undefined): string | undefined {
  if (value == null) return undefined;
  const inner = value.type === "JSXExpressionContainer" ? ((value as { expression?: AstNode }).expression ?? undefined) : value;
  if (inner === undefined || inner.type !== "Literal") return undefined;
  const stated = (inner as LiteralNode).value;
  return typeof stated === "string" ? stated : undefined;
}

/** The bare identifier a `{...rest}` attribute spreads, or `undefined` for a computed spread. */
export function spreadName(node: AstNode): string | undefined {
  const argument = (node as unknown as { argument?: AstNode }).argument;
  return argument?.type === "Identifier" ? (argument as IdentifierNode).name : undefined;
}

/** The nearest enclosing `JSXElement`, so an opening tag can be judged against its own body. */
export function enclosingElement(node: AstNode): AstNode | undefined {
  return node.parent?.type === "JSXElement" ? node.parent : undefined;
}

/** Whether any element inside `node` — at any depth, and through an expression container — opens
 *  with a tag `matches` accepts. The element `node` itself opens does not count as inside it. */
export function containsTag(node: AstNode, matches: (tag: string) => boolean): boolean {
  const own = (node as unknown as { openingElement?: AstNode }).openingElement;
  return childrenOf(node).some((child) => child !== own && reachesTag(child, matches));
}

/** Whether `node` or anything under it opens with a tag `matches` accepts. */
function reachesTag(node: AstNode, matches: (tag: string) => boolean): boolean {
  if (node.type === "JSXOpeningElement" && matches(openingTag(node))) return true;
  return childrenOf(node).some((child) => reachesTag(child, matches));
}
