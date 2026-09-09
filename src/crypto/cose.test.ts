import { describe, expect, it } from "bun:test";

import type { CborValue } from "./cbor";
import { decodeCoseKey, decodeCosePublicKey } from "./cose";
import { bytesToHex, hexToBytes } from "./mod";

const X_HEX = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
const Y_HEX = "2122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f40";
const ED_X_HEX = "65666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f8081828384";

/** `{1: 2, 3: -7, -1: 1, -2: x, -3: y}` — the ES256 COSE_Key an authenticator returns. */
const ES256_KEY_HEX = `a5010203262001215820${X_HEX}225820${Y_HEX}`;
/** `{1: 1, 3: -8, -1: 6, -2: x}` — the Ed25519 COSE_Key, decodable whether or not it is offered. */
const ED25519_KEY_HEX = `a4010103272006215820${ED_X_HEX}`;

function coseMap(entries: readonly (readonly [CborValue, CborValue])[]): Map<CborValue, CborValue> {
  return new Map(entries);
}

/** A 2048-bit modulus with no leading zero, which is the shape an authenticator's RS256 key has. */
const MODULUS_HEX = "c3".repeat(256);

function rsaMap(): Map<CborValue, CborValue> {
  return coseMap([
    [1, 3],
    [3, -257],
    [-1, hexToBytes(MODULUS_HEX)],
    [-2, hexToBytes("010001")],
  ]);
}

function es256Map(): Map<CborValue, CborValue> {
  return coseMap([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, hexToBytes(X_HEX)],
    [-3, hexToBytes(Y_HEX)],
  ]);
}

describe("decodeCoseKey — ES256", () => {
  it("returns the uncompressed SEC1 point, 0x04 then x then y", () => {
    const key = decodeCoseKey(es256Map());
    expect(key.algorithm).toBe(-7);
    expect(key).toMatchObject({ algorithm: -7, curve: "P-256" });
    expect(bytesToHex((key as { point: Uint8Array }).point)).toBe(`04${X_HEX}${Y_HEX}`);
  });

  it("refuses a key type other than EC2", () => {
    const key = es256Map();
    key.set(1, 3);
    expect(() => decodeCoseKey(key)).toThrow("decodeCoseKey: algorithm -7 requires an EC2 key");
  });

  it("refuses a curve other than P-256", () => {
    const key = es256Map();
    key.set(-1, 2);
    expect(() => decodeCoseKey(key)).toThrow("decodeCoseKey: algorithm -7 requires curve P-256");
  });

  it("refuses a coordinate that is not 32 bytes", () => {
    const key = es256Map();
    key.set(-3, hexToBytes(Y_HEX.slice(0, 62)));
    expect(() => decodeCoseKey(key)).toThrow("decodeCoseKey: label -3 must be 32 bytes, got 31");
  });

  it("refuses a coordinate that is not a byte string", () => {
    const key = es256Map();
    key.set(-2, "not bytes");
    expect(() => decodeCoseKey(key)).toThrow("decodeCoseKey: label -2 is missing or not a byte string");
  });
});

describe("decodeCoseKey — EdDSA and RS256", () => {
  it("returns the 32-byte Ed25519 point", () => {
    const key = decodeCoseKey(
      coseMap([
        [1, 1],
        [3, -8],
        [-1, 6],
        [-2, hexToBytes(ED_X_HEX)],
      ]),
    );
    expect(key).toMatchObject({ algorithm: -8, curve: "Ed25519" });
    expect(bytesToHex((key as { point: Uint8Array }).point)).toBe(ED_X_HEX);
  });

  it("returns the RSA modulus and exponent separately, each in its shortest unsigned form", () => {
    const key = decodeCoseKey(rsaMap());
    expect(key.algorithm).toBe(-257);
    expect((key as { modulus: Uint8Array }).modulus.byteLength).toBe(256);
    expect(bytesToHex((key as { exponent: Uint8Array }).exponent)).toBe("010001");

    const padded = rsaMap();
    padded.set(-1, hexToBytes("00" + MODULUS_HEX));
    expect((decodeCoseKey(padded) as { modulus: Uint8Array }).modulus.byteLength).toBe(256);
  });

  // WebCrypto imports an eight-byte modulus and an exponent of one without complaint, so a key that
  // could never carry a trustworthy signature is refused here or nowhere.
  it("refuses a modulus below 2048 bits and one past the ceiling", () => {
    for (const [bytes, length] of [[8, 8] as const, [1025, 1025] as const]) {
      const key = rsaMap();
      key.set(-1, hexToBytes("c3".repeat(bytes)));
      expect(() => decodeCoseKey(key)).toThrow(`decodeCoseKey: an RSA modulus must be 256 to 1024 bytes, got ${length}`);
    }
  });

  it("refuses an even exponent, an exponent of one and one past eight bytes", () => {
    for (const exponent of ["010002", "01", "010000000000000001"]) {
      const key = rsaMap();
      key.set(-2, hexToBytes(exponent));
      expect(() => decodeCoseKey(key)).toThrow("decodeCoseKey: an RSA exponent must be an odd integer above one, of at most eight bytes");
    }
  });

  it("refuses an algorithm outside the three it can verify", () => {
    expect(() =>
      decodeCoseKey(
        coseMap([
          [1, 2],
          [3, -35],
        ]),
      ),
    ).toThrow("decodeCoseKey: unsupported COSE algorithm -35");
  });

  it("refuses a key with no algorithm label", () => {
    expect(() => decodeCoseKey(coseMap([[1, 2]]))).toThrow("decodeCoseKey: label 3 is missing or not an integer");
  });
});

describe("decodeCosePublicKey", () => {
  it("decodes an ES256 key from CBOR bytes and reports the bytes it consumed", () => {
    const bytes = hexToBytes(ES256_KEY_HEX);
    const decoded = decodeCosePublicKey(bytes);
    expect(decoded.bytesRead).toBe(bytes.length);
    expect(bytesToHex((decoded.key as { point: Uint8Array }).point)).toBe(`04${X_HEX}${Y_HEX}`);
  });

  it("decodes an Ed25519 key from CBOR bytes", () => {
    expect(decodeCosePublicKey(hexToBytes(ED25519_KEY_HEX)).key).toMatchObject({ algorithm: -8, curve: "Ed25519" });
  });

  it("stops at the key's end so the extension bytes after it stay reachable", () => {
    const bytes = hexToBytes(`${ES256_KEY_HEX}a16b6372656450726f7465637402`);
    const decoded = decodeCosePublicKey(bytes);
    expect(decoded.bytesRead).toBe(ES256_KEY_HEX.length / 2);
    expect(decoded.bytesRead).toBeLessThan(bytes.length);
  });

  it("refuses CBOR that is not a map", () => {
    expect(() => decodeCosePublicKey(hexToBytes("83010203"))).toThrow("decodeCosePublicKey: a COSE_Key must be a CBOR map");
  });
});
