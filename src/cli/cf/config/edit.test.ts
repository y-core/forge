import { describe, expect, it } from "bun:test";

import { applyJsoncEdits } from "./edit";

function apply(src: string, edits: Parameters<typeof applyJsoncEdits>[1]): string {
  const res = applyJsoncEdits(src, edits);
  if (!res.ok) throw new Error(`unexpected refusal: ${res.error.message}`);
  return res.data;
}

function refusal(src: string, edits: Parameters<typeof applyJsoncEdits>[1]): string {
  const res = applyJsoncEdits(src, edits);
  if (res.ok) throw new Error("expected a refusal, got a successful edit");
  return res.error.message;
}

describe("applyJsoncEdits() — replacing an existing value", () => {
  it("replaces a string in place", () => {
    expect(apply(`{"a": "old"}`, [{ path: ["a"], value: "new" }])).toBe(`{"a": "new"}`);
  });

  it("replaces a number without touching its neighbours", () => {
    expect(apply(`{"a": 1, "b": 2}`, [{ path: ["b"], value: 42 }])).toBe(`{"a": 1, "b": 42}`);
  });

  it("replaces inside an array element", () => {
    const src = `{"kv": [{"binding": "A", "id": "old"}]}`;
    expect(apply(src, [{ path: ["kv", 0, "id"], value: "new" }])).toBe(`{"kv": [{"binding": "A", "id": "new"}]}`);
  });

  it("leaves comments untouched when replacing", () => {
    const src = `{\n  // keep me\n  "a": "old" // and me\n}`;
    expect(apply(src, [{ path: ["a"], value: "new" }])).toBe(`{\n  // keep me\n  "a": "new" // and me\n}`);
  });

  it("refuses to overwrite an object with a scalar", () => {
    expect(refusal(`{"a": {"b": 1}}`, [{ path: ["a"], value: "x" }])).toMatch(/refusing to overwrite an object/);
  });

  it("refuses to overwrite an array with a scalar", () => {
    expect(refusal(`{"a": [1]}`, [{ path: ["a"], value: "x" }])).toMatch(/refusing to overwrite an array/);
  });
});

describe("applyJsoncEdits() — inserting a new member", () => {
  it("inserts into a single-line object, keeping it on one line", () => {
    expect(apply(`{"binding": "A"}`, [{ path: ["id"], value: "ns-1" }])).toBe(`{"binding": "A", "id": "ns-1"}`);
  });

  it("inserts into a multi-line object with the sibling's indentation", () => {
    const src = `{\n  "binding": "A"\n}`;
    expect(apply(src, [{ path: ["id"], value: "ns-1" }])).toBe(`{\n  "binding": "A",\n  "id": "ns-1"\n}`);
  });

  it("keeps a trailing comment attached to the member it was written for", () => {
    // The comma lands against the value, before the comment; the new member goes on
    // the next line. Otherwise "// the binding name" would come to describe "id".
    const src = `{\n  "binding": "A" // the binding name\n}`;
    expect(apply(src, [{ path: ["id"], value: "ns-1" }])).toBe(`{\n  "binding": "A", // the binding name\n  "id": "ns-1"\n}`);
  });

  it("does not double an existing trailing comma", () => {
    const src = `{\n  "binding": "A",\n}`;
    expect(apply(src, [{ path: ["id"], value: "ns-1" }])).toBe(`{\n  "binding": "A",\n  "id": "ns-1"\n}`);
  });

  it("preserves deep indentation", () => {
    const src = `{\n  "kv": [\n    {\n      "binding": "A"\n    }\n  ]\n}`;
    expect(apply(src, [{ path: ["kv", 0, "id"], value: "ns-1" }])).toBe(
      `{\n  "kv": [\n    {\n      "binding": "A",\n      "id": "ns-1"\n    }\n  ]\n}`,
    );
  });

  it("preserves CRLF line endings", () => {
    const src = `{\r\n  "binding": "A"\r\n}`;
    expect(apply(src, [{ path: ["id"], value: "ns-1" }])).toBe(`{\r\n  "binding": "A",\r\n  "id": "ns-1"\r\n}`);
  });

  it("handles an empty single-line object", () => {
    expect(apply(`{"a": {}}`, [{ path: ["a", "id"], value: "x" }])).toBe(`{"a": { "id": "x" }}`);
  });

  it("handles an empty multi-line object", () => {
    const src = `{\n  "a": {\n  }\n}`;
    expect(apply(src, [{ path: ["a", "id"], value: "x" }])).toBe(`{\n  "a": {\n    "id": "x"\n  }\n}`);
  });

  it("inserts several members across different objects in one pass", () => {
    const src = `{\n  "kv": [\n    { "binding": "A" },\n    { "binding": "B" }\n  ]\n}`;
    const out = apply(src, [
      { path: ["kv", 0, "id"], value: "one" },
      { path: ["kv", 1, "id"], value: "two" },
    ]);
    expect(out).toBe(`{\n  "kv": [\n    { "binding": "A", "id": "one" },\n    { "binding": "B", "id": "two" }\n  ]\n}`);
  });
});

