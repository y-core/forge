import { describe, expect, it, spyOn } from "bun:test";

import { createSignedObjectUrl, importSigningKey, MAX_SIGNED_URL_LIFETIME, verifySignedObjectUrl } from "./signing";

async function makeKey(): Promise<CryptoKey> {
  return importSigningKey("deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
}

describe("createSignedObjectUrl / verifySignedObjectUrl", () => {
  it("creates a verifiable signed URL", async () => {
    const key = await makeKey();
    const url = await createSignedObjectUrl(key, "https://cdn.example.com/download", "photos/sunset.jpg");
    const result = await verifySignedObjectUrl(key, url);
    expect(result).toEqual({ ok: true, data: "photos/sunset.jpg" });
  });

  it("includes key, exp, and sig query params", async () => {
    const key = await makeKey();
    const url = await createSignedObjectUrl(key, "https://cdn.example.com/", "file.txt");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("key")).toBe("file.txt");
    expect(parsed.searchParams.get("exp")).not.toBeNull();
    expect(parsed.searchParams.get("sig")).not.toBeNull();
  });

  it("returns invalid-signature for a tampered signature", async () => {
    const key = await makeKey();
    const url = await createSignedObjectUrl(key, "https://x.com/", "obj.png");
    const parsed = new URL(url);
    parsed.searchParams.set("sig", "tampered");
    const result = await verifySignedObjectUrl(key, parsed.toString());
    expect(result).toEqual({ ok: false, error: "invalid-signature" });
  });

  it("returns invalid-signature for a tampered key param", async () => {
    const key = await makeKey();
    const url = await createSignedObjectUrl(key, "https://x.com/", "original.png");
    const parsed = new URL(url);
    parsed.searchParams.set("key", "hacked.png");
    const result = await verifySignedObjectUrl(key, parsed.toString());
    expect(result.ok).toBe(false);
  });

  it("returns expired for a URL past its expiry", async () => {
    const key = await makeKey();
    const url = await createSignedObjectUrl(key, "https://x.com/", "file.txt", { expiresInSeconds: 60 });
    const exp = Number(new URL(url).searchParams.get("exp"));
    const now = spyOn(Date, "now").mockReturnValue((exp + 1) * 1000);
    try {
      const result = await verifySignedObjectUrl(key, url);
      expect(result).toEqual({ ok: false, error: "expired" });
    } finally {
      now.mockRestore();
    }
  });

  for (const lifetime of [0, -1, 1.5, MAX_SIGNED_URL_LIFETIME + 1]) {
    it(`refuses to sign a lifetime of ${lifetime} seconds`, async () => {
      const key = await makeKey();
      const signing = createSignedObjectUrl(key, "https://x.com/", "file.txt", { expiresInSeconds: lifetime });
      await expect(signing).rejects.toThrow(/^createSignedObjectUrl:/);
    });
  }

  it("signs a lifetime of exactly MAX_SIGNED_URL_LIFETIME", async () => {
    const key = await makeKey();
    const url = await createSignedObjectUrl(key, "https://x.com/", "file.txt", { expiresInSeconds: MAX_SIGNED_URL_LIFETIME });
    expect(await verifySignedObjectUrl(key, url)).toEqual({ ok: true, data: "file.txt" });
  });

  for (const exp of ["123abc", "-5", "1e10"]) {
    it(`returns invalid-format for a non-digit exp of ${exp}`, async () => {
      const key = await makeKey();
      const parsed = new URL(await createSignedObjectUrl(key, "https://x.com/", "file.txt"));
      parsed.searchParams.set("exp", exp);
      const result = await verifySignedObjectUrl(key, parsed.toString());
      expect(result).toEqual({ ok: false, error: "invalid-format" });
    });
  }

  it("returns invalid-format for a malformed URL", async () => {
    const key = await makeKey();
    const result = await verifySignedObjectUrl(key, "not-a-url");
    expect(result).toEqual({ ok: false, error: "invalid-format" });
  });

  it("returns invalid-format when required params are missing", async () => {
    const key = await makeKey();
    const result = await verifySignedObjectUrl(key, "https://x.com/?key=a&exp=9999999999");
    expect(result).toEqual({ ok: false, error: "invalid-format" });
  });

  it("round-trips a key containing the '|' delimiter (length-prefixed payload)", async () => {
    const key = await makeKey();
    const url = await createSignedObjectUrl(key, "https://x.com/", "weird|name|with|pipes.txt");
    const result = await verifySignedObjectUrl(key, url);
    expect(result).toEqual({ ok: true, data: "weird|name|with|pipes.txt" });
  });

  it("does not accept a signature minted for a different key/exp split (delimiter ambiguity)", async () => {
    const key = await makeKey();
    // Fixture key "a|100" embeds the payload delimiter; the length prefix makes "5:a|100" distinct from "1:a|100".
    const url = await createSignedObjectUrl(key, "https://x.com/", "a|100");
    const parsed = new URL(url);
    parsed.searchParams.set("key", "a");
    parsed.searchParams.set("exp", "100");
    const result = await verifySignedObjectUrl(key, parsed.toString());
    expect(result.ok).toBe(false);
  });
});
