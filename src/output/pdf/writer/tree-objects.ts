import { outlineCount } from "../outline";
import { num, pdfString, pdfTextString } from "../text";
import type { PdfLink, PdfOutlineItem, PdfPage, PdfStructureNode, PdfTagging } from "../types";
import type { PdfObjectManager } from "./types";

// `/F 4` sets Print and clears Hidden, Invisible and NoView — the flags PDF/A requires of every
// annotation and UA-1 of every one a reader can reach.
const ANNOT_FLAGS = 4;

// PDF/A does not forbid transparency, it forbids *undeclared* transparency — so a page naming a
// blend space it does not need is legal, and one omitting a space it does need is not.
/** Whether a page draws anything an archival file has to name a blending colour space for. @internal */
export function pageIsTransparent(page: PdfPage): boolean {
  return page.nodes.some(
    (node) =>
      (node.kind === "ink" && node.ink[3] !== undefined) ||
      (node.kind === "image" && node.alpha !== undefined) ||
      (node.kind === "path" && node.shading !== undefined),
  );
}

/** One link annotation, with its rectangle flipped into user space and its action resolved. @internal */
export function annotObject(link: PdfLink, height: number, pageId: (index: number) => number, key?: number, words?: string): string {
  const up = (y: number): number => height - y;
  const rect = `[${num(link.x)} ${num(up(link.y + link.height))} ${num(link.x + link.width)} ${num(up(link.y))}]`;
  // `/Border [0 0 0]` is what stops a viewer drawing its own rectangle over a run already set to
  // read as a link; the annotation is the behaviour, not the appearance.
  const action = "uri" in link.target ? `/A << /S /URI /URI (${pdfString(link.target.uri)}) >>` : `/Dest [${pageId(link.target.page)} 0 R /Fit]`;
  // An `/OBJR` is a forward edge only, so the annotation names its own key: it is how a reader who
  // tabbed to a link walks back to the element describing it.
  const parent = key === undefined ? "" : ` /StructParent ${key}`;
  const contents = words === undefined ? "" : ` /Contents ${pdfTextString(words)}`;
  return `<< /Type /Annot /Subtype /Link /Rect ${rect} /Border [0 0 0] /F ${ANNOT_FLAGS}${parent}${contents} ${action} >>`;
}

/** Every `/Link` leaf of the tree, in the order the annotations they own were allocated. @internal */
export function linkLeaves(node: PdfStructureNode): PdfStructureNode[] {
  return node.type === "Link" ? [node] : node.children.flatMap((child) => linkLeaves(child));
}

// A parent names its children and a child its parent, so every node takes its number in one
// pre-order pass and every body is filled in a second — neither can be written before the other.
/** The structure tree as objects, answering the catalog entries that name its root. @internal */
export function structureTree(
  manager: PdfObjectManager,
  pages: readonly PdfPage[],
  pageId: (index: number) => number,
  tagging: PdfTagging,
  annots: readonly (readonly number[])[],
  document: PdfStructureNode,
  annotKeys: readonly (readonly number[])[],
): string {
  const rootId = manager.reserve();
  const byPage: number[][] = pages.map(() => []);
  // An annotation's key resolves to the one element that owns it, so its `/Nums` value is a single
  // reference where a page's is an array — the distinction a reader walks the edge back through.
  const annotNums: string[] = [];

  const write = (node: PdfStructureNode, parent: number): number => {
    const id = manager.reserve();
    const kids = node.children.map((child) => write(child, id));
    const alt = node.alt === undefined ? "" : ` /Alt ${pdfTextString(node.alt)}`;
    const declared = node.attributes === undefined ? "" : ` ${node.attributes}`;
    if (node.page === undefined || node.mcid === undefined) {
      const listed = kids.map((kid) => `${kid} 0 R`).join(" ");
      manager.fill(id, `<< /Type /StructElem /S /${node.type} /P ${parent} 0 R /K [${listed}]${alt}${declared} >>`);
      return id;
    }
    // A link is reachable to a reader only through the annotation it owns, so its element carries
    // both the content it marks and an object reference to that annotation.
    const at = node.link;
    const annot = at === undefined ? undefined : annots[node.page]?.[at];
    if (at !== undefined) {
      const key = annotKeys[node.page]?.[at];
      if (key !== undefined) annotNums.push(`${key} ${id} 0 R`);
    }
    const marks = annot === undefined ? `${node.mcid}` : `[${node.mcid} << /Type /OBJR /Obj ${annot} 0 R >>]`;
    (byPage[node.page] ?? [])[node.mcid] = id;
    manager.fill(id, `<< /Type /StructElem /S /${node.type} /P ${parent} 0 R /Pg ${pageId(node.page)} 0 R /K ${marks}${alt}${declared} >>`);
    return id;
  };

  const documentId = write(document, rootId);
  const numbers = byPage.map((page, index) => `${index} [${page.map((id) => `${id} 0 R`).join(" ")}]`).join(" ");
  const next = pages.length + annotKeys.reduce((total, page) => total + page.length, 0);
  const parentTree = manager.allocate(`<< /Nums [${[numbers, ...annotNums].join(" ")}] >>`);
  manager.fill(rootId, `<< /Type /StructTreeRoot /K [${documentId} 0 R] /ParentTree ${parentTree} 0 R /ParentTreeNextKey ${next} >>`);
  return (
    ` /StructTreeRoot ${rootId} 0 R /MarkInfo << /Marked true >> /Lang (${pdfString(tagging.lang)})` +
    " /ViewerPreferences << /DisplayDocTitle true >>"
  );
}

// An item names the item before and after it as well as its parent, so the tree is written depth
// first: a child's number has to exist before the parent that lists it can be filled in.
function outlineObjects(manager: PdfObjectManager, items: readonly PdfOutlineItem[], parent: number, pageId: (index: number) => number): string {
  if (items.length === 0) return "";
  const ids = items.map(() => manager.reserve());
  items.forEach((item, at) => {
    const id = ids[at] ?? 0;
    const nested = outlineObjects(manager, item.children, id, pageId);
    const siblings = [at > 0 ? ` /Prev ${ids[at - 1]} 0 R` : "", at < ids.length - 1 ? ` /Next ${ids[at + 1]} 0 R` : ""].join("");
    manager.fill(id, `<< /Title ${pdfTextString(item.title)} /Parent ${parent} 0 R${siblings} /Dest [${pageId(item.page)} 0 R /Fit]${nested} >>`);
  });
  return ` /First ${ids[0]} 0 R /Last ${ids.at(-1)} 0 R /Count ${outlineCount(items)}`;
}

/** The outline as objects, answering the catalog entries that name its root. @internal */
export function outlineFor(manager: PdfObjectManager, items: readonly PdfOutlineItem[], pageId: (index: number) => number): string {
  if (items.length === 0) return "";
  const rootId = manager.reserve();
  manager.fill(rootId, `<< /Type /Outlines${outlineObjects(manager, items, rootId, pageId)} >>`);
  return ` /Outlines ${rootId} 0 R /PageMode /UseOutlines`;
}
