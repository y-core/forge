import { deflate } from "./deflate";
import { PDF_ENCODER } from "./objects";
import type { PdfObject, PdfXrefEntry } from "./types";

const XREF_ROW = 7;

// One container per document compresses best, and a document is bounded by `DEFAULT_PDF_MAX_PAGES`;
// the cap is what makes a second container a stated limit rather than an emergent one.
/** How many objects one `/ObjStm` container packs before the next is opened. @internal */
export const PACKED_PER_STREAM = 512;

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
    offset += PDF_ENCODER.encode(bodies[index] ?? "").length;
    return pair;
  });
  const table = `${pairs.join(" ")}\n`;
  const deflated = await deflate(PDF_ENCODER.encode(table + bodies.join("")));
  const head = `<< /Type /ObjStm /N ${group.length} /First ${PDF_ENCODER.encode(table).length} /Filter /FlateDecode /Length ${deflated.length} >>\nstream\n`;
  return { head, bytes: deflated, tail: "\nendstream" };
}
