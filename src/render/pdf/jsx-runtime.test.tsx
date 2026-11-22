/** @jsxImportSource @y-core/forge/render/pdf */

import { describe, expect, test } from "bun:test";

import { Box, KeepTogether, Row, Stack, Text } from "./components";
import { createCursor } from "./cursor";
import { place } from "./elements";
import { Field, Heading } from "./form";
import { MARGIN, PAGE_WIDTH } from "./geometry";
import { Panel } from "./graphics";
import { Link } from "./link";
import { paginate } from "./paginate";
import { toPdfElements } from "./tree";
import type { PdfBox, PdfContent, PdfDocument, PdfElement, PdfNode, PdfTextNode } from "./types";

const MEASURE: PdfBox = { x: MARGIN, width: PAGE_WIDTH - MARGIN * 2, height: 700 };

function nodesOf(content: PdfContent): PdfNode[] {
  const cursor = createCursor(undefined);
  cursor.newPage();
  const from = cursor.pages.at(-1)?.nodes.length ?? 0;
  for (const element of toPdfElements(content)) place(cursor, element, MEASURE);
  return (cursor.pages.at(-1)?.nodes ?? []).slice(from);
}

// The README's sample, verbatim: if this file stops compiling, the documented spelling has stopped
// working, and the gate's typecheck step is what says so.
const doc: PdfDocument = {
  title: "Declaration of interest",
  content: (
    <>
      <Heading>Part A - the declarant</Heading>
      <Field fields={[{ label: "Surname", value: "Du Toit" }]} />
    </>
  ),
};

describe("the README's markup spelling compiles and renders", () => {
  test("produces the same display list as the factory form", () => {
    const viaFactory = [Heading({ children: "Part A - the declarant" }), Field({ fields: [{ label: "Surname", value: "Du Toit" }] })];
    expect(nodesOf(doc.content)).toEqual(nodesOf(viaFactory));
  });

  test("paginates as a document, with its heading set", () => {
    const pages = paginate(doc);
    expect(pages).toHaveLength(1);
    expect((pages[0]?.nodes ?? []).filter((node) => node.kind === "text").map((node) => node.run)).toContain("PART A - THE DECLARANT");
  });

  test("nests, so a component's children arrive lowered", () => {
    const nested = (
      <>
        <Heading level={2}>Contact</Heading>
        <Field fields={[{ label: "Email", value: "a@b.example" }]} />
      </>
    );
    expect(nodesOf(nested)).toEqual(
      nodesOf([Heading({ level: 2, children: "Contact" }), Field({ fields: [{ label: "Email", value: "a@b.example" }] })]),
    );
  });
});

function textsOf(content: PdfContent): PdfTextNode[] {
  return nodesOf(content).filter((node): node is PdfTextNode => node.kind === "text");
}

describe("containers take JSX children", () => {
  const site = { uri: "https://example.org" };

  test("nests Stack > Box > KeepTogether > Row with one child each", () => {
    const markup = (
      <Stack>
        <Box padding={4}>
          <KeepTogether>
            <Row>
              <Text>One</Text>
            </Row>
          </KeepTogether>
        </Box>
      </Stack>
    );
    const factory = Stack({
      children: [Box({ padding: 4, children: [KeepTogether({ children: [Row({ children: [Text({ children: "One" })] })] })] })],
    });
    expect(nodesOf(markup)).toEqual(nodesOf(factory));
    expect(textsOf(markup).map((node) => node.run)).toEqual(["One"]);
  });

  test("nests Stack > Box > KeepTogether > Row with several children each", () => {
    const markup = (
      <Stack gap={6}>
        <Text>Lead</Text>
        <Box padding={4} gap={2}>
          <Text>Boxed</Text>
          <KeepTogether gap={2}>
            <Text>Kept</Text>
            <Row gap={12}>
              <Text>Left</Text>
              <Text>Right</Text>
            </Row>
          </KeepTogether>
        </Box>
      </Stack>
    );
    const factory = Stack({
      gap: 6,
      children: [
        Text({ children: "Lead" }),
        Box({
          padding: 4,
          gap: 2,
          children: [
            Text({ children: "Boxed" }),
            KeepTogether({
              gap: 2,
              children: [Text({ children: "Kept" }), Row({ gap: 12, children: [Text({ children: "Left" }), Text({ children: "Right" })] })],
            }),
          ],
        }),
      ],
    });
    expect(nodesOf(markup)).toEqual(nodesOf(factory));
    const texts = textsOf(markup);
    expect(texts.map((node) => node.run)).toEqual(["Lead", "Boxed", "Kept", "Left", "Right"]);
    const [left, right] = texts.slice(3);
    expect(left?.y).toBe(right?.y);
    expect(right?.x ?? 0).toBeGreaterThan(left?.x ?? 0);
  });

  test("a Link takes one child or several", () => {
    expect(
      nodesOf(
        <Link to={site}>
          <Text>Terms</Text>
        </Link>,
      ),
    ).toEqual(nodesOf(Link({ to: site, children: [Text({ children: "Terms" })] })));
    const several = (
      <Link to={site}>
        <Text>Terms</Text>
        <Text>Conditions</Text>
      </Link>
    );
    expect(nodesOf(several)).toEqual(nodesOf(Link({ to: site, children: [Text({ children: "Terms" }), Text({ children: "Conditions" })] })));
    expect(textsOf(several).map((node) => node.run)).toEqual(["Terms", "Conditions"]);
  });

  test("a Panel takes one child or several", () => {
    expect(
      nodesOf(
        <Panel padding={8}>
          <Text>Inside</Text>
        </Panel>,
      ),
    ).toEqual(nodesOf(Panel({ padding: 8, children: [Text({ children: "Inside" })] })));
    const several = (
      <Panel padding={8} gap={4}>
        <Text>First</Text>
        <Text>Second</Text>
      </Panel>
    );
    expect(nodesOf(several)).toEqual(nodesOf(Panel({ padding: 8, gap: 4, children: [Text({ children: "First" }), Text({ children: "Second" })] })));
    const [first, second] = textsOf(several);
    expect(second?.y ?? 0).toBeGreaterThan(first?.y ?? 0);
  });
});

