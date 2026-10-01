import { describe, expect, it } from "bun:test";

import { totpCodes } from "./totp";

// RFC 6238 Appendix B's seeds, base32-encoded; the codes are that appendix's and RFC 4226 Appendix D's.
const SHA1_SEED = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const SHA256_SEED = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA";
const SHA512_SEED = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA";

const uri = (params: Record<string, string>): string => `otpauth://totp/Forge:ada@example.com?${new URLSearchParams(params).toString()}`;

describe("totpCodes", () => {
  it("reads SHA-1, six digits and a 30-second period when the URI names none", async () => {
    expect(await totpCodes(uri({ secret: SHA1_SEED }), 59_000)).toEqual({ previous: "755224", current: "287082" });
  });

  it("keeps a code's leading zero", async () => {
    expect((await totpCodes(uri({ secret: SHA1_SEED, digits: "8" }), 1_111_111_109_000)).current).toBe("07081804");
  });

  it("uses the algorithm the URI names", async () => {
    expect((await totpCodes(uri({ secret: SHA256_SEED, digits: "8", algorithm: "SHA256" }), 59_000)).current).toBe("46119246");
    expect((await totpCodes(uri({ secret: SHA512_SEED, digits: "8", algorithm: "SHA512" }), 59_000)).current).toBe("90693936");
  });

  it("steps by the period the URI names", async () => {
    expect(await totpCodes(uri({ secret: SHA1_SEED, period: "60" }), 119_000)).toEqual({ previous: "755224", current: "287082" });
  });

  it("refuses an algorithm RFC 6238 does not define", async () => {
    await expect(totpCodes(uri({ secret: SHA1_SEED, algorithm: "MD5" }), 59_000)).rejects.toThrow("totpCodes: unsupported algorithm MD5");
  });
});
