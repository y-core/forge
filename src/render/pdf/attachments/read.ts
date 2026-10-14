import { err, result } from "../../../result/result";
import type { Result } from "../../../result/types";
import type { PdfAttachment, PdfAttachmentRelationship } from "../types";
import { decodedPayloadOf, decodePdfBytes, decodePdfDocText, indexPdfObjects, parsePdfValue, topLevelObjects } from "./parse";
import type { PdfAttachmentLimits, PdfDecodeBudget, PdfParsedObject, PdfParsedValue } from "./types";

const DEFAULT_MAX_INPUT_BYTES = 6 * 1024 * 1024;
const DEFAULT_MAX_OBJECTS = 100_000;
const DEFAULT_MAX_INFLATED_BYTES = 6 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_DECODED_BYTES = 6 * 1024 * 1024;
const HEADER_WINDOW = 1024;
const RELATIONSHIPS: ReadonlySet<string> = new Set<PdfAttachmentRelationship>(["Source", "Data", "Alternative", "Supplement", "Unspecified"]);
const DATE = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:([Z+-])(?:(\d{2})'?(?:(\d{2})'?)?)?)?$/;

type PdfDictionary = ReadonlyMap<string, PdfParsedValue>;
type PdfBoundedLimits = { [Key in keyof PdfAttachmentLimits]-?: number };
type PdfEmbeddedFile = Pick<PdfAttachment, "mime" | "bytes" | "modified">;

interface PdfObjectReader {
  resolve: (value: PdfParsedValue | undefined) => PdfParsedValue | undefined;
  text: (value: PdfParsedValue | undefined) => string | undefined;
}

function dictionaryOf(value: PdfParsedValue | undefined): PdfDictionary | undefined {
  return value?.kind === "dict" ? value.entries : undefined;
}

function textOf(value: PdfParsedValue | undefined): string | undefined {
  if (value?.kind !== "string") return undefined;
  const { bytes } = value;
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder().decode(bytes.subarray(3));
  return decodePdfDocText(bytes);
}

function unsharedBytesOf(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes.buffer instanceof ArrayBuffer ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length) : new Uint8Array(bytes);
}

function dateOf(text: string | undefined): Date | undefined {
  const parts = text === undefined ? null : DATE.exec(text);
  if (parts === null) return undefined;
  const field = (index: number, fallback: number): number => Number(parts[index] ?? fallback);
  const utc = Date.UTC(field(1, 0), field(2, 1) - 1, field(3, 1), field(4, 0), field(5, 0), field(6, 0));
  const offset = (parts[7] === "-" ? -1 : 1) * (field(8, 0) * 60 + field(9, 0)) * 60_000;
  const at = new Date(utc - offset);
  return Number.isNaN(at.getTime()) ? undefined : at;
}

function isFlateOnly(filter: PdfParsedValue | undefined): boolean {
  if (filter === undefined) return true;
  if (filter.kind === "name") return filter.value === "FlateDecode";
  return filter.kind === "array" && filter.items.length === 1 && filter.items[0]?.kind === "name" && filter.items[0].value === "FlateDecode";
}

async function objectsOf(
  bytes: Uint8Array<ArrayBuffer>,
  text: string,
  limits: PdfBoundedLimits,
  budget: PdfDecodeBudget,
): Promise<{ objects: Map<number, PdfParsedObject>; top: PdfParsedObject[] }> {
  const top = topLevelObjects(bytes, text, limits);
  const objects = await indexPdfObjects(top, (object) => decodedPayloadOf(object.dict, object.stream, budget), limits.maxObjects);
  return { objects, top };
}

function readerOf(objects: ReadonlyMap<number, PdfParsedObject>): PdfObjectReader {
  const parsed = new Map<number, PdfParsedValue>();
  const texts = new Map<PdfParsedValue, string>();
  const resolve = (value: PdfParsedValue | undefined): PdfParsedValue | undefined => {
    if (value?.kind !== "ref") return value;
    const object = objects.get(value.id);
    if (object === undefined) return undefined;
    const resolved = parsed.get(value.id) ?? parsePdfValue(object.dict);
    parsed.set(value.id, resolved);
    return resolved;
  };
  const text = (value: PdfParsedValue | undefined): string | undefined => {
    const resolved = resolve(value);
    if (resolved === undefined) return undefined;
    const decoded = texts.get(resolved) ?? textOf(resolved);
    if (decoded !== undefined) texts.set(resolved, decoded);
    return decoded;
  };
  return { resolve, text };
}

async function embeddedFileOf(object: PdfParsedObject, name: string, reader: PdfObjectReader, budget: PdfDecodeBudget): Promise<PdfEmbeddedFile> {
  const { resolve, text } = reader;
  if (object.stream === undefined) throw new Error(`attachment ${name} carries no embedded file stream`);
  const head = dictionaryOf(parsePdfValue(object.dict));
  if (head === undefined || !isFlateOnly(resolve(head.get("Filter"))) || head.has("DecodeParms")) {
    throw new Error(`attachment ${name} is encoded with a filter other than /FlateDecode`);
  }
  const modified = dateOf(text(dictionaryOf(resolve(head.get("Params")))?.get("ModDate")));
  if (modified === undefined) throw new Error(`attachment ${name} carries no valid /ModDate`);
  const subtype = resolve(head.get("Subtype"));
  const payload = await decodedPayloadOf(object.dict, object.stream, budget);
  return {
    mime: subtype?.kind === "name" ? subtype.value : "application/octet-stream",
    bytes: payload === object.stream ? payload.slice() : payload,
    modified,
  };
}

