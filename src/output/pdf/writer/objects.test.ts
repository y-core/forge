import { describe, expect, test } from "bun:test";

import { PDF_ENCODER, createObjectManager, objectBodyBytes, streamObject } from "./objects";

const decoder = new TextDecoder("latin1");

describe("the object manager", () => {
  test("allocates numbers in the order the document declares them", () => {
    const manager = createObjectManager();
    expect([manager.allocate("<< /a >>"), manager.allocate("<< /b >>"), manager.allocate("<< /c >>")]).toEqual([1, 2, 3]);
    expect(manager.objects().map((object) => object.body)).toEqual(["<< /a >>", "<< /b >>", "<< /c >>"]);
  });

  test("hands a reserved number back before its body exists, which is what lets a page name a font first", () => {
    const manager = createObjectManager();
    const held = manager.reserve();
    expect(manager.allocate("<< /after >>")).toBe(held + 1);
    manager.fill(held, "<< /filled >>");
    expect(manager.objects().map((object) => object.body)).toEqual(["<< /filled >>", "<< /after >>"]);
  });

  test("refuses to fill a number nothing reserved, rather than writing past the list", () => {
    expect(() => createObjectManager().fill(7, "<< >>")).toThrow("fill: object 7 was never reserved");
  });
});

describe("what an object body becomes on the way to the file", () => {
  test("writes a string body as one run of bytes", () => {
    expect(objectBodyBytes("<< /a >>").map((part) => decoder.decode(part))).toEqual(["<< /a >>"]);
  });

  // The binary payload is passed through rather than re-encoded: encoding it would rewrite every
  // byte at or above 0x80 and desynchronize every offset after it.
  test("keeps a stream body's bytes between its head and its tail, untouched", () => {
    const bytes = new Uint8Array([0x80, 0xff, 0x00]);
    const parts = objectBodyBytes({ head: "<< >>\nstream\n", bytes, tail: "\nendstream" });
    expect(parts[1]).toBe(bytes);
    expect(parts.map((part) => part.length)).toEqual([13, 3, 10]);
  });
});

describe("streamObject", () => {
  // `/Length` is what a reader seeks by, so it counts encoded bytes and never characters.
  test("declares the byte length of the body rather than its character count", () => {
    const body = streamObject("é", "/Type /Metadata");
    expect(typeof body === "string" ? "" : body.head).toContain("/Length 2");
    expect(PDF_ENCODER.encode("é").length).toBe(2);
  });
});
