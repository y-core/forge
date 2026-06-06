import { describe, expect, it } from "bun:test";
import { createSignedObjectUrl, importSigningKey, verifySignedObjectUrl } from "./signing";

async function makeKey(): Promise<CryptoKey> {
  return importSigningKey("deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
}

describe("createSignedObjectUrl / verifySignedObjectUrl", () => {
  it("creates a verifiable signed URL", async () => {
    const key = await makeKey();
    const url = await createSignedObjectUrl(key, "https://cdn.example.com/download", "photos/sunset.jpg");
    const result = await verifySignedObjectUrl(key, url);
    expect(result).toEqual({ ok: true, key: "photos/sunset.jpg" });
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
    expect(result).toEqual({ ok: false, reason: "invalid-signature" });
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
    // Create with -1 second TTL: exp is in the past
    const url = await createSignedObjectUrl(key, "https://x.com/", "file.txt", { expiresInSeconds: -1 });
    const result = await verifySignedObjectUrl(key, url);
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("returns invalid-format for a malformed URL", async () => {
    const key = await makeKey();
    const result = await verifySignedObjectUrl(key, "not-a-url");
    expect(result).toEqual({ ok: false, reason: "invalid-format" });
  });

  it("returns invalid-format when required params are missing", async () => {
    const key = await makeKey();
    const result = await verifySignedObjectUrl(key, "https://x.com/?key=a&exp=9999999999");
    expect(result).toEqual({ ok: false, reason: "invalid-format" });
  });

  it("round-trips a key containing the '|' delimiter (length-prefixed payload)", async () => {
    const key = await makeKey();
    const url = await createSignedObjectUrl(key, "https://x.com/", "weird|name|with|pipes.txt");
    const result = await verifySignedObjectUrl(key, url);
    expect(result).toEqual({ ok: true, key: "weird|name|with|pipes.txt" });
  });

  it("does not accept a signature minted for a different key/exp split (delimiter ambiguity)", async () => {
    const key = await makeKey();
    // Sign for key "a|100"; an attacker cannot reuse the signature as key "a", exp 100 because the
    // length prefix makes "5:a|100|<exp>" distinct from "1:a|100".
    const url = await createSignedObjectUrl(key, "https://x.com/", "a|100");
    const parsed = new URL(url);
    parsed.searchParams.set("key", "a");
    parsed.searchParams.set("exp", "100");
    const result = await verifySignedObjectUrl(key, parsed.toString());
    expect(result.ok).toBe(false);
  });
});
