import { embedFont } from "../embed";
import { BOLD, REGULAR } from "../geometry";
import { srgbProfile } from "../icc";
import { imageObject } from "../image";
import { outlineItems } from "../outline";
import { num } from "../text";
import type { PdfPage } from "../types";
import { fontResource } from "./content-stream";
import { deflate } from "./deflate";
import { PDF_ENCODER, createObjectManager, objectBodyBytes, streamObject } from "./objects";
import { annotObject, linkLeaves, outlineFor, pageIsTransparent, structureTree } from "./tree-objects";
import type { PdfComposition, PdfFileMetadata, PdfObjectManager } from "./types";
import { PACKED_PER_STREAM, objectStreamBody, xrefRows } from "./xref";

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
    const bytes = PDF_ENCODER.encode(text);
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
      const bytes = PDF_ENCODER.encode(streams[index] ?? "");
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
    for (const part of objectBodyBytes(body)) {
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
