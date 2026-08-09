import { describe, expect, it } from "bun:test";
import { describeValidationField, describeValidationIssue, formatValidationIssues } from "./format-issues";
import { strictObject } from "./strict-object";
import { v } from "./validation";

function issuesFor(schema: v.GenericSchema, input: unknown, config?: v.Config<v.BaseIssue<unknown>>): v.BaseIssue<unknown>[] {
  const result = v.safeParse(schema, input, config);
  if (result.success) throw new Error("expected schema to fail for this input");
  return [...result.issues];
}

function firstIssue(schema: v.GenericSchema, input: unknown): v.BaseIssue<unknown> {
  const [issue] = issuesFor(schema, input, { abortEarly: true });
  if (issue === undefined) throw new Error("expected at least one issue");
  return issue;
}

describe("formatValidationIssues", () => {
  const cases: { name: string; schema: v.GenericSchema; input: unknown; expected: string }[] = [
    {
      name: "single issue with a path",
      schema: v.object({ name: v.string("name must be a string") }),
      input: { name: 42 },
      expected: "name: name must be a string",
    },
    {
      name: "multiple issues joined with semicolons",
      schema: v.object({ a: v.string("bad a"), b: v.string("bad b") }),
      input: { a: 1, b: 2 },
      expected: "a: bad a; b: bad b",
    },
    { name: "root label for a pathless issue", schema: v.string("must be a string"), input: 42, expected: "root: must be a string" },
    {
      name: "nested path joined with dots",
      schema: v.object({ outer: v.object({ inner: v.string("bad inner") }) }),
      input: { outer: { inner: 1 } },
      expected: "outer.inner: bad inner",
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(formatValidationIssues(issuesFor(c.schema, c.input))).toBe(c.expected);
    });
  }

  it("returns an empty string for an empty issue list", () => {
    expect(formatValidationIssues([])).toBe("");
  });

  it("still reproduces the rejected value verbatim, which is why it is the internal diagnostic", () => {
    // `parseEnv` builds `Invalid environment: <this>`, and that shape is depended on by
    // `src/validation/parse-env.test.ts`, `src/context/env-validation.test.ts`,
    // `src/config/config.test.ts` and `src/app/app.test.ts`. It must not acquire
    // `describeValidationIssue`'s bounds — an operator reading a startup crash needs the value.
    expect(formatValidationIssues(issuesFor(v.object({ port: v.string() }), { port: 8080 }))).toBe(
      "port: Invalid type: Expected string but received 8080",
    );
  });

  it("reproduces an undeclared key and its message in full, unlike the caller-facing describer", () => {
    const issues = issuesFor(strictObject({ name: v.string() }), { name: "Jane", nobody_asked: "1" });
    expect(formatValidationIssues(issues)).toBe('nobody_asked: Invalid key: Expected never but received "nobody_asked"');
    expect(issues.map(describeValidationIssue)).toEqual(["nobody_asked"]);
  });
});

/**
 * The caller-facing describer. Its whole contract is subtractive — the field name survives, bounded,
 * and nothing else does — so the cases worth writing are the ones that prove what is *not* there.
 */
describe("describeValidationIssue", () => {
  it("names a single failing field", () => {
    expect(describeValidationIssue(firstIssue(v.object({ email: v.string() }), { email: 42 }))).toBe("email");
  });

  it("joins a nested path with dots", () => {
    expect(describeValidationIssue(firstIssue(v.object({ outer: v.object({ inner: v.string() }) }), { outer: { inner: 1 } }))).toBe("outer.inner");
  });

  it("falls back to fixed generic wording for an issue with no path", () => {
    expect(describeValidationIssue(firstIssue(v.string(), 42))).toBe("the submitted form");
  });

  it("falls back to the same wording when a path item's key names nothing a caller can act on", () => {
    // A set path item carries `key: null`. Anything that is not a string or a number contributes no
    // segment, rather than a stringified placeholder — and nothing here can run a hostile `toString`.
    expect(describeValidationIssue(firstIssue(v.set(v.string()), new Set([1])))).toBe("the submitted form");
  });

  it("keeps a numeric array index as a segment", () => {
    expect(describeValidationIssue(firstIssue(v.object({ tag: v.array(v.string()) }), { tag: ["a", 2] }))).toBe("tag.1");
  });

  it("stops at three segments for a path deeper than that", () => {
    const Deep = v.object({ a: v.object({ b: v.object({ c: v.object({ d: v.string() }) }) }) });
    expect(describeValidationIssue(firstIssue(Deep, { a: { b: { c: { d: 1 } } } }))).toBe("a.b.c");
  });

  it("truncates a caller-supplied v.record key to forty characters", () => {
    const key = "q".repeat(200);
    const described = describeValidationIssue(firstIssue(v.record(v.string(), v.pipe(v.string(), v.minLength(5))), { [key]: "x" }));
    expect(described).toBe("q".repeat(40));
    expect(described.length).toBe(40);
  });

  it("truncates the undeclared key a strict schema refused", () => {
    const key = "z".repeat(120);
    expect(describeValidationIssue(firstIssue(strictObject({ name: v.string() }), { name: "Jane", [key]: "1" }))).toBe("z".repeat(40));
  });

  it("reproduces neither the submitted value nor the schema's own pattern", () => {
    const issue = firstIssue(strictObject({ password: v.pipe(v.string(), v.regex(/^(?=.*[A-Z]).{12,}$/)) }), { password: "hunter2secret" });

    // The message valibot built carries both, which is the disclosure being bounded out.
    expect(issue.message).toBe('Invalid format: Expected /^(?=.*[A-Z]).{12,}$/ but received "hunter2secret"');
    expect(describeValidationIssue(issue)).toBe("password");
  });

  it("describes a 50,000-character value and a 5-character one identically", () => {
    const Schema = strictObject({ email: v.pipe(v.string(), v.email()) });
    expect(describeValidationIssue(firstIssue(Schema, { email: "z".repeat(50_000) }))).toBe(
      describeValidationIssue(firstIssue(Schema, { email: "z" })),
    );
  });
});

describe("describeValidationField", () => {
  const cases: { name: string; path: string[]; expected: string }[] = [
    { name: "empty path", path: [], expected: "the submitted form" },
    { name: "one segment", path: ["email"], expected: "email" },
    { name: "three segments", path: ["a", "b", "c"], expected: "a.b.c" },
    { name: "four segments truncated to three", path: ["a", "b", "c", "d"], expected: "a.b.c" },
    { name: "ten segments truncated to three", path: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"], expected: "a.b.c" },
    { name: "a segment at the cap is kept whole", path: ["x".repeat(40)], expected: "x".repeat(40) },
    { name: "a segment over the cap is cut to forty", path: ["x".repeat(41)], expected: "x".repeat(40) },
    { name: "every segment is bounded independently", path: ["x".repeat(100), "y".repeat(100)], expected: `${"x".repeat(40)}.${"y".repeat(40)}` },
    { name: "an empty segment contributes an empty name rather than the fallback", path: [""], expected: "" },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(describeValidationField(c.path)).toBe(c.expected);
    });
  }

  it("bounds the whole description at three segments of forty characters plus two separators", () => {
    expect(describeValidationField(["x".repeat(999), "y".repeat(999), "z".repeat(999), "w".repeat(999)]).length).toBe(122);
  });
});
