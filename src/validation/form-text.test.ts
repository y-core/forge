import { describe, expect, it } from "bun:test";
import { formMultilineText, formText } from "./form-text";
import { strictObject } from "./strict-object";
import { v } from "./validation";

/** The parsed output of a text schema, or a thrown failure — so a value case never narrows the union itself. */
function parsed(schema: v.GenericSchema<string, string>, input: unknown): string {
  const result = v.safeParse(schema, input);
  if (!result.success) throw new Error(`expected the schema to accept ${JSON.stringify(input)}`);
  return result.output;
}

/** The issues a text schema raised, or a thrown failure when it accepted the input. */
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

describe("formText", () => {
  const cases: { name: string; input: string; expected: string }[] = [
    { name: "trims leading whitespace", input: "  Jane", expected: "Jane" },
    { name: "trims trailing whitespace", input: "Jane  ", expected: "Jane" },
    { name: "trims both ends", input: "  Jane  ", expected: "Jane" },
    { name: "preserves interior whitespace, including runs of it", input: "  Jane  Q  Public  ", expected: "Jane  Q  Public" },
    { name: "trims tabs", input: "\tJane\t", expected: "Jane" },
    { name: "trims line feeds at the edges", input: "\nJane\n", expected: "Jane" },
    { name: "trims carriage returns at the edges", input: "\rJane\r", expected: "Jane" },
    { name: "trims a mixed run of whitespace at both edges", input: " \t\r\n Jane \r\n\t ", expected: "Jane" },
    { name: "passes the empty string through unchanged", input: "", expected: "" },
    { name: "collapses a whitespace-only value to the empty string", input: "   ", expected: "" },
    { name: "collapses a mixed whitespace-only value to the empty string", input: " \t\r\n ", expected: "" },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(parsed(formText(), c.input)).toBe(c.expected);
    });
  }

  it("makes a composed minLength refuse a whitespace-only value, which is the required-field bypass", () => {
    const RequiredName = v.pipe(formText(), v.minLength(1));
    expect(parsed(formText(), "   ")).toBe("");
    const issues = issuesFor(RequiredName, "   ");
    expect(issues.map((issue) => issue.type)).toEqual(["min_length"]);
    expect(issues.map((issue) => issue.message)).toEqual(["Invalid length: Expected >=1 but received 0"]);
    expect(issues.map((issue) => issue.received)).toEqual(["0"]);
  });

  it("accepts a value that is non-empty after trimming under the same composed minLength", () => {
    expect(parsed(v.pipe(formText(), v.minLength(1)), "  Jane  ")).toBe("Jane");
  });

  const preserved: { name: string; input: string; expected: string }[] = [
    { name: "an interior CRLF pair", input: "a\r\nb", expected: "a\r\nb" },
    { name: "an interior lone carriage return", input: "a\rb", expected: "a\rb" },
    { name: "an interior lone line feed", input: "a\nb", expected: "a\nb" },
    { name: "an interior CRLF while still trimming the edges", input: "  a\r\nb  ", expected: "a\r\nb" },
  ];

  for (const c of preserved) {
    it(`preserves ${c.name}`, () => {
      expect(parsed(formText(), c.input)).toBe(c.expected);
    });
  }

  for (const c of NON_STRINGS) {
    it(`refuses ${c.name} as a type issue`, () => {
      const issues = issuesFor(formText(), c.input);
      expect(issues.map((issue) => issue.type)).toEqual(["string"]);
      expect(issues.map((issue) => issue.message)).toEqual([c.message]);
    });
  }
});

describe("formMultilineText", () => {
  const cases: { name: string; input: string; expected: string }[] = [
    { name: "folds a CRLF pair to a line feed", input: "a\r\nb", expected: "a\nb" },
    { name: "folds consecutive CRLF pairs to consecutive line feeds", input: "a\r\n\r\nb", expected: "a\n\nb" },
    { name: "folds every pair in the value, not just the first", input: "a\r\nb\r\nc", expected: "a\nb\nc" },
    { name: "leaves an interior lone carriage return alone — only the pair folds", input: "a\rb", expected: "a\rb" },
    { name: "leaves an interior lone line feed alone", input: "a\nb", expected: "a\nb" },
    { name: "leaves a reversed LF-CR sequence alone — it is not the pair", input: "a\n\rb", expected: "a\n\rb" },
    { name: "folds and trims together", input: "\r\n  a\r\nb  \r\n", expected: "a\nb" },
    { name: "preserves interior spaces around a folded break", input: "a  \r\n  b", expected: "a  \n  b" },
    { name: "collapses a whitespace-only value that contains a CRLF", input: "   \r\n  ", expected: "" },
    { name: "collapses a CRLF-only value", input: "\r\n", expected: "" },
    { name: "passes the empty string through unchanged", input: "", expected: "" },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(parsed(formMultilineText(), c.input)).toBe(c.expected);
    });
  }

  it("makes a composed minLength refuse a whitespace-only value carrying a CRLF", () => {
    const RequiredMessage = v.pipe(formMultilineText(), v.minLength(1));
    const issues = issuesFor(RequiredMessage, "   \r\n  ");
    expect(issues.map((issue) => issue.type)).toEqual(["min_length"]);
    expect(issues.map((issue) => issue.message)).toEqual(["Invalid length: Expected >=1 but received 0"]);
    expect(issues.map((issue) => issue.received)).toEqual(["0"]);
  });

  it("lets a composed maxLength count a folded break as one character", () => {
    expect(parsed(v.pipe(formMultilineText(), v.maxLength(3)), "a\r\nb")).toBe("a\nb");
  });

  it("refuses the same input under the unfolded formText at the same maxLength", () => {
    const issues = issuesFor(v.pipe(formText(), v.maxLength(3)), "a\r\nb");
    expect(issues.map((issue) => issue.type)).toEqual(["max_length"]);
    expect(issues.map((issue) => issue.message)).toEqual(["Invalid length: Expected <=3 but received 4"]);
    expect(issues.map((issue) => issue.received)).toEqual(["4"]);
  });

  for (const c of NON_STRINGS) {
    it(`refuses ${c.name} as a type issue`, () => {
      const issues = issuesFor(formMultilineText(), c.input);
      expect(issues.map((issue) => issue.type)).toEqual(["string"]);
      expect(issues.map((issue) => issue.message)).toEqual([c.message]);
    });
  }
});

