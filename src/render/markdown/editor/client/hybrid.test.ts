import { describe, expect, it } from "bun:test";

import { syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";

import { viewportDialect } from "./dialect";
import { TEST_DIALECT } from "./dialect.fixture";
import { buildHiddenMarks } from "./hybrid";
import { parsedState } from "./parsed-state.fixture";
import { ROUND_TRIP_MARKDOWN } from "./round-trip.fixture";
import { markdownSyntax } from "./syntax";

const PAGE = "0190c7a0-0000-7000-8000-000000000001";
const ATT = "0190c7a0-0000-7000-8000-0000000000aa";

interface Hidden {
  readonly line: number;
  readonly text: string;
}

function stateOf(doc: string, cursor?: number, head?: number): EditorState {
  return parsedState(
    EditorState.create({
      doc,
      extensions: [markdownSyntax(), viewportDialect.of(TEST_DIALECT)],
      ...(cursor === undefined ? {} : { selection: EditorSelection.single(cursor, head ?? cursor) }),
    }),
  );
}

function hidden(state: EditorState, reveal: boolean): Hidden[] {
  const found: Hidden[] = [];
  const { doc } = state;
  buildHiddenMarks(state, reveal, [{ from: 0, to: doc.length }]).hidden.between(0, doc.length, (from, to) => {
    found.push({ line: doc.lineAt(from).number, text: doc.sliceString(from, to) });
  });
  return found;
}

function hiddenText(doc: string): string[] {
  return hidden(stateOf(doc), false).map(({ text }) => text);
}

function lineStart(doc: string, line: number): number {
  return stateOf(doc).doc.line(line).from;
}

const ROUND_TRIP_HIDDEN: readonly Hidden[] = [
  { line: 2, text: "============" },
  { line: 5, text: "---------------" },
  { line: 7, text: "# " },
  { line: 7, text: "*" },
  { line: 7, text: "*" },
  { line: 7, text: "`" },
  { line: 7, text: "`" },
  ...Array.from({ length: 10 }, () => ({ line: 11, text: "\\" })),
  { line: 14, text: "**" },
  { line: 14, text: "**" },
  { line: 14, text: "~~" },
  { line: 14, text: "~~" },
  { line: 17, text: "[" },
  { line: 17, text: '](https://example.com/a "title")' },
  { line: 20, text: "[[" },
  { line: 20, text: "]]" },
  { line: 25, text: "[[page|" },
  { line: 25, text: "]]" },
  { line: 25, text: "[[" },
  { line: 25, text: "]]" },
  { line: 25, text: "==" },
  { line: 25, text: "==" },
  { line: 27, text: "> " },
  { line: 27, text: "[!note] " },
  { line: 28, text: "> " },
  { line: 28, text: "[[page|" },
  { line: 28, text: "]]" },
  { line: 30, text: "> " },
  { line: 36, text: "`" },
  { line: 36, text: "`" },
  { line: 36, text: "*" },
  { line: 36, text: "*" },
  { line: 36, text: "_" },
  { line: 36, text: "_" },
  { line: 36, text: "__" },
  { line: 36, text: "__" },
];

describe("buildHiddenMarks with the active lines not revealed", () => {
  it("hides exactly the markup of the round-trip page, in document order", () => {
    expect(hidden(stateOf(ROUND_TRIP_MARKDOWN), false)).toEqual(ROUND_TRIP_HIDDEN);
  });

  it("hides the same markup wherever the cursor sits", () => {
    expect(hidden(stateOf(ROUND_TRIP_MARKDOWN, lineStart(ROUND_TRIP_MARKDOWN, 7)), false)).toEqual(ROUND_TRIP_HIDDEN);
  });

  it("changes no text", () => {
    const state = stateOf(ROUND_TRIP_MARKDOWN);

    buildHiddenMarks(state, false, [{ from: 0, to: state.doc.length }]);

    expect(state.doc.toString()).toBe(ROUND_TRIP_MARKDOWN);
  });
});

describe("buildHiddenMarks with the active lines revealed", () => {
  it("hides nothing on the cursor's line and the same markup as before on every other line", () => {
    const state = stateOf(ROUND_TRIP_MARKDOWN, lineStart(ROUND_TRIP_MARKDOWN, 7) + 3);

    expect(hidden(state, true)).toEqual(ROUND_TRIP_HIDDEN.filter(({ line }) => line !== 7));
  });

  it("hides nothing on any line a selection spans", () => {
    const state = stateOf(ROUND_TRIP_MARKDOWN, lineStart(ROUND_TRIP_MARKDOWN, 27) + 4, lineStart(ROUND_TRIP_MARKDOWN, 28) + 4);

    expect(hidden(state, true)).toEqual(ROUND_TRIP_HIDDEN.filter(({ line }) => line !== 27 && line !== 28));
  });

  it("hides nothing on the line of any of several cursors", () => {
    const doc = "a *b*\n\nc **d**\n\ne ~~f~~";
    const state = parsedState(
      EditorState.create({
        doc,
        extensions: [markdownSyntax(), viewportDialect.of(TEST_DIALECT), EditorState.allowMultipleSelections.of(true)],
        selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(doc.indexOf("e"))]),
      }),
    );

    expect(hidden(state, true)).toEqual([
      { line: 3, text: "**" },
      { line: 3, text: "**" },
    ]);
  });
});

