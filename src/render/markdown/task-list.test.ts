import { describe, expect, test } from "bun:test";

import { DIALECT_HANDLERS, DIALECT_SYNTAX } from "./dialect.fixture";
import { GFM_TASK_LISTS } from "./gfm-task-lists.fixture";
import { createCalloutTransform, createUnitCache, defineMarkdownSyntax, listTasks, parseMarkdown, renderMarkdownHtml, setTasks } from "./mod";
import type { HtmlSchema, MarkdownDocument, MarkdownNodeHandlers } from "./mod";
import { SPEC_SCHEMA } from "./spec-schema.fixture";
import { readListItemTask } from "./task-list";

const TASK_FORGE_MIXED = "- [ ] a\n```\n- [x] b\n```\n| h |\n- [x] c -- d\n\n- [x] e\n  - [ ] f";

function tasksOf(source: string) {
  return listTasks(parseMarkdown(source)).map(({ line, offset, checked }) => ({ line, offset, checked }));
}

function linesOf(source: string) {
  return listTasks(parseMarkdown(source)).map(({ line, checked }) => ({ line, checked }));
}

function tally(source: string) {
  const tasks = listTasks(parseMarkdown(source));
  return { done: tasks.filter(({ checked }) => checked).length, total: tasks.length };
}

function ticked(source: string, lines: readonly number[]) {
  return setTasks(source, parseMarkdown(source), new Set(lines));
}

describe("listTasks", () => {
  test("lists every box in source order with the line it sits on and the offset of its bracket", () => {
    expect(tasksOf("- [ ] a\n- [x] b\n\n* [X] c")).toEqual([
      { line: 1, offset: 2, checked: false },
      { line: 2, offset: 10, checked: true },
      { line: 4, offset: 19, checked: true },
    ]);
  });

  test("lists a box on an ordered item (task-forge: lists nothing)", () => {
    expect(tasksOf("- a\n1. [x] b\nplain [ ] text")).toEqual([{ line: 2, offset: 7, checked: true }]);
  });

  test("lists nothing for an empty source", () => {
    expect(tasksOf("")).toEqual([]);
  });

  test("skips a box inside a fence", () => {
    expect(tasksOf("- [ ] a\n```\n- [x] b\n```\n- [x] c")).toEqual([
      { line: 1, offset: 2, checked: false },
      { line: 5, offset: 26, checked: true },
    ]);
  });

  test("lists a box on the line after a lone table header row, which GFM reads as no table (task-forge: skips it)", () => {
    expect(linesOf("| h |\n- [x] a -- b\n\n- [ ] c")).toEqual([
      { line: 2, checked: true },
      { line: 4, checked: false },
    ]);
  });

  test("numbers lines the same under CRLF terminators", () => {
    expect(tasksOf("intro\r\n\r\n- [x] a")).toEqual([{ line: 3, offset: 11, checked: true }]);
  });

  test("lists exactly the boxes the renderer shows in task-forge's mixed source (task-forge: skips the box after the header row)", () => {
    const document = parseMarkdown(TASK_FORGE_MIXED);
    const rendered = [...renderMarkdownHtml(document, { schema: SPEC_SCHEMA }).matchAll(/<input type="checkbox"( checked)?/g)].map(
      ([, checked]) => checked !== undefined,
    );

    expect(linesOf(TASK_FORGE_MIXED)).toEqual([
      { line: 1, checked: false },
      { line: 6, checked: true },
      { line: 8, checked: true },
      { line: 9, checked: false },
    ]);
    expect(listTasks(document).map(({ checked }) => checked)).toEqual(rendered);
  });

  test("lists a box in a footnote in source order, though the footnote renders last", () => {
    expect(linesOf("a[^1]\n\n[^1]: - [x] fn")).toEqual([{ line: 3, checked: true }]);
  });

  test("lists a box inside a callout a block transform built", () => {
    const syntax = defineMarkdownSyntax({ blocks: [createCalloutTransform(["note"])] });
    const tasks = listTasks(parseMarkdown("> [!note] T\n> - [x] a", syntax)).map(({ line, checked }) => ({ line, checked }));
    expect(tasks).toEqual([{ line: 2, checked: true }]);
  });

  test("answers absolute offsets for a list item the unit cache reused at a later position", () => {
    const cache = createUnitCache();
    const first = parseMarkdown("- [ ] a", undefined, cache);
    const second = parseMarkdown("intro\n\n- [ ] a", undefined, cache);

    expect(second.units[1]?.node).toBe(first.units[0]?.node);
    expect(listTasks(second)).toEqual([{ line: 3, offset: 9, checked: false }]);
    expect(listTasks(first)).toEqual([{ line: 1, offset: 2, checked: false }]);
  });

  test("counts a leading byte order mark in the offset", () => {
    expect(tasksOf("\u{feff}- [x] a")).toEqual([{ line: 1, offset: 3, checked: true }]);
  });
});

