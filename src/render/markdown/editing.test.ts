import { describe, expect, it } from "bun:test";

import fc from "fast-check";

import gfm from "../../../tests/fixtures/markdown/gfm.json";
import spec from "../../../tests/fixtures/markdown/spec.json";
import { blockMarkdown, markdownEdit, mixedMarkdown } from "./arbitraries.fixture";
import { scanBlocks } from "./block";
import { continueList, createMarkdownDraft, reviseMarkdownDraft, toggleTask, unitTaskBoxes, wrapSelection } from "./editing";
import { listTasks, parseMarkdown, setTasks } from "./mod";
import type { MarkdownDraft, MarkdownEdit, MarkdownRange, MarkdownWrap } from "./types";

function apply(text: string, edit: MarkdownEdit): string {
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

function enterAt(text: string, caret = text.length): MarkdownEdit | null {
  return continueList(createMarkdownDraft(text), { from: caret, to: caret });
}

function continuedAtEnd(text: string, insert: string): MarkdownEdit {
  const after = text.length + insert.length;
  return { from: text.length, to: text.length, insert, selection: { from: after, to: after } };
}

function endedAt(from: number, to: number): MarkdownEdit {
  return { from, to, insert: "", selection: { from, to: from } };
}

function withoutSegments(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSegments);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, field]) => (key === "segments" ? [] : [[key, withoutSegments(field)]])));
}

const CORPUS = [...spec.examples, ...gfm.examples].map(({ markdown }) => markdown);

describe("scanBlocks() over one unit alone — what a command parses instead of the document", () => {
  it("answers exactly the node the whole document holds, for every unit of the CommonMark and GFM examples", () => {
    const alone = CORPUS.map((source) =>
      scanBlocks(source).units.map((unit) => scanBlocks(source.slice(unit.start, unit.end)).units.map(({ node }) => withoutSegments(node))),
    );
    const inDocument = CORPUS.map((source) => scanBlocks(source).units.map(({ node }) => [withoutSegments(node)]));
    expect(alone).toEqual(inDocument);
  });
});

describe("createMarkdownDraft() — a text and its unit bounds", () => {
  it("holds the text and only the bounds of each unit", () => {
    const draft = createMarkdownDraft("a\n\n- b\n- c\n");
    expect(draft.text).toBe("a\n\n- b\n- c\n");
    expect(draft.units.map((unit) => Object.keys(unit).toSorted())).toEqual([
      ["end", "neutral", "start"],
      ["end", "neutral", "start"],
      ["end", "neutral", "start"],
    ]);
  });
});

describe("reviseMarkdownDraft() — a draft kept current", () => {
  it("answers the draft itself when the text is unchanged", () => {
    const draft = createMarkdownDraft("- a\n- b");
    expect(reviseMarkdownDraft(draft, draft.text)).toBe(draft);
  });

  it("answers the bounds a fresh scan gives", () => {
    const before = "# t\n\n- a\n- b\n\npara";
    const after = "# t\n\n- a\n- bb\n\n```\nx\n```\npara";
    expect(reviseMarkdownDraft(createMarkdownDraft(before), after).units).toEqual(createMarkdownDraft(after).units);
  });

  it("answers the bounds a fresh scan gives after any splice", () => {
    fc.assert(
      fc.property(fc.oneof(blockMarkdown, mixedMarkdown), markdownEdit, (before, { at, remove, insert }) => {
        const start = Math.floor(at * before.length);
        const after = before.slice(0, start) + insert + before.slice(Math.min(before.length, start + remove));
        const revised = reviseMarkdownDraft(createMarkdownDraft(before), after);
        expect(revised).toEqual(createMarkdownDraft(after));
      }),
      { seed: 261031, numRuns: 1000 },
    );
  });
});

describe("continueList() — a command that parses only the draft's unit", () => {
  it("continues an item the draft's bounds isolate from a fence opened in the unit before", () => {
    const draft: MarkdownDraft = {
      text: "```\n- a",
      units: [
        { start: 0, end: 4, neutral: true },
        { start: 4, end: 7, neutral: true },
      ],
    };
    expect(continueList(draft, { from: 7, to: 7 })).toEqual(continuedAtEnd(draft.text, "\n- "));
  });
});

