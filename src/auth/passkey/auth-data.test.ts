import { describe, expect, it } from "bun:test";

import { base64urlEncode, bytesToHex, hexToBytes, sha256 } from "../../crypto/mod";
import { parseAuthData, verifyAuthData } from "./auth-data";
import type { AuthDataExpectation } from "./types";

const RP_ID = "example.com";

const X_HEX = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
const Y_HEX = "2122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f40";
/** `{1: 2, 3: -7, -1: 1, -2: x, -3: y}` — the ES256 COSE_Key an authenticator returns. */
const COSE_KEY_HEX = `a5010203262001215820${X_HEX}225820${Y_HEX}`;

const AAGUID_HEX = "00112233445566778899aabbccddeeff";
const CREDENTIAL_ID_HEX = "aabbccddeeff00112233445566778899";

const FLAG = { up: 0x01, uv: 0x04, be: 0x08, bs: 0x10, at: 0x40, ed: 0x80 } as const;

async function authData(
  options: { flags: number; signCount?: number; rpId?: string; attested?: boolean; trailing?: string } = { flags: FLAG.up },
): Promise<Uint8Array<ArrayBuffer>> {
  const rpIdHash = bytesToHex(await sha256(options.rpId ?? RP_ID));
  const signCount = (options.signCount ?? 0).toString(16).padStart(8, "0");
  const attested = options.attested
    ? `${AAGUID_HEX}${(CREDENTIAL_ID_HEX.length / 2).toString(16).padStart(4, "0")}${CREDENTIAL_ID_HEX}${COSE_KEY_HEX}`
    : "";
  return hexToBytes(`${rpIdHash}${options.flags.toString(16).padStart(2, "0")}${signCount}${attested}${options.trailing ?? ""}`);
}

const EXPECTED: AuthDataExpectation = { rpId: RP_ID, requireUserVerification: false, requireAttestedCredential: false };

