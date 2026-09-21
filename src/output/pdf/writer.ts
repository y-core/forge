import { embedFont, kernedArray } from "./embed";
import { BOLD, REGULAR } from "./geometry";
import { srgbProfile } from "./icc";
import { collectPdfImages, imageObject } from "./image";
import { outlineCount, outlineItems } from "./outline";
import { resolvePdfPage } from "./page";
import { pathOperators } from "./path";
import { createPdfResources } from "./resources";
import { markedBracket, markedRuns, structureTreeOf } from "./structure";
import { num, pdfString, pdfTextString } from "./text";
import type {
  PdfArchival,
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
  PdfStructureNode,
  PdfTagging,
  PdfTextNode,
  PdfXrefEntry,
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
    // `allocate` and `reserve` both push in order, so an object's number is its position plus one
    // — a scan would be a pass over a list the structure tree makes several times longer.
    fill(id, body) {
      if (objects[id - 1]?.id !== id) throw new Error(`fill: object ${id} was never reserved`);
      objects[id - 1] = { id, body };
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
      .map((run) => [markedBracket(run), ...drawn.slice(run.from, run.to + 1), "EMC"].join("\n"))
      .join("\n");
  });
}

/** A document's numbering settled and its streams built, which the digest and the writer both read. @internal */
export function composePdf(
  pages: readonly PdfPage[],
  paper: PdfResolvedPage = resolvePdfPage(),
  fonts?: PdfDocumentFonts,
  tagging?: PdfTagging,
  archival?: PdfArchival,
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
    // Built here and not in the writer, because the writer and the outline both read it — and each
    // walk of every node is a traversal a render has to pay for.
    structure: structureTreeOf(pages),
    resources,
    images,
    writesBase14,
    firstPage,
    ...(archival === undefined ? {} : { archival }),
  };
}

