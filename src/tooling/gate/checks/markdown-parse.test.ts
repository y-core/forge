import { describe, expect, it } from "bun:test";

import { parseMarkdown, renderMarkdown, splitTableRow, validateMarkdown } from "./markdown-parse";
import type { MarkdownRules } from "./types";

const ALIASED: MarkdownRules = { fence: { style: "backtick", requireLanguage: true, aliases: { typescript: "ts", sh: "bash" } } };

/** The messages one document produces, in the order the check reports them. */
function messages(source: string, rules: MarkdownRules = {}): string[] {
  return validateMarkdown("doc.md", parseMarkdown(source), rules).map((finding) => `${finding.level} ${finding.line}: ${finding.message}`);
}

function fixed(source: string, rules: MarkdownRules = {}): string {
  return renderMarkdown(parseMarkdown(source), rules);
}

describe("parseMarkdown() — classification", () => {
  it("spans frontmatter, and holds every line of it literal", () => {
    const doc = parseMarkdown("---\ntitle: X\n---\n\n# T\n");

    expect(doc.frontmatter).toEqual({ start: 1, end: 3 });
    expect(doc.kinds.slice(0, 3)).toEqual(["frontmatter", "frontmatter", "frontmatter"]);
  });

  it("records a fence's info string and its two markers", () => {
    const doc = parseMarkdown("```ts\nconst a = 1;\n```\n");

    expect(doc.fences).toEqual([{ start: 1, end: 3, marker: "```", indent: "", info: "ts" }]);
    expect(doc.kinds).toEqual(["fence-marker", "fence", "fence-marker", "blank"]);
  });

  it("reads a table as its header, delimiter and body rows", () => {
    const doc = parseMarkdown("| A | B |\n| --- | --- |\n| 1 | 2 |\n");

    expect(doc.tables).toHaveLength(1);
    expect(doc.tables[0]?.rows.map((row) => row.kind)).toEqual(["header", "delimiter", "body"]);
    expect(doc.tables[0]?.rows[2]?.cells).toEqual(["1", "2"]);
  });

  it("nests a list item under the item whose content column it is indented to", () => {
    const doc = parseMarkdown("- parent\n  - child\n- sibling\n");

    expect(doc.lists.map((item) => item.line)).toEqual([1, 3]);
    expect(doc.lists[0]?.children.map((item) => item.line)).toEqual([2]);
    expect(doc.lists[0]?.contentColumn).toBe(2);
  });

  it("keeps a lazy continuation inside the item it continues", () => {
    const doc = parseMarkdown("- item text\nwrapped at the margin\n\n- next\n");

    expect(doc.lists[0]?.end).toBe(2);
  });

  it("reads a `=` rule under a paragraph as a setext heading, not a thematic break", () => {
    const doc = parseMarkdown("Title\n=====\n");

    expect(doc.headings).toEqual([{ line: 1, level: 1, text: "Title", setext: true }]);
  });
});

describe("splitTableRow()", () => {
  it("drops the punctuation pipes and trims each cell", () => {
    expect(splitTableRow("| a | b  |")).toEqual(["a", "b"]);
  });

  it("keeps an escaped pipe and one inside a code span in the cell they belong to", () => {
    expect(splitTableRow("| `A \\| B` | c |")).toEqual(["`A \\| B`", "c"]);
  });

  it("treats an unclosed backtick as literal, so it cannot swallow the separators after it", () => {
    expect(splitTableRow("| a | trailing ` | c |")).toEqual(["a", "trailing `", "c"]);
  });
});

describe("validateMarkdown() — the mechanical rules", () => {
  it("reports a padded table once, at its first line", () => {
    expect(messages("| A   | B |\n| --- | --- |\n")).toEqual(["fail 1: table is padded — one space per cell side"]);
  });

  it("reports a bullet and an ordered marker the house does not write", () => {
    expect(messages("* star\n\n1) paren\n")).toEqual(["fail 1: list marker — write it as `-`", "fail 3: list marker — write it as `N.`"]);
  });

  it("reports the emphasis delimiters", () => {
    expect(messages("__strong__ and *em*\n")).toEqual(["fail 1: emphasis — write strong as `**` and emphasis as `_`"]);
  });

  it("reports a non-canonical fence language, and a fence with none at all", () => {
    expect(messages("```typescript\na\n```\n\n```\nb\n```\n", ALIASED)).toEqual([
      "fail 1: code fence: non-canonical marker or language tag",
      "fail 5: code fence has no language — tag it, e.g. ```ts",
    ]);
  });

  it("reports a hard tab and a thematic break written another way", () => {
    expect(messages("a\tb\n\n***\n")).toEqual(["fail 1: hard tab — indent with spaces", "fail 3: thematic break — write it as `---`"]);
  });

  it("reports a nested item indented anywhere but its parent's content column", () => {
    expect(messages("- parent\n    - child\n")).toEqual(["fail 2: nested list item is indented 4, not 2 — its parent's content column"]);
  });

  it("reports a missing blank line on each side of a block", () => {
    expect(messages("text\n## Heading\nmore\n")).toEqual([
      "fail 2: blank line missing before this heading",
      "fail 2: blank line missing after this heading",
    ]);
  });

  it("reports a second level-1 heading", () => {
    expect(messages("# One\n\n# Two\n")).toEqual(["fail 3: second level-1 heading — a document has one title"]);
  });

  it("reports a file that does not end in exactly one newline", () => {
    expect(messages("# One")).toEqual(["fail 1: file does not end with exactly one newline"]);
    expect(messages("# One\n\n\n")).toEqual(["fail 4: file does not end with exactly one newline"]);
  });
});

