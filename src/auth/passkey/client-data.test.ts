import { describe, expect, it } from "bun:test";

import { base64urlEncode, utf8Encode } from "../../crypto/mod";
import { parseClientData, verifyClientData } from "./client-data";
import type { ClientDataExpectation } from "./types";

const CHALLENGE = base64urlEncode(new Uint8Array(32).fill(9));
const ORIGIN = "https://example.com";

function clientData(overrides: Record<string, unknown> = {}): Uint8Array<ArrayBuffer> {
  return utf8Encode(JSON.stringify({ type: "webauthn.get", challenge: CHALLENGE, origin: ORIGIN, ...overrides }));
}

const EXPECTED: ClientDataExpectation = { ceremony: "authenticate", challenge: CHALLENGE, origin: ORIGIN };

describe("parseClientData", () => {
  it("reads the four fields it uses", () => {
    expect(parseClientData(clientData({ crossOrigin: false }))).toEqual({
      ok: true,
      data: { type: "webauthn.get", challenge: CHALLENGE, origin: ORIGIN, crossOrigin: false },
    });
  });

  it("omits crossOrigin when the authenticator sent none", () => {
    expect(parseClientData(clientData())).toEqual({ ok: true, data: { type: "webauthn.get", challenge: CHALLENGE, origin: ORIGIN } });
  });

  it("refuses bytes that are not JSON, are not an object, or lack a required field", () => {
    expect(parseClientData(utf8Encode("not json"))).toEqual({ ok: false, error: "malformed" });
    expect(parseClientData(utf8Encode("[1,2]"))).toEqual({ ok: false, error: "malformed" });
    expect(parseClientData(utf8Encode("null"))).toEqual({ ok: false, error: "malformed" });
    expect(parseClientData(utf8Encode(JSON.stringify({ type: "webauthn.get", origin: ORIGIN })))).toEqual({ ok: false, error: "malformed" });
    expect(parseClientData(utf8Encode(JSON.stringify({ type: 7, challenge: CHALLENGE, origin: ORIGIN })))).toEqual({
      ok: false,
      error: "malformed",
    });
  });
});

describe("verifyClientData — the ceremony type", () => {
  it("accepts webauthn.get for an authentication and webauthn.create for a registration", () => {
    expect(verifyClientData(clientData(), EXPECTED).ok).toBe(true);
    expect(verifyClientData(clientData({ type: "webauthn.create" }), { ...EXPECTED, ceremony: "register" }).ok).toBe(true);
  });

  it("refuses a registration's client data presented to an authentication, and the reverse", () => {
    expect(verifyClientData(clientData({ type: "webauthn.create" }), EXPECTED)).toEqual({ ok: false, error: "type-mismatch" });
    expect(verifyClientData(clientData(), { ...EXPECTED, ceremony: "register" })).toEqual({ ok: false, error: "type-mismatch" });
  });

  it("refuses a type it does not know", () => {
    expect(verifyClientData(clientData({ type: "webauthn.other" }), EXPECTED)).toEqual({ ok: false, error: "type-mismatch" });
  });
});

describe("verifyClientData — the origin", () => {
  it("accepts the exact configured origin", () => {
    expect(verifyClientData(clientData(), EXPECTED).ok).toBe(true);
  });

  // Every one of these passes a `startsWith`, an `includes`, or a host-only parse. The exact
  // comparison is the only form that refuses them.
  it("refuses every near-miss an attacker can register", () => {
    const rows: readonly string[] = [
      "https://example.com.evil.test",
      "https://example.com.evil.test/",
      "https://evil.test/https://example.com",
      "https://example.com:8443",
      "http://example.com",
      "https://sub.example.com",
      "https://example.com/",
      "https://Example.com",
      "https://xn--exmple-cua.com",
      "",
    ];
    for (const origin of rows) {
      expect(`${origin}: ${verifyClientData(clientData({ origin }), EXPECTED).ok ? "accepted" : "refused"}`).toBe(`${origin}: refused`);
    }
  });

  it("names origin-mismatch specifically, so a regression cannot hide behind another check", () => {
    expect(verifyClientData(clientData({ origin: "https://example.com.evil.test" }), EXPECTED)).toEqual({ ok: false, error: "origin-mismatch" });
  });
});

describe("verifyClientData — the challenge", () => {
  it("refuses a challenge from another ceremony", () => {
    const other = base64urlEncode(new Uint8Array(32).fill(8));
    expect(verifyClientData(clientData({ challenge: other }), EXPECTED)).toEqual({ ok: false, error: "challenge-mismatch" });
  });

  it("refuses a truncated prefix of the right challenge", () => {
    expect(verifyClientData(clientData({ challenge: CHALLENGE.slice(0, 20) }), EXPECTED)).toEqual({ ok: false, error: "challenge-mismatch" });
  });

  it("refuses the right challenge with anything appended", () => {
    expect(verifyClientData(clientData({ challenge: `${CHALLENGE}AA` }), EXPECTED)).toEqual({ ok: false, error: "challenge-mismatch" });
  });

  it("refuses an empty challenge", () => {
    expect(verifyClientData(clientData({ challenge: "" }), EXPECTED)).toEqual({ ok: false, error: "challenge-mismatch" });
  });
});

describe("verifyClientData — cross-origin", () => {
  it("accepts crossOrigin: false and an absent crossOrigin", () => {
    expect(verifyClientData(clientData({ crossOrigin: false }), EXPECTED).ok).toBe(true);
    expect(verifyClientData(clientData(), EXPECTED).ok).toBe(true);
  });

  it("refuses a ceremony run inside a third party's frame", () => {
    expect(verifyClientData(clientData({ crossOrigin: true }), EXPECTED)).toEqual({ ok: false, error: "cross-origin" });
  });
});
