import { describe, expect, test } from "bun:test";

import type { v } from "../../validation/mod";
import { ARTWORK, readPdfArtwork } from "./artwork";
import { Text } from "./components";
import { describePdfLayout } from "./layout";
import { createPdfRenderer } from "./renderer";
import type { PdfArtwork, PdfLetterhead } from "./types";

type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const SCHEMA_IS_THE_TYPE: Mutual<v.InferOutput<typeof ARTWORK>, PdfArtwork> = true;

const VALID: PdfArtwork = {
  width: 100,
  height: 50,
  paths: [
    {
      commands: [{ op: "move", x: 0, y: 0 }, { op: "line", x: 10, y: 0 }, { op: "curve", x1: 1, y1: 2, x2: 3, y2: 4, x: 5, y: 6 }, { op: "close" }],
      fill: [1, 0.5, 0],
      stroke: [0, 0, 0],
      weight: 2,
    },
  ],
};

function withPath(path: Record<string, unknown>): unknown {
  return { ...VALID, paths: [{ ...VALID.paths[0], ...path }] };
}

function refusal(json: unknown): string | undefined {
  const read = readPdfArtwork(json);
  expect(read.ok).toBe(false);
  if (read.ok) return undefined;
  expect(read.error.kind).toBe("artwork");
  return read.error.message;
}

describe("a mark artifact read as artwork", () => {
  test("the schema reads exactly the type the engine draws", () => {
    expect(SCHEMA_IS_THE_TYPE).toBe(true);
  });

  test("accepts well-formed artwork unchanged", () => {
    expect(readPdfArtwork(VALID)).toStrictEqual({ ok: true, data: VALID });
  });

  test("accepts a four-part ink, which carries alpha, unchanged", () => {
    const translucent = withPath({ fill: [1, 0, 0, 0.5] });
    expect(readPdfArtwork(translucent)).toStrictEqual({ ok: true, data: translucent });
  });

  test("accepts a rect command", () => {
    const boxed = withPath({ commands: [{ op: "rect", x: 1, y: 2, width: 3, height: 4 }] });
    expect(readPdfArtwork(boxed)).toStrictEqual({ ok: true, data: boxed });
  });

  test("keeps the alt text a mark announces itself by", () => {
    expect(readPdfArtwork({ ...VALID, alt: "Meridian" })).toStrictEqual({ ok: true, data: { ...VALID, alt: "Meridian" } });
  });

  test("strips a key the engine does not read", () => {
    expect(readPdfArtwork({ ...VALID, source: "mark.svg" })).toStrictEqual({ ok: true, data: VALID });
  });

  test("keeps a three-part ink at three parts rather than padding it with an alpha", () => {
    const read = readPdfArtwork(VALID);
    expect(read.ok ? read.data.paths[0]?.fill?.length : undefined).toBe(3);
    expect(read.ok ? read.data.paths[0]?.stroke?.length : undefined).toBe(3);
  });

  test("accepts a rect with a negative width and height, which PDF draws mirrored", () => {
    const mirrored = withPath({ commands: [{ op: "rect", x: 10, y: 10, width: -3, height: -4 }] });
    expect(readPdfArtwork(mirrored)).toStrictEqual({ ok: true, data: mirrored });
  });

  test("refuses a zero width, which every coordinate is scaled out of", () => {
    expect(refusal({ ...VALID, width: 0 })).toBe("the artwork is malformed at width");
  });

  test("refuses a negative height", () => {
    expect(refusal({ ...VALID, height: -1 })).toBe("the artwork is malformed at height");
  });

  test("refuses a NaN coordinate", () => {
    const commands = [...(VALID.paths[0]?.commands ?? []).slice(0, 3), { op: "line", x: Number.NaN, y: 0 }];
    expect(refusal(withPath({ commands }))).toBe("the artwork is malformed at paths.0.commands.3.x");
  });

  test("refuses an infinite coordinate", () => {
    expect(refusal(withPath({ commands: [{ op: "line", x: 0, y: Number.POSITIVE_INFINITY }] }))).toBe(
      "the artwork is malformed at paths.0.commands.0.y",
    );
  });

  test("refuses an ink channel above 1", () => {
    expect(refusal(withPath({ fill: [1.5, 0, 0] }))).toBe("the artwork is malformed at paths.0.fill.0");
  });

  test("refuses a five-part ink", () => {
    expect(refusal(withPath({ stroke: [0, 0, 0, 1, 0] }))).toBe("the artwork is malformed at paths.0.stroke");
  });

  test("refuses a two-part ink", () => {
    expect(refusal(withPath({ fill: [0, 0] }))).toBe("the artwork is malformed at paths.0.fill");
  });

  test("refuses an op the engine has no operator for", () => {
    expect(refusal(withPath({ commands: [{ op: "arc", x: 0, y: 0 }] }))).toBe("the artwork is malformed at paths.0.commands.0.op");
  });

  test("refuses artwork with no paths", () => {
    expect(refusal({ width: 10, height: 10 })).toBe("the artwork is malformed at paths");
  });

  test("refuses a negative stroke weight", () => {
    expect(refusal(withPath({ weight: -1 }))).toBe("the artwork is malformed at paths.0.weight");
  });

  test("refuses a value that is not an object at all, without quoting it", () => {
    expect(refusal("secret")).toBe("the artwork is malformed");
  });
});

