import { describe, expect, it } from "bun:test";

import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { DecorationSet, WidgetType } from "@codemirror/view";

import { createCalloutTransform } from "../../callout";
import { parseDialect } from "../../dialect.fixture";
import { parseMarkdown } from "../../document";
import { defineMarkdownSyntax } from "../../syntax";
import { walkMarkdown } from "../../walk";
import { buildDecorations, toggleTaskAt } from "./decorations";
import { viewportDialect } from "./dialect";
import { DIALECT_CASES } from "./dialect-cases.fixture";
import type { ConstructName, DialectCase } from "./dialect-cases.fixture";
import { TEST_DIALECT, testDialectSpans } from "./dialect.fixture";
import { parsedState } from "./parsed-state.fixture";
import { SHOWCASE_MARKDOWN } from "./showcase.fixture";
import { markdownSyntax } from "./syntax";
import type { DocumentSpan } from "./types";
import { renderedWidget } from "./widget-dom.fixture";

const DIALECT_SYNTAX: Extension = [markdownSyntax(), viewportDialect.of(TEST_DIALECT)];
const PAGE = "0190c7a0-0000-7000-8000-000000000001";
const ATT = "0190c7a0-0000-7000-8000-0000000000aa";

type Painted =
  | { readonly line: number; readonly class: string }
  | { readonly from: number; readonly to: number; readonly class: string }
  | { readonly from: number; readonly to: number; readonly widget: Record<string, unknown>; readonly atomic: boolean };

function spans(set: DecorationSet): { from: number; to: number }[] {
  const found: { from: number; to: number }[] = [];
  set.between(0, Number.MAX_SAFE_INTEGER, (from, to) => {
    found.push({ from, to });
  });
  return found;
}

function paint(doc: string, ranges?: readonly DocumentSpan[], extensions: Extension = []): Painted[] {
  const state = stateOf(doc, extensions);
  const { all, atomic } = buildDecorations(state, ranges ?? [{ from: 0, to: doc.length }]);
  const replaced = spans(atomic);
  const painted: Painted[] = [];
  all.between(0, Number.MAX_SAFE_INTEGER, (from, to, decoration) => {
    const spec = decoration.spec as { class?: string; widget?: WidgetType };
    if (spec.widget) {
      const isAtomic = replaced.some((cover) => cover.from === from && cover.to === to);
      painted.push({ from, to, widget: renderedWidget(spec.widget), atomic: isAtomic });
    } else if (from === to) {
      painted.push({ line: state.doc.lineAt(from).number, class: spec.class ?? "" });
    } else if (!replaced.some((cover) => cover.from <= from && to <= cover.to)) {
      painted.push({ from, to, class: spec.class ?? "" });
    }
  });
  return painted;
}

function span(doc: string, text: string, occurrence = 0): { from: number; to: number } {
  let from = -1;
  for (let seen = 0; seen <= occurrence; seen += 1) from = doc.indexOf(text, from + 1);
  if (from === -1) throw new Error(`"${text}" is not in the document`);
  return { from, to: from + text.length };
}

function mark(doc: string, text: string, className: string, occurrence = 0): Painted {
  return { ...span(doc, text, occurrence), class: className };
}

function checkbox(doc: string, text: string, checked: boolean, editable: boolean): Painted {
  return {
    ...span(doc, text),
    widget: {
      tag: "input",
      class: "cm-md-task",
      text: "",
      type: "checkbox",
      checked,
      disabled: !editable,
      attributes: { "aria-label": "Task done" },
      listeners: editable ? ["click", "mousedown"] : [],
    },
    atomic: true,
  };
}

function chip(doc: string, text: string, label: string, title: string): Painted {
  return { ...span(doc, text), widget: { tag: "span", class: "cm-md-link-chip", text: label, title }, atomic: true };
}

describe("buildDecorations for a heading", () => {
  for (const level of [1, 2, 3, 4, 5, 6]) {
    it(`sizes an ATX level-${level} heading's line and mutes its marker and space`, () => {
      const doc = `${"#".repeat(level)} Title`;

      expect(paint(doc)).toEqual([
        { line: 1, class: `cm-md-h${level}` },
        { from: 0, to: level + 1, class: "cm-md-marker" },
      ]);
    });
  }
});

