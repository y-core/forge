import { beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  balancedSpan,
  blankComments,
  blankSourceComments,
  collectFiles,
  collectSource,
  excludedBy,
  isTestSource,
  listDirectories,
  listFiles,
  resolveSources,
  unresolvedSourceEntries,
} from "./source-scan";

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

describe("blankComments() — block comments only", () => {
  it("replaces the comment body with spaces and keeps the length", () => {
    expect(blankComments("a /* hi */ b")).toBe("a          b");
  });

  it("keeps the newlines inside a multi-line comment", () => {
    expect(blankComments("a\n/* one\ntwo */\nb").split("\n")).toEqual(["a", "      ", "      ", "b"]);
  });

  it("leaves a // alone, which is not a comment in CSS", () => {
    expect(blankComments('.a { background: url("//cdn.test/x.png"); }')).toBe('.a { background: url("//cdn.test/x.png"); }');
  });

  it("leaves a /* inside a CSS string alone", () => {
    expect(blankComments('.a::after { content: "/*"; color: red; }')).toBe('.a::after { content: "/*"; color: red; }');
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

  it("leaves a /* inside a string alone, so the code after it survives", () => {
    const source = 'const a = "/* opener";\nconst b = "closer */";\nconst c = 1;';

    expect(blankSourceComments(source)).toBe(source);
  });

  it("blanks the real comment that follows a /*-bearing string literal", () => {
    const source = 'const a = "/* opener";\n/* gone */\nconst c = 1;';

    expect(blankSourceComments(source)).toBe(`const a = "/* opener";\n${" ".repeat(10)}\nconst c = 1;`);
  });

  it("blanks an unterminated block comment to the end", () => {
    expect(blankSourceComments("const a = 1;\n/* never closed")).toBe(`const a = 1;\n${" ".repeat(15)}`);
  });

  it("preserves every byte offset and the line count", () => {
    const source = 'const a = 1;\n  // a comment\n/* two\n   lines */\nconst b = "x";\n';
    const blanked = blankSourceComments(source);

    expect(blanked.length).toBe(source.length);
    expect(blanked.split("\n").length).toBe(source.split("\n").length);
    expect(blanked.indexOf('const b = "x";')).toBe(source.indexOf('const b = "x";'));
  });
});

describe("collectFiles() — the order and spelling a finding inherits", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-collect-"));

  beforeAll(() => {
    mkdirSync(join(root, "src/b/deep"), { recursive: true });
    mkdirSync(join(root, "src/a"), { recursive: true });
    for (const path of ["src/z.ts", "src/a/one.ts", "src/b/deep/two.ts", "src/a/skip.md"]) {
      writeFileSync(join(root, path), "", "utf-8");
    }
  });

  it("returns sorted, posix-separated, repo-relative paths", () => {
    expect(collectFiles(root, "src", (name) => name.endsWith(".ts"))).toEqual(["src/a/one.ts", "src/b/deep/two.ts", "src/z.ts"]);
  });

  it("returns nothing for a directory that does not exist, rather than throwing", () => {
    expect(collectFiles(root, "absent", () => true)).toEqual([]);
  });

  it("reads a single file named directly, and rejects one the filter declines", () => {
    expect(collectSource(root, "src/z.ts", (name) => name.endsWith(".ts"))).toEqual(["src/z.ts"]);
    expect(collectSource(root, "src/a/skip.md", (name) => name.endsWith(".ts"))).toEqual([]);
  });

  it("lists only the immediate entries, files and directories apart", () => {
    expect(listFiles(join(root, "src"), () => true)).toEqual(["z.ts"]);
    expect(listDirectories(join(root, "src"))).toEqual(["a", "b"]);
  });
});

describe("excludedBy() — the prefix boundary", () => {
  it("excludes the prefix itself and what sits beneath it", () => {
    expect(excludedBy("src/ui/design", ["src/ui/design"])).toBe(true);
    expect(excludedBy("src/ui/design/catalog.md", ["src/ui/design"])).toBe(true);
  });

  it("does not exclude a sibling whose name merely starts with the prefix", () => {
    expect(excludedBy("src/ui/designer/index.ts", ["src/ui/design"])).toBe(false);
  });

  it("excludes nothing when no prefix is given", () => {
    expect(excludedBy("src/ui/design", [])).toBe(false);
  });

  it("matches a `**`-led prefix at any depth, on whole segments only", () => {
    expect(excludedBy(".wrangler/tmp/a.ts", ["**/.wrangler"])).toBe(true);
    expect(excludedBy("tests/fixtures/db-schema/.wrangler/tmp/a.ts", ["**/.wrangler"])).toBe(true);
    expect(excludedBy("tests/fixtures/db-schema/.wranglerrc/a.ts", ["**/.wrangler"])).toBe(false);
    expect(excludedBy("tests/fixtures/not.wrangler/a.ts", ["**/.wrangler"])).toBe(false);
  });
});

describe("resolveSources() — the walk a `!` entry narrows", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-resolve-"));

  beforeAll(() => {
    for (const path of ["src/a.ts", "src/skip/b.ts", "src/skipper/c.ts", "src/d.md"]) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), "", "utf-8");
    }
  });

  it("returns every accepted file under the sources, sorted", () => {
    expect(resolveSources(root, ["src"], (name) => name.endsWith(".ts"))).toEqual(["src/a.ts", "src/skip/b.ts", "src/skipper/c.ts"]);
  });

  it("drops the subtree a `!` entry names, and only that subtree", () => {
    expect(resolveSources(root, ["src", "!src/skip"], (name) => name.endsWith(".ts"))).toEqual(["src/a.ts", "src/skipper/c.ts"]);
  });

  it("dedupes a file two sources both reach", () => {
    expect(resolveSources(root, ["src", "src/a.ts"], (name) => name.endsWith(".ts"))).toEqual(["src/a.ts", "src/skip/b.ts", "src/skipper/c.ts"]);
  });

  it("returns nothing when every source is excluded", () => {
    expect(resolveSources(root, ["src", "!src"], () => true)).toEqual([]);
  });

  it("drops every `.wrangler` bundle a `!**/` entry names, whichever fixture holds it", () => {
    const scratch = mkdtempSync(join(tmpdir(), "forge-wrangler-"));
    const bundle = "tests/fixtures/db-schema/.wrangler/tmp/bundle-x/entry.ts";
    try {
      for (const path of ["tests/fixtures/db-schema/worker.ts", bundle]) {
        mkdirSync(dirname(join(scratch, path)), { recursive: true });
        writeFileSync(join(scratch, path), "", "utf-8");
      }

      expect(resolveSources(scratch, ["tests"], (name) => name.endsWith(".ts"))).toContain(bundle);
      expect(resolveSources(scratch, ["tests", "!**/.wrangler"], (name) => name.endsWith(".ts"))).toEqual(["tests/fixtures/db-schema/worker.ts"]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe("unresolvedSourceEntries() — the entry a walk would skip silently", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-unresolved-"));
  const named = (sources: readonly string[], admits?: "directory" | "file or directory"): string[] =>
    unresolvedSourceEntries(root, sources, admits).map((finding) => finding.message);

  beforeAll(() => {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "README.md"), "", "utf-8");
  });

  it("accepts a directory however it resolves — bare, with a trailing `/`, or with a leading `./`", () => {
    expect(named(["src", "src/", "./src"])).toEqual([]);
  });

  it("names every entry that resolves to nothing, beside one that does", () => {
    expect(named(["src", "srcc", "lib/"])).toEqual([
      "`sources` entry `srcc` names no directory under the root",
      "`sources` entry `lib/` names no directory under the root",
    ]);
  });

  it("refuses a file where only a directory is walked, and accepts one where a file is", () => {
    expect(named(["README.md"])).toEqual(["`sources` entry `README.md` names no directory under the root"]);
    expect(named(["README.md", "docs"], "file or directory")).toEqual(["`sources` entry `docs` names no file or directory under the root"]);
  });

  it("judges no `!` exclusion, which narrows a walk rather than declaring one", () => {
    expect(named(["src", "!src/gone"])).toEqual([]);
  });
});

describe("isTestSource() — the one suffix list every check reads", () => {
  it("marks the six test suffixes and nothing that merely reads like one", () => {
    const cases = [
      "src/alpha/a.test.ts",
      "src/alpha/a.test.tsx",
      "src/alpha/a.browser.ts",
      "src/alpha/a.browser.tsx",
      "src/alpha/a.fixture.ts",
      "src/alpha/a.fixture.tsx",
      "src/alpha/a.ts",
      "src/alpha/a.tsx",
      "src/alpha/testing.ts",
      "src/alpha/browser.ts",
      "src/alpha/fixture.ts",
      "src/alpha/a-fixture.ts",
    ];

    expect(cases.map((path) => [path, isTestSource(path)])).toEqual([
      ["src/alpha/a.test.ts", true],
      ["src/alpha/a.test.tsx", true],
      ["src/alpha/a.browser.ts", true],
      ["src/alpha/a.browser.tsx", true],
      ["src/alpha/a.fixture.ts", true],
      ["src/alpha/a.fixture.tsx", true],
      ["src/alpha/a.ts", false],
      ["src/alpha/a.tsx", false],
      ["src/alpha/testing.ts", false],
      ["src/alpha/browser.ts", false],
      ["src/alpha/fixture.ts", false],
      ["src/alpha/a-fixture.ts", false],
    ]);
  });

  it("judges a bare filename the same as a repo-relative path, which is how the walkers call it", () => {
    expect(["a.fixture.ts", "a.ts"].map((name) => isTestSource(name))).toEqual([true, false]);
  });
});