describe("applyJsoncEdits() — refusals", () => {
  it("returns the source unchanged when there are no edits", () => {
    const src = `{ /* hi */ "a": 1 }`;
    expect(apply(src, [])).toBe(src);
  });

  it("refuses an array index that has no slot", () => {
    expect(refusal(`{"kv": []}`, [{ path: ["kv", 0, "id"], value: "x" }])).toMatch(/no element at index 0/);
  });

  it("refuses a path through a missing intermediate key", () => {
    expect(refusal(`{"a": 1}`, [{ path: ["nope", "deep"], value: "x" }])).toMatch(/no such key: nope/);
  });

  it("refuses when the source does not parse", () => {
    expect(refusal(`{"a": }`, [{ path: ["a"], value: "x" }])).toMatch(/could not parse the config for editing/);
  });

  it("refuses to replace the root", () => {
    expect(refusal(`{"a": 1}`, [{ path: [], value: "x" }])).toMatch(/cannot replace the root value/);
  });
});

describe("applyJsoncEdits() — several new members in one object", () => {
  // d1 writes database_id AND database_name; queues writes queue AND queue_id. Both
  // land in the same entry, so this is an ordinary path, not an edge case.
  it("separates them with commas and keeps the trailing comment with its own member", () => {
    const src = `{\n  "d1": [\n    {\n      "binding": "DB" // the binding\n    }\n  ]\n}`;
    expect(
      apply(src, [
        { path: ["d1", 0, "database_id"], value: "uuid-1" },
        { path: ["d1", 0, "database_name"], value: "PROJ_DB" },
      ]),
    ).toBe(
      `{\n  "d1": [\n    {\n      "binding": "DB", // the binding\n      "database_id": "uuid-1",\n      "database_name": "PROJ_DB"\n    }\n  ]\n}`,
    );
  });

  it("does the same without a comment", () => {
    const src = `{\n  "d1": [\n    {\n      "binding": "DB"\n    }\n  ]\n}`;
    expect(
      apply(src, [
        { path: ["d1", 0, "database_id"], value: "uuid-1" },
        { path: ["d1", 0, "database_name"], value: "PROJ_DB" },
      ]),
    ).toBe(`{\n  "d1": [\n    {\n      "binding": "DB",\n      "database_id": "uuid-1",\n      "database_name": "PROJ_DB"\n    }\n  ]\n}`);
  });

  it("keeps a single-line object on one line", () => {
    expect(
      apply(`{ "binding": "DB" }`, [
        { path: ["database_id"], value: "u" },
        { path: ["database_name"], value: "n" },
      ]),
    ).toBe(`{ "binding": "DB", "database_id": "u", "database_name": "n" }`);
  });

  it("fills an empty object with all of them", () => {
    const src = `{\n  "a": {\n  }\n}`;
    expect(
      apply(src, [
        { path: ["a", "x"], value: 1 },
        { path: ["a", "y"], value: 2 },
      ]),
    ).toBe(`{\n  "a": {\n    "x": 1,\n    "y": 2\n  }\n}`);
  });

  it("combines an insertion and a replacement in the same object", () => {
    const src = `{\n  "binding": "DB",\n  "database_id": "old"\n}`;
    expect(
      apply(src, [
        { path: ["database_id"], value: "new" },
        { path: ["database_name"], value: "n" },
      ]),
    ).toBe(`{\n  "binding": "DB",\n  "database_id": "new",\n  "database_name": "n"\n}`);
  });

  it("preserves CRLF across a multi-member insertion", () => {
    const src = `{\r\n  "binding": "DB"\r\n}`;
    expect(
      apply(src, [
        { path: ["a"], value: 1 },
        { path: ["b"], value: 2 },
      ]),
    ).toBe(`{\r\n  "binding": "DB",\r\n  "a": 1,\r\n  "b": 2\r\n}`);
  });
});
