import { describe, expect, it } from "bun:test";

import { base64urlDecode, base64urlEncode, utf8Encode } from "../../crypto/mod";
import { AUTH_KV_MIN_TTL_SECONDS } from "../config";
import type { AuthKeyRing } from "../types";
import { importAuthKeyRing } from "./ring";
import {
  AUTH_KID_BYTES,
  AUTH_TOKEN_VERSION,
  authNonceKey,
  authNonceTtlSeconds,
  decodeAuthToken,
  encodeAuthToken,
  openAtRest,
  sealAtRest,
  tokenKeyId,
} from "./token";
import type { AuthTokenPurpose } from "./types";

const SECRET_A = "a70bf50e531ce1a817561f2f5d5b6645d4e806becf58ccc5e8cf6b8045a090a8";
const SECRET_B = "49e2bb7eab54cf09b409ffafd3fa8a8a955a60eb972faacaefbed3dbd3207132";
const NOW = 1_760_000_000_000;
const TTL = 900_000;

const PURPOSES: readonly AuthTokenPurpose[] = ["verify", "identity", "totpWrap", "nonce"];

/** Field offsets in `version(1) ‖ kid(6) ‖ iv(12) ‖ iat(8) ‖ exp(8) ‖ ct‖tag`. */
const FIELDS: readonly { name: string; offset: number }[] = [
  { name: "version", offset: 0 },
  { name: "kid", offset: 1 },
  { name: "iv", offset: 7 },
  { name: "iat", offset: 19 },
  { name: "exp", offset: 27 },
  { name: "ciphertext", offset: 35 },
];

function ringOf(...secrets: string[]): Promise<AuthKeyRing> {
  return importAuthKeyRing(secrets as [string, ...string[]]);
}

function flip(token: string, offset: number): string {
  const bytes = base64urlDecode(token);
  bytes[offset] = (bytes[offset] ?? 0) ^ 0x01;
  return base64urlEncode(bytes);
}

describe("importAuthKeyRing", () => {
  it("derives an eight-character base64url key id that decodes to exactly six bytes", async () => {
    const ring = await ringOf(SECRET_A);
    expect(ring.activeKeyId.length).toBe(8);
    expect(ring.activeKeyId).toMatch(/^[A-Za-z0-9_-]{8}$/);
    expect(base64urlDecode(ring.activeKeyId).byteLength).toBe(6);
  });

  it("makes the first secret active and keeps every secret readable", async () => {
    const ring = await ringOf(SECRET_A, SECRET_B);
    const soloA = await ringOf(SECRET_A);
    expect(ring.activeKeyId).toBe(soloA.activeKeyId);
    expect(Object.keys(ring.keys).length).toBe(2);
  });

  it("gives two different secrets two different ids", async () => {
    const [a, b] = await Promise.all([ringOf(SECRET_A), ringOf(SECRET_B)]);
    expect(a.activeKeyId).not.toBe(b.activeKeyId);
  });

  it("refuses a secret that is not hex or is under 32 bytes", () => {
    expect(ringOf("zz".repeat(32))).rejects.toThrow("importAuthKeyRing: each secret must be an even-length hex string");
    expect(ringOf("a1".repeat(16))).rejects.toThrow("importAuthKeyRing: each secret must be at least 32 bytes (64 hex characters)");
  });
});

