import { describe, expect, it } from "bun:test";

import { bytesToHex, utf8Encode } from "./bytes";
import { sha256 } from "./digest";

describe("sha256", () => {
  it("returns 32 bytes", async () => {
    expect((await sha256("")).byteLength).toBe(32);
  });

  it("matches the known SHA-256 digest of an empty string", async () => {
    // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    const hex = bytesToHex(await sha256(""));
    expect(hex).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("accepts Uint8Array input", async () => {
    const viaString = await sha256("abc");
    const viaBytes = await sha256(utf8Encode("abc"));
    expect(viaBytes).toEqual(viaString);
  });
});
