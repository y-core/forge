import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import type { Result } from "../../../result/types";
import { Text } from "../components";
import { createPdfRenderer } from "../renderer";
import type { PdfAttachment, PdfEmbeddedFont, PdfRendererOptions } from "../types";
import { deflate } from "../writer/deflate";
import { inflatedDuring } from "./inflate.fixture";
import { readPdfAttachments } from "./read";

const latin1 = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(text, (character) => character.charCodeAt(0));
const MiB = 1024 * 1024;

const settledStreams = (): Promise<void> => new Promise((settle) => setTimeout(settle, 0));

const FACE: PdfEmbeddedFont = {
  name: "body",
  postScriptName: "Body-Regular",
  sfnt: new Uint8Array([0, 1, 0, 0]),
  glyphs: new Map(Array.from({ length: 96 }, (_glyph, at) => [at + 32, at + 3] as const)),
  metrics: { unitsPerEm: 1000, ascent: 800, descent: -200, bbox: [0, 0, 1000, 1000], advances: new Map() },
};

const ARCHIVAL: PdfRendererOptions = {
  archival: "a-3b",
  metadata: "standard",
  fonts: [FACE],
  defaultFont: { regular: "body", bold: "body" },
  info: { title: "Invoice", created: new Date(Date.UTC(2026, 9, 14, 9)) },
};

const INVOICE: PdfAttachment = {
  name: "invoice.xml",
  mime: "application/xml",
  bytes: new TextEncoder().encode('<invoice total="12.50"/>'),
  relationship: "Source",
  description: "The invoice as structured data",
  modified: new Date(Date.UTC(2026, 9, 14, 8, 55)),
};

const WRITTEN: PdfAttachment[] = [
  INVOICE,
  {
    name: "Rechnung März 日本.bin",
    mime: "application/octet-stream",
    bytes: Uint8Array.from({ length: 256 }, (_unused, at) => 255 - at),
    relationship: "Data",
    modified: new Date(Date.UTC(2026, 9, 14, 8, 55, 7, 250)),
  },
  {
    name: "notes.txt",
    mime: "text/plain",
    bytes: new TextEncoder().encode("trailer\nendstream\nendobj\n"),
    relationship: "Supplement",
    description: "Überblick — 3 €",
    modified: new Date(Date.UTC(1999, 11, 31, 23, 59, 59)),
  },
];

const READ_BACK: PdfAttachment[] = [
  INVOICE,
  {
    name: "Rechnung März 日本.bin",
    mime: "application/octet-stream",
    bytes: Uint8Array.from({ length: 256 }, (_unused, at) => 255 - at),
    relationship: "Data",
    modified: new Date(Date.UTC(2026, 9, 14, 8, 55, 7)),
  },
  WRITTEN[2] as PdfAttachment,
];

const byName = (files: readonly PdfAttachment[]): PdfAttachment[] => [...files].sort((a, b) => (a.name < b.name ? -1 : 1));

async function rendered(options: PdfRendererOptions): Promise<Uint8Array<ArrayBuffer>> {
  const file = await createPdfRenderer(options).render({ title: "Invoice", content: [Text({ children: "Total" })] });
  if (!file.ok) throw file.error;
  return file.data;
}

async function refusalOf(read: Promise<Result<PdfAttachment[]>>): Promise<string> {
  await expect(read).resolves.toMatchObject({ ok: false });
  const settled = await read;
  await settledStreams();
  if (settled.ok) return "";
  expect(settled.error).toBeInstanceOf(Error);
  return settled.error.message;
}

type PdfTestBody = string | { entries: string; payload: Uint8Array };

function fileOf(objects: readonly (readonly [number, PdfTestBody])[], trailer = "trailer\n<< /Root 1 0 R >>\n"): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [latin1("%PDF-1.7\n")];
  for (const [id, body] of objects) {
    if (typeof body === "string") parts.push(latin1(`${id} 0 obj\n${body}\nendobj\n`));
    else
      parts.push(
        latin1(`${id} 0 obj\n<< ${body.entries} /Length ${body.payload.length} >>\nstream\n`),
        body.payload,
        latin1("\nendstream\nendobj\n"),
      );
  }
  parts.push(latin1(`${trailer}%%EOF\n`));
  return new Uint8Array(parts.flatMap((part) => [...part]));
}