describe("encodeAuthToken and decodeAuthToken", () => {
  it("round-trips a payload with its two timestamps", async () => {
    const ring = await ringOf(SECRET_A);
    const token = await encodeAuthToken(ring, "verify", "aurora@example.test", TTL, { now: NOW });
    const decoded = await decodeAuthToken(ring, "verify", token, { now: NOW });
    expect(decoded).toEqual({ ok: true, data: { payload: "aurora@example.test", issuedAt: NOW, expiresAt: NOW + TTL } });
  });

  it("writes the declared frame version and the active key id", async () => {
    const ring = await ringOf(SECRET_A);
    const token = await encodeAuthToken(ring, "verify", "x", TTL, { now: NOW });
    expect(base64urlDecode(token)[0]).toBe(AUTH_TOKEN_VERSION);
    expect(tokenKeyId(token)).toBe(ring.activeKeyId);
  });

  it("produces a different token each time, so two links for one address never collide", async () => {
    const ring = await ringOf(SECRET_A);
    const first = await encodeAuthToken(ring, "verify", "x", TTL, { now: NOW });
    const second = await encodeAuthToken(ring, "verify", "x", TTL, { now: NOW });
    expect(first).not.toBe(second);
  });

  it("does not carry the payload in the clear, which is the whole reason for AES-GCM", async () => {
    const ring = await ringOf(SECRET_A);
    const token = await encodeAuthToken(ring, "verify", "aurora@example.test", TTL, { now: NOW });
    expect(token).not.toContain("aurora");
    expect(new TextDecoder("utf-8").decode(base64urlDecode(token))).not.toContain("aurora");
  });

  it("still opens a token minted under a retired key after rotation", async () => {
    const before = await ringOf(SECRET_A);
    const token = await encodeAuthToken(before, "verify", "x", TTL, { now: NOW });
    const after = await ringOf(SECRET_B, SECRET_A);
    expect(await decodeAuthToken(after, "verify", token, { now: NOW })).toMatchObject({ ok: true });
  });

  it("refuses a non-positive ttl", async () => {
    const ring = await ringOf(SECRET_A);
    expect(encodeAuthToken(ring, "verify", "x", 0)).rejects.toThrow("encodeAuthToken: ttlMs must be a positive number of milliseconds");
    expect(encodeAuthToken(ring, "verify", "x", -1)).rejects.toThrow("encodeAuthToken: ttlMs must be a positive number of milliseconds");
  });

  it("refuses a hand-built ring whose active key id is not the derived form", async () => {
    const ring = await ringOf(SECRET_A);
    const handBuilt: AuthKeyRing = { activeKeyId: "constructor", keys: { constructor: ring.keys[ring.activeKeyId] as Uint8Array<ArrayBuffer> } };
    expect(encodeAuthToken(handBuilt, "verify", "x", TTL)).rejects.toThrow(
      'encodeAuthToken: key id "constructor" must be 8 base64url characters — use importAuthKeyRing to derive one',
    );
  });
});

describe("decodeAuthToken — refusals", () => {
  it("refuses an expired token, and accepts it one millisecond earlier", async () => {
    const ring = await ringOf(SECRET_A);
    const token = await encodeAuthToken(ring, "verify", "x", TTL, { now: NOW });
    expect(await decodeAuthToken(ring, "verify", token, { now: NOW + TTL - 1 })).toMatchObject({ ok: true });
    expect(await decodeAuthToken(ring, "verify", token, { now: NOW + TTL })).toEqual({ ok: false, error: "expired" });
  });

  it("refuses a key id no ring declares", async () => {
    const minted = await ringOf(SECRET_A);
    const token = await encodeAuthToken(minted, "verify", "x", TTL, { now: NOW });
    const other = await ringOf(SECRET_B);
    expect(await decodeAuthToken(other, "verify", token, { now: NOW })).toEqual({ ok: false, error: "unknown-key" });
  });

  // A kid field is six bytes, so `constructor` and `__proto__` can only arrive as a prefix of one.
  // The lookup is `Object.hasOwn` regardless, so neither resolves to a function on the key record.
  it("refuses an inherited property name reached through the kid field", async () => {
    const ring = await ringOf(SECRET_A);
    const token = await encodeAuthToken(ring, "verify", "x", TTL, { now: NOW });
    for (const name of ["constructor", "__proto__"]) {
      const bytes = base64urlDecode(token);
      bytes.set(new TextEncoder().encode(name.slice(0, 6)), 1);
      expect(await decodeAuthToken(ring, "verify", base64urlEncode(bytes), { now: NOW })).toEqual({ ok: false, error: "unknown-key" });
    }
  });

  it("refuses a token that is not base64url or is shorter than one frame", async () => {
    const ring = await ringOf(SECRET_A);
    expect(await decodeAuthToken(ring, "verify", "not a token!", { now: NOW })).toEqual({ ok: false, error: "malformed" });
    expect(await decodeAuthToken(ring, "verify", "", { now: NOW })).toEqual({ ok: false, error: "malformed" });
    expect(await decodeAuthToken(ring, "verify", base64urlEncode(new Uint8Array(35)), { now: NOW })).toEqual({ ok: false, error: "malformed" });
  });

  it("refuses a frame version it does not write", async () => {
    const ring = await ringOf(SECRET_A);
    const bytes = base64urlDecode(await encodeAuthToken(ring, "verify", "x", TTL, { now: NOW }));
    bytes[0] = AUTH_TOKEN_VERSION + 1;
    expect(await decodeAuthToken(ring, "verify", base64urlEncode(bytes), { now: NOW })).toEqual({ ok: false, error: "unsupported-version" });
  });

  it("refuses a truncated frame", async () => {
    const ring = await ringOf(SECRET_A);
    const bytes = base64urlDecode(await encodeAuthToken(ring, "verify", "x", TTL, { now: NOW }));
    expect(await decodeAuthToken(ring, "verify", base64urlEncode(bytes.subarray(0, bytes.length - 4)), { now: NOW })).toEqual({
      ok: false,
      error: "not-authentic",
    });
  });

  it("refuses a flipped byte in every frame field, each with its own reason", async () => {
    const ring = await ringOf(SECRET_A);
    const token = await encodeAuthToken(ring, "verify", "aurora@example.test", TTL, { now: NOW });
    const expected: Record<string, string> = {
      version: "unsupported-version",
      kid: "unknown-key",
      iv: "not-authentic",
      iat: "not-authentic",
      exp: "not-authentic",
      ciphertext: "not-authentic",
    };
    for (const { name, offset } of FIELDS) {
      const decoded = await decodeAuthToken(ring, "verify", flip(token, offset), { now: NOW });
      expect(`${name}: ${decoded.ok ? "accepted" : decoded.error}`).toBe(`${name}: ${expected[name]}`);
    }
  });

  it("refuses a flipped byte in the trailing tag", async () => {
    const ring = await ringOf(SECRET_A);
    const token = await encodeAuthToken(ring, "verify", "x", TTL, { now: NOW });
    expect(await decodeAuthToken(ring, "verify", flip(token, base64urlDecode(token).length - 1), { now: NOW })).toEqual({
      ok: false,
      error: "not-authentic",
    });
  });
});

