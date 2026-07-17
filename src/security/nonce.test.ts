import { describe, expect, it } from "bun:test";
import { NONCE, TURNSTILE_CSP } from "./nonce";

describe("NONCE", () => {
  it("is a symbol with stable referential identity", () => {
    expect(typeof NONCE).toBe("symbol");
    const alias = NONCE;
    expect(alias).toBe(NONCE);
  });

  it("carries the documented description", () => {
    expect(NONCE.description).toBe("@y-core/forge/csp-nonce");
  });

  it("is a unique (non-global) symbol — a fresh Symbol with the same description is not equal", () => {
    expect(Symbol("@y-core/forge/csp-nonce")).not.toBe(NONCE);
  });
});

describe("TURNSTILE_CSP", () => {
  it("is the Cloudflare Turnstile CDN origin", () => {
    expect(TURNSTILE_CSP).toBe("https://challenges.cloudflare.com");
  });
});
