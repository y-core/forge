import { describe, expect, it } from "bun:test";

import { utf8Encode } from "./bytes";
import { crc32 } from "./crc32";

describe("crc32", () => {
  it("answers zero for no bytes", () => {
    expect(crc32(utf8Encode(""))).toBe(0);
  });

  it("matches the CRC-32/ISO-HDLC check value, as an unsigned integer", () => {
    const check = crc32(utf8Encode("123456789"));
    expect(check).toBe(0xcbf43926);
    expect(check).toBeGreaterThan(0);
  });

  it("matches the published values for a single byte and a pangram", () => {
    expect(crc32(utf8Encode("a"))).toBe(0xe8b7be43);
    expect(crc32(utf8Encode("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
  });
});