async function attachmentsOf(bytes: Uint8Array<ArrayBuffer>, limits: PdfBoundedLimits): Promise<PdfAttachment[]> {
  const text = decodePdfBytes(bytes);
  if (!text.slice(0, HEADER_WINDOW).includes("%PDF-")) throw new Error("the input carries no %PDF- header");
  const budget: PdfDecodeBudget = { perStream: limits.maxInflatedBytes, total: limits.maxTotalDecodedBytes, spent: 0 };
  const { objects, top } = await objectsOf(bytes, text, limits, budget);
  const reader = readerOf(objects);
  const { resolve } = reader;

  // Every object ends at its own `endobj`, its payload included, so only a keyword past the last one is outside a stream.
  const at = text.lastIndexOf("trailer");
  const trailerText =
    at === -1 || at < text.lastIndexOf("\nendobj")
      ? top.findLast((object) => object.dict.includes("/Type /XRef"))?.dict
      : text.slice(at + "trailer".length);
  if (trailerText === undefined) throw new Error("the file carries no trailer");
  const trailer = dictionaryOf(parsePdfValue(trailerText));
  if (trailer === undefined) throw new Error("the file's trailer is not a dictionary");
  if (trailer.has("Encrypt")) throw new Error("the file is encrypted");
  const catalog = dictionaryOf(resolve(trailer.get("Root")));
  if (catalog === undefined) throw new Error("the trailer names no catalog");
  const root = dictionaryOf(resolve(catalog.get("Names")))?.get("EmbeddedFiles");
  const tree = dictionaryOf(resolve(root));
  if (tree === undefined) throw new Error("the catalog carries no /EmbeddedFiles name tree");

  const entries: [PdfParsedValue | undefined, PdfParsedValue | undefined][] = [];
  const visited = new Set<number>(root?.kind === "ref" ? [root.id] : []);
  const unvisited = (value: PdfParsedValue | undefined): PdfParsedValue | undefined => {
    if (value?.kind !== "ref") return value;
    if (visited.has(value.id)) return undefined;
    visited.add(value.id);
    return resolve(value);
  };
  const pending: PdfDictionary[] = [tree];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    const names = unvisited(node.get("Names"));
    if (names?.kind === "array")
      for (let index = 0; index < names.items.length; index += 2) entries.push([names.items[index], names.items[index + 1]]);
    const kids = unvisited(node.get("Kids"));
    if (kids?.kind !== "array") continue;
    for (const kid of [...kids.items].reverse()) {
      const child = kid.kind === "ref" ? dictionaryOf(unvisited(kid)) : undefined;
      if (child !== undefined) pending.push(child);
    }
  }

  const files = new Map<number, PdfEmbeddedFile>();
  const attachments: PdfAttachment[] = [];
  for (const [key, value] of entries) {
    const spec = dictionaryOf(resolve(value));
    const name = reader.text(spec?.get("UF")) ?? reader.text(spec?.get("F")) ?? reader.text(key);
    if (spec === undefined || name === undefined) throw new Error("an /EmbeddedFiles entry is not a named file specification");
    const streams = dictionaryOf(resolve(spec.get("EF")));
    const reference = streams?.get("F") ?? streams?.get("UF");
    const embedded = reference?.kind === "ref" ? objects.get(reference.id) : undefined;
    if (reference?.kind !== "ref" || embedded === undefined) throw new Error(`attachment ${name} carries no embedded file stream`);
    const file = files.get(reference.id) ?? (await embeddedFileOf(embedded, name, reader, budget));
    files.set(reference.id, file);
    const relationship = resolve(spec.get("AFRelationship"));
    const description = reader.text(spec.get("Desc"));
    attachments.push({
      name,
      ...file,
      relationship:
        relationship?.kind === "name" && RELATIONSHIPS.has(relationship.value) ? (relationship.value as PdfAttachmentRelationship) : "Unspecified",
      ...(description === undefined ? {} : { description }),
    });
  }
  return attachments;
}

/** Every file a PDF embeds under its `/EmbeddedFiles` name tree, read within `limits` and refused as a failure. @public */
export async function readPdfAttachments(bytes: Uint8Array, limits: PdfAttachmentLimits = {}): Promise<Result<PdfAttachment[]>> {
  const bounded: PdfBoundedLimits = {
    maxInputBytes: limits.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES,
    maxObjects: limits.maxObjects ?? DEFAULT_MAX_OBJECTS,
    maxInflatedBytes: limits.maxInflatedBytes ?? DEFAULT_MAX_INFLATED_BYTES,
    maxTotalDecodedBytes: limits.maxTotalDecodedBytes ?? DEFAULT_MAX_TOTAL_DECODED_BYTES,
  };
  if (bytes.length > bounded.maxInputBytes)
    return err(new Error(`the input is ${bytes.length} bytes, past the ${bounded.maxInputBytes}-byte limit`));
  return await result(() => attachmentsOf(unsharedBytesOf(bytes), bounded));
}
