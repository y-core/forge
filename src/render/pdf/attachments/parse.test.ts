import { describe, expect, test } from "bun:test";

import { result } from "../../../result/result";
import { deflate } from "../writer/deflate";
import { inflatedDuring } from "./inflate.fixture";
import {
  decodePdfBytes,
  decodePdfDocText,
  decodedPayloadOf,
  indexPdfObjects,
  inflate,
  parsePdfValue,
  topLevelObjects,
  unpackObjectStream,
} from "./parse";
import type { PdfDecodeBudget, PdfParsedObject } from "./types";

const latin1 = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(text, (character) => character.charCodeAt(0));

function objectsIn(text: string, limits?: Parameters<typeof topLevelObjects>[2]): PdfParsedObject[] {
  return topLevelObjects(latin1(text), text, limits);
}

const MiB = 1024 * 1024;

const settledStreams = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("inflate", () => {
  test("returns the bytes a stream was deflated from, up to and including a limit equal to their length", async () => {
    const original = Uint8Array.from({ length: 4096 }, (_unused, at) => (at * 7) % 256);
    const deflated = await deflate(original);
    expect(await inflate(deflated)).toEqual(original);
    expect(await inflate(deflated, 4096)).toEqual(original);
  });

  test("returns a stream inflating to many times its deflated size whole, up to a limit equal to its length", async () => {
    const original = Uint8Array.from({ length: 3 * MiB + 5 }, (_unused, at) => at % 251);
    const deflated = await deflate(original);
    expect(deflated.length * 8).toBeLessThan(original.length);
    expect(await inflate(deflated)).toEqual(original);
    expect(await inflate(deflated, original.length)).toEqual(original);
    await expect(inflate(deflated, original.length - 1)).rejects.toThrow(`${original.length - 1}-byte limit`);
  });

  test("refuses a stream inflating one byte past the limit", async () => {
    const deflated = await deflate(new Uint8Array(4096));
    await expect(inflate(deflated, 4095)).rejects.toThrow("4095-byte limit");
  });

  test("refuses a corrupt deflate payload, leaving no rejection unhandled once the stream has settled", async () => {
    await expect(inflate(latin1("not a deflate stream at all"))).rejects.toThrow();
    await settledStreams();
  });

  test("refuses a payload cut off partway, leaving no rejection unhandled once the stream has settled", async () => {
    const whole = await deflate(Uint8Array.from({ length: MiB }, (_unused, at) => (at * 7) % 256));
    await expect(inflate(whole.subarray(0, whole.length >> 1))).rejects.toThrow();
    await settledStreams();
  });

  test("refuses a large run of zeros under a small limit, leaving no rejection unhandled once the stream has settled", async () => {
    const zeros = await deflate(new Uint8Array(16 * MiB));
    await expect(inflate(zeros, 1024)).rejects.toThrow("inflates past the 1024-byte limit");
    await settledStreams();
  });

  test("stops decompressing a bomb once past the limit rather than inflating it whole", async () => {
    const whole = 16 * MiB;
    const bomb = await deflate(new Uint8Array(whole));
    const { produced } = await inflatedDuring(() => expect(inflate(bomb, 1024)).rejects.toThrow("1024-byte limit"));
    expect(produced).toBeGreaterThan(1024);
    expect(produced).toBeLessThan(whole);
  });
});

describe("decodedPayloadOf", () => {
  const budgetOf = (perStream: number, total: number): PdfDecodeBudget => ({ perStream, total, spent: 0 });

  test("inflates a /FlateDecode payload and charges its inflated size to the budget", async () => {
    const budget = budgetOf(5, 5);
    expect(await decodedPayloadOf("<< /Filter /FlateDecode >>", await deflate(latin1("hello")), budget)).toEqual(latin1("hello"));
    expect(budget.spent).toBe(5);
  });

  test("returns a payload declaring no filter as it was, charging its stored size", async () => {
    const budget = budgetOf(1, 5);
    const raw = latin1("hello");
    expect(await decodedPayloadOf("<< /Length 5 >>", raw, budget)).toBe(raw);
    expect(budget.spent).toBe(5);
  });

  test("refuses a payload declaring no filter whose stored size passes what the total leaves", async () => {
    const budget = { ...budgetOf(1, 9), spent: 5 };
    await expect(decodedPayloadOf("<< /Length 5 >>", latin1("hello"), budget)).rejects.toThrow("the read decodes past its 9-byte total limit");
    expect(budget.spent).toBe(5);
  });

  test("refuses a payload inflating past the per-stream limit", async () => {
    const deflated = await deflate(new Uint8Array(4096));
    await expect(decodedPayloadOf("<< /Filter /FlateDecode >>", deflated, budgetOf(1024, MiB))).rejects.toThrow("1024-byte limit");
  });

  test("refuses the stream that carries the sum past the total, inflating no stream after it", async () => {
    const deflated = await deflate(new Uint8Array(MiB));
    const budget = budgetOf(MiB, 3 * MiB);
    const { settled, produced } = await inflatedDuring(async () => {
      for (let stream = 0; stream < 5; stream += 1) {
        const decoded = await result(() => decodedPayloadOf("<< /Filter /FlateDecode >>", deflated, budget));
        if (!decoded.ok) return { stream, error: decoded.error.message };
      }
      return { stream: 5, error: "" };
    });
    expect(settled).toEqual({ stream: 3, error: `the read decodes past its ${3 * MiB}-byte total limit` });
    expect(budget.spent).toBe(3 * MiB);
    expect(produced).toBeGreaterThanOrEqual(3 * MiB);
    expect(produced).toBeLessThan(4 * MiB);
  });
});

