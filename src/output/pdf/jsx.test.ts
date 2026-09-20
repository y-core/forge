import { describe, expect, test } from "bun:test";

import { Fragment, jsx } from "../../jsx/jsx-runtime";
import { Stack, Row, Text } from "./components";
import { createCursor } from "./cursor";
import { place } from "./elements";
import { Field, Heading } from "./form";
import { MARGIN, PAGE_WIDTH } from "./geometry";
import { paginate } from "./paginate";
import { toPdfElements } from "./tree";
import type { PdfBox, PdfContent, PdfDocument, PdfElement, PdfNode } from "./types";

const MEASURE: PdfBox = { x: MARGIN, width: PAGE_WIDTH - MARGIN * 2, height: 700 };

function nodesOf(content: PdfContent): PdfNode[] {
  const cursor = createCursor(undefined);
  cursor.newPage();
  const from = cursor.pages.at(-1)?.nodes.length ?? 0;
  for (const element of toPdfElements(content)) place(cursor, element, MEASURE);
  return (cursor.pages.at(-1)?.nodes ?? []).slice(from);
}

// What the transform emits for `<C a={1}>kids</C>`; writing it out keeps this file free of a .tsx
// pragma while testing exactly the call the compiler makes.
function h(type: unknown, props: Record<string, unknown>): PdfContent {
  return jsx(type as never, props) as unknown as PdfContent;
}

describe("a JSX descriptor tree renders through the engine, unevaluated", () => {
  test("a fragment of components produces the same display list as the factory array", () => {
    const viaJsx = h(Fragment, {
      children: [h(Heading, { children: "Part A - the declarant" }), h(Field, { fields: [{ label: "Surname", value: "Du Toit" }] })],
    });
    const viaFactory = [Heading({ children: "Part A - the declarant" }), Field({ fields: [{ label: "Surname", value: "Du Toit" }] })];
    expect(nodesOf(viaJsx)).toEqual(nodesOf(viaFactory));
  });

  test("a nested tree lowers its children before the parent is called, at every level", () => {
    const viaJsx = h(Stack, {
      gap: 8,
      children: [
        h(Heading, { children: "Declaration of interest" }),
        h(Row, { tracks: [8, 4], children: [h(Text, { children: "left" }), h(Text, { children: "right" })] }),
      ],
    });
    const viaFactory = Stack({
      gap: 8,
      children: [
        Heading({ children: "Declaration of interest" }),
        Row({ tracks: [8, 4], children: [Text({ children: "left" }), Text({ children: "right" })] }),
      ],
    });
    expect(nodesOf(viaJsx)).toEqual(nodesOf(viaFactory));
  });

  test("words stay words: a component whose children are text takes the text, not an empty array", () => {
    expect(nodesOf(h(Text, { children: "Du Toit" }))).toEqual(nodesOf(Text({ children: "Du Toit" })));
    expect(nodesOf(h(Text, { children: ["Du ", "Toit"] }))).toEqual(nodesOf(Text({ children: "Du Toit" })));
  });

  test("the README's document, written as markup, paginates", () => {
    const doc: PdfDocument = {
      title: "Declaration of interest",
      content: h(Fragment, {
        children: [h(Heading, { children: "Part A - the declarant" }), h(Field, { fields: [{ label: "Identity number" }] })],
      }),
    };
    const pages = paginate(doc);
    expect(pages).toHaveLength(1);
    expect((pages[0]?.nodes ?? []).filter((node) => node.kind === "text").map((node) => node.run)).toContain("PART A - THE DECLARANT");
  });
});

describe("the call shape the JSX claim rests on", () => {
  test("the runtime hands a component exactly the one props object the factory takes", () => {
    const descriptor = h(Stack, { gap: 8, children: [Text({ children: "one" })] }) as { type: unknown; props: Record<string, unknown> };
    expect(descriptor.type).toBe(Stack);
    expect(Object.keys(descriptor.props).sort()).toEqual(["children", "gap"]);
  });

  test("a second positional argument would be dropped, which is why the call shape is one object", () => {
    const twoArgument = (Text as unknown as (props: { children: string }, extra: unknown) => PdfElement)({ children: "x" }, { bold: true });
    expect(nodesOf(twoArgument)).toEqual(nodesOf(Text({ children: "x" })));
  });
});

describe("toPdfElements", () => {
  test("flattens arrays and drops what renders nothing", () => {
    const element = Text({ children: "x" });
    expect(toPdfElements([element, null, undefined, false, [element]])).toEqual([element, element]);
  });

  test("passes an element through untouched, so a hand-written tree needs no lowering", () => {
    const element = Text({ children: "x" });
    expect(toPdfElements(element)).toEqual([element]);
  });
});