describe("decodeAuthToken — cross-domain isolation", () => {
  it("refuses a token minted for one purpose under every other purpose", async () => {
    const ring = await ringOf(SECRET_A);
    for (const minted of PURPOSES) {
      const token = await encodeAuthToken(ring, minted, "aurora@example.test", TTL, { now: NOW });
      expect(await decodeAuthToken(ring, minted, token, { now: NOW })).toMatchObject({ ok: true });
      for (const read of PURPOSES) {
        if (read === minted) continue;
        const decoded = await decodeAuthToken(ring, read, token, { now: NOW });
        expect(`${minted} read as ${read}: ${decoded.ok ? "accepted" : decoded.error}`).toBe(`${minted} read as ${read}: not-authentic`);
      }
    }
  });
});

describe("authNonceKey", () => {
  it("returns a stable key for one token", async () => {
    const ring = await ringOf(SECRET_A);
    const token = await encodeAuthToken(ring, "verify", "x", TTL, { now: NOW });
    const first = await authNonceKey(ring, token);
    expect(first).toEqual(await authNonceKey(ring, token));
    expect(first.ok && first.data.length).toBeGreaterThan(0);
  });

  it("gives two tokens two different keys", async () => {
    const ring = await ringOf(SECRET_A);
    const a = await authNonceKey(ring, await encodeAuthToken(ring, "verify", "x", TTL, { now: NOW }));
    const b = await authNonceKey(ring, await encodeAuthToken(ring, "verify", "x", TTL, { now: NOW }));
    expect(a).not.toEqual(b);
  });

  it("is not the bare hash an observer holding the token could compute", async () => {
    const ring = await ringOf(SECRET_A);
    const token = await encodeAuthToken(ring, "verify", "x", TTL, { now: NOW });
    const underA = await authNonceKey(ring, token);
    const withOtherSecret = await importAuthKeyRing([SECRET_B]);
    // Same token, different root key: a bare `sha256(token)` would collide here, and that collision
    // is exactly the consumed-or-not oracle an observer would get.
    const forged: AuthKeyRing = {
      activeKeyId: ring.activeKeyId,
      keys: { [ring.activeKeyId]: withOtherSecret.keys[withOtherSecret.activeKeyId] as Uint8Array<ArrayBuffer> },
    };
    expect(await authNonceKey(forged, token)).not.toEqual(underA);
  });

  it("keeps the key stable across rotation, so a consumed token stays consumed", async () => {
    const before = await ringOf(SECRET_A);
    const token = await encodeAuthToken(before, "verify", "x", TTL, { now: NOW });
    const after = await ringOf(SECRET_B, SECRET_A);
    expect(await authNonceKey(after, token)).toEqual(await authNonceKey(before, token));
  });

  it("refuses a malformed token and an unknown key id", async () => {
    const ring = await ringOf(SECRET_A);
    expect(await authNonceKey(ring, "not a token!")).toEqual({ ok: false, error: "malformed" });
    const token = await encodeAuthToken(await ringOf(SECRET_B), "verify", "x", TTL, { now: NOW });
    expect(await authNonceKey(ring, token)).toEqual({ ok: false, error: "unknown-key" });
  });
});

