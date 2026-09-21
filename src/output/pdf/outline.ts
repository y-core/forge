import type { PdfOutlineItem, PdfStructureNode } from "./types";

// Read off the sections rather than off a level table of its own: the tree already nests a heading
// under the one above it, and a second table would be free to disagree with that nesting.
/** The outline a document's own sections describe, nested as those sections are. @internal */
export function outlineItems(node: PdfStructureNode): readonly PdfOutlineItem[] {
  return node.children.flatMap((child) => {
    const head = child.type === "Sect" ? child.children[0] : undefined;
    if (head?.text === undefined || head.page === undefined) return outlineItems(child);
    return [{ title: head.text, page: head.page, children: outlineItems(child) }];
  });
}

/** How many lines an outline shows when it is opened, its nested lines included. @internal */
export function outlineCount(items: readonly PdfOutlineItem[]): number {
  return items.reduce((total, item) => total + 1 + outlineCount(item.children), 0);
}