describe("validateMarkdown() — the report-only rules", () => {
  it("warns about a bare URL, and says nothing about a linked or backticked one", () => {
    expect(messages("See https://example.com now.\n")).toEqual(["warn 1: bare URL — wrap it in `<>` or write it as a link"]);
    expect(messages("See [it](https://example.com) and `https://x.dev` and <https://y.dev>.\n")).toEqual([]);
  });

  it("reports a reference-style link, and reads a bracketed path inside a code span as data", () => {
    expect(messages("[label][ref]\n")).toEqual(["fail 1: reference-style link — write the destination inline"]);
    expect(messages("`theme[family][mode].solid[step]` is a path.\n")).toEqual([]);
  });

  it("warns over the wrap column only inside the scope the rule names", () => {
    const long = `${"x".repeat(120)}\n`;
    const rule = { limit: 100, level: "warn" as const, scope: ["docs"] };

    expect(validateMarkdown("docs/A.md", parseMarkdown(long), { lineLength: rule })).toHaveLength(1);
    expect(validateMarkdown("src/A.md", parseMarkdown(long), { lineLength: rule })).toHaveLength(0);
  });

  it("says nothing at all when a rule is switched off", () => {
    const rules: MarkdownRules = {
      tables: "off",
      bulletMarker: "off",
      orderedMarker: "off",
      listIndent: "off",
      emphasis: "off",
      fence: "off",
      hardTabs: "off",
      trailingWhitespace: "off",
      thematicBreak: "off",
      linkStyle: "off",
      bareUrls: "off",
      singleH1: false,
      blankLineAround: "off",
      lineLength: false,
    };

    expect(messages("* a\n***\n__b__ and [x][y]\n| A   | B |\n| --- | --- |\n", rules)).toEqual([]);
  });
});

describe("renderMarkdown() — the fixer", () => {
  it("collapses a padded table to one space per cell side, keeping any alignment colons", () => {
    expect(fixed("| A     | B |\n| :---- | ---: |\n| 1     | 2 |\n")).toBe("| A | B |\n| :--- | ---: |\n| 1 | 2 |\n");
  });

  it("rewrites markers, emphasis, fence languages and thematic breaks", () => {
    expect(fixed("* star\n\n1) one\n\n__s__ and *e*\n\n```typescript\na\n```\n\n***\n", ALIASED)).toBe(
      "- star\n\n1. one\n\n**s** and _e_\n\n```ts\na\n```\n\n---\n",
    );
  });

  it("expands a hard tab and trims trailing whitespace", () => {
    expect(fixed("a\tb   \n")).toBe("a  b\n");
  });

  it("keeps a two-space hard break, which the front page writes deliberately", () => {
    expect(fixed("line one  \nline two\n")).toBe("line one  \nline two\n");
  });

  it("trims a would-be hard break that ends a paragraph, where it breaks nothing", () => {
    expect(fixed("line one  \n\nnext\n")).toBe("line one\n\nnext\n");
  });

  it("reindents a nested item and the lines that belong to it, without touching a correct one", () => {
    expect(fixed("- parent\n    - child\n      continued\n")).toBe("- parent\n  - child\n    continued\n");
    expect(fixed("1. parent\n   - child\n")).toBe("1. parent\n   - child\n");
  });

  it("leaves everything inside a fence alone, table and bullet alike", () => {
    const source = "```md\n| A   | B |\n| --- | --- |\n* star\n\t tabbed\n```\n";

    expect(fixed(source)).toBe(source);
  });

  it("leaves frontmatter alone", () => {
    const source = "---\nkeywords: [a, b]\ndescription: '*starred*'\n---\n\n# T\n";

    expect(fixed(source)).toBe(source);
  });

  it("inserts one blank line where a block runs into its neighbour, never two", () => {
    expect(fixed("text\n## Heading\n```ts\na\n```\n- item\n")).toBe("text\n\n## Heading\n\n```ts\na\n```\n\n- item\n");
  });

  it("ends the file with exactly one newline", () => {
    expect(fixed("# T")).toBe("# T\n");
    expect(fixed("# T\n\n\n\n")).toBe("# T\n");
  });

  it("is idempotent — rendering a rendered document returns it unchanged", () => {
    const sources = [
      "---\ntitle: X\n---\n\n# T\n\n| A   | B |\n| --- | --- |\n| `a \\| b` | 2 |\n",
      "* one\n    * two\n\n1) three\n   - four\n\ntext\n### Heading\n```typescript\na\n```\n",
      "__s__ *e* and `code *not em*` and https://example.com\n\n***\n\nline  \nbreak\n",
      "- item text\nlazily continued\n\n- next\n",
    ];

    for (const source of sources) {
      const once = fixed(source, ALIASED);

      expect(fixed(once, ALIASED)).toBe(once);
    }
  });

  it("leaves a clean document byte-identical", () => {
    const clean =
      "# Title\n\nProse with **strong** and _em_.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n- one\n  - two\n\n```ts\nconst a = 1;\n```\n";

    expect(fixed(clean, ALIASED)).toBe(clean);
    expect(messages(clean, ALIASED)).toEqual([]);
  });
});
