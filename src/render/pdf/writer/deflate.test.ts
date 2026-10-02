import { describe, expect, test } from "bun:test";

import { inflate } from "../conform/parse.fixture";
import { deflate } from "./deflate";
import { PDF_ENCODER } from "./objects";

describe("deflate", () => {
  test("round-trips a string through the filter a `/FlateDecode` entry declares", async () => {
    const text = "<< /Type /Page >>".repeat(40);
    expect(new TextDecoder().decode(await inflate(await deflate(text)))).toBe(text);
  });

  // The case the signature exists for: the cross-reference rows and an object stream's payload are
  // binary, and encoding them as UTF-8 would rewrite every byte at or above 0x80.
  test("passes binary bytes through unchanged rather than re-encoding them", async () => {
    const bytes = new Uint8Array([0x00, 0x7f, 0x80, 0xff, 0xe2, 0x03]) as Uint8Array<ArrayBuffer>;
    expect([...(await inflate(await deflate(bytes)))]).toEqual([...bytes]);
  });

  test("gives a string and its own encoded bytes the same output, so the two callers agree", async () => {
    const text = "é".repeat(50);
    const fromText = await deflate(text);
    const fromBytes = await deflate(PDF_ENCODER.encode(text) as Uint8Array<ArrayBuffer>);
    expect([...fromText]).toEqual([...fromBytes]);
  });
});