describe("topLevelObjects", () => {
  test("reads a dictionary object and a stream object, the payload ending at its /Length", () => {
    const text = "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n2 0 obj\n<< /Length 19 >>\nstream\nab\nendobj\nendstream\nendstream\nendobj\n";
    expect(objectsIn(text)).toEqual([
      { id: 1, dict: "<< /Type /Catalog >>" },
      { id: 2, dict: "<< /Length 19 >>\n", stream: latin1("ab\nendobj\nendstream") },
    ]);
  });

  test("leaves a /FlateDecode payload as the deflated bytes the file carries, inflating nothing", async () => {
    const deflated = await deflate(new Uint8Array(4 * MiB));
    const head = latin1(`%PDF-1.7\n1 0 obj\n<< /Filter /FlateDecode /Length ${deflated.length} >>\nstream\n`);
    const bytes = new Uint8Array([...head, ...deflated, ...latin1("\nendstream\nendobj\n")]);
    const { settled, produced } = await inflatedDuring(async () => topLevelObjects(bytes, decodePdfBytes(bytes)));
    expect(settled.map((object) => object.stream)).toEqual([deflated]);
    expect(produced).toBe(0);
  });

  test("does not take a name ending in `stream` for the stream keyword", () => {
    const text =
      "%PDF-1.7\n1 0 obj\n<< /Subtype /application#2foctet-stream\n>>\nendobj\n2 0 obj\n<< /Length 2 >>\nstream\nok\nendstream\nendobj\n";
    expect(objectsIn(text)).toEqual([
      { id: 1, dict: "<< /Subtype /application#2foctet-stream\n>>" },
      { id: 2, dict: "<< /Length 2 >>\n", stream: latin1("ok") },
    ]);
  });

  for (const { fault, dict, refusal } of [
    { fault: "no /Length at all", dict: "<< /Type /EmbeddedFile >>", refusal: "no direct /Length" },
    { fault: "a single-digit indirect /Length", dict: "<< /Length 5 0 R >>", refusal: "no direct /Length" },
    { fault: "a multi-digit indirect /Length", dict: "<< /Length 12 0 R >>", refusal: "no direct /Length" },
    { fault: "a /Length running past the end of the file", dict: "<< /Length 400 >>", refusal: "past the end of the file" },
  ]) {
    test(`refuses a stream object with ${fault}`, () => {
      expect(() => objectsIn(`%PDF-1.7\n1 0 obj\n${dict}\nstream\nhello\nendstream\nendobj\n`)).toThrow(refusal);
    });
  }

  test("refuses a file truncated inside a stream", () => {
    expect(() => objectsIn("%PDF-1.7\n1 0 obj\n<< /Length 11 >>\nstream\nhello")).toThrow("past the end of the file");
  });

  test("reads exactly maxObjects objects and refuses one more", () => {
    const text = `%PDF-1.7\n${[1, 2, 3].map((id) => `${id} 0 obj\n<< >>\nendobj\n`).join("")}`;
    expect(objectsIn(text, { maxObjects: 3 }).map((object) => object.id)).toEqual([1, 2, 3]);
    expect(() => objectsIn(text, { maxObjects: 2 })).toThrow("more than 2 objects");
  });
});

