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

/** The child nodes of `node`, whatever properties the parser named them — `parent` excepted, which
 *  would walk back up the tree. */
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
function statedText(node: AstNode, out: string[] = []): string[] {
  if (node.type === "Literal") {
    const value = (node as LiteralNode).value;
    if (typeof value === "string") out.push(value);
    return out;
  }
  if (node.type === "TemplateLiteral") {
    for (const quasi of (node as TemplateLiteralNode).quasis) out.push(quasi.value.cooked ?? quasi.value.raw);
    return out;
  }
  for (const child of childrenOf(node)) statedText(child, out);
  return out;
}

/** Whether a declaration sits at module scope, where a class list is written once and passed by name. */
function isModuleScope(declarator: AstNode): boolean {
  const declaration = declarator.parent ?? undefined;
  if (declaration?.type !== "VariableDeclaration") return false;
  const holder = declaration.parent ?? undefined;
  return holder?.type === "Program" || (holder?.type === "ExportNamedDeclaration" && holder.parent?.type === "Program");
}

/** Visits every literal in a class position, handing the enclosing position along with it. A class
 *  list bound to a module-scope `const` and passed by name is judged at the name's own location. */
function literalVisitor(onPart: (position: AstNode, part: ClassText) => void): Visitor {
  // Source order, so a constant declared above the component that reads it is already known. One
  // declared below resolves to nothing, which is the same silence as before this resolved at all.
  const moduleConstants = new Map<string, AstNode>();

  return {
    VariableDeclarator(node): void {
      const declarator = node as VariableDeclaratorNode;
      const name = declarator.id?.type === "Identifier" ? (declarator.id as IdentifierNode).name : undefined;
      if (name === undefined || declarator.init == null || !isModuleScope(node)) return;
      moduleConstants.set(name, declarator.init);
    },
    Identifier(node): void {
      const init = moduleConstants.get((node as IdentifierNode).name);
      if (init === undefined) return;
      // The callee names the position; it is not the class list the position carries.
      if (node.parent?.type === "CallExpression" && (node.parent as CallNode).callee === node) return;
      // An initializer that is itself a class position — `const R = cva(…)` — was judged where it
      // was written, so resolving the name would report the same class list twice.
      if (isClassPosition(init)) return;
      const position = enclosingClassPosition(node);
      if (position === undefined) return;
      for (const text of statedText(init)) onPart(position, { node, text, loc: node.loc });
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

/** Every class position as one joined string, fired once on exit — for a predicate whose subject is
 *  the *absence* of a token, which may sit in a sibling argument of the same `cn()` call. */
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

  return { ...visitor, "JSXAttribute:exit": flush, "CallExpression:exit": flush, "Property:exit": flush };
}