// Binary callers — the cross-reference rows and an object stream's payload — must not be re-encoded:
// UTF-8 would rewrite every byte at or above 0x80 and desynchronize every offset that follows it.
/** One stream deflated, as the bytes a `/FlateDecode` entry then declares. @internal */
export async function deflate(stream: string | Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const compressor = new CompressionStream("deflate");
  const written = new Blob([typeof stream === "string" ? encoder.encode(stream) : stream]).stream().pipeThrough(compressor);
  return new Uint8Array(await new Response(written).arrayBuffer());
}

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
function annotObject(link: PdfLink, height: number, pageId: (index: number) => number, key?: number, words?: string): string {
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
function linkLeaves(node: PdfStructureNode): PdfStructureNode[] {
  return node.type === "Link" ? [node] : node.children.flatMap((child) => linkLeaves(child));
}

// A parent names its children and a child its parent, so every node takes its number in one
// pre-order pass and every body is filled in a second — neither can be written before the other.
function structureTree(
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

function streamObject(body: string, entries: string): PdfObject["body"] {
  const bytes = encoder.encode(body);
  return { head: `<< ${entries} /Length ${bytes.length} >>\nstream\n`, bytes, tail: "\nendstream" };
}

function outlineFor(manager: PdfObjectManager, items: readonly PdfOutlineItem[], pageId: (index: number) => number): string {
  if (items.length === 0) return "";
  const rootId = manager.reserve();
  manager.fill(rootId, `<< /Type /Outlines${outlineObjects(manager, items, rootId, pageId)} >>`);
  return ` /Outlines ${rootId} 0 R /PageMode /UseOutlines`;
}

const XREF_ROW = 7;

// One container per document compresses best, and a document is bounded by `DEFAULT_PDF_MAX_PAGES`;
// the cap is what makes a second container a stated limit rather than an emergent one.
const PACKED_PER_STREAM = 512;

// `/W [1 4 2]`: one byte of type, four of offset, two of generation — fixed width, so a reader seeks
// to an entry rather than scanning for it. Every field is big-endian, which the format fixes.
/** The cross-reference table as the field data an `/XRef` stream carries, one row per object. @internal */
export function xrefRows(entries: readonly PdfXrefEntry[]): Uint8Array<ArrayBuffer> {
  const rows = new Uint8Array((entries.length + 1) * XREF_ROW);
  const view = new DataView(rows.buffer);
  // Object 0 heads the free list, and its generation is the one place `65535` is written.
  view.setUint16(5, 0xffff);
  entries.forEach((entry, index) => {
    const at = (index + 1) * XREF_ROW;
    const packed = "container" in entry;
    rows[at] = packed ? 2 : 1;
    view.setUint32(at + 1, packed ? entry.container : entry.offset);
    if (packed) view.setUint16(at + 5, entry.index);
  });
  return rows;
}

// Every offset is an encoded byte length and never a `String.length`: one non-ASCII byte in a
// `/Title` or an `/Alt` otherwise desynchronizes every object after it in the container.
/** One `/ObjStm` body: the pair table, the dictionaries it packs, and the two deflated together. @internal */
export async function objectStreamBody(group: readonly PdfObject[]): Promise<PdfObject["body"]> {
  const bodies = group.map((object) => `${String(object.body)}\n`);
  let offset = 0;
  const pairs = group.map((object, index) => {
    const pair = `${object.id} ${offset}`;
    offset += encoder.encode(bodies[index] ?? "").length;
    return pair;
  });
  const table = `${pairs.join(" ")}\n`;
  const deflated = await deflate(encoder.encode(table + bodies.join("")));
  const head = `<< /Type /ObjStm /N ${group.length} /First ${encoder.encode(table).length} /Filter /FlateDecode /Length ${deflated.length} >>\nstream\n`;
  return { head, bytes: deflated, tail: "\nendstream" };
}

// `/GTS_PDFA1` is the subtype every PDF/A part names, the `1` being the registry entry and not the
// part number — an A-2 file declares it exactly as an A-1 file would.
/** The one output intent an archival file declares, with the profile it is explained by. @internal */
async function outputIntent(manager: PdfObjectManager, compact: boolean): Promise<string> {
  const profile = srgbProfile();
  const bytes = compact ? await deflate(profile) : profile;
  const filter = compact ? " /Filter /FlateDecode" : "";
  const id = manager.allocate({ head: `<< /N 3 /Length ${bytes.length}${filter} >>\nstream\n`, bytes, tail: "\nendstream" });
  return (
    `<< /Type /OutputIntent /S /GTS_PDFA1 /OutputConditionIdentifier (sRGB IEC61966-2.1) ` +
    `/Info (sRGB IEC61966-2.1) /DestOutputProfile ${id} 0 R >>`
  );
}

/** The display list as the bytes of a PDF file, with each stream filtered or left as it is. @internal */
export async function writePdf(
  composition: PdfComposition,
  filtered?: readonly Uint8Array[],
  metadata?: PdfFileMetadata,
): Promise<Uint8Array<ArrayBuffer>> {
  const { pages, paper, fonts, tagging, streams, resources, images, writesBase14, firstPage, structure, archival } = composition;
  const chunks: Uint8Array[] = [];
  let length = 0;
  const push = (text: string): void => {
    const bytes = encoder.encode(text);
    chunks.push(bytes);
    length += bytes.length;
  };

  // A cross-reference stream is a PDF 1.5 construct and binary by construction, so the readable file
  // `compress: false` promises keeps both the 1.4 header and the classic table.
  const compact = filtered !== undefined;
  // The binary comment marks the file as non-text for tools that sniff the first bytes.
  push(archival !== undefined ? "%PDF-1.7\n" : compact ? "%PDF-1.5\n" : "%PDF-1.4\n");
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
  // Page keys run 0..pages.length-1, so an annotation's starts where they stop — one counter, and
  // a collision between a page key and an annotation key is not something to remember to avoid.
  let nextKey = pages.length;
  const annotKeys = linked.map((list) => list.map(() => nextKey++));
  // Keyed by the link's own index rather than by its position among the leaves that had words: a
  // link wrapping a drawing has none, and counting only texted leaves hands its words to the next.
  const described = new Map<string, string>();
  for (const leaf of linkLeaves(structure)) {
    if (leaf.page === undefined || leaf.link === undefined || leaf.text === undefined) continue;
    described.set(`${leaf.page}:${leaf.link}`, leaf.text);
  }
  linked.forEach((list, page) => {
    list.forEach((link, at) => {
      const id = annots[page]?.[at];
      if (id === undefined) return;
      const key = tagging === undefined ? undefined : annotKeys[page]?.[at];
      manager.fill(id, annotObject(link, paper.height, pageId, key, described.get(`${page}:${at}`)));
    });
  });

  // The streams are composed before a page dictionary is built because composing them is what names
  // every graphics state and gradient the dictionary then has to declare.
  const dictionary = resources.dictionary(fontEntries);
  for (const [index] of pages.entries()) {
    // `/StructParents` is the page's key into the parent tree, and `/Tabs /S` puts tab order on the
    // structure rather than on the `/Annots` array — written unconditionally, which costs less to read.
    const parents = tagging === undefined ? "" : ` /StructParents ${index} /Tabs /S`;
    const blended = archival !== undefined && pageIsTransparent(pages[index] as PdfPage) ? " /Group << /S /Transparency /CS /DeviceRGB >>" : "";
    const page = annots[index] ?? [];
    const listed = page.length === 0 ? "" : ` /Annots [${page.map((id) => `${id} 0 R`).join(" ")}]`;
    manager.allocate(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(paper.width)} ${num(paper.height)}] ` +
        `/Resources ${dictionary}${parents}${blended}${listed} /Contents ${contentId(index)} 0 R >>`,
    );
    const deflated = filtered?.[index];
    if (deflated === undefined) {
      const bytes = encoder.encode(streams[index] ?? "");
      manager.allocate({ head: `<< /Length ${bytes.length} >>\nstream\n`, bytes, tail: "\nendstream" });
    } else {
      manager.allocate({ head: `<< /Length ${deflated.length} /Filter /FlateDecode >>\nstream\n`, bytes: deflated, tail: "\nendstream" });
    }
  }

  faces.forEach((font, index) => {
    const id = embedded[index]?.[1];
    if (id !== undefined) embedFont(manager, font, id);
  });

  const infoId = metadata?.info === undefined ? 0 : manager.allocate(metadata.info);
  const declared = tagging === undefined ? "" : structureTree(manager, pages, pageId, tagging, annots, structure, annotKeys);
  // XMP is never filtered: a conformance checker reads the packet out of the file directly, and a
  // deflated one is a packet it cannot find.
  const xmp = metadata?.xmp === undefined ? "" : ` /Metadata ${manager.allocate(streamObject(metadata.xmp, "/Type /Metadata /Subtype /XML"))} 0 R`;
  // Written only where a level is asked for, the same posture as the structure tree: a document
  // declaring no archival level carries neither the intent nor the profile bytes behind it.
  const intent = archival === undefined ? "" : ` /OutputIntents [${await outputIntent(manager, compact)}]`;
  // The outline is part of the standard metadata block rather than a switch of its own: a document
  // that declares no title and no identifier has nothing a reader would navigate it by either.
  const outlines = outlineFor(manager, metadata === undefined ? [] : outlineItems(structure), pageId);
  manager.fill(catalogId, `<< /Type /Catalog /Pages 2 0 R${declared}${xmp}${intent}${outlines} >>`);

  // Copied before a container is allocated, because `objects()` hands back the live list — and a
  // container taking its number after every other object is what keeps `pageId` predicting.
  const allocated = [...manager.objects()];
  const packed = new Map<number, { container: number; index: number }>();
  if (compact) {
    const packable = allocated.filter((object) => typeof object.body === "string");
    for (let from = 0; from < packable.length; from += PACKED_PER_STREAM) {
      const group = packable.slice(from, from + PACKED_PER_STREAM);
      const container = manager.reserve();
      group.forEach((object, index) => packed.set(object.id, { container, index }));
      manager.fill(container, await objectStreamBody(group));
    }
  }

  const objects = manager.objects();
  const offsets = new Map<number, number>();
  for (const { id, body } of objects) {
    if (packed.has(id)) continue;
    offsets.set(id, length);
    push(`${id} 0 obj\n`);
    for (const part of bodyBytes(body)) {
      chunks.push(part);
      length += part.length;
    }
    push("\nendobj\n");
  }

  const info = metadata?.info === undefined ? "" : ` /Info ${infoId} 0 R`;
  const identifier = metadata?.id === undefined ? "" : ` /ID ${metadata.id}`;
  const xref = length;
  if (compact) {
    // The `/XRef` object is the last one written and carries its own entry, so its offset is taken
    // before its rows are built — the rows are what that offset then has to describe.
    const rows = xrefRows([...objects.map(({ id }) => packed.get(id) ?? { offset: offsets.get(id) ?? 0 }), { offset: xref }]);
    const deflated = await deflate(rows);
    const id = objects.length + 1;
    push(
      `${id} 0 obj\n<< /Type /XRef /W [1 4 2] /Size ${id + 1} /Root 1 0 R${info}${identifier}` +
        ` /Filter /FlateDecode /Length ${deflated.length} >>\nstream\n`,
    );
    chunks.push(deflated);
    length += deflated.length;
    push("\nendstream\nendobj\n");
  } else {
    push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
    // Each entry is exactly twenty bytes, which is what makes the table randomly addressable.
    for (const { id } of objects) push(`${String(offsets.get(id) ?? 0).padStart(10, "0")} 00000 n \n`);
    push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${info}${identifier} >>\n`);
  }
  push(`startxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
