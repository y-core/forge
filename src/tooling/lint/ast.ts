import type { ClassText } from "./types.ts";
import type {
  AstNode,
  CallNode,
  IdentifierNode,
  JsxAttributeNode,
  LiteralNode,
  PropertyNode,
  TemplateLiteralNode,
  VariableDeclaratorNode,
  Visitor,
} from "./types.ts";

const CLASS_ATTRIBUTES = new Set(["class", "className"]);

const CLASS_CALLEES = new Set(["cn", "cva"]);

const CLASS_CONSTANT_NAME = /_CLASS(?:ES)?$/;

const NOT_A_CLASS_LIST = new Set(["DARK_CLASS"]);

const STRING_VALUED = new Set(["Literal", "TemplateLiteral", "BinaryExpression"]);

/** The name a property key states, whether written bare or quoted. */
function keyName(key: PropertyNode["key"]): string {
  if (key === undefined) return "";
  return key.name ?? (typeof key.value === "string" ? key.value : "");
}

/** Whether `node` is a position whose string literals are class text. */
function isClassPosition(node: AstNode): boolean {
  if (node.type === "JSXAttribute") return CLASS_ATTRIBUTES.has((node as JsxAttributeNode).name?.name ?? "");
  // A forge component takes its class as a prop, so `{ class: "…" }` is a class position as much as
  // the attribute the component forwards it to.
  if (node.type === "Property") return CLASS_ATTRIBUTES.has(keyName((node as PropertyNode).key));
  if (node.type === "VariableDeclarator") return isClassConstant(node);
  if (node.type !== "CallExpression") return false;
  const callee = (node as CallNode).callee as AstNode | undefined;
  return callee?.type === "Identifier" && CLASS_CALLEES.has((callee as IdentifierNode).name);
}

// The *outermost* one, so `className={cn(…)}` is one position rather than two: a rule whose
// predicate is absence within an expression must not see the same list split in half.
/** The outermost class position enclosing `node`, or `undefined` when it sits in none. */
function enclosingClassPosition(node: AstNode): AstNode | undefined {
  let found: AstNode | undefined;
  for (let current = node.parent ?? undefined; current !== undefined; current = current.parent ?? undefined) {
    if (isClassPosition(current)) found = current;
  }
  return found;
}

/** The child nodes of `node`, whatever properties the parser named them, `parent` excepted. */
export function childrenOf(node: AstNode): AstNode[] {
  const out: AstNode[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent" || value === null || typeof value !== "object") continue;
    for (const candidate of Array.isArray(value) ? value : [value]) {
      if (typeof (candidate as AstNode | null)?.type === "string") out.push(candidate as AstNode);
    }
  }
  return out;
}

/** Every string a class-valued expression states, one per literal and per template chunk. */
function statedText(
  node: AstNode,
  bindingOf: (identifier: AstNode) => AstNode | undefined,
  out: string[] = [],
  seen = new Set<AstNode>(),
): string[] {
  if (node.type === "Literal") {
    const value = (node as LiteralNode).value;
    if (typeof value === "string") out.push(value);
    return out;
  }
  if (node.type === "TemplateLiteral") {
    const template = node as TemplateLiteralNode;
    for (const quasi of template.quasis) out.push(quasi.value.cooked ?? quasi.value.raw);
    for (const expression of template.expressions ?? []) statedText(expression, bindingOf, out, seen);
    return out;
  }
  if (node.type === "Identifier") {
    const init = bindingOf(node);
    if (init !== undefined && !seen.has(init)) {
      seen.add(init);
      statedText(init, bindingOf, out, seen);
      return out;
    }
  }
  for (const child of childrenOf(node)) statedText(child, bindingOf, out, seen);
  return out;
}

/** Whether a declaration sits at module scope, where a class list is written once and passed by name. */
function isModuleScope(declarator: AstNode): boolean {
  const declaration = declarator.parent ?? undefined;
  if (declaration?.type !== "VariableDeclaration") return false;
  const holder = declaration.parent ?? undefined;
  return holder?.type === "Program" || (holder?.type === "ExportNamedDeclaration" && holder.parent?.type === "Program");
}

