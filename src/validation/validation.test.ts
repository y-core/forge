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

// Built by assignment, not a literal: `{ __proto__: "x" }` is prototype-setter syntax and produces no own key at all.
function bagWithExtra(extra: string): Record<string, unknown> {
  const body: Record<string, unknown> = Object.create(null);
  body.name = "Jane";
  body[extra] = "sent";
  return body;
}

// Forge routes every form body through `v.strictObject`, so a key valibot cannot see is a field
// that reaches a handler undeclared. Asserted here because it is valibot's promise, not forge's.
describe("v.strictObject — a key colliding with Object.prototype", () => {
  const Schema = v.strictObject({ name: v.string() });
  const INHERITED_NAMES = [
    "__proto__",
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
  ];

  for (const inherited of INHERITED_NAMES) {
    it(`refuses an undeclared ${inherited} as the undeclared key it is`, () => {
      const result = v.safeParse(Schema, bagWithExtra(inherited));
      expect(result.success).toBe(false);
      expect(result.issues?.map((issue) => issue.type)).toEqual(["strict_object"]);
      expect(result.issues?.map((issue) => issue.path?.map((item) => item.key))).toEqual([[inherited]]);
    });
  }

  it("refuses one nested inside v.object, which is the composition a shallow fix would miss", () => {
    const Nested = v.object({ inner: v.strictObject({ name: v.string() }) });
    const result = v.safeParse(Nested, { inner: bagWithExtra("__proto__") });
    expect(result.success).toBe(false);
    expect(result.issues?.map((issue) => issue.path?.map((item) => item.key))).toEqual([["inner", "__proto__"]]);
  });

  it("refuses one behind a v.union of options", () => {
    const Union = v.union([v.strictObject({ name: v.string() }), v.strictObject({ email: v.string() })]);
    expect(v.safeParse(Union, bagWithExtra("valueOf")).success).toBe(false);
  });

  it("accepts an inherited name the schema actually declares", () => {
    const Declared = v.strictObject({ name: v.string(), constructor: v.string() });
    const result = v.safeParse(Declared, bagWithExtra("constructor"));
    expect(result.success && result.output.constructor).toBe("sent");
  });
});
