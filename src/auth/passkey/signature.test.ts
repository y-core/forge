import { beforeAll, describe, expect, it } from "bun:test";

import { decodeCosePublicKey } from "../../crypto/mod";
import type { CosePublicKey } from "../../crypto/mod";
import { createPasskeyKeyPair } from "./fixture";
import { verifyPasskeySignature } from "./signature";
import type { PasskeyKeyPair } from "./types";

const DATA = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) as Uint8Array<ArrayBuffer>;

const KEYS: PasskeyKeyPair[] = [];

beforeAll(async () => {
  for (const algorithm of [-7, -8, -257] as const) KEYS.push(await createPasskeyKeyPair(algorithm));
});

function decoded(pair: PasskeyKeyPair): CosePublicKey {
  return decodeCosePublicKey(pair.cosePublicKey).key;
}

describe("verifyPasskeySignature", () => {
  it("accepts a genuine signature under every supported COSE algorithm", async () => {
    for (const pair of KEYS) {
      const accepted = await verifyPasskeySignature(decoded(pair), await pair.sign(DATA), DATA);
      expect(`${pair.algorithm}: ${accepted}`).toBe(`${pair.algorithm}: true`);
    }
  });

  it("refuses a signature over other data, under every algorithm", async () => {
    for (const pair of KEYS) {
      const accepted = await verifyPasskeySignature(decoded(pair), await pair.sign(DATA), new Uint8Array([9, 9, 9]));
      expect(`${pair.algorithm}: ${accepted}`).toBe(`${pair.algorithm}: false`);
    }
  });

  it("refuses a signature made by another key of the same algorithm", async () => {
    for (const pair of KEYS) {
      const stranger = await createPasskeyKeyPair(pair.algorithm);
      const accepted = await verifyPasskeySignature(decoded(pair), await stranger.sign(DATA), DATA);
      expect(`${pair.algorithm}: ${accepted}`).toBe(`${pair.algorithm}: false`);
    }
  });

  // The bytes are the attacker's, so a DER structure that will not parse has to answer `false`
  // rather than throw past a caller that treats a throw as an outage.
  it("refuses signature bytes that are not parseable at all, without throwing", async () => {
    for (const pair of KEYS) {
      const accepted = await verifyPasskeySignature(decoded(pair), new Uint8Array([0xff, 0xff, 0xff]), DATA);
      expect(`${pair.algorithm}: ${accepted}`).toBe(`${pair.algorithm}: false`);
    }
  });

  it("refuses an ECDSA signature presented in the fixed `r‖s` form instead of DER", async () => {
    const pair = KEYS.find((candidate) => candidate.algorithm === -7);
    if (!pair) throw new Error("no ES256 fixture key");
    expect(await verifyPasskeySignature(decoded(pair), new Uint8Array(64).fill(1), DATA)).toBe(false);
  });
});