describe("unpackObjectStream", () => {
  const container = (dict: string, payload: string): PdfParsedObject => ({ id: 9, dict, stream: latin1(payload) });

  test("unpacks each object by its pair-table offset, naming the stream that held it", () => {
    const packed = container("<< /Type /ObjStm /N 2 /First 9 >>", "4 0 5 11\n<< /A 1 >>\n(second)");
    expect(unpackObjectStream(packed)).toEqual([
      { id: 4, dict: "<< /A 1 >>\n", container: 9 },
      { id: 5, dict: "(second)", container: 9 },
    ]);
  });

  test("unpacks nothing from a container with no payload", () => {
    expect(unpackObjectStream({ id: 9, dict: "<< /Type /ObjStm /N 2 /First 10 >>" })).toEqual([]);
  });

  for (const { fault, dict, payload } of [
    { fault: "fewer pairs than /N declares", dict: "<< /Type /ObjStm /N 2 /First 4 >>", payload: "4 0\n<< >>" },
    { fault: "a pair that is not an integer", dict: "<< /Type /ObjStm /N 1 /First 4 >>", payload: "4 x\n<< >>" },
  ]) {
    test(`refuses a pair table with ${fault}`, () => {
      expect(() => unpackObjectStream(container(dict, payload))).toThrow("malformed pair table");
    });
  }

  test("refuses a pair table whose offsets run backwards, which would hand two objects one stretch of the stream", () => {
    const packed = container("<< /Type /ObjStm /N 2 /First 9 >>", "4 11 5 0\n<< /A 1 >>\n(second)");
    expect(() => unpackObjectStream(packed)).toThrow("object stream 9 lists its offsets out of order");
  });

  test("unpacks exactly as many objects as the limit leaves and refuses a stream packing more", () => {
    const packed = container("<< /Type /ObjStm /N 2 /First 9 >>", "4 0 5 11\n<< /A 1 >>\n(second)");
    expect(unpackObjectStream(packed, 2).map((object) => object.id)).toEqual([4, 5]);
    expect(() => unpackObjectStream(packed, 1)).toThrow("more objects than the 1 left to read");
  });
});