describe("continueList() — task-forge's nextListPrefix continuations, caret after the new marker", () => {
  const cases: readonly { name: string; text: string; insert: string }[] = [
    { name: "a dash bullet with a dash", text: "- one", insert: "\n- " },
    { name: "a star bullet with a star", text: "* one", insert: "\n* " },
    { name: "a plus bullet with a plus (task-forge: not an item)", text: "+ one", insert: "\n+ " },
    { name: "an indented bullet at its indent", text: "  - one", insert: "\n  - " },
    { name: "a dotted item with the next ordinal", text: "1. one", insert: "\n2. " },
    { name: "a parenthesised item keeping its delimiter", text: "9) one", insert: "\n10) " },
    { name: "an indented ordered item at its indent", text: "   3. one", insert: "\n   4. " },
    { name: "a ticked box with an unticked one", text: "- [x] done", insert: "\n- [ ] " },
    { name: "an unticked box with another", text: "- [ ] todo", insert: "\n- [ ] " },
    { name: "an indented star box at its indent", text: "  * [X] done", insert: "\n  * [ ] " },
    { name: "a box padded by several spaces with a single-spaced box", text: "-   [ ]   todo", insert: "\n- [ ] " },
  ];

  for (const { name, text, insert } of cases) {
    it(`continues ${name}`, () => {
      expect(enterAt(text)).toEqual(continuedAtEnd(text, insert));
    });
  }

  it("continues into a line the parser reads back as the next item of the same list", () => {
    const text = "  7) seven";
    const edit = enterAt(text);
    const typed = edit === null ? text : `${apply(text, edit)}eight`;
    const { units } = scanBlocks(typed);
    expect(typed).toBe("  7) seven\n  8) eight");
    expect(units.map(({ node }) => node.type)).toEqual(["listItem", "listItem"]);
    expect(units[1]?.list).toBe(units[0]?.list);
  });
});

describe("continueList() — task-forge's parseListLine lines, read by forge's parser", () => {
  const continues: readonly { name: string; line: string; insert: string }[] = [
    { name: "a bullet keeping inner spacing", line: "- a  b", insert: "\n- " },
    { name: "a parenthesised ordered item", line: "12) one", insert: "\n13) " },
    { name: "a box ticked in capitals", line: "- [X] done", insert: "\n- [ ] " },
    { name: "a box on a star bullet", line: "* [ ] todo", insert: "\n* [ ] " },
    { name: "an indented box", line: "  - [x] done", insert: "\n  - [ ] " },
    { name: "a box on an ordered item, as a task (task-forge: text)", line: "1. [x] done", insert: "\n2. [ ] " },
    { name: "a box with no space before its label, as a plain item", line: "- [x]done", insert: "\n- " },
    { name: "a box holding another character, as a plain item", line: "- [y] maybe", insert: "\n- " },
    { name: "a box with two spaces inside, as a plain item", line: "- [  ] todo", insert: "\n- " },
  ];

  for (const { name, line, insert } of continues) {
    it(`continues ${name}`, () => {
      expect(enterAt(line)?.insert).toBe(insert);
    });
  }

  const ends: readonly { name: string; line: string }[] = [
    { name: "a bullet with nothing after its space", line: "- " },
    { name: "a box with no label", line: "- [ ]" },
    { name: "a marker alone (task-forge: not an item)", line: "-" },
  ];

  for (const { name, line } of ends) {
    it(`ends the list on ${name}`, () => {
      expect(enterAt(line)).toEqual(endedAt(0, line.length));
    });
  }

  const nonItems: readonly { name: string; line: string }[] = [
    { name: "a bullet indented by a tab, which is indented code (task-forge: an item)", line: "\t- one" },
    { name: "a paragraph line", line: "plain" },
    { name: "an empty line", line: "" },
    { name: "a marker with no space after it", line: "-one" },
    { name: "a thematic break", line: "---" },
    { name: "an ordinal with no space after it", line: "1.one" },
    { name: "an ordinal with no delimiter", line: "1 one" },
  ];

  for (const { name, line } of nonItems) {
    it(`answers null for ${name}`, () => {
      expect(enterAt(line)).toBeNull();
    });
  }

  it("terminates on a long run of whitespace carrying no marker", () => {
    expect(enterAt(`${" ".repeat(100_000)}x`)).toBeNull();
  });

  it("terminates on a long run of digits carrying no delimiter", () => {
    expect(enterAt(`${"1".repeat(100_000)} x`)).toBeNull();
  });
});