describe("parseAuthData — the header", () => {
  it("reads the rpIdHash, every flag and the sign count", async () => {
    const parsed = parseAuthData(await authData({ flags: FLAG.up | FLAG.uv | FLAG.be | FLAG.bs, signCount: 42 }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.rpIdHash.byteLength).toBe(32);
    expect(parsed.data.signCount).toBe(42);
    expect(parsed.data.flags).toEqual({
      userPresent: true,
      userVerified: true,
      backupEligible: true,
      backedUp: true,
      attestedCredentialData: false,
    });
  });

  it("reads a sign count at the top of its 32-bit range", async () => {
    const parsed = parseAuthData(await authData({ flags: FLAG.up, signCount: 0xffff_ffff }));
    expect(parsed.ok && parsed.data.signCount).toBe(4_294_967_295);
  });

  it("reports every flag false when the byte is zero", async () => {
    const parsed = parseAuthData(await authData({ flags: 0 }));
    expect(parsed.ok && Object.values(parsed.data.flags).every((flag) => flag === false)).toBe(true);
  });

  it("refuses data shorter than one header", () => {
    expect(parseAuthData(hexToBytes("00".repeat(36)))).toEqual({ ok: false, error: "malformed" });
  });
});

describe("parseAuthData — the attested credential segment", () => {
  it("reads the credential id and the public key", async () => {
    const parsed = parseAuthData(await authData({ flags: FLAG.up | FLAG.at, attested: true }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || !parsed.data.attested) throw new Error("no attested credential");
    expect(parsed.data.attested.credentialId).toBe(base64urlEncode(hexToBytes(CREDENTIAL_ID_HEX)));
    expect(parsed.data.attested.publicKey).toMatchObject({ algorithm: -7, curve: "P-256" });
  });

  // The COSE key is followed by the extension bytes with no length field between them, so the
  // boundary can only come from the decoder reporting where it stopped.
  it("takes the key's end from the decoder, leaving trailing extension bytes out of it", async () => {
    const parsed = parseAuthData(await authData({ flags: FLAG.up | FLAG.at | FLAG.ed, attested: true, trailing: "a16b6372656450726f7465637402" }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || !parsed.data.attested) throw new Error("no attested credential");
    expect(bytesToHex(parsed.data.attested.publicKeyBytes)).toBe(COSE_KEY_HEX);
  });

  it("reports no attested credential when the flag is clear, whatever follows", async () => {
    const parsed = parseAuthData(await authData({ flags: FLAG.up, trailing: COSE_KEY_HEX }));
    expect(parsed.ok && parsed.data.attested).toBeUndefined();
  });

  it("refuses a segment that ends before its declared credential id", async () => {
    const full = await authData({ flags: FLAG.up | FLAG.at, attested: true });
    expect(parseAuthData(full.slice(0, 40))).toEqual({ ok: false, error: "malformed" });
    expect(parseAuthData(full.slice(0, 55))).toEqual({ ok: false, error: "malformed" });
  });

  it("refuses a key it cannot decode", async () => {
    const rpIdHash = bytesToHex(await sha256(RP_ID));
    const broken = hexToBytes(`${rpIdHash}4100000000${AAGUID_HEX}0002aabb${"ff"}`);
    expect(parseAuthData(broken)).toEqual({ ok: false, error: "unsupported-key" });
  });
});

describe("verifyAuthData — the relying-party id", () => {
  it("accepts the hash of the configured id", async () => {
    expect((await verifyAuthData(await authData({ flags: FLAG.up }), EXPECTED)).ok).toBe(true);
  });

  // Compared as a hash of the configured id, never as text and never decoded back to a name — the
  // mistake that makes a credential minted for another relying party look valid here.
  it("refuses a hash of any other id, including one that merely looks related", async () => {
    for (const rpId of ["evil.test", "example.com.evil.test", "sub.example.com", "Example.com", "example.co", ""]) {
      const outcome = await verifyAuthData(await authData({ flags: FLAG.up, rpId }), EXPECTED);
      expect(`${rpId}: ${outcome.ok ? "accepted" : outcome.error}`).toBe(`${rpId}: rp-id-mismatch`);
    }
  });

  it("refuses an rpIdHash of the right length that is simply wrong", async () => {
    const bytes = await authData({ flags: FLAG.up });
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    expect(await verifyAuthData(bytes, EXPECTED)).toEqual({ ok: false, error: "rp-id-mismatch" });
  });
});

describe("verifyAuthData — presence and verification", () => {
  it("refuses data with the user-present flag clear", async () => {
    expect(await verifyAuthData(await authData({ flags: 0 }), EXPECTED)).toEqual({ ok: false, error: "user-not-present" });
  });

  it("refuses an unverified user when verification is required, and accepts one when it is not", async () => {
    const required: AuthDataExpectation = { ...EXPECTED, requireUserVerification: true };
    expect(await verifyAuthData(await authData({ flags: FLAG.up }), required)).toEqual({ ok: false, error: "user-not-verified" });
    expect((await verifyAuthData(await authData({ flags: FLAG.up | FLAG.uv }), required)).ok).toBe(true);
    expect((await verifyAuthData(await authData({ flags: FLAG.up }), EXPECTED)).ok).toBe(true);
  });
});

describe("verifyAuthData — the backup flags", () => {
  it("accepts the three combinations the specification allows", async () => {
    const rows: readonly { flags: number; name: string }[] = [
      { flags: FLAG.up, name: "be=0 bs=0" },
      { flags: FLAG.up | FLAG.be, name: "be=1 bs=0" },
      { flags: FLAG.up | FLAG.be | FLAG.bs, name: "be=1 bs=1" },
    ];
    for (const row of rows) {
      const outcome = await verifyAuthData(await authData({ flags: row.flags }), EXPECTED);
      expect(`${row.name}: ${outcome.ok ? "accepted" : outcome.error}`).toBe(`${row.name}: accepted`);
    }
  });

  it("refuses be=0 bs=1, which is an authenticator lying about its own state", async () => {
    expect(await verifyAuthData(await authData({ flags: FLAG.up | FLAG.bs }), EXPECTED)).toEqual({ ok: false, error: "invalid-backup-state" });
  });
});

describe("verifyAuthData — a required attested credential", () => {
  it("refuses a registration whose data carries none", async () => {
    const required: AuthDataExpectation = { ...EXPECTED, requireAttestedCredential: true };
    expect(await verifyAuthData(await authData({ flags: FLAG.up }), required)).toEqual({ ok: false, error: "malformed" });
    expect((await verifyAuthData(await authData({ flags: FLAG.up | FLAG.at, attested: true }), required)).ok).toBe(true);
  });
});
