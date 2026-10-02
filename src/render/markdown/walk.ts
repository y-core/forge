import type { EnterVisitor, LeaveVisitor, MarkdownDocument, MarkdownNode, MarkdownWalkContext, WalkNode } from "./types";

/** Visits a tree depth first in document order, on an explicit stack, so no depth of nesting can overflow the call stack. @internal */
export function walkTree<N extends WalkNode>(root: N, enter: EnterVisitor<N>, leave?: LeaveVisitor<N>): void {
  const ancestors: N[] = [];
  const nextChild: number[] = [];
  let node: N | undefined = root;
  while (node !== undefined) {
    if (enter(node, ancestors) === false) leave?.(node, ancestors);
    else {
      ancestors.push(node);
      nextChild.push(0);
    }
    node = undefined;
    while (node === undefined && ancestors.length > 0) {
      const depth = ancestors.length - 1;
      const children = (ancestors[depth] as N).children as readonly N[] | undefined;
      const index = nextChild[depth] as number;
      node = children?.[index];
      if (node !== undefined) nextChild[depth] = index + 1;
      else {
        const done = ancestors.pop() as N;
        nextChild.pop();
        leave?.(done, ancestors);
      }
    }
  }
}

/** A node's children in document order, a callout's title before its body; an image's description is its alt text, not children. */
export function markdownChildren(node: MarkdownNode): readonly MarkdownNode[] {
  if (node.type === "callout") return [...node.title, ...node.children];
  if (node.type === "image" || node.type === "imageReference") return [];
  return "children" in node ? (node.children as readonly MarkdownNode[]) : [];
}

/** Visits every node of a document depth first in document order; returning false from `enter` skips a node's children. */
export function walkMarkdown(document: MarkdownDocument, enter: (node: MarkdownNode, context: MarkdownWalkContext) => boolean | undefined): void {
  for (const unit of document.units) {
    const ancestors: MarkdownNode[] = [];
    const children: (readonly MarkdownNode[])[] = [];
    const nextChild: number[] = [];
    const context: MarkdownWalkContext = { base: unit.start, ancestors };
    let node: MarkdownNode | undefined = unit.node;
    while (node !== undefined) {
      if (enter(node, context) !== false) {
        ancestors.push(node);
        children.push(markdownChildren(node));
        nextChild.push(0);
      }
      node = undefined;
      while (node === undefined && ancestors.length > 0) {
        const depth = ancestors.length - 1;
        const index = nextChild[depth] as number;
        node = (children[depth] as readonly MarkdownNode[])[index];
        if (node !== undefined) nextChild[depth] = index + 1;
        else {
          ancestors.pop();
          children.pop();
          nextChild.pop();
        }
      }
    }
  }
}