describe("buildDecorations for a Setext heading", () => {
  it("sizes a Setext level-1 heading's text line as h1", () => {
    expect(paint("Title\n=====")).toEqual([{ line: 1, class: "cm-md-h1" }]);
  });

  it("sizes a Setext level-2 heading's text line as h2", () => {
    expect(paint("Title\n-----")).toEqual([{ line: 1, class: "cm-md-h2" }]);
  });
});

describe("buildDecorations for inline markers", () => {
  it("marks emphasis and mutes its markers", () => {
    const doc = "a *b* c";

    expect(paint(doc)).toEqual([mark(doc, "*b*", "cm-md-em"), mark(doc, "*", "cm-md-marker"), mark(doc, "*", "cm-md-marker", 1)]);
  });

  it("marks strong emphasis and mutes its markers", () => {
    const doc = "a **b** c";

    expect(paint(doc)).toEqual([mark(doc, "**b**", "cm-md-strong"), mark(doc, "**", "cm-md-marker"), mark(doc, "**", "cm-md-marker", 1)]);
  });

  it("marks inline code and mutes its markers", () => {
    const doc = "a `b` c";

    expect(paint(doc)).toEqual([mark(doc, "`b`", "cm-md-code"), mark(doc, "`", "cm-md-marker"), mark(doc, "`", "cm-md-marker", 1)]);
  });

  it("leaves a fence's markers alone", () => {
    expect(paint("```\ncode\n```")).toEqual([]);
  });

  it("marks strikethrough and mutes its markers", () => {
    const doc = "a ~~b~~ c";

    expect(paint(doc)).toEqual([mark(doc, "~~b~~", "cm-md-strike"), mark(doc, "~~", "cm-md-marker"), mark(doc, "~~", "cm-md-marker", 1)]);
  });

  it("leaves a single tilde pair alone", () => {
    expect(paint("~x~")).toEqual([]);
  });

  it("marks a link and mutes its brackets and parentheses", () => {
    const doc = "a [b](u) c";

    expect(paint(doc)).toEqual([
      mark(doc, "[b](u)", "cm-md-link"),
      mark(doc, "[", "cm-md-marker"),
      mark(doc, "]", "cm-md-marker"),
      mark(doc, "(", "cm-md-marker"),
      mark(doc, ")", "cm-md-marker"),
    ]);
  });

  it("gives a quote's line the quote class and mutes its marker", () => {
    expect(paint("> q")).toEqual([
      { line: 1, class: "cm-md-quote" },
      { from: 0, to: 1, class: "cm-md-marker" },
    ]);
  });
});

describe("buildDecorations for a highlight", () => {
  it("mutes the == markers and highlights what they hold", () => {
    const doc = "a ==hi== b";

    expect(paint(doc)).toEqual([mark(doc, "==", "cm-md-marker"), mark(doc, "hi", "cm-md-highlight"), mark(doc, "==", "cm-md-marker", 1)]);
  });

  it("highlights through a spaced == up to the closing pair", () => {
    const doc = "x ==a == b== y";

    expect(paint(doc)).toEqual([mark(doc, "==", "cm-md-marker"), mark(doc, "a == b", "cm-md-highlight"), mark(doc, "==", "cm-md-marker", 2)]);
  });

  it("leaves a highlight in inline code alone", () => {
    const doc = "`==hi==`";

    expect(paint(doc)).toEqual([mark(doc, doc, "cm-md-code"), mark(doc, "`", "cm-md-marker"), mark(doc, "`", "cm-md-marker", 1)]);
  });
});