const CATALOG = "<< /Type /Catalog /Names << /EmbeddedFiles 2 0 R >> >>";
const SPEC = "<< /Type /Filespec /F (note.txt) /UF (note.txt) /AFRelationship /Data /EF << /F 4 0 R >> >>";
const PLAIN = "/Type /EmbeddedFile /Subtype /text#2fplain /Params << /ModDate (D:20261014085507Z) >>";
const embedded = (entries = PLAIN, payload: Uint8Array = latin1("hello")): PdfTestBody => ({ entries, payload });

function noteFile(spec = SPEC, stream: PdfTestBody = embedded(), trailer?: string): Uint8Array<ArrayBuffer> {
  return fileOf(
    [
      [1, CATALOG],
      [2, "<< /Names [(note.txt) 3 0 R] >>"],
      [3, spec],
      [4, stream],
    ],
    trailer,
  );
}

const CUT_OFF = (await deflate(Uint8Array.from({ length: MiB }, (_unused, at) => (at * 7) % 256))).subarray(0, 4096);

const NOTE: PdfAttachment = {
  name: "note.txt",
  mime: "text/plain",
  bytes: latin1("hello"),
  relationship: "Data",
  modified: new Date(Date.UTC(2026, 9, 14, 8, 55, 7)),
};

describe("readPdfAttachments reads back what the renderer attached", () => {
  for (const compress of [true, false]) {
    test(`returns every attachment byte for byte, compress ${compress}`, async () => {
      const file = await rendered({ ...ARCHIVAL, compress, attachments: WRITTEN });
      const read = await readPdfAttachments(file);
      if (!read.ok) throw read.error;
      expect(byName(read.data)).toEqual(byName(READ_BACK));
    });
  }

  test("reads back a name and a description each past 1 MiB intact", async () => {
    const name = `${Array.from({ length: MiB }, (_unused, at) => String.fromCharCode(0x41 + (at % 26))).join("")}.xml`;
    const description = Array.from({ length: MiB }, (_unused, at) => String.fromCharCode(0x61 + ((at * 7) % 26))).join("");
    const file = await rendered({ attachments: [{ ...INVOICE, name, description }] });
    expect(file.length).toBeLessThanOrEqual(6 * MiB);
    expect(await readPdfAttachments(file)).toEqual({ ok: true, data: [{ ...INVOICE, name, description }] });
  });

  test("reads a render that did not ask for an archival level", async () => {
    expect(await readPdfAttachments(await rendered({ attachments: [INVOICE] }))).toEqual({ ok: true, data: [INVOICE] });
  });
});