describe("buildHiddenMarks for headings", () => {
  for (const level of [1, 2, 3, 4, 5, 6]) {
    it(`hides a level-${level} ATX heading's marks and the space after them`, () => {
      expect(hiddenText(`${"#".repeat(level)} Title`)).toEqual([`${"#".repeat(level)} `]);
    });
  }

  it("hides a Setext heading's underline and leaves its text", () => {
    expect(hiddenText("Title\n=====\n\nSub\n---")).toEqual(["=====", "---"]);
  });
});

describe("buildHiddenMarks for a markdown link", () => {
  it("hides the opening bracket and everything from the closing bracket to the end", () => {
    expect(hiddenText("see [text](https://example.com/x) now")).toEqual(["[", "](https://example.com/x)"]);
  });

  it("hides the marks of emphasis inside the link text too", () => {
    expect(hiddenText("[*em*](u)")).toEqual(["[", "*", "*", "](u)"]);
  });
});

describe("buildHiddenMarks for a link whose title is on the next line", () => {
  const doc = 'see [a](https://x.test\n"title") end';

  it("hides no range that contains a line break", () => {
    expect(hidden(stateOf(doc), false).filter(({ text }) => text.includes("\n"))).toEqual([]);
  });

  it("hides the link's markup line by line and keeps the line break shown", () => {
    expect(hidden(stateOf(doc), false)).toEqual([
      { line: 1, text: "[" },
      { line: 1, text: "](https://x.test" },
      { line: 2, text: '"title")' },
    ]);
  });

  it("keeps the markup on the cursor's line shown and hides the rest of the link's markup", () => {
    expect(hidden(stateOf(doc, doc.indexOf("title")), true)).toEqual([
      { line: 1, text: "[" },
      { line: 1, text: "](https://x.test" },
    ]);
  });
});

describe("buildHiddenMarks for quotes and callouts", () => {
  it("hides each line's quote mark and the space after it", () => {
    expect(hiddenText("> one\n> two")).toEqual(["> ", "> "]);
  });

  it("hides exactly the quote mark and the [!note] marker of a callout, and the quote mark of its body", () => {
    expect(hiddenText("> [!note] Title\n> body")).toEqual(["> ", "[!note] ", "> "]);
  });

  for (const kind of ["tip", "warning", "danger", "conflict"]) {
    it(`hides exactly the quote mark and the [!${kind}] marker of a ${kind} callout`, () => {
      expect(hiddenText(`> [!${kind}] Title`)).toEqual(["> ", `[!${kind}] `]);
    });
  }
});