describe("buildDecorations for a wikilink", () => {
  it("replaces a page link with an atomic chip showing its label and titled with its target", () => {
    const doc = `see [[${PAGE}|Budget]] now`;

    expect(paint(doc)).toEqual([chip(doc, `[[${PAGE}|Budget]]`, "Budget", PAGE)]);
  });

  it("shows the target on a chip with no label", () => {
    const doc = `[[${PAGE}]]`;

    expect(paint(doc)).toEqual([chip(doc, doc, PAGE, PAGE)]);
  });

  it("replaces a heading link with a chip titled with the page and heading", () => {
    const doc = `[[${PAGE}#goals|Goals]]`;

    expect(paint(doc)).toEqual([chip(doc, doc, "Goals", `${PAGE}#goals`)]);
  });

  it("replaces a section link with a chip", () => {
    const doc = `[[s:${PAGE}|Clients]]`;

    expect(paint(doc)).toEqual([chip(doc, doc, "Clients", `s:${PAGE}`)]);
  });

  it("replaces a notebook link with a chip", () => {
    const doc = `[[nb:${PAGE}|Journal]]`;

    expect(paint(doc)).toEqual([chip(doc, doc, "Journal", `nb:${PAGE}`)]);
  });

  it("reads an escaped separator inside a table row", () => {
    const doc = `| a |\n| --- |\n| [[${PAGE}\\|Budget]] |`;

    expect(paint(doc)).toEqual([chip(doc, `[[${PAGE}\\|Budget]]`, "Budget", PAGE)]);
  });

  it("marks a bare [[Title]] unresolved without replacing it, and paints no link or marker inside it", () => {
    const doc = "see [[Budget]] now";

    expect(paint(doc)).toEqual([mark(doc, "[[Budget]]", "cm-md-unresolved")]);
  });

  it("paints no link inside a bare [[Some Page]] in a list", () => {
    const doc = "2) second with [[Some Page]]";

    expect(paint(doc)).toEqual([mark(doc, "[[Some Page]]", "cm-md-unresolved")]);
  });

  it("leaves a wikilink in inline code alone", () => {
    const doc = `\`[[${PAGE}|Budget]]\``;

    expect(paint(doc)).toEqual([mark(doc, doc, "cm-md-code"), mark(doc, "`", "cm-md-marker"), mark(doc, "`", "cm-md-marker", 1)]);
  });
});

describe("buildDecorations for an embed", () => {
  it("replaces an attachment embed with an atomic chip showing its alt text", () => {
    const doc = `![[att:${ATT}|Receipt]]`;

    expect(paint(doc)).toEqual([{ from: 0, to: doc.length, widget: { tag: "span", class: "cm-md-attachment", text: "Receipt" }, atomic: true }]);
  });

  it("names an attachment with no alt text Attachment", () => {
    const doc = `![[att:${ATT}]]`;

    expect(paint(doc)).toEqual([{ from: 0, to: doc.length, widget: { tag: "span", class: "cm-md-attachment", text: "Attachment" }, atomic: true }]);
  });
});

describe("buildDecorations for a tag", () => {
  it("marks a tag", () => {
    const doc = "pay #finance today";

    expect(paint(doc)).toEqual([mark(doc, "#finance", "cm-md-tag")]);
  });

  it("marks a nested tag with its path", () => {
    const doc = "#work/q3-plans";

    expect(paint(doc)).toEqual([mark(doc, "#work/q3-plans", "cm-md-tag")]);
  });

  it("leaves a tag in inline code alone", () => {
    const doc = "`#finance`";

    expect(paint(doc)).toEqual([mark(doc, doc, "cm-md-code"), mark(doc, "`", "cm-md-marker"), mark(doc, "`", "cm-md-marker", 1)]);
  });

  it("leaves a tag in a link's text alone", () => {
    const doc = "[see #finance](u)";

    expect(paint(doc)).toEqual([
      mark(doc, doc, "cm-md-link"),
      mark(doc, "[", "cm-md-marker"),
      mark(doc, "]", "cm-md-marker"),
      mark(doc, "(", "cm-md-marker"),
      mark(doc, ")", "cm-md-marker"),
    ]);
  });

  it("leaves a tag in a wikilink's label alone", () => {
    const doc = `[[${PAGE}|see #finance]]`;

    expect(paint(doc)).toEqual([chip(doc, doc, "see #finance", PAGE)]);
  });

  it("leaves a # followed by a digit alone", () => {
    expect(paint("issue #12")).toEqual([]);
  });

  it("marks a tag in square brackets that link to nothing", () => {
    const doc = "[#notatag]";

    expect(paint(doc)).toEqual([
      mark(doc, doc, "cm-md-link"),
      mark(doc, "[", "cm-md-marker"),
      mark(doc, "#notatag", "cm-md-tag"),
      mark(doc, "]", "cm-md-marker"),
    ]);
  });

  it("marks a tag between raw HTML lines, which render as text", () => {
    const doc = "<div>\n#x\n</div>";

    expect(paint(doc)).toEqual([mark(doc, "#x", "cm-md-tag")]);
  });
});

