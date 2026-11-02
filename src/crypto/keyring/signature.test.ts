import { describe, expect, it } from "bun:test";

import { base64urlDecode, base64urlEncode, hexToBytes, utf8Encode } from "../primitives/mod";
import { importKeyRing, importKeyRingUnder } from "./ring";
import { signWithKeyRing, verifyWithKeyRing } from "./sign";
import { signKeyRingValue, verifyKeyRingValue } from "./signature";
import type { KeyRing } from "./types";

const SECRET_A = "a70bf50e531ce1a817561f2f5d5b6645d4e806becf58ccc5e8cf6b8045a090a8";
const SECRET_B = "49e2bb7eab54cf09b409ffafd3fa8a8a955a60eb972faacaefbed3dbd3207132";

const REQUEST = { purpose: "fica-answers", value: "envelope" };

function ringOf(...secrets: string[]): Promise<KeyRing> {
  return importKeyRing(secrets as [string, ...string[]]);
}

async function webCryptoMac(rootHex: string, purpose: string, value: Uint8Array<ArrayBuffer>): Promise<string> {
  const label = "y-core/forge/keyring/signature/v1";
  const root = await crypto.subtle.importKey("raw", hexToBytes(rootHex), "HKDF", false, ["deriveBits"]);
  const subkey = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: utf8Encode(label), info: utf8Encode(`${label}/${purpose}`) },
    root,
    256,
  );
  const key = await crypto.subtle.importKey("raw", subkey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64urlEncode(new Uint8Array(await crypto.subtle.sign("HMAC", key, value)));
}

function macOf(signature: string): Uint8Array<ArrayBuffer> {
  return base64urlDecode(signature.slice(signature.indexOf(".") + 1));
}

describe("signKeyRingValue", () => {
  it("answers the pinned signature for a fixed secret, purpose and value", async () => {
    expect(await signKeyRingValue(await ringOf(SECRET_A), REQUEST)).toBe("68OWREQ0.B60t-cXg3sbSXi7lk3Lshiqb_EICOG_YpLtZpPcFQYo");
  });

  it("answers the active kid, a dot, and base64url HMAC-SHA-256 under the signature subkey, matching raw WebCrypto", async () => {
    const ring = await ringOf(SECRET_B, SECRET_A);
    const bytes = new Uint8Array([0, 255, 7]) as Uint8Array<ArrayBuffer>;
    expect(await signKeyRingValue(ring, { purpose: REQUEST.purpose, value: bytes })).toBe(
      `${ring.activeKeyId}.${await webCryptoMac(SECRET_B, REQUEST.purpose, bytes)}`,
    );
  });

  it("answers a different signature for a different purpose, key or value", async () => {
    const ringA = await ringOf(SECRET_A);
    const signatures = await Promise.all([
      signKeyRingValue(ringA, REQUEST),
      signKeyRingValue(ringA, { ...REQUEST, purpose: "tfs-list" }),
      signKeyRingValue(await ringOf(SECRET_B), REQUEST),
      signKeyRingValue(ringA, { ...REQUEST, value: "envelope!" }),
    ]);
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it("throws on an empty purpose, and refuses a ring importKeyRing did not build", async () => {
    await expect(signKeyRingValue(await ringOf(SECRET_A), { ...REQUEST, purpose: "" })).rejects.toThrow(
      "signKeyRingValue: purpose must be a non-empty string",
    );
    const foreign = await importKeyRingUnder("importAuthKeyRing", { keyIdLabel: "y-core/forge/test/kid", subkeyLabel: "y-core/forge/test/v1" }, [
      SECRET_A,
    ]);
    await expect(signKeyRingValue(foreign, REQUEST)).rejects.toThrow(
      `signKeyRingValue: active key id "${foreign.activeKeyId}" is not one importKeyRing derives`,
    );
  });
});

describe("verifyKeyRingValue", () => {
  it("answers verified for the signature signKeyRingValue made", async () => {
    const ring = await ringOf(SECRET_A);
    expect(await verifyKeyRingValue(ring, REQUEST, await signKeyRingValue(ring, REQUEST))).toBe("verified");
  });

  it("answers forged for another value, another purpose, or an altered MAC", async () => {
    const ring = await ringOf(SECRET_A);
    const signature = await signKeyRingValue(ring, REQUEST);
    expect(await verifyKeyRingValue(ring, { ...REQUEST, value: "envelope!" }, signature)).toBe("forged");
    expect(await verifyKeyRingValue(ring, { ...REQUEST, purpose: "tfs-list" }, signature)).toBe("forged");
    const altered = macOf(signature);
    altered[0] = (altered[0] ?? 0) ^ 1;
    expect(await verifyKeyRingValue(ring, REQUEST, `${ring.activeKeyId}.${base64urlEncode(altered)}`)).toBe("forged");
  });

  it("answers forged for a malformed signature", async () => {
    const ring = await ringOf(SECRET_A);
    const signature = await signKeyRingValue(ring, REQUEST);
    for (const malformed of [
      "",
      signature.replace(".", ""),
      signature.slice(signature.indexOf(".")),
      `${ring.activeKeyId}.`,
      `${ring.activeKeyId}.*`,
    ]) {
      expect(await verifyKeyRingValue(ring, REQUEST, malformed)).toBe("forged");
    }
  });

  it("verifies under a retiring key still on the ring, and answers no-key once it leaves", async () => {
    const signature = await signKeyRingValue(await ringOf(SECRET_A), REQUEST);
    expect(await verifyKeyRingValue(await ringOf(SECRET_B, SECRET_A), REQUEST, signature)).toBe("verified");
    expect(await verifyKeyRingValue(await ringOf(SECRET_B), REQUEST, signature)).toBe("no-key");
  });

  it("answers no-key, never verified, for a signature naming a kid the ring never held", async () => {
    const ring = await ringOf(SECRET_A);
    const mac = macOf(await signKeyRingValue(ring, REQUEST));
    for (const kid of ["AAAAAAAA", "constructor"]) {
      expect(await verifyKeyRingValue(ring, REQUEST, `${kid}.${base64urlEncode(mac)}`)).toBe("no-key");
    }
  });

  it("throws on an empty purpose, and refuses a ring importKeyRing did not build even for a malformed signature", async () => {
    await expect(verifyKeyRingValue(await ringOf(SECRET_A), { ...REQUEST, purpose: "" }, "x.y")).rejects.toThrow(
      "verifyKeyRingValue: purpose must be a non-empty string",
    );
    const foreign = await importKeyRingUnder("importAuthKeyRing", { keyIdLabel: "y-core/forge/test/kid", subkeyLabel: "y-core/forge/test/v1" }, [
      SECRET_A,
    ]);
    await expect(verifyKeyRingValue(foreign, REQUEST, "malformed")).rejects.toThrow(
      `verifyKeyRingValue: active key id "${foreign.activeKeyId}" is not one importKeyRing derives`,
    );
  });
});

describe("signKeyRingValue — separation from forge's own HMAC subkeys", () => {
  it("never verifies as a forge-internal MAC for the same purpose, nor the reverse", async () => {
    const ring = await ringOf(SECRET_A);
    const request = { purpose: "csrf", value: "payload" };
    const signature = await signKeyRingValue(ring, request);
    expect(await verifyWithKeyRing("test", ring, "csrf", ring.activeKeyId, request.value, macOf(signature))).toBe("forged");
    const internal = await signWithKeyRing("test", ring, "csrf", request.value);
    expect(await verifyKeyRingValue(ring, request, `${internal.kid}.${base64urlEncode(internal.mac)}`)).toBe("forged");
  });
});
