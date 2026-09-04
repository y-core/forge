import { describe, expect, it } from "bun:test";

import { balancedSpan, blankSourceComments } from "./source-scan";

describe("balancedSpan() — the bracket it closes", () => {
  const balanced: { source: string; label: string }[] = [
    { source: "cn(a)", label: "a flat call" },
    { source: "cn(f(g()))", label: "nested calls" },
    { source: `cn("(")`, label: "an unmatched paren inside a double-quoted string" },
    { source: "cn(')')", label: "an unmatched paren inside a single-quoted string" },
    { source: "cn(`(`)", label: "an unmatched paren inside a template" },
    { source: 'cn("\\")")', label: "an escaped quote before a paren" },
    { source: "cn(`${f(')')}`)", label: "a nested call inside an interpolation" },
    { source: "cn(`${{ a: 1 }}`)", label: "a nested brace inside an interpolation" },
    { source: "{ a }", label: "a brace span" },
    { source: '{ cn("}") }', label: "an unmatched brace inside a string" },
  ];

  for (const { source, label } of balanced) {
    it(`closes ${label}: ${source}`, () => {
      expect(balancedSpan(source, source.indexOf(source.startsWith("{") ? "{" : "("))).toBe(source.length - 1);
    });
  }

  const unbalanced: { source: string; open: number; label: string }[] = [
    { source: 'cn("a", "b"', open: 2, label: "a call that never closes" },
    { source: "{ a ", open: 0, label: "a brace that never closes" },
    { source: 'cn("a', open: 2, label: "a string that never closes" },
    { source: "cn(`${a`)", open: 2, label: "an interpolation that never closes" },
  ];

  for (const { source, open, label } of unbalanced) {
    it(`returns -1 for ${label}: ${source}`, () => {
      expect(balancedSpan(source, open)).toBe(-1);
    });
  }

  it("returns -1 when the index names no opening bracket", () => {
    expect(balancedSpan("cn(a)", 0)).toBe(-1);
  });
});

describe("blankSourceComments() — what it blanks", () => {
  it("blanks a block comment", () => {
    expect(blankSourceComments('const a = /* cn("x") */ 1;')).toBe(`const a = ${" ".repeat(13)} 1;`);
  });

  it("blanks a whole-line // comment, indent kept", () => {
    expect(blankSourceComments('  // cn("x")\nconst a = 1;')).toBe("            \nconst a = 1;");
  });

  it("leaves a // inside a string alone", () => {
    expect(blankSourceComments('const u = "https://example.com";')).toBe('const u = "https://example.com";');
  });

  it("blanks a trailing // comment, the code before it kept", () => {
    expect(blankSourceComments("const a = 1; // a note")).toBe(`const a = 1; ${" ".repeat(9)}`);
  });

  it("blanks a trailing comment holding an apostrophe", () => {
    expect(blankSourceComments(`const a = 1; // don't\nconst b = 2;`)).toBe(`const a = 1; ${" ".repeat(8)}\nconst b = 2;`);
  });

  it("blanks a trailing comment holding a URL, its :// included", () => {
    expect(blankSourceComments("const a = 1; // see https://x.test/y")).toBe(`const a = 1; ${" ".repeat(23)}`);
  });

  it("leaves a URL string alone on a line that also carries a trailing comment", () => {
    expect(blankSourceComments('const u = "https://example.com"; // a note')).toBe(`const u = "https://example.com"; ${" ".repeat(9)}`);
  });

  it("reads an apostrophe in JSX text as data, so the comment after it still blanks", () => {
    expect(blankSourceComments("<p>don't</p> // a note")).toBe(`<p>don't</p> ${" ".repeat(9)}`);
  });

  it("preserves every byte offset and the line count", () => {
    const source = 'const a = 1;\n  // a comment\n/* two\n   lines */\nconst b = "x";\n';
    const blanked = blankSourceComments(source);

    expect(blanked.length).toBe(source.length);
    expect(blanked.split("\n").length).toBe(source.split("\n").length);
    expect(blanked.indexOf('const b = "x";')).toBe(source.indexOf('const b = "x";'));
  });
});