describe("buildDecorations for a task", () => {
  it("replaces an open task's marker with an unchecked, labelled checkbox that listens for clicks in an editable state", () => {
    const doc = "- [ ] call";

    expect(paint(doc)).toEqual([checkbox(doc, "[ ]", false, true)]);
  });

  it("checks the checkbox for a task ticked with x", () => {
    const doc = "- [x] call";

    expect(paint(doc)).toEqual([checkbox(doc, "[x]", true, true)]);
  });

  it("checks the checkbox for a task ticked with X", () => {
    const doc = "- [X] call";

    expect(paint(doc)).toEqual([checkbox(doc, "[X]", true, true)]);
  });
});

const NOT_EDITABLE: readonly { readonly name: string; readonly extensions: Extension }[] = [
  { name: "a read-only, non-editable state", extensions: [EditorView.editable.of(false), EditorState.readOnly.of(true)] },
  { name: "a read-only state", extensions: EditorState.readOnly.of(true) },
  { name: "a non-editable state", extensions: EditorView.editable.of(false) },
];

describe("buildDecorations for a task outside an editable state", () => {
  for (const { name, extensions } of NOT_EDITABLE) {
    it(`renders the checkbox disabled and listening for nothing in ${name}`, () => {
      const doc = "- [x] call";

      expect(paint(doc, undefined, extensions)).toEqual([checkbox(doc, "[x]", true, false)]);
    });
  }
});

const TOGGLES: readonly { readonly form: string; readonly doc: string; readonly toggled: string }[] = [
  { form: "an open dash task", doc: "- [ ] call", toggled: "- [x] call" },
  { form: "a ticked star task", doc: "* [x] call", toggled: "* [ ] call" },
  { form: "an ordered task ticked with X", doc: "1. [X] call", toggled: "1. [ ] call" },
  { form: "a nested task", doc: "- plan\n  - [ ] call", toggled: "- plan\n  - [x] call" },
  { form: "a task inside a quote", doc: "> - [ ] call", toggled: "> - [x] call" },
];

describe("toggleTaskAt", () => {
  for (const { form, doc, toggled } of TOGGLES) {
    it(`flips ${form}'s marker as one input edit`, () => {
      const state = EditorState.create({ doc });

      const spec = toggleTaskAt(state, doc.indexOf("["));
      if (spec === null) throw new Error(`no toggle for ${JSON.stringify(doc)}`);
      const tr = state.update(spec);

      expect([tr.state.doc.toString(), tr.isUserEvent("input")]).toEqual([toggled, true]);
    });
  }

  for (const { name, extensions } of NOT_EDITABLE.slice(1)) {
    it(`refuses in ${name}`, () => {
      const doc = "- [ ] call";

      expect(toggleTaskAt(EditorState.create({ doc, extensions }), doc.indexOf("["))).toBeNull();
    });
  }

  it("refuses a position where no task marker starts", () => {
    expect(toggleTaskAt(EditorState.create({ doc: "- [ ] call" }), 0)).toBeNull();
  });
});

describe("buildDecorations for a due date", () => {
  it("marks a due: date on a task", () => {
    const doc = "- [ ] pay due:2026-10-01";

    expect(paint(doc)).toEqual([checkbox(doc, "[ ]", false, true), mark(doc, "due:2026-10-01", "cm-md-due")]);
  });

  it("marks a calendar-emoji date on a task", () => {
    const doc = "- [ ] pay 📅 2026-10-01";

    expect(paint(doc)).toEqual([checkbox(doc, "[ ]", false, true), mark(doc, "📅 2026-10-01", "cm-md-due")]);
  });

  it("leaves a due: date outside a task alone", () => {
    expect(paint("pay due:2026-10-01 please")).toEqual([]);
  });

  it("leaves a calendar-emoji date outside a task alone", () => {
    expect(paint("pay 📅 2026-10-01 please")).toEqual([]);
  });

  it("leaves a due date in inline code on a task alone", () => {
    const doc = "- [ ] `due:2026-10-01`";

    expect(paint(doc)).toEqual([
      checkbox(doc, "[ ]", false, true),
      mark(doc, "`due:2026-10-01`", "cm-md-code"),
      mark(doc, "`", "cm-md-marker"),
      mark(doc, "`", "cm-md-marker", 1),
    ]);
  });
});