describe("buildHiddenMarks for inline code and escapes", () => {
  it("hides the backticks of inline code and nothing inside it", () => {
    expect(hiddenText("a `**b** [[c]] ==d==` e")).toEqual(["`", "`"]);
  });

  it("hides the backslash of an escape and keeps the character it escapes", () => {
    expect(hiddenText("\\* and \\\\")).toEqual(["\\", "\\"]);
  });
});

describe("buildHiddenMarks inside code blocks", () => {
  it("hides nothing inside a fenced block", () => {
    expect(hiddenText("```\n# not *em* **st** `c` [l](u) [[Page]] ==hl== \\*\n> q\n```")).toEqual([]);
  });

  it("hides nothing inside a tilde fence", () => {
    expect(hiddenText("~~~md\n# h *em* [[Page]]\n~~~")).toEqual([]);
  });

  it("hides nothing inside an indented code block", () => {
    expect(hiddenText("    # h *em* [[Page]] ==hl==")).toEqual([]);
  });
});

describe("buildHiddenMarks for a wikilink", () => {
  it("hides only the two bracket pairs of a title link, never a lone bracket", () => {
    expect(hiddenText("x [[Some Page]] y")).toEqual(["[[", "]]"]);
  });

  it("hides the target and pipe of a labelled title link with its brackets", () => {
    expect(hiddenText("x [[Some Page|the label]] y")).toEqual(["[[Some Page|", "]]"]);
  });

  it("hides through an escaped pipe in a table cell", () => {
    expect(hiddenText("| a |\n| --- |\n| [[Some Page\\|label]] |")).toEqual(["[[Some Page\\|", "]]"]);
  });

  it("hides nothing of a labelled id-form link", () => {
    expect(hiddenText(`x [[${PAGE}|Budget]] y`)).toEqual([]);
  });

  it("hides nothing of an id-form link with no label", () => {
    expect(hiddenText(`[[${PAGE}]]`)).toEqual([]);
  });
});

describe("buildHiddenMarks for the rest of the dialect", () => {
  it("hides both == of a highlight and keeps what it holds", () => {
    expect(hiddenText("a ==hi there== b")).toEqual(["==", "=="]);
  });

  it("hides nothing of a tag, a due date or an embed", () => {
    expect(hiddenText(`- [ ] pay #finance due:2026-10-02 ![[att:${ATT}|Receipt]]`)).toEqual([]);
  });
});

describe("buildHiddenMarks over the given ranges", () => {
  it("hides nothing in a paragraph no range touches", () => {
    const doc = "a *b*\n\nc *d*";
    const state = stateOf(doc);
    const from = doc.indexOf("c");
    const found: string[] = [];

    buildHiddenMarks(state, false, [{ from, to: from + 1 }]).hidden.between(0, doc.length, (start, end) => {
      found.push(`${start}:${doc.slice(start, end)}`);
    });

    expect(found).toEqual([`${doc.indexOf("*", from)}:*`, `${doc.lastIndexOf("*")}:*`]);
  });
});

describe("the syntax tree the hybrid plugin reads", () => {
  it("names every node the plugin hides marks for in the round-trip page", () => {
    const names = new Set<string>();
    syntaxTree(stateOf(ROUND_TRIP_MARKDOWN)).iterate({ enter: (node) => void names.add(node.name) });
    const keyed = [
      "ATXHeading1",
      "Blockquote",
      "CodeMark",
      "EmphasisMark",
      "Escape",
      "FencedCode",
      "HeaderMark",
      "InlineCode",
      "Link",
      "LinkMark",
      "QuoteMark",
      "SetextHeading1",
      "SetextHeading2",
      "StrikethroughMark",
    ];

    expect(keyed.filter((name) => !names.has(name))).toEqual([]);
  });
});
