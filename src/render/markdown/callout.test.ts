import { describe, expect, it } from "bun:test";

import { parseDialect } from "./dialect.fixture";
import { shapeOf } from "./tree.fixture";

function children(md: string) {
  return shapeOf(parseDialect(md)).children;
}

const BODY = [{ type: "paragraph", children: [{ type: "text", value: "body" }] }];

describe("callouts", () => {
  for (const kind of ["note", "tip", "warning", "danger", "conflict"]) {
    it(`turns > [!${kind}] into a callout of that kind`, () => {
      expect(children(`> [!${kind}] Title\n> body`)).toEqual([
        { type: "callout", kind, title: [{ type: "text", value: "Title" }], children: BODY },
      ]);
    });
  }

  it("reads the kind case-insensitively and stores it lowercased", () => {
    expect(children("> [!NOTE] T")).toEqual([{ type: "callout", kind: "note", title: [{ type: "text", value: "T" }], children: [] }]);
  });

  it("keeps inline formatting in the title", () => {
    expect(children("> [!note] A **bold** title\n> body")).toEqual([
      {
        type: "callout",
        kind: "note",
        title: [
          { type: "text", value: "A " },
          { type: "strong", children: [{ type: "text", value: "bold" }] },
          { type: "text", value: " title" },
        ],
        children: BODY,
      },
    ]);
  });

  it("has an empty title when none is written", () => {
    expect(children("> [!tip]")).toEqual([{ type: "callout", kind: "tip", title: [], children: [] }]);
  });

  it("takes the body from the line after an untitled marker", () => {
    expect(children("> [!note]\n> body")).toEqual([{ type: "callout", kind: "note", title: [], children: BODY }]);
  });

  it("keeps the rest of the first paragraph as the body's first paragraph", () => {
    expect(children("> [!note] a\n> b\n> c")).toEqual([
      {
        type: "callout",
        kind: "note",
        title: [{ type: "text", value: "a" }],
        children: [{ type: "paragraph", children: [{ type: "text", value: "b\nc" }] }],
      },
    ]);
  });

  it("ends the title at a hard break and drops the break", () => {
    expect(children("> [!note] T\\\n> body")).toEqual([{ type: "callout", kind: "note", title: [{ type: "text", value: "T" }], children: BODY }]);
  });

  it("trims trailing spaces from the title", () => {
    expect(children("> [!note] T  \n> body")).toEqual([{ type: "callout", kind: "note", title: [{ type: "text", value: "T" }], children: BODY }]);
  });

  it("keeps later blocks in the body after a blank quoted line", () => {
    expect(children("> [!note] T\n>\n> para\n> - item")).toEqual([
      {
        type: "callout",
        kind: "note",
        title: [{ type: "text", value: "T" }],
        children: [
          { type: "paragraph", children: [{ type: "text", value: "para" }] },
          {
            type: "list",
            ordered: false,
            start: null,
            spread: false,
            children: [
              { type: "listItem", spread: false, checked: null, children: [{ type: "paragraph", children: [{ type: "text", value: "item" }] }] },
            ],
          },
        ],
      },
    ]);
  });

  it("keeps a link definition in its body", () => {
    expect(children("> [!note] T\n>\n> [x]: /u\n")).toEqual([
      {
        type: "callout",
        kind: "note",
        title: [{ type: "text", value: "T" }],
        children: [{ type: "definition", identifier: "x", title: null, url: "/u" }],
      },
    ]);
  });

  it("turns a nested quote into a nested callout", () => {
    expect(children("> [!note] Outer\n> > [!tip] Inner\n> > body")).toEqual([
      {
        type: "callout",
        kind: "note",
        title: [{ type: "text", value: "Outer" }],
        children: [{ type: "callout", kind: "tip", title: [{ type: "text", value: "Inner" }], children: BODY }],
      },
    ]);
  });

  it("turns a quote inside a list item into a callout", () => {
    expect(children("- > [!tip] T\n  > body")).toEqual([
      {
        type: "list",
        ordered: false,
        start: null,
        spread: false,
        children: [
          {
            type: "listItem",
            spread: false,
            checked: null,
            children: [{ type: "callout", kind: "tip", title: [{ type: "text", value: "T" }], children: BODY }],
          },
        ],
      },
    ]);
  });

  it("recognises a callout when the page starts with a BOM", () => {
    expect(children("\uFEFF> [!note] T")).toEqual([{ type: "callout", kind: "note", title: [{ type: "text", value: "T" }], children: [] }]);
  });

  it("takes the blockquote's source span", () => {
    const [, unit] = parseDialect("x\n\n> [!note] T\n> body\n").units;
    expect([unit?.node.type, unit?.line, (unit?.start ?? 0) + (unit?.node.start ?? 0), (unit?.start ?? 0) + (unit?.node.end ?? 0)]).toEqual([
      "callout",
      3,
      3,
      21,
    ]);
  });

  it("recognises an untitled callout written with CRLF line endings", () => {
    expect(children("> [!note]\r\n> body")).toEqual([{ type: "callout", kind: "note", title: [], children: BODY }]);
  });

  it("ends the title at a CRLF line ending", () => {
    expect(children("> [!note] T\r\n> body")).toEqual([{ type: "callout", kind: "note", title: [{ type: "text", value: "T" }], children: BODY }]);
  });

  it("ends the title at a CR line ending", () => {
    expect(children("> [!note] T\r> body")).toEqual([{ type: "callout", kind: "note", title: [{ type: "text", value: "T" }], children: BODY }]);
  });
});

describe("callouts — plain blockquotes", () => {
  it("keeps an escaped \\[!note] as a blockquote", () => {
    expect(children("> \\[!note] T")).toEqual([
      { type: "blockquote", children: [{ type: "paragraph", children: [{ type: "text", value: "[!note] T" }] }] },
    ]);
  });

  it("keeps an entity-encoded &#91;!note] as a blockquote", () => {
    expect(children("> &#91;!note] T")).toEqual([
      { type: "blockquote", children: [{ type: "paragraph", children: [{ type: "text", value: "[!note] T" }] }] },
    ]);
  });

  it("keeps an unknown kind [!info] as a blockquote", () => {
    expect(children("> [!info] T")).toEqual([
      { type: "blockquote", children: [{ type: "paragraph", children: [{ type: "text", value: "[!info] T" }] }] },
    ]);
  });

  it("keeps a folding marker [!note]- as a blockquote", () => {
    expect(children("> [!note]- T")).toEqual([
      { type: "blockquote", children: [{ type: "paragraph", children: [{ type: "text", value: "[!note]- T" }] }] },
    ]);
  });

  it("keeps a marker run into its title as a blockquote", () => {
    expect(children("> [!note]T")).toEqual([
      { type: "blockquote", children: [{ type: "paragraph", children: [{ type: "text", value: "[!note]T" }] }] },
    ]);
  });

  it("keeps a quote whose first child is not a paragraph as a blockquote", () => {
    expect(children("> # h\n> [!note] x")).toEqual([
      {
        type: "blockquote",
        children: [
          { type: "heading", depth: 1, children: [{ type: "text", value: "h" }] },
          { type: "paragraph", children: [{ type: "text", value: "[!note] x" }] },
        ],
      },
    ]);
  });
});
