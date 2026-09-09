import { describe, expect, it } from "bun:test";

import { base64urlDecode, base64urlEncode, cborDecodeFirst, decodeCosePublicKey, sha256 } from "../../crypto/mod";
import {
  PASSKEY_FLAG,
  type PasskeyKeyPair,
  ceremonyCborEncode,
  createPasskeyKeyPair,
  fakeAuthenticatorData,
  fakePasskeyAssertion,
  fakePasskeyRegistration,
} from "./fixture";
import { verifyPasskeySignature } from "./signature";

const RP_ID = "example.com";
const ORIGIN = "https://example.com";
const CREDENTIAL_ID = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

describe("ceremonyCborEncode", () => {
  it("round-trips through the decoder the ceremonies are read with", () => {
    const map = new Map<string, unknown>([
      ["fmt", "none"],
      ["attStmt", new Map()],
      ["authData", new Uint8Array([9, 9, 9])],
    ]);
    const decoded = cborDecodeFirst(ceremonyCborEncode(map as never));
    expect(decoded.value).toEqual(map as never);
  });

  it("encodes a length that needs two and four bytes, not only the short form", () => {
    for (const size of [23, 24, 300, 70_000]) {
      const decoded = cborDecodeFirst(ceremonyCborEncode(new Uint8Array(size).fill(7)));
      expect(`${size}: ${(decoded.value as Uint8Array).byteLength}`).toBe(`${size}: ${size}`);
    }
  });
});

describe("createPasskeyKeyPair", () => {
  it("produces a COSE key the verifier decodes and a signature it accepts, for every algorithm", async () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    for (const algorithm of [-7, -8, -257] as const) {
      const pair: PasskeyKeyPair = await createPasskeyKeyPair(algorithm);
      const key = decodeCosePublicKey(pair.cosePublicKey).key;
      const accepted = await verifyPasskeySignature(key, await pair.sign(data), data);
      expect(`${algorithm}: ${key.algorithm} ${accepted}`).toBe(`${algorithm}: ${algorithm} true`);
    }
  });
});

describe("fakeAuthenticatorData", () => {
  it("writes the rpIdHash, flags and counter a parser reads back", async () => {
    const bytes = await fakeAuthenticatorData({ rpId: RP_ID, flags: PASSKEY_FLAG.up, signCount: 4_294_967_295 });
    expect(bytes.byteLength).toBe(37);
    expect(base64urlEncode(bytes.subarray(0, 32))).toBe(base64urlEncode(await sha256(RP_ID)));
    expect([...bytes.subarray(32)]).toEqual([PASSKEY_FLAG.up, 255, 255, 255, 255]);
  });
});

describe("fakePasskeyRegistration and fakePasskeyAssertion", () => {
  it("posts the credential id the attested segment carries", async () => {
    const key = await createPasskeyKeyPair(-7);
    const credential = await fakePasskeyRegistration({ key, rpId: RP_ID, origin: ORIGIN, challenge: "c", credentialId: CREDENTIAL_ID });
    expect(credential.id).toBe(base64urlEncode(CREDENTIAL_ID));
    expect(JSON.parse(new TextDecoder().decode(base64urlDecode(credential.response.clientDataJSON)))).toEqual({
      type: "webauthn.create",
      challenge: "c",
      origin: ORIGIN,
    });
  });

  it("signs an assertion over the authenticator data and the client data's hash, in that order", async () => {
    const key = await createPasskeyKeyPair(-7);
    const assertion = await fakePasskeyAssertion({ key, rpId: RP_ID, origin: ORIGIN, challenge: "c", credentialId: "cred" });
    const authenticatorData = base64urlDecode(assertion.response.authenticatorData);
    const hash = await sha256(base64urlDecode(assertion.response.clientDataJSON));
    const signed = new Uint8Array([...authenticatorData, ...hash]);
    const decoded = decodeCosePublicKey(key.cosePublicKey).key;
    expect(await verifyPasskeySignature(decoded, base64urlDecode(assertion.response.signature), signed)).toBe(true);
  });
});
