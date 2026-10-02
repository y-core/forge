import { describe, expect, test } from "bun:test";

import { collectPdfImages, createPdfImage, imageObject } from "./image";
import { jpegBytes, pngBytes, pngDeclaringLength, pngRawIdat } from "./image.fixture";
import { MAX_PDF_IMAGE_PIXELS } from "./limits";
import type { PdfImage, PdfPage, PdfResult } from "./types";

const latin1 = new TextDecoder("latin1");

async function inflate(bytes: Uint8Array): Promise<number[]> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  return [...new Uint8Array(await new Response(stream).arrayBuffer())];
}

function embedded(result: PdfResult<PdfImage>): PdfImage {
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function refusal(result: PdfResult<PdfImage>): string {
  if (result.ok) throw new Error("expected the image to be refused");
  return result.error.message;
}

function carries(file: Uint8Array, stream: Uint8Array): boolean {
  return latin1.decode(file).includes(latin1.decode(stream));
}

describe("a JPEG goes in as it stands", () => {
  test("hands PDF the file's own bytes under /DCTDecode, having only read its frame header", async () => {
    const file = jpegBytes(640, 480, 3);
    const image = embedded(await createPdfImage(file));
    expect(image).toMatchObject({ width: 640, height: 480, colourSpace: "/DeviceRGB", filter: "DCTDecode", bitsPerComponent: 8 });
    expect(image.bytes).toBe(file);
  });

  test("reads its colour space off the component count", async () => {
    expect(embedded(await createPdfImage(jpegBytes(8, 8, 1))).colourSpace).toBe("/DeviceGray");
    expect(embedded(await createPdfImage(jpegBytes(8, 8, 4))).colourSpace).toBe("/DeviceCMYK");
  });

  test("declines a progressive frame by name rather than writing a stream a reader may not open", async () => {
    expect(refusal(await createPdfImage(jpegBytes(8, 8, 3, 0xc2)))).toContain("progressive");
  });
});

describe("an opaque PNG goes in as it stands too, because its filtering is PDF's predictor", () => {
  test("carries the source's own IDAT bytes, re-encoding nothing", async () => {
    const file = await pngBytes({ width: 2, height: 1, depth: 8, colour: 2, rows: [[255, 0, 0, 0, 0, 255]] });
    const image = embedded(await createPdfImage(file));
    expect(image.filter).toBe("FlateDecode");
    expect(carries(file, image.bytes)).toBe(true);
  });

  test("describes PNG's own filtering as the predictor it is", async () => {
    const file = await pngBytes({ width: 2, height: 1, depth: 8, colour: 2, rows: [[255, 0, 0, 0, 0, 255]] });
    expect(embedded(await createPdfImage(file)).decodeParms).toBe("<< /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns 2 >>");
  });

  test("a grayscale PNG keeps one component per pixel", async () => {
    const file = await pngBytes({ width: 2, height: 1, depth: 8, colour: 0, rows: [[10, 20]] });
    const image = embedded(await createPdfImage(file));
    expect(image.colourSpace).toBe("/DeviceGray");
    expect(image.decodeParms).toContain("/Colors 1");
  });
});

describe("a palette PNG stays a palette", () => {
  const palette = [255, 0, 0, 0, 0, 255];

  test("indexes into the palette the file already carries rather than expanding to RGB", async () => {
    const file = await pngBytes({ width: 2, height: 1, depth: 8, colour: 3, rows: [[0, 1]], palette });
    const image = embedded(await createPdfImage(file));
    expect(image.colourSpace).toBe("[/Indexed /DeviceRGB 1 <ff00000000ff>]");
    expect(carries(file, image.bytes)).toBe(true);
  });

  test("refuses a palette with no colours in it", async () => {
    const file = await pngBytes({ width: 1, height: 1, depth: 8, colour: 3, rows: [[0]] });
    expect(refusal(await createPdfImage(file))).toContain("PLTE");
  });

  test("declines a palette carrying transparency, and names the re-save that embeds it", async () => {
    const file = await pngBytes({ width: 2, height: 1, depth: 8, colour: 3, rows: [[0, 1]], palette, transparency: [0, 255] });
    expect(refusal(await createPdfImage(file))).toContain("RGBA");
  });
});

describe("colour-key transparency is refused wherever it is declared, not only on a palette", () => {
  // A grayscale or truecolour PNG takes the passthrough, which reads the header and the pixel run
  // and nothing else — so a `tRNS` chunk there would embed its key solid rather than clear.
  for (const [description, colour, rows, transparency] of [
    ["a grayscale PNG", 0, [[10, 20]], [0, 10]],
    ["a truecolour PNG", 2, [[255, 0, 0, 0, 0, 255]], [0, 255, 0, 0, 0, 0]],
  ] as const) {
    test(`declines ${description} carrying a tRNS chunk rather than painting the key solid`, async () => {
      const file = await pngBytes({ width: 2, height: 1, depth: 8, colour, rows, transparency });
      expect(refusal(await createPdfImage(file))).toContain("tRNS");
    });
  }
});

describe("alpha is the one channel PDF cannot carry interleaved", () => {
  const rgba = { width: 2, height: 1, depth: 8, colour: 6, rows: [[255, 0, 0, 128, 0, 255, 0, 64]] };

  test("splits the colour out, and it inflates back to the pixels the file described", async () => {
    const image = embedded(await createPdfImage(await pngBytes(rgba)));
    expect(image.colourSpace).toBe("/DeviceRGB");
    expect(await inflate(image.bytes)).toEqual([255, 0, 0, 0, 255, 0]);
  });

  test("carries the alpha as a grayscale soft mask of its own", async () => {
    const mask = embedded(await createPdfImage(await pngBytes(rgba))).mask;
    expect(mask).toMatchObject({ width: 2, height: 1, colourSpace: "/DeviceGray", filter: "FlateDecode" });
    expect(await inflate(mask?.bytes ?? new Uint8Array())).toEqual([128, 64]);
  });

  test("the split leaves no predictor behind, since the samples are no longer filtered", async () => {
    expect(embedded(await createPdfImage(await pngBytes(rgba))).decodeParms).toBeUndefined();
  });

  test("undoes the row filters first, so a predicted row splits on its true samples", async () => {
    // The second row is stored as its difference from the first, which is PNG's `Up` filter: split
    // without undoing it and the mask would carry the difference rather than the alpha.
    const file = await pngBytes({
      width: 1,
      height: 2,
      depth: 8,
      colour: 4,
      rows: [
        [200, 100],
        [10, 10],
      ],
      filters: [0, 2],
    });
    const image = embedded(await createPdfImage(file));
    expect(await inflate(image.bytes)).toEqual([200, 210]);
    expect(await inflate(image.mask?.bytes ?? new Uint8Array())).toEqual([100, 110]);
  });

  test("declines an interlaced PNG by name rather than reassembling seven passes", async () => {
    const file = await pngBytes({ width: 2, height: 1, depth: 8, colour: 2, rows: [[1, 2, 3, 4, 5, 6]], interlaced: true });
    expect(refusal(await createPdfImage(file))).toContain("interlaced");
  });
});

// A PNG is untrusted input, and every number a decode is sized by comes out of its own header — so
// the claim is that each of these leaves as a refusal rather than a hang, a throw or an allocation.
describe("a crafted PNG is refused rather than acted on", () => {
  test("a chunk declaring a length past the end of the file is refused, not walked forever", async () => {
    expect(refusal(await createPdfImage(pngDeclaringLength(0xfffffff4)))).toContain("past the end of the file");
  });

  test("a header declaring more pixels than a decode is bounded by is refused before anything is sized", async () => {
    const file = pngRawIdat({ width: 60_000, height: 60_000, depth: 8, colour: 6, data: [] });
    expect(refusal(await createPdfImage(file))).toContain(`${MAX_PDF_IMAGE_PIXELS}-pixel ceiling`);
  });

  test("an IDAT that does not inflate is refused rather than throwing past the Result", async () => {
    const file = pngRawIdat({ width: 2, height: 1, depth: 8, colour: 6, data: [1, 2, 3, 4] });
    expect(refusal(await createPdfImage(file))).toContain("truncated or corrupt");
  });

  test("an alpha colour type below eight bits is refused, since its sample stride is fractional", async () => {
    const file = pngRawIdat({ width: 2, height: 1, depth: 1, colour: 6, data: [] });
    expect(refusal(await createPdfImage(file))).toContain("8 or 16 bits");
  });
});

describe("what the file is", () => {
  test("bytes that are neither a PNG nor a JPEG are refused before anything is parsed", async () => {
    expect(refusal(await createPdfImage(new Uint8Array([0x47, 0x49, 0x46, 0x38])))).toContain("signature");
  });
});

describe("the objects an embedded image becomes", () => {
  const image: PdfImage = {
    width: 2,
    height: 1,
    bytes: new Uint8Array([1, 2]),
    bitsPerComponent: 8,
    colourSpace: "/DeviceRGB",
    filter: "FlateDecode",
  };

  test("declares what it is, how big it is, and how long its stream runs", () => {
    expect(imageObject(image, undefined).head).toContain("/Type /XObject /Subtype /Image /Width 2 /Height 1 /ColorSpace /DeviceRGB");
    expect(imageObject(image, undefined).head).toContain("/Length 2");
  });

  test("points at its soft mask by number where it has one", () => {
    expect(imageObject(image, 9).head).toContain("/SMask 9 0 R");
  });

  test("an image drawn twice is one object, and two images are two", () => {
    const other = { ...image };
    const page = (drawn: PdfImage[]): PdfPage => ({
      nodes: drawn.map((of) => ({ kind: "image", tag: "artwork", x: 0, y: 0, width: 1, height: 1, image: of })),
      y: 0,
      letterheadNodes: 0,
    });
    expect(collectPdfImages([page([image, image]), page([other])])).toEqual([image, other]);
  });
});
