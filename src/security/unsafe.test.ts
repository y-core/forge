import { describe, expect, it } from "bun:test";

import * as securityMod from "./mod";
import { UNSAFE_CSP_SOURCES, UNSAFE_EVAL, UNSAFE_HASHES, UNSAFE_INLINE, WASM_UNSAFE_EVAL } from "./unsafe";

describe("unsafe CSP source placeholders", () => {
  it("are symbols carrying their documented description", () => {
    expect(UNSAFE_INLINE.description).toBe("@y-core/forge/csp-unsafe-inline");
    expect(UNSAFE_EVAL.description).toBe("@y-core/forge/csp-unsafe-eval");
    expect(UNSAFE_HASHES.description).toBe("@y-core/forge/csp-unsafe-hashes");
    expect(WASM_UNSAFE_EVAL.description).toBe("@y-core/forge/csp-wasm-unsafe-eval");
  });

  it("are not interned, so no string can reconstruct one", () => {
    for (const { placeholder } of UNSAFE_CSP_SOURCES) {
      expect(typeof placeholder).toBe("symbol");
      expect(Symbol.keyFor(placeholder)).toBeUndefined();
    }
  });
});

describe("UNSAFE_CSP_SOURCES", () => {
  it("covers the four placeholders exactly once each", () => {
    expect(UNSAFE_CSP_SOURCES.map((s) => s.placeholder)).toEqual([UNSAFE_INLINE, UNSAFE_EVAL, UNSAFE_HASHES, WASM_UNSAFE_EVAL]);
  });

  it("is unique by placeholder and by token", () => {
    expect(new Set(UNSAFE_CSP_SOURCES.map((s) => s.placeholder)).size).toBe(UNSAFE_CSP_SOURCES.length);
    expect(new Set(UNSAFE_CSP_SOURCES.map((s) => s.token)).size).toBe(UNSAFE_CSP_SOURCES.length);
  });

  it("names tokens that are lowercase, quoted CSP keywords", () => {
    for (const { token } of UNSAFE_CSP_SOURCES) {
      expect(token).toBe(token.toLowerCase());
      expect(token).toMatch(/^'[a-z-]+'$/);
    }
  });

  it("names an exportName that the namespace barrel actually exports as that placeholder", () => {
    for (const { placeholder, exportName } of UNSAFE_CSP_SOURCES) {
      expect(Object.hasOwn(securityMod, exportName)).toBe(true);
      expect((securityMod as unknown as Record<string, symbol>)[exportName]).toBe(placeholder);
    }
  });
});