describe("continueList() — an item inside a container", () => {
  const cases: readonly { name: string; text: string; insert: string }[] = [
    { name: "a bullet in a blockquote, repeating the `>`", text: "> - x", insert: "\n> - " },
    { name: "an ordered item continued by an indented line in a blockquote", text: "> 3. a\n>    b", insert: "\n> 4. " },
    { name: "a quoted item whose paragraph runs on lazily", text: "> - a\nb", insert: "\n> - " },
    { name: "a bullet opened on its parent's line, its parent's marker blanked", text: "- - x", insert: "\n  - " },
    { name: "a bullet in a blockquote in a bullet", text: "- > - x", insert: "\n  > - " },
    { name: "a nested bullet on its own line", text: "- a\n  - b", insert: "\n  - " },
  ];

  for (const { name, text, insert } of cases) {
    it(`continues ${name}`, () => {
      expect(enterAt(text)).toEqual(continuedAtEnd(text, insert));
    });
  }

  it("answers null at the end of an item whose nested list follows it", () => {
    expect(enterAt("- a\n  - b", 3)).toBeNull();
  });
});

describe("continueList() — only at the end of an item", () => {
  it("drops trailing spaces, from a caret before them or after them", () => {
    const expected = { from: 3, to: 5, insert: "\n- ", selection: { from: 6, to: 6 } };
    expect([enterAt("- a  ", 3), enterAt("- a  ", 5)]).toEqual([expected, expected]);
  });

  const nulls: readonly { name: string; text: string; selection: MarkdownRange }[] = [
    { name: "mid-text", text: "- abc", selection: { from: 3, to: 3 } },
    { name: "on the marker", text: "- a", selection: { from: 0, to: 0 } },
    { name: "between the marker and the text", text: "- a", selection: { from: 1, to: 1 } },
    { name: "in the indentation before the marker", text: "  - a", selection: { from: 1, to: 1 } },
    { name: "with a selection that is not a caret", text: "- a", selection: { from: 2, to: 3 } },
    { name: "after an item ending in a fence", text: "- a\n  ```\n  - x", selection: { from: 15, to: 15 } },
    { name: "after an item holding a heading", text: "- # h", selection: { from: 5, to: 5 } },
    { name: "after an item whose next number exceeds nine digits", text: "999999999. x", selection: { from: 12, to: 12 } },
  ];

  for (const { name, text, selection } of nulls) {
    it(`answers null ${name}`, () => {
      expect(continueList(createMarkdownDraft(text), selection)).toBeNull();
    });
  }
});

describe("continueList() — Enter on an empty item ends the list", () => {
  const cases: readonly { name: string; text: string; result: string }[] = [
    { name: "a bullet and its space", text: "- ", result: "" },
    { name: "a bare bullet", text: "-", result: "" },
    { name: "an ordinal and its space", text: "1. ", result: "" },
    { name: "a bullet holding only an unticked box", text: "- [ ] ", result: "" },
    { name: "an ordinal holding only a ticked box", text: "1. [x]", result: "" },
    { name: "an indented bullet, its indentation removed with it", text: "  - ", result: "" },
    { name: "a quoted bullet, keeping the `>`", text: "> - ", result: ">" },
    { name: "a second bullet, keeping the first", text: "- a\n- ", result: "- a\n" },
  ];

  for (const { name, text, result } of cases) {
    it(`removes ${name}, leaving the caret where the marker began`, () => {
      const edit = enterAt(text);
      expect(edit === null ? null : { text: apply(text, edit), selection: edit.selection }).toEqual({
        text: result,
        selection: { from: result.length, to: result.length },
      });
    });
  }

  it("ends the list on a second Enter after continuing a task", () => {
    const text = "- [x] a";
    const first = enterAt(text);
    const continued = first === null ? text : apply(text, first);
    const second = enterAt(continued);
    expect(second === null ? null : apply(continued, second)).toBe("- [x] a\n");
  });
});

