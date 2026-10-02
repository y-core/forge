import type { PdfObject, PdfObjectManager } from "./types";

/** The one encoder every byte of a PDF file is written through. @internal */
export const PDF_ENCODER = new TextEncoder();

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

/** One object body as the byte runs it is written as, with its binary payload left unencoded. @internal */
export function objectBodyBytes(body: PdfObject["body"]): Uint8Array[] {
  if (typeof body === "string") return [PDF_ENCODER.encode(body)];
  return [PDF_ENCODER.encode(body.head), body.bytes, PDF_ENCODER.encode(body.tail)];
}

/** A string body wrapped as a stream object, with the `/Length` its own bytes measure. @internal */
export function streamObject(body: string, entries: string): PdfObject["body"] {
  const bytes = PDF_ENCODER.encode(body);
  return { head: `<< ${entries} /Length ${bytes.length} >>\nstream\n`, bytes, tail: "\nendstream" };
}