describe("a tally over listTasks", () => {
  const cases: readonly { name: string; source: string; expected: { done: number; total: number } }[] = [
    { name: "counts ticked boxes out of every box", source: "- [x] a\n- [ ] b\n- [X] c", expected: { done: 2, total: 3 } },
    { name: "counts none for an empty source", source: "", expected: { done: 0, total: 0 } },
    { name: "counts none for a source with no boxes", source: "plain", expected: { done: 0, total: 0 } },
    { name: "leaves out a box inside a fence", source: "```\n- [x] a\n```\n- [ ] b", expected: { done: 0, total: 1 } },
    {
      name: "counts a box on the line after a lone table header row (task-forge: 1/1)",
      source: "| h |\n- [x] a -- b\n\n- [x] c",
      expected: { done: 2, total: 2 },
    },
  ];

  for (const { name, source, expected } of cases) {
    test(name, () => {
      expect(tally(source)).toEqual(expected);
    });
  }
});

describe("setTasks", () => {
  const rewrites: readonly { name: string; source: string; lines: readonly number[]; expected: string }[] = [
    { name: "ticks the boxes on the given lines", source: "- [ ] a\n- [ ] b", lines: [2], expected: "- [ ] a\n- [x] b" },
    { name: "unticks every box not on a given line", source: "- [x] a\n- [x] b", lines: [1], expected: "- [x] a\n- [ ] b" },
    { name: "unticks a box ticked in capitals", source: "- [X] a", lines: [], expected: "- [ ] a" },
    { name: "leaves a box ticked in capitals unchanged when it stays ticked", source: "- [X] a", lines: [1], expected: "- [X] a" },
    { name: "ticks a box on a star bullet", source: "* [ ] a", lines: [1], expected: "* [x] a" },
    { name: "ticks an indented box, keeping its indent and spacing", source: "- p\n  -   [ ]   a", lines: [2], expected: "- p\n  -   [x]   a" },
    { name: "ticks a box whose label holds brackets of its own", source: "- [ ] [ ] a", lines: [1], expected: "- [x] [ ] a" },
    {
      name: "ticks a box on an ordered item (task-forge: ignores the line)",
      source: "plain [ ] text\n- [ ] a\n1. [ ] b",
      lines: [3],
      expected: "plain [ ] text\n- [ ] a\n1. [x] b",
    },
    {
      name: "ticks boxes on the line after a lone table header row (task-forge: leaves it)",
      source: "| h |\n- [ ] a -- b\n\n- [ ] c",
      lines: [2, 4],
      expected: "| h |\n- [x] a -- b\n\n- [x] c",
    },
    {
      name: "unticks a box on the line after a lone table header row (task-forge: leaves it)",
      source: "| h |\n- [x] a -- b",
      lines: [],
      expected: "| h |\n- [ ] a -- b",
    },
    { name: "keeps a source's CRLF terminators", source: "- [ ] a\r\n- [ ] b\r\n", lines: [2], expected: "- [ ] a\r\n- [x] b\r\n" },
    { name: "ticks a box written with a tab between its brackets", source: "- [\t] a", lines: [1], expected: "- [x] a" },
    { name: "ticks and unticks boxes in nested blockquotes", source: "> - [ ] q\n> > 1. [x] r", lines: [1], expected: "> - [x] q\n> > 1. [ ] r" },
  ];

  for (const { name, source, lines, expected } of rewrites) {
    test(name, () => {
      expect(ticked(source, lines)).toEqual({ ok: true, data: expected });
    });
  }

  const unchanged: readonly { name: string; source: string; lines: readonly number[] }[] = [
    { name: "returns the source unchanged when every box already matches", source: "Intro.\n\n- [x] a\n- [ ] b\n\ntrailing", lines: [3] },
    { name: "neither ticks nor unticks a box inside a fence", source: "```\n- [ ] a\n- [x] b\n```", lines: [] },
    { name: "returns a tab box that stays unticked unchanged", source: "- [\t] a", lines: [] },
  ];

  for (const { name, source, lines } of unchanged) {
    test(name, () => {
      const result = ticked(source, lines);
      expect(result.ok && result.data).toBe(source);
    });
  }

  const refusals: readonly { name: string; source: string; lines: readonly number[]; expected: readonly number[] }[] = [
    {
      name: "refuses a given line that holds no box (task-forge: ignores it)",
      source: "plain [ ] text\n- [ ] a\n1. [ ] b",
      lines: [1, 3],
      expected: [1],
    },
    { name: "refuses a given line past the end of the source (task-forge: ignores it)", source: "- [ ] a", lines: [6], expected: [6] },
    { name: "refuses a line whose box sits inside a fence", source: "```\n- [ ] a\n- [x] b\n```", lines: [2], expected: [2] },
    {
      name: "refuses every line that is not a box, in the order given",
      source: "- [ ] a\n- [ ] b",
      lines: [0, 2, 1.5, Number.NaN],
      expected: [0, 1.5, Number.NaN],
    },
  ];

  for (const { name, source, lines, expected } of refusals) {
    test(name, () => {
      expect(ticked(source, lines)).toEqual({ ok: false, error: expected });
    });
  }

  test("round-trips through listTasks to exactly the lines it was given", () => {
    const result = ticked("- [ ] a\n- [x] b\n* [X] c\n- [ ] d", [1, 3]);
    const next = result.ok ? result.data : "";

    expect(next).toBe("- [x] a\n- [ ] b\n* [X] c\n- [ ] d");
    expect(linesOf(next)).toEqual([
      { line: 1, checked: true },
      { line: 2, checked: false },
      { line: 3, checked: true },
      { line: 4, checked: false },
    ]);
    expect(tally(next)).toEqual({ done: 2, total: 4 });
  });

  test("is idempotent when applied twice with the same lines", () => {
    const once = ticked("- [ ] a\n- [x] b", [1]);
    const onceSource = once.ok ? once.data : "";
    expect(ticked(onceSource, [1])).toEqual({ ok: true, data: onceSource });
    expect(onceSource).toBe("- [x] a\n- [ ] b");
  });

  test("throws on a source other than the one the document was parsed from", () => {
    expect(() => setTasks("- [ ] b", parseMarkdown("- [ ] a"), new Set())).toThrow(/setTasks:/);
  });
});