describe("continueList() — items as the parser finds them, where a line regex would not", () => {
  const nulls: readonly { name: string; text: string; caret: number }[] = [
    { name: "a bullet inside an unclosed fence", text: "```\n- x", caret: 7 },
    { name: "a bullet inside a closed fence", text: "```\n- x\n```", caret: 7 },
    { name: "a `* * *` thematic break", text: "* * *", caret: 5 },
    { name: "an ordinal that cannot interrupt a paragraph", text: "a\n2. b", caret: 6 },
    { name: "a `-` that underlines a setext heading", text: "a\n-", caret: 3 },
  ];

  for (const { name, text, caret } of nulls) {
    it(`answers null for ${name}`, () => {
      expect(enterAt(text, caret)).toBeNull();
    });
  }

  it("continues a box on an ordered item as a task", () => {
    expect(enterAt("1. [ ] x")).toEqual(continuedAtEnd("1. [ ] x", "\n2. [ ] "));
  });
});

describe("continueList() and wrapSelection() — a selection outside the text", () => {
  const selections: readonly MarkdownRange[] = [
    { from: 2, to: 1 },
    { from: -1, to: 0 },
    { from: 0, to: 4 },
  ];

  for (const selection of selections) {
    it(`throws on ${JSON.stringify(selection)} in a three-character text`, () => {
      expect(() => continueList(createMarkdownDraft("- a"), selection)).toThrow(
        new Error("continueList: selection lies outside the draft's text."),
      );
      expect(() => wrapSelection("a b", selection, "strong")).toThrow(new Error("wrapSelection: selection lies outside the text."));
    });
  }
});

describe("toggleTask() — one box flipped, agreeing with listTasks and setTasks", () => {
  const MIXED = "- [ ] a\n- [X] b\n\n1. [x] c\n2. [ ] d\n\n> - [ ] e\n\nNote[^n].\n\n[^n]: Body.\n\n    - [x] f\n";

  it("rewrites only the character between the brackets", () => {
    const text = "- [ ] a\n- [x] b";
    expect(toggleTask(createMarkdownDraft(text), 2)).toEqual({ from: 3, to: 4, insert: "x", selection: null });
    expect(toggleTask(createMarkdownDraft(text), 10)).toEqual({ from: 11, to: 12, insert: " ", selection: null });
  });

  it("flips every box listTasks reports in a document of bullets, ordered items, a quote and a footnote, leaving the others", () => {
    const tasks = listTasks(parseMarkdown(MIXED));
    expect(tasks.map(({ line }) => line)).toEqual([1, 2, 4, 5, 7, 13]);
    const draft = createMarkdownDraft(MIXED);
    for (const target of tasks) {
      const edit = toggleTask(draft, target.offset);
      const toggled = edit === null ? MIXED : apply(MIXED, edit);
      const lines = new Set(tasks.filter((task) => (task === target ? !task.checked : task.checked)).map(({ line }) => line));
      const viaSetTasks = setTasks(MIXED, parseMarkdown(MIXED), lines);
      expect({ from: edit?.from, to: edit?.to, selection: edit?.selection }).toEqual({
        from: target.offset + 1,
        to: target.offset + 2,
        selection: null,
      });
      expect(viaSetTasks.ok ? viaSetTasks.data : null).toBe(toggled);
      expect(listTasks(parseMarkdown(toggled)).map(({ checked }) => checked)).toEqual(
        tasks.map((task) => (task === target ? !task.checked : task.checked)),
      );
    }
  });

  it("unticks a capital X to a space and ticks it back as a lowercase x", () => {
    const text = "- [X] a";
    const unticked = toggleTask(createMarkdownDraft(text), 2);
    const cleared = unticked === null ? text : apply(text, unticked);
    const reticked = toggleTask(createMarkdownDraft(cleared), 2);
    expect([cleared, reticked === null ? cleared : apply(cleared, reticked)]).toEqual(["- [ ] a", "- [x] a"]);
  });

  const nulls: readonly { name: string; text: string; offset: number }[] = [
    { name: "a box inside a fence", text: "```\n- [ ] a\n```", offset: 6 },
    { name: "a box holding the whole item, which is no task", text: "- [ ]", offset: 2 },
    { name: "a ticked box holding the whole item, which is no task", text: "- [x]", offset: 2 },
    { name: "a box with no space before its label", text: "- [x]done", offset: 2 },
    { name: "a box holding another character", text: "- [y] maybe", offset: 2 },
    { name: "an offset that is not a box's bracket", text: "- [ ] a", offset: 3 },
    { name: "a negative offset", text: "- [ ] a", offset: -1 },
    { name: "an offset at the text's end", text: "- [ ] a", offset: 7 },
    { name: "an offset past the text's end", text: "- [ ] a", offset: 99 },
  ];

  for (const { name, text, offset } of nulls) {
    it(`answers null for ${name}`, () => {
      expect(toggleTask(createMarkdownDraft(text), offset)).toBeNull();
    });
  }
});

