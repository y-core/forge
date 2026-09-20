import { embedFont, kernedArray } from "./embed";
import { BOLD, REGULAR } from "./geometry";
import { collectPdfImages, imageObject } from "./image";
import { outlineCount, outlineItems } from "./outline";
import { resolvePdfPage } from "./page";
import { pathOperators } from "./path";
import { createPdfResources } from "./resources";
import { markedRuns, structureElements } from "./structure";
import { num, pdfString, pdfTextString } from "./text";
import type {
  PdfComposition,
  PdfDocumentFonts,
  PdfFileMetadata,
  PdfImage,
  PdfLink,
  PdfNode,
  PdfObject,
  PdfObjectManager,
  PdfOutlineItem,
  PdfPage,
  PdfPagePosition,
  PdfResolvedPage,
  PdfResources,
  PdfTagging,
  PdfTextNode,
} from "./types";

const encoder = new TextEncoder();

/** Allocates object numbers in the order the document declares them. @internal */
export function createObjectManager(): PdfObjectManager {
  const objects: PdfObject[] = [];
  return {
    allocate(body) {
      const id = objects.length + 1;
      objects.push({ id, body });
      return id;
    },
    // A page names the fonts it draws with before those fonts are written, so the number is taken
    // first and the body filled after — which keeps page numbering independent of what precedes it.
    reserve() {
      const id = objects.length + 1;
      objects.push({ id, body: "<< >>" });
      return id;
    },
    fill(id, body) {
      const at = objects.findIndex((object) => object.id === id);
      if (at === -1) throw new Error(`fill: object ${id} was never reserved`);
      objects[at] = { id, body };
    },
    objects: () => objects,
  };
}

function bodyBytes(body: PdfObject["body"]): Uint8Array[] {
  if (typeof body === "string") return [encoder.encode(body)];
  return [encoder.encode(body.head), body.bytes, encoder.encode(body.tail)];
}

// A placeholder is the one thing the writer knows that layout did not: a band is laid out once, and
// the page it lands on is only settled when the file is emitted.
/** A run's words once the page it landed on is known, which is what the file actually carries. @internal */
export function substitutedRun(node: PdfTextNode, at: PdfPagePosition): string {
  if (node.placeholder === undefined) return node.run;
  return String(node.placeholder === "page-count" ? at.count : at.index + 1);
}

// The name is derived from the face's position rather than from the face's own name: a hash of the
// name collides, and the loser's runs then draw in the winner's glyphs with nothing disclosing it.
/** The resource name the face at `index` of a document's `fonts` is addressed by. @internal */
function fontResource(index: number): string {
  return `E${index}`;
}

/** One display-list node as the operators that draw it, in PDF's y-up user space. @internal */
export function operatorsFor(
  node: PdfNode,
  height = resolvePdfPage().height,
  at: PdfPagePosition = { index: 0, count: 1 },
  fonts?: PdfDocumentFonts,
  resources: PdfResources = createPdfResources(height),
): string {
  const up = (y: number): number => height - y;
  switch (node.kind) {
    case "text": {
      const embedded = node.embedded === undefined ? undefined : fonts?.find((font) => font.name === node.embedded);
      const run = substitutedRun(node, at);
      // A viewer applies no shaping of its own, so a kern reaches the page only as a `TJ` number:
      // plain `Tj` would draw every embedded run wider than measurement reserved for it.
      const [set, operator] = embedded === undefined ? [`(${pdfString(run)})`, "Tj"] : [kernedArray(run, embedded), "TJ"];
      const resource = node.embedded === undefined ? (node.face === "bold" ? BOLD : REGULAR) : resources.font(node.embedded);
      return `BT /${resource} ${num(node.size)} Tf ${num(node.tracking)} Tc ${num(node.x)} ${num(up(node.y))} Td ${set} ${operator} ET`;
    }
    case "path":
      return pathOperators(node, up, resources);
    case "image": {
      // An image is drawn on the unit square, so the rectangle it fills is a transform rather than
      // an argument — and the transform has to be bracketed or it scales everything after it.
      const state = node.alpha === undefined ? "" : `/${resources.alpha(node.alpha)} gs `;
      const place = `${num(node.width)} 0 0 ${num(node.height)} ${num(node.x)} ${num(up(node.y + node.height))} cm`;
      return `q ${state}${place} /${resources.image(node.image)} Do Q`;
    }
    default: {
      // An ink change persists until the next one, so its alpha is set outside any `q`/`Q` bracket —
      // which is why closing a translucent run means naming an opaque ink rather than restoring one.
      const alpha = node.ink[3];
      const state = alpha === undefined ? "" : `/${resources.alpha(alpha)} gs `;
      return `${state}${num(node.ink[0])} ${num(node.ink[1])} ${num(node.ink[2])} ${node.channel === "stroke" ? "RG" : "rg"}`;
    }
  }
}

