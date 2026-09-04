import type {
  AstNode,
  CallNode,
  IdentifierNode,
  JsxAttributeNode,
  LiteralNode,
  PropertyNode,
  SourceLocation,
  TemplateLiteralNode,
  Visitor,
} from "./types.ts";

/** One piece of class text: the node it was read from, its contents, and where it starts. */
export interface ClassText {
  node: AstNode;
  text: string;
  loc: SourceLocation;
}

const CLASS_ATTRIBUTES = new Set(["class", "className"]);

const CLASS_CALLEES = new Set(["cn", "cva", "asClass"]);

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

/** Visits every literal in a class position, handing the enclosing position along with it. */
function literalVisitor(onPart: (position: AstNode, part: ClassText) => void): Visitor {
  return {
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