/** Whether `node` is a module-scope `*_CLASS` or `*_CLASSES` declarator whose initializer is string-valued. */
function isClassConstant(node: AstNode): boolean {
  if (node.type !== "VariableDeclarator") return false;
  const declarator = node as VariableDeclaratorNode;
  if (declarator.id?.type !== "Identifier") return false;
  const name = (declarator.id as IdentifierNode).name;
  if (!CLASS_CONSTANT_NAME.test(name) || NOT_A_CLASS_LIST.has(name)) return false;
  const init = declarator.init;
  if (init == null || !STRING_VALUED.has(init.type)) return false;
  if (init.type === "Literal" && typeof (init as LiteralNode).value !== "string") return false;
  return isModuleScope(node);
}

/** Visits every literal in a class position, handing the enclosing position along with it. */
function literalVisitor(onPart: (position: AstNode, part: ClassText) => void): Visitor {
  const moduleConstants = new Map<string, AstNode>();
  const judgedWhereWritten = new Set<string>();

  const bindingOf = (identifier: AstNode): AstNode | undefined => {
    const parent = identifier.parent ?? undefined;
    if (parent?.type === "CallExpression" && (parent as CallNode).callee === identifier) return undefined;
    const member = parent as { computed?: boolean; property?: AstNode } | undefined;
    if (parent?.type === "MemberExpression" && member?.computed !== true && member?.property === identifier) return undefined;
    if (parent?.type === "Property" && (parent as PropertyNode).key === identifier) return undefined;
    const name = (identifier as IdentifierNode).name;
    if (judgedWhereWritten.has(name)) return undefined;
    const init = moduleConstants.get(name);
    if (init === undefined || isClassPosition(init)) return undefined;
    return init;
  };

  return {
    VariableDeclarator(node): void {
      const declarator = node as VariableDeclaratorNode;
      const name = declarator.id?.type === "Identifier" ? (declarator.id as IdentifierNode).name : undefined;
      if (name === undefined || declarator.init == null || !isModuleScope(node)) return;
      moduleConstants.set(name, declarator.init);
      if (isClassConstant(node)) judgedWhereWritten.add(name);
    },
    Identifier(node): void {
      const init = bindingOf(node);
      if (init === undefined) return;
      const position = enclosingClassPosition(node);
      if (position === undefined) return;
      for (const text of statedText(init, bindingOf)) onPart(position, { node, text, loc: node.loc });
    },
    Literal(node): void {
      const value = (node as LiteralNode).value;
      if (typeof value !== "string") return;
      // A quoted key names the property, it is not the class list the property carries.
      if (node.parent?.type === "Property" && (node.parent as PropertyNode).key === node) return;
      const position = enclosingClassPosition(node);
      if (position === undefined) return;
      onPart(position, { node, text: value, loc: node.loc });
    },
    TemplateLiteral(node): void {
      const position = enclosingClassPosition(node);
      if (position === undefined) return;
      // One literal per interpolation-delimited chunk: `p-${n}` states no whole utility, and
      // joining the chunks would invent one that is nowhere in the source.
      for (const quasi of (node as TemplateLiteralNode).quasis) {
        onPart(position, { node: quasi, text: quasi.value.cooked ?? quasi.value.raw, loc: quasi.loc });
      }
    },
  };
}

/** Every class-shaped literal, one call per literal — for a predicate a single literal settles. */
export function classLiteralVisitor(onLiteral: (found: ClassText) => void): Visitor {
  return literalVisitor((_position, part) => {
    onLiteral(part);
  });
}

/** Every class position as one joined string, fired once on exit. */
export function classExpressionVisitor(onExpression: (found: ClassText) => void): Visitor {
  const buffered = new Map<AstNode, ClassText[]>();

  const flush = (node: AstNode): void => {
    const parts = buffered.get(node);
    if (parts === undefined) return;
    buffered.delete(node);
    const first = parts[0];
    if (first === undefined) return;
    onExpression({ node, text: parts.map((part) => part.text).join(" "), loc: first.loc });
  };

  const visitor = literalVisitor((position, part) => {
    const parts = buffered.get(position);
    if (parts === undefined) buffered.set(position, [part]);
    else parts.push(part);
  });

  return { ...visitor, "JSXAttribute:exit": flush, "CallExpression:exit": flush, "Property:exit": flush, "VariableDeclarator:exit": flush };
}
