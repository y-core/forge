import { describe, expect, it } from "bun:test";

import { isMediaTypeToken, mediaTypeEssence } from "./media-type";

describe("mediaTypeEssence", () => {
  it("returns the lowercased type/subtype of one well-formed media type", () => {
    expect(mediaTypeEssence("text/html")).toBe("text/html");
    expect(mediaTypeEssence("TEXT/HTML ;charset=utf-8")).toBe("text/html");
    expect(mediaTypeEssence("  image/SVG+xml  ")).toBe("image/svg+xml");
    expect(mediaTypeEssence("multipart/form-data; boundary=x")).toBe("multipart/form-data");
    expect(mediaTypeEssence('text/plain; charset="utf-8; text/html"')).toBe("text/plain");
  });

  it("accepts the RFC 9110 parameter grammar, a comma or an escaped quote inside a quoted value included", () => {
    expect(mediaTypeEssence('multipart/form-data; boundary="a, b"')).toBe("multipart/form-data");
    expect(mediaTypeEssence('text/plain; title="say \\"hi\\", then go"')).toBe("text/plain");
    expect(mediaTypeEssence('text/plain; x="a\\\\"')).toBe("text/plain");
    expect(mediaTypeEssence("application/x-www-form-urlencoded;")).toBe("application/x-www-form-urlencoded");
    expect(mediaTypeEssence("text/html ;\tcharset=utf-8 ; ;")).toBe("text/html");
  });

  it("returns null when anything outside a quoted value trails the parameters", () => {
    for (const value of [
      "text/plain; charset=utf-8, text/html",
      "text/plain;x=y, text/html",
      "image/png;a=b,image/svg+xml",
      "text/html;charset=utf-8, x",
      'text/plain; charset="utf-8',
      'text/plain; x="a\\"',
      'text/plain; x="a"b',
      "text/plain; =x",
      "text/plain; x=",
      "text/plain; x",
      "text/plain x=y",
    ]) {
      expect(mediaTypeEssence(value)).toBeNull();
    }
  });

  it("returns null for a comma list, an empty value, a stray quote or a malformed pair", () => {
    for (const value of [
      "text/plain, text/html",
      "text/html,",
      "TEXT/HTML,",
      ",text/html",
      "image/png, image/svg+xml",
      "",
      "   ",
      '"text/html"',
      'text/html"',
      "text",
      "text/",
      "/html",
      "text/html/x",
      "text /html",
      "; charset=utf-8",
    ]) {
      expect(mediaTypeEssence(value)).toBeNull();
    }
  });
});

describe("isMediaTypeToken", () => {
  it("accepts a bare token and refuses one carrying a comma, quote, space or separator", () => {
    expect(isMediaTypeToken("utf-8")).toBe(true);
    expect(isMediaTypeToken("ISO-8859-1")).toBe(true);
    for (const value of ["", "utf-8, text/html", '"utf-8"', "utf 8", "a;b", "a/b"]) {
      expect(isMediaTypeToken(value)).toBe(false);
    }
  });
});

describe("mediaTypeEssence — adversarial input", () => {
  const PARSE_BUDGET_MS = 50;

  function timedEssence(value: string): { essence: string | null; elapsed: number } {
    const started = performance.now();
    const essence = mediaTypeEssence(value);
    return { essence, elapsed: performance.now() - started };
  }

  it("rejects 2,000+ bytes of whitespace-and-semicolon runs ending in an invalid character within the budget", () => {
    for (const value of ["a/b;" + "  ;".repeat(700) + ",", "multipart/form-data;" + " \t ;".repeat(520) + ","]) {
      expect(value.length).toBeGreaterThanOrEqual(2000);
      const { essence, elapsed } = timedEssence(value);
      expect(essence).toBeNull();
      expect(elapsed).toBeLessThan(PARSE_BUDGET_MS);
    }
  });

  it("parses a long quoted string full of escapes within the budget, terminated or not", () => {
    const escapes = '\\"\\\\'.repeat(5000);
    for (const [value, expected] of [
      [`text/plain; x="${escapes}"`, "text/plain"],
      [`text/plain; x="${escapes}`, null],
      [`text/plain; x="${escapes}" ,`, null],
    ] as const) {
      const { essence, elapsed } = timedEssence(value);
      expect(essence).toBe(expected);
      expect(elapsed).toBeLessThan(PARSE_BUDGET_MS);
    }
  });

  it("parses long token runs and long parameter lists within the budget", () => {
    for (const [value, expected] of [
      [`${"a".repeat(10_000)}/${"b".repeat(10_000)}`, `${"a".repeat(10_000)}/${"b".repeat(10_000)}`],
      [`${"a".repeat(10_000)}/${"b".repeat(10_000)},`, null],
      [`text/plain;${" a=b ;".repeat(2000)}`, "text/plain"],
      [`text/plain;${" a=b ;".repeat(2000)},`, null],
    ] as const) {
      const { essence, elapsed } = timedEssence(value);
      expect(essence).toBe(expected);
      expect(elapsed).toBeLessThan(PARSE_BUDGET_MS);
    }
  });
});
