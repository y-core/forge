import { describe, expect, it, spyOn } from "bun:test";

import { HMAC_DOMAIN, importKeyRing, importKeyRingUnder } from "../../crypto/keyring/ring";
import { resolveKeyRingKey } from "../../crypto/keyring/subkey";
import type { KeyRing } from "../../crypto/keyring/types";
import { base64urlEncode } from "../../crypto/primitives/base64";
import { hmacSign } from "../../crypto/primitives/hmac";
import { createSignedObjectUrl, MAX_SIGNED_URL_LIFETIME, verifySignedObjectUrl } from "./signing";

const SECRET_A = "5e1d0c7a9b3f28e46a0d91c7b52f8e3a4c6d17b09e2f5a83c1d4e6b7f9a02c58";
const SECRET_B = "c83a1f6e0d29b74a5e8f13c6d0b9a2e7f41c5d8b36a09e2f7c1b4d6e8a3f5b90";

function ringOf(...secrets: [string, ...string[]]): Promise<KeyRing> {
  return importKeyRing(secrets);
}

function purposeKey(ring: KeyRing, purpose: string): Promise<CryptoKey> {
  const key = resolveKeyRingKey(ring, { domain: HMAC_DOMAIN, kid: ring.activeKeyId, purpose }, "hmac");
  if (!key) throw new Error(`test ring has no key for "${ring.activeKeyId}"`);
  return key;
}

function signingPayloadOf(kid: string, objectKey: string, exp: number): string {
  return `${kid.length}:${kid}|${objectKey.length}:${objectKey}|${exp}`;
}

function withParam(url: string, name: string, value: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set(name, value);
  return parsed.toString();
}