// Every alias decodes to the same frame and passes the tag, so without this each spelling of one
// spent token would derive a fresh nonce key and open again.
describe("non-canonical base64url spellings of one token", () => {
  /** The three aliases `base64urlDecode` accepts for one token, or `null` where the token happens to have none. */
  function aliasesOf(token: string): { name: string; alias: string | null }[] {
    const padded = token.length % 4 === 0 ? null : `${token}=`;
    const standard = /[-_]/.test(token) ? token.replace(/-/g, "+").replace(/_/g, "/") : null;
    // The last character's low bits fall past the byte boundary, so flipping one changes the string and not the frame.
    const spare = (4 - (token.length % 4)) % 4;
    const last = token.at(-1) ?? "";
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const lowBits = spare === 0 ? null : `${token.slice(0, -1)}${alphabet[alphabet.indexOf(last) ^ 1]}`;
    return [
      { name: "padded", alias: padded },
      { name: "standard alphabet", alias: standard },
      { name: "low-bit flip", alias: lowBits },
    ];
  }

  it("refuses each alias from decodeAuthToken and authNonceKey while the canonical token still opens", async () => {
    const ring = await ringOf(SECRET_A);
    let covered = 0;
    for (let attempt = 0; covered < 3 && attempt < 32; attempt++) {
      const token = await encodeAuthToken(ring, "verify", "x".repeat(attempt), TTL, { now: NOW });
      expect(await decodeAuthToken(ring, "verify", token, { now: NOW })).toMatchObject({ ok: true });
      expect((await authNonceKey(ring, token)).ok).toBe(true);
      covered = 0;
      for (const { name, alias } of aliasesOf(token)) {
        if (alias === null) continue;
        covered += 1;
        expect(`${name}: same frame`).toBe(`${name}: ${base64urlEncode(base64urlDecode(alias)) === token ? "same frame" : "different frame"}`);
        expect(`${name}: ${JSON.stringify(await decodeAuthToken(ring, "verify", alias, { now: NOW }))}`).toBe(
          `${name}: {"ok":false,"error":"malformed"}`,
        );
        expect(`${name}: ${JSON.stringify(await authNonceKey(ring, alias))}`).toBe(`${name}: {"ok":false,"error":"malformed"}`);
      }
    }
    expect(covered).toBe(3);
  });
});

