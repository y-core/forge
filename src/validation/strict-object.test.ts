import { describe, expect, it } from "bun:test";
import { strictObject } from "./strict-object";
import { v } from "./validation";

// Built by assignment, not a literal: `{ __proto__: "x" }` is prototype-setter syntax and produces no own key at all.
function bag(keys: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const body: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(keys)) body[key] = keys[key];
  return body;
}

function bagWithExtra(extra: string): Record<string, unknown> {
  const body: Record<string, unknown> = Object.create(null);
  body.name = "Jane";
  body[extra] = "sent";
  return body;
}

function issuesFor(schema: v.GenericSchema, input: unknown): v.BaseIssue<unknown>[] {
  const result = v.safeParse(schema, input);
  if (result.success) throw new Error("expected schema to refuse this input");
  return [...result.issues];
}

const NameSchema = strictObject({ name: v.string() });

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

describe("strictObject", () => {
  it("accepts input matching its declared entries", () => {
    expect(v.safeParse(NameSchema, bag({ name: "Jane" }))).toEqual({ typed: true, success: true, output: { name: "Jane" }, issues: undefined });
  });

  it("refuses an ordinary undeclared key exactly as v.strictObject does", () => {
    const issues = issuesFor(NameSchema, bagWithExtra("nobody_asked"));
    expect(issues.map((issue) => issue.type)).toEqual(["strict_object"]);
    expect(issues.map((issue) => issue.message)).toEqual(['Invalid key: Expected never but received "nobody_asked"']);
  });

  it("refuses a declared field of the wrong type with the field's own issue", () => {
    expect(issuesFor(NameSchema, bag({ name: 42 })).map((issue) => issue.type)).toEqual(["string"]);
  });

  it("forwards a custom message to v.strictObject", () => {
    const Schema = strictObject({ name: v.string() }, "no extra fields allowed");
    expect(issuesFor(Schema, bagWithExtra("zzz")).map((issue) => issue.message)).toEqual(["no extra fields allowed"]);
  });

  it("preserves entry declaration order, which is what names a field in a guard refusal", () => {
    expect(Object.keys(strictObject({ zeta: v.string(), alpha: v.string() }).entries)).toEqual(["zeta", "alpha"]);
  });

  for (const inherited of INHERITED_NAMES) {
    it(`refuses an undeclared ${inherited} as the undeclared key it is`, () => {
      const issues = issuesFor(NameSchema, bagWithExtra(inherited));
      expect(issues.map((issue) => issue.type)).toEqual(["strict_object"]);
      expect(issues.map((issue) => issue.path?.map((item) => item.key))).toEqual([[inherited]]);
      expect(issues.map((issue) => issue.message)).toEqual([`Invalid key: Expected never but received "${inherited}"`]);
    });

    it(`lets v.strictObject silently drop an undeclared ${inherited}, which is what this wrapper exists to fix`, () => {
      const result = v.safeParse(v.strictObject({ name: v.string() }), bagWithExtra(inherited));
      expect(result.success).toBe(true);
      expect(result.success && Object.keys(result.output)).toEqual(["name"]);
    });
  }

  it("accepts an inherited name the schema actually declares", () => {
    const Schema = strictObject({ name: v.string(), constructor: v.string() });
    const result = v.safeParse(Schema, bag({ name: "Jane", constructor: "Acme Builders" }));
    expect(result.success && result.output.constructor).toBe("Acme Builders");
  });

  it("reports a declared inherited name as absent when the caller did not send it", () => {
    const Schema = strictObject({ name: v.string(), constructor: v.string() });
    const issues = issuesFor(Schema, bag({ name: "Jane" }));
    expect(issues.map((issue) => issue.message)).toEqual(['Invalid key: Expected "constructor" but received undefined']);
  });

  it("satisfies v.optional on a declared inherited name by omission", () => {
    const Schema = strictObject({ name: v.string(), constructor: v.optional(v.string()) });
    const result = v.safeParse(Schema, bag({ name: "Jane" }));
    expect(result.success).toBe(true);
    expect(result.success && Object.hasOwn(result.output, "constructor")).toBe(false);
    expect(result.success && Object.keys(result.output)).toEqual(["name"]);
  });
});

describe("strictObject — survives composition", () => {
  it("refuses an inherited name while nested inside v.object", () => {
    const Schema = v.object({ inner: strictObject({ name: v.string() }) });
    const issues = issuesFor(Schema, { inner: bagWithExtra("__proto__") });
    expect(issues.map((issue) => issue.type)).toEqual(["strict_object"]);
    expect(issues.map((issue) => issue.path?.map((item) => item.key))).toEqual([["inner", "__proto__"]]);
  });

  it("refuses an inherited name behind v.pipe", () => {
    const Schema = v.pipe(
      strictObject({ name: v.string() }),
      v.transform((data) => data),
    );
    expect(issuesFor(Schema, bagWithExtra("toString")).map((issue) => issue.type)).toEqual(["strict_object"]);
  });

  it("keeps the entries bag readable through v.pipe, so a piped schema can still name its first field", () => {
    const Schema = v.pipe(
      strictObject({ name: v.string() }),
      v.transform((data) => data),
    );
    expect(Object.keys(Schema.entries)).toEqual(["name"]);
  });

  it("refuses an inherited name as a v.union option", () => {
    const Schema = v.union([strictObject({ name: v.string() }), strictObject({ email: v.string() })]);
    expect(issuesFor(Schema, bagWithExtra("valueOf")).map((issue) => issue.type)).toEqual(["union"]);
  });

  it("refuses an inherited name as a v.variant option", () => {
    const Schema = v.variant("kind", [strictObject({ kind: v.literal("contact"), name: v.string() })]);
    const input = bag({ kind: "contact", name: "Jane", constructor: "sent" });
    expect(issuesFor(Schema, input).map((issue) => issue.type)).toEqual(["strict_object"]);
  });

  it("lets a nested v.strictObject drop the same key, which is the composition a patch would miss", () => {
    const Schema = v.object({ inner: v.strictObject({ name: v.string() }) });
    const result = v.safeParse(Schema, { inner: bagWithExtra("__proto__") });
    expect(result.success).toBe(true);
    expect(result.success && Object.keys(result.output.inner)).toEqual(["name"]);
  });

  it("lets a v.union of v.strictObject options accept the same key", () => {
    const Schema = v.union([v.strictObject({ name: v.string() }), v.strictObject({ email: v.string() })]);
    expect(v.safeParse(Schema, bagWithExtra("valueOf")).success).toBe(true);
  });
});