describe("unitTaskBoxes()", () => {
  it("answers the boxes of the unit holding the offset, at document offsets, and none for an item holding only a box", () => {
    const text = "intro\n\n- [ ] a\n- [ ] \n- [x] b";
    const draft = createMarkdownDraft(text);
    const [first = -1, second = -1, third = -1] = [...text.matchAll(/^- /gm)].map((match) => match.index);

    expect([first, second, third].map((item) => unitTaskBoxes(draft, item))).toEqual([[first + 2], [], [third + 2]]);
  });

  it("answers no boxes for an offset outside the text", () => {
    expect(unitTaskBoxes(createMarkdownDraft("- [ ] a"), 99)).toEqual([]);
  });
});

describe("continueList() and listTasks() — a continued task is a task", () => {
  it("lists the typed continuation as an unticked box on the new line", () => {
    const text = "- [x] a";
    const edit = enterAt(text);
    const typed = edit === null ? text : `${apply(text, edit)}b`;
    expect(listTasks(parseMarkdown(typed))).toEqual([
      { line: 1, offset: 2, checked: true },
      { line: 2, offset: 10, checked: false },
    ]);
  });
});

describe("wrapSelection() — writing inline markers around the selection", () => {
  const wraps: readonly { wrap: MarkdownWrap; expected: MarkdownEdit }[] = [
    { wrap: "strong", expected: { from: 2, to: 3, insert: "**b**", selection: { from: 4, to: 5 } } },
    { wrap: "emphasis", expected: { from: 2, to: 3, insert: "*b*", selection: { from: 3, to: 4 } } },
    { wrap: "inlineCode", expected: { from: 2, to: 3, insert: "`b`", selection: { from: 3, to: 4 } } },
    { wrap: "link", expected: { from: 2, to: 3, insert: "[b](url)", selection: { from: 6, to: 9 } } },
  ];

  for (const { wrap, expected } of wraps) {
    it(`wraps \`b\` in \`a b c\` as ${wrap}, selecting ${wrap === "link" ? "`url`" : "the inner text"}`, () => {
      expect(wrapSelection("a b c", { from: 2, to: 3 }, wrap)).toEqual(expected);
    });
  }

  it("inserts an empty strong pair with the caret between", () => {
    expect(wrapSelection("a b", { from: 2, to: 2 }, "strong")).toEqual({ from: 2, to: 2, insert: "****", selection: { from: 4, to: 4 } });
  });

  it("inserts an empty link with `url` selected", () => {
    expect(wrapSelection("a b", { from: 2, to: 2 }, "link")).toEqual({ from: 2, to: 2, insert: "[](url)", selection: { from: 5, to: 8 } });
  });
});

