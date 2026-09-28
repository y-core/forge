import { describe, expect, it } from "bun:test";

import { base64urlEncode, hexToBytes, utf8Encode } from "../crypto/mod";
import { importKeyRing, importKeyRingUnder, KEYRING_DOMAIN } from "./ring";
import { atRestKeyId, openAtRest, sealAtRest, sealAtRestUnder } from "./seal";
import type { AtRestBinding, KeyRing } from "./types";

const SECRET_A = "a70bf50e531ce1a817561f2f5d5b6645d4e806becf58ccc5e8cf6b8045a090a8";
const SECRET_B = "49e2bb7eab54cf09b409ffafd3fa8a8a955a60eb972faacaefbed3dbd3207132";

const PLAINTEXT = new Uint8Array([9, 8, 7, 6, 5]) as Uint8Array<ArrayBuffer>;
const BINDING: AtRestBinding = { purpose: "webhook-secret", context: utf8Encode("webhooks 1") };

function ringOf(...secrets: string[]): Promise<KeyRing> {
  return importKeyRing(secrets as [string, ...string[]]);
}

function flipped(frame: Uint8Array<ArrayBuffer>, offset: number): Uint8Array<ArrayBuffer> {
  const copy = frame.slice();
  copy[offset] = (copy[offset] ?? 0) ^ 0xff;
  return copy;
}

describe("sealAtRest and openAtRest", () => {
  it("frames the ciphertext as kid(6) ‖ nonce(12) ‖ ciphertext‖tag and opens it again", async () => {
    const ring = await ringOf(SECRET_A);
    const frame = await sealAtRest(ring, BINDING, PLAINTEXT);
    expect(frame.byteLength).toBe(6 + 12 + PLAINTEXT.byteLength + 16);
    expect(base64urlEncode(frame.subarray(0, 6))).toBe(ring.activeKeyId);
    expect(await openAtRest(ring, BINDING, frame)).toEqual({ ok: true, data: { plaintext: PLAINTEXT, kid: ring.activeKeyId } });
  });

  it("seals an empty plaintext into a 34-byte frame that opens", async () => {
    const ring = await ringOf(SECRET_A);
    const empty = new Uint8Array(0) as Uint8Array<ArrayBuffer>;
    const frame = await sealAtRest(ring, BINDING, empty);
    expect(frame.byteLength).toBe(34);
    expect(await openAtRest(ring, BINDING, frame)).toEqual({ ok: true, data: { plaintext: empty, kid: ring.activeKeyId } });
  });

  it("gives a different frame each time, so two seals of one plaintext do not match", async () => {
    const ring = await ringOf(SECRET_A);
    const first = await sealAtRest(ring, BINDING, PLAINTEXT);
    const second = await sealAtRest(ring, BINDING, PLAINTEXT);
    expect(base64urlEncode(first)).not.toBe(base64urlEncode(second));
  });

  it("refuses a frame opened under a different context, so a frame moved to another row does not open", async () => {
    const ring = await ringOf(SECRET_A);
    const frame = await sealAtRest(ring, BINDING, PLAINTEXT);
    expect(await openAtRest(ring, { ...BINDING, context: utf8Encode("webhooks 2") }, frame)).toEqual({ ok: false, error: "unopenable" });
  });

  it("refuses a frame opened under a different purpose, because the subkeys differ", async () => {
    const ring = await ringOf(SECRET_A);
    const frame = await sealAtRest(ring, BINDING, PLAINTEXT);
    expect(await openAtRest(ring, { ...BINDING, purpose: "api-token" }, frame)).toEqual({ ok: false, error: "unopenable" });
  });

  it("answers no-key for a frame whose key is off the ring, and opens it once the key is back", async () => {
    const old = await ringOf(SECRET_A);
    const frame = await sealAtRest(old, BINDING, PLAINTEXT);
    expect(await openAtRest(await ringOf(SECRET_B), BINDING, frame)).toEqual({ ok: false, error: "no-key" });
    expect(await openAtRest(await ringOf(SECRET_B, SECRET_A), BINDING, frame)).toEqual({
      ok: true,
      data: { plaintext: PLAINTEXT, kid: old.activeKeyId },
    });
  });

  it("re-seals an opened frame under the active key", async () => {
    const frame = await sealAtRest(await ringOf(SECRET_A), BINDING, PLAINTEXT);
    const rotated = await ringOf(SECRET_B, SECRET_A);
    const opened = await openAtRest(rotated, BINDING, frame);
    if (!opened.ok) throw new Error("expected the frame to open");
    expect(opened.data.kid).not.toBe(rotated.activeKeyId);
    const resealed = await sealAtRest(rotated, BINDING, opened.data.plaintext);
    expect(atRestKeyId(resealed)).toBe(rotated.activeKeyId);
  });

  it("answers unopenable, not no-key, for a 33-byte frame naming a key off the ring", async () => {
    const frame = await sealAtRest(await ringOf(SECRET_A), BINDING, PLAINTEXT);
    expect(await openAtRest(await ringOf(SECRET_B), BINDING, frame.slice(0, 33))).toEqual({ ok: false, error: "unopenable" });
  });

  it("refuses a frame no longer than its header, and one with a flipped tag or nonce byte", async () => {
    const ring = await ringOf(SECRET_A);
    const frame = await sealAtRest(ring, BINDING, PLAINTEXT);
    const refusals = await Promise.all([
      openAtRest(ring, BINDING, frame.slice(0, 18)),
      openAtRest(ring, BINDING, flipped(frame, frame.byteLength - 1)),
      openAtRest(ring, BINDING, flipped(frame, 6)),
    ]);
    expect(refusals).toEqual([
      { ok: false, error: "unopenable" },
      { ok: false, error: "unopenable" },
      { ok: false, error: "unopenable" },
    ]);
  });
});