describe("readPdfAttachments refuses, as a failed Result and never a throw or a rejection left unhandled", () => {
  test("an input past maxInputBytes, which it would otherwise have read", async () => {
    const file = await rendered({ ...ARCHIVAL, attachments: [INVOICE] });
    await expect(readPdfAttachments(file, { maxInputBytes: file.length })).resolves.toEqual({ ok: true, data: [INVOICE] });
    expect(await refusalOf(readPdfAttachments(file, { maxInputBytes: file.length - 1 }))).toContain(`${file.length - 1}-byte limit`);
  });

  test("a stream inflating past maxInflatedBytes, which it reads under a limit the stream fits", async () => {
    const bomb = await deflate(new Uint8Array(1024 * 1024));
    const file = noteFile(SPEC, embedded(`${PLAIN} /Filter /FlateDecode`, bomb));
    expect(bomb.length).toBeLessThan(64 * 1024);
    expect(await refusalOf(readPdfAttachments(file, { maxInflatedBytes: 64 * 1024 }))).toContain("65536-byte limit");
    await expect(readPdfAttachments(file, { maxInflatedBytes: 1024 * 1024 })).resolves.toEqual({
      ok: true,
      data: [{ ...NOTE, bytes: new Uint8Array(1024 * 1024) }],
    });
  });

  test("streams that each fit maxInflatedBytes but together pass maxTotalDecodedBytes, inflating no further than the total", async () => {
    const zeros = await deflate(new Uint8Array(MiB));
    const files = [0, 1, 2, 3, 4, 5];
    const objects: [number, PdfTestBody][] = [
      [1, CATALOG],
      [2, `<< /Names [${files.map((at) => `(f${at}.bin) ${10 + at * 2} 0 R`).join(" ")}] >>`],
    ];
    for (const at of files) {
      objects.push(
        [10 + at * 2, SPEC.replaceAll("note.txt", `f${at}.bin`).replace("4 0 R", `${11 + at * 2} 0 R`)],
        [11 + at * 2, embedded(`${PLAIN} /Filter /FlateDecode`, zeros)],
      );
    }
    const file = fileOf(objects);
    const limits = { maxInflatedBytes: MiB, maxTotalDecodedBytes: 4 * MiB };
    const { settled, produced } = await inflatedDuring(async () => await refusalOf(readPdfAttachments(file, limits)));
    expect(settled).toContain(`${4 * MiB}-byte total limit`);
    expect(produced).toBeLessThan(5 * MiB);
    const read = await readPdfAttachments(file, { ...limits, maxTotalDecodedBytes: 6 * MiB });
    expect(read.ok && read.data.map((attachment) => attachment.bytes.length)).toEqual(files.map(() => MiB));
  });

  test("past 6 MiB of input, of one stream inflated, or of streams decoded together, when no limits are passed", async () => {
    const wide = (size: number): Promise<Result<PdfAttachment[]>> => readPdfAttachments(new Uint8Array(size).fill(0x20));
    expect(await refusalOf(wide(6 * MiB + 1))).toContain(`${6 * MiB}-byte limit`);
    expect(await refusalOf(wide(6 * MiB))).toContain("%PDF-");
    const inflating = async (size: number): Promise<Uint8Array<ArrayBuffer>> =>
      noteFile(SPEC, embedded(`${PLAIN} /Filter /FlateDecode`, await deflate(new Uint8Array(size))));
    expect(await refusalOf(readPdfAttachments(await inflating(6 * MiB + 1)))).toContain(`${6 * MiB}-byte limit`);
    await expect(readPdfAttachments(await inflating(6 * MiB))).resolves.toEqual({ ok: true, data: [{ ...NOTE, bytes: new Uint8Array(6 * MiB) }] });
    const half = await deflate(new Uint8Array(3 * MiB + 1));
    const pair = fileOf([
      [1, CATALOG],
      [2, "<< /Names [(a.bin) 3 0 R (b.bin) 5 0 R] >>"],
      [3, SPEC.replaceAll("note.txt", "a.bin")],
      [4, embedded(`${PLAIN} /Filter /FlateDecode`, half)],
      [5, SPEC.replaceAll("note.txt", "b.bin").replace("4 0 R", "6 0 R")],
      [6, embedded(`${PLAIN} /Filter /FlateDecode`, half)],
    ]);
    expect(await refusalOf(readPdfAttachments(pair))).toContain(`${6 * MiB}-byte total limit`);
  });

  test("a rendered file truncated inside its attached stream", async () => {
    const file = await rendered({ ...ARCHIVAL, compress: false, attachments: [INVOICE] });
    const cut = new TextDecoder("latin1").decode(file).indexOf("<invoice") + 4;
    expect(await refusalOf(readPdfAttachments(file.subarray(0, cut)))).toContain("past the end of the file");
  });

  test("a rendered file with no /EmbeddedFiles, because nothing was attached", async () => {
    expect(await refusalOf(readPdfAttachments(await rendered(ARCHIVAL)))).toContain("/EmbeddedFiles");
  });

  for (const { fault, stream, because } of [
    { fault: "an indirect /Length", stream: `<< ${PLAIN} /Length 5 0 R >>\nstream\nhello\nendstream`, because: "no direct /Length" },
    { fault: "a multi-digit indirect /Length", stream: `<< ${PLAIN} /Length 12 0 R >>\nstream\nhello\nendstream`, because: "no direct /Length" },
    { fault: "a corrupt deflate payload", stream: { entries: `${PLAIN} /Filter /FlateDecode`, payload: latin1("not deflate") }, because: "" },
    { fault: "a deflate payload cut off partway", stream: { entries: `${PLAIN} /Filter /FlateDecode`, payload: CUT_OFF }, because: "" },
  ]) {
    test(`a malformed object: ${fault}`, async () => {
      expect(await refusalOf(readPdfAttachments(noteFile(SPEC, stream)))).toContain(because);
    });
  }

  test("a file with no %PDF- header", async () => {
    const file = noteFile();
    expect(await refusalOf(readPdfAttachments(file.subarray("%PDF-1.7\n".length)))).toContain("%PDF-");
  });

  test("an encrypted file", async () => {
    expect(await refusalOf(readPdfAttachments(noteFile(SPEC, embedded(), "trailer\n<< /Root 1 0 R /Encrypt 9 0 R >>\n")))).toContain("encrypted");
  });

  for (const { fault, entries } of [
    { fault: "/ASCIIHexDecode", entries: `${PLAIN} /Filter /ASCIIHexDecode` },
    { fault: "a /FlateDecode chain with a second filter", entries: `${PLAIN} /Filter [/FlateDecode /ASCII85Decode]` },
    { fault: "/FlateDecode with /DecodeParms", entries: `${PLAIN} /Filter /FlateDecode /DecodeParms << /Predictor 12 >>` },
  ]) {
    test(`an attachment encoded with ${fault}`, async () => {
      const payload = await deflate(latin1("hello"));
      expect(await refusalOf(readPdfAttachments(noteFile(SPEC, embedded(entries, payload))))).toContain("other than /FlateDecode");
    });
  }

  for (const { fault, entries } of [
    { fault: "no /Params", entries: "/Type /EmbeddedFile /Subtype /text#2fplain" },
    { fault: "/Params without /ModDate", entries: "/Type /EmbeddedFile /Subtype /text#2fplain /Params << /Size 5 >>" },
    { fault: "a /ModDate that is not a date", entries: "/Type /EmbeddedFile /Subtype /text#2fplain /Params << /ModDate (yesterday) >>" },
  ]) {
    test(`an attachment with ${fault}`, async () => {
      expect(await refusalOf(readPdfAttachments(noteFile(SPEC, embedded(entries))))).toContain("/ModDate");
    });
  }

  test("a file carrying more top-level objects than maxObjects", async () => {
    await expect(readPdfAttachments(noteFile(), { maxObjects: 4 })).resolves.toEqual({ ok: true, data: [NOTE] });
    expect(await refusalOf(readPdfAttachments(noteFile(), { maxObjects: 3 }))).toContain("more than 3 objects");
  });

  test("a file whose object stream packs more objects than maxObjects leaves", async () => {
    const packed: [number, string][] = [
      [1, CATALOG],
      [2, "<< /Names [(note.txt) 3 0 R] >>"],
      [3, SPEC],
    ];
    const table = `${packed.map(([id], index) => `${id} ${packed.slice(0, index).reduce((at, [, body]) => at + body.length + 1, 0)}`).join(" ")}\n`;
    const payload = latin1(`${table}${packed.map(([, body]) => body).join("\n")}\n`);
    const file = fileOf([
      [4, embedded()],
      [5, { entries: `/Type /ObjStm /N 3 /First ${table.length}`, payload }],
    ]);
    await expect(readPdfAttachments(file, { maxObjects: 5 })).resolves.toEqual({ ok: true, data: [NOTE] });
    expect(await refusalOf(readPdfAttachments(file, { maxObjects: 4 }))).toContain("more objects than the 2 left to read");
  });
});