describe("buildDecorations for a callout", () => {
  it("gives every line of a warning callout the callout and kind classes", () => {
    const doc = "> [!warning] Careful\n> body\n> more";

    expect(paint(doc)).toEqual([
      { line: 1, class: "cm-md-callout cm-md-callout-warning" },
      { from: 0, to: 1, class: "cm-md-marker" },
      mark(doc, "[", "cm-md-marker"),
      mark(doc, "]", "cm-md-marker"),
      { line: 2, class: "cm-md-callout cm-md-callout-warning" },
      mark(doc, ">", "cm-md-marker", 1),
      { line: 3, class: "cm-md-callout cm-md-callout-warning" },
      mark(doc, ">", "cm-md-marker", 2),
    ]);
  });

  for (const kind of ["note", "tip", "danger", "conflict"]) {
    it(`gives a ${kind} callout its kind class`, () => {
      const doc = `> [!${kind}] T`;

      expect(paint(doc)).toEqual([
        { line: 1, class: `cm-md-callout cm-md-callout-${kind}` },
        { from: 0, to: 1, class: "cm-md-marker" },
        mark(doc, "[", "cm-md-marker"),
        mark(doc, "]", "cm-md-marker"),
      ]);
    });
  }

  it("gives every line of a plain blockquote the quote class and no callout class", () => {
    const doc = "> just a quote\n> second line";

    expect(paint(doc)).toEqual([
      { line: 1, class: "cm-md-quote" },
      { from: 0, to: 1, class: "cm-md-marker" },
      { line: 2, class: "cm-md-quote" },
      mark(doc, ">", "cm-md-marker", 1),
    ]);
  });

  it("gives a blockquote with an unknown callout kind the quote class, and reads its marker as a link", () => {
    const doc = "> [!aside] T";

    expect(paint(doc)).toEqual([
      { line: 1, class: "cm-md-quote" },
      { from: 0, to: 1, class: "cm-md-marker" },
      mark(doc, "[!aside]", "cm-md-link"),
      mark(doc, "[", "cm-md-marker"),
      mark(doc, "]", "cm-md-marker"),
    ]);
  });
});

const CALLOUT_CASES: readonly { readonly markdown: string; readonly callout: boolean }[] = [
  { markdown: "> [!note] T", callout: true },
  { markdown: ">[!note] T", callout: true },
  { markdown: ">  [!note] T", callout: true },
  { markdown: ">    [!note] T", callout: true },
  { markdown: ">\t[!note] T", callout: true },
  { markdown: "> [!NOTE]", callout: true },
  { markdown: "> [!note]x", callout: false },
  { markdown: ">     [!note] T", callout: false },
  { markdown: "> [!aside] T", callout: false },
  { markdown: "> \\[!note] T", callout: false },
];

describe("callouts read alike in the editor and the engine", () => {
  const syntax = defineMarkdownSyntax({ blocks: [createCalloutTransform(["note"])] });
  const dialect: Extension = viewportDialect.of({ spans: () => [], calloutKinds: ["note"] });

  for (const { markdown, callout } of CALLOUT_CASES) {
    it(`${callout ? "reads" : "does not read"} ${JSON.stringify(markdown)} as a callout, in both`, () => {
      const engine = parseMarkdown(markdown, syntax).units[0]?.node.type === "callout";
      const editor = paint(markdown, undefined, dialect).some((painted) => "line" in painted && painted.class.includes("cm-md-callout"));

      expect([engine, editor]).toEqual([callout, callout]);
    });
  }
});

describe("buildDecorations with no dialect", () => {
  it("reads a callout marker as a link in a plain quote, and paints no dialect construct", () => {
    const doc = "> [!note] #t ==hi==";
    const state = parsedState(EditorState.create({ doc, extensions: markdownSyntax() }));
    const classes: string[] = [];
    buildDecorations(state, [{ from: 0, to: doc.length }]).all.between(0, doc.length, (_from, _to, decoration) => {
      classes.push(String((decoration.spec as { class?: string }).class));
    });

    expect(classes).toEqual(["cm-md-quote", "cm-md-marker", "cm-md-link", "cm-md-marker", "cm-md-marker"]);
  });
});

describe("buildDecorations for dollar signs", () => {
  it("paints nothing", () => {
    expect(paint("area $x^2$ here")).toEqual([]);
  });
});

describe("buildDecorations for a dot fence", () => {
  it("paints nothing", () => {
    expect(paint("```dot\na -> b\n```")).toEqual([]);
  });
});

