import { describe, expect, it } from "bun:test";

import { formDigits } from "./form-digits";
import { formText } from "./form-text";
import { strictObject } from "./strict-object";
import { v } from "./validation";

/** The parsed output of a digit schema, or a thrown failure — so a value case never narrows the union itself. */
function parsed(schema: v.GenericSchema<string, string>, input: unknown): string {
  const result = v.safeParse(schema, input);
  if (!result.success) throw new Error(`expected the schema to accept ${JSON.stringify(input)}`);
  return result.output;
}

/** The issues a digit schema raised, or a thrown failure when it accepted the input. */
function issuesFor(schema: v.GenericSchema<string, string>, input: unknown): v.BaseIssue<unknown>[] {
  const result = v.safeParse(schema, input);
  if (result.success) throw new Error(`expected the schema to refuse ${JSON.stringify(input)}`);
  return [...result.issues];
}

/** A prototype-less body bag, which is what `formToObject` hands a schema. */
function body(entries: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const bag: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(entries)) bag[key] = entries[key];
  return bag;
}

/** Every non-string a form reader can actually hand a schema, with the message valibot builds for it. */
const NON_STRINGS: { name: string; input: unknown; message: string }[] = [
  { name: "a number", input: 42, message: "Invalid type: Expected string but received 42" },
  { name: "null", input: null, message: "Invalid type: Expected string but received null" },
  { name: "a boolean", input: true, message: "Invalid type: Expected string but received true" },
  { name: "undefined", input: undefined, message: "Invalid type: Expected string but received undefined" },
  { name: "a plain object", input: {}, message: "Invalid type: Expected string but received Object" },
  { name: "an array", input: [], message: "Invalid type: Expected string but received Array" },
  { name: "a File", input: new File(["x"], "cv.txt"), message: "Invalid type: Expected string but received Blob" },
];

/** Every value case, reused by the idempotence loop. */
const CASES: { name: string; input: string; expected: string }[] = [
  { name: "passes a bare run of digits through unchanged", input: "4111111111111111", expected: "4111111111111111" },
  { name: "removes the spaces grouping a card number", input: "4111 1111 1111 1111", expected: "4111111111111111" },
  { name: "removes parentheses, a space and a hyphen from a phone number", input: "(555) 123-4567", expected: "5551234567" },
  { name: "removes dots from a phone number", input: "555.123.4567", expected: "5551234567" },
  { name: "removes whitespace at both edges", input: "  5551234567  ", expected: "5551234567" },
  { name: "removes an interior tab", input: "555\t1234567", expected: "5551234567" },
  { name: "removes an interior CRLF pair", input: "555\r\n1234567", expected: "5551234567" },
  { name: "discards a leading plus, so a dialling code loses its sign", input: "+44 20 7946", expected: "44207946" },
  { name: "discards letters, keeping only the digits around them", input: "555-CALL", expected: "555" },
  { name: "discards a non-ASCII digit rather than accepting it", input: "٥55", expected: "55" },
  { name: "passes the empty string through unchanged", input: "", expected: "" },
  { name: "collapses a whitespace-only value to the empty string", input: "   ", expected: "" },
  { name: "collapses a separators-only value to the empty string", input: "( ) -", expected: "" },
];

