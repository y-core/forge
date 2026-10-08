import { describe, expect, it } from "bun:test";

import { hexToBytes, randomBytes, utf8Encode } from "./bytes";
import { hmacSign, hmacVerify, importHmacKey } from "./hmac";

const HEX_A = "358b1487d61f45faee7d40c46f2e735451bdee612b02576b37426d8b4617d48d";
const HEX_B = "a4be059a6bf8f74efeb3c721902802870bb3aa5ec060fea9241d201f1e4e27d4";

describe("hmacSign / hmacVerify", () => {
  it("sign then verify round-trips as true", async () => {
    const key = await importHmacKey(hexToBytes(HEX_A));
    const sig = await hmacSign(key, "test payload");
    expect(await hmacVerify(key, "test payload", sig)).toBe(true);
  });

  it("returns false when data is tampered", async () => {
    const key = await importHmacKey(hexToBytes(HEX_A));
    const sig = await hmacSign(key, "test payload");
    expect(await hmacVerify(key, "tampered payload", sig)).toBe(false);
  });

  it("returns false when signature is tampered", async () => {
    const key = await importHmacKey(hexToBytes(HEX_A));
    const sig = await hmacSign(key, "test payload");
    sig[0]! ^= 0xff;
    expect(await hmacVerify(key, "test payload", sig)).toBe(false);
  });

  it("returns false under a different key", async () => {
    const sig = await hmacSign(await importHmacKey(hexToBytes(HEX_A)), "test payload");
    expect(await hmacVerify(await importHmacKey(hexToBytes(HEX_B)), "test payload", sig)).toBe(false);
  });

  it("accepts Uint8Array data", async () => {
    const key = await importHmacKey(hexToBytes(HEX_B));
    const data = utf8Encode("binary data");
    const sig = await hmacSign(key, data);
    expect(await hmacVerify(key, data, sig)).toBe(true);
  });
});

describe("importHmacKey", () => {
  it("imports raw bytes as an HMAC signing key that round-trips sign/verify", async () => {
    const key = await importHmacKey(randomBytes(32));
    expect(key.algorithm.name).toBe("HMAC");
    const sig = await hmacSign(key, "payload");
    expect(await hmacVerify(key, "payload", sig)).toBe(true);
    expect(await hmacVerify(key, "tampered", sig)).toBe(false);
  });

  it("signs a string and its UTF-8 bytes identically", async () => {
    const key = await importHmacKey(hexToBytes(HEX_A));
    expect(await hmacSign(key, "x")).toEqual(await hmacSign(key, utf8Encode("x")));
  });
});
