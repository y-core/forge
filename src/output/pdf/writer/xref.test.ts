import { describe, expect, test } from "bun:test";

import { inflate } from "../conform/parse.fixture";
import { objectStreamBody, xrefRows } from "./xref";

const XREF_ROW = 7;

function rowAt(rows: Uint8Array<ArrayBuffer>, index: number): { type: number; field: number; generation: number } {
  const view = new DataView(rows.buffer);
  const at = index * XREF_ROW;
  return { type: rows[at] ?? 0, field: view.getUint32(at + 1), generation: view.getUint16(at + 5) };
}

describe("the cross-reference rows an /XRef stream carries", () => {
  test("writes one fixed-width row per object, plus the free head", () => {
    expect(xrefRows([{ offset: 15 }, { offset: 99 }]).length).toBe(3 * XREF_ROW);
  });

  // Object 0 heads the free list, and its generation is the one place 65535 is written.
  test("heads the table with the free entry every reader expects at row zero", () => {
    expect(rowAt(xrefRows([{ offset: 15 }]), 0)).toEqual({ type: 0, field: 0, generation: 0xffff });
  });

  test("marks an uncompressed object type 1 and carries its byte offset", () => {
    expect(rowAt(xrefRows([{ offset: 4096 }]), 1)).toEqual({ type: 1, field: 4096, generation: 0 });
  });

  // The distinction the whole compressed path rests on: a packed object names its container and its
  // position inside it, where a loose one names a place in the file.
  test("marks a packed object type 2, naming its container and its index within it", () => {
    expect(rowAt(xrefRows([{ container: 12, index: 3 }]), 1)).toEqual({ type: 2, field: 12, generation: 3 });
  });
});

describe("an /ObjStm packs the dictionaries a reader does not seek to directly", () => {
  const GROUP = [
    { id: 4, body: "<< /a >>" },
    { id: 9, body: "<< /bb >>" },
  ];

  test("declares the count it packed and the filter it packed them under", async () => {
    const body = await objectStreamBody(GROUP);
    expect(typeof body === "string" ? "" : body.head).toContain("/Type /ObjStm /N 2");
    expect(typeof body === "string" ? "" : body.head).toContain("/Filter /FlateDecode");
  });

  test("opens with the pair table, so a reader finds each object by number and offset", async () => {
    const body = await objectStreamBody(GROUP);
    if (typeof body === "string") throw new Error("expected a stream body");
    expect(new TextDecoder().decode(await inflate(body.bytes as Uint8Array<ArrayBuffer>))).toStartWith("4 0 9 9\n");
  });

  // Every offset is an encoded byte length: one non-ASCII byte in a `/Title` or an `/Alt` otherwise
  // desynchronizes every object after it in the container.
  test("measures each offset in bytes, not characters, so a multi-byte body does not shift the rest", async () => {
    const body = await objectStreamBody([
      { id: 1, body: "(é)" },
      { id: 2, body: "<< >>" },
    ]);
    if (typeof body === "string") throw new Error("expected a stream body");
    expect(new TextDecoder().decode(await inflate(body.bytes as Uint8Array<ArrayBuffer>))).toStartWith("1 0 2 5\n");
  });
});
