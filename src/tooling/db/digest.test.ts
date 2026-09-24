import { describe, expect, it } from "bun:test";

import { sha256 } from "./digest";

describe("sha256()", () => {
  it("hashes a string to the published vector", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("hashes the empty string to the published vector", () => {
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("hashes bytes and the string they decode to identically", () => {
    expect(sha256(new Uint8Array([0x61, 0x62, 0x63]))).toBe(sha256("abc"));
  });

  it("moves on one changed byte", () => {
    expect(sha256("abd")).not.toBe(sha256("abc"));
  });
});