const AGREEMENT_SOURCES: readonly string[] = [
  ...GFM_TASK_LISTS.map(({ markdown }) => markdown),
  "> - [ ] q\n> > 1. [x] r",
  "1. [ ] a\n2. [x] b\n\n3) [ ] c",
  "```\n- [x] b\n```\n- [ ] c",
  "~~~md\n> - [x] q\n~~~",
  "    - [x] i",
  "Tick [ ] here.",
  "- [x]joined",
  "- [ ]\n- [x]",
  "- [ ]\n  e",
  TASK_FORGE_MIXED,
];

describe("listTasks against the renderer", () => {
  for (const source of AGREEMENT_SOURCES) {
    test(`agrees with the rendered checkboxes for ${JSON.stringify(source)}`, () => {
      const document = parseMarkdown(source);
      const rendered = [...renderMarkdownHtml(document, { schema: SPEC_SCHEMA }).matchAll(/<input type="checkbox"( checked)?/g)].map(
        ([, checked]) => checked !== undefined,
      );
      expect(listTasks(document).map(({ checked }) => checked)).toEqual(rendered);
    });

    test(`points each offset and line at a box bracket in ${JSON.stringify(source)}`, () => {
      const document = parseMarkdown(source);
      const lines = source.split(/\r\n|\r|\n/);
      for (const { line, offset } of listTasks(document)) {
        const column = offset - (document.lineStarts[line - 1] ?? Number.NaN);
        expect(source.slice(offset, offset + 3)).toMatch(/^\[[ \txX]\]$/);
        expect(lines[line - 1]?.slice(column, column + 3)).toMatch(/^\[[ \txX]\]$/);
      }
    });
  }

  test("finds boxes in the agreement sources, so the checks above are not vacuous", () => {
    expect(AGREEMENT_SOURCES.flatMap((source) => listTasks(parseMarkdown(source))).length).toBe(17);
  });
});