describe("createSignedObjectUrl / verifySignedObjectUrl", () => {
  it("creates a verifiable signed URL", async () => {
    const ring = await ringOf(SECRET_A);
    const url = await createSignedObjectUrl(ring, "https://cdn.example.com/download", "photos/sunset.jpg");
    expect(await verifySignedObjectUrl(ring, url)).toEqual({ ok: true, data: "photos/sunset.jpg" });
  });

  it("includes key, exp, kid, and sig query params, the kid being the ring's active one", async () => {
    const ring = await ringOf(SECRET_A);
    const parsed = new URL(await createSignedObjectUrl(ring, "https://cdn.example.com/", "file.txt"));
    expect([...parsed.searchParams.keys()]).toEqual(["key", "exp", "kid", "sig"]);
    expect(parsed.searchParams.get("key")).toBe("file.txt");
    expect(parsed.searchParams.get("exp")).toMatch(/^\d+$/);
    expect(parsed.searchParams.get("kid")).toBe(ring.activeKeyId);
    expect(parsed.searchParams.get("sig")).not.toBe("");
  });

  it("signs under the first secret of the ring", async () => {
    const ring = await ringOf(SECRET_B, SECRET_A);
    const firstOnly = await ringOf(SECRET_B);
    const url = await createSignedObjectUrl(ring, "https://x.com/", "file.txt");
    expect(new URL(url).searchParams.get("kid")).toBe(firstOnly.activeKeyId);
  });

  it("signs the kid, object key, and expiry in a length-prefixed layout", async () => {
    const ring = await ringOf(SECRET_A);
    const now = spyOn(Date, "now").mockReturnValue(1_790_000_000_000);
    try {
      const objectKey = "photos/sunset.jpg";
      const parsed = new URL(await createSignedObjectUrl(ring, "https://x.com/", objectKey));
      const kid = ring.activeKeyId;
      const exp = 1_790_000_000 + 3600;
      const expected = base64urlEncode(await hmacSign(await purposeKey(ring, "signed-url"), signingPayloadOf(kid, objectKey, exp)));
      expect(parsed.searchParams.get("exp")).toBe(String(exp));
      expect(parsed.searchParams.get("sig")).toBe(expected);
    } finally {
      now.mockRestore();
    }
  });

  it("signs and verifies a pinned URL byte for byte", async () => {
    const pinned = "https://x.com/?key=photos%2Fsunset.jpg&exp=1790003600&kid=VPQBGq8C&sig=94JpjBP6iFuK_1kFsti6SN2qvCG0tEF5Hc-N7xQPjIc";
    const ring = await ringOf(SECRET_A);
    const now = spyOn(Date, "now").mockReturnValue(1_790_000_000_000);
    try {
      expect(await createSignedObjectUrl(ring, "https://x.com/", "photos/sunset.jpg")).toBe(pinned);
      expect(await verifySignedObjectUrl(ring, pinned)).toEqual({ ok: true, data: "photos/sunset.jpg" });
    } finally {
      now.mockRestore();
    }
  });

  it("refuses to sign when the ring holds no key for its active key id", async () => {
    const ring = await ringOf(SECRET_A);
    const broken: KeyRing = { activeKeyId: "missing-kid0", keys: ring.keys };
    await expect(createSignedObjectUrl(broken, "https://x.com/", "file.txt")).rejects.toThrow(/^createSignedObjectUrl:/);
  });

  it("returns invalid-signature for a tampered signature", async () => {
    const ring = await ringOf(SECRET_A);
    const url = await createSignedObjectUrl(ring, "https://x.com/", "obj.png");
    expect(await verifySignedObjectUrl(ring, withParam(url, "sig", "tampered"))).toEqual({ ok: false, error: "invalid-signature" });
  });

  it("returns invalid-signature for a tampered key param", async () => {
    const ring = await ringOf(SECRET_A);
    const url = await createSignedObjectUrl(ring, "https://x.com/", "original.png");
    expect(await verifySignedObjectUrl(ring, withParam(url, "key", "hacked.png"))).toEqual({ ok: false, error: "invalid-signature" });
  });

  it("returns invalid-signature for an extended expiry", async () => {
    const ring = await ringOf(SECRET_A);
    const url = await createSignedObjectUrl(ring, "https://x.com/", "file.txt");
    const exp = Number(new URL(url).searchParams.get("exp"));
    expect(await verifySignedObjectUrl(ring, withParam(url, "exp", String(exp + 3600)))).toEqual({ ok: false, error: "invalid-signature" });
  });

  it("returns invalid-signature when the kid is swapped for another key in the ring", async () => {
    const ring = await ringOf(SECRET_A, SECRET_B);
    const kidB = (await ringOf(SECRET_B)).activeKeyId;
    const url = await createSignedObjectUrl(ring, "https://x.com/", "file.txt");
    expect(await verifySignedObjectUrl(ring, withParam(url, "kid", kidB))).toEqual({ ok: false, error: "invalid-signature" });
  });

  it("returns invalid-signature when the kid is swapped for another kid naming the same key", async () => {
    const base = await ringOf(SECRET_A);
    const ring: KeyRing = { activeKeyId: base.activeKeyId, keys: { ...base.keys, k2: base.keys[base.activeKeyId]! } };
    const url = await createSignedObjectUrl(ring, "https://x.com/", "file.txt");
    expect(await verifySignedObjectUrl(ring, withParam(url, "kid", "k2"))).toEqual({ ok: false, error: "invalid-signature" });
  });

  it("returns unknown-key for a kid the ring does not hold", async () => {
    const ring = await ringOf(SECRET_A);
    const url = await createSignedObjectUrl(ring, "https://x.com/", "file.txt");
    expect(await verifySignedObjectUrl(ring, withParam(url, "kid", "nosuchkid000"))).toEqual({ ok: false, error: "unknown-key" });
  });

  it("returns unknown-key ahead of invalid-signature for an unknown kid whose sig does not decode", async () => {
    const ring = await ringOf(SECRET_A);
    const url = withParam(await createSignedObjectUrl(ring, "https://x.com/", "file.txt"), "kid", "nosuchkid000");
    expect(await verifySignedObjectUrl(ring, withParam(url, "sig", "!!!"))).toEqual({ ok: false, error: "unknown-key" });
  });

  for (const kid of ["constructor", "__proto__", "toString"]) {
    it(`returns unknown-key for a prototype-named kid of ${kid}`, async () => {
      const ring = await ringOf(SECRET_A);
      const url = await createSignedObjectUrl(ring, "https://x.com/", "file.txt");
      expect(await verifySignedObjectUrl(ring, withParam(url, "kid", kid))).toEqual({ ok: false, error: "unknown-key" });
    });
  }

  it("returns invalid-format for a URL without a kid", async () => {
    const ring = await ringOf(SECRET_A);
    const parsed = new URL(await createSignedObjectUrl(ring, "https://x.com/", "file.txt"));
    parsed.searchParams.delete("kid");
    expect(await verifySignedObjectUrl(ring, parsed.toString())).toEqual({ ok: false, error: "invalid-format" });
  });

  it("returns expired for a URL past its expiry", async () => {
    const ring = await ringOf(SECRET_A);
    const url = await createSignedObjectUrl(ring, "https://x.com/", "file.txt", { expiresInSeconds: 60 });
    const exp = Number(new URL(url).searchParams.get("exp"));
    const now = spyOn(Date, "now").mockReturnValue((exp + 1) * 1000);
    try {
      expect(await verifySignedObjectUrl(ring, url)).toEqual({ ok: false, error: "expired" });
    } finally {
      now.mockRestore();
    }
  });

  it("returns expired, not unknown-key, for an expired URL whose key has left the ring", async () => {
    const url = await createSignedObjectUrl(await ringOf(SECRET_A), "https://x.com/", "file.txt", { expiresInSeconds: 60 });
    const exp = Number(new URL(url).searchParams.get("exp"));
    const ringB = await ringOf(SECRET_B);
    const now = spyOn(Date, "now").mockReturnValue((exp + 1) * 1000);
    try {
      expect(await verifySignedObjectUrl(ringB, url)).toEqual({ ok: false, error: "expired" });
    } finally {
      now.mockRestore();
    }
  });

  for (const lifetime of [0, -1, 1.5, MAX_SIGNED_URL_LIFETIME + 1]) {
    it(`refuses to sign a lifetime of ${lifetime} seconds`, async () => {
      const ring = await ringOf(SECRET_A);
      const signing = createSignedObjectUrl(ring, "https://x.com/", "file.txt", { expiresInSeconds: lifetime });
      await expect(signing).rejects.toThrow(/^createSignedObjectUrl:/);
    });
  }

  it("signs a lifetime of exactly MAX_SIGNED_URL_LIFETIME", async () => {
    const ring = await ringOf(SECRET_A);
    const url = await createSignedObjectUrl(ring, "https://x.com/", "file.txt", { expiresInSeconds: MAX_SIGNED_URL_LIFETIME });
    expect(await verifySignedObjectUrl(ring, url)).toEqual({ ok: true, data: "file.txt" });
  });

  for (const exp of ["123abc", "-5", "1e10"]) {
    it(`returns invalid-format for a non-digit exp of ${exp}`, async () => {
      const ring = await ringOf(SECRET_A);
      const url = await createSignedObjectUrl(ring, "https://x.com/", "file.txt");
      expect(await verifySignedObjectUrl(ring, withParam(url, "exp", exp))).toEqual({ ok: false, error: "invalid-format" });
    });
  }

  it("returns invalid-format for a malformed URL", async () => {
    const ring = await ringOf(SECRET_A);
    expect(await verifySignedObjectUrl(ring, "not-a-url")).toEqual({ ok: false, error: "invalid-format" });
  });

  it("returns invalid-format when required params are missing", async () => {
    const ring = await ringOf(SECRET_A);
    expect(await verifySignedObjectUrl(ring, "https://x.com/?key=a&exp=9999999999")).toEqual({ ok: false, error: "invalid-format" });
  });

  it("round-trips a key containing the '|' delimiter (length-prefixed payload)", async () => {
    const ring = await ringOf(SECRET_A);
    const url = await createSignedObjectUrl(ring, "https://x.com/", "weird|name|with|pipes.txt");
    expect(await verifySignedObjectUrl(ring, url)).toEqual({ ok: true, data: "weird|name|with|pipes.txt" });
  });

  it("does not accept a signature minted for a different key/exp split (delimiter ambiguity)", async () => {
    const ring = await ringOf(SECRET_A);
    const parsed = new URL(await createSignedObjectUrl(ring, "https://x.com/", "a|100"));
    parsed.searchParams.set("key", "a");
    parsed.searchParams.set("exp", "100");
    const result = await verifySignedObjectUrl(ring, parsed.toString());
    expect(result.ok).toBe(false);
  });
});

