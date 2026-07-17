import { describe, expect, it } from "bun:test";
import { v } from "./validation";

describe("v (valibot facade)", () => {
  it("exposes the core valibot surface as callables", () => {
    expect(typeof v.string).toBe("function");
    expect(typeof v.object).toBe("function");
    expect(typeof v.parse).toBe("function");
    expect(typeof v.safeParse).toBe("function");
  });

  it("round-trips a small schema through parse", () => {
    const schema = v.object({ name: v.string() });
    expect(v.parse(schema, { name: "forge" })).toEqual({ name: "forge" });
  });

  it("reports failure via safeParse for invalid input", () => {
    const schema = v.object({ name: v.string() });
    const result = v.safeParse(schema, { name: 123 });
    expect(result.success).toBe(false);
  });
});
