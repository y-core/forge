import { describe, expect, it } from "bun:test";
import { importCsrfKey, verifyCsrfToken } from "../form/csrf";
import { mintTestCsrfToken } from "./csrf";

const SECRET = "a".repeat(64);

describe("mintTestCsrfToken", () => {
  it("mints a token that verifies against the same secret and path", async () => {
    const token = await mintTestCsrfToken(SECRET, "/api/contact");
    const key = await importCsrfKey(SECRET);
    const result = await verifyCsrfToken(key, token, "/api/contact");
    expect(result).toEqual({ ok: true });
  });

  it("mints a path-bound token — wrong path fails with path-mismatch", async () => {
    const token = await mintTestCsrfToken(SECRET, "/api/contact");
    const key = await importCsrfKey(SECRET);
    const result = await verifyCsrfToken(key, token, "/api/other");
    expect(result).toEqual({ ok: false, reason: "path-mismatch" });
  });

  it("supports subject binding — wrong subject fails with subject-mismatch", async () => {
    const token = await mintTestCsrfToken(SECRET, "/api/save", { subject: "session-a" });
    const key = await importCsrfKey(SECRET);
    expect(await verifyCsrfToken(key, token, "/api/save", { subject: "session-a" })).toEqual({ ok: true });
    expect(await verifyCsrfToken(key, token, "/api/save", { subject: "session-b" })).toEqual({ ok: false, reason: "subject-mismatch" });
  });

  it("rejects an invalid hex secret", async () => {
    await expect(mintTestCsrfToken("not-hex", "/p")).rejects.toThrow();
  });
});
