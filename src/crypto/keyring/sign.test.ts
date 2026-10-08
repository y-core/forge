import { describe, expect, it } from "bun:test";

import { bytesToHex, hexToBytes, utf8Encode } from "../primitives/mod";
import { importKeyRing, importKeyRingUnder } from "./ring";
import { hmacUnderKeyRing, signWithKeyRing, verifyWithKeyRing } from "./sign";
import type { KeyRing } from "./types";

const SECRET_A = "a70bf50e531ce1a817561f2f5d5b6645d4e806becf58ccc5e8cf6b8045a090a8";
const SECRET_B = "49e2bb7eab54cf09b409ffafd3fa8a8a955a60eb972faacaefbed3dbd3207132";
const FOREIGN_DOMAIN = { keyIdLabel: "y-core/forge/test/kid", subkeyLabel: "y-core/forge/test/v1" };

function ringOf(...secrets: string[]): Promise<KeyRing> {
  return importKeyRing(secrets as [string, ...string[]]);
}

async function webCryptoMac(rootHex: string, label: string, purpose: string, data: string): Promise<string> {
  const root = await crypto.subtle.importKey("raw", hexToBytes(rootHex), "HKDF", false, ["deriveBits"]);
  const subkey = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: utf8Encode(label), info: utf8Encode(`${label}/${purpose}`) },
    root,
    256,
  );
  const key = await crypto.subtle.importKey("raw", subkey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8Encode(data))));
}

describe("signWithKeyRing", () => {
  it("answers the active kid and HMAC-SHA-256 under the hmac subkey for the purpose, matching raw WebCrypto", async () => {
    const ring = await ringOf(SECRET_A);
    const { kid, mac } = await signWithKeyRing("test", ring, "csrf", "payload");
    expect(kid).toBe(ring.activeKeyId);
    expect(bytesToHex(mac)).toBe(await webCryptoMac(SECRET_A, "y-core/forge/keyring/hmac/v1", "csrf", "payload"));
  });

  it("signs under the first secret of a rotated ring", async () => {
    const rotated = await ringOf(SECRET_B, SECRET_A);
    const { kid, mac } = await signWithKeyRing("test", rotated, "csrf", "payload");
    expect(kid).toBe((await ringOf(SECRET_B)).activeKeyId);
    expect(bytesToHex(mac)).toBe(await webCryptoMac(SECRET_B, "y-core/forge/keyring/hmac/v1", "csrf", "payload"));
  });

  it("gives each purpose its own subkey", async () => {
    const ring = await ringOf(SECRET_A);
    const csrf = await signWithKeyRing("test", ring, "csrf", "payload");
    const url = await signWithKeyRing("test", ring, "signed-url", "payload");
    expect(bytesToHex(csrf.mac)).not.toBe(bytesToHex(url.mac));
  });

  it("refuses a ring imported under another domain, naming the operation", async () => {
    const foreign = await importKeyRingUnder("importAuthKeyRing", FOREIGN_DOMAIN, [SECRET_A]);
    await expect(signWithKeyRing("mint", foreign, "csrf", "payload")).rejects.toThrow(
      `mint: active key id "${foreign.activeKeyId}" is not one importKeyRing derives`,
    );
  });
});

describe("hmacUnderKeyRing", () => {
  it("signs under the subkey label of the domain it is given", async () => {
    const ring = await ringOf(SECRET_A);
    const domain = { keyIdLabel: "y-core/forge/keyring/kid", subkeyLabel: "y-core/forge/keyring/pseudonym/v1" };
    const { mac } = await hmacUnderKeyRing("test", ring, domain, "notes", "user");
    expect(bytesToHex(mac)).toBe(await webCryptoMac(SECRET_A, domain.subkeyLabel, "notes", "user"));
  });
});

describe("verifyWithKeyRing", () => {
  it("answers verified for a MAC signWithKeyRing made", async () => {
    const ring = await ringOf(SECRET_A);
    const { kid, mac } = await signWithKeyRing("test", ring, "csrf", "payload");
    expect(await verifyWithKeyRing("test", ring, "csrf", kid, "payload", mac)).toBe("verified");
  });

  it("verifies under a retiring key still on the ring", async () => {
    const { kid, mac } = await signWithKeyRing("test", await ringOf(SECRET_A), "csrf", "payload");
    expect(await verifyWithKeyRing("test", await ringOf(SECRET_B, SECRET_A), "csrf", kid, "payload", mac)).toBe("verified");
  });

  it("answers forged for other data, another purpose, or an altered MAC", async () => {
    const ring = await ringOf(SECRET_A);
    const { kid, mac } = await signWithKeyRing("test", ring, "csrf", "payload");
    expect(await verifyWithKeyRing("test", ring, "csrf", kid, "payload!", mac)).toBe("forged");
    expect(await verifyWithKeyRing("test", ring, "signed-url", kid, "payload", mac)).toBe("forged");
    const altered = new Uint8Array(mac);
    altered[0] = (altered[0] ?? 0) ^ 1;
    expect(await verifyWithKeyRing("test", ring, "csrf", kid, "payload", altered)).toBe("forged");
  });

  it("answers no-key for an unknown kid ahead of a MAC that did not decode, and forged for that MAC under a known kid", async () => {
    const ring = await ringOf(SECRET_A);
    expect(await verifyWithKeyRing("test", ring, "csrf", "AAAAAAAA", "payload", null)).toBe("no-key");
    expect(await verifyWithKeyRing("test", ring, "csrf", ring.activeKeyId, "payload", null)).toBe("forged");
  });

  it("answers no-key for a kid the ring does not declare, an inherited property name included", async () => {
    const ring = await ringOf(SECRET_A);
    const { mac } = await signWithKeyRing("test", ring, "csrf", "payload");
    expect(await verifyWithKeyRing("test", ring, "csrf", "AAAAAAAA", "payload", mac)).toBe("no-key");
    expect(await verifyWithKeyRing("test", ring, "csrf", "constructor", "payload", mac)).toBe("no-key");
  });

  it("refuses a ring imported under another domain before reading the kid", async () => {
    const foreign = await importKeyRingUnder("importAuthKeyRing", FOREIGN_DOMAIN, [SECRET_A]);
    await expect(verifyWithKeyRing("check", foreign, "csrf", "AAAAAAAA", "payload", new Uint8Array(32))).rejects.toThrow(
      `check: active key id "${foreign.activeKeyId}" is not one importKeyRing derives`,
    );
  });
});