describe("a container's factory lowers the content it is handed", () => {
  const site = { uri: "https://example.org" };
  const containers: { name: string; build: (children: PdfContent) => PdfElement }[] = [
    { name: "Stack", build: (children) => Stack({ children, gap: 3 }) },
    { name: "Row", build: (children) => Row({ children, gap: 3 }) },
    { name: "Box", build: (children) => Box({ children, padding: 4, gap: 3 }) },
    { name: "KeepTogether", build: (children) => KeepTogether({ children, gap: 3 }) },
    { name: "Panel", build: (children) => Panel({ children, padding: 4, gap: 3 }) },
    { name: "Link", build: (children) => Link({ children, to: site }) },
  ];
  const a = () => Text({ children: "A" });
  const b = () => Text({ children: "B" });

  for (const { name, build } of containers) {
    test(`${name} skips null, false and true children and flattens a nested array`, () => {
      const holed = build([a(), null, false, undefined, [true, [b()]]]);
      expect(nodesOf(holed)).toEqual(nodesOf(build([a(), b()])));
      expect(textsOf(holed).map((node) => node.run)).toEqual(["A", "B"]);
    });

    test(`${name} lowers a JSX descriptor handed to its factory`, () => {
      const lowered = build(<Text>A</Text>);
      expect(nodesOf(lowered)).toEqual(nodesOf(build([a()])));
      expect(textsOf(lowered).map((node) => node.run)).toEqual(["A"]);
    });

    test(`${name} lowers a JSX fragment of several children handed to its factory`, () => {
      const lowered = build(
        <>
          <Text>A</Text>
          <Text>B</Text>
        </>,
      );
      expect(nodesOf(lowered)).toEqual(nodesOf(build([a(), b()])));
    });

    test(`${name} sets no text for nothing, an empty array or a lone false`, () => {
      for (const empty of [null, [], false] as const) expect(textsOf(build(empty))).toEqual([]);
      expect(nodesOf(build(false))).toEqual(nodesOf(build([])));
    });
  }

  test("a Row sizes its default tracks by the children it lowers, not by the holes it was handed", () => {
    const holed = Row({ children: [a(), null, b(), false] });
    const [left, right] = textsOf(holed);
    expect(nodesOf(holed)).toEqual(nodesOf(Row({ children: [a(), b()] })));
    expect((right?.x ?? 0) - (left?.x ?? 0)).toBe(MEASURE.width / 2);
  });

  test("containers with no children under JSX set nothing on the page", () => {
    const empty = (
      <Stack>
        {false}
        <Box>{null}</Box>
        <KeepTogether>{[]}</KeepTogether>
        <Row>{undefined}</Row>
        <Link to={site}>{false}</Link>
      </Stack>
    );
    expect(nodesOf(empty)).toEqual([]);
  });
});
