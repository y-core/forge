import { beforeAll, describe, expect, it } from "bun:test";

import { bytesToHex, uuidv7 } from "../../crypto/mod";
import { importAuthKeyRing } from "../keys/ring";
import type { AuthKeyRing } from "../types";
import { openTotpSecret, sealTotpSecret } from "./totp-secret";

const SECRET = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]) as Uint8Array<ArrayBuffer>;
const USER_ID = uuidv7();

const ROOT_A = "e6064ea1614f137496a5d1ccd3408255da4cc39f26900b93f9dc63e4bd8543e8";
const ROOT_B = "dfa8da70879b5fb481bb6db0032ab0fa7bda29421d4a3714fae42a018b54210d";

let ringA: AuthKeyRing;
let ringB: AuthKeyRing;
let rotated: AuthKeyRing;

beforeAll(async () => {
  ringA = await importAuthKeyRing([ROOT_A]);
  ringB = await importAuthKeyRing([ROOT_B]);
  rotated = await importAuthKeyRing([ROOT_B, ROOT_A]);
});

describe("sealTotpSecret", () => {
  it("frames the secret as kid(6) ‖ nonce(12) ‖ ciphertext‖tag", async () => {
    const sealed = await sealTotpSecret(ringA, USER_ID, SECRET);
    expect(sealed.byteLength).toBe(6 + 12 + SECRET.byteLength + 16);
  });

  it("leaves no plaintext in the sealed bytes, and no two seals alike", async () => {
    const first = await sealTotpSecret(ringA, USER_ID, SECRET);
    const second = await sealTotpSecret(ringA, USER_ID, SECRET);
    expect(bytesToHex(first)).not.toContain(bytesToHex(SECRET));
    expect(bytesToHex(second)).not.toContain(bytesToHex(SECRET));
    expect(bytesToHex(first)).not.toBe(bytesToHex(second));
  });

  it("refuses to seal under a ring whose active key it does not hold", async () => {
    const broken: AuthKeyRing = { activeKeyId: "AAAAAAAA", keys: {} };
    await expect(sealTotpSecret(broken, USER_ID, SECRET)).rejects.toThrow('the key ring has no key for its active key id "AAAAAAAA"');
  });
});

describe("openTotpSecret", () => {
  it("returns the secret it sealed", async () => {
    const opened = await openTotpSecret(ringA, USER_ID, await sealTotpSecret(ringA, USER_ID, SECRET));
    expect(opened && bytesToHex(opened)).toBe(bytesToHex(SECRET));
  });

  it("opens a secret sealed under a retired key, because the frame names the key id", async () => {
    const sealed = await sealTotpSecret(ringA, USER_ID, SECRET);
    const opened = await openTotpSecret(rotated, USER_ID, sealed);
    expect(opened && bytesToHex(opened)).toBe(bytesToHex(SECRET));
  });

  it("refuses a secret whose key the ring does not hold at all", async () => {
    expect(await openTotpSecret(ringB, USER_ID, await sealTotpSecret(ringA, USER_ID, SECRET))).toBeNull();
  });

  // The owner is associated data, so moving a row between users in the database is not enough to
  // move a working factor with it.
  it("refuses a secret sealed for another user", async () => {
    expect(await openTotpSecret(ringA, uuidv7(), await sealTotpSecret(ringA, USER_ID, SECRET))).toBeNull();
  });

  it("refuses a frame with a flipped byte, and one too short to hold a frame", async () => {
    const sealed = await sealTotpSecret(ringA, USER_ID, SECRET);
    const tampered = sealed.slice();
    tampered[tampered.byteLength - 1] = (tampered[tampered.byteLength - 1] ?? 0) ^ 0xff;
    expect(await openTotpSecret(ringA, USER_ID, tampered)).toBeNull();
    expect(await openTotpSecret(ringA, USER_ID, sealed.slice(0, 18))).toBeNull();
  });
});
