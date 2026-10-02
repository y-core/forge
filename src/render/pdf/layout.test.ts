import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { matchTextSnapshot } from "../../testing/snapshot";
import { Divider, PageBreak, PageNumber, Text } from "./components";
import { Field } from "./form";
import { Path } from "./graphics";
import { describePdfLayout, formatPdfLayout } from "./layout";
import { createPdfPalette } from "./palette";
import { createPdfPen } from "./path";
import { createPdfRenderer } from "./renderer";
import type { PdfDocument, PdfElement, PdfLayout, PdfRendererOptions } from "./types";

function documentOf(breaks: number, value = "Du Toit"): PdfDocument {
  const row = (): PdfElement => Field({ fields: [{ label: "Surname", value }] });
  const content: PdfElement[] = [row()];
  for (let at = 0; at < breaks; at += 1) content.push(PageBreak(), row());
  return { title: "Declaration", content };
}

function layoutOf(doc: PdfDocument, options: PdfRendererOptions = {}): PdfLayout {
  const described = describePdfLayout(doc, options);
  if (!described.ok) throw new Error(described.error.message);
  return described.data;
}

function linesOf(doc: PdfDocument, options: PdfRendererOptions = {}): string[] {
  return formatPdfLayout(layoutOf(doc, options)).split("\n").slice(0, -1);
}

describe("a layout is where every drawing of a document landed", () => {
  test("groups by the page that carries it, so a page is reached rather than filtered for", () => {
    expect(layoutOf(documentOf(2)).pages).toHaveLength(3);
  });

  test("carries the geometry a drawing was painted at, in the engine's own y-down space", () => {
    const answer = layoutOf(documentOf(0)).pages[0]?.nodes.find((node) => node.kind === "text" && node.tag === "value");
    expect(answer?.kind).toBe("text");
    if (answer?.kind !== "text") return;
    expect(answer.x).toBeGreaterThan(0);
    expect(answer.y).toBeGreaterThan(0);
    expect(answer.text).toBe("Du Toit");
  });

  test("keeps a path's role and its alt without inventing a position it has not got", () => {
    const pen = createPdfPen().move(0, 0).line(10, 10);
    const doc: PdfDocument = {
      title: "Declaration",
      content: [Path({ commands: pen.commands(), height: 10, alt: "The mark", stroke: [0, 0, 0] })],
    };
    const path = layoutOf(doc).pages[0]?.nodes.find((node) => node.tag === "artwork");
    expect(path).toEqual({ kind: "path", tag: "artwork", alt: "The mark" });
  });
});

// A palette makes `paginate` emit ink nodes, so an identical description under one is the strongest
// available statement that a change of paint cannot move a line of a committed fixture.
describe("paint state is not a drawing", () => {
  test("describes a document under a palette exactly as it describes it without one", () => {
    const palette = createPdfPalette({ heading: "#123456", rule: "#654321", letterhead: "#abcdef", intro: "#010203" });
    expect(palette.ok).toBe(true);
    if (!palette.ok) return;
    const doc = documentOf(1);
    expect(linesOf(doc, { palette: palette.data })).toEqual(linesOf(doc));
  });

  test("puts no ink node in the layout at all", () => {
    expect(
      layoutOf(documentOf(0))
        .pages.flatMap((page) => page.nodes)
        .some((node) => (node.kind as string) === "ink"),
    ).toBe(false);
  });
});

describe("a placeholder is resolved to the words the file actually carries", () => {
  const withFooter = (footer: PdfElement): PdfDocument => ({ ...documentOf(2), footer });

  test("reads the page it landed on, page by page", () => {
    const pages = layoutOf(withFooter(PageNumber())).pages;
    const numbers = pages.map((page) => page.nodes.flatMap((node) => (node.kind === "text" ? [node.text] : [])).at(-1));
    expect(numbers).toEqual(["1", "2", "3"]);
  });

  test("reads the count on every page where the count is what was asked for", () => {
    const pages = layoutOf(withFooter(PageNumber({ total: true }))).pages;
    const numbers = pages.map((page) => page.nodes.flatMap((node) => (node.kind === "text" ? [node.text] : [])).at(-1));
    expect(numbers).toEqual(["3", "3", "3"]);
  });

  test("never leaks the run a placeholder reserved width with", () => {
    expect(linesOf(withFooter(PageNumber())).join("\n")).not.toContain('text="00"');
  });
});

// The whole error rather than its `kind`, so the message a caller reads stays shared too: a
// description that succeeded for a document the renderer refuses would be worse than no description.
describe("a description is refused exactly where a render is", () => {
  const CASES: readonly { name: string; doc: PdfDocument; options: PdfRendererOptions }[] = [
    { name: "font", doc: documentOf(0), options: { defaultFont: { regular: "Unshipped", bold: "Unshipped" } } },
    { name: "max-pages", doc: documentOf(4), options: { maxPages: 2 } },
    { name: "encoding", doc: documentOf(0, "Du Toit 価"), options: {} },
  ];

  for (const { name, doc, options } of CASES) {
    test(`answers the same error as a render for ${name}`, async () => {
      const described = describePdfLayout(doc, options);
      const rendered = await createPdfRenderer(options).render(doc);
      expect(described.ok).toBe(false);
      expect(rendered.ok).toBe(false);
      if (described.ok || rendered.ok) return;
      expect(described.error).toEqual(rendered.error);
    });
  }
});

describe("the projection is the point: no display list is reachable through it", () => {
  test("a text node carries exactly the keys the layout declares, and none of the engine's", () => {
    const text = layoutOf(documentOf(0)).pages[0]?.nodes.find((node) => node.kind === "text");
    expect(Object.keys(text ?? {}).sort()).toEqual(["face", "kind", "size", "tag", "text", "tracking", "x", "y"]);
  });
});

