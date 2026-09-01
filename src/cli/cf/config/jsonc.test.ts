import { describe, expect, it } from "bun:test";

import { countComments, findMember, parseJsoncTree, skipTrivia, stripJsonc } from "./jsonc";

describe("skipTrivia()", () => {
  it("skips whitespace", () => {
    expect(skipTrivia("   x", 0)).toBe(3);
  });

  it("skips line comments", () => {
    const src = "// note\nx";
    expect(src[skipTrivia(src, 0)]).toBe("x");
  });

  it("skips block comments, including multi-line ones", () => {
    const src = "/* a\n b */ x";
    expect(src[skipTrivia(src, 0)]).toBe("x");
  });

  it("skips a run of mixed trivia", () => {
    const src = "  // one\n  /* two */  x";
    expect(src[skipTrivia(src, 0)]).toBe("x");
  });
});

describe("stripJsonc() — trailing commas are token-aware", () => {
  it("does not corrupt a comma inside a string value", () => {
    // The previous regex-based pass rewrote this to {"a": "x }"} — silently, and
    // only for strings that happened to contain a comma before a brace.
    const src = `{"a": "x, }"}`;
    expect(JSON.parse(stripJsonc(src)).a).toBe("x, }");
  });

  it("does not corrupt a comma-bracket sequence inside a string", () => {
    const src = `{"a": "trailing, ] here"}`;
    expect(JSON.parse(stripJsonc(src)).a).toBe("trailing, ] here");
  });

  it("still removes a real trailing comma separated by a comment", () => {
    const src = `{"a": 1, // note\n}`;
    expect(JSON.parse(stripJsonc(src))).toEqual({ a: 1 });
  });
});

describe("parseJsoncTree()", () => {
  it("locates a member's key and value spans", () => {
    const src = `{"a": "v"}`;
    const tree = parseJsoncTree(src);
    expect(tree.ok).toBe(true);
    if (!tree.ok) return;
    const member = findMember(tree.data, "a");
    expect(src.slice(member!.keyStart, member!.keyEnd)).toBe(`"a"`);
    expect(src.slice(member!.value.start, member!.value.end)).toBe(`"v"`);
  });

  it("locates spans past comments and odd whitespace", () => {
    const src = `{\n  // note\n  "a"  :  42 // trailing\n}`;
    const tree = parseJsoncTree(src);
    if (!tree.ok) throw new Error(tree.error.message);
    const member = findMember(tree.data, "a")!;
    expect(src.slice(member.value.start, member.value.end)).toBe("42");
    expect(member.value.kind).toBe("number");
  });

  it("does not mistake a brace inside a string for structure", () => {
    const src = `{"a": "https://x.test/{}", "b": 1}`;
    const tree = parseJsoncTree(src);
    if (!tree.ok) throw new Error(tree.error.message);
    expect(tree.data.kind).toBe("object");
    expect(findMember(tree.data, "b")).toBeDefined();
  });

  it("parses arrays and records element spans", () => {
    const src = `{"kv": [{"binding": "A"}]}`;
    const tree = parseJsoncTree(src);
    if (!tree.ok) throw new Error(tree.error.message);
    const kv = findMember(tree.data, "kv")!;
    expect(kv.value.kind).toBe("array");
    if (kv.value.kind !== "array") return;
    expect(src.slice(kv.value.elements[0]?.start, kv.value.elements[0]?.end)).toBe(`{"binding": "A"}`);
  });

  it("tolerates trailing commas", () => {
    const tree = parseJsoncTree(`{"a": 1,}`);
    expect(tree.ok).toBe(true);
  });

  it("reports the offset of a syntax error", () => {
    const tree = parseJsoncTree(`{"a": }`);
    expect(tree.ok).toBe(false);
    if (tree.ok) return;
    expect(tree.error.offset).toBeGreaterThan(0);
  });

  it("rejects trailing content after the root value", () => {
    const tree = parseJsoncTree(`{"a": 1} garbage`);
    expect(tree.ok).toBe(false);
  });

  it("agrees with JSON.parse on every value in a realistic config", () => {
    const src = `{\n  // a comment with https:// in it\n  "name": "cornellaw",\n  "url": "https://x.test", // trailing\n  "n": [1, 2,],\n}`;
    const tree = parseJsoncTree(src);
    expect(tree.ok).toBe(true);
    expect(JSON.parse(stripJsonc(src))).toEqual({ name: "cornellaw", url: "https://x.test", n: [1, 2] });
  });
});

describe("countComments()", () => {
  it("counts line and block comments", () => {
    expect(countComments(`{\n// one\n/* two */ "a": 1 // three\n}`)).toBe(3);
  });

  it("does not count // inside a string", () => {
    expect(countComments(`{"url": "https://example.com"}`)).toBe(0);
  });

  it("returns zero for plain JSON", () => {
    expect(countComments(`{"a": 1}`)).toBe(0);
  });
});