describe("sealAtRest and openAtRest — programming errors", () => {
  it("throws on an empty purpose, sealing or opening", async () => {
    const ring = await ringOf(SECRET_A);
    const frame = await sealAtRest(ring, BINDING, PLAINTEXT);
    const binding = { ...BINDING, purpose: "" };
    await expect(sealAtRest(ring, binding, PLAINTEXT)).rejects.toThrow("sealAtRest: purpose must be a non-empty string");
    await expect(openAtRest(ring, binding, frame)).rejects.toThrow("openAtRest: purpose must be a non-empty string");
  });

  it("throws on an empty context, sealing or opening", async () => {
    const ring = await ringOf(SECRET_A);
    const frame = await sealAtRest(ring, BINDING, PLAINTEXT);
    const binding = { ...BINDING, context: new Uint8Array(0) as Uint8Array<ArrayBuffer> };
    await expect(sealAtRest(ring, binding, PLAINTEXT)).rejects.toThrow(
      "sealAtRest: context must be non-empty — bind the frame to the row it is stored in",
    );
    await expect(openAtRest(ring, binding, frame)).rejects.toThrow(
      "openAtRest: context must be non-empty — bind the frame to the row it is stored in",
    );
  });

  it("throws on sealing under a ring holding no key for its active id", async () => {
    const broken: KeyRing = { activeKeyId: "AAAAAAAA", keys: {} };
    await expect(sealAtRestUnder(broken, KEYRING_DOMAIN, BINDING, PLAINTEXT)).rejects.toThrow(
      'sealAtRest: the key ring has no key for its active key id "AAAAAAAA"',
    );
    await expect(sealAtRest(broken, BINDING, PLAINTEXT)).rejects.toThrow('sealAtRest: active key id "AAAAAAAA" is not one importKeyRing derives');
  });

  it("throws on sealing under an active key id no ring derives", async () => {
    const handBuilt: KeyRing = { activeKeyId: "constructor", keys: { constructor: hexToBytes(SECRET_A) } };
    await expect(sealAtRestUnder(handBuilt, KEYRING_DOMAIN, BINDING, PLAINTEXT)).rejects.toThrow(
      'sealAtRest: active key id "constructor" is not one a key ring derives',
    );
    await expect(sealAtRest(handBuilt, BINDING, PLAINTEXT)).rejects.toThrow(
      'sealAtRest: active key id "constructor" is not one importKeyRing derives',
    );
  });

  it("refuses a ring imported under another domain, naming the auth key ring", async () => {
    const foreign = await importKeyRingUnder("importAuthKeyRing", { keyIdLabel: "y-core/forge/test/kid", subkeyLabel: "y-core/forge/test/v1" }, [
      SECRET_A,
    ]);
    await expect(sealAtRest(foreign, BINDING, PLAINTEXT)).rejects.toThrow(
      `sealAtRest: active key id "${foreign.activeKeyId}" is not one importKeyRing derives — seal only under a ring importKeyRing built, never the auth key ring`,
    );
  });

  it("refuses a ring whose active key was swapped after importKeyRing built it", async () => {
    const ringA = await ringOf(SECRET_A);
    const swapped: KeyRing = { activeKeyId: ringA.activeKeyId, keys: { [ringA.activeKeyId]: hexToBytes(SECRET_B) } };
    await expect(sealAtRest(swapped, BINDING, PLAINTEXT)).rejects.toThrow("is not one importKeyRing derives");
  });
});

describe("atRestKeyId", () => {
  it("reads the key id off a frame without a ring", async () => {
    const ring = await ringOf(SECRET_A);
    expect(atRestKeyId(await sealAtRest(ring, BINDING, PLAINTEXT))).toBe(ring.activeKeyId);
  });

  it("answers undefined for a frame shorter than its header and tag, even one naming a key", async () => {
    const ring = await ringOf(SECRET_A);
    const frame = await sealAtRest(ring, BINDING, PLAINTEXT);
    expect(atRestKeyId(new Uint8Array(18) as Uint8Array<ArrayBuffer>)).toBeUndefined();
    expect(atRestKeyId(frame.slice(0, 33))).toBeUndefined();
    expect(atRestKeyId(frame.slice(0, 34))).toBe(ring.activeKeyId);
  });
});

describe("domain separation", () => {
  it("does not open a frame sealed under another domain", async () => {
    const ring = await ringOf(SECRET_A);
    const frame = await sealAtRestUnder(ring, { keyIdLabel: "x", subkeyLabel: "y-core/forge/test/v1" }, BINDING, PLAINTEXT);
    expect(await openAtRest(ring, BINDING, frame)).toEqual({ ok: false, error: "unopenable" });
  });
});

describe("the keyring/v1 known answer", () => {
  const ROOT = "3c9e1f7a52d08b64e7a1c35f90d24b8e61f07a3dc5928e14b76a0f3e5d19c2a8";
  const FRAME = "7a08ed928665d55662d380ce729185689c9bf469d43dda042453cdede3b071757bcae798889784f32148fc1269aa530047c79862";

  it("opens a frame pinned from this release", async () => {
    const ring = await importKeyRing([ROOT]);
    const binding = { purpose: "webhook-secret", context: utf8Encode("webhooks 42") };
    expect(ring.activeKeyId).toBe("egjtkoZl");
    expect(await openAtRest(ring, binding, hexToBytes(FRAME))).toEqual({
      ok: true,
      data: { plaintext: utf8Encode("whsec_known_answer"), kid: "egjtkoZl" },
    });
  });
});