describe("setTasks rewriting only box bytes", () => {
  for (const source of AGREEMENT_SOURCES) {
    test(`changes nothing but the character between a box's brackets in ${JSON.stringify(source)}`, () => {
      const document = parseMarkdown(source);
      const tasks = listTasks(document);
      const boxLines = tasks.map(({ line }) => line);
      const inners = new Set(tasks.map(({ offset }) => offset + 1));
      for (const lines of [[], boxLines, boxLines.filter((_, index) => index % 2 === 0)]) {
        const result = setTasks(source, document, new Set(lines));
        const next = result.ok ? result.data : "";
        expect(next.length).toBe(source.length);
        for (let index = 0; index < source.length; index++) {
          if (next[index] !== source[index]) expect(inners.has(index)).toBe(true);
        }
        expect(linesOf(next).map(({ line, checked }) => checked === lines.includes(line))).toEqual(tasks.map(() => true));
      }
    });
  }
});

describe("rendered task values against listTasks", () => {
  const FORM_SCHEMA: HtmlSchema = {
    elements: { input: { attributes: ["type", "name", "value", "checked"] }, label: {}, ul: {}, ol: {}, li: {}, p: {}, blockquote: {}, aside: {} },
    url: ({ value }) => value,
  };

  function renderedValues(document: MarkdownDocument, handlers?: MarkdownNodeHandlers): number[] {
    const html = renderMarkdownHtml(document, { schema: FORM_SCHEMA, tasks: { name: "t" }, handlers });
    return [...html.matchAll(/value="(\d+)"/g)].map(([, line]) => Number(line));
  }

  const sources: readonly { name: string; source: string; expected: readonly number[] }[] = [
    { name: "task-forge's mixed source", source: TASK_FORGE_MIXED, expected: [1, 6, 8, 9] },
    { name: "a blockquote and an ordered list", source: "> - [x] q\n\n1. [ ] o\n", expected: [1, 3] },
    { name: "three levels of nesting", source: "- [x] a\n  - [ ] b\n    - [x] c\n", expected: [1, 2, 3] },
    { name: "CRLF terminators", source: "intro\r\n\r\n- [x] a\r\n  - [ ] b", expected: [3, 4] },
  ];

  for (const { name, source, expected } of sources) {
    test(`writes each box's listTasks line as its value in ${name}`, () => {
      const document = parseMarkdown(source);
      expect(renderedValues(document)).toEqual(expected);
      expect(listTasks(document).map(({ line }) => line)).toEqual(expected);
    });
  }

  test("writes each box's listTasks line as its value inside a callout", () => {
    const document = parseMarkdown("> [!note] T\n> - [x] a\n> - [ ] b", DIALECT_SYNTAX);
    expect(renderedValues(document, DIALECT_HANDLERS)).toEqual([2, 3]);
    expect(listTasks(document).map(({ line }) => line)).toEqual([2, 3]);
  });

  test("writes a footnote's box with the line listTasks reports, though the footnote renders last", () => {
    const document = parseMarkdown("- [ ] a\n\nx[^1]\n\n[^1]: - [x] fn\n");
    expect(renderedValues(document).toSorted((a, b) => a - b)).toEqual([1, 5]);
    expect(listTasks(document).map(({ line }) => line)).toEqual([1, 5]);
  });

  test("values a list item the unit cache reused by the line it sits on in each document", () => {
    const cache = createUnitCache();
    const first = parseMarkdown("- [ ] a", undefined, cache);
    const second = parseMarkdown("intro\n\n- [ ] a", undefined, cache);

    expect(second.units[1]?.node).toBe(first.units[0]?.node);
    expect(renderMarkdownHtml(second, { schema: FORM_SCHEMA, tasks: { name: "t" } })).toBe(
      '<p>intro</p>\n<ul>\n<li><label><input type="checkbox" name="t" value="3"> a</label></li>\n</ul>',
    );
    expect(renderMarkdownHtml(first, { schema: FORM_SCHEMA, tasks: { name: "t" } })).toBe(
      '<ul>\n<li><label><input type="checkbox" name="t" value="1"> a</label></li>\n</ul>',
    );
  });
});

describe("readListItemTask", () => {
  const document = parseMarkdown("intro\n\n- a\n- [x] b\n");
  const items = document.units.flatMap(({ node, start }) => (node.type === "listItem" ? [{ item: node, start }] : []));

  test("answers null for a plain item", () => {
    const [plain] = items;
    expect(plain && readListItemTask(document, plain.item, plain.start)).toBeNull();
  });

  test("answers a task item's box as listTasks reports it", () => {
    const [, task] = items;
    expect(task && readListItemTask(document, task.item, task.start)).toEqual({ line: 4, offset: 13, checked: true });
    expect(listTasks(document)).toEqual([{ line: 4, offset: 13, checked: true }]);
  });
});
