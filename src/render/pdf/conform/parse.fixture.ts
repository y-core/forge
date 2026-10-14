import { decodePdfBytes, decodedPayloadOf, indexPdfObjects, topLevelObjects } from "../attachments/parse";
import type { PdfParsedFile } from "./types.fixture";

// Resolution is by scan and not by offset, which is deliberate: `writer.test.ts` is what holds the
// cross-reference rows, and a reader driven by them could not be used to check them.
/** Every object a file carries, found by scanning object headers and unpacking each `/ObjStm`. @internal */
export async function parsePdfObjects(bytes: Uint8Array<ArrayBuffer>): Promise<PdfParsedFile> {
  const text = decodePdfBytes(bytes);
  const budget = { perStream: Number.POSITIVE_INFINITY, total: Number.POSITIVE_INFINITY, spent: 0 };
  const top = await Promise.all(
    topLevelObjects(bytes, text).map(async (object) =>
      object.stream === undefined ? object : { ...object, stream: await decodedPayloadOf(object.dict, object.stream, budget) },
    ),
  );
  const objects = await indexPdfObjects(top, async (object) => object.stream);
  const at = text.lastIndexOf("trailer");
  const stream = top.find((object) => object.dict.includes("/Type /XRef"));
  return { objects, trailer: at === -1 ? (stream?.dict ?? "") : text.slice(at) };
}

/** Every object's dictionary as one text, a packed object's included, for a test asking what a file declares. @internal */
export async function parsePdfText(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const file = await parsePdfObjects(bytes);
  return [...file.objects.values()].map((object) => object.dict).join("\n");
}
