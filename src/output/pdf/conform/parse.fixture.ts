import type { PdfParsedFile, PdfParsedObject } from "./types.fixture";

// latin1 maps one byte to one character, so an index into the decoded file is a byte offset — which
// is what lets a token found by a regex and an offset read out of a table agree about where it is.
const decoder = new TextDecoder("latin1");

const HEADER = /(\d+) (\d+) obj\r?\n/g;
const ENDOBJ = "\nendobj";

/** One `/FlateDecode` payload back as the bytes it was deflated from. @internal */
export async function inflate(deflated: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([deflated]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** An object's payload where it declared one, inflated where it declared a filter. @internal */
async function payloadOf(dict: string, bytes: Uint8Array<ArrayBuffer>, from: number, to: number): Promise<Uint8Array<ArrayBuffer>> {
  const raw = bytes.subarray(from, to);
  return dict.includes("/FlateDecode") ? await inflate(raw) : raw;
}

// A stream body ends at its declared `/Length` and never at `endobj`: a font file or a deflate
// payload can carry those very bytes, and a reader scanning for them resynchronizes mid-file.
/** Every top-level object of a file, each ended by its declared length or by its `endobj`. @internal */
async function topLevelObjects(bytes: Uint8Array<ArrayBuffer>, text: string): Promise<PdfParsedObject[]> {
  const objects: PdfParsedObject[] = [];
  let at = 0;
  for (;;) {
    HEADER.lastIndex = at;
    const found = HEADER.exec(text);
    if (found === null) return objects;
    const id = Number(found[1]);
    const from = found.index + found[0].length;
    const opened = text.indexOf("stream", from);
    const closed = text.indexOf(ENDOBJ, from);
    if (opened === -1 || (closed !== -1 && closed < opened)) {
      objects.push({ id, dict: text.slice(from, closed === -1 ? undefined : closed) });
      at = closed === -1 ? text.length : closed + ENDOBJ.length;
      continue;
    }
    const dict = text.slice(from, opened);
    const length = Number(/\/Length (\d+)/.exec(dict)?.[1] ?? 0);
    const start = opened + (text.startsWith("stream\r\n", opened) ? "stream\r\n".length : "stream\n".length);
    objects.push({ id, dict, stream: await payloadOf(dict, bytes, start, start + length) });
    at = start + length;
  }
}

/** The objects one `/ObjStm` packs, taken from its pair table rather than from any file offset. @internal */
export function unpackObjectStream(container: PdfParsedObject): PdfParsedObject[] {
  if (container.stream === undefined) return [];
  const text = decoder.decode(container.stream);
  const count = Number(/\/N (\d+)/.exec(container.dict)?.[1] ?? 0);
  const first = Number(/\/First (\d+)/.exec(container.dict)?.[1] ?? 0);
  const pairs = text
    .slice(0, first)
    .trim()
    .split(/\s+/)
    .map((field) => Number(field));
  return Array.from({ length: count }, (_unused, index) => {
    const id = pairs[index * 2] ?? 0;
    const from = first + (pairs[index * 2 + 1] ?? 0);
    const next = index + 1 < count ? first + (pairs[index * 2 + 3] ?? 0) : text.length;
    return { id, dict: text.slice(from, next), container: container.id };
  });
}

// Resolution is by scan and not by offset, which is deliberate: `writer.test.ts` is what holds the
// cross-reference rows, and a reader driven by them could not be used to check them.
/** Every object a file carries, found by scanning object headers and unpacking each `/ObjStm`. @internal */
export async function parsePdfObjects(bytes: Uint8Array<ArrayBuffer>): Promise<PdfParsedFile> {
  const text = decoder.decode(bytes);
  const top = await topLevelObjects(bytes, text);
  const objects = new Map<number, PdfParsedObject>();
  for (const object of top) {
    objects.set(object.id, object);
    if (!object.dict.includes("/Type /ObjStm")) continue;
    for (const packed of unpackObjectStream(object)) objects.set(packed.id, packed);
  }
  const at = text.lastIndexOf("trailer");
  const stream = top.find((object) => object.dict.includes("/Type /XRef"));
  return { objects, trailer: at === -1 ? (stream?.dict ?? "") : text.slice(at) };
}

/** Every object's dictionary as one text, a packed object's included, for a test asking what a file declares. @internal */
export async function parsePdfText(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const file = await parsePdfObjects(bytes);
  return [...file.objects.values()].map((object) => object.dict).join("\n");
}
