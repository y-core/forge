import { describe, expect, test } from "bun:test";

import { Fragment, jsx } from "../../jsx/jsx-runtime";
import { Stack, Text } from "./components";
import { Heading } from "./form";
import { toPdfElements } from "./tree";
import type { PdfContent } from "./types";

function h(type: unknown, props: Record<string, unknown>): PdfContent {
  return jsx(type as never, props) as unknown as PdfContent;
}

describe("toPdfElements", () => {
  test("passes an element straight through", () => {
    const element = Text({ children: "x" });
    expect(toPdfElements(element)).toEqual([element]);
  });

  test("flattens a nested array into one run of elements", () => {
    const element = Text({ children: "x" });
    expect(toPdfElements([element, [element, [element]]])).toHaveLength(3);
  });

  test("drops everything that renders nothing, so a conditional child needs no guard", () => {
    expect(toPdfElements([null, undefined, false, true])).toEqual([]);
    expect(toPdfElements(null)).toEqual([]);
  });

  test("calls a component descriptor with its own props", () => {
    expect(toPdfElements(h(Heading, { children: "Part A" }))).toHaveLength(1);
  });

  test("renders a fragment as its children, with no component of its own", () => {
    const tree = h(Fragment, { children: [h(Text, { children: "a" }), h(Text, { children: "b" })] });
    expect(toPdfElements(tree)).toHaveLength(2);
  });

  test("lowers children before the parent is called, so a component only ever sees elements", () => {
    let seen: unknown;
    const Probe = (props: { children: unknown }): unknown => {
      seen = props.children;
      return Stack({ children: props.children as never });
    };
    toPdfElements(h(Probe, { children: [h(Text, { children: "a" })] }));
    expect(Array.isArray(seen)).toBe(true);
    expect((seen as { fragments?: unknown }[])[0]?.fragments).toBeInstanceOf(Function);
  });

  test("keeps text children as text, so a component setting words is given words", () => {
    let seen: unknown;
    const Probe = (props: { children: unknown }): unknown => {
      seen = props.children;
      return Text({ children: "x" });
    };
    toPdfElements(h(Probe, { children: "Du Toit" }));
    expect(seen).toBe("Du Toit");
    toPdfElements(h(Probe, { children: ["Du ", "Toit"] }));
    expect(seen).toBe("Du Toit");
  });

  test("ignores a descriptor whose type is not a component", () => {
    expect(toPdfElements(h("div", { children: "x" }))).toEqual([]);
  });
});