describe("a letterhead mark at render time", () => {
  const LETTERHEAD: PdfLetterhead = { name: "Meridian", tagline: "Practice", email: "a@b.example", phone: "+27 21 555 0143" };

  async function render(letterhead: PdfLetterhead) {
    return createPdfRenderer({ compress: false }).render({ title: "Mark", letterhead, content: Text({ children: "Body" }) });
  }

  test("refuses a malformed mark before a byte is written", async () => {
    const result = await render({ ...LETTERHEAD, mark: { ...VALID, width: 0 } });
    expect(result).toEqual({ ok: false, error: { kind: "artwork", message: "the letterhead's mark is malformed at width" } });
  });

  for (const markWidth of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
    test(`refuses a mark width of ${markWidth}, which is not a positive number`, async () => {
      expect(await render({ ...LETTERHEAD, mark: VALID, markWidth })).toEqual({
        ok: false,
        error: { kind: "artwork", message: "the letterhead's markWidth must be a finite number above 0" },
      });
    });
  }

  // Each malformed value is distinctive, so an exact message also shows the value is never quoted.
  const MALFORMED: { name: string; mark: unknown; field: string }[] = [
    { name: "a negative width", mark: { ...VALID, width: -424242.5 }, field: "width" },
    { name: "a NaN height", mark: { ...VALID, height: Number.NaN }, field: "height" },
    { name: "a NaN coordinate", mark: withPath({ commands: [{ op: "move", x: Number.NaN, y: 987654.321 }] }), field: "paths.0.commands.0.x" },
    { name: "an ink channel out of range", mark: withPath({ fill: [0.5, 7.654321, 0] }), field: "paths.0.fill.1" },
    { name: "a five-part ink", mark: withPath({ stroke: [0, 0, 0, 1, 0.13579] }), field: "paths.0.stroke" },
    { name: "an unknown op", mark: withPath({ commands: [{ op: "zigzag-quux", x: 0, y: 0 }] }), field: "paths.0.commands.0.op" },
    { name: "an alt that is not text", mark: { ...VALID, alt: 31337 }, field: "alt" },
  ];

  for (const { name, mark, field } of MALFORMED) {
    test(`refuses a mark with ${name}, naming the field and not the value`, async () => {
      expect(await render({ ...LETTERHEAD, mark: mark as PdfArtwork })).toEqual({
        ok: false,
        error: { kind: "artwork", message: `the letterhead's mark is malformed at ${field}` },
      });
    });

    test(`describePdfLayout refuses a mark with ${name} as the render does`, async () => {
      const doc = { title: "Mark", letterhead: { ...LETTERHEAD, mark: mark as PdfArtwork }, content: Text({ children: "Body" }) };
      const rendered = await createPdfRenderer({ compress: false }).render(doc);
      expect(rendered.ok).toBe(false);
      expect(describePdfLayout(doc)).toEqual(rendered);
    });
  }

  test("describePdfLayout refuses a mark width that is not a positive number", () => {
    const doc = { title: "Mark", letterhead: { ...LETTERHEAD, mark: VALID, markWidth: 0 }, content: Text({ children: "Body" }) };
    expect(describePdfLayout(doc)).toEqual({
      ok: false,
      error: { kind: "artwork", message: "the letterhead's markWidth must be a finite number above 0" },
    });
  });

  test("still renders a well-formed mark", async () => {
    expect((await render({ ...LETTERHEAD, mark: VALID, markWidth: 40 })).ok).toBe(true);
  });
});