describe("readPdfAttachments reads what a file declares", () => {
  test("never inflates a stream the name tree does not reach, even one past maxInflatedBytes", async () => {
    const file = fileOf([
      [1, CATALOG],
      [2, "<< /Names [(note.txt) 3 0 R] >>"],
      [3, SPEC],
      [4, embedded()],
      [5, { entries: "/Filter /FlateDecode", payload: await deflate(new Uint8Array(MiB)) }],
    ]);
    const { settled, produced } = await inflatedDuring(async () => await readPdfAttachments(file, { maxInflatedBytes: 1024 }));
    expect(settled).toEqual({ ok: true, data: [NOTE] });
    expect(produced).toBe(0);
  });

  for (const { names, spec, name } of [
    {
      names: "a /UF beside an /F, preferring the /UF",
      spec: SPEC.replace("/UF (note.txt)", "/UF <FEFF00FC006200650072002E007400780074>"),
      name: "über.txt",
    },
    { names: "an /F alone", spec: SPEC.replace("/F (note.txt) /UF (note.txt)", "/F (dos.txt)"), name: "dos.txt" },
    { names: "neither, falling back to the name-tree key", spec: SPEC.replace("/F (note.txt) /UF (note.txt)", ""), name: "note.txt" },
  ]) {
    test(`names a file specification with ${names}`, async () => {
      await expect(readPdfAttachments(noteFile(spec))).resolves.toEqual({ ok: true, data: [{ ...NOTE, name }] });
    });
  }

  test("reads a /UF and a /Desc written without a byte-order mark as PDFDocEncoding", async () => {
    const spec = SPEC.replace("/UF (note.txt)", "/UF <934E4F5445A02E747874> /Desc <8D3518E99F2DAD8E>");
    await expect(readPdfAttachments(noteFile(spec))).resolves.toEqual({
      ok: true,
      data: [{ ...NOTE, name: "ﬁNOTE€.txt", description: "“5˘é\uFFFD-\uFFFD”" }],
    });
  });

  for (const { declares, spec } of [
    { declares: "an unknown /AFRelationship", spec: SPEC.replace("/AFRelationship /Data", "/AFRelationship /Bogus") },
    { declares: "no /AFRelationship", spec: SPEC.replace("/AFRelationship /Data", "") },
  ]) {
    test(`reads a specification with ${declares} as Unspecified`, async () => {
      await expect(readPdfAttachments(noteFile(spec))).resolves.toEqual({ ok: true, data: [{ ...NOTE, relationship: "Unspecified" }] });
    });
  }

  test("reads a stream with no /Subtype as application/octet-stream", async () => {
    const file = noteFile(SPEC, embedded(PLAIN.replace("/Subtype /text#2fplain ", "")));
    await expect(readPdfAttachments(file)).resolves.toEqual({ ok: true, data: [{ ...NOTE, mime: "application/octet-stream" }] });
  });

  test("reads a /ModDate written with a local offset as the instant it names", async () => {
    const file = noteFile(SPEC, embedded(PLAIN.replace("(D:20261014085507Z)", "(D:20261014105507+02'00')")));
    await expect(readPdfAttachments(file)).resolves.toEqual({ ok: true, data: [NOTE] });
  });

  test("reads the leaves of a /Kids name tree in order", async () => {
    const file = fileOf([
      [1, CATALOG],
      [2, "<< /Kids [5 0 R 6 0 R] >>"],
      [3, SPEC],
      [4, embedded()],
      [5, "<< /Limits [(note.txt) (note.txt)] /Names [(note.txt) 3 0 R] >>"],
      [6, "<< /Limits [(other.txt) (other.txt)] /Names [(other.txt) 7 0 R] >>"],
      [7, SPEC.replaceAll("note.txt", "other.txt").replace("4 0 R", "8 0 R")],
      [8, embedded(PLAIN, latin1("world"))],
    ]);
    await expect(readPdfAttachments(file)).resolves.toEqual({ ok: true, data: [NOTE, { ...NOTE, name: "other.txt", bytes: latin1("world") }] });
  });

  test("reads each leaf of a /Kids tree that cycles back on itself once, and terminates", async () => {
    const file = fileOf([
      [1, CATALOG],
      [2, "<< /Kids [5 0 R] >>"],
      [3, SPEC],
      [4, embedded()],
      [5, "<< /Kids [2 0 R 5 0 R 6 0 R] >>"],
      [6, "<< /Names [(note.txt) 3 0 R] >>"],
    ]);
    await expect(readPdfAttachments(file)).resolves.toEqual({ ok: true, data: [NOTE] });
  });

  test("reads a root carrying /Names that lists itself in /Kids once", async () => {
    const file = fileOf([
      [1, CATALOG],
      [2, "<< /Names [(note.txt) 3 0 R] /Kids [2 0 R] >>"],
      [3, SPEC],
      [4, embedded()],
    ]);
    await expect(readPdfAttachments(file)).resolves.toEqual({ ok: true, data: [NOTE] });
  });

  test("finds the trailer of a cross-reference-stream file whose attachment mentions the word trailer", async () => {
    const file = fileOf(
      [
        [1, CATALOG],
        [2, "<< /Names [(note.txt) 3 0 R] >>"],
        [3, SPEC],
        [4, embedded(PLAIN, latin1("see the trailer << /Root 9 0 R >>"))],
        [5, { entries: "/Type /XRef /Size 6 /Root 1 0 R", payload: new Uint8Array() }],
      ],
      "startxref\n0\n",
    );
    await expect(readPdfAttachments(file)).resolves.toEqual({ ok: true, data: [{ ...NOTE, bytes: latin1("see the trailer << /Root 9 0 R >>") }] });
  });
});