describe("wrapSelection() — judging only the markers just outside the selection", () => {
  const cases: readonly { name: string; text: string; selection: MarkdownRange; wrap: MarkdownWrap; result: string; selected: string }[] = [
    { name: "unwraps strong", text: "a **b** c", selection: { from: 4, to: 5 }, wrap: "strong", result: "a b c", selected: "b" },
    {
      name: "deletes an empty strong pair around the caret",
      text: "a **** c",
      selection: { from: 4, to: 4 },
      wrap: "strong",
      result: "a  c",
      selected: "",
    },
    { name: "unwraps emphasis", text: "a *b* c", selection: { from: 3, to: 4 }, wrap: "emphasis", result: "a b c", selected: "b" },
    {
      name: "adds emphasis inside strong",
      text: "a **b** c",
      selection: { from: 4, to: 5 },
      wrap: "emphasis",
      result: "a ***b*** c",
      selected: "b",
    },
    {
      name: "takes strong off strong emphasis",
      text: "a ***b*** c",
      selection: { from: 5, to: 6 },
      wrap: "strong",
      result: "a *b* c",
      selected: "b",
    },
    {
      name: "takes emphasis off strong emphasis",
      text: "a ***b*** c",
      selection: { from: 5, to: 6 },
      wrap: "emphasis",
      result: "a **b** c",
      selected: "b",
    },
    { name: "unwraps a code span", text: "a `b` c", selection: { from: 3, to: 4 }, wrap: "inlineCode", result: "a b c", selected: "b" },
    {
      name: "wraps inside a double-backtick span",
      text: "a ``b`` c",
      selection: { from: 4, to: 5 },
      wrap: "inlineCode",
      result: "a ```b``` c",
      selected: "b",
    },
    { name: "unwraps a link", text: "a [b](x) c", selection: { from: 3, to: 4 }, wrap: "link", result: "a b c", selected: "b" },
    {
      name: "unwraps a link whose destination holds balanced parentheses",
      text: "a [b](a(b)c) c",
      selection: { from: 3, to: 4 },
      wrap: "link",
      result: "a b c",
      selected: "b",
    },
    {
      name: "wraps a link whose destination never closes",
      text: "a [b](x c",
      selection: { from: 3, to: 4 },
      wrap: "link",
      result: "a [[b](url)](x c",
      selected: "url",
    },
    {
      name: "wraps strong again when the selection takes in the markers",
      text: "a **b** c",
      selection: { from: 2, to: 7 },
      wrap: "strong",
      result: "a ****b**** c",
      selected: "**b**",
    },
  ];

  for (const { name, text, selection, wrap, result, selected } of cases) {
    it(name, () => {
      const edit = wrapSelection(text, selection, wrap);
      const after = edit === null ? text : apply(text, edit);
      const range = edit?.selection ?? { from: 0, to: 0 };
      expect({ after, selected: after.slice(range.from, range.to) }).toEqual({ after: result, selected });
    });
  }
});

describe("the editing commands — never a no-op edit", () => {
  const WRAPS: readonly MarkdownWrap[] = ["strong", "emphasis", "inlineCode", "link"];

  it("changes the text whenever a command answers an edit", () => {
    fc.assert(
      fc.property(fc.oneof(blockMarkdown, mixedMarkdown), fc.nat(), fc.nat(), fc.constantFrom(...WRAPS), (text, first, second, wrap) => {
        const caret = first % (text.length + 1);
        const end = caret + (second % (text.length + 1 - caret));
        const draft = createMarkdownDraft(text);
        const edits = [
          continueList(draft, { from: caret, to: caret }),
          wrapSelection(text, { from: caret, to: end }, wrap),
          toggleTask(draft, caret),
        ];
        expect(edits.filter((edit) => edit !== null && apply(text, edit) === text)).toEqual([]);
      }),
      { seed: 261031, numRuns: 1000 },
    );
  });
});