describe("buildDecorations over the visible ranges", () => {
  const DOC = "first #alpha paragraph\n\nsecond #beta paragraph";

  it("widens a range cutting into a paragraph to the whole paragraph", () => {
    expect(paint(DOC, [{ from: 0, to: 2 }])).toEqual([mark(DOC, "#alpha", "cm-md-tag")]);
  });

  it("leaves a paragraph no range touches undecorated", () => {
    const from = DOC.indexOf("second");

    expect(paint(DOC, [{ from, to: from + 2 }])).toEqual([mark(DOC, "#beta", "cm-md-tag")]);
  });

  it("reuses an unedited paragraph's spans from the cache it is given", () => {
    const before = EditorState.create({ doc: DOC, extensions: DIALECT_SYNTAX });
    const first = buildDecorations(before, [{ from: 0, to: DOC.length }]);
    const after = before.update({ changes: { from: DOC.indexOf(" paragraph", DOC.indexOf("second")), insert: " edited" } }).state;

    const cached = first.cache.get("first #alpha paragraph");

    const next = buildDecorations(after, [{ from: 0, to: after.doc.length }], first.cache);

    expect(cached).toEqual([{ kind: "tag", ...span("first #alpha paragraph", "#alpha") }]);
    expect(next.cache.get("first #alpha paragraph")).toBe(cached);
  });

  it("keeps in its returned cache only the paragraphs the ranges touch", () => {
    const state = EditorState.create({ doc: DOC, extensions: DIALECT_SYNTAX });
    const whole = buildDecorations(state, [{ from: 0, to: DOC.length }]);

    expect([...buildDecorations(state, [{ from: 0, to: 2 }], whole.cache).cache.keys()]).toEqual(["first #alpha paragraph"]);
  });
});

describe("buildDecorations as presentation", () => {
  it("changes no text", () => {
    const doc = `# Plan\n\n- [ ] pay #finance due:2026-10-01 [[${PAGE}|Budget]] ==now== $x$\n\n> [!note] T\n`;
    const state = EditorState.create({ doc, extensions: DIALECT_SYNTAX });

    buildDecorations(state, [{ from: 0, to: doc.length }]);

    expect(state.doc.toString()).toBe(doc);
  });

  it("makes only the replaced constructs atomic", () => {
    const doc = `- [ ] [[${PAGE}|Budget]] [[Bare]] #tag`;
    const state = EditorState.create({ doc, extensions: DIALECT_SYNTAX });

    expect(spans(buildDecorations(state, [{ from: 0, to: doc.length }]).atomic)).toEqual([span(doc, "[ ]"), span(doc, `[[${PAGE}|Budget]]`)]);
  });
});

interface ConstructSpan {
  readonly construct: ConstructName;
  readonly from: number;
  readonly to: number;
}

const RENDERED_CONSTRUCTS: Readonly<Record<string, ConstructName>> = {
  tag: "tag",
  wikiLink: "wikilink",
  embed: "embed",
  highlight: "highlight",
  taskDue: "due",
  delete: "strikethrough",
};

const PAINTED_CONSTRUCTS: Readonly<Record<string, ConstructName>> = {
  "cm-md-tag": "tag",
  "cm-md-due": "due",
  "cm-md-unresolved": "wikilink",
  "cm-md-link-chip": "wikilink",
  "cm-md-attachment": "embed",
};

const FOREIGN_NODES = ["Subscript", "Superscript", "Emoji"];

function inOrder(found: ConstructSpan[]): ConstructSpan[] {
  return found.toSorted((a, b) => a.from - b.from || a.to - b.to || a.construct.localeCompare(b.construct));
}

function expectedSpans(dialect: DialectCase): ConstructSpan[] {
  let previous = -1;
  return dialect.spans.map(({ construct, text }) => {
    const from = dialect.markdown.indexOf(text, previous + 1);
    if (from === -1) throw new Error(`"${text}" is not in "${dialect.name}" after offset ${previous}`);
    previous = from;
    return { construct, from, to: from + text.length };
  });
}

function rendererSpans(md: string): ConstructSpan[] {
  const found: ConstructSpan[] = [];
  walkMarkdown(parseDialect(md), (node, { base }) => {
    const construct = RENDERED_CONSTRUCTS[node.type];
    if (construct) found.push({ construct, from: base + node.start, to: base + node.end });
    return undefined;
  });
  return inOrder(found);
}

function stateOf(md: string, extensions: Extension = []): EditorState {
  return parsedState(EditorState.create({ doc: md, extensions: [DIALECT_SYNTAX, extensions] }));
}

function treeNodeNames(md: string): Set<string> {
  const names = new Set<string>();
  syntaxTree(stateOf(md)).iterate({ enter: (node) => void names.add(node.name) });
  return names;
}