describe("readPdfAttachments leaves the caller's bytes as they were", () => {
  test("neither writes to the input nor returns a stored stream that shares its memory", async () => {
    const file = noteFile();
    const before = file.slice();
    const read = await readPdfAttachments(file);
    if (!read.ok) throw read.error;
    read.data[0]?.bytes.fill(0);
    expect(file).toEqual(before);
  });

  test("reads an input backed by a SharedArrayBuffer as it reads any other", async () => {
    const file = noteFile();
    const shared = new Uint8Array(new SharedArrayBuffer(file.length));
    shared.set(file);
    await expect(readPdfAttachments(shared)).resolves.toEqual({ ok: true, data: [NOTE] });
  });
});

describe("readPdfAttachments reads each object once, however many entries reach it", () => {
  const sharing = (count: number, spec: string, stream: PdfTestBody): Uint8Array<ArrayBuffer> =>
    fileOf([
      [1, CATALOG],
      [2, `<< /Names [${Array.from({ length: count }, (_unused, at) => `(f${at}.bin) 3 0 R`).join(" ")}] >>`],
      [3, spec],
      [4, stream],
    ]);

  test("charges a stored stream to maxTotalDecodedBytes once, and every entry naming it shares its bytes", async () => {
    const file = sharing(40, SPEC.replace("/F (note.txt) /UF (note.txt) ", ""), embedded(PLAIN, new Uint8Array(MiB).fill(7)));
    expect(await refusalOf(readPdfAttachments(file, { maxTotalDecodedBytes: MiB - 1 }))).toContain(`${MiB - 1}-byte total limit`);
    const read = await readPdfAttachments(file, { maxTotalDecodedBytes: MiB });
    if (!read.ok) throw read.error;
    expect(read.data.map((attachment) => attachment.name)).toEqual(Array.from({ length: 40 }, (_unused, at) => `f${at}.bin`));
    expect(read.data.every((attachment) => attachment.bytes === read.data[0]?.bytes)).toBe(true);
    expect(read.data[0]?.bytes).toEqual(new Uint8Array(MiB).fill(7));
  });

  test("inflates a compressed stream once, however many entries name it", async () => {
    const file = sharing(40, SPEC, embedded(`${PLAIN} /Filter /FlateDecode`, await deflate(new Uint8Array(MiB))));
    const { settled, produced } = await inflatedDuring(async () => await readPdfAttachments(file, { maxTotalDecodedBytes: MiB }));
    expect(settled.ok && settled.data.map((attachment) => attachment.bytes.length)).toEqual(Array.from({ length: 40 }, () => MiB));
    expect(produced).toBe(MiB);
  });

  test("reads 10,000 entries naming one file specification padded past 1 MB inside two seconds", async () => {
    const description = `<FEFF${"0041".repeat(256 * 1024)}>`;
    const spec = SPEC.replace("/EF", `/Desc ${description} /Pad [${"0 ".repeat(256 * 1024)}] /EF`);
    expect(spec.length).toBeGreaterThan(MiB);
    const file = sharing(10_000, spec, embedded());
    const began = performance.now();
    const read = await readPdfAttachments(file);
    expect(performance.now() - began).toBeLessThan(2000);
    if (!read.ok) throw read.error;
    expect(read.data).toHaveLength(10_000);
    expect(read.data[9_999]).toEqual({ ...NOTE, description: "A".repeat(256 * 1024) });
  });

  test("reads a /Names array that several nodes of the tree share once", async () => {
    const file = fileOf([
      [1, CATALOG],
      [2, "<< /Kids [5 0 R 6 0 R] >>"],
      [3, SPEC],
      [4, embedded()],
      [5, "<< /Names 7 0 R /Kids 8 0 R >>"],
      [6, "<< /Names 7 0 R /Kids 8 0 R >>"],
      [7, "[(note.txt) 3 0 R]"],
      [8, "[5 0 R 6 0 R]"],
    ]);
    await expect(readPdfAttachments(file)).resolves.toEqual({ ok: true, data: [NOTE] });
  });
});