/** Every page's content stream, in document order, before any filter is applied. @internal */
function contentStreams(
  pages: readonly PdfPage[],
  paper: PdfResolvedPage,
  resources: PdfResources,
  fonts?: PdfDocumentFonts,
  tagged = false,
): string[] {
  return pages.map((page, index) => {
    const at: PdfPagePosition = { index, count: pages.length };
    const drawn = page.nodes.map((node) => operatorsFor(node, paper.height, at, fonts, resources));
    if (!tagged) return drawn.join("\n");
    // The tree points at a run by its marked-content id, so the bracket in the stream and the
    // element in the tree are both derived from the same grouping rather than kept in step by hand.
    return markedRuns(page)
      .map((run) => {
        const open = run.type === undefined ? "/Artifact BMC" : `/${run.type} << /MCID ${run.mcid} >> BDC`;
        return [open, ...drawn.slice(run.from, run.to + 1), "EMC"].join("\n");
      })
      .join("\n");
  });
}

/** A document's numbering settled and its streams built, which the digest and the writer both read. @internal */
export function composePdf(
  pages: readonly PdfPage[],
  paper: PdfResolvedPage = resolvePdfPage(),
  fonts?: PdfDocumentFonts,
  tagging?: PdfTagging,
): PdfComposition {
  const faces = fonts ?? [];
  // The pair is resources, not metrics: a node with no `embedded` is the only thing that can select
  // F1 or F2, so a document where none does carries two font objects nothing points at.
  const base14 = pages.some((page) => page.nodes.some((node) => node.kind === "text" && node.embedded === undefined));
  // A document embedding nothing keeps the pair it might have set in, which is what makes every
  // document supplying no `fonts` byte-identical rather than merely tested to be.
  const writesBase14 = base14 || faces.length === 0;
  const images = new Map<PdfImage, number>();
  let next = 3 + (writesBase14 ? 2 : 0) + faces.length;
  for (const image of collectPdfImages(pages)) {
    images.set(image, next);
    next += image.mask === undefined ? 1 : 2;
  }
  const firstPage = next + pages.reduce((total, page) => total + (page.links?.length ?? 0), 0);
  const resources = createPdfResources(paper.height, images, new Map(faces.map((font, index) => [font.name, fontResource(index)])));
  return {
    pages,
    paper,
    fonts,
    tagging,
    streams: contentStreams(pages, paper, resources, fonts, tagging !== undefined),
    resources,
    images,
    writesBase14,
    firstPage,
  };
}

/** One stream deflated, as the bytes a `/FlateDecode` entry then declares. @internal */
export async function deflate(stream: string): Promise<Uint8Array<ArrayBuffer>> {
  const compressor = new CompressionStream("deflate");
  const written = new Blob([encoder.encode(stream)]).stream().pipeThrough(compressor);
  return new Uint8Array(await new Response(written).arrayBuffer());
}

/** One link annotation, with its rectangle flipped into user space and its action resolved. @internal */
function annotObject(link: PdfLink, height: number, pageId: (index: number) => number): string {
  const up = (y: number): number => height - y;
  const rect = `[${num(link.x)} ${num(up(link.y + link.height))} ${num(link.x + link.width)} ${num(up(link.y))}]`;
  // `/Border [0 0 0]` is what stops a viewer drawing its own rectangle over a run already set to
  // read as a link; the annotation is the behaviour, not the appearance.
  const action = "uri" in link.target ? `/A << /S /URI /URI (${pdfString(link.target.uri)}) >>` : `/Dest [${pageId(link.target.page)} 0 R /Fit]`;
  return `<< /Type /Annot /Subtype /Link /Rect ${rect} /Border [0 0 0] ${action} >>`;
}