describe("indexPdfObjects", () => {
  const OBJSTM = "<< /Type /ObjStm /N 2 /First 9 >>";
  const packing = (first: number, second: number): string => `${first} 0 ${second} 11\n<< /A 1 >>\n(second)`;

  function payloads(byContainer: Record<number, string>) {
    const calls: PdfParsedObject[] = [];
    const containerPayload = async (container: PdfParsedObject & { stream: Uint8Array<ArrayBuffer> }) => {
      calls.push(container);
      return latin1(byContainer[container.id] ?? "");
    };
    return { calls, containerPayload };
  }

  test("indexes every top-level object by id and unpacks each container from the payload its callback returns", async () => {
    const plain = { id: 1, dict: "<< /Type /Catalog >>" };
    const image = { id: 2, dict: "<< /Type /XObject /Length 3 >>", stream: latin1("abc") };
    const container = { id: 3, dict: OBJSTM, stream: latin1("still deflated") };
    const { calls, containerPayload } = payloads({ 3: packing(4, 5) });
    const objects = await indexPdfObjects([plain, image, container], containerPayload);
    expect([...objects]).toEqual([
      [1, plain],
      [2, image],
      [3, container],
      [4, { id: 4, dict: "<< /A 1 >>\n", container: 3 }],
      [5, { id: 5, dict: "(second)", container: 3 }],
    ]);
    expect(calls).toEqual([container]);
  });

  test("calls the payload callback once per container across several", async () => {
    const first = { id: 2, dict: OBJSTM, stream: latin1("one") };
    const second = { id: 3, dict: OBJSTM, stream: latin1("two") };
    const { calls, containerPayload } = payloads({ 2: packing(4, 5), 3: packing(6, 7) });
    const objects = await indexPdfObjects([first, second], containerPayload);
    expect(calls.map((call) => call.id)).toEqual([2, 3]);
    expect([...objects.keys()]).toEqual([2, 4, 5, 3, 6, 7]);
  });

  test("lets a packed object replace a top-level object of the same id read before its container", async () => {
    const stale = { id: 4, dict: "<< /Stale true >>" };
    const container = { id: 3, dict: OBJSTM, stream: latin1("deflated") };
    const { containerPayload } = payloads({ 3: packing(4, 5) });
    const objects = await indexPdfObjects([stale, container], containerPayload);
    expect(objects.get(4)).toEqual({ id: 4, dict: "<< /A 1 >>\n", container: 3 });
  });

  test("keeps a container that carries no stream as a plain object and never asks for its payload", async () => {
    const empty = { id: 3, dict: OBJSTM };
    const { calls, containerPayload } = payloads({});
    const objects = await indexPdfObjects([empty], containerPayload);
    expect([...objects]).toEqual([[3, empty]]);
    expect(calls).toEqual([]);
  });

  test("passes on a refusal raised by the payload callback", async () => {
    const container = { id: 3, dict: OBJSTM, stream: latin1("deflated") };
    const refuse = async (): Promise<Uint8Array<ArrayBuffer>> => {
      throw new Error("the read decodes past its budget");
    };
    await expect(indexPdfObjects([container], refuse)).rejects.toThrow("the read decodes past its budget");
  });

  test("counts top-level and packed objects across every container against maxObjects, admitting exactly the limit", async () => {
    const top = [
      { id: 1, dict: "<< /Type /Catalog >>" },
      { id: 2, dict: OBJSTM, stream: latin1("one") },
      { id: 3, dict: OBJSTM, stream: latin1("two") },
    ];
    const { containerPayload } = payloads({ 2: packing(4, 5), 3: packing(6, 7) });
    expect([...(await indexPdfObjects(top, containerPayload, 7)).keys()].toSorted()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    await expect(indexPdfObjects(top, containerPayload, 6)).rejects.toThrow("object stream 3 packs more objects than the 1 left to read");
  });
});

describe("decodePdfBytes", () => {
  test("decodes every byte to the character of its own code point, 0x80–0x9F included", () => {
    const every = Uint8Array.from({ length: 256 }, (_unused, at) => at);
    expect(decodePdfBytes(every)).toBe(String.fromCharCode(...every));
  });

  test("keeps a character's index equal to its byte's offset across a long input", () => {
    const bytes = Uint8Array.from({ length: 3 * 0x8000 + 7 }, (_unused, at) => (at * 31) % 256);
    const text = decodePdfBytes(bytes);
    expect(text).toHaveLength(bytes.length);
    expect(Uint8Array.from(text, (character) => character.charCodeAt(0))).toEqual(bytes);
  });
});

describe("decodePdfDocText", () => {
  const ANNEX_D: readonly (readonly [number, string])[] = [
    [0x18, "˘ˇˆ˙˝˛˚˜"],
    [0x7f, "\uFFFD"],
    [0x80, "•†‡…—–ƒ⁄‹›−‰„“”‘’‚™ﬁﬂŁŒŠŸŽıłœšž\uFFFD€"],
    [0xad, "\uFFFD"],
  ];
  const pdfDocEncoding = Array.from({ length: 256 }, (_unused, byte) => String.fromCharCode(byte));
  for (const [first, run] of ANNEX_D) [...run].forEach((character, offset) => (pdfDocEncoding[first + offset] = character));

  test("decodes each byte to one PDFDocEncoding character at its own index, Latin-1 outside Annex D's departures and U+FFFD where it defines none", () => {
    const every = Uint8Array.from({ length: 256 }, (_unused, byte) => byte);
    expect(Array.from(decodePdfDocText(every))).toEqual(pdfDocEncoding);
  });

  test("decodes no bytes to the empty string", () => {
    expect(decodePdfDocText(new Uint8Array())).toBe("");
  });

  test("maps a departing byte on either side of the 0x8000-byte decoding chunk boundary", () => {
    const bytes = new Uint8Array(0x8000 + 2).fill(0x61);
    bytes[0x7fff] = 0x80;
    bytes[0x8000] = 0xa0;
    expect(decodePdfDocText(bytes)).toBe(`${"a".repeat(0x7fff)}•€a`);
  });
});

describe("parsePdfValue", () => {
  test("reads a dictionary with a reference, a name escape and a UTF-16 string", () => {
    expect(parsePdfValue("<< /Root 1 0 R /Subtype /application#2fxml /UF <FEFF00E9> >>")).toEqual({
      kind: "dict",
      entries: new Map([
        ["Root", { kind: "ref", id: 1 }],
        ["Subtype", { kind: "name", value: "application/xml" }],
        ["UF", { kind: "string", bytes: Uint8Array.of(0xfe, 0xff, 0x00, 0xe9) }],
      ]),
    });
  });

  test("reads a literal string's raw 0x80–0x9F bytes, escapes and nested parentheses as the bytes written", () => {
    const text = decodePdfBytes(new Uint8Array([...latin1("(a\\n(b)\\051\\\\"), 0x80, 0x9f, 0xff, ...latin1(")")]));
    expect(parsePdfValue(text)).toEqual({ kind: "string", bytes: Uint8Array.of(0x61, 0x0a, 0x28, 0x62, 0x29, 0x29, 0x5c, 0x80, 0x9f, 0xff) });
  });

  test("reads an array of numbers, names and keywords", () => {
    expect(parsePdfValue("[1 -2.5 /FlateDecode true null]")).toEqual({
      kind: "array",
      items: [
        { kind: "number", value: 1 },
        { kind: "number", value: -2.5 },
        { kind: "name", value: "FlateDecode" },
        { kind: "keyword", value: "true" },
        { kind: "keyword", value: "null" },
      ],
    });
  });

  for (const { fault, text } of [
    { fault: "an unterminated string", text: "(open" },
    { fault: "an unterminated hex string", text: "<FEFF" },
    { fault: "a non-hex digit", text: "<FEFZ>" },
    { fault: "a dictionary key that is not a name", text: "<< 1 2 >>" },
    { fault: "an unterminated array", text: "[1 2" },
    { fault: "nesting deeper than", text: `${"[".repeat(70)}${"]".repeat(70)}` },
  ]) {
    test(`refuses ${fault}`, () => {
      expect(() => parsePdfValue(text)).toThrow(fault);
    });
  }
});