describe("readPdfAttachments scans a file in time linear in its size", () => {
  const objects = Array.from({ length: 50_000 }, (_unused, at) => `${at + 1} 0 obj\n<< >>\nendobj\n`).join("");
  for (const { padding, tail } of [
    { padding: "spaces", tail: " ".repeat(10 * MiB) },
    { padding: "digits", tail: "7".repeat(10 * MiB) },
    { padding: "spaces after a dictionary's close", tail: `>>${" ".repeat(10 * MiB)}` },
  ]) {
    test(`reads 50,000 objects and 10 MiB of trailing ${padding} inside two seconds`, async () => {
      const file = new TextEncoder().encode(`%PDF-1.7\n${objects}${tail}`);
      const began = performance.now();
      expect(await refusalOf(readPdfAttachments(file, { maxInputBytes: 16 * MiB }))).toContain("no trailer");
      expect(performance.now() - began).toBeLessThan(2000);
    });
  }
});

describe("the attachments module", () => {
  test("reaches only relative modules, so it imports no Bun or Node API and touches no Bun, Node or process global", () => {
    const pending = [resolve(import.meta.dir, "mod.ts")];
    const reached = new Set<string>();
    const bare: string[] = [];
    const globals: string[] = [];
    for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
      if (reached.has(file)) continue;
      reached.add(file);
      const source = readFileSync(file, "utf-8");
      if (/\b(?:Bun|process|Buffer)\b/.test(source.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, ""))) globals.push(file);
      for (const [, specifier = ""] of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)"([^"]+)"/g)) {
        if (!specifier.startsWith(".")) bare.push(specifier);
        else pending.push(`${resolve(dirname(file), specifier)}.ts`);
      }
    }
    const root = resolve(import.meta.dir, "../../..");
    expect({ bare, globals }).toEqual({ bare: [], globals: [] });
    const armed = ["render/pdf/attachments/parse.ts", "render/pdf/attachments/read.ts", "result/result.ts"];
    expect(
      [...reached]
        .map((file) => relative(root, file))
        .filter((file) => armed.includes(file))
        .sort(),
    ).toEqual(armed);
  });
});