describe("signed URL key rotation", () => {
  it("verifies a URL signed under the old ring during and not after the overlap", async () => {
    const url = await createSignedObjectUrl(await ringOf(SECRET_A), "https://x.com/", "file.txt");
    expect(await verifySignedObjectUrl(await ringOf(SECRET_A), url)).toEqual({ ok: true, data: "file.txt" });
    expect(await verifySignedObjectUrl(await ringOf(SECRET_B, SECRET_A), url)).toEqual({ ok: true, data: "file.txt" });
    expect(await verifySignedObjectUrl(await ringOf(SECRET_B), url)).toEqual({ ok: false, error: "unknown-key" });
  });

  it("verifies a URL signed during the overlap once the old secret is retired", async () => {
    const url = await createSignedObjectUrl(await ringOf(SECRET_B, SECRET_A), "https://x.com/", "file.txt");
    expect(await verifySignedObjectUrl(await ringOf(SECRET_B), url)).toEqual({ ok: true, data: "file.txt" });
  });
});

describe("signed URL key-ring refusals", () => {
  const AUTH_DOMAIN = { keyIdLabel: "y-core/forge/test/auth/kid", subkeyLabel: "y-core/forge/test/auth/v1" };

  it("refuses to sign under the auth key ring", async () => {
    const authRing = await importKeyRingUnder("importAuthKeyRing", AUTH_DOMAIN, [SECRET_A]);
    await expect(createSignedObjectUrl(authRing, "https://x.com/", "file.txt")).rejects.toThrow(
      `createSignedObjectUrl: active key id "${authRing.activeKeyId}" is not one importKeyRing derives`,
    );
  });

  it("refuses to verify under the auth key ring", async () => {
    const url = await createSignedObjectUrl(await ringOf(SECRET_A), "https://x.com/", "file.txt");
    const authRing = await importKeyRingUnder("importAuthKeyRing", AUTH_DOMAIN, [SECRET_A]);
    await expect(verifySignedObjectUrl(authRing, url)).rejects.toThrow(
      `verifySignedObjectUrl: active key id "${authRing.activeKeyId}" is not one importKeyRing derives`,
    );
  });
});

describe("signed URL subkey separation", () => {
  it("refuses a signature made under the same ring's csrf subkey", async () => {
    const ring = await ringOf(SECRET_A);
    const exp = Math.floor(Date.now() / 1000) + 60;
    const sig = base64urlEncode(await hmacSign(await purposeKey(ring, "csrf"), signingPayloadOf(ring.activeKeyId, "file.txt", exp)));
    const url = `https://x.com/?key=file.txt&exp=${exp}&kid=${ring.activeKeyId}&sig=${sig}`;
    expect(await verifySignedObjectUrl(ring, url)).toEqual({ ok: false, error: "invalid-signature" });
  });

  it("never signs under the root key itself", async () => {
    const ring = await ringOf(SECRET_A);
    const parsed = new URL(await createSignedObjectUrl(ring, "https://x.com/", "file.txt"));
    const root = await crypto.subtle.importKey("raw", ring.keys[ring.activeKeyId]!, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const rootSig = base64urlEncode(await hmacSign(root, signingPayloadOf(ring.activeKeyId, "file.txt", Number(parsed.searchParams.get("exp")))));
    expect(parsed.searchParams.get("sig")).not.toBe(rootSig);
  });
});
