import { describe, expect, it } from "bun:test";
import { formatValidationIssues } from "./format-issues";
import { v } from "./validation";

function issuesFor(schema: v.GenericSchema, input: unknown): v.BaseIssue<unknown>[] {
  const result = v.safeParse(schema, input);
  if (result.success) throw new Error("expected schema to fail for this input");
  return [...result.issues];
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
});