describe("form text primitives — composition", () => {
  it("parses a strictObject of both primitives to plain strings", () => {
    const ContactSchema = strictObject({ name: formText(), message: formMultilineText() });
    const result = v.safeParse(ContactSchema, body({ name: "  Jane  ", message: "  first\r\nsecond  " }));
    if (!result.success) throw new Error("expected the contact schema to accept this body");
    const name: string = result.output.name;
    const message: string = result.output.message;
    expect(name).toBe("Jane");
    expect(message).toBe("first\nsecond");
  });

  it("reports the failing field by name when a strictObject field refuses its value", () => {
    const ContactSchema = strictObject({ name: formText() });
    const issues = issuesFor(ContactSchema.entries.name, 42);
    expect(issues.map((issue) => issue.type)).toEqual(["string"]);
    const nested = v.safeParse(ContactSchema, body({ name: 42 }));
    expect(nested.success).toBe(false);
    expect(!nested.success && nested.issues.map((issue) => issue.path?.map((item) => item.key))).toEqual([["name"]]);
  });

  it("trims through v.optional when the value is present", () => {
    expect(v.safeParse(v.optional(formText()), "  Jane  ")).toEqual({ typed: true, success: true, output: "Jane", issues: undefined });
  });

  it("passes undefined through v.optional untouched", () => {
    expect(v.safeParse(v.optional(formText()), undefined)).toEqual({ typed: true, success: true, output: undefined, issues: undefined });
  });

  it("trims every element through v.array, including one that collapses to empty", () => {
    expect(v.safeParse(v.array(formText()), ["  a", "b  ", "  "])).toEqual({
      typed: true,
      success: true,
      output: ["a", "b", ""],
      issues: undefined,
    });
  });

  it("folds every element through v.array of the multiline variant", () => {
    expect(v.safeParse(v.array(formMultilineText()), ["a\r\nb", "  c\r\n  "])).toEqual({
      typed: true,
      success: true,
      output: ["a\nb", "c"],
      issues: undefined,
    });
  });
});

describe("form text primitives — the shapes the reader hands through", () => {
  const file = new File(["  resume  "], "cv.txt", { type: "text/plain" });

  it("refuses a File on a key rather than coercing it", () => {
    const TextOnKey = strictObject({ attachment: formText() });
    const issues = issuesFor(TextOnKey.entries.attachment, file);
    expect(issues.map((issue) => issue.type)).toEqual(["string"]);
    expect(issues.map((issue) => issue.message)).toEqual(["Invalid type: Expected string but received Blob"]);
    const result = v.safeParse(TextOnKey, body({ attachment: file }));
    expect(!result.success && result.issues.map((issue) => issue.path?.map((item) => item.key))).toEqual([["attachment"]]);
  });

  it("lets a File-accepting schema on that same key succeed with the File intact", () => {
    const UploadSchema = strictObject({ attachment: v.instance(File) });
    const result = v.safeParse(UploadSchema, body({ attachment: file }));
    expect(result.success).toBe(true);
    expect(result.success && result.output.attachment).toBe(file);
    expect(result.success && result.output.attachment.name).toBe("cv.txt");
  });

  it("refuses a repeated key's array on a scalar text field", () => {
    const TagOnKey = strictObject({ tag: formText() });
    const result = v.safeParse(TagOnKey, body({ tag: ["a ", " b"] }));
    expect(!result.success && result.issues.map((issue) => issue.type)).toEqual(["string"]);
    expect(!result.success && result.issues.map((issue) => issue.message)).toEqual(["Invalid type: Expected string but received Array"]);
    expect(!result.success && result.issues.map((issue) => issue.path?.map((item) => item.key))).toEqual([["tag"]]);
  });

  it("accepts the same repeated key when the schema declares v.array, trimming each element", () => {
    const TagsSchema = strictObject({ tag: v.array(formText()) });
    expect(v.safeParse(TagsSchema, body({ tag: ["a ", " b"] }))).toEqual({
      typed: true,
      success: true,
      output: { tag: ["a", "b"] },
      issues: undefined,
    });
  });

  it("leaves an absent optional field absent — the primitive does not resurrect the absence collapse", () => {
    const NoteSchema = strictObject({ note: v.optional(formText()) });
    const result = v.safeParse(NoteSchema, body({}));
    expect(result.success).toBe(true);
    expect(result.success && Object.hasOwn(result.output, "note")).toBe(false);
    expect(result.success && Object.keys(result.output)).toEqual([]);
  });

  it("trims that same optional field when the caller did send it", () => {
    const NoteSchema = strictObject({ note: v.optional(formText()) });
    expect(v.safeParse(NoteSchema, body({ note: "  hi  " }))).toEqual({ typed: true, success: true, output: { note: "hi" }, issues: undefined });
  });
});
