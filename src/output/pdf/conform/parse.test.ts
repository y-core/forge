import { describe, expect, test } from "bun:test";

import { deflate } from "../writer";
import { parsePdfObjects, unpackObjectStream } from "./parse.fixture";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// The fixtures are hand-built rather than rendered: a parser tested against the writer it reads can
// only agree with it, including where both are wrong about the format.
function concat(parts: readonly (string | Uint8Array<ArrayBuffer>)[]): Uint8Array<ArrayBuffer> {
  const bytes = parts.map((part) => (typeof part === "string" ? encoder.encode(part) : part));
  const out = new Uint8Array(bytes.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of bytes) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const TRAP = "0.5 w\nendobj is a run of payload bytes here, not a token\n";
const classic = concat([
  "%PDF-1.4\n",
  "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
  `2 0 obj\n<< /Length ${encoder.encode(TRAP).length} >>\nstream\n`,
  TRAP,
  "\nendstream\nendobj\n",
  "xref\n0 3\n0000000000 65535 f \n",
  "trailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n9\n%%EOF\n",
]);

describe("a file with a classic cross-reference table", () => {
  test("resolves every object, and takes a stream by its declared length rather than by its endobj", async () => {
    const file = await parsePdfObjects(classic);
    expect([...file.objects.keys()]).toEqual([1, 2]);
    expect(file.objects.get(1)?.dict).toContain("/Type /Catalog");
    expect(decoder.decode(file.objects.get(2)?.stream)).toBe(TRAP);
  });

  test("reads the trailer dictionary, which is where a classic file names its root", async () => {
    expect((await parsePdfObjects(classic)).trailer).toContain("/Size 3 /Root 1 0 R");
  });
});

describe("a file with an /XRef stream and no trailer keyword", () => {
  const rows = new Uint8Array(3 * 7);
  test("takes the root from the stream's own dictionary", async () => {
    const deflated = await deflate(rows);
    const bytes = concat([
      "%PDF-1.5\n",
      "1 0 obj\n<< /Type /Catalog >>\nendobj\n",
      `2 0 obj\n<< /Type /XRef /W [1 4 2] /Size 3 /Root 1 0 R /Filter /FlateDecode /Length ${deflated.length} >>\nstream\n`,
      deflated,
      "\nendstream\nendobj\n",
      "startxref\n40\n%%EOF\n",
    ]);
    const file = await parsePdfObjects(bytes);
    expect(decoder.decode(bytes)).not.toContain("trailer");
    expect(file.trailer).toContain("/Type /XRef");
    expect(file.trailer).toContain("/Root 1 0 R");
    expect(file.objects.get(2)?.stream).toHaveLength(rows.length);
  });
});

const BODIES = ["<< /Type /StructElem /S /H1 >>", "<< /Type /StructElem /S /P >>"];

async function objectStreamFile(): Promise<Uint8Array<ArrayBuffer>> {
  const table = `5 0 6 ${encoder.encode(BODIES[0] ?? "").length} `;
  const first = encoder.encode(table).length;
  const packed = await deflate(table + BODIES.join(""));
  return concat([
    "%PDF-1.5\n",
    "1 0 obj\n<< /Type /Catalog >>\nendobj\n",
    `3 0 obj\n<< /Type /ObjStm /N 2 /First ${first} /Filter /FlateDecode /Length ${packed.length} >>\nstream\n`,
    packed,
    "\nendstream\nendobj\n",
    "%%EOF\n",
  ]);
}

describe("a file whose objects are packed into an /ObjStm", () => {
  test("resolves a packed object by its pair-table offset, not by any file offset", async () => {
    const file = await parsePdfObjects(await objectStreamFile());
    expect(file.objects.get(5)?.dict).toBe(BODIES[0]);
    expect(file.objects.get(6)?.dict).toBe(BODIES[1]);
  });

  test("records the container each packed object came out of, so its location is readable", async () => {
    const file = await parsePdfObjects(await objectStreamFile());
    expect(file.objects.get(5)?.container).toBe(3);
    expect(file.objects.get(1)?.container).toBeUndefined();
  });

  test("unpacks nothing from a container carrying no stream, rather than inventing an object", () => {
    expect(unpackObjectStream({ id: 3, dict: "<< /Type /ObjStm /N 2 /First 8 >>" })).toEqual([]);
  });
});
