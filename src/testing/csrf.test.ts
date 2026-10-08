import { describe, expect, it } from "bun:test";

import { importKeyRing } from "../crypto/keyring/ring";
import { base64urlDecode, utf8Decode } from "../crypto/primitives/mod";
import { verifyCsrfToken } from "../form/csrf";
import { mintTestCsrfToken } from "./csrf";

const SECRET = "9c55dd3f0812c671dc6d905ab7941deebb36feefbbfe4ba28bd37ae08287a9cf";

describe("mintTestCsrfToken", () => {
  it("mints a token that verifies against the same secret and path", async () => {
    const token = await mintTestCsrfToken(SECRET, "/api/contact");
    const ring = await importKeyRing([SECRET]);
    const result = await verifyCsrfToken(ring, token, "/api/contact");
    expect(result).toEqual({ ok: true });
  });

  it("mints a path-bound token — wrong path fails with path-mismatch", async () => {
    const token = await mintTestCsrfToken(SECRET, "/api/contact");
    const ring = await importKeyRing([SECRET]);
    const result = await verifyCsrfToken(ring, token, "/api/other");
    expect(result).toEqual({ ok: false, error: "path-mismatch" });
  });

  it("supports subject binding — wrong subject fails with subject-mismatch", async () => {
    const token = await mintTestCsrfToken(SECRET, "/api/save", { subject: "session-a" });
    const ring = await importKeyRing([SECRET]);
    expect(await verifyCsrfToken(ring, token, "/api/save", { subject: "session-a" })).toEqual({ ok: true });
    expect(await verifyCsrfToken(ring, token, "/api/save", { subject: "session-b" })).toEqual({ ok: false, error: "subject-mismatch" });
  });

  it("carries the kid of the ring built from the secret", async () => {
    const token = await mintTestCsrfToken(SECRET, "/api/contact");
    const payload = utf8Decode(base64urlDecode(token.slice(0, token.indexOf("."))));
    expect(payload.split("|")[0]).toBe((await importKeyRing([SECRET])).activeKeyId);
  });

  it("rejects an invalid hex secret", async () => {
    await expect(mintTestCsrfToken("not-hex", "/p")).rejects.toThrow();
  });
});