describe("the format puts one drawing on one line", () => {
  test("writes every token as key=value, so nothing has to be counted to be read", () => {
    const label = linesOf(documentOf(0)).find((drawn) => drawn.includes("tag=label"));
    expect(label?.split(" ").slice(0, 3)).toEqual(["page=1", "kind=text", "tag=label"]);
    expect(label).toContain('text="Surname"');
  });

  test("numbers every geometry token to a fixed width, so a column does not move under a value", () => {
    for (const drawn of linesOf(documentOf(0))) {
      for (const token of drawn.matchAll(/(?:x|y|size|tracking|width|height)=(\S+)/g)) expect(token[1]).toMatch(/^-?\d+\.\d{3}$/);
    }
  });

  test("quotes the run, so no wording can break the one-drawing-per-line invariant", () => {
    const doc: PdfDocument = { title: "Declaration", content: [Text({ children: 'a "quoted" answer' })] };
    expect(linesOf(doc).filter((drawn) => drawn.includes("tag=value"))).toHaveLength(1);
    expect(linesOf(doc).join("\n")).toContain(String.raw`text="a \"quoted\" answer"`);
  });

  // Unnormalised, one drawing writes two different lines depending on the sign of a rounding error —
  // the churn the fixed-width scheme exists to stop, and the one line of the formatter it costs.
  test("normalises a value that rounds to negative zero, rather than writing -0.000", () => {
    const doc: PdfDocument = { title: "Declaration", content: [Text({ children: "Du Toit", tracking: -0.0001 })] };
    const drawn = linesOf(doc).find((line) => line.includes('text="Du Toit"'));
    expect(drawn).toContain("tracking=0.000");
    expect(drawn).not.toContain("-0.000");
  });

  test("terminates every line, so a committed fixture carries no trailing-newline noise", () => {
    expect(formatPdfLayout(layoutOf(documentOf(0))).endsWith("\n")).toBe(true);
  });

  test("formats an empty layout to an empty file rather than to a blank line", () => {
    expect(formatPdfLayout({ pages: [] })).toBe("");
    expect(formatPdfLayout({ pages: [{ nodes: [] }] })).toBe("");
  });

  test("names the page first, so a three-line diff hunk still locates itself", () => {
    const pages = linesOf(documentOf(2)).map((drawn) => drawn.split(" ")[0]);
    expect(new Set(pages)).toEqual(new Set(["page=1", "page=2", "page=3"]));
  });
});

// The precision claim this exists for: a wording change is one token on one line, and a geometry
// change is every line's geometry with its shape untouched.
describe("a change of one value moves one token of one line", () => {
  test("changes only what follows text= on the line that carries the value", () => {
    const before = linesOf(documentOf(0, "Du Toit"));
    const after = linesOf(documentOf(0, "Van Wyk"));
    expect(after).toHaveLength(before.length);
    const differing = before.flatMap((drawn, at) => (drawn === after[at] ? [] : [at]));
    expect(differing).toHaveLength(1);
    const at = differing[0] ?? 0;
    expect(before[at]?.split(" text=")[0]).toBe(after[at]?.split(" text=")[0]);
    expect(after[at]).toContain('text="Van Wyk"');
  });

  test("moves every x under a wider margin while leaving each line's page, kind and tag alone", () => {
    const narrow = linesOf(documentOf(0));
    const wide = linesOf(documentOf(0), { page: { margin: { left: 120 } } });
    expect(wide.map((drawn) => drawn.split(" ").slice(0, 3))).toEqual(narrow.map((drawn) => drawn.split(" ").slice(0, 3)));
    expect(wide).not.toEqual(narrow);
  });
});

// The claim `TEST_RUNNERS.md` §7h makes about this pair, held rather than stated: the formatter's
// output is what a fixture commits, and a geometry change arrives as a diff nobody had to write.
describe("a formatted layout is the text a committed fixture holds", () => {
  // Not `CI`, which this gate never sets: wiring it that way would regenerate a deleted fixture
  // green on every machine the gate is actually run on, which is the one thing a fixture stops.
  const UPDATING = process.env.SNAPSHOT_UPDATE === "1";
  const FIXTURE = resolve(import.meta.dir, "../../../tests/fixtures/pdf-layout/layout.txt");

  test("agrees with the fixture, line for line, across more than one kind of drawing", async () => {
    const pen = createPdfPen().move(0, 0).line(10, 10);
    const doc: PdfDocument = {
      title: "Declaration",
      content: [
        Field({ fields: [{ label: "Surname", value: "Du Toit" }] }),
        Path({ commands: pen.commands(), height: 10, alt: "The mark", stroke: [0, 0, 0] }),
      ],
    };
    const outcome = await matchTextSnapshot(formatPdfLayout(layoutOf(doc)), FIXTURE, { ci: !UPDATING, update: UPDATING });

    expect(outcome.ok ? "" : outcome.error.report).toBe("");
  });
});

describe("a rule is an artifact that draws, so it is in the layout and out of the reading order", () => {
  test("describes a divider as a path under its own tag", () => {
    const doc: PdfDocument = { title: "Declaration", content: [Divider()] };
    const bare: PdfDocument = { title: "Declaration", content: [] };
    const rules = (of: PdfDocument): number =>
      layoutOf(of).pages[0]?.nodes.filter((node) => node.kind === "path" && node.tag === "rule").length ?? 0;
    expect(rules(doc)).toBe(rules(bare) + 1);
  });
});
