import type { PdfOutlineItem, PdfStructureElement } from "./types";

const LEVELS: Readonly<Record<string, number>> = { H1: 1, H2: 2 };

/** The outline a document's own heads describe, nested by the level each head is set at. @internal */
export function outlineItems(elements: readonly PdfStructureElement[]): readonly PdfOutlineItem[] {
  const top: { title: string; page: number; children: PdfOutlineItem[] }[] = [];
  for (const element of elements) {
    const level = LEVELS[element.type];
    if (level === undefined || element.text === undefined) continue;
    const entry = { title: element.text, page: element.page, children: [] };
    const parent = top.at(-1);
    // A second-level head belongs under the first-level one before it; one with nothing before it
    // has no parent to nest under, so it stands at the top rather than being dropped.
    if (level === 2 && parent !== undefined) parent.children.push(entry);
    else top.push(entry);
  }
  return top;
}

/** How many lines an outline shows when it is opened, its nested lines included. @internal */
export function outlineCount(items: readonly PdfOutlineItem[]): number {
  return items.reduce((total, item) => total + 1 + outlineCount(item.children), 0);
}