describe("formDigits", () => {
  for (const c of CASES) {
    it(c.name, () => {
      expect(parsed(formDigits(), c.input)).toBe(c.expected);
    });
  }

  const RENDERINGS: { name: string; input: string }[] = [
    { name: "bare", input: "5551234567" },
    { name: "hyphenated", input: "555-123-4567" },
    { name: "dotted", input: "555.123.4567" },
    { name: "parenthesised", input: "(555) 123-4567" },
    { name: "spaced", input: "555 123 4567" },
    { name: "spaced with a dialling code stripped of its plus", input: "555 1234 567" },
    { name: "padded at both edges", input: "  555 123 4567  " },
  ];

  for (const c of RENDERINGS) {
    it(`reduces the ${c.name} rendering of one number to the same digits`, () => {
      expect(parsed(formDigits(), c.input)).toBe("5551234567");
    });
  }

  for (const c of CASES) {
    it(`is idempotent for the case that ${c.name}`, () => {
      const once = parsed(formDigits(), c.input);
      expect(parsed(formDigits(), once)).toBe(once);
    });
  }

  it("makes a composed minLength refuse a separators-only value, which is the required-field bypass", () => {
    const RequiredCard = v.pipe(formDigits(), v.minLength(1));
    expect(parsed(formDigits(), "( ) -")).toBe("");
    const issues = issuesFor(RequiredCard, "( ) -");
    expect(issues.map((issue) => issue.type)).toEqual(["min_length"]);
    expect(issues.map((issue) => issue.message)).toEqual(["Invalid length: Expected >=1 but received 0"]);
    expect(issues.map((issue) => issue.received)).toEqual(["0"]);
  });

  it("accepts a value that carries one digit among separators under the same composed minLength", () => {
    expect(parsed(v.pipe(formDigits(), v.minLength(1)), "( 5 ) -")).toBe("5");
  });

  it("lets a composed maxLength count only the digits, not the separators", () => {
    expect(parsed(v.pipe(formDigits(), v.maxLength(10)), "(555) 123-4567")).toBe("5551234567");
  });

  it("refuses the same input under the separator-preserving formText at the same maxLength", () => {
    const issues = issuesFor(v.pipe(formText(), v.maxLength(10)), "(555) 123-4567");
    expect(issues.map((issue) => issue.type)).toEqual(["max_length"]);
    expect(issues.map((issue) => issue.message)).toEqual(["Invalid length: Expected <=10 but received 14"]);
    expect(issues.map((issue) => issue.received)).toEqual(["14"]);
  });

  for (const c of NON_STRINGS) {
    it(`refuses ${c.name} as a type issue`, () => {
      const issues = issuesFor(formDigits(), c.input);
      expect(issues.map((issue) => issue.type)).toEqual(["string"]);
      expect(issues.map((issue) => issue.message)).toEqual([c.message]);
    });
  }
});

describe("formDigits — composition", () => {
  it("parses a strictObject of the digit primitive to a plain string", () => {
    const PaymentSchema = strictObject({ card: v.pipe(formDigits(), v.length(16)) });
    const result = v.safeParse(PaymentSchema, body({ card: "4111 1111 1111 1111" }));
    if (!result.success) throw new Error("expected the payment schema to accept this body");
    const card: string = result.output.card;
    expect(card).toBe("4111111111111111");
  });

  it("reports the failing field by name when a strictObject field refuses its value", () => {
    const PaymentSchema = strictObject({ card: formDigits() });
    const issues = issuesFor(PaymentSchema.entries.card, 42);
    expect(issues.map((issue) => issue.type)).toEqual(["string"]);
    const nested = v.safeParse(PaymentSchema, body({ card: 42 }));
    expect(nested.success).toBe(false);
    expect(!nested.success && nested.issues.map((issue) => issue.path?.map((item) => item.key))).toEqual([["card"]]);
  });

  it("strips through v.optional when the value is present", () => {
    expect(v.safeParse(v.optional(formDigits()), "(555) 123-4567")).toEqual({
      typed: true,
      success: true,
      output: "5551234567",
      issues: undefined,
    });
  });

  it("passes undefined through v.optional untouched", () => {
    expect(v.safeParse(v.optional(formDigits()), undefined)).toEqual({ typed: true, success: true, output: undefined, issues: undefined });
  });

  it("leaves an absent optional field absent", () => {
    const PhoneSchema = strictObject({ phone: v.optional(formDigits()) });
    const result = v.safeParse(PhoneSchema, body({}));
    expect(result.success).toBe(true);
    expect(result.success && Object.hasOwn(result.output, "phone")).toBe(false);
    expect(result.success && Object.keys(result.output)).toEqual([]);
  });

  it("strips every element through v.array, including one that collapses to empty", () => {
    expect(v.safeParse(v.array(formDigits()), ["555-1234", " 99 ", "( ) -"])).toEqual({
      typed: true,
      success: true,
      output: ["5551234", "99", ""],
      issues: undefined,
    });
  });
});