function editorSpans(md: string): ConstructSpan[] {
  const found: ConstructSpan[] = [];
  for (const painted of paint(md)) {
    if ("line" in painted) continue;
    const className = "widget" in painted ? String(painted.widget.class) : painted.class;
    if (className === "cm-md-highlight") found.push({ construct: "highlight", from: painted.from - 2, to: painted.to + 2 });
    const construct = PAINTED_CONSTRUCTS[className];
    if (construct) found.push({ construct, from: painted.from, to: painted.to });
  }
  syntaxTree(stateOf(md)).iterate({
    enter: (node) => {
      if (node.name === "Strikethrough") found.push({ construct: "strikethrough", from: node.from, to: node.to });
    },
  });
  return inOrder(found);
}

describe("buildDecorations against the renderer's dialect", () => {
  for (const dialect of DIALECT_CASES) {
    it(`renders ${dialect.name} as the dialect rules say`, () => {
      expect(rendererSpans(dialect.markdown)).toEqual(expectedSpans(dialect));
    });

    it(`decorates ${dialect.name} where the renderer finds it`, () => {
      expect(editorSpans(dialect.markdown)).toEqual(rendererSpans(dialect.markdown));
    });

    it(`parses ${dialect.name} with no subscript, superscript or emoji node`, () => {
      const names = treeNodeNames(dialect.markdown);

      expect(FOREIGN_NODES.filter((name) => names.has(name))).toEqual([]);
    });
  }

  const SHOWCASE = SHOWCASE_MARKDOWN;

  it("decorates the showcase where the renderer finds its constructs", () => {
    expect(editorSpans(SHOWCASE)).toEqual(rendererSpans(SHOWCASE));
  });

  it("finds every dialect construct in the showcase", () => {
    const constructs = new Set(rendererSpans(SHOWCASE).map((found) => found.construct));

    expect([...constructs].toSorted()).toEqual(["due", "embed", "highlight", "strikethrough", "tag", "wikilink"]);
  });

  it("parses the showcase with no subscript, superscript or emoji node", () => {
    const names = treeNodeNames(SHOWCASE);

    expect(FOREIGN_NODES.filter((name) => names.has(name))).toEqual([]);
  });

  it("marks a tag in a reference link whose definition sits in another paragraph, which the renderer reads as link text (known limit)", () => {
    const md = "[#x]\n\n[#x]: /u";

    expect([rendererSpans(md), editorSpans(md)]).toEqual([[], [{ construct: "tag", ...span(md, "#x") }]]);
  });

  it("misses a highlight that crosses a line the editor reads as an HTML block, which the renderer reads as text (known limit)", () => {
    const md = "==a\n<div>\nb==";

    expect([rendererSpans(md), editorSpans(md)]).toEqual([[{ construct: "highlight", from: 0, to: md.length }], []]);
  });
});

describe("the test dialect's wikilink spans", () => {
  it("starts a labelled title link's label after the pipe", () => {
    const text = "[[a|b]]";

    expect(testDialectSpans(text)).toEqual([{ kind: "wikilink", from: 0, to: text.length, labelFrom: 4, chip: undefined }]);
  });

  it("starts an unlabelled title link's label after the opening brackets", () => {
    const text = "[[Some Page]]";

    expect(testDialectSpans(text)).toEqual([{ kind: "wikilink", from: 0, to: text.length, labelFrom: 2, chip: undefined }]);
  });

  it("starts the label after an escaped pipe in a table cell", () => {
    const text = "| a |\n| --- |\n| [[a\\|b]] |";
    const from = text.indexOf("[[");

    expect(testDialectSpans(text)).toEqual([{ kind: "wikilink", from, to: from + "[[a\\|b]]".length, labelFrom: from + 5, chip: undefined }]);
  });

  it("measures offsets from the start of the text it is given", () => {
    const text = "see [[a|b]] now";

    expect(testDialectSpans(text)).toEqual([{ kind: "wikilink", from: 4, to: 11, labelFrom: 8, chip: undefined }]);
  });

  it("carries an id-form link's label and target as its chip", () => {
    const text = `[[${PAGE}|Budget]]`;

    expect(testDialectSpans(text)).toEqual([
      { kind: "wikilink", from: 0, to: text.length, labelFrom: PAGE.length + 3, chip: { label: "Budget", target: PAGE } },
    ]);
  });
});