describe("sealAtRest / openAtRest", () => {
  const PLAINTEXT = new Uint8Array([9, 8, 7, 6, 5]) as Uint8Array<ArrayBuffer>;
  const CONTEXT = utf8Encode("totp-app u1");
  const OTHER_CONTEXT = utf8Encode("totp-app u2");

  it("frames the ciphertext as kid(6) ‖ nonce(12) ‖ ciphertext‖tag and opens it again", async () => {
    const ring = await ringOf(SECRET_A);
    const frame = await sealAtRest(ring, "totpWrap", CONTEXT, PLAINTEXT);
    expect(frame.byteLength).toBe(AUTH_KID_BYTES + 12 + PLAINTEXT.byteLength + 16);
    expect(base64urlEncode(frame.subarray(0, AUTH_KID_BYTES))).toBe(ring.activeKeyId);
    expect(await openAtRest(ring, "totpWrap", CONTEXT, frame)).toEqual(PLAINTEXT);
  });

  it("gives a different frame each time, so two seals of one plaintext do not match", async () => {
    const ring = await ringOf(SECRET_A);
    const first = await sealAtRest(ring, "totpWrap", CONTEXT, PLAINTEXT);
    const second = await sealAtRest(ring, "totpWrap", CONTEXT, PLAINTEXT);
    expect(base64urlEncode(first)).not.toBe(base64urlEncode(second));
  });

  it("refuses a frame opened under a different context", async () => {
    const ring = await ringOf(SECRET_A);
    const frame = await sealAtRest(ring, "totpWrap", CONTEXT, PLAINTEXT);
    expect(await openAtRest(ring, "totpWrap", OTHER_CONTEXT, frame)).toBeNull();
  });

  it("refuses a frame opened under a different purpose, because the subkeys differ", async () => {
    const ring = await ringOf(SECRET_A);
    const frame = await sealAtRest(ring, "totpWrap", CONTEXT, PLAINTEXT);
    expect(await openAtRest(ring, "verify", CONTEXT, frame)).toBeNull();
  });

  it("refuses a frame whose key the ring does not hold, and opens one under a retired key", async () => {
    const sealed = await sealAtRest(await ringOf(SECRET_A), "totpWrap", CONTEXT, PLAINTEXT);
    expect(await openAtRest(await ringOf(SECRET_B), "totpWrap", CONTEXT, sealed)).toBeNull();
    expect(await openAtRest(await ringOf(SECRET_B, SECRET_A), "totpWrap", CONTEXT, sealed)).toEqual(PLAINTEXT);
  });

  it("refuses a frame no longer than its own header, and one with a flipped byte", async () => {
    const ring = await ringOf(SECRET_A);
    const frame = await sealAtRest(ring, "totpWrap", CONTEXT, PLAINTEXT);
    expect(await openAtRest(ring, "totpWrap", CONTEXT, frame.slice(0, AUTH_KID_BYTES + 12))).toBeNull();
    const tampered = frame.slice();
    tampered[tampered.byteLength - 1] = (tampered[tampered.byteLength - 1] ?? 0) ^ 0xff;
    expect(await openAtRest(ring, "totpWrap", CONTEXT, tampered)).toBeNull();
  });

  it("refuses to seal under a ring holding no key for its active id", async () => {
    const broken: AuthKeyRing = { activeKeyId: "AAAAAAAA", keys: {} };
    await expect(sealAtRest(broken, "totpWrap", CONTEXT, PLAINTEXT)).rejects.toThrow(
      'sealAtRest: the key ring has no key for its active key id "AAAAAAAA"',
    );
  });
});

// The raw subkey was cached and the imported key was not, so every seal, open and sign re-ran
// `crypto.subtle.importKey` — once per token operation, on the request path.
describe("the imported key is cached, not just the derived bytes", () => {
  it("re-imports nothing once a purpose has been used, however many operations follow", async () => {
    const ring = await importAuthKeyRing([SECRET_A]);
    // The first operation pays for the HKDF derivation and the import both; what this measures is
    // every operation after it, which used to pay for the import again each time.
    const warm = await encodeAuthToken(ring, "verify", "a", 60_000);
    await authNonceKey(ring, warm);

    // oxlint-disable-next-line typescript/no-explicit-any -- swapping the platform method for a counter
    const original = (crypto.subtle as any).importKey;
    let imports = 0;
    // oxlint-disable-next-line typescript/no-explicit-any -- swapping the platform method for a counter
    (crypto.subtle as any).importKey = (...args: unknown[]) => {
      imports++;
      return original.apply(crypto.subtle, args);
    };
    try {
      await decodeAuthToken(ring, "verify", warm);
      await decodeAuthToken(ring, "verify", await encodeAuthToken(ring, "verify", "b", 60_000));
      await authNonceKey(ring, warm);
      expect(imports).toBe(0);
    } finally {
      // oxlint-disable-next-line typescript/no-explicit-any -- restoring the platform method
      (crypto.subtle as any).importKey = original;
    }
  });

  it("keeps the two algorithms apart, so an AEAD key is never handed to the signer", async () => {
    const ring = await importAuthKeyRing([SECRET_A]);
    const token = await encodeAuthToken(ring, "verify", "a", 60_000);
    // A key imported for AES-GCM cannot sign; that this resolves at all is the separation holding.
    expect((await authNonceKey(ring, token)).ok).toBe(true);
  });
});

describe("authNonceTtlSeconds", () => {
  it("rounds a lifetime up to whole seconds", () => {
    expect(authNonceTtlSeconds(900_001)).toBe(901);
  });

  // No floor any more: the nonce store is a SQL table whose rows a purge reclaims, so a short
  // lifetime shortens only how long a consumed key is worth keeping — never whether it is consumed.
  it("carries a short lifetime through rather than clamping it up to a KV floor", () => {
    expect(authNonceTtlSeconds(1)).toBe(1);
    expect(authNonceTtlSeconds(-5)).toBe(0);
    expect(authNonceTtlSeconds(AUTH_KV_MIN_TTL_SECONDS * 1000)).toBe(AUTH_KV_MIN_TTL_SECONDS);
  });
});