// Every element is written before the root that lists them, and the root before the parent tree
// that indexes them — so each object's number is known by the time anything has to name it.
function structureTree(
  manager: PdfObjectManager,
  pages: readonly PdfPage[],
  pageId: (index: number) => number,
  tagging: PdfTagging,
  annots: readonly (readonly number[])[],
): string {
  const rootId = manager.reserve();
  const byPage: number[][] = pages.map(() => []);
  const linked = pages.map(() => 0);
  const ids = structureElements(pages).map((element) => {
    const alt = element.alt === undefined ? "" : ` /Alt ${pdfTextString(element.alt)}`;
    // A link is reachable to a reader only through the annotation it owns, so its element carries
    // both the content it marks and an object reference to that annotation.
    const annot = element.type === "Link" ? annots[element.page]?.[linked[element.page] ?? 0] : undefined;
    if (element.type === "Link") linked[element.page] = (linked[element.page] ?? 0) + 1;
    const kids = annot === undefined ? `${element.mcid}` : `[${element.mcid} << /Type /OBJR /Obj ${annot} 0 R >>]`;
    const id = manager.allocate(`<< /Type /StructElem /S /${element.type} /P ${rootId} 0 R /Pg ${pageId(element.page)} 0 R /K ${kids}${alt} >>`);
    byPage[element.page]?.push(id);
    return id;
  });
  const numbers = byPage.map((page, index) => `${index} [${page.map((id) => `${id} 0 R`).join(" ")}]`).join(" ");
  const parentTree = manager.allocate(`<< /Nums [${numbers}] >>`);
  manager.fill(rootId, `<< /Type /StructTreeRoot /K [${ids.map((id) => `${id} 0 R`).join(" ")}] /ParentTree ${parentTree} 0 R >>`);
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

function streamObject(body: string, entries: string): string {
  return `<< ${entries} /Length ${encoder.encode(body).length} >>\nstream\n${body}\nendstream`;
}

function outlineFor(manager: PdfObjectManager, items: readonly PdfOutlineItem[], pageId: (index: number) => number): string {
  if (items.length === 0) return "";
  const rootId = manager.reserve();
  manager.fill(rootId, `<< /Type /Outlines${outlineObjects(manager, items, rootId, pageId)} >>`);
  return ` /Outlines ${rootId} 0 R /PageMode /UseOutlines`;
}

/** The display list as the bytes of a PDF 1.4 file, with each stream filtered or left as it is. @internal */
export function writePdf(composition: PdfComposition, filtered?: readonly Uint8Array[], metadata?: PdfFileMetadata): Uint8Array<ArrayBuffer> {
  const { pages, paper, fonts, tagging, streams, resources, images, writesBase14, firstPage } = composition;
  const chunks: Uint8Array[] = [];
  let length = 0;
  const push = (text: string): void => {
    const bytes = encoder.encode(text);
    chunks.push(bytes);
    length += bytes.length;
  };

  // The binary comment marks the file as non-text for tools that sniff the first bytes.
  push("%PDF-1.4\n");
  const marker = new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);
  chunks.push(marker);
  length += marker.length;

  const manager = createObjectManager();
  const faces = fonts ?? [];
  const linked = pages.map((page) => page.links ?? []);
  const pageId = (index: number): number => firstPage + index * 2;
  const contentId = (index: number): number => firstPage + index * 2 + 1;
  const kids = pages.map((_page, index) => `${pageId(index)} 0 R`).join(" ");

  // The catalog names the structure tree, which is numbered after everything it points at — so the
  // one object whose number the whole file depends on is taken first and written last.
  const catalogId = manager.reserve();
  manager.allocate(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  if (writesBase14) {
    manager.allocate("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    manager.allocate("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  }

  // Every embedded face is named in every page's resources and written once: a face split across
  // pages by a fallback would otherwise be embedded twice, and the file carries the bytes each time.
  const embedded = faces.map((_font, index) => [fontResource(index), manager.reserve()] as const);
  const fontEntries = [
    ...(writesBase14 ? [`/${REGULAR} 3 0 R /${BOLD} 4 0 R`] : []),
    ...embedded.map(([resource, id]) => `/${resource} ${id} 0 R`),
  ].join(" ");

  // An image is written once and pointed at from every page, and its soft mask takes the number
  // after it — which is why the images are numbered before the first page is.
  for (const [image, id] of images) {
    manager.allocate(imageObject(image, image.mask === undefined ? undefined : id + 1));
    if (image.mask !== undefined) manager.allocate(imageObject(image.mask, undefined));
  }

  // An annotation is numbered before the page that lists it, for the same reason an image is: the
  // page dictionary names it, and a page's own number stays derivable from what precedes it.
  const annots = linked.map((list) => list.map(() => manager.reserve()));
  linked.forEach((list, page) => {
    list.forEach((link, at) => {
      const id = annots[page]?.[at];
      if (id !== undefined) manager.fill(id, annotObject(link, paper.height, pageId));
    });
  });

  // The streams are composed before a page dictionary is built because composing them is what names
  // every graphics state and gradient the dictionary then has to declare.
  const dictionary = resources.dictionary(fontEntries);
  for (const [index] of pages.entries()) {
    // `/StructParents` is the page's key into the parent tree, which is how a reader walks from a
    // marked-content id back to the element that owns it.
    const parents = tagging === undefined ? "" : ` /StructParents ${index}`;
    const page = annots[index] ?? [];
    const listed = page.length === 0 ? "" : ` /Annots [${page.map((id) => `${id} 0 R`).join(" ")}]`;
    manager.allocate(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(paper.width)} ${num(paper.height)}] ` +
        `/Resources ${dictionary}${parents}${listed} /Contents ${contentId(index)} 0 R >>`,
    );
    const deflated = filtered?.[index];
    if (deflated === undefined) {
      const stream = streams[index] ?? "";
      manager.allocate(`<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`);
    } else {
      manager.allocate({ head: `<< /Length ${deflated.length} /Filter /FlateDecode >>\nstream\n`, bytes: deflated, tail: "\nendstream" });
    }
  }

  faces.forEach((font, index) => {
    const id = embedded[index]?.[1];
    if (id !== undefined) embedFont(manager, font, id);
  });

  const infoId = metadata?.info === undefined ? 0 : manager.allocate(metadata.info);
  const declared = tagging === undefined ? "" : structureTree(manager, pages, pageId, tagging, annots);
  // XMP is never filtered: a conformance checker reads the packet out of the file directly, and a
  // deflated one is a packet it cannot find.
  const xmp = metadata?.xmp === undefined ? "" : ` /Metadata ${manager.allocate(streamObject(metadata.xmp, "/Type /Metadata /Subtype /XML"))} 0 R`;
  // The outline is part of the standard metadata block rather than a switch of its own: a document
  // that declares no title and no identifier has nothing a reader would navigate it by either.
  const outlines = outlineFor(manager, metadata === undefined ? [] : outlineItems(structureElements(pages)), pageId);
  manager.fill(catalogId, `<< /Type /Catalog /Pages 2 0 R${declared}${xmp}${outlines} >>`);

  const objects = manager.objects();
  const offsets = new Map<number, number>();
  for (const { id, body } of objects) {
    offsets.set(id, length);
    push(`${id} 0 obj\n`);
    for (const part of bodyBytes(body)) {
      chunks.push(part);
      length += part.length;
    }
    push("\nendobj\n");
  }

  const xref = length;
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  // Each entry is exactly twenty bytes, which is what makes the table randomly addressable.
  for (const { id } of objects) push(`${String(offsets.get(id) ?? 0).padStart(10, "0")} 00000 n \n`);
  const info = metadata?.info === undefined ? "" : ` /Info ${infoId} 0 R`;
  const identifier = metadata?.id === undefined ? "" : ` /ID ${metadata.id}`;
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${info}${identifier} >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
